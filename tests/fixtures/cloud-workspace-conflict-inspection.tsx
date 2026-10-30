import "@vitejs/plugin-react/preamble";
import "../../apps/web/src/styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { deleteDB } from "idb";
import {
  CloudCachedLibrary,
  type CloudLibraryContext,
  type CloudLibraryNoteSelection,
} from "../../apps/web/src/cloud-cached-library";
import { CloudLibraryOwners } from "../../apps/web/src/cloud-library-owners";
import type { CloudMutationSender } from "../../apps/web/src/cloud-note-upload";
import {
  CloudWorkspace,
  type CloudWorkspaceConnection,
  type CloudWorkspaceConnectionKind,
  type CloudWorkspacePutAway,
} from "../../apps/web/src/cloud-workspace";
import {
  applyRemoteCloudHead,
  type CloudClientState,
  type CloudDraft,
} from "../../packages/cloud-protocol/src/index";
import {
  DurableCloudClient,
  type CloudScope,
} from "../../packages/cloud-protocol/src/durable";
import type { CloudLibraryStateStore } from "../../packages/cloud-protocol/src/library-local";
import { IndexedDBCloudStateStore } from "../../packages/cloud-protocol/src/store-idb";
import { cloudAck } from "./cloud-durable-contract";

// Never imported by apps/web/src/main.tsx. Uses only explicit test-owned M0 IndexedDB stores and a fake clipboard.
const config = Reflect.get(
    window,
    "syntheticWorkspaceConflictInspectionConfig",
  ) as {
    api: string;
    contexts: { scope: CloudScope; token: string }[];
  },
  origin = new URL(config.api),
  prefix = new URL(location.href).searchParams.get("db");

if (
  origin.protocol !== "http:" ||
  origin.hostname !== "127.0.0.1" ||
  origin.origin !== config.api ||
  !prefix ||
  !/^peel-m0-cloud-workspace-conflict-[a-z0-9-]+$/.test(prefix) ||
  config.contexts.length !== 2
) {
  throw Error(
    "Explicit owned Cloud workspace conflict-inspection fixture required",
  );
}

const copiedCalls: string[] = [];
let holdClipboard = false,
  failClipboard = false;
const heldClipboard: Array<(fail: boolean) => void> = [];

Object.defineProperty(navigator, "clipboard", {
  configurable: true,
  value: {
    async writeText(text: string) {
      copiedCalls.push(text);
      const shouldFail = failClipboard;
      if (holdClipboard) {
        await new Promise<void>((resolve, reject) => {
          heldClipboard.push((error) =>
            error
              ? reject(Error("synthetic-private-clipboard-secret-token"))
              : resolve(),
          );
        });
        return;
      }
      if (shouldFail) {
        throw Error("synthetic-private-clipboard-secret-token");
      }
    },
  },
});

const scopes: CloudScope[] = [
  config.contexts[0].scope,
  config.contexts[1].scope,
  {
    ...config.contexts[0].scope,
    collectionId: "synthetic-workspace-conflict-alt",
  },
  {
    ...config.contexts[0].scope,
    modeGeneration: config.contexts[0].scope.modeGeneration + 1,
  },
];

const names = [`${prefix}-a`, `${prefix}-b`, `${prefix}-c`, `${prefix}-d`],
  retentionFailures = [false, false, false, false],
  rawStores = names.map(
    (name, owner) =>
      new IndexedDBCloudStateStore(name, () => {
        if (retentionFailures[owner]) {
          throw Error("synthetic-private-retention-secret-token");
        }
      }),
  );

let holdReadOwner: number | null = null,
  failReadOwner: number | null = null,
  holdListOwner: number | null = null,
  failListOwner: number | null = null,
  holdCommitOwner: number | null = null,
  holdOpenOwner: number | null = null,
  failOpenOwner: number | null = null,
  holdCreateOwner: number | null = null,
  failCreateOwner: number | null = null,
  failPutAwayCallback = false,
  forbidCommits = false,
  destroying = false;

const readCounts = [0, 0, 0, 0],
  listCounts = [0, 0, 0, 0],
  commitCounts = [0, 0, 0, 0],
  closeCounts = [0, 0, 0, 0];

