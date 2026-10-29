import "@vitejs/plugin-react/preamble";
import "../../apps/web/src/styles.css";
import { StrictMode, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { deleteDB } from "idb";
import { CloudBrowserWorkspaceSession } from "../../apps/web/src/cloud-browser-workspace-session";
import { CloudWorkspace } from "../../apps/web/src/cloud-workspace";
import {
  DurableCloudClient,
  type CloudScope,
} from "../../packages/cloud-protocol/src/durable";
import { IndexedDBCloudStateStore } from "../../packages/cloud-protocol/src/store-idb";
import { cloudScopeHash } from "../../packages/cloud-protocol/src/pull";

const config = Reflect.get(window, "syntheticBrowserWorkspaceConfig") as {
    csrfToken: string;
  },
  prefix = new URL(location.href).searchParams.get("db");
if (!prefix || !/^peel-m0-cloud-browser-workspace-[a-z0-9-]+$/.test(prefix))
  throw Error("Explicit owned workspace fixture required");
const stores = new Map<string, IndexedDBCloudStateStore>(),
  names = new Set<string>(),
  models: CloudBrowserWorkspaceSession[] = [],
  controllers: AbortController[] = [],
  scopes: Readonly<CloudScope>[] = [],
  resolverCalls: number[] = [],
  closeCounts: number[] = [],
  tasks = new Set<Promise<unknown>>();
let selected = -1;
const track = <T,>(task: Promise<T>) => {
  tasks.add(task);
  void task.catch(() => {});
  return task;
};
function create(token: string) {
  const index = models.length,
    controller = new AbortController();
  controllers.push(controller);
  resolverCalls[index] = 0;
  closeCounts[index] = 0;
  const model = new CloudBrowserWorkspaceSession(
    { origin: location.origin, csrfToken: token },
    controller.signal,
    async (scope) => {
      resolverCalls[index]++;
      scopes[index] = scope;
      const name = `${prefix}-${await cloudScopeHash(scope)}`;
      let store = stores.get(name);
      if (!store) {
        store = new IndexedDBCloudStateStore(name);
        stores.set(name, store);
        names.add(name);
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
  );
  models.push(model);
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
        <>
          <button onClick={() => void track(prepared.download.download())}>
            Download Cloud notes
          </button>
          <p role="status" aria-label="Cloud download state">
            {prepared.download.snapshot().kind}
          </p>
          <CloudWorkspace
            context={prepared.context}
            signal={model.signal}
            refreshKey={snapshot.refreshKey}
            onOpen={prepared.owners.open}
            onCreate={prepared.owners.create}
            onPutAway={prepared.owners.putAway}
          />
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
const api = {
  async prepare() {
    await track(models[selected].prepare());
  },
  select(token: string) {
    if (selected >= 0) controllers[selected].abort();
    selected = create(token);
    render();
    return selected;
  },
  view: (index = selected) => models[index].snapshot(),
  resolverCalls: () => [...resolverCalls],
  closeCounts: () => [...closeCounts],
  scope: (index = selected) => scopes[index],
  retained: (index = selected) =>
    models[index]
      .retained()
      ?.owners.retainedOwners()
      .map((upload) => ({
        noteId: upload.session.snapshot().noteId,
        body: upload.session.snapshot().bodyMarkdown,
        status: upload.session.snapshot().status,
        retained: upload.session.snapshot().retained,
      })) ?? [],
  async read(index: number, noteId: string) {
    const prepared = models[index].retained();
    return prepared
      ? new DurableCloudClient(
          prepared.context.store,
          prepared.context.scope,
        ).get(noteId)
      : null;
  },
  async destroy() {
    for (const controller of controllers) controller.abort();
    root.unmount();
    await Promise.allSettled([...tasks]);
    const uploads = models.flatMap((model) => [
      ...(model.retained()?.owners.retainedOwners() ?? []),
    ]);
    await Promise.allSettled(uploads.map((upload) => upload.session.flush()));
    await Promise.allSettled(uploads.map((upload) => upload.upload()));
    await Promise.all([...stores.values()].map((store) => store.close()));
    await Promise.all([...names].map((name) => deleteDB(name)));
  },
};
api.select(config.csrfToken);
declare global {
  interface Window {
    cloudBrowserWorkspaceSessionFixture: typeof api;
  }
}
window.cloudBrowserWorkspaceSessionFixture = api;
