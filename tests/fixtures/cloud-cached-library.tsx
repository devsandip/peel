import "@vitejs/plugin-react/preamble";
import "../../apps/web/src/styles.css";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { deleteDB, openDB } from "idb";
import {
  CloudCachedLibrary,
  type CloudLibraryContext,
  type CloudLibraryNoteSelection,
} from "../../apps/web/src/cloud-cached-library";
import {
  CloudNoteUpload,
  type CloudMutationSender,
} from "../../apps/web/src/cloud-note-upload";
import { CloudUploadingNoteEditor } from "../../apps/web/src/cloud-uploading-note-editor";
import {
  DurableCloudClient,
  type CloudScope,
} from "../../packages/cloud-protocol/src/durable";
import { IndexedDBCloudStateStore } from "../../packages/cloud-protocol/src/store-idb";
import type { CloudLibraryStateStore } from "../../packages/cloud-protocol/src/library-local";
import { DurableCloudPull } from "../../packages/cloud-protocol/src/pull-local";
import { cloudScopeHash } from "../../packages/cloud-protocol/src/pull";
import { cloudDraft } from "./cloud-durable-contract";

const config = Reflect.get(window, "syntheticLibraryConfig") as {
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
  !/^peel-m0-cloud-library-[a-z0-9-]+$/.test(prefix) ||
  config.contexts.length !== 2
)
  throw Error("Explicit owned Cloud library fixture required");
const names = [prefix + "-a", prefix + "-b"],
  stores = names.map((name) => new IndexedDBCloudStateStore(name)),
  clients = stores.map(
    (store, owner) =>
      new DurableCloudClient(store, config.contexts[owner].scope),
  ),
  opened = new Set<CloudNoteUpload>(),
  held: { resolve: (fail: boolean) => void }[] = [];
const reads = [0, 0];
let badProgressOwner: number | null = null,
  holdOwner: number | null = null,
  failedOwner: number | null = null,
  foreignOwner: number | null = null;
const wrappers: CloudLibraryStateStore[] = stores.map((store, owner) => ({
  read: (...args) => store.read(...args),
  commit: (...args) => store.commit(...args),
  close: () => store.close(),
  async listLibrary(scope, request) {
    reads[owner]++;
    const page = await store.listLibrary(scope, request);
    if (holdOwner === owner) {
      if (await new Promise<boolean>((resolve) => held.push({ resolve })))
        throw Error("Synthetic private held catalog exception");
    }
    if (failedOwner === owner)
      throw Error("Synthetic private catalog exception");
    if (badProgressOwner === owner && page.pull)
      return {
        ...page,
        pull: {
          ...page.pull,
          scopeHash: await cloudScopeHash(config.contexts[1 - owner].scope),
        },
      };
    return foreignOwner === owner
      ? { ...page, scope: config.contexts[1 - owner].scope }
      : page;
  },
}));
for (let owner = 0; owner < 2; owner++) {
  if (!(await clients[owner].get("shared-note")))
    await clients[owner].save(
      "shared-note",
      {
        kind: "upsert",
        snapshot: {
          ...cloudDraft(
            `Account ${owner === 0 ? "A" : "B"} cached note\nPrivate body excluded from metadata`,
          ),
          noteId: "shared-note",
          updatedAt: "2026-10-29T03:00:00.000Z",
        },
      },
      null,
    );
}
if (!(await clients[0].get("cached-00"))) {
  for (let n = 0; n < 34; n++) {
    const noteId = `cached-${String(n).padStart(2, "0")}`;
    await clients[0].save(
      noteId,
      {
        kind: "upsert",
        snapshot: {
          ...cloudDraft(
            `Cached title ${n}\nPrivate body excluded from metadata`,
          ),
          noteId,
          updatedAt: new Date(Date.UTC(2026, 9, 28, 0, n)).toISOString(),
        },
      },
      null,
    );
  }
  for (const [noteId, state] of [
    ["archived-note", "archived"],
    ["trashed-note", "trashed"],
  ] as const)
    await clients[0].save(
      noteId,
      {
        kind: "upsert",
        snapshot: {
          ...cloudDraft(state + " title"),
          noteId,
          state,
          ...(state === "trashed"
            ? {
                deletedAt: "2026-10-28T00:00:00.000Z",
                purgeAfter: "2026-11-27T00:00:00.000Z",
              }
            : {}),
        },
      },
      null,
    );
  await clients[0].save(
    "literal-note",
    {
      kind: "upsert",
      snapshot: {
        ...cloudDraft(
          '<img src=x onerror="window.pwned=true">\nPrivate body excluded from metadata',
        ),
        noteId: "literal-note",
      },
    },
    null,
  );
}
const senders: CloudMutationSender[] = config.contexts.map(
  (context) => async (request, signal) => {
    const response = await fetch(config.api + "/v1/mutations", {
      method: "POST",
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
      headers: {
        "Content-Type": "application/json",
        "x-synthetic-fixture": context.token,
      },
      body: JSON.stringify(request),
    });
    const text = await response.text();
    if (new TextEncoder().encode(text).length > 1048576)
      throw Error("Fixture response bound");
    return { status: response.status, body: JSON.parse(text) };
  },
);
const root = createRoot(document.getElementById("fixture")!);
let selected = 0,
  controller = new AbortController(),
  revision = 0,
  opening = 0,
  current: CloudNoteUpload | null = null;