const heldReads: Array<{
    owner: number;
    noteId: string;
    resolve: (fail: boolean) => void;
  }> = [],
  heldLists: Array<{
    owner: number;
    collection: string;
    resolve: (fail: boolean) => void;
  }> = [],
  heldCommits: Array<() => void> = [],
  heldOpens: Array<{
    owner: number;
    noteId: string;
    resolve: (fail: boolean) => void;
  }> = [],
  heldCreates: Array<{
    owner: number;
    resolve: (fail: boolean) => void;
  }> = [];

const wrappedStores: CloudLibraryStateStore[] = rawStores.map(
  (store, owner) => ({
    async read(scope, noteId) {
      readCounts[owner]++;
      const shouldFail = failReadOwner === owner;
      const value = await store.read(scope, noteId);
      if (holdReadOwner === owner) {
        await new Promise<void>((resolve, reject) => {
          heldReads.push({
            owner,
            noteId,
            resolve: (error) =>
              error
                ? reject(Error("synthetic-private-read-secret-token"))
                : resolve(),
          });
        });
      }
      if (shouldFail) {
        throw Error("synthetic-private-read-secret-token");
      }
      return value;
    },
    async commit(...args) {
      if (forbidCommits) {
        commitCounts[owner]++;
        throw Error("Unexpected storage write during conflict inspection");
      }
      if (holdCommitOwner === owner) {
        await new Promise<void>((resolve) => heldCommits.push(resolve));
      }
      const ok = await store.commit(...args);
      commitCounts[owner]++;
      return ok;
    },
    async close() {
      closeCounts[owner]++;
      if (!destroying) {
        throw Error("Unexpected storage close during workspace inspection");
      }
      return store.close();
    },
    async listLibrary(scope, request) {
      listCounts[owner]++;
      const shouldFail = failListOwner === owner;
      const page = await store.listLibrary(scope, request);
      if (holdListOwner === owner) {
        await new Promise<void>((resolve, reject) => {
          heldLists.push({
            owner,
            collection: request.collection,
            resolve: (error) =>
              error
                ? reject(Error("synthetic-private-list-secret-token"))
                : resolve(),
          });
        });
      }
      if (shouldFail) {
        throw Error("synthetic-private-list-secret-token");
      }
      return page;
    },
  }),
);

function makeDraft(
  noteId: string,
  bodyMarkdown: string,
  state: CloudDraft["state"] = "active",
  updatedAt = "2026-10-29T10:00:00.000Z",
  collectionId = scopes[0].collectionId,
): CloudDraft {
  const trashed = state === "trashed";
  return {
    schemaVersion: 1,
    collectionId,
    noteId,
    bodyMarkdown,
    state,
    createdAt: "2026-10-28T09:00:00.000Z",
    updatedAt,
    deletedAt: trashed ? "2026-10-29T11:00:00.000Z" : null,
    purgeAfter: trashed ? "2026-11-28T11:00:00.000Z" : null,
  };
}

const seedClients = rawStores.map(
  (store, owner) => new DurableCloudClient(store, scopes[owner]),
);

async function seedConflictUpsert(
  client: DurableCloudClient,
  collectionId: string,
  options: {
    noteId: string;
    baseBody: string;
    localBody: string;
    localState?: CloudDraft["state"];
    localUpdatedAt: string;
    remoteBody: string | null;
    remoteState?: CloudDraft["state"];
    remoteUpdatedAt?: string;
    remoteRevision: number;
  },
) {
  const s0 = await client.save(
    options.noteId,
    {
      kind: "upsert",
      snapshot: makeDraft(
        options.noteId,
        options.baseBody,
        "active",
        "2026-10-28T10:00:00.000Z",
        collectionId,
      ),
    },
    null,
  );
  const p0 = await client.prepare(
    options.noteId,
    s0.generation,
    `op-${options.noteId}-base`,
  );
  const a0 = await client.acknowledge(options.noteId, cloudAck(p0, 1));
  const s1 = await client.save(
    options.noteId,
    {
      kind: "upsert",
      snapshot: makeDraft(
        options.noteId,
        options.localBody,
        options.localState ?? "active",
        options.localUpdatedAt,
        collectionId,
      ),
    },
    a0.generation,
  );
  const p1 = await client.prepare(
    options.noteId,
    s1.generation,
    `op-${options.noteId}-conflict`,
  );
  await client.conflict(options.noteId, {
    ...cloudAck(p1, options.remoteRevision),
    snapshot:
      options.remoteBody === null
        ? null
        : {
            ...makeDraft(
              options.noteId,
              options.remoteBody,
              options.remoteState ?? "active",
              options.remoteUpdatedAt ?? options.localUpdatedAt,
              collectionId,
            ),
            serverRevision: options.remoteRevision,
          },
  });
}

