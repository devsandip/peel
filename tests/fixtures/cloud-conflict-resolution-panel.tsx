import "@vitejs/plugin-react/preamble";
import "../../apps/web/src/styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { deleteDB } from "idb";
import { CloudBrowserWorkspaceSession } from "../../apps/web/src/cloud-browser-workspace-session";
import type { CloudLibraryContext } from "../../apps/web/src/cloud-cached-library";
import {
  CloudConflictResolutionPanel,
  type CloudConflictResolutionPanelProps,
} from "../../apps/web/src/cloud-conflict-resolution-panel";
import { CloudLibraryOwners } from "../../apps/web/src/cloud-library-owners";
import { createCloudMutationWebSender } from "../../apps/web/src/cloud-mutation-web-transport";
import type { CloudNoteUpload } from "../../apps/web/src/cloud-note-upload";
import { TRASH_DAYS } from "../../packages/core/src/index";
import {
  applyCloudServerReply,
  planCloudServerReply,
} from "../../packages/cloud-protocol/src/client-response";
import {
  DurableCloudClient,
  type CloudScope,
} from "../../packages/cloud-protocol/src/durable";
import {
  createCloudClient,
  saveCloudDraft,
  startCloudMutation,
  type CloudAction,
  type CloudDraft,
} from "../../packages/cloud-protocol/src/index";
import { cloudScopeHash } from "../../packages/cloud-protocol/src/pull";
import type {
  CloudMutationRequest,
  CloudServerResult,
} from "../../packages/cloud-protocol/src/server";
import { IndexedDBCloudStateStore } from "../../packages/cloud-protocol/src/store-idb";

// Never imported by apps/web/src/main.tsx. Synthetic session, synthetic
// memory-only clipboard and explicit test-owned M0 IndexedDB names only.

type MalformedPreset =
  | null
  | "null-context"
  | "null-owners"
  | "plain-fake-owners"
  | "foreign-owners"
  | "mismatched-store"
  | "mismatched-scope-owner"
  | "mismatched-scope-collection"
  | "mismatched-scope-generation"
  | "mismatched-signal"
  | "pre-aborted-signal"
  | "invalid-note-id"
  | "newline-note-id"
  | "props-getter"
  | "context-getter"
  | "scope-getter"
  | "owners-getter";

const prefix = new URL(location.href).searchParams.get("db");
if (!prefix || !/^peel-m0-cloud-resolution-panel-[a-z0-9-]+$/.test(prefix)) {
  throw Error("Explicit owned conflict resolution panel fixture required");
}

const copied: string[] = [];
let holdClipboardWrites = false;
const heldClipboardQueue: Array<{
  resolve: () => void;
  reject: (reason?: unknown) => void;
}> = [];

Object.defineProperty(navigator, "clipboard", {
  configurable: true,
  value: {
    async writeText(text: string) {
      copied.push(text);
      if (holdClipboardWrites) {
        await new Promise<void>((resolve, reject) => {
          heldClipboardQueue.push({ resolve, reject });
        });
      }
    },
    async readText() {
      throw Error("Clipboard read forbidden in fixture");
    },
  },
});

const underlyingStores = new Map<string, IndexedDBCloudStateStore>(),
  sessionStoreNames: string[] = [],
  models: CloudBrowserWorkspaceSession[] = [],
  controllers: AbortController[] = [],
  csrfTokens: string[] = [],
  readCounts: number[] = [],
  commitCounts: number[] = [],
  closeCounts: number[] = [],
  conflictsCounts: number[] = [],
  subscribeCounts: number[] = [],
  instrumentedOwners = new WeakSet<CloudLibraryOwners>(),
  openUploads = new Map<string, CloudNoteUpload>(),
  tasks = new Set<Promise<unknown>>();

let selectedSession = -1,
  selectedNoteId = "conflict-note",
  manualRefreshKey = 0,
  refreshKeyOverride: { active: true; value: unknown } | { active: false } = {
    active: false,
  },
  malformedPreset: MalformedPreset = null,
  panelMounted = true,
  getterCount = 0,
  holdReadsForIndex: number | null = null,
  failReadsForIndex: number | null = null,
  failCommitsForIndex: number | null = null,
  mutableContextOverride: CloudLibraryContext | null = null;

const heldReadsQueue: Array<{
  resolve: () => void;
  reject: (reason?: unknown) => void;
}> = [];

