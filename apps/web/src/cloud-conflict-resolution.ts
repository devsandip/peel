import { validateBody } from "../../../packages/core/src/index";
import {
  DurableCloudClient,
  CloudLocalGenerationChangedError,
  cloudStateInScope,
  validateCloudScope,
  validateCloudNoteId,
  type CloudStateStore,
} from "../../../packages/cloud-protocol/src/durable";
import {
  validateCloudDraft,
  type CloudClientState,
} from "../../../packages/cloud-protocol/src/index";
import {
  applyCloudServerReply,
  planCloudServerReply,
} from "../../../packages/cloud-protocol/src/client-response";
import type {
  CloudMutationRequest,
  CloudServerResult,
} from "../../../packages/cloud-protocol/src/server";
import type { CloudLibraryContext } from "./cloud-cached-library";
import type { CloudMutationSender } from "./cloud-note-upload";
import { projectCloudCachedNote } from "./cloud-note-cache";

export type CloudConflictResolutionChoice =
  | Readonly<{ kind: "local" | "cloud" }>
  | Readonly<{ kind: "merge"; bodyMarkdown: string }>;
export type CloudConflictResolutionView = Readonly<{
  noteId: string;
  generation: number | null;
  status: ReturnType<typeof projectCloudCachedNote>["status"];
  conflict: CloudClientState["conflict"];
  canMerge: boolean;
}>;
export type CloudConflictResolutionKind =
  | "complete"
  | "pending"
  | "conflict"
  | "sign-in-required"
  | "paused"
  | "canceled"
  | "stale"
  | "busy"
  | "new-note-required"
  | "unavailable";
export type CloudConflictResolutionResult = Readonly<{
  kind: CloudConflictResolutionKind;
  view: CloudConflictResolutionView | null;
}>;
export type CloudConflictResolutionGate = <T>(
  noteId: string,
  action: () => Promise<T>,
) => Promise<T>;
export class CloudConflictResolutionError extends Error {
  constructor(readonly kind: CloudConflictResolutionKind) {
    super("Cloud conflict resolution unavailable");
    this.name = "CloudConflictResolutionError";
  }
}
const fail = (kind: CloudConflictResolutionKind = "unavailable"): never => {
  throw new CloudConflictResolutionError(kind);
};
const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
};
function selection(noteId: string, generation?: number) {
  validateCloudNoteId(noteId);
  if (
    /[\r\n]/.test(noteId) ||
    (generation !== undefined &&
      (!Number.isSafeInteger(generation) || generation < 1))
  )
    fail();
}
function choice(input: CloudConflictResolutionChoice) {
  const selected = structuredClone(input);
  if (!selected || typeof selected !== "object" || Array.isArray(selected))
    return fail();
  const keys = selected.kind === "merge" ? ["kind", "bodyMarkdown"] : ["kind"];
  if (
    Reflect.ownKeys(input).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(input, key)) ||
    !["local", "cloud", "merge"].includes(selected.kind)
  )
    return fail();
  if (selected.kind === "merge") validateBody(selected.bodyMarkdown);
  return selected;
}