async function seedInitialData() {
  const clientA = seedClients[0];
  if (!(await clientA.get("editable-note"))) {
    await clientA.save(
      "editable-note",
      {
        kind: "upsert",
        snapshot: makeDraft(
          "editable-note",
          "# Editable workspace note\nSaved draft body before conflict inspection ##work",
          "active",
          "2026-10-29T16:00:00.000Z",
        ),
      },
      null,
    );

    await seedConflictUpsert(clientA, scopes[0].collectionId, {
      noteId: "conflict-active",
      baseBody: "# Active roadmap conflict\nBase roadmap line",
      localBody: `# Active roadmap conflict\n- Local roadmap bullet 原文\n<img src=x onerror="window.__conflictXss=true">\nToken-${"A".repeat(120)}`,
      localState: "active",
      localUpdatedAt: "2026-10-29T15:30:00.000Z",
      remoteBody:
        "# Active roadmap conflict\n- Observed Cloud bullet from laptop ##roadmap",
      remoteState: "active",
      remoteUpdatedAt: "2026-10-29T15:35:00.000Z",
      remoteRevision: 2,
    });

    await seedConflictUpsert(clientA, scopes[0].collectionId, {
      noteId: "conflict-second",
      baseBody: "# Second active conflict\nBase text",
      localBody: "# Second active conflict\nSecond note local draft body",
      localState: "active",
      localUpdatedAt: "2026-10-29T15:00:00.000Z",
      remoteBody: "# Second active conflict\nSecond note observed Cloud body",
      remoteState: "active",
      remoteUpdatedAt: "2026-10-29T15:05:00.000Z",
      remoteRevision: 4,
    });

    await seedConflictUpsert(clientA, scopes[0].collectionId, {
      noteId: "conflict-archived",
      baseBody: "# Archived budget conflict\nBase figures",
      localBody: "# Archived budget conflict\nArchived local figures Q4",
      localState: "archived",
      localUpdatedAt: "2026-10-29T14:30:00.000Z",
      remoteBody: "# Archived budget conflict\nObserved active Cloud figures",
      remoteState: "active",
      remoteUpdatedAt: "2026-10-29T14:35:00.000Z",
      remoteRevision: 3,
    });

    await seedConflictUpsert(clientA, scopes[0].collectionId, {
      noteId: "conflict-trashed",
      baseBody: "# Trashed receipt conflict\nBase receipt",
      localBody: "# Trashed receipt conflict\nLocal trashed receipt details",
      localState: "trashed",
      localUpdatedAt: "2026-10-29T14:00:00.000Z",
      remoteBody:
        "# Trashed receipt conflict\nObserved Cloud trashed receipt details",
      remoteState: "trashed",
      remoteUpdatedAt: "2026-10-29T14:05:00.000Z",
      remoteRevision: 5,
    });

    await seedConflictUpsert(clientA, scopes[0].collectionId, {
      noteId: "conflict-remote-purged",
      baseBody: "# Surviving local draft\nInitial synced version",
      localBody:
        "# Surviving local draft\nLocal draft preserved after remote permanent purge",
      localState: "active",
      localUpdatedAt: "2026-10-29T13:30:00.000Z",
      remoteBody: null,
      remoteRevision: 6,
    });

    // Local permanent purge conflicting with an active remote Cloud version.
    const lp0 = await clientA.save(
      "conflict-local-purged",
      {
        kind: "upsert",
        snapshot: makeDraft(
          "conflict-local-purged",
          "# Remote note surviving local purge\nInitial version",
          "active",
          "2026-10-29T12:00:00.000Z",
        ),
      },
      null,
    );
    const lpPrep0 = await clientA.prepare(
      "conflict-local-purged",
      lp0.generation,
      "op-lp-base",
    );
    const lpAck0 = await clientA.acknowledge(
      "conflict-local-purged",
      cloudAck(lpPrep0, 1),
    );
    const lp1 = await clientA.save(
      "conflict-local-purged",
      { kind: "purge", snapshot: null },
      lpAck0.generation,
    );
    const lpPrep1 = await clientA.prepare(
      "conflict-local-purged",
      lp1.generation,
      "op-lp-purge",
    );
    await clientA.conflict("conflict-local-purged", {
      ...cloudAck(lpPrep1, 2),
      snapshot: {
        ...makeDraft(
          "conflict-local-purged",
          "# Remote note surviving local purge\nObserved Cloud version kept when local purge conflicted",
          "active",
          "2026-10-29T13:00:00.000Z",
        ),
        serverRevision: 2,
      },
    });

    // Deferred observed purge while an upload is still in flight (kind: "recovery", status: "Pending upload").
    const obs0 = await clientA.save(
      "deferred-observed-recovery",
      {
        kind: "upsert",
        snapshot: makeDraft(
          "deferred-observed-recovery",
          "# In-flight note with deferred observed purge\nStill awaiting mutation receipt",
          "active",
          "2026-10-29T12:30:00.000Z",
        ),
      },
      null,
    );
    const obsPrep = await clientA.prepare(
      "deferred-observed-recovery",
      obs0.generation,
      "op-deferred-observed",
    );
    const deferredNext = applyRemoteCloudHead(obsPrep, {
      revision: 2,
      snapshot: null,
    });
    await rawStores[0].commit(
      scopes[0],
      "deferred-observed-recovery",
      obsPrep.generation,
      deferredNext,
    );
  }

  const otherLabels = [
    "Account B private conflict\nAccount B local draft body",
    "Alt collection conflict\nAlt collection local draft body",
    "Generation 2 conflict\nMode generation 2 local draft body",
  ] as const;

  for (let owner = 1; owner <= 3; owner++) {
    const client = seedClients[owner];
    if (!(await client.get("conflict-active"))) {
      await seedConflictUpsert(client, scopes[owner].collectionId, {
        noteId: "conflict-active",
        baseBody: `# ${otherLabels[owner - 1]}`,
        localBody: `# ${otherLabels[owner - 1]}`,
        localState: "active",
        localUpdatedAt: "2026-10-29T15:30:00.000Z",
        remoteBody: `# ${otherLabels[owner - 1]} (observed Cloud)`,
        remoteState: "active",
        remoteUpdatedAt: "2026-10-29T15:35:00.000Z",
        remoteRevision: 2,
      });
    }
  }
}

