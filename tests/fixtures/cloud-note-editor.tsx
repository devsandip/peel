import "@vitejs/plugin-react/preamble";
import "../../apps/web/src/styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { deleteDB } from "idb";
import { CloudNoteEditor } from "../../apps/web/src/cloud-note-editor";
import { CloudDraftSession } from "../../apps/web/src/cloud-draft-session";
import {
  DurableCloudClient,
  type CloudStateStore,
} from "../../packages/cloud-protocol/src/durable";
import { IndexedDBCloudStateStore } from "../../packages/cloud-protocol/src/store-idb";
import { acknowledgeCloudMutation } from "../../packages/cloud-protocol/src/index";
import { cloudDraft, cloudScope } from "./cloud-durable-contract";

const prefix = new URL(location.href).searchParams.get("db");
if (!prefix || !/^peel-m0-cloud-editor-[a-z0-9-]+$/.test(prefix))
  throw Error("Explicit synthetic editor namespace required");
const failures = [false, false],
  names = [`${prefix}-a`, `${prefix}-b`],
  stores = names.map(
    (name, owner) =>
      new IndexedDBCloudStateStore(name, () => {
        if (failures[owner])
          throw Error("synthetic private retention exception");
      }),
  ),
  scopes = [0, 1].map((owner) => ({
    ...cloudScope,
    ownerSubject: `synthetic-editor-owner-${owner}`,
  })),
  clients = stores.map(
    (store, owner) => new DurableCloudClient(store, scopes[owner]),
  ),
  id = cloudDraft("").noteId;
let heldOwner: number | null = null;
const held: Array<() => void> = [],
  opened = new Set<CloudDraftSession>(),
  owners = new Map<CloudDraftSession, number>();
const wrappers: CloudStateStore[] = stores.map((store, owner) => ({
  read: (...args) => store.read(...args),
  async commit(...args) {
    if (heldOwner === owner)
      await new Promise<void>((resolve) => held.push(resolve));
    return store.commit(...args);
  },
  close: () => store.close(),
}));
for (let owner = 0; owner < 2; owner++)
  if (!(await clients[owner].get(id)))
    await clients[owner].save(
      id,
      {
        kind: "upsert",
        snapshot: cloudDraft(`Account ${owner === 0 ? "A" : "B"} fixture`),
      },
      null,
    );
const root = createRoot(document.getElementById("fixture")!);
let session: CloudDraftSession,
  selected = 0,
  refreshKey = 0,
  shown = true,
  failDismiss = false;
const dismissals: number[] = [];
function render() {
  flushSync(() =>
    root.render(
      <StrictMode>
        {shown ? (
          <CloudNoteEditor
            session={session}
            refreshKey={refreshKey}
            onPutAway={async (origin) => {
              dismissals.push(owners.get(origin)!);
              if (failDismiss)
                throw Error("synthetic private dismissal exception");
              if (origin === session) {
                shown = false;
                render();
              }
            }}
          />
        ) : (
          <p>Note put away</p>
        )}
      </StrictMode>,
    ),
  );
}
const api = {
  async select(owner: number) {
    const next = await CloudDraftSession.open(
      wrappers[owner],
      scopes[owner],
      id,
    );
    opened.add(next);
    owners.set(next, owner);
    selected = owner;
    session = next;
    shown = true;
    refreshKey = 0;
    render();
  },
  read: (owner: number) => clients[owner].get(id),
  snapshot: () => session.snapshot(),
  async flush() {
    await session.flush();
  },
  refresh() {
    refreshKey++;
    render();
  },
  invalid() {
    refreshKey = -1;
    render();
  },
  fail(value: boolean) {
    failures[selected] = value;
  },
  failDismiss(value: boolean) {
    failDismiss = value;
  },
  dismissals: () => [...dismissals],
  hold() {
    heldOwner = selected;
  },
  held: () => held.length,
  release() {
    heldOwner = null;
    for (const release of held.splice(0)) release();
  },
  async settle() {
    await Promise.allSettled([...opened].map((current) => current.flush()));
  },
  async prepare() {
    const state = (await clients[selected].get(id))!;
    await clients[selected].prepare(id, state.generation, crypto.randomUUID());
  },
  async acknowledge() {
    const state = (await clients[selected].get(id))!,
      op = state.inFlight!,
      revision = state.baseRevision + 1;
    // Controlled fixture receipt only; actual service evidence is in PR155.
    const next = acknowledgeCloudMutation(state, {
      opId: op.opId,
      contentHash: op.contentHash,
      revision,
      snapshot: op.snapshot
        ? { ...op.snapshot, serverRevision: revision }
        : null,
    });
    await stores[selected].commit(scopes[selected], id, state.generation, next);
    api.refresh();
  },
  async destroy() {
    root.unmount();
    api.release();
    failures.fill(false);
    await api.settle();
    await Promise.all(stores.map((store) => store.close()));
    await Promise.all(names.map((name) => deleteDB(name)));
  },
};
await api.select(0);
declare global {
  interface Window {
    cloudEditorFixture: typeof api;
  }
}
window.cloudEditorFixture = api;
