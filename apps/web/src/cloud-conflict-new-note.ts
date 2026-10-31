import { byteLength, validateBody } from "../../../packages/core/src/index";
import {
  CloudLocalGenerationChangedError,
  cloudStateInScope,
  cloudStateWrite,
  validateCloudNoteId,
  validateCloudScope,
  type CloudScope,
  type CloudStateStore,
} from "../../../packages/cloud-protocol/src/durable";
import {
  createCloudClient,
  saveCloudDraft,
  validateCloudDraft,
  type CloudClientState,
  type CloudDraft,
} from "../../../packages/cloud-protocol/src/index";
import type { CloudLibraryContext } from "./cloud-cached-library";
import {
  CloudConflictResolutionError,
  type CloudConflictResolutionGate,
} from "./cloud-conflict-resolution";

export type CloudConflictNewNoteFailureKind =
  "busy" | "stale" | "not-recoverable" | "unavailable" | "canceled";

export type CloudConflictNewNoteKind =
  "retained" | CloudConflictNewNoteFailureKind;

export type CloudConflictNewNoteResult =
  | Readonly<{ kind: "retained"; newNoteId: string }>
  | Readonly<{ kind: CloudConflictNewNoteFailureKind; newNoteId: null }>;

type RecoveryAttempt = Readonly<{
  expectedGeneration: number;
  newNoteId: string;
  createdAt: string;
  updatedAt: string;
  bodyBytes: number;
  commitStarted: boolean;
}>;

class CloudConflictNewNoteError extends Error {
  constructor(readonly kind: CloudConflictNewNoteFailureKind) {
    super("Cloud conflict new-note recovery unavailable");
    this.name = "CloudConflictNewNoteError";
  }
}

function fail(kind: CloudConflictNewNoteFailureKind = "unavailable"): never {
  throw new CloudConflictNewNoteError(kind);
}

type OwnDataResult = { ok: true; value: unknown } | { ok: false };

function ownDataProperty(target: object, key: string): OwnDataResult {
  const descriptor = Object.getOwnPropertyDescriptor(target, key);
  if (!descriptor) {
    return { ok: true, value: undefined };
  }
  if (!descriptor.enumerable || !("value" in descriptor)) {
    return { ok: false };
  }
  return { ok: true, value: descriptor.value };
}

function isAbortSignalLike(input: unknown): input is AbortSignal {
  if (typeof AbortSignal === "function" && input instanceof AbortSignal) {
    return true;
  }
  if (!input || typeof input !== "object") {
    return false;
  }
  const candidate = input as AbortSignal;
  return (
    typeof candidate.aborted === "boolean" &&
    typeof candidate.addEventListener === "function" &&
    typeof candidate.removeEventListener === "function"
  );
}

function normalizeValue(_key: string, value: unknown): unknown {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const entries = Object.entries(value);
    entries.sort(([a], [b]) => a.localeCompare(b));
    return Object.fromEntries(entries);
  }
  return value;
}

// Compare complete validated state without relying on stored object key order.
function stateJSON(state: CloudClientState): string {
  return JSON.stringify(state, normalizeValue);
}

function validateSelection(
  sourceNoteId: string,
  expectedGeneration: number,
): void {
  validateCloudNoteId(sourceNoteId);
  if (
    /[\r\n]/.test(sourceNoteId) ||
    typeof expectedGeneration !== "number" ||
    !Number.isSafeInteger(expectedGeneration) ||
    expectedGeneration < 1
  ) {
    fail("unavailable");
  }
}

function purgedConflictSnapshot(state: CloudClientState): CloudDraft | null {
  const conflict = state.conflict;
  if (
    !conflict ||
    conflict.remote !== null ||
    !Number.isSafeInteger(conflict.remoteRevision) ||
    conflict.remoteRevision < 1 ||
    conflict.local.kind !== "upsert" ||
    !conflict.local.snapshot
  ) {
    return null;
  }
  return conflict.local.snapshot;
}

/** Local new-ID preparation for an observed Cloud permanent-purge conflict. */
export class CloudConflictNewNoteRecovery {
  private readonly scope: Readonly<CloudScope>;
  private readonly readState: CloudStateStore["read"];
  private readonly commitState: CloudStateStore["commit"];
  private readonly gate: CloudConflictResolutionGate;
  private readonly allocateId: () => string;
  private readonly inProgress = new Set<string>();
  private readonly attempts = new Map<string, RecoveryAttempt>();
  readonly signal: AbortSignal;

