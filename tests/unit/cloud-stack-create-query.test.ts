import { expect, it } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

for (const scenario of [
  "positive",
  "encoding",
  "each-field",
  "absent-fields",
  "duplicates",
  "indexes",
  "endpoint",
  "encoding-refusal",
  "data-shape",
  "handles",
  "different-material",
  "detachment",
])
  it(`checks actual pinned offline SDK Query serialization: ${scenario}`, async () => {
    const directory = mkdtempSync(join(tmpdir(), "synkies-offline-query-"));
    try {
      for (const file of ["config", "credentials"])
        writeFileSync(join(directory, file), "", { mode: 0o600 });
      const result = await new Promise<{
        code: number | null;
        out: string;
        err: string;
      }>((resolve, reject) => {
        const child = spawn(
          process.execPath,
          [
            "tests/fixtures/cloud-stack-create-query-sdk.mjs",
            scenario,
            directory,
          ],
          {
            env: {
              ...Object.fromEntries(
                Object.entries(process.env).filter(
                  ([k]) => !k.startsWith("AWS_"),
                ),
              ),
              AWS_CONFIG_FILE: join(directory, "config"),
              AWS_SHARED_CREDENTIALS_FILE: join(directory, "credentials"),
              AWS_EC2_METADATA_DISABLED: "true",
            },
            stdio: ["ignore", "pipe", "pipe"],
          },
        );
        let out = "",
          err = "";
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
        }, 4000);
        child.stdout.on("data", (b) => {
          out += b.toString();
        });
        child.stderr.on("data", (b) => {
          err += b.toString();
        });
        child.on("error", (e) => {
          clearTimeout(timer);
          reject(e);
        });
        child.on("exit", (code) => {
          clearTimeout(timer);
          resolve({ code, out, err });
        });
      });
      expect(result.code).toBe(0);
      expect(result.out).toBe(`offline-query:${scenario}:ok\n`);
      expect(result.err).toBe("");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
