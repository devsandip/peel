import {
  validateCloudScope,
  type CloudScope,
} from "../../../packages/cloud-protocol/src/durable";
import {
  DurableCloudPull,
  validatePullProgress,
  type CloudPullStateStore,
  type CloudPullProgress,
} from "../../../packages/cloud-protocol/src/pull-local";
import { createCloudChangeHintReader } from "../../../packages/cloud-protocol/src/change-hints";
import {
  cloudScopeHash,
  validatePullStart,
  type CloudPullPage,
  type CloudPullStart,
  type PullLocation,
  type PullScope,
} from "../../../packages/cloud-protocol/src/pull";

export type CloudDownloadRequest =
  | { kind: "bootstrap"; scope: PullScope }
  | { kind: "resume"; checkpoint: string }
  | { kind: "page"; location: PullLocation };
// The authenticated parent binds origin/credentials, deadlines and wire-size limits.
// Scope and cached progress are not authentication or paid entitlement.
export type CloudDownloadSender = (
  request: CloudDownloadRequest,
  signal: AbortSignal,
) => Promise<{ status: number; body: unknown }>;
type DownloadSnapshot = Readonly<{
  kind:
    | "idle"
    | "downloading"
    | "more"
    | "complete"
    | "sign-in-required"
    | "snapshot-required"
    | "paused"
    | "canceled";
  pages: number;
  message: string | null;
}>;
export const CLOUD_DOWNLOAD_PASS_PAGES = 8;

