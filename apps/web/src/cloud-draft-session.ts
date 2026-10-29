import { validateBody } from "../../../packages/core/src/index";
import {
  validateCloudDraft,
  startCloudMutation,
  acknowledgeCloudMutation,
  verifyMutationHash,
  type CloudClientState,
  type CloudDraft,
} from "../../../packages/cloud-protocol/src/index";
import {
  DurableCloudClient,
  CloudLocalGenerationChangedError,
  cloudStateInScope,
  validateCloudNoteId,
  validateCloudScope,
  type CloudScope,
  type CloudStateStore,
} from "../../../packages/cloud-protocol/src/durable";
import { projectCloudCachedNote } from "./cloud-note-cache";

type DraftSnapshot = Readonly<{
  noteId: string;
  bodyMarkdown: string;
  status:
    | ReturnType<typeof projectCloudCachedNote>["status"]
    | "Could not retain draft";
  retained: boolean;
  canEdit: boolean;
  closed: boolean;
  error: string | null;
}>;

const recovery =
  "Could not retain draft. Retry or copy the text before reopening.";
function draftOf(state: CloudClientState) {
  if (
    state.current?.kind !== "upsert" ||
    state.current.snapshot.state !== "active"
  )
    throw Error("Cloud draft unavailable");
  return state.current.snapshot;
}
// Compare validated projection values, independent of serialized property order.
function same(a: CloudDraft, b: CloudDraft) {
  const values = (draft: CloudDraft) => [
    draft.schemaVersion,
    draft.collectionId,
    draft.noteId,
    draft.bodyMarkdown,
    draft.state,
    draft.createdAt,
    draft.updatedAt,
    draft.deletedAt,
    draft.purgeAfter,
    draft.origin?.collectionId,
    draft.origin?.noteId,
    draft.origin?.moveId,
  ];
  return JSON.stringify(values(a)) === JSON.stringify(values(b));
}

// Compare complete validated state without relying on stored object key order.
function stateJSON(state: CloudClientState) {
  return JSON.stringify(state, (_, value) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value).sort(([a], [b]) => a.localeCompare(b)),
        )
      : value,
  );
}

