import { describe, expect, it } from "vitest";
import { newNote } from "../../packages/core/src/index";
import {
  acceptRemoteCloudConflict,
  acknowledgeCloudMutation,
  cloudStatus,
  conflictCloudMutation,
  createCloudClient,
  mutationHash,
  resolveCloudConflict,
  retryCloudMutation,
  saveCloudDraft,
  startCloudMutation,
  validateCloudDraft,
  validateCloudSnapshot,
  verifyMutationHash,
  type CloudDraft,
  type CloudResponse,
  type CloudSnapshot,
} from "../../packages/cloud-protocol/src/index";

const collectionId = "synthetic-cloud-library";
const noteId = "synthetic-note";
const now = "2026-10-27T03:00:00.000Z";
const draft = (body: string): CloudDraft => {
  const {
    localRevision: _local,
    serverRevision: _server,
    ...wire
  } = {
    ...newNote(collectionId, body, now),
    noteId,
  };
  return wire;
};
const saved = (body: string, revision: number): CloudSnapshot => ({
  ...draft(body),
  serverRevision: revision,
});
const upsert = (snapshot: CloudDraft) => ({
  kind: "upsert" as const,
  snapshot,
});
const response = (
  state: Awaited<ReturnType<typeof startCloudMutation>>,
  revision: number,
  snapshot: CloudSnapshot | null,
) => ({
  opId: state.inFlight!.opId,
  contentHash: state.inFlight!.contentHash,
  revision,
  snapshot,
});

