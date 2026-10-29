import { CloudDraftSession } from "./cloud-draft-session";
import {
  DurableCloudClient,
  validateCloudScope,
  type CloudScope,
  type CloudStateStore,
} from "../../../packages/cloud-protocol/src/durable";
import {
  applyCloudServerReply,
  planCloudServerReply,
} from "../../../packages/cloud-protocol/src/client-response";
import type {
  CloudMutationRequest,
  CloudServerResult,
} from "../../../packages/cloud-protocol/src/server";

// The authenticated caller owns request deadlines/size limits and credentials.
// Never implement this by looking up a later global account or trusting scope as auth.
export type CloudMutationSender = (
  request: CloudMutationRequest,
  signal: AbortSignal,
) => Promise<{ status: number; body: unknown }>;
type UploadSnapshot = Readonly<{
  kind:
    | "idle"
    | "uploading"
    | "sign-in-required"
    | "paused"
    | "conflict"
    | "canceled";
  message: string | null;
}>;

/** Owns one note in one authenticated context; never opens or closes storage. */
export class CloudNoteUpload {
  private client: DurableCloudClient;
  private task: Promise<UploadSnapshot> | null = null;
  private reopening: Promise<CloudNoteUpload> | null = null;
  private queued = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private clearScheduled = () => {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.signal.removeEventListener("abort", this.clearScheduled);
  };
  private view: UploadSnapshot = Object.freeze({ kind: "idle", message: null });
  private listeners = new Set<() => void>();
  private constructor(
    private currentSession: CloudDraftSession,
    private store: CloudStateStore,
    private scope: CloudScope,
    private send: CloudMutationSender,
    private signal: AbortSignal,
  ) {
    // An abort during a read must also prevent the following ACK commit.
    this.client = new DurableCloudClient(
      {
        read: (...args) => store.read(...args),
        commit: (...args) => {
          signal.throwIfAborted();
          return store.commit(...args);
        },
        close: async () => {},
      },
      scope,
    );
  }
  static capture(
    store: CloudStateStore,
    input: CloudScope,
    send: CloudMutationSender,
    signal: AbortSignal,
  ) {
    const scope = validateCloudScope(input);
    return new CloudNoteUpload(
      CloudDraftSession.capture(store, scope),
      store,
      scope,
      send,
      signal,
    );
  }
  static async open(
    store: CloudStateStore,
    input: CloudScope,
    noteId: string,
    send: CloudMutationSender,
    signal: AbortSignal,
  ) {
    const scope = validateCloudScope(input),
      session = await CloudDraftSession.open(store, scope, noteId);
    return new CloudNoteUpload(session, store, scope, send, signal);
  }
  get session() {
    return this.currentSession;
  }
  /** The parent has closed its prior view; retain this owner and any pending reply. */
  reopen(): Promise<CloudNoteUpload> {
    if (this.reopening) return this.reopening;
    const closed = this.currentSession;
    if (this.signal.aborted || !closed.snapshot().closed)
      return Promise.reject(Error("Could not reopen Cloud note"));
    const task = Promise.resolve()
      .then(async () => {
        this.signal.throwIfAborted();
        const session = await CloudDraftSession.open(
          this.store,
          this.scope,
          closed.snapshot().noteId,
        );
        this.signal.throwIfAborted();
        if (this.currentSession !== closed)
          throw Error("Could not reopen Cloud note");
        this.currentSession = session;
        // Notify still-mounted views of the new editing session without changing pause state.
        this.publish(this.view.kind, this.view.message);
        return this;
      })
      .catch(() => {
        throw Error("Could not reopen Cloud note");
      })
      .finally(() => {
        this.reopening = null;
      });
    this.reopening = task;
    return task;
  }
  snapshot() {
    return this.view;
  }
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private publish(kind: UploadSnapshot["kind"], message: string | null = null) {
    if (kind !== "idle" && kind !== "uploading") this.clearScheduled();
    this.view = Object.freeze({ kind, message });
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        /* Observers cannot change upload correctness. */
      }
    }
  }
  /** Fixed windows batch typing without postponing continuous edits indefinitely. */
  schedule() {
    if (
      this.timer !== null ||
      this.signal.aborted ||
      (this.view.kind !== "idle" && this.view.kind !== "uploading")
    )
      return;
    this.signal.addEventListener("abort", this.clearScheduled, { once: true });
    this.timer = setTimeout(() => {
      this.clearScheduled();
      if (this.view.kind === "idle" || this.view.kind === "uploading")
        void this.upload();
    }, 200);
  }
  upload(): Promise<UploadSnapshot> {
    this.clearScheduled();
    if (this.task) {
      this.queued = true;
      return this.task;
    }
    this.queued = false;
    const task = Promise.resolve()
      .then(async () => {
        try {
          await this.session.flush();
          this.signal.throwIfAborted();
          const noteId = this.session.snapshot().noteId,
            state = await this.client.get(noteId);
          if (state?.conflict) {
            this.publish("conflict");
            return this.view;
          }
          if (!state || (!state.pending && !state.inFlight)) {
            this.publish("idle");
            return this.view;
          }
          if (!state.inFlight) {
            try {
              await this.client.prepare(
                noteId,
                state.generation,
                crypto.randomUUID(),
              );
            } catch (error) {
              this.signal.throwIfAborted();
              const current = await this.client.get(noteId);
              // Concurrent retained typing can invalidate asynchronous hashing.
              // Reobserve actual progress in a new window, never resend a failed request.
              if (
                current &&
                current.generation > state.generation &&
                !current.conflict
              ) {
                this.queued = true;
                this.publish("idle");
                return this.view;
              }
              throw error;
            }
          }
          const request: CloudMutationRequest = {
            version: 1,
            collectionId: this.scope.collectionId,
            modeGeneration: this.scope.modeGeneration,
            mutation: await this.client.retry(noteId),
          };
          this.signal.throwIfAborted();
          this.publish("uploading");
          this.signal.throwIfAborted();
          const reply = await this.send(structuredClone(request), this.signal);
          this.signal.throwIfAborted();
          if (reply.status !== 200 && reply.status !== 409) {
            this.publish(
              reply.status === 401 ? "sign-in-required" : "paused",
              reply.status === 401
                ? "Sign in again. Your pending draft remains on this device."
                : "Cloud sync is paused. Your pending draft remains on this device.",
            );
            return this.view;
          }
          const body = reply.body as CloudServerResult;
          planCloudServerReply(body, request);
          if (
            body.receipt.outcome !==
            (reply.status === 200 ? "applied" : "conflict")
          )
            throw Error("Cloud reply status mismatch");
          this.signal.throwIfAborted();
          const result = await applyCloudServerReply(
            this.client,
            request,
            body,
          );
          await this.session.refresh();
          if (this.session.snapshot().error) {
            this.publish("paused");
          } else if (result.kind === "reconcile-required") {
            this.publish(
              "paused",
              "Cloud sync needs reconciliation. Your draft remains on this device.",
            );
          } else if (result.kind === "conflict" || result.state.conflict) {
            this.publish("conflict");
          } else {
            this.queued ||= !!(await this.client.get(noteId))?.pending;
            this.publish("idle");
          }
        } catch {
          this.publish(
            this.signal.aborted ? "canceled" : "paused",
            this.signal.aborted || this.session.snapshot().error
              ? null
              : "Could not upload. Your pending draft remains on this device.",
          );
        }
        return this.view;
      })
      .finally(() => {
        this.task = null;
        const again =
          this.queued && this.view.kind === "idle" && !this.signal.aborted;
        this.queued = false;
        if (again) this.schedule();
      });
    this.task = task;
    return task;
  }
}