const track = <T,>(task: Promise<T>): Promise<T> => {
  tasks.add(task);
  void task.catch(() => {});
  return task;
};

function instrumentOwners(index: number) {
  const value = models[index]?.retained();
  if (!value || instrumentedOwners.has(value.owners)) return;
  instrumentedOwners.add(value.owners);
  const originalConflicts = value.owners.conflicts,
    originalSubscribe = value.owners.subscribe;
  value.owners.conflicts = () => {
    conflictsCounts[index] += 1;
    return originalConflicts();
  };
  value.owners.subscribe = (listener: () => void) => {
    subscribeCounts[index] += 1;
    return originalSubscribe(listener);
  };
}

function createSessionModel(token: string): number {
  const index = models.length,
    controller = new AbortController();
  controllers.push(controller);
  csrfTokens.push(token);
  readCounts[index] = 0;
  commitCounts[index] = 0;
  closeCounts[index] = 0;
  conflictsCounts[index] = 0;
  subscribeCounts[index] = 0;

  models.push(
    new CloudBrowserWorkspaceSession(
      { origin: location.origin, csrfToken: token },
      controller.signal,
      async (scope: Readonly<CloudScope>) => {
        const name = `${prefix}-${await cloudScopeHash(scope)}`;
        sessionStoreNames[index] = name;
        let store = underlyingStores.get(name);
        if (!store) {
          store = new IndexedDBCloudStateStore(name);
          underlyingStores.set(name, store);
        }
        const original = store;
        return {
          async read(...args) {
            readCounts[index] += 1;
            if (holdReadsForIndex === index) {
              await new Promise<void>((resolve, reject) => {
                heldReadsQueue.push({ resolve, reject });
              });
            }
            if (failReadsForIndex === index) {
              throw Error("synthetic-private-store-read-failure");
            }
            return original.read(...args);
          },
          async commit(...args) {
            commitCounts[index] += 1;
            if (failCommitsForIndex === index) {
              throw Error("synthetic-private-store-commit-failure");
            }
            return original.commit(...args);
          },
          readPull: (...args) => original.readPull(...args),
          commitPull: (...args) => original.commitPull(...args),
          listLibrary: (...args) => original.listLibrary(...args),
          async close() {
            closeCounts[index] += 1;
            await original.close();
          },
        };
      },
    ),
  );
  return index;
}

function prepared(index = selectedSession) {
  const value = models[index]?.retained();
  if (!value) throw Error("Fixture session is not prepared");
  instrumentOwners(index);
  return value;
}

