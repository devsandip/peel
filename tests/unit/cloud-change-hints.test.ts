import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  cloudChangeHintFromChange,
  createCloudChangeHintReader,
} from "../../packages/cloud-protocol/src/change-hints";
import { type CloudScope } from "../../packages/cloud-protocol/src/durable";
import {
  mutationHash,
  type CloudDraft,
} from "../../packages/cloud-protocol/src/index";
import {
  CloudMutationService,
  CLOUD_RECEIPT_MS,
  CLOUD_TRASH_MS,
  type CloudChange,
} from "../../packages/cloud-protocol/src/server";
import { SQLiteCloudServerStore } from "../../packages/cloud-protocol/src/server-sqlite";

const scope: CloudScope = {
    version: 1,
    ownerSubject: "hint-owner",
    collectionId: "hint-library",
    modeGeneration: 7,
  },
  now = 1800000000000,
  change: CloudChange = {
    version: 1,
    sequence: 4,
    noteId: "shared-note",
    revision: 3,
    kind: "upsert",
    createdAt: now,
    expiresAt: now + CLOUD_RECEIPT_MS,
  },
  hint = () => ({
    ...scope,
    kind: "library-changed",
    sequence: 4,
    noteId: "shared-note",
  }),
  failure = "Cloud change hint unavailable";
const draft = (
  body: string,
  state: CloudDraft["state"] = "active",
): CloudDraft => ({
  schemaVersion: 1,
  collectionId: scope.collectionId,
  noteId: "shared-note",
  bodyMarkdown: body,
  state,
  createdAt: new Date(now).toISOString(),
  updatedAt: new Date(now).toISOString(),
  deletedAt: state === "trashed" ? new Date(now).toISOString() : null,
  purgeAfter:
    state === "trashed" ? new Date(now + CLOUD_TRASH_MS).toISOString() : null,
});
async function request(
  opId: string,
  baseRevision: number,
  snapshot: CloudDraft | null,
) {
  const mutation = {
    version: 1 as const,
    opId,
    noteId: "shared-note",
    baseRevision,
    kind: snapshot ? ("upsert" as const) : ("purge" as const),
    snapshot,
  };
  return {
    version: 1 as const,
    collectionId: scope.collectionId,
    modeGeneration: scope.modeGeneration,
    mutation: { ...mutation, contentHash: await mutationHash(mutation) },
  };
}
async function fixture(
  run: (f: {
    store: SQLiteCloudServerStore;
    service: CloudMutationService;
    fail: { value: boolean };
  }) => Promise<void>,
) {
  const folder = mkdtempSync(join(tmpdir(), "synkies-change-hints-")),
    fail = { value: false },
    store = new SQLiteCloudServerStore(join(folder, "server.sqlite3"), () => {
      if (fail.value) throw Error("synthetic commit failure");
    });
  try {
    await store.seedAccount({
      ...scope,
      status: "active",
      entitlement: "active",
      revision: 1,
      sequence: 0,
      wall: 0,
    });
    await run({
      store,
      service: new CloudMutationService(store, () => now),
      fail,
    });
  } finally {
    await store.close();
    rmSync(folder, { recursive: true, force: true });
  }
}

it("derives body-free immutable hints from actual committed SQLite lifecycle changes without state effects", async () =>
  fixture(async ({ store, service }) => {
    let revision = 0;
    for (const [index, snapshot] of [
      draft("Private original #tag"),
      draft("Private archived #tag", "archived"),
      draft("Private trashed #tag", "trashed"),
      null,
    ].entries()) {
      const result = await service.mutate(
        scope.ownerSubject,
        await request(`life-${index}`, revision, snapshot),
      );
      expect(result.receipt.outcome).toBe("applied");
      revision = result.head.revision;
    }
    const before = await store.changesPage(scope.ownerSubject, 0, 100, 32),
      account = await store.readAccount(scope.ownerSubject),
      reader = createCloudChangeHintReader(scope),
      results = before.changes.map((change) =>
        cloudChangeHintFromChange(scope, change),
      );
    expect(before.changes.map((change) => change.kind)).toEqual([
      "upsert",
      "upsert",
      "upsert",
      "purge",
    ]);
    expect(results.map((hint) => hint.sequence)).toEqual([1, 2, 3, 4]);
    for (const value of results) {
      expect(value.noteId).toBe("shared-note");
      expect(value.kind).toBe("library-changed");
      expect(Object.isFrozen(value)).toBe(true);
      expect(Object.keys(value).sort()).toEqual(
        [
          "version",
          "kind",
          "ownerSubject",
          "collectionId",
          "modeGeneration",
          "sequence",
          "noteId",
        ].sort(),
      );
      expect(reader(value)).toEqual(value);
    }
    expect(JSON.stringify(results)).not.toMatch(
      /Private|bodyMarkdown|#tag|revision|createdAt|expiresAt|opId|contentHash|Saved|Live/,
    );
    expect(await store.changesPage(scope.ownerSubject, 0, 100, 32)).toEqual(
      before,
    );
    expect(await store.readAccount(scope.ownerSubject)).toEqual(account);
  }));

