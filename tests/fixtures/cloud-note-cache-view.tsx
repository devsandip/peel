import "@vitejs/plugin-react/preamble";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { deleteDB, openDB } from "idb";
import { CloudNoteCacheView } from "../../apps/web/src/cloud-note-cache-view";
import { CloudDraftSession } from "../../apps/web/src/cloud-draft-session";
import {
  DurableCloudClient,
  type CloudScope,
  type CloudStateStore,
} from "../../packages/cloud-protocol/src/durable";
import { IndexedDBCloudStateStore } from "../../packages/cloud-protocol/src/store-idb";
import { acknowledgeCloudMutation } from "../../packages/cloud-protocol/src/index";
import { cloudDraft, cloudScope } from "./cloud-durable-contract";

// This entry is never imported by the app. All databases are explicitly test-owned.
const prefix = new URL(location.href).searchParams.get("db");
if (!prefix || !/^peel-m0-cloud-panel-[a-z0-9-]+$/.test(prefix))
  throw Error("An explicit synthetic database namespace is required");
let failDraftWrites = false,
  holdDraftWrites = false;
const heldWrites: Array<() => void> = [];
let draftSession: CloudDraftSession | null = null;
const names = [`${prefix}-a`, `${prefix}-b`],
  stores = names.map(
    (name) =>
      new IndexedDBCloudStateStore(name, () => {
        if (failDraftWrites) throw Error("synthetic private retention error");
      }),
  ),
  scopes: CloudScope[] = [
    { ...cloudScope, ownerSubject: "synthetic-panel-owner-a" },
    { ...cloudScope, ownerSubject: "synthetic-panel-owner-b" },
  ],
  noteId = cloudDraft("").noteId,
  clients = stores.map((store, i) => new DurableCloudClient(store, scopes[i]));
let holdOwner: number | null = null,
  failReads = false,
  reads = 0;
const held: Array<(fail: boolean) => void> = [];
const wrappers: CloudStateStore[] = stores.map((store, i) => ({
  async read(scope, id) {
    reads++;
    const fail = failReads,
      value = await store.read(scope, id);
    if (holdOwner === i)
      await new Promise<void>((resolve, reject) => {
        held.push((error) =>
          error ? reject(Error("synthetic private error payload")) : resolve(),
        );
      });
    if (fail) throw Error("synthetic private error payload");
    return value;
  },
  async commit(...args) {
    if (holdDraftWrites)
      await new Promise<void>((resolve) => heldWrites.push(resolve));
    return store.commit(...args);
  },
  close: () => store.close(),
}));
for (let i = 0; i < clients.length; i++) {
  for (const [id, body] of [
    [
      noteId,
      i === 0 ? "Account A private fixture" : "Account B private fixture",
    ],
    ["synthetic-other-note", "Other note fixture"],
  ]) {
    if (!(await clients[i].get(id)))
      await clients[i].save(
        id,
        { kind: "upsert", snapshot: { ...cloudDraft(body), noteId: id } },
        null,
      );
  }
}
const root = createRoot(document.getElementById("fixture")!);
let selected = 0,
  scope = { ...scopes[0] },
  id = noteId,
  refreshKey = 0,
  shown = true;
function render() {
  flushSync(() =>
    root.render(
      <StrictMode>
        {shown && (
          <CloudNoteCacheView
            store={wrappers[selected]}
            scope={scope}
            noteId={id}
            refreshKey={refreshKey}
          />
        )}
      </StrictMode>,
    ),
  );
}
const api = {
  select(owner: number, nextId = noteId, mutateScope = false) {
    selected = owner;
    if (mutateScope) Object.assign(scope, scopes[owner]);
    else scope = { ...scopes[owner] };
    id = nextId;
    render();
  },
  refresh() {
    refreshKey++;
    render();
  },
  hold(owner: number) {
    holdOwner = owner;
  },
  heldCount: () => held.length,
  readCount: () => reads,
  release(error = false) {
    holdOwner = null;
    for (const finish of held.splice(0)) finish(error);
  },
  fault(value: boolean) {
    failReads = value;
  },
  invalid(kind: "scope" | "refresh" | "foreign" | "generation") {
    if (kind === "scope") scope.modeGeneration = 0;
    if (kind === "generation") scope.modeGeneration++;
    if (kind === "refresh") refreshKey = -1;
    if (kind === "foreign") scope = { ...scopes[1 - selected] };
    render();
  },
  async save(body: string) {
    const client = clients[selected],
      previous = await client.get(id);
    await client.save(
      id,
      { kind: "upsert", snapshot: { ...cloudDraft(body), noteId: id } },
      previous?.generation ?? null,
    );
    api.refresh();
  },
  async prepare() {
    const client = clients[selected],
      previous = await client.get(id);
    await client.prepare(id, previous!.generation, crypto.randomUUID());
    api.refresh();
  },
  async acknowledge() {
    const store = stores[selected],
      previous = (await clients[selected].get(id))!,
      operation = previous.inFlight!;
    // Controlled browser-only receipt; actual SQLite server receipts are unit tested.
    const revision = previous.baseRevision + 1;
    const next = acknowledgeCloudMutation(previous, {
      opId: operation.opId,
      contentHash: operation.contentHash,
      revision,
      snapshot: operation.snapshot
        ? { ...operation.snapshot, serverRevision: revision }
        : null,
    });
    await store.commit(scope, id, previous.generation, next);
    api.refresh();
  },
  async closeStore() {
    await stores[selected].close();
    api.refresh();
  },
  async corrupt() {
    const previous = await clients[selected].get(id),
      db = await openDB(names[selected]);
    try {
      await db.put("states", { ...previous, version: 3 });
    } finally {
      db.close();
    }
    api.refresh();
  },
  unmount() {
    shown = false;
    render();
  },
  async draftOpen() {
    draftSession = await CloudDraftSession.open(wrappers[selected], scope, id);
  },
  draftEdit(body: string) {
    draftSession!.edit(body);
  },
  draftSnapshot: () => draftSession!.snapshot(),
  async draftFlush() {
    try {
      return await draftSession!.flush();
    } finally {
      api.refresh();
    }
  },
  async draftPutAway() {
    try {
      return await draftSession!.putAway();
    } finally {
      api.refresh();
    }
  },
  draftRefresh: () => draftSession!.refresh(),
  draftFail(value: boolean) {
    failDraftWrites = value;
  },
  draftHold() {
    holdDraftWrites = true;
  },
  draftHeld: () => heldWrites.length,
  draftRelease() {
    holdDraftWrites = false;
    for (const release of heldWrites.splice(0)) release();
  },
  async destroy() {
    api.draftRelease();
    failDraftWrites = false;
    api.release();
    root.unmount();
    await draftSession?.flush().catch(() => {});
    await Promise.all(stores.map((store) => store.close()));
    await Promise.all(names.map((name) => deleteDB(name)));
  },
};
render();
declare global {
  interface Window {
    cloudCacheFixture: typeof api;
  }
}
window.cloudCacheFixture = api;