await seedInitialData();

const senders: CloudMutationSender[] = scopes.map((_, owner) => {
  const token = config.contexts[owner <= 1 ? owner : 0].token;
  return async (request, signal) => {
    const response = await fetch(config.api + "/v1/mutations", {
      method: "POST",
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
      headers: {
        "Content-Type": "application/json",
        "x-synthetic-fixture": token,
      },
      body: JSON.stringify(request),
    });
    const text = await response.text();
    if (new TextEncoder().encode(text).length > 1048576) {
      throw Error("Fixture response bound");
    }
    return { status: response.status, body: JSON.parse(text) };
  };
});

const libraryContexts: CloudLibraryContext[] = scopes.map((scope, owner) =>
  Object.freeze({
    store: wrappedStores[owner],
    scope: Object.freeze({ ...scope }),
  }),
);

type ViewMode = "workspace" | "library-no-inspect" | "library-failing-inspect";

type GetterPreset =
  | "none"
  | "workspace-context-getter"
  | "workspace-scope-getter"
  | "library-scope-getter";

let selected = 0,
  refreshKey = 0,
  viewMode: ViewMode = "workspace",
  getterPreset: GetterPreset = "none",
  getterCalls = 0,
  connectionState: CloudWorkspaceConnection | undefined = undefined,
  mutableContextOverride: {
    store: CloudLibraryStateStore;
    scope: CloudScope;
  } | null = null;

const controllers: AbortController[] = scopes.map(() => new AbortController());
const ownersByScope: CloudLibraryOwners[] = scopes.map(
  (_, owner) =>
    new CloudLibraryOwners(
      libraryContexts[owner],
      senders[owner],
      controllers[owner].signal,
    ),
);
const allOwners = new Set<CloudLibraryOwners>(ownersByScope);

