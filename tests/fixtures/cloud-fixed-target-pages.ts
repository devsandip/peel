import { vi } from "vitest";
import { cloudFixedTargetCommands } from "../../infra/cloud/fixed-target-metadata.ts";
import { cloudStackFixture } from "./cloud-stack-pages.ts";

// Synthetic metadata/errors only. No provider call or ownership/absence acceptance.
export function cloudFixedTargetFixture() {
  const f = cloudStackFixture(),
    commands = cloudFixedTargetCommands(f.input),
    missing = new Set<string>();
  const run = vi.fn(async (args: readonly string[], _signal: AbortSignal) => {
    const target = commands.find(
      (c) => JSON.stringify(c.args) === JSON.stringify(args),
    );
    if (!target) throw Error("unexpected synthetic command");
    if (missing.has(target.logicalId))
      throw {
        code: 254,
        stdout: "",
        stderr: JSON.stringify({
          Code: target.notFound,
          Message: "private-provider-message",
          Extra: { ignored: "private-value" },
        }),
      };
    return {
      stderr: "",
      stdout: JSON.stringify(
        target.expectedArn === null
          ? { Found: true }
          : {
              Name: target.name,
              Arn:
                target.expectedArn + (target.kind === "secret" ? "Ab12Cd" : ""),
            },
      ),
    };
  });
  return { ...f, commands, missing, run };
}