/** Original-context orchestration only. The authenticated parent supplies the owner gate and sender. */
export class CloudConflictResolutionController {
  private context: CloudLibraryContext;
  private client: DurableCloudClient;
  private send: CloudMutationSender;
  private gate: CloudConflictResolutionGate;
  constructor(
    context: CloudLibraryContext,
    send: CloudMutationSender,
    readonly signal: AbortSignal,
    gate: CloudConflictResolutionGate,
  ) {
    try {
      this.context = Object.freeze({
        store: context.store,
        scope: Object.freeze(validateCloudScope(context.scope)),
      });
      const read = context.store.read.bind(context.store),
        commit = context.store.commit.bind(context.store);
      if (typeof send !== "function" || typeof gate !== "function") fail();
      this.send = send;
      this.gate = gate;
      const store: CloudStateStore = {
        read: async (scope, noteId) => {
          this.active();
          const state = await read(scope, noteId);
          this.active();
          return state === null
            ? null
            : cloudStateInScope(scope, noteId, state);
        },
        commit: (scope, noteId, generation, next) => {
          this.active();
          return commit(scope, noteId, generation, next);
        },
        close: async () => {},
      };
      this.client = new DurableCloudClient(store, this.context.scope);
    } catch {
      throw new CloudConflictResolutionError("unavailable");
    }
  }
  private active() {
    if (this.signal.aborted) fail("canceled");
  }
  private view(
    noteId: string,
    state: CloudClientState | null,
  ): CloudConflictResolutionView {
    const checked =
      state === null
        ? null
        : cloudStateInScope(this.context.scope, noteId, state);
    return deepFreeze({
      noteId,
      generation: checked?.generation ?? null,
      status: projectCloudCachedNote(this.context.scope, noteId, checked)
        .status,
      conflict: checked?.conflict ?? null,
      canMerge:
        !!checked?.conflict?.remote &&
        checked.conflict.local.kind === "upsert" &&
        checked.conflict.local.snapshot.state === "active",
    });
  }
  read = async (noteId: string): Promise<CloudConflictResolutionView> => {
    try {
      this.active();
      selection(noteId);
      const state = await this.client.get(noteId);
      this.active();
      return this.view(noteId, state);
    } catch {
      throw new CloudConflictResolutionError(
        this.signal.aborted ? "canceled" : "unavailable",
      );
    }
  };
  private failure(error: unknown): CloudConflictResolutionResult {
    return Object.freeze({
      kind: this.signal.aborted
        ? "canceled"
        : error instanceof CloudLocalGenerationChangedError
          ? "stale"
          : error instanceof CloudConflictResolutionError
            ? error.kind
            : "unavailable",
      view: null,
    });
  }
  private async observed(
    noteId: string,
    kind?: CloudConflictResolutionKind,
  ): Promise<CloudConflictResolutionResult> {
    const view = await this.read(noteId);
    const actual: CloudConflictResolutionKind =
      view.status === "Conflict"
        ? "conflict"
        : view.status === "Pending upload"
          ? "pending"
          : view.status === "No cached Cloud note"
            ? "unavailable"
            : "complete";
    return Object.freeze({ kind: kind ?? actual, view });
  }
  private async at(noteId: string, generation: number) {
    const state = await this.client.get(noteId);
    this.active();
    if (!state || state.generation !== generation) return fail("stale");
    return state;
  }
  resolve = async (
    noteId: string,
    expectedGeneration: number,
    input: CloudConflictResolutionChoice,
  ): Promise<CloudConflictResolutionResult> => {
    try {
      this.active();
      if (typeof expectedGeneration !== "number") return fail();
      selection(noteId, expectedGeneration);
      const selected = choice(input);
      return await this.gate(noteId, async () => {
        this.active();
        const previous = await this.at(noteId, expectedGeneration);
        if (!previous.conflict) return fail("stale");
        const conflict = previous.conflict;
        if (
          selected.kind !== "cloud" &&
          !conflict.remote &&
          (selected.kind === "merge" || conflict.local.kind !== "purge")
        )
          return fail("new-note-required");
        let action = conflict.local;
        if (selected.kind === "merge") {
          if (
            action.kind !== "upsert" ||
            action.snapshot.state !== "active" ||
            !conflict.remote
          )
            return fail();
          action = {
            kind: "upsert",
            snapshot: validateCloudDraft({
              ...action.snapshot,
              bodyMarkdown: selected.bodyMarkdown,
              updatedAt: new Date().toISOString(),
            }),
          };
        }
        const next = await this.client.resolve(
          noteId,
          expectedGeneration,
          selected.kind === "cloud" ? "remote" : action,
        );
        this.active();
        if (next.pending || next.inFlight)
          return this.push(noteId, next.generation);
        return this.observed(noteId);
      });
    } catch (error) {
      return this.failure(error);
    }
  };
  retry = async (
    noteId: string,
    expectedGeneration: number,
  ): Promise<CloudConflictResolutionResult> => {
    try {
      this.active();
      if (typeof expectedGeneration !== "number") return fail();
      selection(noteId, expectedGeneration);
      return await this.gate(noteId, async () => {
        this.active();
        const state = await this.at(noteId, expectedGeneration);
        if (state.conflict || (!state.pending && !state.inFlight))
          return this.observed(noteId);
        return this.push(noteId, expectedGeneration);
      });
    } catch (error) {
      return this.failure(error);
    }
  };
  private async push(
    noteId: string,
    generation: number,
  ): Promise<CloudConflictResolutionResult> {
    try {
      let state = await this.at(noteId, generation);
      if (state.conflict) return this.observed(noteId);
      if (!state.pending && !state.inFlight) return this.observed(noteId);
      if (!state.inFlight)
        state = await this.client.prepare(
          noteId,
          generation,
          crypto.randomUUID(),
        );
      this.active();
      const expected = state.inFlight!;
      const mutation = await this.client.retry(noteId);
      this.active();
      if (
        mutation.opId !== expected.opId ||
        mutation.contentHash !== expected.contentHash
      )
        return fail("stale");
      const request: CloudMutationRequest = {
        version: 1,
        collectionId: this.context.scope.collectionId,
        modeGeneration: this.context.scope.modeGeneration,
        mutation,
      };
      const reply = await this.send(structuredClone(request), this.signal);
      this.active();
      if (reply.status !== 200 && reply.status !== 409)
        return this.observed(
          noteId,
          reply.status === 401 ? "sign-in-required" : "paused",
        );
      const body = reply.body as CloudServerResult;
      planCloudServerReply(body, request);
      if (
        body.receipt.outcome !== (reply.status === 200 ? "applied" : "conflict")
      )
        return fail();
      const result = await applyCloudServerReply(this.client, request, body);
      this.active();
      return this.observed(
        noteId,
        result.kind === "reconcile-required" ? "paused" : undefined,
      );
    } catch (error) {
      if (
        this.signal.aborted ||
        error instanceof CloudLocalGenerationChangedError ||
        error instanceof CloudConflictResolutionError
      )
        throw error;
      // No automatic retry or assumed rollback after a missing/invalid acknowledgement.
      return this.observed(noteId, "paused");
    }
  }
}
