import { describe, it, expect } from "vitest";
import { WordIndex } from "../../packages/search/src/index";
import { newNote, setState, searchNotes } from "../../packages/core/src/index";
const time = "2026-10-26T12:00:00.000Z";
const notes = [
  newNote(
    "local",
    "# Onboarding\nA shorter signup, a useful thought. ##Work ##café",
    time,
  ),
  newNote("local", "# Later\nUseful thought. Onboarding idea. ##ideas", time),
  setState(
    newNote("local", "# A thought\nA shorter signup. ##WORK", time),
    "archived",
    time,
  ),
  setState(
    newNote("local", "Not in normal search. ##work", time),
    "trashed",
    time,
  ),
];
describe("Incremental word index, AC-05/14", () => {
  for (const query of [
    "onboarding",
    "shorter sign",
    '"shorter signup"',
    '"signup shorter"',
    "useful thought",
    "##work",
    "CAFÉ",
    "!",
    "",
  ])
    it(`matches lexical contract for ${JSON.stringify(query)}`, () => {
      const index = new WordIndex();
      index.update(notes);
      for (const options of [
        { query },
        { query, activeOnly: true },
        { query, tags: ["work"] },
        { query, tags: ["work", "café"] },
        { query, state: "trashed" as const },
      ]) {
        expect(index.search(options).results).toEqual(
          searchNotes(notes, options),
        );
      }
    });
  it("invalidates changed text, removed tags and purged notes while accepting state-only updates", () => {
    const index = new WordIndex();
    index.update(notes);
    const changed = {
      ...notes[0],
      bodyMarkdown: "# Different\nA lavender thought. ##home",
      localRevision: 2,
    };
    index.update([changed, setState(notes[1], "archived", time)]);
    expect(index.search({ query: "signup" }).total).toBe(0);
    expect(index.search({ tags: ["work"] }).total).toBe(0);
    expect(index.search({ query: "lavender" }).results[0].note).toEqual(
      changed,
    );
    expect(index.search({ query: "useful", activeOnly: true }).total).toBe(0);
    index.clear();
    expect(index.search().total).toBe(0);
  });
  it("returns a complete result count with a bounded first page", () => {
    const index = new WordIndex();
    index.update(notes);
    const page = index.search({}, 1);
    expect(page.total).toBe(3);
    expect(page.results).toHaveLength(1);
  });
  it("invalidates an in-place source edit and removes private derived tags on purge", () => {
    const note = newNote("local", "An old thought. ##before", time);
    const index = new WordIndex();
    index.update([note]);
    note.bodyMarkdown = "A changed thought. ##after";
    index.apply([note], []);
    expect(index.search({ query: "old" }).total).toBe(0);
    expect(index.search({ query: "changed" }).total).toBe(1);
    expect(index.tags()).toEqual([{ key: "after", label: "after" }]);
    index.apply([], [note.noteId]);
    expect(index.tags()).toEqual([]);
    expect(index.search().total).toBe(0);
  });
});
