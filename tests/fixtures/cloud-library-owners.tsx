import "@vitejs/plugin-react/preamble";
import "../../apps/web/src/styles.css";
import { StrictMode, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { deleteDB } from "idb";
import { CloudLibraryOwners } from "../../apps/web/src/cloud-library-owners";
import { CloudWorkspace } from "../../apps/web/src/cloud-workspace";
import type { CloudNoteUpload } from "../../apps/web/src/cloud-note-upload";
import {
  DurableCloudClient,
  type CloudScope,
} from "../../packages/cloud-protocol/src/durable";
import type { CloudLibraryStateStore } from "../../packages/cloud-protocol/src/library-local";
import { IndexedDBCloudStateStore } from "../../packages/cloud-protocol/src/store-idb";
import { cloudDraft } from "./cloud-durable-contract";

const config = Reflect.get(window, "syntheticOwnersConfig") as {
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
  !/^peel-m0-cloud-library-owners-[a-z0-9-]+$/.test(prefix) ||
  config.contexts.length !== 2
)
  throw Error("Explicit owned Cloud parent fixture required");
const names = [`${prefix}-a`, `${prefix}-b`],
  failures = [false, false],
  stores = names.map(
    (name, owner) =>
      new IndexedDBCloudStateStore(name, () => {
        if (failures[owner]) throw Error("synthetic private local failure");
      }),
  ),
  controllers = stores.map(() => new AbortController()),
  heldReads: (() => void)[] = [],
  all = new Set<CloudNoteUpload>(),
  seen: CloudNoteUpload[] = [],
  closeCounts = [0, 0];
let selected = 0,
  holdRead: number | null = null;
const wrappers: CloudLibraryStateStore[] = stores.map((store, owner) => ({
    async read(...args) {
      const result = await store.read(...args);
      if (holdRead === owner)
        await new Promise<void>((resolve) => heldReads.push(resolve));
      return result;
    },
    commit: (...args) => store.commit(...args),
    listLibrary: (...args) => store.listLibrary(...args),
    async close() {
      closeCounts[owner]++;
      await store.close();
    },
  })),
  clients = stores.map(
    (store, owner) =>
      new DurableCloudClient(store, config.contexts[owner].scope),
  );
for (let owner = 0; owner < 2; owner++) {
  await clients[owner].save(
    "shared-note",
    {
      kind: "upsert",
      snapshot: {
        ...cloudDraft(
          `Account ${owner === 0 ? "A" : "B"} controller note\nPrivate body ${owner}`,
        ),
        noteId: "shared-note",
      },
    },
    null,
  );
}
const owners = wrappers.map(
  (store, owner) =>
    new CloudLibraryOwners(
      { store, scope: config.contexts[owner].scope },
      async (request, signal) => {
        const response = await fetch(config.api + "/v1/mutations", {
          method: "POST",
          credentials: "omit",
          redirect: "error",
          cache: "no-store",
          signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
          headers: {
            "Content-Type": "application/json",
            "x-synthetic-fixture": config.contexts[owner].token,
          },
          body: JSON.stringify(request),
        });
        const text = await response.text();
        if (new TextEncoder().encode(text).length > 1048576)
          throw Error("Fixture response bound");
        return { status: response.status, body: JSON.parse(text) };
      },
      controllers[owner].signal,
    ),
);
function track(upload: CloudNoteUpload) {
  if (!all.has(upload)) {
    all.add(upload);
    seen.push(upload);
  }
  return upload;
}
function Parent({ owner }: { owner: number }) {
  const model = owners[owner],
    snapshot = useSyncExternalStore(model.subscribe, model.snapshot);
  return (
    <CloudWorkspace
      context={model.context}
      signal={model.signal}
      refreshKey={snapshot.refreshKey}
      onOpen={async (selection) => track(await model.open(selection))}
      onCreate={(context) => track(model.create(context))}
      onPutAway={model.putAway}
    />
  );
}
const root = createRoot(document.getElementById("fixture")!);
function render() {
  root.render(
    <StrictMode>
      <Parent key={selected} owner={selected} />
    </StrictMode>,
  );
}
const api = {
  select(owner: number) {
    controllers[selected].abort();
    selected = owner;
    render();
  },
  holdRead(owner: number) {
    holdRead = owner;
  },
  heldReads: () => heldReads.length,
  releaseReads() {
    holdRead = null;
    for (const release of heldReads.splice(0)) release();
  },
  failRetention(owner: number, value: boolean) {
    failures[owner] = value;
  },
  retained: (owner: number) =>
    owners[owner].retainedOwners().map((upload) => ({
      noteId: upload.session.snapshot().noteId,
      body: upload.session.snapshot().bodyMarkdown,
      retained: upload.session.snapshot().retained,
      status: upload.session.snapshot().status,
    })),
  createdOwners: () => seen.length,
  latestNoteId: () => seen.at(-1)?.session.snapshot().noteId,
  read: (owner: number, noteId: string) => clients[owner].get(noteId),
  closeCounts: () => [...closeCounts],
  async destroy() {
    for (const model of owners)
      for (const upload of model.retainedOwners()) all.add(upload);
    for (const controller of controllers) controller.abort();
    root.unmount();
    api.releaseReads();
    failures.fill(false);
    await Promise.allSettled([...all].map((upload) => upload.session.flush()));
    await Promise.allSettled([...all].map((upload) => upload.upload()));
    await Promise.all(stores.map((store) => store.close()));
    await Promise.all(names.map((name) => deleteDB(name)));
  },
};
render();
declare global {
  interface Window {
    cloudLibraryOwnersFixture: typeof api;
  }
}
window.cloudLibraryOwnersFixture = api;