for (let owner = 0; owner < ownersByScope.length; owner++) {
  const instance = ownersByScope[owner];
  instance.subscribe(() => {
    if (
      !instance.signal.aborted &&
      selected === owner &&
      ownersByScope[owner] === instance &&
      refreshKey >= 0
    ) {
      refreshKey++;
      render();
    }
  });
}

const putAways: Array<{
  owner: number;
  noteId: string;
  retained: boolean;
  closed: boolean;
  bodyMarkdown: string;
}> = [];
const standaloneInspectCalls: Array<{
  ownerSubject: string;
  noteId: string;
  frozen: boolean;
}> = [];

function ownerOf(context: CloudLibraryContext): number {
  const owner = wrappedStores.indexOf(context.store);
  if (
    owner < 0 ||
    context.scope.ownerSubject !== scopes[owner].ownerSubject ||
    context.scope.collectionId !== scopes[owner].collectionId ||
    context.scope.modeGeneration !== scopes[owner].modeGeneration
  ) {
    throw Error("Foreign fixture context");
  }
  return owner;
}

async function onOpen(selection: CloudLibraryNoteSelection) {
  const owner = ownerOf(selection);
  if (holdOpenOwner === owner) {
    const shouldFail = await new Promise<boolean>((resolve) =>
      heldOpens.push({ owner, noteId: selection.noteId, resolve }),
    );
    if (shouldFail) {
      throw Error("synthetic-private-open-secret-token");
    }
  }
  if (failOpenOwner === owner) {
    throw Error("synthetic-private-open-secret-token");
  }
  return ownersByScope[owner].open(selection);
}

async function onCreate(context: CloudLibraryContext) {
  const owner = ownerOf(context);
  if (holdCreateOwner === owner) {
    const shouldFail = await new Promise<boolean>((resolve) =>
      heldCreates.push({ owner, resolve }),
    );
    if (shouldFail) {
      throw Error("synthetic-private-create-secret-token");
    }
  }
  if (failCreateOwner === owner) {
    throw Error("synthetic-private-create-secret-token");
  }
  return ownersByScope[owner].create(context);
}

async function onPutAway(closed: CloudWorkspacePutAway) {
  const owner = ownerOf(closed.context),
    snap = closed.session.snapshot();
  putAways.push({
    owner,
    noteId: snap.noteId,
    retained: snap.retained,
    closed: snap.closed,
    bodyMarkdown: snap.bodyMarkdown,
  });
  if (failPutAwayCallback) {
    throw Error("synthetic-private-put-away-secret-token");
  }
  ownersByScope[owner].putAway(closed);
}

function recordComponentGetterCall() {
  const stack = Error().stack ?? "";
  if (
    stack.includes("cloud-workspace.tsx") ||
    stack.includes("cloud-cached-library.tsx") ||
    stack.includes("cloud-conflict-preview.tsx")
  ) {
    getterCalls++;
  }
}

function buildGetterScope(): CloudScope {
  const scope = {
    version: 1 as const,
    collectionId: scopes[selected].collectionId,
    modeGeneration: scopes[selected].modeGeneration,
  } as CloudScope;
  Object.defineProperty(scope, "ownerSubject", {
    enumerable: true,
    get() {
      recordComponentGetterCall();
      return scopes[selected].ownerSubject;
    },
  });
  return scope;
}

function buildGetterContext(): CloudLibraryContext {
  if (getterPreset === "workspace-scope-getter") {
    return {
      store: wrappedStores[selected],
      scope: buildGetterScope(),
    };
  }
  const ctx = {
    store: wrappedStores[selected],
  } as CloudLibraryContext;
  Object.defineProperty(ctx, "scope", {
    enumerable: true,
    get() {
      recordComponentGetterCall();
      return scopes[selected];
    },
  });
  return ctx;
}

const root = createRoot(document.getElementById("fixture")!);

