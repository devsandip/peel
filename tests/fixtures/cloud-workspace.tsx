import "@vitejs/plugin-react/preamble";
import "../../apps/web/src/styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { deleteDB } from "idb";
import type {
  CloudLibraryContext,
  CloudLibraryNoteSelection,
} from "../../apps/web/src/cloud-cached-library";
import {
  CloudNoteUpload,
  type CloudMutationSender,
} from "../../apps/web/src/cloud-note-upload";
import {
  CloudWorkspace,
  type CloudWorkspacePutAway,
} from "../../apps/web/src/cloud-workspace";
import {
  DurableCloudClient,
  type CloudScope,
} from "../../packages/cloud-protocol/src/durable";
import type { CloudLibraryStateStore } from "../../packages/cloud-protocol/src/library-local";
import { IndexedDBCloudStateStore } from "../../packages/cloud-protocol/src/store-idb";
import { cloudDraft } from "./cloud-durable-contract";

const config = Reflect.get(window, "syntheticWorkspaceConfig") as {
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
  !/^peel-m0-cloud-workspace-[a-z0-9-]+$/.test(prefix) ||
  config.contexts.length !== 2
) {
  throw Error("Explicit owned Cloud workspace fixture required");
}

const names = [`${prefix}-a`, `${prefix}-b`],
  retentionFailures = [false, false],
  stores = names.map(
    (name, owner) =>
      new IndexedDBCloudStateStore(name, () => {
        if (retentionFailures[owner]) {
          throw Error("synthetic private retention exception");
        }
      }),
  );

let holdCommitOwner: number | null = null,
  holdOpenOwner: number | null = null,
  failOpenOwner: number | null = null,
  holdCreateOwner: number | null = null,
  failCreateOwner: number | null = null,
  failPutAwayCallback = false,
  invalidScope = false;

const heldCommits: Array<() => void> = [],
  heldOpens: Array<{
    owner: number;
    noteId: string;
    resolve: (fail: boolean) => void;
  }> = [],
  heldCreates: Array<{ owner: number; resolve: (fail: boolean) => void }> = [];

const wrappers: CloudLibraryStateStore[] = stores.map((store, owner) => ({
  read: (...args) => store.read(...args),
  async commit(...args) {
    if (holdCommitOwner === owner) {
      await new Promise<void>((resolve) => heldCommits.push(resolve));
    }
    return store.commit(...args);
  },
  close: () => store.close(),
  listLibrary: (...args) => store.listLibrary(...args),
}));

const clients = stores.map(
  (store, owner) => new DurableCloudClient(store, config.contexts[owner].scope),
);

for (let owner = 0; owner < 2; owner++) {
  if (!(await clients[owner].get("shared-note"))) {
    const label = owner === 0 ? "A" : "B";
    await clients[owner].save(
      "shared-note",
      {
        kind: "upsert",
        snapshot: {
          ...cloudDraft(
            `# Account ${label} workspace note\nAccount ${label} private body ##work\n- [ ] Verify Cloud workspace`,
          ),
          noteId: "shared-note",
          updatedAt: "2026-10-29T05:00:00.000Z",
        },
      },
      null,
    );
  }
}