  constructor(
    context: CloudLibraryContext,
    signal: AbortSignal,
    gate: CloudConflictResolutionGate,
    allocateId?: () => string,
  ) {
    try {
      if (!context || typeof context !== "object" || Array.isArray(context)) {
        fail();
      }
      const storeProp = ownDataProperty(context, "store");
      const scopeProp = ownDataProperty(context, "scope");
      if (!storeProp.ok || !scopeProp.ok) {
        fail();
      }
      const store = storeProp.value as CloudStateStore;
      if (
        !store ||
        typeof store !== "object" ||
        Array.isArray(store) ||
        typeof store.read !== "function" ||
        typeof store.commit !== "function" ||
        !isAbortSignalLike(signal) ||
        typeof gate !== "function"
      ) {
        fail();
      }
      let allocator = allocateId;
      if (allocator === undefined || allocator === crypto.randomUUID) {
        allocator = () => crypto.randomUUID();
      }
      if (typeof allocator !== "function") {
        fail();
      }
      const checkedScope = validateCloudScope(scopeProp.value as CloudScope);
      this.scope = Object.freeze(checkedScope);
      this.readState = store.read.bind(store);
      this.commitState = store.commit.bind(store);
      this.signal = signal;
      this.gate = gate;
      this.allocateId = allocator;
      if (!signal.aborted) {
        signal.addEventListener(
          "abort",
          () => {
            this.attempts.clear();
          },
          { once: true },
        );
      }
    } catch {
      throw new CloudConflictNewNoteError("unavailable");
    }
  }

  private active(): void {
    if (this.signal.aborted) {
      fail("canceled");
    }
  }

  private ensureExpectedGeneration(
    actualGeneration: number,
    expectedGeneration: number,
  ): void {
    if (actualGeneration !== expectedGeneration) {
      fail("stale");
    }
  }

  private async readScoped(noteId: string): Promise<CloudClientState | null> {
    this.active();
    const raw = await this.readState(this.scope, noteId);
    this.active();
    if (raw === null) {
      return null;
    }
    return cloudStateInScope(this.scope, noteId, raw);
  }

  private async readRecoverableSource(
    sourceNoteId: string,
    expectedGeneration: number,
  ): Promise<CloudDraft> {
    const state = await this.readScoped(sourceNoteId);
    if (state === null) {
      fail("not-recoverable");
    }
    this.ensureExpectedGeneration(state.generation, expectedGeneration);
    const snapshot = purgedConflictSnapshot(state);
    if (!snapshot) {
      fail("not-recoverable");
    }
    validateBody(snapshot.bodyMarkdown);
    return snapshot;
  }

  private async guardSourceBeforeCommit(
    sourceNoteId: string,
    expectedGeneration: number,
  ): Promise<void> {
    this.active();
    const latest = await this.readScoped(sourceNoteId);
    if (latest === null) {
      this.attempts.delete(sourceNoteId);
      fail("stale");
    }
    if (latest.generation !== expectedGeneration) {
      this.attempts.delete(sourceNoteId);
      this.ensureExpectedGeneration(latest.generation, expectedGeneration);
    }
    if (!purgedConflictSnapshot(latest)) {
      this.attempts.delete(sourceNoteId);
      fail("stale");
    }
  }

  private buildIntendedState(
    attempt: RecoveryAttempt,
    bodyMarkdown: string,
  ): CloudClientState {
    const draft = validateCloudDraft({
      schemaVersion: 1,
      collectionId: this.scope.collectionId,
      noteId: attempt.newNoteId,
      bodyMarkdown,
      state: "active",
      createdAt: attempt.createdAt,
      updatedAt: attempt.updatedAt,
      deletedAt: null,
      purgeAfter: null,
    });
    const created = createCloudClient(
      this.scope.collectionId,
      attempt.newNoteId,
    );
    const saved = saveCloudDraft(created, { kind: "upsert", snapshot: draft });
    return cloudStateWrite(this.scope, attempt.newNoteId, null, saved);
  }