it("does not manufacture fresh change evidence for a replay or conflicting mutation", async () =>
  fixture(async ({ store, service }) => {
    const original = await request("original", 0, draft("Original source")),
      first = await service.mutate(scope.ownerSubject, original),
      before = await store.changesPage(scope.ownerSubject, 0, 100, 32),
      replay = await service.mutate(scope.ownerSubject, original),
      conflict = await service.mutate(
        scope.ownerSubject,
        await request("conflict", 0, draft("Later conflicting private source")),
      );
    expect(first.replayed).toBe(false);
    expect(replay.replayed).toBe(true);
    expect(replay.receipt.sequence).toBe(1);
    expect(conflict.receipt).toMatchObject({
      outcome: "conflict",
      sequence: null,
    });
    const after = await store.changesPage(scope.ownerSubject, 0, 100, 32);
    expect(after.changes).toEqual(before.changes);
    expect(after.changes).toHaveLength(1);
    expect(
      after.changes.map((change) => cloudChangeHintFromChange(scope, change)),
    ).toEqual([{ ...hint(), sequence: 1 }]);
    expect(
      (await store.changesPage(scope.ownerSubject, 1, 100, 32)).changes,
    ).toEqual([]);
  }));

it("has no committed change to publish after an actual transaction rollback", async () =>
  fixture(async ({ store, service, fail }) => {
    fail.value = true;
    await expect(
      service.mutate(
        scope.ownerSubject,
        await request("aborted", 0, draft("Uncommitted source")),
      ),
    ).rejects.toThrow();
    fail.value = false;
    const page = await store.changesPage(scope.ownerSubject, 0, 100, 32);
    expect(page.account?.sequence).toBe(0);
    expect(
      page.changes.map((change) => cloudChangeHintFromChange(scope, change)),
    ).toEqual([]);
  }));

it("captures the expected scope and clones/freeze results without clocks, deduplication or acknowledgement inference", () => {
  const input = { ...scope },
    reader = createCloudChangeHintReader(input),
    packet = hint();
  input.ownerSubject = "later-owner";
  input.collectionId = "later-library";
  input.modeGeneration++;
  const result = reader(packet);
  packet.noteId = "later-note";
  packet.sequence = 9;
  expect(result).toEqual(hint());
  expect(Reflect.set(result, "sequence", 10)).toBe(false);
  expect(Object.isFrozen(result)).toBe(true);
  expect(reader(hint())).toEqual(result);
  expect(reader({ ...hint(), sequence: 2 }).sequence).toBe(2);
  expect(() => reader({ ...hint(), ownerSubject: input.ownerSubject })).toThrow(
    failure,
  );
  expect(() => reader({ ...hint(), collectionId: input.collectionId })).toThrow(
    failure,
  );
  expect(() =>
    reader({ ...hint(), modeGeneration: input.modeGeneration }),
  ).toThrow(failure);
});

const invalid: [string, unknown][] = [
  ["null", null],
  ["array", [hint()]],
  [
    "missing-sequence",
    { ...scope, kind: "library-changed", noteId: "shared-note" },
  ],
  ["version", { ...hint(), version: 2 }],
  ["kind", { ...hint(), kind: "note-ack" }],
  ["zero-sequence", { ...hint(), sequence: 0 }],
  ["fraction-sequence", { ...hint(), sequence: 1.5 }],
  ["unsafe-sequence", { ...hint(), sequence: Number.MAX_SAFE_INTEGER + 1 }],
  ["string-sequence", { ...hint(), sequence: "4" }],
  ["bad-note", { ...hint(), noteId: "../private" }],
  ["bad-owner", { ...hint(), ownerSubject: "../private" }],
  ["bad-generation", { ...hint(), modeGeneration: 0 }],
  ["body", { ...hint(), bodyMarkdown: "private source" }],
  ["title", { ...hint(), title: "private title" }],
  ["tags", { ...hint(), tags: ["private"] }],
  ["token", { ...hint(), csrfToken: "private token" }],
  ["message", { ...hint(), message: "private detail" }],
  ["paid", { ...hint(), paid: true }],
];
it.each(invalid)(
  "refuses %s wire input with a fixed private error",
  (_, input) => {
    expect(() => createCloudChangeHintReader(scope)(input)).toThrow(failure);
  },
);

it("rejects hidden/clone-failing fields and filters scope/change validation exceptions", () => {
  const reader = createCloudChangeHintReader(scope),
    hidden = Object.defineProperty(hint(), "bodyMarkdown", {
      value: "private hidden content",
    });
  expect(() => reader(hidden)).toThrow(failure);
  expect(() =>
    reader({ ...hint(), ownerSubject: () => "private clone failure" }),
  ).toThrow(failure);
  expect(() =>
    createCloudChangeHintReader({
      ...scope,
      ownerSubject: (() => "private scope") as any,
    }),
  ).toThrow(failure);
  expect(() =>
    cloudChangeHintFromChange(scope, {
      ...change,
      bodyMarkdown: "private change",
    } as CloudChange),
  ).toThrow(failure);
  expect(() =>
    cloudChangeHintFromChange(scope, {
      ...change,
      expiresAt: change.createdAt,
    }),
  ).toThrow(failure);
  const input = { ...change },
    expected = { ...scope },
    derived = cloudChangeHintFromChange(expected, input);
  input.noteId = "later-note";
  expected.collectionId = "later-library";
  expect(derived).toEqual(hint());
  expect(Object.isFrozen(derived)).toBe(true);
});