function render() {
  const signal = controllers[selected].signal;
  flushSync(() => {
    if (viewMode !== "workspace") {
      const libraryScope =
        getterPreset === "library-scope-getter"
          ? buildGetterScope()
          : scopes[selected];
      root.render(
        <StrictMode>
          <CloudCachedLibrary
            store={wrappedStores[selected]}
            scope={libraryScope}
            signal={signal}
            refreshKey={refreshKey}
            onOpen={(sel) => void onOpen(sel)}
            onCreate={(ctx) => void onCreate(ctx)}
            onInspectConflict={
              viewMode === "library-no-inspect"
                ? undefined
                : async (sel) => {
                    standaloneInspectCalls.push({
                      ownerSubject: sel.scope.ownerSubject,
                      noteId: sel.noteId,
                      frozen:
                        Object.isFrozen(sel) && Object.isFrozen(sel.scope),
                    });
                    throw Error("synthetic-private-inspect-secret-token");
                  }
            }
          />
        </StrictMode>,
      );
      return;
    }

    const activeContext =
      getterPreset === "workspace-context-getter" ||
      getterPreset === "workspace-scope-getter"
        ? buildGetterContext()
        : (mutableContextOverride ?? libraryContexts[selected]);

    root.render(
      <StrictMode>
        <CloudWorkspace
          context={activeContext}
          signal={signal}
          refreshKey={refreshKey}
          connection={connectionState}
          onOpen={onOpen}
          onCreate={onCreate}
          onPutAway={onPutAway}
        />
      </StrictMode>,
    );
  });
}

