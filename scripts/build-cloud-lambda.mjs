import { build, version } from "esbuild";
import { zipSync } from "fflate";
import { builtinModules } from "node:module";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url))),
  hash = (data) => createHash("sha256").update(data).digest("hex"),
  builtins = new Set(builtinModules.flatMap((name) => [name, "node:" + name]));
export async function buildCloudLambda() {
  const result = await build({
    absWorkingDir: root,
    entryPoints: ["infra/cloud/handler.ts"],
    outfile: "handler.cjs",
    bundle: true,
    platform: "node",
    target: "node24",
    format: "cjs",
    sourcemap: false,
    legalComments: "external",
    metafile: true,
    write: false,
    logLevel: "silent",
  });
  for (const [name, output] of Object.entries(result.metafile.outputs)) {
    if (!["handler.cjs", "handler.cjs.LEGAL.txt"].includes(name))
      throw Error("Unexpected Cloud artifact output");
    for (const imported of output.imports)
      if (imported.external && !builtins.has(imported.path))
        throw Error("Cloud artifact has an unbundled dependency");
  }
  for (const input of Object.keys(result.metafile.inputs)) {
    if (
      !/^(node_modules\/|infra\/cloud\/|packages\/(cloud-protocol|core)\/src\/)/.test(
        input,
      ) ||
      /(^|\/)(tests|fixtures|store-sqlite|store-idb)(\/|\.)/.test(input)
    )
      throw Error("Unexpected Cloud artifact source");
  }
  // Most SDK packages ship license files rather than preservable source comments.
  const packages = new Map();
  for (const input of Object.keys(result.metafile.inputs)) {
    if (!input.startsWith("node_modules/")) continue;
    const offset = input.lastIndexOf("node_modules/") + "node_modules/".length,
      parts = input.slice(offset).split("/"),
      directory = join(
        root,
        input.slice(0, offset),
        ...parts.slice(0, parts[0].startsWith("@") ? 2 : 1),
      ),
      info = JSON.parse(await readFile(join(directory, "package.json")));
    if (!info.name || !info.version)
      throw Error("Invalid bundled package metadata");
    packages.set(info.name + "@" + info.version, { directory, info });
  }
  let notices = "Bundled third-party dependency notices\n";
  for (const [name, { directory, info }] of [...packages].sort(([a], [b]) =>
    a.localeCompare(b, "en"),
  )) {
    const names = (await readdir(directory))
      .filter((name) => /^(license|notice)(\.(txt|md))?$/i.test(name))
      .sort();
    notices += "\n\n" + name + "\n";
    if (!names.some((name) => /^license/i.test(name))) {
      // These upstream AWS packages omit a license file but declare Apache-2.0.
      if (
        info.license !== "Apache-2.0" ||
        ![
          "@aws-sdk/credential-provider-http",
          "@aws-sdk/nested-clients",
          "@aws-sdk/credential-provider-login",
        ].includes(info.name)
      )
        throw Error("Bundled dependency is missing its license: " + name);
      notices +=
        "Declared Apache-2.0; text from bundled AWS SDK client LICENSE:\n" +
        (await readFile(
          join(root, "node_modules/@aws-sdk/client-dynamodb/LICENSE"),
          "utf8",
        ));
    }
    for (const file of names)
      notices +=
        "\n" + file + "\n" + (await readFile(join(directory, file), "utf8"));
  }
  result.outputFiles.push({
    path: join(root, "THIRD_PARTY_NOTICES.txt"),
    contents: new TextEncoder().encode(notices),
  });
  const files = Object.fromEntries(
    result.outputFiles
      .sort((a, b) => a.path.localeCompare(b.path, "en"))
      .map((file) => [
        basename(file.path),
        [
          file.contents,
          {
            mtime: new Date(2000, 0, 1),
            os: 3,
            attrs: 0o644 << 16,
          },
        ],
      ]),
  );
  const zip = zipSync(files, { level: 9 });
  if (
    zip.length > 20 * 1024 * 1024 ||
    result.outputFiles.reduce((size, file) => size + file.contents.length, 0) >
      20 * 1024 * 1024
  )
    throw Error("Cloud artifact exceeds development size limit");
  const manifest = {
    format: 1,
    runtime: "nodejs24.x",
    handler: "handler.handler",
    architecture: "x86_64",
    esbuild: version,
    zipBytes: zip.length,
    zipSha256: hash(zip),
    lockSha256: hash(await readFile(join(root, "pnpm-lock.yaml"))),
    files: Object.fromEntries(
      result.outputFiles.map((file) => [
        basename(file.path),
        hash(file.contents),
      ]),
    ),
  };
  return { zip, manifest };
}
if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  const { zip, manifest } = await buildCloudLambda(),
    output = join(root, "artifacts/cloud-lambda");
  await mkdir(output, { recursive: true });
  await writeFile(join(output, "cloud-lambda.zip"), zip);
  await writeFile(
    join(output, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  console.log(JSON.stringify(manifest));
}
