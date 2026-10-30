import "@vitejs/plugin-react/preamble";
import "../../apps/web/src/styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { deleteDB, openDB } from "idb";
import type { CloudLibraryContext } from "../../apps/web/src/cloud-cached-library";
import { CloudConflictPreview } from "../../apps/web/src/cloud-conflict-preview";
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
import { cloudAck, cloudScope } from "./cloud-durable-contract";

// Never imported by apps/web/src/main.tsx. Uses only explicit test-owned M0 IndexedDB namespaces and a fake clipboard.
const prefix = new URL(location.href).searchParams.get("db");
if (!prefix || !/^peel-m0-cloud-conflict-[a-z0-9-]+$/.test(prefix))
  throw Error(
    "An explicit synthetic conflict-preview database namespace is required",
  );

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
      if (shouldFail) throw Error("synthetic-private-clipboard-secret-token");
    },
  },
});

const names = [`${prefix}-a`, `${prefix}-b`, `${prefix}-c`, `${prefix}-d`],
  rawStores = names.map((name) => new IndexedDBCloudStateStore(name)),
  scopes: CloudScope[] = [
    {
      ...cloudScope,
      ownerSubject: "synthetic-conflict-owner-a",
      collectionId: "synthetic-conflict-library",
      modeGeneration: 1,
    },
    {
      ...cloudScope,
      ownerSubject: "synthetic-conflict-owner-b",
      collectionId: "synthetic-conflict-library",
      modeGeneration: 1,
    },
    {
      ...cloudScope,
      ownerSubject: "synthetic-conflict-owner-a",
      collectionId: "synthetic-conflict-library-alt",
      modeGeneration: 1,
    },
    {
      ...cloudScope,
      ownerSubject: "synthetic-conflict-owner-a",
      collectionId: "synthetic-conflict-library",
      modeGeneration: 2,
    },
  ];

let holdReadOwner: number | null = null,
  failReadOwner: number | null = null,
  readCount = 0,
  unexpectedWrites = 0,
  unexpectedCloses = 0,
  setupPhase = true;
const heldReads: Array<(fail: boolean) => void> = [];

