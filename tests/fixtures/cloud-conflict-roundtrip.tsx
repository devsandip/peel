import "@vitejs/plugin-react/preamble";
import "../../apps/web/src/styles.css";
import { StrictMode, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { deleteDB } from "idb";
import { CloudBrowserWorkspaceSession } from "../../apps/web/src/cloud-browser-workspace-session";
import {
  CloudConflictResolutionError,
  type CloudConflictResolutionChoice,
} from "../../apps/web/src/cloud-conflict-resolution";
import { CloudWorkspace } from "../../apps/web/src/cloud-workspace";
import {
  DurableCloudClient,
  type CloudScope,
} from "../../packages/cloud-protocol/src/durable";
import { IndexedDBCloudStateStore } from "../../packages/cloud-protocol/src/store-idb";
import { cloudScopeHash } from "../../packages/cloud-protocol/src/pull";

// Never imported by apps/web/src/main.tsx. Synthetic session and explicit
// test-owned M0 IndexedDB names only. Every action below calls a real component.

const config = Reflect.get(window, "syntheticConflictRoundtripConfig") as {
    csrfToken: string;
  },
  prefix = new URL(location.href).searchParams.get("db");
const includeConflictActions =
  new URL(location.href).searchParams.get("actions") === "1";
if (!prefix || !/^peel-m0-cloud-conflict-roundtrip-[a-z0-9-]+$/.test(prefix))
  throw Error("Explicit owned conflict roundtrip fixture required");
// This synthetic page never reads or writes the operating system clipboard.
const clipboardCalls: string[] = [];
Object.defineProperty(navigator, "clipboard", {
  configurable: true,
  value: Object.freeze({
    async writeText(text: string) {
      clipboardCalls.push(text);
    },
  }),
});
const stores = new Map<string, IndexedDBCloudStateStore>(),
  models: CloudBrowserWorkspaceSession[] = [],
  controllers: AbortController[] = [],
  closeCounts: number[] = [],
  tasks = new Set<Promise<unknown>>();
let selected = -1;
let conflictActionsEnabled = includeConflictActions;
const track = <T,>(task: Promise<T>) => {
  tasks.add(task);
  void task.catch(() => {});
  return task;
};
function create(token: string) {
  const index = models.length,
    controller = new AbortController();
  controllers.push(controller);
  closeCounts[index] = 0;
  models.push(
    new CloudBrowserWorkspaceSession(
      { origin: location.origin, csrfToken: token },
      controller.signal,
      async (scope: Readonly<CloudScope>) => {
        const name = `${prefix}-${await cloudScopeHash(scope)}`;
        let store = stores.get(name);
        if (!store) {
          store = new IndexedDBCloudStateStore(name);
          stores.set(name, store);
        }
        const original = store;
        return {
          read: (...args) => original.read(...args),
          commit: (...args) => original.commit(...args),
          readPull: (...args) => original.readPull(...args),
          commitPull: (...args) => original.commitPull(...args),
          listLibrary: (...args) => original.listLibrary(...args),
          async close() {
            closeCounts[index]++;
            await original.close();
          },
        };
      },
    ),
  );
  return index;
}
function Parent({ model }: { model: CloudBrowserWorkspaceSession }) {
  const snapshot = useSyncExternalStore(model.subscribe, model.snapshot),
    prepared = model.current();
  return (
    <>
      <p role="status" aria-label="Workspace preparation">
        {snapshot.kind}
      </p>
      {prepared && (
        <CloudWorkspace
          context={prepared.context}
          signal={model.signal}
          refreshKey={snapshot.refreshKey}
          onOpen={prepared.owners.open}
          onCreate={prepared.owners.create}
          onPutAway={prepared.owners.putAway}
          conflictOwners={conflictActionsEnabled ? prepared.owners : undefined}
        />
      )}
    </>
  );
}
const root = createRoot(document.getElementById("fixture")!);
const render = () =>
  root.render(
    <StrictMode>
      <Parent key={selected} model={models[selected]} />
    </StrictMode>,
  );
const prepared = (index: number) => {
  const value = models[index]?.retained();
  if (!value) throw Error("Fixture session is not prepared");
  return value;
};
/** The real merged controller from the real owners of that session. */
const controller = (index: number) => prepared(index).owners.conflicts();
const api = {
  copiedCalls: () => [...clipboardCalls],
  /** An explicit parent prop change, without replacing the account or editor. */
  setConflictActions(enabled: boolean) {
    conflictActionsEnabled = enabled;
    flushSync(render);
  },
  select(token: string) {
    if (selected >= 0) controllers[selected].abort();
    selected = create(token);
    render();
    return selected;
  },
  async prepare() {
    await track(models[selected].prepare());
    return selected;
  },
  preparation: (index = selected) => models[index].snapshot().kind,
  scope: (index = selected) => prepared(index).context.scope,
  async download(index = selected) {
    const result = await track(prepared(index).download.download());
    return { kind: result.kind, pages: result.pages };
  },
  /** Read-only durable state, for asserting the exact retained operation. */
  state(noteId: string, index = selected) {
    const { context } = prepared(index);
    return new DurableCloudClient(context.store, context.scope).get(noteId);
  },
  retainedNotes: (index = selected) =>
    prepared(index)
      .owners.retainedOwners()
      .map((upload) => upload.session.snapshot().noteId),
  async open(noteId: string, index = selected) {
    const { owners, context } = prepared(index);
    try {
      await track(owners.open(Object.freeze({ ...context, noteId })));
      return "opened";
    } catch (error) {
      return error instanceof Error ? error.message : "unknown";
    }
  },
  /** Wait on the real owner's own readiness rather than a fixture guess. */
  ownerQuiet(noteId: string, index = selected) {
    const owner = prepared(index)
      .owners.retainedOwners()
      .find((upload) => upload.session.snapshot().noteId === noteId);
    return !owner || owner.resolutionReady();
  },
  conflictRead: (noteId: string, index = selected) =>
    track(controller(index).read(noteId)),
  /** A controller rejection, reduced to the fields a caller could display. */
  async conflictReadError(noteId: string, index = selected) {
    try {
      await controller(index).read(noteId);
      return null;
    } catch (error) {
      if (!(error instanceof CloudConflictResolutionError)) throw error;
      const { name, message, kind } = error;
      return { name, message, kind };
    }
  },
  conflictResolve: (
    noteId: string,
    generation: number,
    choice: CloudConflictResolutionChoice,
    index = selected,
  ) => track(controller(index).resolve(noteId, generation, choice)),
  conflictRetry: (noteId: string, generation: number, index = selected) =>
    track(controller(index).retry(noteId, generation)),
  databases: async () =>
    (await indexedDB.databases()).map((database) => database.name),
  storageKeys: () => Object.keys(localStorage),
  closeCounts: () => [...closeCounts],
  /** Removes only databases carrying this fixture's explicit owned prefix. */
  async destroy() {
    clipboardCalls.length = 0;
    for (const owned of controllers) owned.abort();
    root.unmount();
    await Promise.allSettled([...tasks]);
    await Promise.all([...stores.values()].map((store) => store.close()));
    for (const database of await indexedDB.databases())
      if (database.name?.startsWith(`${prefix}-`))
        await deleteDB(database.name);
  },
};
api.select(config.csrfToken);
declare global {
  interface Window {
    cloudConflictRoundtripFixture: typeof api;
  }
}
window.cloudConflictRoundtripFixture = api;