function render() {
  flushSync(() =>
    root.render(
      <>
        <CloudCachedLibrary
          store={wrappers[selected]}
          scope={config.contexts[selected].scope}
          signal={controller.signal}
          refreshKey={revision}
          onOpen={open}
          onCreate={create}
        />
        {current && (
          <div className="editor-backdrop">
            <CloudUploadingNoteEditor
              upload={current}
              onPutAway={(session) => {
                if (current?.session === session) {
                  current = null;
                  revision++;
                  render();
                }
              }}
            />
          </div>
        )}
      </>,
    ),
  );
}
function ownerOf(context: CloudLibraryContext) {
  const owner = wrappers.indexOf(context.store);
  if (
    owner < 0 ||
    context.scope.ownerSubject !== config.contexts[owner].scope.ownerSubject
  )
    throw Error("Foreign fixture context");
  return owner;
}
function register(upload: CloudNoteUpload, owner: number, signal: AbortSignal) {
  opened.add(upload);
  upload.subscribe(() => {
    if (!signal.aborted && owner === selected) {
      revision++;
      render();
    }
  });
}
async function open(context: CloudLibraryNoteSelection) {
  const owner = ownerOf(context),
    request = ++opening,
    signal = controller.signal;
  const upload = await CloudNoteUpload.open(
    context.store,
    context.scope,
    context.noteId,
    senders[owner],
    signal,
  );
  register(upload, owner, signal);
  if (!signal.aborted && owner === selected && request === opening) {
    current = upload;
    render();
  }
}
function create(context: CloudLibraryContext) {
  const owner = ownerOf(context),
    signal = controller.signal;
  const upload = CloudNoteUpload.capture(
    context.store,
    context.scope,
    senders[owner],
    signal,
  );
  register(upload, owner, signal);
  current = upload;
  opening++;
  render();
}
const api = {
  select(owner: number) {
    controller.abort();
    controller = new AbortController();
    selected = owner;
    current = null;
    revision = 0;
    opening++;
    render();
  },
  refresh() {
    revision++;
    render();
  },
  invalid() {
    revision = -1;
    render();
  },
  abort() {
    controller.abort();
  },
  hold(owner: number) {
    holdOwner = owner;
  },
  held: () => held.length,
  reads: () => [...reads],
  release(fail = false) {
    holdOwner = null;
    for (const item of held.splice(0)) item.resolve(fail);
  },
  fail(owner: number | null) {
    failedOwner = owner;
  },
  foreign(owner: number | null) {
    foreignOwner = owner;
  },
  foreignProgress(owner: number | null) {
    badProgressOwner = owner;
  },
  async corrupt(owner: number) {
    const db = await openDB(names[owner], 2);
    const state = await db.get("states", "shared-note");
    await db.put("states", { ...state, version: 999 });
    db.close();
    api.refresh();
  },
  noteId: () => current?.session.snapshot().noteId ?? null,
  async download(state: "incomplete" | "complete") {
    const scope = config.contexts[selected].scope,
      pull = new DurableCloudPull(stores[selected], scope),
      previous = await pull.progress(),
      roundId = crypto.randomUUID().replaceAll("-", ""),
      hash = await cloudScopeHash(scope);
    await pull.begin(
      {
        version: 1,
        kind: "bootstrap",
        roundId,
        scopeHash: hash,
        fromSequence: 0,
        upperSequence: null,
        next: { kind: "heads", token: "synthetic-heads" },
      },
      previous?.generation ?? null,
    );
    if (state === "complete") {
      await pull.apply({
        version: 1,
        kind: "heads",
        scopeHash: hash,
        roundId,
        from: "synthetic-heads",
        fromSequence: 0,
        upperSequence: 0,
        throughSequence: 0,
        heads: [],
        next: { kind: "changes", token: "synthetic-changes" },
        checkpoint: null,
      });
      await pull.apply({
        version: 1,
        kind: "changes",
        scopeHash: hash,
        roundId,
        from: "synthetic-changes",
        fromSequence: 0,
        upperSequence: 0,
        throughSequence: 0,
        heads: [],
        next: null,
        checkpoint: "synthetic-checkpoint",
      });
    }
    api.refresh();
  },
  async destroy() {
    controller.abort();
    root.unmount();
    api.release();
    await Promise.all([...opened].map((upload) => upload.upload()));
    await Promise.all(stores.map((store) => store.close()));
    await Promise.all(names.map((name) => deleteDB(name)));
  },
};
render();
declare global {
  interface Window {
    cloudLibraryFixture: typeof api;
  }
}
window.cloudLibraryFixture = api;
