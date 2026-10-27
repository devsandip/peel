import { describe, it, expect } from "vitest";
import { newNote, setState } from "../../packages/core/src/index";
import {
  tick,
  compareStamp,
  compareEdit,
  replica,
  receive,
  purge,
  prune,
  HISTORY_MS,
  MAX_FUTURE_MS,
  type Edit,
  type Purge,
} from "../../packages/peer-protocol/src/index";
const now = Date.parse("2026-10-26T16:00:00.000Z");
const authors = new Set(["mac", "phone", "web"]);
const seed = {
  ...newNote(
    "local",
    "# Synthetic thought\n原文 café ##work",
    new Date(now).toISOString(),
  ),
  noteId: "note-1",
};
const edit = (
  deviceId: string,
  editId: string,
  physical = now,
  logical = 0,
): Edit => ({
  protocol: 1,
  libraryId: "library-1",
  editId,
  stamp: { physical, logical, deviceId },
  note: { ...seed },
});
const marker: Purge = {
  protocol: 1,
  libraryId: "library-1",
  noteId: seed.noteId,
  purgeId: "purge-1",
  deviceId: "phone",
  purgedAt: now,
};
function permutations<T>(values: T[]): T[][] {
  return values.length < 2
    ? [values]
    : values.flatMap((v, i) =>
        permutations(values.filter((_, j) => i !== j)).map((rest) => [
          v,
          ...rest,
        ]),
      );
}
describe("M0 peer protocol model, AC-09/10/25 partial", () => {
  it("preserves causality across equal and backwards physical time without restamping incoming edits", async () => {
    const a = edit("mac", "edit-1");
    let b = (await receive(replica("library-1", "phone"), a, now, authors))
      .state;
    b.clock = tick(b.clock, now - 365 * 86400000);
    const later = { ...edit("phone", "edit-2"), stamp: b.clock };
    expect(compareEdit(later, a)).toBeGreaterThan(0);
    expect(b.heads[seed.noteId].stamp).toEqual(a.stamp);
    const restarted = JSON.parse(JSON.stringify(b));
    expect(
      compareStamp(tick(restarted.clock, now - 1), b.clock),
    ).toBeGreaterThan(0);
    expect(
      tick({ physical: now, logical: 10, deviceId: "mac" }, now, {
        physical: now,
        logical: 20,
        deviceId: "web",
      }).logical,
    ).toBe(21);
    expect(tick(b.clock, now + 1000).logical).toBe(0);
  });
  it("converges three replicas for every concurrent archive/edit/Trash arrival order and duplicate retry", async () => {
    const a = edit("mac", "edit-a");
    const b = {
      ...edit("phone", "edit-b"),
      note: setState(seed, "archived", new Date(now).toISOString()),
    };
    const c = {
      ...edit("web", "edit-c"),
      note: setState(
        { ...seed, bodyMarkdown: "Latest Unicode café 原文" },
        "trashed",
        new Date(now).toISOString(),
      ),
    };
    for (const order of permutations([a, b, c])) {
      for (const device of authors) {
        let state = replica("library-1", device);
        for (const incoming of [...order, ...order])
          state = (await receive(state, incoming, now + 1, authors)).state;
        state = JSON.parse(JSON.stringify(state));
        expect(state.heads[seed.noteId]).toEqual(c);
        expect(
          state.history[seed.noteId].map((v) => v.edit.editId).sort(),
        ).toEqual([a.editId, b.editId]);
      }
    }
  });
  it("uses edit ID after an equal stamp and rejects reused identities even after seven-day body cleanup", async () => {
    const a = edit("mac", "edit-a");
    const b = {
      ...edit("mac", "edit-b"),
      note: { ...seed, bodyMarkdown: "Second immutable edit" },
    };
    let state = replica("library-1", "phone");
    for (const incoming of [b, a])
      state = (await receive(state, incoming, now, authors)).state;
    expect(state.heads[seed.noteId]).toEqual(b);
    state = prune(state, now + HISTORY_MS);
    expect(state.history).toEqual({});
    const retry = await receive(state, a, now + HISTORY_MS + 1, authors);
    expect(retry.outcome).toBe("duplicate");
    expect(retry.state.history).toEqual({});
    await expect(
      receive(
        state,
        { ...a, note: { ...seed, bodyMarkdown: "Identity collision" } },
        now + HISTORY_MS + 1,
        authors,
      ),
    ).rejects.toThrow("identity reused");
    await expect(
      receive(
        state,
        {
          ...a,
          note: {
            ...seed,
            origin: {
              collectionId: "source",
              noteId: "original",
              moveId: "copy",
            },
          },
        },
        now + HISTORY_MS + 1,
        authors,
      ),
    ).rejects.toThrow("identity reused");
    // Object property insertion order is not an edit-content change.
    expect(
      (
        await receive(
          state,
          {
            note: a.note,
            stamp: a.stamp,
            editId: a.editId,
            libraryId: a.libraryId,
            protocol: 1,
          },
          now + HISTORY_MS + 1,
          authors,
        )
      ).outcome,
    ).toBe("duplicate");
  });
  it("quarantines a one-year future stamp without poisoning local time, while accepting old legitimate content", async () => {
    const state = replica("library-1", "phone");
    const result = await receive(
      state,
      edit("mac", "future", now + 365 * 86400000),
      now,
      authors,
    );
    expect(result.outcome).toBe("quarantined");
    expect(result.state).toEqual(state);
    const old = await receive(
      state,
      edit("mac", "old", now - 365 * 86400000),
      now,
      authors,
    );
    expect(old.outcome).toBe("applied");
    expect(old.state.clock.physical).toBe(now);
    expect(
      (
        await receive(
          state,
          edit("mac", "boundary", now + MAX_FUTURE_MS),
          now,
          authors,
        )
      ).outcome,
    ).toBe("applied");
    await expect(
      receive(state, edit("mac", "invalid", NaN), now, authors),
    ).rejects.toThrow("clock");
    expect(() =>
      tick(
        { physical: now, logical: Number.MAX_SAFE_INTEGER, deviceId: "mac" },
        now,
      ),
    ).toThrow("clock");
  });
  it("purge dominates newer stamps, clears retained content and cannot resurrect after a long offline period", async () => {
    let state = replica("library-1", "phone");
    for (const incoming of [edit("mac", "one"), edit("web", "two", now + 1)])
      state = (await receive(state, incoming, now + 1, authors)).state;
    state = purge(state, marker, authors);
    const restarted = JSON.parse(JSON.stringify(state));
    const later = now + 90 * 86400000;
    const result = await receive(
      restarted,
      edit("web", "stale-offline", later),
      later,
      authors,
    );
    expect(result.outcome).toBe("purged");
    expect(result.state.heads).toEqual({});
    expect(result.state.history).toEqual({});
    expect(result.state.seen).toEqual({});
    expect(JSON.stringify(result.state)).not.toContain(seed.bodyMarkdown);
    expect(JSON.stringify(result.state.tombstones)).not.toContain(
      "bodyMarkdown",
    );
    const recovered = {
      ...edit("mac", "recovered", later),
      note: { ...seed, noteId: "new-note-identity" },
    };
    expect(
      (await receive(result.state, recovered, later, authors)).outcome,
    ).toBe("applied");
  });
  it("rejects another library, unknown authors and Cloud-mode payloads before modifying a replica", async () => {
    const state = replica("library-1", "phone");
    for (const incoming of [
      { ...edit("mac", "one"), libraryId: "other-library" },
      edit("stranger", "two"),
      {
        ...edit("mac", "three"),
        note: { ...seed, collectionId: "account-cloud" },
      },
    ])
      await expect(receive(state, incoming, now, authors)).rejects.toThrow();
    expect(() =>
      purge(state, { ...marker, libraryId: "other-library" }, authors),
    ).toThrow("mismatch");
    expect(state.heads).toEqual({});
  });
  it("keeps permanent deletion dominant under every edit/purge delivery order", async () => {
    const events: (Edit | Purge)[] = [
      edit("mac", "old-edit"),
      edit("web", "later-edit", now + 1),
      marker,
      { ...marker, purgeId: "purge-2", deviceId: "web", purgedAt: now + 1 },
    ];
    for (const order of permutations(events)) {
      let state = replica("library-1", "phone");
      for (const event of order)
        state =
          "purgeId" in event
            ? purge(state, event, authors)
            : (await receive(state, event, now + 1, authors)).state;
      expect(state.heads).toEqual({});
      expect(state.history).toEqual({});
      expect(state.tombstones[seed.noteId].purgeId).toBe("purge-2");
    }
  });
  it("snapshots the received payload before asynchronous hashing", async () => {
    const incoming = edit("mac", "immutable-input");
    const pending = receive(
      replica("library-1", "phone"),
      incoming,
      now,
      authors,
    );
    incoming.note.bodyMarkdown = "Mutation while hashing";
    const result = await pending;
    expect(result.state.heads[seed.noteId].note.bodyMarkdown).toBe(
      seed.bodyMarkdown,
    );
    expect(
      (
        await receive(
          result.state,
          edit("mac", "immutable-input"),
          now,
          authors,
        )
      ).outcome,
    ).toBe("duplicate");
  });
});