const api = {
  selectScope(owner: 0 | 1 | 2 | 3) {
    controllers[selected].abort();
    const nextController = new AbortController();
    controllers[owner] = nextController;
    const nextOwners = new CloudLibraryOwners(
      libraryContexts[owner],
      senders[owner],
      nextController.signal,
    );
    ownersByScope[owner] = nextOwners;
    allOwners.add(nextOwners);
    nextOwners.subscribe(() => {
      if (
        !nextOwners.signal.aborted &&
        selected === owner &&
        ownersByScope[owner] === nextOwners &&
        refreshKey >= 0
      ) {
        refreshKey++;
        render();
      }
    });
    selected = owner;
    refreshKey = 0;
    getterPreset = "none";
    mutableContextOverride = null;
    render();
  },
  setViewMode(mode: ViewMode) {
    viewMode = mode;
    getterPreset = "none";
    render();
  },
  setGetterPreset(preset: GetterPreset) {
    getterPreset = preset;
    render();
  },
  getterCalls: () => getterCalls,
  resetGetterCalls() {
    getterCalls = 0;
  },
  mountMutableContextAndCorruptInPlace() {
    mutableContextOverride = {
      store: wrappedStores[selected],
      scope: { ...scopes[selected] },
    };
    render();
    mutableContextOverride.store = wrappedStores[1];
    mutableContextOverride.scope.ownerSubject =
      "mutated-attacker-owner-subject";
    mutableContextOverride.scope.collectionId = "mutated-attacker-collection";
  },
  triggerRerender() {
    render();
  },
  clearMutableContext() {
    mutableContextOverride = null;
    render();
  },
  setConnection(kind: CloudWorkspaceConnectionKind | null) {
    connectionState = kind === null ? undefined : Object.freeze({ kind });
    render();
  },
  abortCurrent() {
    controllers[selected].abort();
  },
  refresh() {
    refreshKey = refreshKey >= 0 ? refreshKey + 1 : 0;
    render();
  },
  setInvalidRefresh() {
    refreshKey = -1;
    render();
  },
  setForbidCommits(value: boolean) {
    forbidCommits = value;
  },
  counts: () => ({
    reads: [...readCounts],
    lists: [...listCounts],
    commits: [...commitCounts],
    closes: [...closeCounts],
  }),
  copied: () => [...copiedCalls],
  clearCopied() {
    copiedCalls.length = 0;
  },
  setClipboardBehavior(options: { hold?: boolean; fail?: boolean }) {
    if (typeof options.hold === "boolean") holdClipboard = options.hold;
    if (typeof options.fail === "boolean") failClipboard = options.fail;
  },
  heldClipboardCount: () => heldClipboard.length,
  releaseClipboard(fail = false) {
    holdClipboard = false;
    for (const release of heldClipboard.splice(0)) release(fail);
  },
  holdReads(owner: number | null) {
    holdReadOwner = owner;
  },
  failReads(owner: number | null) {
    failReadOwner = owner;
  },
  heldReads: () => heldReads.map(({ owner, noteId }) => ({ owner, noteId })),
  releaseReads(fail = false) {
    holdReadOwner = null;
    for (const item of heldReads.splice(0)) item.resolve(fail);
  },
  releaseFirstRead(fail = false) {
    const first = heldReads.shift();
    first?.resolve(fail);
  },
  holdLists(owner: number | null) {
    holdListOwner = owner;
  },
  failLists(owner: number | null) {
    failListOwner = owner;
  },
  heldLists: () =>
    heldLists.map(({ owner, collection }) => ({ owner, collection })),
  releaseLists(fail = false) {
    holdListOwner = null;
    for (const item of heldLists.splice(0)) item.resolve(fail);
  },
  holdCommit(owner: number | null) {
    holdCommitOwner = owner;
  },
  heldCommitsCount: () => heldCommits.length,
  releaseCommits() {
    holdCommitOwner = null;
    for (const release of heldCommits.splice(0)) release();
  },
  failRetention(owner: number, value: boolean) {
    retentionFailures[owner] = value;
  },
  failPutAway(value: boolean) {
    failPutAwayCallback = value;
  },
  putAways: () => [...putAways],
  standaloneInspectCalls: () => [...standaloneInspectCalls],
  holdOpen(owner: number | null) {
    holdOpenOwner = owner;
  },
  failOpen(owner: number | null) {
    failOpenOwner = owner;
  },
  heldOpens: () => heldOpens.map(({ owner, noteId }) => ({ owner, noteId })),
  releaseOpens(fail = false) {
    holdOpenOwner = null;
    for (const item of heldOpens.splice(0)) item.resolve(fail);
  },
  holdCreate(owner: number | null) {
    holdCreateOwner = owner;
  },
  failCreate(owner: number | null) {
    failCreateOwner = owner;
  },
  heldCreatesCount: () => heldCreates.length,
  releaseCreates(fail = false) {
    holdCreateOwner = null;
    for (const item of heldCreates.splice(0)) item.resolve(fail);
  },
  latestCreatedNoteId(owner = 0): string | null {
    const retained = ownersByScope[owner].retainedOwners();
    return retained.length
      ? retained[retained.length - 1].session.snapshot().noteId
      : null;
  },
  readState: (
    owner: 0 | 1 | 2 | 3,
    noteId: string,
  ): Promise<CloudClientState | null> => seedClients[owner].get(noteId),
  async replaceConflictWithSaved(noteId: string, bodyMarkdown: string) {
    const prevForbid = forbidCommits;
    forbidCommits = false;
    try {
      const current = await seedClients[0].get(noteId);
      if (!current) throw Error("Missing conflict note");
      const resolved = await seedClients[0].resolve(
        noteId,
        current.generation,
        {
          kind: "upsert",
          snapshot: makeDraft(
            noteId,
            bodyMarkdown,
            "active",
            "2026-10-29T18:00:00.000Z",
          ),
        },
      );
      const prepared = await seedClients[0].prepare(
        noteId,
        resolved.generation,
        `op-${noteId}-resolved`,
      );
      await seedClients[0].acknowledge(noteId, cloudAck(prepared));
    } finally {
      forbidCommits = prevForbid;
    }
  },
  async destroy() {
    destroying = true;
    forbidCommits = false;
    for (const controller of controllers) controller.abort();
    root.unmount();
    api.releaseClipboard(false);
    api.releaseReads(false);
    api.releaseLists(false);
    api.releaseCommits();
    api.releaseOpens(false);
    api.releaseCreates(false);
    retentionFailures.fill(false);
    failPutAwayCallback = false;
    for (const owners of allOwners) {
      await Promise.allSettled(
        owners.retainedOwners().map((upload) => upload.session.flush()),
      );
      await Promise.allSettled(
        owners.retainedOwners().map((upload) => upload.upload()),
      );
    }
    await Promise.all(rawStores.map((store) => store.close()));
    await Promise.all(names.map((name) => deleteDB(name)));
  },
};

render();

declare global {
  interface Window {
    cloudWorkspaceConflictInspectionFixture: typeof api;
  }
}
window.cloudWorkspaceConflictInspectionFixture = api;
