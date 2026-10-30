import "@vitejs/plugin-react/preamble";
import "../../apps/web/src/styles.css";
import { StrictMode, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { deleteDB } from "idb";
import { CloudBrowserWorkspaceSession } from "../../apps/web/src/cloud-browser-workspace-session";
import { CloudConflictPreview } from "../../apps/web/src/cloud-conflict-preview";
import { CloudWorkspace } from "../../apps/web/src/cloud-workspace";
import {
  DurableCloudClient,
  type CloudScope,
} from "../../packages/cloud-protocol/src/durable";
import { IndexedDBCloudStateStore } from "../../packages/cloud-protocol/src/store-idb";
import { cloudScopeHash } from "../../packages/cloud-protocol/src/pull";

// Never imported by apps/web/src/main.tsx. Synthetic session and explicit
// test-owned M0 IndexedDB names only. Every action below calls a real component.

/** The issue 204 contract this fixture calls. A declaration, not an implementation. */
type ConflictChoice =
  { kind: "local" | "cloud" } | { kind: "merge"; bodyMarkdown: string };
type ConflictView = {
  noteId: string;
  generation: number | null;
  status: string;
  conflict: {
    local: { kind: string; snapshot: { bodyMarkdown: string } | null };
    remote: { bodyMarkdown: string } | null;
    remoteRevision: number;
  } | null;
  canMerge: boolean;
};
type ConflictResult = { kind: string; view: ConflictView | null };
type ConflictModel = {
  read(noteId: string): Promise<ConflictView>;
  resolve(
    noteId: string,
    expectedGeneration: number,
    choice: ConflictChoice,
  ): Promise<ConflictResult>;
  retry(noteId: string, expectedGeneration: number): Promise<ConflictResult>;
};

const config = Reflect.get(window, "syntheticConflictRoundtripConfig") as {
    csrfToken: string;
  },
  prefix = new URL(location.href).searchParams.get("db");
if (!prefix || !/^peel-m0-cloud-conflict-roundtrip-[a-z0-9-]+$/.test(prefix))
  throw Error("Explicit owned conflict roundtrip fixture required");
const stores = new Map<string, IndexedDBCloudStateStore>(),
  models: CloudBrowserWorkspaceSession[] = [],
  controllers: AbortController[] = [],
  closeCounts: number[] = [],
  tasks = new Set<Promise<unknown>>();
let selected = -1,
  bumpPreview: (noteId: string) => void = () => {};
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
    prepared = model.current(),
    [preview, setPreview] = useState<{ noteId: string; tick: number } | null>(
      null,
    );
  bumpPreview = (noteId) =>
    setPreview((value) => ({ noteId, tick: (value?.tick ?? 0) + 1 }));
  return (
    <>
      <p role="status" aria-label="Workspace preparation">
        {snapshot.kind}
      </p>
      {prepared && (
        <>
          <CloudWorkspace
            context={prepared.context}
            signal={model.signal}
            refreshKey={snapshot.refreshKey}
            onOpen={prepared.owners.open}
            onCreate={prepared.owners.create}
            onPutAway={prepared.owners.putAway}
          />
          {preview && (
            <CloudConflictPreview
              context={prepared.context}
              noteId={preview.noteId}
              signal={model.signal}
              refreshKey={snapshot.refreshKey + preview.tick}
            />
          )}
        </>
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
/** Null until issue 204 merges. Scenarios that need it skip by name until then. */
const controller = (index: number): ConflictModel | null => {
  const factory = Reflect.get(prepared(index).owners, "conflicts") as
    (() => ConflictModel) | undefined;
  return typeof factory === "function"
    ? factory.call(prepared(index).owners)
    : null;
};
const required = (index: number) => {
  const model = controller(index);
  if (!model) throw Error("Issue 204 controller is not merged");
  return model;
};
const api = {
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
  inspect(noteId: string) {
    bumpPreview(noteId);
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
  hasController: (index = selected) => !!controller(index),
  /** Wait on the real owner's own readiness rather than a fixture guess. */
  ownerQuiet(noteId: string, index = selected) {
    const owner = prepared(index)
      .owners.retainedOwners()
      .find((upload) => upload.session.snapshot().noteId === noteId);
    if (!owner) return true;
    const ready = Reflect.get(owner, "resolutionReady") as
      (() => boolean) | undefined;
    return typeof ready === "function" ? ready.call(owner) : false;
  },
  conflictRead: (noteId: string, index = selected) =>
    track(required(index).read(noteId)),
  /** A controller rejection, reduced to the fields a caller could display. */
  async conflictReadError(noteId: string, index = selected) {
    try {
      await required(index).read(noteId);
      return null;
    } catch (error) {
      const { name, message } = error as Error;
      return { name, message, kind: Reflect.get(error as object, "kind") };
    }
  },
  conflictResolve: (
    noteId: string,
    generation: number,
    choice: ConflictChoice,
    index = selected,
  ) => track(required(index).resolve(noteId, generation, choice)),
  conflictRetry: (noteId: string, generation: number, index = selected) =>
    track(required(index).retry(noteId, generation)),
  databases: async () =>
    (await indexedDB.databases()).map((database) => database.name),
  storageKeys: () => Object.keys(localStorage),
  closeCounts: () => [...closeCounts],
  /** Removes only databases carrying this fixture's explicit owned prefix. */
  async destroy() {
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