describe("isolated paid Cloud client conflict contract, AC-09/12/24 partial", () => {
  it("keeps an in-flight operation immutable and rebases a later local edit after acknowledgement", async () => {
    let state = saveCloudDraft(
      createCloudClient(collectionId, noteId),
      upsert(draft("First local café ##work")),
    );
    expect(cloudStatus(state)).toBe("waiting");
    const first = await startCloudMutation(state, "operation-1");
    expect(await verifyMutationHash(first.inFlight!)).toBe(true);
    state = saveCloudDraft(first, upsert(draft("Latest local 原文 ##work")));
    expect(retryCloudMutation(state)).toEqual(first.inFlight);
    expect(retryCloudMutation(JSON.parse(JSON.stringify(state)))).toEqual(
      first.inFlight,
    );
    expect(retryCloudMutation(state).snapshot?.bodyMarkdown).toBe(
      "First local café ##work",
    );
    expect(() =>
      retryCloudMutation(createCloudClient(collectionId, noteId)),
    ).toThrow();
    const afterAck = acknowledgeCloudMutation(
      state,
      response(first, 1, saved("First local café ##work", 1)),
    );
    expect(afterAck.baseRevision).toBe(1);
    expect(afterAck.pending?.snapshot?.bodyMarkdown).toBe(
      "Latest local 原文 ##work",
    );
    expect(afterAck.current?.snapshot?.bodyMarkdown).toBe(
      "Latest local 原文 ##work",
    );
    expect(cloudStatus(afterAck)).toBe("waiting");
    const second = await startCloudMutation(afterAck, "operation-2");
    expect(second.inFlight?.baseRevision).toBe(1);
    expect(second.inFlight?.snapshot?.bodyMarkdown).toBe(
      "Latest local 原文 ##work",
    );
    expect(first.inFlight?.contentHash).not.toBe(second.inFlight?.contentHash);
    const complete = acknowledgeCloudMutation(
      second,
      response(second, 2, saved("Latest local 原文 ##work", 2)),
    );
    expect(cloudStatus(complete)).toBe("synced");
    expect(complete.current?.snapshot?.bodyMarkdown).toBe(
      "Latest local 原文 ##work",
    );
  });

  it("preserves the newest local branch through repeated 409s until explicit resolution", async () => {
    let state = createCloudClient(
      collectionId,
      noteId,
      saved("Shared base", 1),
    );
    state = saveCloudDraft(state, upsert(draft("Offline local")));
    const sent = await startCloudMutation(state, "operation-3");
    state = saveCloudDraft(sent, upsert(draft("Later offline local")));
    state = conflictCloudMutation(
      state,
      response(sent, 2, saved("Remote edit", 2)),
    );
    expect(cloudStatus(state)).toBe("conflict");
    expect(state.conflict?.local.snapshot?.bodyMarkdown).toBe(
      "Later offline local",
    );
    expect(state.conflict?.remote?.bodyMarkdown).toBe("Remote edit");
    state = saveCloudDraft(state, upsert(draft("Edited conflict branch")));
    expect(state.conflict?.local.snapshot?.bodyMarkdown).toBe(
      "Edited conflict branch",
    );
    await expect(startCloudMutation(state, "operation-4")).rejects.toThrow(
      "Resolve Cloud conflict",
    );
    state = resolveCloudConflict(
      state,
      upsert(draft("Merged local and remote")),
    );
    const merged = await startCloudMutation(state, "operation-4");
    expect(merged.inFlight?.baseRevision).toBe(2);
    state = conflictCloudMutation(
      merged,
      response(merged, 3, saved("Second remote edit", 3)),
    );
    expect(state.conflict?.local.snapshot?.bodyMarkdown).toBe(
      "Merged local and remote",
    );
    expect(state.conflict?.remote?.bodyMarkdown).toBe("Second remote edit");
    const accepted = acceptRemoteCloudConflict(state);
    expect(cloudStatus(accepted)).toBe("synced");
    expect(accepted.current?.snapshot?.bodyMarkdown).toBe("Second remote edit");
  });

  it("requires a new identity after a remote permanent purge", async () => {
    let state = createCloudClient(
      collectionId,
      noteId,
      saved("Recoverable", 5),
    );
    state = saveCloudDraft(state, upsert(draft("Offline after purge")));
    const pending = await startCloudMutation(state, "operation-5");
    const conflicted = conflictCloudMutation(
      pending,
      response(pending, 6, null),
    );
    expect(() =>
      resolveCloudConflict(
        conflicted,
        upsert(draft("Would resurrect old identity")),
      ),
    ).toThrow("new note ID");
    const accepted = acceptRemoteCloudConflict(conflicted);
    expect(accepted.current).toEqual({ kind: "purge", snapshot: null });
    expect(accepted.baseRevision).toBe(6);
    expect(
      resolveCloudConflict(conflicted, { kind: "purge", snapshot: null }),
    ).toEqual(accepted);
    expect(() =>
      saveCloudDraft(accepted, upsert(draft("Old identity again"))),
    ).toThrow("new note ID");
  });

  it("keeps purge separate and rejects mismatched acknowledgements", async () => {
    let state = createCloudClient(collectionId, noteId, saved("To purge", 3));
    state = saveCloudDraft(state, { kind: "purge", snapshot: null });
    expect(() =>
      saveCloudDraft(state, upsert(draft("After permanent deletion"))),
    ).toThrow("new note ID");
    const pending = await startCloudMutation(state, "operation-6");
    expect(() =>
      saveCloudDraft(pending, upsert(draft("While deletion is in flight"))),
    ).toThrow("new note ID");
    const retry = retryCloudMutation(pending);
    expect(retry.kind).toBe("purge");
    expect(retry.snapshot).toBeNull();
    expect(await verifyMutationHash(retry)).toBe(true);
    expect(() =>
      acknowledgeCloudMutation(pending, {
        ...response(pending, 4, null),
        opId: "wrong-operation",
      }),
    ).toThrow("Unmatched");
    const extraResponse = {
      ...response(pending, 4, null),
      unexpected: true,
    } as CloudResponse & { unexpected: boolean };
    expect(() => acknowledgeCloudMutation(pending, extraResponse)).toThrow(
      "fields",
    );
    expect(() =>
      acknowledgeCloudMutation(pending, response(pending, 5, null)),
    ).toThrow("Unexpected Cloud acknowledgement");
    expect(() =>
      acknowledgeCloudMutation(
        pending,
        response(pending, 4, saved("Wrong kind", 4)),
      ),
    ).toThrow("Unexpected Cloud acknowledgement");
    const complete = acknowledgeCloudMutation(
      pending,
      response(pending, 4, null),
    );
    expect(cloudStatus(complete)).toBe("synced");
    expect(complete.current).toEqual({ kind: "purge", snapshot: null });
  });

  it("rejects foreign identities, unknown fields and invalid hashes before cloud mutation", async () => {
    expect(() =>
      validateCloudDraft({ ...draft("Valid"), localRevision: 9 } as CloudDraft),
    ).toThrow("fields");
    expect(() =>
      validateCloudSnapshot({ ...saved("Valid", 1), serverRevision: 0 }),
    ).toThrow("revision");
    expect(() =>
      saveCloudDraft(
        createCloudClient(collectionId, noteId),
        upsert({ ...draft("Foreign"), noteId: "another-note" }),
      ),
    ).toThrow("another note");
    expect(() => validateCloudDraft(draft("é".repeat(131073)))).toThrow(
      "256 KiB",
    );
    const payload = {
      version: 1 as const,
      opId: "operation-7",
      noteId,
      baseRevision: 0,
      kind: "upsert" as const,
      snapshot: draft("Hash-bound"),
    };
    const hash = await mutationHash(payload);
    expect(await verifyMutationHash({ ...payload, contentHash: hash })).toBe(
      true,
    );
    expect(
      await verifyMutationHash({
        ...payload,
        snapshot: draft("Tampered"),
        contentHash: hash,
      }),
    ).toBe(false);
    expect(
      await verifyMutationHash({
        ...payload,
        contentHash: hash,
        unexpected: "hidden",
      } as typeof payload & { contentHash: string }),
    ).toBe(false);
  });
});
