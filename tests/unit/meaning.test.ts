import { describe, expect, it } from "vitest";
import {
  chunkForEmbedding,
  normalizedVector,
  rankSemantic,
  fuseRanks,
} from "../../packages/meaning/src/index";
const vector = (...values: number[]) =>
  normalizedVector(new Float32Array(values));
describe("M0 source-complete local semantic retrieval helpers, AC-06/14 partial", () => {
  it("covers long Unicode source without splitting surrogate pairs or silently truncating chunks", () => {
    const source =
      "# Synthetic 原文 😀\n".repeat(300) + "Tail replacement gasket detail.";
    const chunks = chunkForEmbedding(
      source,
      (text) => Array.from(text).length,
      224,
    );
    expect(chunks.length).toBeGreaterThan(10);
    expect(chunks[0].start).toBe(0);
    expect(chunks.at(-1)!.end).toBe(source.length);
    const covered = new Uint8Array(source.length);
    for (const chunk of chunks) {
      expect(chunk.text).toBe(source.slice(chunk.start, chunk.end));
      expect(chunk.tokens).toBeLessThanOrEqual(224);
      expect(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/.test(chunk.text)).toBe(false);
      covered.fill(1, chunk.start, chunk.end);
    }
    expect(covered.every(Boolean)).toBe(true);
    expect(chunks.at(-1)!.text).toContain("gasket");
  });
  it("rejects invalid tokenizers and source limits rather than completing a partial index", () => {
    expect(chunkForEmbedding("", () => 0)).toEqual([]);
    for (const count of [() => NaN, () => -1, () => 300])
      expect(() => chunkForEmbedding("x", count)).toThrow();
    expect(() => chunkForEmbedding("x".repeat(262145), () => 1)).toThrow();
  });
  it("ranks distinct notes by their strongest chunk and applies lifecycle/tag filters first", () => {
    const notes = [
      {
        noteId: "long",
        state: "active" as const,
        tags: ["work"],
        vectors: [vector(0, 1), vector(1, 0)],
      },
      {
        noteId: "archived",
        state: "archived" as const,
        tags: ["work"],
        vectors: [vector(1, 0)],
      },
      {
        noteId: "trash",
        state: "trashed" as const,
        tags: ["work"],
        vectors: [vector(1, 0)],
      },
      {
        noteId: "other",
        state: "active" as const,
        tags: ["home"],
        vectors: [vector(0, 1)],
      },
    ];
    const result = rankSemantic(notes, vector(1, 0));
    expect(result.map((r) => r.noteId)).toEqual(["archived", "long", "other"]);
    expect(result[1].chunk).toBe(1);
    expect(
      rankSemantic(notes, vector(1, 0), {
        tags: ["work"],
        activeOnly: true,
      }).map((r) => r.noteId),
    ).toEqual(["long"]);
    expect(() => rankSemantic([...notes, notes[0]], vector(1, 0))).toThrow();
    expect(() => rankSemantic(notes, vector(1, 0, 0))).toThrow();
  });
  it("normalizes finite vectors and fuses prefiltered lexical/semantic ranks without duplicates", () => {
    expect([...vector(3, 4)]).toEqual([
      expect.closeTo(0.6),
      expect.closeTo(0.8),
    ]);
    for (const values of [
      new Float32Array(),
      new Float32Array([0, 0]),
      new Float32Array([Infinity]),
    ])
      expect(() => normalizedVector(values)).toThrow();
    const fused = fuseRanks(
      [
        { noteId: "semantic", score: 1, chunk: 0 },
        { noteId: "both", score: 0.9, chunk: 0 },
      ],
      ["both", "lexical", "both"],
      3,
    );
    expect(fused[0].noteId).toBe("both");
    expect(new Set(fused.map((r) => r.noteId)).size).toBe(3);
  });
});