/** One captured account context; never opens storage or activates Cloud. */
export class CloudLibraryDownload {
  private scope: CloudScope;
  private pull: DurableCloudPull;
  private readHint: ReturnType<typeof createCloudChangeHintReader>;
  private hintTarget = 0;
  private hintRound: { roundId: string; target: number } | null = null;
  private task: Promise<DownloadSnapshot> | null = null;
  private view: DownloadSnapshot = Object.freeze({
    kind: "idle",
    pages: 0,
    message: null,
  });
  private listeners = new Set<() => void>();
  constructor(
    store: CloudPullStateStore,
    input: CloudScope,
    private send: CloudDownloadSender,
    private signal: AbortSignal,
  ) {
    this.scope = validateCloudScope(input);
    this.readHint = createCloudChangeHintReader(this.scope);
    this.pull = new DurableCloudPull(
      {
        read: (...args) => store.read(...args),
        commit: (...args) => {
          signal.throwIfAborted();
          return store.commit(...args);
        },
        readPull: (...args) => store.readPull(...args),
        commitPull: (...args) => {
          signal.throwIfAborted();
          return store.commitPull(...args);
        },
        close: async () => {},
      },
      this.scope,
    );
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
  private publish(
    kind: DownloadSnapshot["kind"],
    pages: number,
    message: string | null = null,
  ) {
    this.view = Object.freeze({ kind, pages, message });
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        /* Observers cannot affect download correctness. */
      }
    }
  }
  /** Continue an interrupted round or catch up from this store's checkpoint. */
  download() {
    return this.run(false);
  }
  /** Explicit recovery only; a new snapshot never erases retained local drafts. */
  restartSnapshot() {
    return this.run(true);
  }
  /** One explicit bounded pass. A notification is not an acknowledgement or live grant. */
  acceptHint(raw: unknown): Promise<DownloadSnapshot> {
    try {
      this.signal.throwIfAborted();
      const hint = this.readHint(raw);
      this.signal.throwIfAborted();
      this.hintTarget = Math.max(this.hintTarget, hint.sequence);
      return this.run(false, true);
    } catch {
      return Promise.reject(Error("Cloud change hint unavailable"));
    }
  }
  private finish(progress: CloudPullProgress, pages: number) {
    const more = () =>
      this.publish(
        "more",
        pages,
        "Another Cloud catch-up pass is needed. Showing cached notes.",
      );
    if (progress.next) {
      this.publish(
        "more",
        pages,
        "More Cloud notes remain to download. Showing cached notes.",
      );
    } else if (this.hintTarget > progress.throughSequence) {
      const started =
        this.hintRound?.roundId === progress.roundId
          ? this.hintRound.target
          : 0;
      if (started > progress.throughSequence) {
        // Invalidate only the target this fresh round disproved; keep newer arrivals.
        if (this.hintTarget <= started) this.hintTarget = 0;
        this.hintRound = null;
        this.publish(
          "paused",
          pages,
          "Could not verify the Cloud notification. Your cached notes and drafts remain on this device.",
        );
      } else more();
    } else {
      this.hintTarget = 0;
      this.publish(
        "complete",
        pages,
        "Last Cloud download complete. Pending drafts still need their own confirmation.",
      );
      // Observers can deliver a new hint synchronously during completion publication.
      if (this.hintTarget > progress.throughSequence) more();
      else this.hintTarget = 0;
    }
  }
  private run(restart: boolean, hintOnly = false): Promise<DownloadSnapshot> {
    if (this.task) return this.task;
    let completedThrough: number | null = null;
    const task = Promise.resolve()
      .then(async () => {
        let pages = 0;
        try {
          this.signal.throwIfAborted();
          this.publish("downloading", pages);
          this.signal.throwIfAborted();
          const stored = await this.pull.progress();
          let progress = stored === null ? null : validatePullProgress(stored);
          const hash = await cloudScopeHash(this.scope);
          this.signal.throwIfAborted();
          if (progress && progress.scopeHash !== hash)
            throw Error("Foreign cached download");
          if (
            hintOnly &&
            !restart &&
            progress &&
            !progress.next &&
            progress.checkpoint &&
            progress.throughSequence >= this.hintTarget
          ) {
            completedThrough = progress.throughSequence;
            this.finish(progress, pages);
            this.signal.throwIfAborted();
            return this.view;
          }
          const request = async (input: CloudDownloadRequest) => {
            this.signal.throwIfAborted();
            const reply = await this.send(structuredClone(input), this.signal);
            this.signal.throwIfAborted();
            if (reply.status !== 200) {
              this.publish(
                reply.status === 401
                  ? "sign-in-required"
                  : reply.status === 410
                    ? "snapshot-required"
                    : "paused",
                pages,
                reply.status === 401
                  ? "Sign in again to download. Your cached notes and drafts remain on this device."
                  : reply.status === 410
                    ? "A new Cloud snapshot is required. Your cached notes and drafts remain on this device."
                    : "Cloud download is paused. Your cached notes and drafts remain on this device.",
              );
              return null;
            }
            return reply;
          };
          if (restart || !progress || !progress.next) {
            const initial: CloudDownloadRequest =
              !restart && progress?.checkpoint
                ? { kind: "resume", checkpoint: progress.checkpoint }
                : {
                    kind: "bootstrap",
                    scope: {
                      version: 1,
                      collectionId: this.scope.collectionId,
                      modeGeneration: this.scope.modeGeneration,
                    },
                  };
            const target = this.hintTarget;
            const reply = await request(initial);
            if (!reply) return this.view;
            const start = validatePullStart(reply.body as CloudPullStart);
            if (
              start.kind !==
              (initial.kind === "bootstrap" ? "bootstrap" : "changes")
            )
              throw Error("Unexpected Cloud download round");
            this.signal.throwIfAborted();
            progress = await this.pull.begin(
              start,
              progress?.generation ?? null,
            );
            this.signal.throwIfAborted();
            this.hintRound = { roundId: progress.roundId, target };
          }
          while (progress.next && pages < CLOUD_DOWNLOAD_PASS_PAGES) {
            const reply = await request({
              kind: "page",
              location: progress.next,
            });
            if (!reply) return this.view;
            const result = await this.pull.apply(reply.body as CloudPullPage);
            this.signal.throwIfAborted();
            if (result.kind === "stale") throw Error("Cloud round changed");
            progress = result.progress;
            pages++;
            this.publish("downloading", pages);
            this.signal.throwIfAborted();
          }
          this.signal.throwIfAborted();
          if (!progress.next) completedThrough = progress.throughSequence;
          this.finish(progress, pages);
          this.signal.throwIfAborted();
        } catch {
          this.publish(
            this.signal.aborted ? "canceled" : "paused",
            pages,
            this.signal.aborted
              ? null
              : "Could not download. Your cached notes and drafts remain on this device.",
          );
        }
        return this.view;
      })
      .then(
        (snapshot) => {
          try {
            // Completion observers may queue a hint before this task settles.
            if (snapshot.kind === "complete" && completedThrough !== null) {
              if (this.hintTarget > completedThrough)
                this.publish(
                  "more",
                  snapshot.pages,
                  "Another Cloud catch-up pass is needed. Showing cached notes.",
                );
              else this.hintTarget = 0;
            }
            if (this.signal.aborted && this.view.kind !== "canceled")
              this.publish("canceled", this.view.pages);
            return this.view;
          } finally {
            this.task = null;
          }
        },
        (error: unknown) => {
          this.task = null;
          throw error;
        },
      );
    this.task = task;
    return task;
  }
}
