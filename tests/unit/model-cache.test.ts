import { describe, expect, it } from "vitest";
import {
  modelManifestId,
  validateModelManifest,
} from "../../packages/meaning/src/model-cache";
const manifest = () => ({
  identity: "model/revision/runtime/q8",
  files: [
    { path: "/models/example/config.json", bytes: 2, sha256: "a".repeat(64) },
    { path: "/runtime/engine.wasm", bytes: 3, sha256: "b".repeat(64) },
  ],
});
describe("public model artifact identity, AC-06 prerequisite", () => {
  it("binds exact bytes, paths and model/runtime identity with stable ordering and immutable inputs", async () => {
    const input = manifest(),
      snapshot = structuredClone(input);
    const first = await modelManifestId(input);
    expect(
      await modelManifestId({ ...input, files: [...input.files].reverse() }),
    ).toBe(first);
    for (const changed of [
      { ...input, identity: input.identity + "-next" },
      { ...input, files: [{ ...input.files[0], bytes: 3 }, input.files[1]] },
      {
        ...input,
        files: [{ ...input.files[0], sha256: "c".repeat(64) }, input.files[1]],
      },
    ])
      expect(await modelManifestId(changed)).not.toBe(first);
    const clean = validateModelManifest(input);
    clean.files[0].bytes = 99;
    expect(input).toEqual(snapshot);
  });
  it("rejects URL, traversal, duplicate, oversized and incomplete locks", () => {
    const input = manifest();
    for (const path of [
      "https://example.org/file",
      "/models/../secret",
      "/runtime//x",
      "/models/x?query",
      "/notes/a.json",
      "/runtime/%2e%2e/x",
      "/runtime/./x",
    ])
      expect(() =>
        validateModelManifest({
          ...input,
          files: [{ ...input.files[0], path }],
        }),
      ).toThrow("invalid-manifest");
    for (const files of [
      [],
      [input.files[0], input.files[0]],
      [{ ...input.files[0], bytes: 0 }],
      [{ ...input.files[0], bytes: 65 * 1024 * 1024 }],
      [{ ...input.files[0], sha256: "A".repeat(64) }],
    ])
      expect(() => validateModelManifest({ ...input, files })).toThrow(
        "invalid-manifest",
      );
  });
});
