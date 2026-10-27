import { transformWithOxc, type Plugin, type ResolvedConfig } from "vite";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

export function offlineShell(): Plugin {
  let config: ResolvedConfig;
  return {
    name: "peel-offline-shell",
    apply: "build",
    enforce: "post",
    configResolved(value) {
      config = value;
    },
    async writeBundle(_, bundle) {
      if (config.build.ssr) return;
      const out = path.resolve(config.root, config.build.outDir);
      const source = await readFile(
        path.join(config.root, "src/shell.worker.ts"),
        "utf8",
      );
      const paths = [
        ...Object.keys(bundle).filter(
          (name) => name === "index.html" || name.startsWith("assets/"),
        ),
        "peel.svg",
      ].sort();
      if (
        !paths.includes("index.html") ||
        !paths.some((name) => /search\.worker-.*\.js$/.test(name))
      )
        throw new Error(
          "Offline shell is missing the library or search worker",
        );
      const version = createHash("sha256").update(source);
      const files = await Promise.all(
        paths.map(async (name) => {
          const bytes = await readFile(path.join(out, name));
          const sha256 = createHash("sha256").update(bytes).digest("hex");
          return { path: name, sha256 };
        }),
      );
      for (const file of files)
        version.update(JSON.stringify([file.path, file.sha256]));
      const compiled = (
        await transformWithOxc(
          source,
          path.join(config.root, "src/shell.worker.ts"),
          { target: "es2022" },
          undefined,
          config,
        )
      ).code;
      version.update(compiled);
      const manifest = { version: version.digest("hex"), files };
      if (compiled.split("__PEEL_SHELL_MANIFEST__").length !== 2)
        throw new Error("Invalid offline manifest placeholder");
      await writeFile(
        path.join(out, "sw.js"),
        `// Peel offline shell: ${manifest.version}\n` +
          compiled.replace("__PEEL_SHELL_MANIFEST__", JSON.stringify(manifest)),
      );
    },
  };
}
