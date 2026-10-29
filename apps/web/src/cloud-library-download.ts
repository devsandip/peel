import {
  validateCloudScope,
  type CloudScope,
} from "../../../packages/cloud-protocol/src/durable";
import {
  DurableCloudPull,
  validatePullProgress,
  type CloudPullStateStore,
} from "../../../packages/cloud-protocol/src/pull-local";
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
  private run(restart: boolean): Promise<DownloadSnapshot> {
    if (this.task) return this.task;
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
          this.publish(
            progress.next ? "more" : "complete",
            pages,
            progress.next
              ? "More Cloud notes remain to download. Showing cached notes."
              : "Last Cloud download complete. Pending drafts still need their own confirmation.",
          );
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
      .finally(() => {
        this.task = null;
      });
    this.task = task;
    return task;
  }
}