  private resolveAttempt(
    sourceNoteId: string,
    expectedGeneration: number,
    bodyBytes: number,
  ): RecoveryAttempt {
    const existing = this.attempts.get(sourceNoteId);
    if (
      existing &&
      existing.expectedGeneration === expectedGeneration &&
      existing.bodyBytes === bodyBytes
    ) {
      return existing;
    }
    this.attempts.delete(sourceNoteId);
    const allocateId = this.allocateId;
    const allocated = allocateId();
    if (typeof allocated !== "string" || /[\r\n]/.test(allocated)) {
      fail("unavailable");
    }
    validateCloudNoteId(allocated);
    if (allocated === sourceNoteId) {
      fail("unavailable");
    }
    const now = new Date().toISOString();
    const fresh: RecoveryAttempt = Object.freeze({
      expectedGeneration,
      newNoteId: allocated,
      createdAt: now,
      updatedAt: now,
      bodyBytes,
      commitStarted: false,
    });
    this.attempts.set(sourceNoteId, fresh);
    return fresh;
  }

  private failure(error: unknown): CloudConflictNewNoteResult {
    if (this.signal.aborted) {
      return Object.freeze({ kind: "canceled", newNoteId: null });
    }
    if (error instanceof CloudConflictNewNoteError) {
      return Object.freeze({ kind: error.kind, newNoteId: null });
    }
    if (error instanceof CloudLocalGenerationChangedError) {
      return Object.freeze({ kind: "stale", newNoteId: null });
    }
    if (error instanceof CloudConflictResolutionError) {
      if (
        error.kind === "busy" ||
        error.kind === "canceled" ||
        error.kind === "stale"
      ) {
        return Object.freeze({ kind: error.kind, newNoteId: null });
      }
      return Object.freeze({ kind: "unavailable", newNoteId: null });
    }
    return Object.freeze({ kind: "unavailable", newNoteId: null });
  }

  prepare = async (
    sourceNoteId: string,
    expectedGeneration: number,
  ): Promise<CloudConflictNewNoteResult> => {
    try {
      this.active();
      validateSelection(sourceNoteId, expectedGeneration);
      if (this.inProgress.has(sourceNoteId)) {
        fail("busy");
      }
      this.inProgress.add(sourceNoteId);
      try {
        const gate = this.gate;
        return await gate(sourceNoteId, async (lease) => {
          this.active();
          if (
            !lease ||
            typeof lease.retire !== "function" ||
            typeof lease.changed !== "function"
          ) {
            fail("unavailable");
          }
          const snapshot = await this.readRecoverableSource(
            sourceNoteId,
            expectedGeneration,
          );
          lease.retire();
          this.active();
          const bodyMarkdown = snapshot.bodyMarkdown;
          const attempt = this.resolveAttempt(
            sourceNoteId,
            expectedGeneration,
            byteLength(bodyMarkdown),
          );
          const intended = this.buildIntendedState(attempt, bodyMarkdown);
          this.active();
          const rawDest = await this.readState(this.scope, attempt.newNoteId);
          this.active();
          if (rawDest !== null) {
            if (!attempt.commitStarted) {
              this.attempts.delete(sourceNoteId);
              fail("unavailable");
            }
            const existingDest = cloudStateInScope(
              this.scope,
              attempt.newNoteId,
              rawDest,
            );
            if (stateJSON(existingDest) !== stateJSON(intended)) {
              fail("unavailable");
            }
            this.attempts.delete(sourceNoteId);
            try {
              lease.changed();
            } catch {
              /* Catalog observers cannot alter durable retention. */
            }
            return Object.freeze({
              kind: "retained",
              newNoteId: attempt.newNoteId,
            });
          }
          await this.guardSourceBeforeCommit(sourceNoteId, expectedGeneration);
          this.active();
          this.attempts.set(
            sourceNoteId,
            Object.freeze({ ...attempt, commitStarted: true }),
          );
          const committed = await this.commitState(
            this.scope,
            attempt.newNoteId,
            null,
            structuredClone(intended),
          );
          if (committed === false) {
            this.attempts.delete(sourceNoteId);
            fail("unavailable");
          }
          if (committed !== true) {
            fail("unavailable");
          }
          this.attempts.delete(sourceNoteId);
          this.active();
          try {
            lease.changed();
          } catch {
            /* Catalog observers cannot alter durable retention. */
          }
          return Object.freeze({
            kind: "retained",
            newNoteId: attempt.newNoteId,
          });
        });
      } finally {
        this.inProgress.delete(sourceNoteId);
      }
    } catch (error) {
      return this.failure(error);
    }
  };
}