function buildPanelProps(): CloudConflictResolutionPanelProps {
  const base = prepared(selectedSession),
    effectiveRefreshKey = refreshKeyOverride.active
      ? (refreshKeyOverride.value as number)
      : manualRefreshKey,
    activeContext = mutableContextOverride ?? base.context;

  if (malformedPreset === null) {
    return {
      context: activeContext,
      owners: base.owners,
      signal: models[selectedSession].signal,
      noteId: selectedNoteId,
      refreshKey: effectiveRefreshKey,
    };
  }

  switch (malformedPreset) {
    case "null-context":
      return {
        context: null as unknown as CloudLibraryContext,
        owners: base.owners,
        signal: models[selectedSession].signal,
        noteId: selectedNoteId,
        refreshKey: effectiveRefreshKey,
      };
    case "null-owners":
      return {
        context: activeContext,
        owners: null as unknown as CloudLibraryOwners,
        signal: models[selectedSession].signal,
        noteId: selectedNoteId,
        refreshKey: effectiveRefreshKey,
      };
    case "plain-fake-owners":
      return {
        context: activeContext,
        owners: {
          context: activeContext,
          signal: models[selectedSession].signal,
          conflicts: () => base.owners.conflicts(),
          subscribe: base.owners.subscribe,
        } as unknown as CloudLibraryOwners,
        signal: models[selectedSession].signal,
        noteId: selectedNoteId,
        refreshKey: effectiveRefreshKey,
      };
    case "foreign-owners": {
      const otherIndex = models.findIndex(
        (_, candidate) =>
          candidate !== selectedSession &&
          Boolean(models[candidate]?.retained()),
      );
      if (otherIndex < 0) throw Error("Foreign prepared session required");
      const foreign = prepared(otherIndex);
      return {
        context: activeContext,
        owners: foreign.owners,
        signal: models[selectedSession].signal,
        noteId: selectedNoteId,
        refreshKey: effectiveRefreshKey,
      };
    }
    case "mismatched-store":
      return {
        context: {
          store: {
            read: activeContext.store.read,
            commit: activeContext.store.commit,
            listLibrary: activeContext.store.listLibrary,
            close: activeContext.store.close,
          },
          scope: activeContext.scope,
        },
        owners: base.owners,
        signal: models[selectedSession].signal,
        noteId: selectedNoteId,
        refreshKey: effectiveRefreshKey,
      };
    case "mismatched-scope-owner":
      return {
        context: {
          store: activeContext.store,
          scope: {
            ...activeContext.scope,
            ownerSubject: "foreign-owner-subject",
          },
        },
        owners: base.owners,
        signal: models[selectedSession].signal,
        noteId: selectedNoteId,
        refreshKey: effectiveRefreshKey,
      };
    case "mismatched-scope-collection":
      return {
        context: {
          store: activeContext.store,
          scope: {
            ...activeContext.scope,
            collectionId: "foreign-collection",
          },
        },
        owners: base.owners,
        signal: models[selectedSession].signal,
        noteId: selectedNoteId,
        refreshKey: effectiveRefreshKey,
      };
    case "mismatched-scope-generation":
      return {
        context: {
          store: activeContext.store,
          scope: {
            ...activeContext.scope,
            modeGeneration: activeContext.scope.modeGeneration + 1,
          },
        },
        owners: base.owners,
        signal: models[selectedSession].signal,
        noteId: selectedNoteId,
        refreshKey: effectiveRefreshKey,
      };
    case "mismatched-signal":
      return {
        context: activeContext,
        owners: base.owners,
        signal: new AbortController().signal,
        noteId: selectedNoteId,
        refreshKey: effectiveRefreshKey,
      };
    case "pre-aborted-signal": {
      const preAborted = new AbortController();
      preAborted.abort();
      const abortedOwners = new CloudLibraryOwners(
        activeContext,
        () => Promise.reject(Error("never-called")),
        preAborted.signal,
      );
      return {
        context: activeContext,
        owners: abortedOwners,
        signal: preAborted.signal,
        noteId: selectedNoteId,
        refreshKey: effectiveRefreshKey,
      };
    }
    case "invalid-note-id":
      return {
        context: activeContext,
        owners: base.owners,
        signal: models[selectedSession].signal,
        noteId: "invalid note id with spaces!",
        refreshKey: effectiveRefreshKey,
      };
    case "newline-note-id":
      return {
        context: activeContext,
        owners: base.owners,
        signal: models[selectedSession].signal,
        noteId: "valid-prefix\ninjected",
        refreshKey: effectiveRefreshKey,
      };
    case "props-getter": {
      const propsWithGetter = {
        context: activeContext,
        signal: models[selectedSession].signal,
        noteId: selectedNoteId,
        refreshKey: effectiveRefreshKey,
      } as CloudConflictResolutionPanelProps;
      Object.defineProperty(propsWithGetter, "owners", {
        enumerable: true,
        get() {
          getterCount += 1;
          return base.owners;
        },
      });
      return propsWithGetter;
    }
    case "context-getter": {
      const badContext = {
        scope: activeContext.scope,
      } as CloudLibraryContext;
      Object.defineProperty(badContext, "store", {
        enumerable: true,
        get() {
          getterCount += 1;
          return activeContext.store;
        },
      });
      return {
        context: badContext,
        owners: base.owners,
        signal: models[selectedSession].signal,
        noteId: selectedNoteId,
        refreshKey: effectiveRefreshKey,
      };
    }
    case "scope-getter": {
      const badScope = {
        version: 1,
        collectionId: activeContext.scope.collectionId,
        modeGeneration: activeContext.scope.modeGeneration,
      } as CloudScope;
      Object.defineProperty(badScope, "ownerSubject", {
        enumerable: true,
        get() {
          getterCount += 1;
          return activeContext.scope.ownerSubject;
        },
      });
      return {
        context: {
          store: activeContext.store,
          scope: badScope,
        },
        owners: base.owners,
        signal: models[selectedSession].signal,
        noteId: selectedNoteId,
        refreshKey: effectiveRefreshKey,
      };
    }
    case "owners-getter": {
      const tamperedOwners = Object.create(
        CloudLibraryOwners.prototype,
      ) as CloudLibraryOwners;
      Object.defineProperty(tamperedOwners, "context", {
        enumerable: true,
        get() {
          getterCount += 1;
          return activeContext;
        },
      });
      return {
        context: activeContext,
        owners: tamperedOwners,
        signal: models[selectedSession].signal,
        noteId: selectedNoteId,
        refreshKey: effectiveRefreshKey,
      };
    }
  }
}