/** Local retention only. The caller owns storage and authenticated composition. */
export class CloudDraftSession {
  private latest: CloudDraft;
  private version = 0;
  private refreshVersion = 0;
  private dirty = false;
  private running: Promise<void> | null = null;
  private closing: Promise<DraftSnapshot> | null = null;
  private closed = false;
  private error: string | null = null;
  private attempted: {
    draft: CloudDraft;
    version: number;
    generation: number | null;
  } | null = null;
  private constructor(
    private client: DurableCloudClient,
    private scope: CloudScope,
    private noteId: string,
    private known: CloudClientState | null,
    initial: CloudDraft,
  ) {
    this.latest = structuredClone(initial);
  }
  static capture(store: CloudStateStore, input: CloudScope) {
    try {
      const scope = validateCloudScope(input),
        noteId = crypto.randomUUID(),
        now = new Date().toISOString(),
        draft = validateCloudDraft({
          schemaVersion: 1,
          collectionId: scope.collectionId,
          noteId,
          bodyMarkdown: "",
          state: "active",
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
          purgeAfter: null,
        });
      return new CloudDraftSession(
        new DurableCloudClient(store, scope),
        scope,
        noteId,
        null,
        draft,
      );
    } catch {
      throw Error("Cloud draft unavailable");
    }
  }
  static async open(store: CloudStateStore, input: CloudScope, noteId: string) {
    try {
      const scope = validateCloudScope(input);
      validateCloudNoteId(noteId);
      const client = new DurableCloudClient(store, scope),
        state = await client.get(noteId);
      if (!state) throw Error("Missing cache");
      const checked = cloudStateInScope(scope, noteId, state);
      draftOf(checked);
      return new CloudDraftSession(
        client,
        scope,
        noteId,
        checked,
        draftOf(checked),
      );
    } catch {
      throw Error("Cloud draft unavailable");
    }
  }
  snapshot(): DraftSnapshot {
    return Object.freeze({
      noteId: this.noteId,
      bodyMarkdown: this.latest.bodyMarkdown,
      status: this.error
        ? ("Could not retain draft" as const)
        : this.dirty
          ? ("Pending upload" as const)
          : this.known
            ? projectCloudCachedNote(this.scope, this.noteId, this.known).status
            : ("Pending upload" as const),
      retained: !this.dirty && !this.running && !this.error,
      canEdit: !this.closing && !this.closed,
      closed: this.closed,
      error: this.error,
    });
  }
  edit(bodyMarkdown: string) {
    if (this.closing || this.closed)
      throw Error("Cloud draft is closing or closed");
    validateBody(bodyMarkdown);
    if (bodyMarkdown === this.latest.bodyMarkdown) return;
    this.latest = {
      ...this.latest,
      bodyMarkdown,
      updatedAt: new Date().toISOString(),
    };
    this.version++;
    this.dirty = true;
    void this.flush().catch(() => {});
  }
  private async read() {
    const state = await this.client.get(this.noteId);
    if (!state) {
      if (this.known) throw Error("Missing cache");
      return null;
    }
    const checked = cloudStateInScope(this.scope, this.noteId, state);
    draftOf(checked);
    return checked;
  }
  private async retain() {
    try {
      do {
        const previous = await this.read();
        if (
          this.attempted &&
          previous &&
          previous.generation > (this.attempted.generation ?? 0) &&
          same(draftOf(previous), this.attempted.draft)
        ) {
          this.known = previous;
          if (this.attempted.version === this.version) this.dirty = false;
          this.attempted = null;
        }
        if (
          previous === null || this.known === null
            ? previous !== this.known
            : !same(draftOf(previous), draftOf(this.known))
        )
          throw Error("Cloud projection changed");
        this.known = previous;
        if (!this.dirty) break;
        const attempt = {
          draft: structuredClone(this.latest),
          version: this.version,
          generation: previous?.generation ?? null,
        };
        this.attempted = attempt;
        let saved: CloudClientState;
        try {
          saved = await this.client.save(
            this.noteId,
            { kind: "upsert", snapshot: attempt.draft },
            attempt.generation,
          );
        } catch (error) {
          if (!(error instanceof CloudLocalGenerationChangedError) || !previous)
            throw error;
          const advanced = await this.read();
          if (
            !advanced ||
            advanced.generation !== previous.generation + 1 ||
            previous.conflict ||
            advanced.conflict
          )
            throw error;
          let expected: CloudClientState;
          if (previous.inFlight) {
            if (!(await verifyMutationHash(previous.inFlight))) throw error;
            const revision = previous.baseRevision + 1;
            expected = acknowledgeCloudMutation(previous, {
              opId: previous.inFlight.opId,
              contentHash: previous.inFlight.contentHash,
              revision,
              snapshot: previous.inFlight.snapshot
                ? { ...previous.inFlight.snapshot, serverRevision: revision }
                : null,
            });
          } else {
            if (!advanced.inFlight || !previous.pending) throw error;
            expected = await startCloudMutation(
              previous,
              advanced.inFlight.opId,
            );
          }
          if (stateJSON(expected) !== stateJSON(advanced)) throw error;
          // One proven preparation/known ACK, never a guessed write outcome.
          // A second race/storage failure is deliberately left for recovery.
          attempt.generation = advanced.generation;
          saved = await this.client.save(
            this.noteId,
            { kind: "upsert", snapshot: attempt.draft },
            attempt.generation,
          );
        }
        this.known = cloudStateInScope(this.scope, this.noteId, saved);
        this.attempted = null;
        if (attempt.version === this.version) this.dirty = false;
      } while (this.dirty);
      this.error = null;
    } catch {
      this.error = recovery;
      throw Error(recovery);
    }
  }
  async flush(): Promise<DraftSnapshot> {
    // An untouched capture has no durable work and must not create an empty row.
    if (!this.known && !this.dirty && !this.attempted) return this.snapshot();
    if (this.running) {
      await this.running;
      return this.dirty ? this.flush() : this.snapshot();
    }
    this.refreshVersion++;
    const task = this.retain();
    this.running = task;
    try {
      await task;
    } finally {
      this.running = null;
    }
    return this.dirty ? this.flush() : this.snapshot();
  }
  async refresh() {
    if (!this.known || this.dirty || this.running || this.closing)
      return this.snapshot();
    const version = ++this.refreshVersion;
    try {
      const state = await this.read();
      if (!state) throw Error("Missing cache");
      if (
        this.dirty ||
        this.running ||
        this.closing ||
        version !== this.refreshVersion ||
        state.generation < this.known.generation
      )
        return this.snapshot();
      if (!same(draftOf(state), draftOf(this.known)))
        throw Error("Cloud projection changed");
      this.known = state;
      this.error = null;
    } catch {
      if (
        !this.dirty &&
        !this.running &&
        !this.closing &&
        version === this.refreshVersion
      )
        this.error = recovery;
    }
    return this.snapshot();
  }
  putAway() {
    if (this.closed) return Promise.resolve(this.snapshot());
    if (this.closing) return this.closing;
    // Start in a microtask so the edit lock exists before any asynchronous work.
    const task = Promise.resolve().then(async () => {
      try {
        await this.flush();
        this.closed = true;
      } finally {
        this.closing = null;
      }
      return this.snapshot();
    });
    this.closing = task;
    return task;
  }
}