if (!(await clients[0].get("second-note"))) {
  await clients[0].save(
    "second-note",
    {
      kind: "upsert",
      snapshot: {
        ...cloudDraft("Second cached note\nBody for split switch verification"),
        noteId: "second-note",
        updatedAt: "2026-10-29T04:00:00.000Z",
      },
    },
    null,
  );
  await clients[0].save(
    "archived-note",
    {
      kind: "upsert",
      snapshot: {
        ...cloudDraft("Archived workspace note"),
        noteId: "archived-note",
        state: "archived",
        updatedAt: "2026-10-28T02:00:00.000Z",
      },
    },
    null,
  );
  await clients[0].save(
    "trashed-note",
    {
      kind: "upsert",
      snapshot: {
        ...cloudDraft("Trashed workspace note"),
        noteId: "trashed-note",
        state: "trashed",
        deletedAt: "2026-10-28T01:00:00.000Z",
        purgeAfter: "2026-11-27T01:00:00.000Z",
        updatedAt: "2026-10-28T01:00:00.000Z",
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
          '<img src=x onerror="window.pwned=true">\nLiteral body excluded from catalog',
        ),
        noteId: "literal-note",
        updatedAt: "2026-10-28T03:00:00.000Z",
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
    if (new TextEncoder().encode(text).length > 1048576) {
      throw Error("Fixture response bound");
    }
    return { status: response.status, body: JSON.parse(text) };
  },
);

const libraryContexts: CloudLibraryContext[] = config.contexts.map(
  (entry, owner) =>
    Object.freeze({
      store: wrappers[owner],
      scope: Object.freeze({ ...entry.scope }),
    }),
);

const ownersByAccount: [CloudNoteUpload[], CloudNoteUpload[]] = [[], []],
  allUploads = new Set<CloudNoteUpload>(),
  putAways: Array<{
    owner: number;
    noteId: string;
    retained: boolean;
    matchedSession: boolean;
  }> = [];

let selected = 0,
  controllers: [AbortController, AbortController] = [
    new AbortController(),
    new AbortController(),
  ],
  refreshKey = 0;

function ownerOf(context: CloudLibraryContext): number {
  const owner = wrappers.indexOf(context.store);
  if (
    owner < 0 ||
    context.scope.ownerSubject !== config.contexts[owner].scope.ownerSubject
  ) {
    throw Error("Foreign fixture context");
  }
  return owner;
}

function registerUpload(
  owner: number,
  upload: CloudNoteUpload,
  signal: AbortSignal,
) {
  ownersByAccount[owner].push(upload);
  allUploads.add(upload);
  upload.subscribe(() => {
    if (!signal.aborted && selected === owner && refreshKey >= 0) {
      refreshKey++;
      render();
    }
  });
}

async function onOpen(
  selection: CloudLibraryNoteSelection,
): Promise<CloudNoteUpload> {
  const owner = ownerOf(selection),
    signal = controllers[owner].signal;
  if (holdOpenOwner === owner) {
    const shouldFail = await new Promise<boolean>((resolve) =>
      heldOpens.push({ owner, noteId: selection.noteId, resolve }),
    );
    if (shouldFail) throw Error("synthetic private open callback exception");
  }
  if (failOpenOwner === owner) {
    throw Error("synthetic private open callback exception");
  }
  const upload = await CloudNoteUpload.open(
    selection.store,
    selection.scope,
    selection.noteId,
    senders[owner],
    signal,
  );
  registerUpload(owner, upload, signal);
  return upload;
}

async function onCreate(
  context: CloudLibraryContext,
): Promise<CloudNoteUpload> {
  const owner = ownerOf(context),
    signal = controllers[owner].signal;
  if (holdCreateOwner === owner) {
    const shouldFail = await new Promise<boolean>((resolve) =>
      heldCreates.push({ owner, resolve }),
    );
    if (shouldFail) throw Error("synthetic private create callback exception");
  }
  if (failCreateOwner === owner) {
    throw Error("synthetic private create callback exception");
  }
  const upload = CloudNoteUpload.capture(
    context.store,
    context.scope,
    senders[owner],
    signal,
  );
  registerUpload(owner, upload, signal);
  return upload;
}

async function onPutAway(closed: CloudWorkspacePutAway) {
  const owner = ownerOf(closed.context);
  putAways.push({
    owner,
    noteId: closed.session.snapshot().noteId,
    retained: closed.session.snapshot().retained,
    matchedSession: closed.upload.session === closed.session,
  });
  if (failPutAwayCallback) {
    throw Error("synthetic private put-away callback exception");
  }
}

const root = createRoot(document.getElementById("fixture")!);

function render() {
  const activeContext = invalidScope
    ? ({
        store: wrappers[selected],
        scope: { ...config.contexts[selected].scope, ownerSubject: "" },
      } as CloudLibraryContext)
    : libraryContexts[selected];
  flushSync(() =>
    root.render(
      <StrictMode>
        <CloudWorkspace
          context={activeContext}
          signal={controllers[selected].signal}
          refreshKey={refreshKey}
          onOpen={onOpen}
          onCreate={onCreate}
          onPutAway={onPutAway}
        />
      </StrictMode>,
    ),
  );
}

const api = {
  selectAccount(owner: 0 | 1) {
    controllers[selected].abort();
    controllers[owner] = new AbortController();
    selected = owner;
    refreshKey = 0;
    invalidScope = false;
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
  setInvalidScope(value: boolean) {
    invalidScope = value;
    render();
  },
  failRetention(owner: number, value: boolean) {
    retentionFailures[owner] = value;
  },
  holdCommit(owner: number | null) {
    holdCommitOwner = owner;
  },
  heldCommits: () => heldCommits.length,
  releaseCommits() {
    holdCommitOwner = null;
    for (const release of heldCommits.splice(0)) release();
  },
  holdOpen(owner: number | null) {
    holdOpenOwner = owner;
  },
  heldOpens: () => heldOpens.map(({ owner, noteId }) => ({ owner, noteId })),
  releaseOpens(fail = false) {
    holdOpenOwner = null;
    for (const item of heldOpens.splice(0)) item.resolve(fail);
  },
  releaseFirstOpen(fail = false) {
    const first = heldOpens.shift();
    first?.resolve(fail);
  },
  failOpen(owner: number | null) {
    failOpenOwner = owner;
  },
  holdCreate(owner: number | null) {
    holdCreateOwner = owner;
  },
  heldCreates: () => heldCreates.length,
  releaseCreates(fail = false) {
    holdCreateOwner = null;
    for (const item of heldCreates.splice(0)) item.resolve(fail);
  },
  failCreate(owner: number | null) {
    failCreateOwner = owner;
  },
  failPutAway(value: boolean) {
    failPutAwayCallback = value;
  },
  putAways: () => [...putAways],
  retainedOwnersCount: (owner: 0 | 1) => ownersByAccount[owner].length,
  latestNoteId: (owner: 0 | 1) => {
    const list = ownersByAccount[owner];
    return list.length ? list[list.length - 1].session.snapshot().noteId : null;
  },
  readState: (owner: 0 | 1, noteId: string) => clients[owner].get(noteId),
  async settleOwnerUploads(owner: 0 | 1) {
    await Promise.allSettled(
      ownersByAccount[owner].map((upload) => upload.session.flush()),
    );
  },
  async destroy() {
    for (const controller of controllers) controller.abort();
    root.unmount();
    api.releaseCommits();
    api.releaseOpens(false);
    api.releaseCreates(false);
    retentionFailures.fill(false);
    failPutAwayCallback = false;
    await Promise.allSettled(
      [...allUploads].map((upload) => upload.session.flush()),
    );
    await Promise.allSettled([...allUploads].map((upload) => upload.upload()));
    await Promise.all(stores.map((store) => store.close()));
    await Promise.all(names.map((name) => deleteDB(name)));
  },
};

render();

declare global {
  interface Window {
    cloudWorkspaceFixture: typeof api;
  }
}
window.cloudWorkspaceFixture = api;