const root = createRoot(document.getElementById("fixture")!);
const renderRoot = (node: Parameters<typeof root.render>[0]) => {
  // External fixture setters expose the DOM only after the requested React commit.
  flushSync(() => root.render(node));
};

// Keep hostile descriptors inside the callback, outside React's props graph.
// JSX spreading and React development profiler diffs can otherwise read the
// synthetic getter before/after the component's own descriptor validation.
function RawPanelPropsProbe({
  getInput,
}: {
  getInput: () => CloudConflictResolutionPanelProps;
}) {
  return CloudConflictResolutionPanel(getInput());
}

function renderFixture() {
  const panelProps =
    panelMounted && selectedSession >= 0 && models[selectedSession]?.retained()
      ? buildPanelProps()
      : null;
  renderRoot(
    <StrictMode>
      <div className="fixture-shell">
        <div className="cloud-workspace-inspection-bar">
          <button type="button" className="cloud-workspace-inspection-back">
            Back to notes
          </button>
        </div>
        {panelProps && <RawPanelPropsProbe getInput={() => panelProps} />}
      </div>
    </StrictMode>,
  );
}

function buildDraft(
  collectionId: string,
  noteId: string,
  bodyMarkdown: string,
  state: CloudDraft["state"] = "active",
): CloudDraft {
  const nowMs = Date.now(),
    nowIso = new Date(nowMs).toISOString();
  return {
    schemaVersion: 1,
    collectionId,
    noteId,
    bodyMarkdown,
    state,
    createdAt: nowIso,
    updatedAt: nowIso,
    deletedAt: state === "trashed" ? nowIso : null,
    purgeAfter:
      state === "trashed"
        ? new Date(nowMs + TRASH_DAYS * 86400000).toISOString()
        : null,
  };
}