const wrappedStores: CloudLibraryStateStore[] = rawStores.map(
  (store, index) => ({
    async read(scope, noteId) {
      readCount++;
      const shouldFail = failReadOwner === index;
      const value = await store.read(scope, noteId);
      if (holdReadOwner === index) {
        await new Promise<void>((resolve, reject) => {
          heldReads.push((error) =>
            error
              ? reject(Error("synthetic-private-read-secret-token"))
              : resolve(),
          );
        });
      }
      if (shouldFail) throw Error("synthetic-private-read-secret-token");
      return value;
    },
    async commit(...args) {
      if (!setupPhase) {
        unexpectedWrites++;
        throw Error("CloudConflictPreview must never write storage");
      }
      return store.commit(...args);
    },
    async close() {
      if (!setupPhase) {
        unexpectedCloses++;
        throw Error("CloudConflictPreview must never close storage");
      }
      return store.close();
    },
    listLibrary: (scope, request) => store.listLibrary(scope, request),
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
  (store, index) => new DurableCloudClient(store, scopes[index]),
);

async function seedIfMissing() {
  const clientA = seedClients[0];
  if (!(await clientA.get("conflict-active"))) {
    const s0 = await clientA.save(
      "conflict-active",
      {
        kind: "upsert",
        snapshot: makeDraft(
          "conflict-active",
          "# Shopping list\n- Initial item",
        ),
      },
      null,
    );
    const p0 = await clientA.prepare(
      "conflict-active",
      s0.generation,
      "op-ca-1",
    );
    const a0 = await clientA.acknowledge("conflict-active", cloudAck(p0, 1));
    const s1 = await clientA.save(
      "conflict-active",
      {
        kind: "upsert",
        snapshot: makeDraft(
          "conflict-active",
          "# Shopping list\n- Local oat milk\n- Matcha powder 原文 ##home",
          "active",
          "2026-10-29T12:00:00.000Z",
        ),
      },
      a0.generation,
    );
    const p1 = await clientA.prepare(
      "conflict-active",
      s1.generation,
      "op-ca-2",
    );
    await clientA.conflict("conflict-active", {
      ...cloudAck(p1, 2),
      snapshot: {
        ...makeDraft(
          "conflict-active",
          "# Shopping list\n- Observed almond milk\n- Sencha tea ##home",
          "active",
          "2026-10-29T12:05:00.000Z",
        ),
        serverRevision: 2,
      },
    });
  }

  if (!(await clientA.get("conflict-lifecycle"))) {
    const s0 = await clientA.save(
      "conflict-lifecycle",
      {
        kind: "upsert",
        snapshot: makeDraft("conflict-lifecycle", "# Quarterly archive\nBase"),
      },
      null,
    );
    const p0 = await clientA.prepare(
      "conflict-lifecycle",
      s0.generation,
      "op-cl-1",
    );
    const a0 = await clientA.acknowledge("conflict-lifecycle", cloudAck(p0, 1));
    const s1 = await clientA.save(
      "conflict-lifecycle",
      {
        kind: "upsert",
        snapshot: makeDraft(
          "conflict-lifecycle",
          "# Quarterly archive\nArchived on laptop",
          "archived",
          "2026-10-29T13:00:00.000Z",
        ),
      },
      a0.generation,
    );
    const p1 = await clientA.prepare(
      "conflict-lifecycle",
      s1.generation,
      "op-cl-2",
    );
    await clientA.conflict("conflict-lifecycle", {
      ...cloudAck(p1, 3),
      snapshot: {
        ...makeDraft(
          "conflict-lifecycle",
          "# Quarterly archive\nMoved to Trash on phone",
          "trashed",
          "2026-10-29T13:10:00.000Z",
        ),
        serverRevision: 3,
      },
    });
  }

  if (!(await clientA.get("conflict-remote-purged"))) {
    const s0 = await clientA.save(
      "conflict-remote-purged",
      {
        kind: "upsert",
        snapshot: makeDraft("conflict-remote-purged", "# Base before purge"),
      },
      null,
    );
    const p0 = await clientA.prepare(
      "conflict-remote-purged",
      s0.generation,
      "op-crp-1",
    );
    const a0 = await clientA.acknowledge(
      "conflict-remote-purged",
      cloudAck(p0, 1),
    );
    const s1 = await clientA.save(
      "conflict-remote-purged",
      {
        kind: "upsert",
        snapshot: makeDraft(
          "conflict-remote-purged",
          "# Recoverable local draft\nKeep this text safe on this device",
        ),
      },
      a0.generation,
    );
    const p1 = await clientA.prepare(
      "conflict-remote-purged",
      s1.generation,
      "op-crp-2",
    );
    await clientA.conflict("conflict-remote-purged", {
      ...cloudAck(p1, 2),
      snapshot: null,
    });
  }

  if (!(await clientA.get("conflict-local-purged"))) {
    const s0 = await clientA.save(
      "conflict-local-purged",
      {
        kind: "upsert",
        snapshot: makeDraft(
          "conflict-local-purged",
          "# Base before local purge",
        ),
      },
      null,
    );
    const p0 = await clientA.prepare(
      "conflict-local-purged",
      s0.generation,
      "op-clp-1",
    );
    const a0 = await clientA.acknowledge(
      "conflict-local-purged",
      cloudAck(p0, 1),
    );
    const s1 = await clientA.save(
      "conflict-local-purged",
      { kind: "purge", snapshot: null },
      a0.generation,
    );
    const p1 = await clientA.prepare(
      "conflict-local-purged",
      s1.generation,
      "op-clp-2",
    );
    await clientA.conflict("conflict-local-purged", {
      ...cloudAck(p1, 2),
      snapshot: {
        ...makeDraft(
          "conflict-local-purged",
          "# Remote note kept alive\nEdited elsewhere before purge",
          "active",
        ),
        serverRevision: 2,
      },
    });
  }

  if (!(await clientA.get("conflict-empty-remote"))) {
    const s0 = await clientA.save(
      "conflict-empty-remote",
      {
        kind: "upsert",
        snapshot: makeDraft("conflict-empty-remote", "# Base before blanking"),
      },
      null,
    );
    const p0 = await clientA.prepare(
      "conflict-empty-remote",
      s0.generation,
      "op-cer-1",
    );
    const a0 = await clientA.acknowledge(
      "conflict-empty-remote",
      cloudAck(p0, 1),
    );
    const s1 = await clientA.save(
      "conflict-empty-remote",
      {
        kind: "upsert",
        snapshot: makeDraft(
          "conflict-empty-remote",
          "# Trashed local draft\nStill has text",
          "trashed",
        ),
      },
      a0.generation,
    );
    const p1 = await clientA.prepare(
      "conflict-empty-remote",
      s1.generation,
      "op-cer-2",
    );
    await clientA.conflict("conflict-empty-remote", {
      ...cloudAck(p1, 2),
      snapshot: {
        ...makeDraft("conflict-empty-remote", "", "active"),
        serverRevision: 2,
      },
    });
  }

  if (!(await clientA.get("conflict-literal-html"))) {
    const s0 = await clientA.save(
      "conflict-literal-html",
      {
        kind: "upsert",
        snapshot: makeDraft(
          "conflict-literal-html",
          '<script>window.__pwnedLocal = true</script>\n<img src=x onerror="window.__pwnedImg=1">\n**Literal** `markdown` 原文',
        ),
      },
      null,
    );
    const conflicted = applyRemoteCloudHead(s0, {
      revision: 1,
      snapshot: {
        ...makeDraft(
          "conflict-literal-html",
          '<svg onload="window.__pwnedRemote = true"></svg>\n# Heading stays literal\n' +
            "LONGTOKEN_".repeat(22),
        ),
        serverRevision: 1,
      },
    });
    await rawStores[0].commit(
      scopes[0],
      "conflict-literal-html",
      s0.generation,
      conflicted,
    );
  }

  if (!(await clientA.get("note-saved"))) {
    const s0 = await clientA.save(
      "note-saved",
      {
        kind: "upsert",
        snapshot: makeDraft("note-saved", "# Confirmed note\nNo conflict"),
      },
      null,
    );
    const p0 = await clientA.prepare("note-saved", s0.generation, "op-ns-1");
    await clientA.acknowledge("note-saved", cloudAck(p0, 1));
  }

  if (!(await clientA.get("note-pending"))) {
    const s0 = await clientA.save(
      "note-pending",
      {
        kind: "upsert",
        snapshot: makeDraft("note-pending", "# Pending draft\nIn flight"),
      },
      null,
    );
    const p0 = await clientA.prepare("note-pending", s0.generation, "op-np-1");
    // Deferred remote observation while inFlight is still unacknowledged: state.conflict remains null.
    const withDeferredObserved = applyRemoteCloudHead(p0, {
      revision: 1,
      snapshot: {
        ...makeDraft("note-pending", "# Deferred remote head while sending"),
        serverRevision: 1,
      },
    });
    await rawStores[0].commit(
      scopes[0],
      "note-pending",
      p0.generation,
      withDeferredObserved,
    );
  }

  if (!(await clientA.get("note-deleted"))) {
    const s0 = await clientA.save(
      "note-deleted",
      {
        kind: "upsert",
        snapshot: makeDraft("note-deleted", "# Soon deleted"),
      },
      null,
    );
    const p0 = await clientA.prepare("note-deleted", s0.generation, "op-nd-1");
    const a0 = await clientA.acknowledge("note-deleted", cloudAck(p0, 1));
    const s1 = await clientA.save(
      "note-deleted",
      { kind: "purge", snapshot: null },
      a0.generation,
    );
    const p1 = await clientA.prepare("note-deleted", s1.generation, "op-nd-2");
    await clientA.acknowledge("note-deleted", cloudAck(p1, 2));
  }

  const clientB = seedClients[1];
  if (!(await clientB.get("conflict-active"))) {
    const s0 = await clientB.save(
      "conflict-active",
      {
        kind: "upsert",
        snapshot: makeDraft(
          "conflict-active",
          "# Account B private local draft\nDo not leak across scopes",
        ),
      },
      null,
    );
    const conflictedB = applyRemoteCloudHead(s0, {
      revision: 1,
      snapshot: {
        ...makeDraft(
          "conflict-active",
          "# Account B private observed Cloud\nScoped to owner B",
        ),
        serverRevision: 1,
      },
    });
    await rawStores[1].commit(
      scopes[1],
      "conflict-active",
      s0.generation,
      conflictedB,
    );
  }

  const clientC = seedClients[2];
  if (!(await clientC.get("conflict-active"))) {
    const s0 = await clientC.save(
      "conflict-active",
      {
        kind: "upsert",
        snapshot: makeDraft(
          "conflict-active",
          "# Alternate collection local draft\nIsolated by collectionId",
          "active",
          "2026-10-29T10:00:00.000Z",
          scopes[2].collectionId,
        ),
      },
      null,
    );
    const conflictedC = applyRemoteCloudHead(s0, {
      revision: 1,
      snapshot: {
        ...makeDraft(
          "conflict-active",
          "# Alternate collection observed Cloud\nScoped to alt collection",
          "active",
          "2026-10-29T10:05:00.000Z",
          scopes[2].collectionId,
        ),
        serverRevision: 1,
      },
    });
    await rawStores[2].commit(
      scopes[2],
      "conflict-active",
      s0.generation,
      conflictedC,
    );
  }

  const clientD = seedClients[3];
  if (!(await clientD.get("conflict-active"))) {
    const s0 = await clientD.save(
      "conflict-active",
      {
        kind: "upsert",
        snapshot: makeDraft(
          "conflict-active",
          "# Generation 2 local draft\nIsolated by modeGeneration",
        ),
      },
      null,
    );
    const conflictedD = applyRemoteCloudHead(s0, {
      revision: 4,
      snapshot: {
        ...makeDraft(
          "conflict-active",
          "# Generation 2 observed Cloud\nScoped to modeGeneration 2",
        ),
        serverRevision: 4,
      },
    });
    await rawStores[3].commit(
      scopes[3],
      "conflict-active",
      s0.generation,
      conflictedD,
    );
  }
}

await seedIfMissing();
setupPhase = false;

const root = createRoot(document.getElementById("fixture")!);
let selectedOwner = 0,
  currentScope: CloudScope = { ...scopes[0] },
  currentContext: CloudLibraryContext = {
    store: wrappedStores[0],
    scope: currentScope,
  },
  customContext: unknown = null,
  currentNoteId = "conflict-active",
  currentController = new AbortController(),
  currentRefreshKey = 0,
  getterCalls = 0,
  mounted = true;

function render() {
  const contextProp = (customContext ?? currentContext) as CloudLibraryContext;
  flushSync(() => {
    root.render(
      <StrictMode>
        {mounted && (
          <CloudConflictPreview
            context={contextProp}
            noteId={currentNoteId}
            signal={currentController.signal}
            refreshKey={currentRefreshKey}
          />
        )}
      </StrictMode>,
    );
  });
}

const api = {
  select(
    owner: number,
    noteId = currentNoteId,
    options?: { mutateScopeInPlace?: boolean; newSignal?: boolean },
  ) {
    customContext = null;
    selectedOwner = owner;
    if (options?.mutateScopeInPlace) {
      Object.assign(currentScope, scopes[owner]);
      currentContext = {
        store: wrappedStores[owner],
        scope: currentScope,
      };
    } else {
      currentScope = { ...scopes[owner] };
      currentContext = Object.freeze({
        store: wrappedStores[owner],
        scope: Object.freeze({ ...currentScope }),
      });
    }
    currentNoteId = noteId;
    if (options?.newSignal) currentController = new AbortController();
    render();
  },
  setNote(noteId: string) {
    customContext = null;
    currentNoteId = noteId;
    render();
  },
  refresh() {
    currentRefreshKey++;
    render();
  },
  setRefreshKey(value: number) {
    currentRefreshKey = value;
    render();
  },
  abort() {
    currentController.abort();
  },
  resetSignal() {
    currentController = new AbortController();
    render();
  },
  renderPreAborted() {
    const preAborted = new AbortController();
    preAborted.abort();
    currentController = preAborted;
    render();
  },
  getterCalls: () => getterCalls,
  setMalformedPreset(
    preset:
      | "invalid-scope"
      | "foreign-scope"
      | "foreign-generation"
      | "invalid-note-id"
      | "null-context"
      | "context-getter"
      | "scope-getter",
  ) {
    if (preset === "invalid-scope") {
      customContext = {
        store: wrappedStores[selectedOwner],
        scope: { ...scopes[selectedOwner], modeGeneration: 0 },
      };
    } else if (preset === "foreign-scope") {
      customContext = {
        store: wrappedStores[selectedOwner],
        scope: { ...scopes[1] },
      };
    } else if (preset === "foreign-generation") {
      customContext = {
        store: wrappedStores[selectedOwner],
        scope: { ...scopes[selectedOwner], modeGeneration: 99 },
      };
    } else if (preset === "invalid-note-id") {
      customContext = null;
      currentNoteId = "invalid note id!";
    } else if (preset === "null-context") {
      customContext = null;
      flushSync(() => {
        root.render(
          <StrictMode>
            <CloudConflictPreview
              context={null as unknown as CloudLibraryContext}
              noteId={currentNoteId}
              signal={currentController.signal}
              refreshKey={currentRefreshKey}
            />
          </StrictMode>,
        );
      });
      return;
    } else if (preset === "context-getter") {
      const target: Record<string, unknown> = {
        store: wrappedStores[selectedOwner],
      };
      Object.defineProperty(target, "scope", {
        enumerable: true,
        get() {
          if (
            (Error().stack ?? "").includes("/src/cloud-conflict-preview.tsx")
          ) {
            getterCalls++;
          }
          return scopes[selectedOwner];
        },
      });
      customContext = target;
    } else if (preset === "scope-getter") {
      const scopeWithGetter: Record<string, unknown> = {
        version: 1,
        collectionId: scopes[selectedOwner].collectionId,
        modeGeneration: 1,
      };
      Object.defineProperty(scopeWithGetter, "ownerSubject", {
        enumerable: true,
        get() {
          if (
            (Error().stack ?? "").includes("/src/cloud-conflict-preview.tsx")
          ) {
            getterCalls++;
          }
          return scopes[selectedOwner].ownerSubject;
        },
      });
      customContext = {
        store: wrappedStores[selectedOwner],
        scope: scopeWithGetter,
      };
    }
    render();
  },
  holdReads(owner: number | null) {
    holdReadOwner = owner;
  },
  heldReadCount: () => heldReads.length,
  releaseReads(fail = false) {
    holdReadOwner = null;
    for (const resume of heldReads.splice(0)) resume(fail);
  },
  failReads(owner: number | null) {
    failReadOwner = owner;
  },
  readCount: () => readCount,
  unexpectedWrites: () => unexpectedWrites,
  unexpectedCloses: () => unexpectedCloses,
  async readStoredState(
    owner: number,
    noteId: string,
  ): Promise<CloudClientState | null> {
    return rawStores[owner].read(scopes[owner], noteId);
  },
  async updateActiveConflictBodies(localBody: string, remoteBody: string) {
    setupPhase = true;
    try {
      const prev = (await rawStores[0].read(scopes[0], "conflict-active"))!;
      const next: CloudClientState = {
        ...prev,
        generation: prev.generation + 1,
        current: {
          kind: "upsert",
          snapshot: makeDraft(
            "conflict-active",
            localBody,
            "active",
            "2026-10-29T14:00:00.000Z",
          ),
        },
        conflict: {
          local: {
            kind: "upsert",
            snapshot: makeDraft(
              "conflict-active",
              localBody,
              "active",
              "2026-10-29T14:00:00.000Z",
            ),
          },
          remote: {
            ...makeDraft(
              "conflict-active",
              remoteBody,
              "active",
              "2026-10-29T14:05:00.000Z",
            ),
            serverRevision: prev.conflict!.remoteRevision,
          },
          remoteRevision: prev.conflict!.remoteRevision,
        },
      };
      await rawStores[0].commit(
        scopes[0],
        "conflict-active",
        prev.generation,
        next,
      );
    } finally {
      setupPhase = false;
    }
  },
  async corruptNote(owner: number, noteId: string) {
    const previous = await rawStores[owner].read(scopes[owner], noteId);
    const db = await openDB(names[owner]);
    try {
      await db.put("states", { ...previous, noteId, version: 3 });
    } finally {
      db.close();
    }
    api.refresh();
  },
  async closeUnderlyingStore(owner: number) {
    await rawStores[owner].close();
    api.refresh();
  },
  holdClipboard(value: boolean) {
    holdClipboard = value;
  },
  failClipboard(value: boolean) {
    failClipboard = value;
  },
  heldClipboardCount: () => heldClipboard.length,
  releaseNextClipboard(fail = false) {
    const next = heldClipboard.shift();
    if (next) next(fail);
  },
  releaseAllClipboard(fail = false) {
    holdClipboard = false;
    for (const next of heldClipboard.splice(0)) next(fail);
  },
  copiedCalls: () => [...copiedCalls],
  clearCopiedCalls() {
    copiedCalls.length = 0;
  },
  unmount() {
    mounted = false;
    render();
  },
  async destroy() {
    setupPhase = true;
    holdReadOwner = null;
    failReadOwner = null;
    failClipboard = false;
    api.releaseReads(false);
    api.releaseAllClipboard(false);
    root.unmount();
    await Promise.all(rawStores.map((store) => store.close().catch(() => {})));
    await Promise.all(names.map((name) => deleteDB(name)));
  },
};

render();

declare global {
  interface Window {
    cloudConflictPreviewFixture: typeof api;
  }
}

window.cloudConflictPreviewFixture = api;
