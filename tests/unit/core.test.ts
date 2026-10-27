import { describe, it, expect } from "vitest";
import {
  newNote,
  setState,
  titleOf,
  tagsOf,
  fold,
  blocksOf,
  toggleTask,
  searchNotes,
  arrange,
  clampRect,
  validateBody,
  isExpired,
  MAX_NOTE_BYTES,
  type Placement,
} from "../../packages/core/src/index";
import { exportNotes, importArchive } from "../../packages/core/src/transfer";
describe("Markdown and tags, AC-08", () => {
  it("recognizes the exact subset without altering unsupported source", () => {
    const source =
      "# Heading\n**bold** ##Work ##work ##café\n## Heading\n\\##escape C## ###no ##tag,\n- [ ] Task\n- [X] Done\n- Bullet\n2. Second\n<script>alert(1)</script>\n  - nested\n![image](url)";
    expect(tagsOf(source).map((t) => t.key)).toEqual(["work", "café", "tag"]);
    expect(blocksOf(source).map((b) => b.kind)).toEqual([
      "heading",
      "paragraph",
      "paragraph",
      "paragraph",
      "task",
      "task",
      "bullet",
      "number",
      "paragraph",
      "paragraph",
      "paragraph",
    ]);
    expect(toggleTask(source, 4)).toContain("- [x] Task");
    expect(titleOf(source)).toBe("Heading");
    const note = newNote("local", source);
    expect(importArchive(exportNotes([note]))[0]).toEqual(note);
  });
  it("normalizes and deduplicates Unicode casefolds", () => {
    expect(fold("Straße Σς CAFÉ Cafe\u0301")).toBe("strasse σσ café café");
    expect(
      tagsOf("##Straße ##STRASSE ##Cafe\u0301 ##CAFÉ").map((t) => t.key),
    ).toEqual(["strasse", "café"]);
  });
  it("rejects over-limit UTF-8 text instead of truncating", () => {
    expect(() => validateBody("x".repeat(MAX_NOTE_BYTES))).not.toThrow();
    expect(() => validateBody("é".repeat(MAX_NOTE_BYTES))).toThrow("256 KiB");
  });
});
describe("Word search, AC-05", () => {
  const fixtureTime = "2026-10-26T12:00:00.000Z";
  const first = {
    ...newNote(
      "local",
      "# Onboarding ideas\nTry a shorter signup. ##Work",
      fixtureTime,
    ),
    noteId: "a",
  };
  const second = {
    ...newNote(
      "local",
      "# Other thought\nOnboarding ideas for later. ##ideas",
      fixtureTime,
    ),
    noteId: "b",
  };
  const archived = setState(
    { ...second, noteId: "c" },
    "archived",
    fixtureTime,
  );
  const trash = setState({ ...first, noteId: "d" }, "trashed");
  const notes = [second, first, archived, trash];
  it("uses AND, last-token prefix, phrases, archive inclusion and title ranking", () => {
    expect(
      searchNotes(notes, { query: "onboarding ide" }).map((r) => r.note.noteId),
    ).toEqual(["a", "b", "c"]);
    expect(
      searchNotes(notes, { query: '"shorter signup"' }).map(
        (r) => r.note.noteId,
      ),
    ).toEqual(["a"]);
    expect(searchNotes(notes, { query: '"signup shorter"' })).toHaveLength(0);
    expect(
      searchNotes(notes, { query: "onboarding", activeOnly: true }),
    ).toHaveLength(2);
    expect(searchNotes(notes, { tags: ["work"] })).toHaveLength(1);
    expect(searchNotes(notes, { tags: ["work", "ideas"] })).toHaveLength(0);
  });
  it("enforces retention even before physical cleanup", () => {
    expect(isExpired(trash, Date.parse(trash.purgeAfter!))).toBe(true);
    expect(
      searchNotes(notes, {
        state: "trashed",
        now: Date.parse(trash.purgeAfter!),
      }),
    ).toHaveLength(0);
  });
});
describe("Desktop bounds and arrangements, AC-18/19", () => {
  const area = { x: 100, y: 25, width: 1440, height: 850 };
  const make = (count: number): Placement[] =>
    Array.from({ length: count }, (_, i) => ({
      noteId: String(i),
      x: 200 + i * 12,
      y: 100 + i * 12,
      width: 360,
      height: 380,
      pinned: true,
      alwaysOnTop: i % 2 === 0,
    }));
  it("keeps a note its original size when it already fits at an edge", () => {
    for (const edge of ["left", "right", "top", "bottom"] as const) {
      const [note] = arrange(
        make(1),
        { x: 0, y: 31, width: 2560, height: 1409 },
        edge,
      );
      expect([note.width, note.height]).toEqual([360, 380]);
    }
  });
  for (const count of [1, 3, 10, 30])
    for (const edge of ["left", "right", "top", "bottom"] as const)
      it(`${count} notes at ${edge} remain inside usable area without changing identities`, () => {
        const input = make(count),
          output = arrange(input, area, edge);
        expect(output.map((p) => p.noteId)).toEqual(input.map((p) => p.noteId));
        expect(output.map((p) => p.alwaysOnTop)).toEqual(
          input.map((p) => p.alwaysOnTop),
        );
        for (const p of output) {
          expect(p.x).toBeGreaterThanOrEqual(area.x);
          expect(p.y).toBeGreaterThanOrEqual(area.y);
          expect(p.x + p.width).toBeLessThanOrEqual(
            area.x + area.width + 0.001,
          );
          expect(p.y + p.height).toBeLessThanOrEqual(
            area.y + area.height + 0.001,
          );
        }
        expect(input).toEqual(make(count));
      });
  it("recovers disconnected-display geometry", () => {
    expect(
      clampRect({ x: 9000, y: -9000, width: 1000, height: 900 }, area),
    ).toEqual({ x: 540, y: 25, width: 1000, height: 850 });
  });
});