const api = {
  async createAndPrepare(token: string, shouldSelect = true): Promise<number> {
    const index = createSessionModel(token);
    await track(models[index].prepare());
    instrumentOwners(index);
    if (shouldSelect) {
      selectedSession = index;
      mutableContextOverride = null;
      malformedPreset = null;
      refreshKeyOverride = { active: false };
      renderFixture();
    }
    return index;
  },
  selectSession(
    index: number,
    noteId = selectedNoteId,
    options?: {
      mutateScopeInPlace?: boolean;
      inPlaceMutation?: Partial<CloudScope>;
    },
  ) {
    const target = prepared(index);
    selectedNoteId = noteId;
    malformedPreset = null;
    refreshKeyOverride = { active: false };
    if (options?.mutateScopeInPlace && mutableContextOverride) {
      const patch = options.inPlaceMutation ?? target.context.scope;
      Object.assign(
        mutableContextOverride.scope as Record<string, unknown>,
        patch,
      );
      selectedSession = index;
    } else if (options?.mutateScopeInPlace) {
      const mutableScope: CloudScope = { ...target.context.scope };
      mutableContextOverride = {
        store: target.context.store,
        scope: mutableScope,
      };
      selectedSession = index;
    } else {
      selectedSession = index;
      mutableContextOverride = null;
    }
    renderFixture();
  },
  mutateDisplayedScopeInPlace(patch: Partial<CloudScope>) {
    const current = prepared(selectedSession);
    if (!mutableContextOverride) {
      mutableContextOverride = {
        store: current.context.store,
        scope: { ...current.context.scope },
      };
    }
    Object.assign(
      mutableContextOverride.scope as Record<string, unknown>,
      patch,
    );
    renderFixture();
  },
  setNote(noteId: string) {
    selectedNoteId = noteId;
    renderFixture();
  },
  refresh() {
    manualRefreshKey += 1;
    renderFixture();
  },
  setRefreshKeyOverride(value: unknown) {
    if (value === null) {
      refreshKeyOverride = { active: false };
    } else {
      refreshKeyOverride = { active: true, value };
    }
    renderFixture();
  },
  setMalformedPreset(preset: MalformedPreset) {
    malformedPreset = preset;
    renderFixture();
  },
  abortSession(index = selectedSession, rerender = true) {
    controllers[index]?.abort();
    if (rerender) {
      renderFixture();
    }
  },
  unmountPanel() {
    panelMounted = false;
    renderFixture();
  },
  remountPanel() {
    panelMounted = true;
    renderFixture();
  },
  async download(index = selectedSession) {
    const result = await track(prepared(index).download.download());
    manualRefreshKey += 1;
    renderFixture();
    return { kind: result.kind, pages: result.pages };
  },
  /**
   * Produces a real 409 conflict (or applies a server reply) in IndexedDB by
   * submitting one conditional mutation through the real web mutation sender.
   */
  async submitDirectMutation(options: {
    noteId: string;
    kind: "upsert" | "purge";
    bodyMarkdown?: string;
    state?: CloudDraft["state"];
    index?: number;
  }) {
    const index = options.index ?? selectedSession,
      { context } = prepared(index),
      client = new DurableCloudClient(context.store, context.scope),
      sender = createCloudMutationWebSender({
        origin: location.origin,
        csrfToken: csrfTokens[index],
      }),
      existing = await client.get(options.noteId),
      action: CloudAction =
        options.kind === "purge"
          ? { kind: "purge", snapshot: null }
          : {
              kind: "upsert",
              snapshot: buildDraft(
                context.scope.collectionId,
                options.noteId,
                options.bodyMarkdown ?? "",
                options.state ?? "active",
              ),
            };
    const saved = await track(
        client.save(options.noteId, action, existing?.generation ?? null),
      ),
      started = await track(
        client.prepare(options.noteId, saved.generation, crypto.randomUUID()),
      ),
      request: CloudMutationRequest = {
        version: 1,
        collectionId: context.scope.collectionId,
        modeGeneration: context.scope.modeGeneration,
        mutation: started.inFlight!,
      },
      reply = await track(sender(request, controllers[index].signal));
    if (reply.status !== 200 && reply.status !== 409) {
      throw Error(`Unexpected direct mutation status ${reply.status}`);
    }
    const body = reply.body as CloudServerResult;
    planCloudServerReply(body, request);
    await track(applyCloudServerReply(client, request, body));
    if (index === selectedSession) {
      manualRefreshKey += 1;
      renderFixture();
    }
    return reply.status;
  },
  /**
   * Commits an authoritative server state from an isolated transient client
   * using the given authenticated session's CSRF token without touching any
   * browser IndexedDB cache.
   */
  async writeRemoteRevision(options: {
    noteId: string;
    baseSnapshot: (CloudDraft & { serverRevision: number }) | null;
    bodyMarkdown: string;
    state: CloudDraft["state"];
    index?: number;
  }) {
    const index = options.index ?? selectedSession,
      { context } = prepared(index),
      sender = createCloudMutationWebSender({
        origin: location.origin,
        csrfToken: csrfTokens[index],
      }),
      transient = await startCloudMutation(
        saveCloudDraft(
          createCloudClient(
            context.scope.collectionId,
            options.noteId,
            options.baseSnapshot,
          ),
          {
            kind: "upsert",
            snapshot: buildDraft(
              context.scope.collectionId,
              options.noteId,
              options.bodyMarkdown,
              options.state,
            ),
          },
        ),
        crypto.randomUUID(),
      ),
      request: CloudMutationRequest = {
        version: 1,
        collectionId: context.scope.collectionId,
        modeGeneration: context.scope.modeGeneration,
        mutation: transient.inFlight!,
      },
      reply = await track(sender(request, controllers[index].signal));
    if (reply.status !== 200) {
      throw Error(`Remote revision write failed with ${reply.status}`);
    }
  },
  /**
   * Advances the local draft generation on an existing durable row (e.g. while
   * inline confirmation is open) and optionally notifies via refreshKey.
   */
  async advanceLocalGeneration(
    noteId: string,
    bodyMarkdown: string,
    notifyRefresh: boolean,
    index = selectedSession,
  ) {
    const { context } = prepared(index),
      client = new DurableCloudClient(context.store, context.scope),
      previous = await client.get(noteId);
    if (!previous) throw Error("Expected existing durable Cloud note");
    const currentState =
      previous.conflict?.local.kind === "upsert"
        ? previous.conflict.local.snapshot.state
        : "active";
    const next = await track(
      client.save(
        noteId,
        {
          kind: "upsert",
          snapshot: buildDraft(
            context.scope.collectionId,
            noteId,
            bodyMarkdown,
            currentState,
          ),
        },
        previous.generation,
      ),
    );
    if (notifyRefresh && index === selectedSession) {
      manualRefreshKey += 1;
      renderFixture();
    }
    return next.generation;
  },
  async openNoteOwner(noteId: string, index = selectedSession) {
    const { owners, context } = prepared(index),
      upload = await track(owners.open(Object.freeze({ ...context, noteId })));
    openUploads.set(`${index}:${noteId}`, upload);
  },
  async putAwayNoteOwner(noteId: string, index = selectedSession) {
    const key = `${index}:${noteId}`,
      upload = openUploads.get(key);
    if (!upload) throw Error("No open upload owner for note");
    const { owners, context } = prepared(index);
    await track(upload.session.putAway());
    owners.putAway(
      Object.freeze({
        context,
        upload,
        session: upload.session,
      }),
    );
    openUploads.delete(key);
  },
  readDurableState(noteId: string, index = selectedSession) {
    const { context } = prepared(index);
    return new DurableCloudClient(context.store, context.scope).get(noteId);
  },
  holdReads(index: number | null) {
    holdReadsForIndex = index;
  },
  heldReadCount: () => heldReadsQueue.length,
  releaseReads(shouldFail: boolean) {
    holdReadsForIndex = null;
    for (const waiter of heldReadsQueue.splice(0)) {
      if (shouldFail) {
        waiter.reject(Error("synthetic-private-held-read-failure"));
      } else {
        waiter.resolve();
      }
    }
  },
  failReads(index: number | null) {
    failReadsForIndex = index;
  },
  failCommits(index: number | null) {
    failCommitsForIndex = index;
  },
  async closeUnderlyingStore(index = selectedSession) {
    const storeName = sessionStoreNames[index];
    if (!storeName) throw Error("Unknown store for session");
    const store = underlyingStores.get(storeName);
    if (store) await store.close();
  },
  holdClipboard(hold: boolean) {
    holdClipboardWrites = hold;
  },
  heldClipboardCount: () => heldClipboardQueue.length,
  releaseNextClipboard(shouldFail: boolean) {
    const next = heldClipboardQueue.shift();
    if (!next) return;
    if (shouldFail) {
      next.reject(Error("synthetic-private-clipboard-denied"));
    } else {
      next.resolve();
    }
  },
  releaseAllClipboard(shouldFail: boolean) {
    holdClipboardWrites = false;
    while (heldClipboardQueue.length > 0) {
      api.releaseNextClipboard(shouldFail);
    }
  },
  copiedCalls: () => [...copied],
  clearCopiedCalls() {
    copied.length = 0;
  },
  readCount: (index = selectedSession) => readCounts[index] ?? 0,
  commitCount: (index = selectedSession) => commitCounts[index] ?? 0,
  closeCounts: () => [...closeCounts],
  conflictsCount: (index = selectedSession) => conflictsCounts[index] ?? 0,
  subscribeCount: (index = selectedSession) => subscribeCounts[index] ?? 0,
  getterCalls: () => getterCount,
  databases: async () =>
    (await indexedDB.databases()).map((database) => database.name),
  storageKeys: () => Object.keys(localStorage),
  async destroy() {
    failReadsForIndex = null;
    failCommitsForIndex = null;
    api.releaseReads(false);
    api.releaseAllClipboard(false);
    openUploads.clear();
    for (const controller of controllers) controller.abort();
    root.unmount();
    await Promise.allSettled([...tasks]);
    await Promise.all(
      [...underlyingStores.values()].map((store) => store.close()),
    );
    for (const database of await indexedDB.databases()) {
      if (database.name?.startsWith(`${prefix}-`)) {
        await deleteDB(database.name);
      }
    }
  },
};

renderFixture();

declare global {
  interface Window {
    cloudConflictResolutionPanelFixture: typeof api;
  }
}

window.cloudConflictResolutionPanelFixture = api;
