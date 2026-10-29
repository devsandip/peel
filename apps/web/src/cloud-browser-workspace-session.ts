import type { CloudScope } from "../../../packages/cloud-protocol/src/durable";
import type { CloudLibraryStateStore } from "../../../packages/cloud-protocol/src/library-local";
import type { CloudPullStateStore } from "../../../packages/cloud-protocol/src/pull-local";
import type { CloudLibraryContext } from "./cloud-cached-library";
import { createCloudDownloadWebSender } from "./cloud-download-web-transport";
import {
  CloudLibraryContextReadError,
  createCloudLibraryContextWebReader,
} from "./cloud-library-context-web";
import { CloudLibraryDownload } from "./cloud-library-download";
import { CloudLibraryOwners } from "./cloud-library-owners";
import { createCloudMutationWebSender } from "./cloud-mutation-web-transport";

export type CloudBrowserWorkspaceCache = CloudLibraryStateStore &
  CloudPullStateStore;
export type CloudBrowserWorkspaceCacheResolver = (
  scope: Readonly<CloudScope>,
  signal: AbortSignal,
) => Promise<CloudBrowserWorkspaceCache>;
export type PreparedCloudBrowserWorkspace = Readonly<{
  context: CloudLibraryContext;
  owners: CloudLibraryOwners;
  download: CloudLibraryDownload;
}>;
type FailureKind = "sign-in-required" | "paused" | "canceled";
const messages: Record<FailureKind, string> = {
  "sign-in-required": "Sign in again to prepare the Cloud workspace.",
  paused:
    "Could not prepare the Cloud workspace. Your cached notes and drafts remain on this device.",
  canceled: "Cloud workspace preparation canceled.",
};
export class CloudBrowserWorkspaceError extends Error {
  constructor(readonly kind: FailureKind) {
    super(messages[kind]);
    this.name = "CloudBrowserWorkspaceError";
  }
}

/** Development composition. The caller owns authentication and all cache resources. */
export class CloudBrowserWorkspaceSession {
  private readContext: ReturnType<typeof createCloudLibraryContextWebReader>;
  private mutation: ReturnType<typeof createCloudMutationWebSender>;
  private download: ReturnType<typeof createCloudDownloadWebSender>;
  private task: Promise<PreparedCloudBrowserWorkspace> | null = null;
  private prepared: PreparedCloudBrowserWorkspace | null = null;
  private unsubscribers: (() => void)[] = [];
  private listeners = new Set<() => void>();
  private view: Readonly<{
    kind: "idle" | "preparing" | "ready" | FailureKind;
    refreshKey: number;
  }> = Object.freeze({ kind: "idle", refreshKey: 0 });
  constructor(
    config: { origin: string; csrfToken: string },
    readonly signal: AbortSignal,
    private resolveCache: CloudBrowserWorkspaceCacheResolver,
    fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
  ) {
    try {
      const captured = structuredClone(config);
      if (typeof resolveCache !== "function") throw Error();
      this.readContext = createCloudLibraryContextWebReader(
        captured,
        signal,
        fetcher,
      );
      this.mutation = createCloudMutationWebSender(captured, fetcher);
      this.download = createCloudDownloadWebSender(captured, fetcher);
    } catch {
      throw new CloudBrowserWorkspaceError(
        signal?.aborted ? "canceled" : "paused",
      );
    }
    const abort = () => {
      for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe();
      this.publish("canceled");
    };
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  }
  snapshot = () => this.view;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  current = () => (this.signal.aborted ? null : this.prepared);
  /** Original-context recovery remains reachable after cancellation. Never reuse in another session. */
  retained = () => this.prepared;
  private publish(kind: typeof this.view.kind) {
    this.view = Object.freeze({
      kind: this.signal.aborted ? "canceled" : kind,
      refreshKey: this.view.refreshKey + 1,
    });
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        /* Observers do not control the authentication lifetime. */
      }
    }
  }
  private async cache(scope: Readonly<CloudScope>) {
    let abort!: () => void;
    const canceled = new Promise<never>((_, reject) => {
      abort = () => reject(new CloudBrowserWorkspaceError("canceled"));
      this.signal.addEventListener("abort", abort, { once: true });
      if (this.signal.aborted) abort();
    });
    const pending = Promise.resolve().then(() => {
      this.signal.throwIfAborted();
      return this.resolveCache(scope, this.signal);
    });
    try {
      // A caller-owned resolver may ignore cancellation; its resource remains caller-owned.
      return await Promise.race([pending, canceled]);
    } finally {
      this.signal.removeEventListener("abort", abort);
    }
  }
  prepare = (): Promise<PreparedCloudBrowserWorkspace> => {
    if (this.signal.aborted)
      return Promise.reject(new CloudBrowserWorkspaceError("canceled"));
    if (this.prepared) return Promise.resolve(this.prepared);
    if (this.task) return this.task;
    this.task = Promise.resolve()
      .then(async () => {
        this.signal.throwIfAborted();
        this.publish("preparing");
        this.signal.throwIfAborted();
        const scope = await this.readContext();
        this.signal.throwIfAborted();
        const store = await this.cache(scope);
        this.signal.throwIfAborted();
        if (
          !store ||
          [
            "read",
            "commit",
            "readPull",
            "commitPull",
            "listLibrary",
            "close",
          ].some((key) => typeof Reflect.get(store, key) !== "function")
        )
          throw Error();
        this.signal.throwIfAborted();
        const context = Object.freeze({ store, scope }),
          owners = new CloudLibraryOwners(context, this.mutation, this.signal),
          download = new CloudLibraryDownload(
            store,
            scope,
            this.download,
            this.signal,
          );
        this.prepared = Object.freeze({ context, owners, download });
        this.unsubscribers = [
          owners.subscribe(() => this.publish("ready")),
          download.subscribe(() => this.publish("ready")),
        ];
        this.publish("ready");
        this.signal.throwIfAborted();
        return this.prepared;
      })
      .catch((error: unknown) => {
        const kind = this.signal.aborted
          ? "canceled"
          : error instanceof CloudLibraryContextReadError &&
              error.kind === "sign-in-required"
            ? "sign-in-required"
            : "paused";
        this.publish(kind);
        throw new CloudBrowserWorkspaceError(kind);
      })
      .finally(() => {
        this.task = null;
      });
    return this.task;
  };
}
