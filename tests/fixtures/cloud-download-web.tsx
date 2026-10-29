import "@vitejs/plugin-react/preamble";
import "../../apps/web/src/styles.css";
import { createRoot } from "react-dom/client";
import { deleteDB } from "idb";
import { CloudCachedLibrary } from "../../apps/web/src/cloud-cached-library";
import { CloudLibraryDownload } from "../../apps/web/src/cloud-library-download";
import { createCloudDownloadWebSender } from "../../apps/web/src/cloud-download-web-transport";
import { IndexedDBCloudStateStore } from "../../packages/cloud-protocol/src/store-idb";
import {
  DurableCloudClient,
  validateCloudScope,
  type CloudScope,
} from "../../packages/cloud-protocol/src/durable";
import { cloudDraft } from "./cloud-durable-contract";

const name = new URL(location.href).searchParams.get("db"),
  config = Reflect.get(window, "syntheticDownloadConfig") as {
    scope: CloudScope;
  },
  scope = validateCloudScope(config.scope);
if (!name || !/^peel-m0-cloud-web-download-[a-z0-9-]+$/.test(name))
  throw Error("Explicit owned M0 browser download fixture required");
const databaseName = name,
  root = createRoot(document.getElementById("fixture")!),
  send = createCloudDownloadWebSender({
    origin: location.origin,
    csrfToken: "c".repeat(43),
  });
let refreshKey = 0;
function context() {
  const store = new IndexedDBCloudStateStore(databaseName),
    controller = new AbortController(),
    owner = new CloudLibraryDownload(store, scope, send, controller.signal),
    ctx = { store, controller, owner, unsubscribe: () => {} };
  ctx.unsubscribe = owner.subscribe(() => {
    if (current === ctx) render();
  });
  return ctx;
}
let current = context();
async function download() {
  const ctx = current,
    result = await ctx.owner.download();
  if (current === ctx && !ctx.controller.signal.aborted) {
    refreshKey++;
    render();
  }
  return result;
}
function render() {
  const ctx = current,
    view = ctx.owner.snapshot();
  root.render(
    <>
      <p role="status" aria-label="Cloud download">
        {view.kind}: {view.message}
      </p>
      <button
        onClick={() => void download()}
        disabled={ctx.controller.signal.aborted || view.kind === "downloading"}
      >
        Download Cloud notes
      </button>
      <CloudCachedLibrary
        store={ctx.store}
        scope={scope}
        signal={ctx.controller.signal}
        refreshKey={refreshKey}
      />
    </>,
  );
}
const fixture = {
  download,
  async reopen() {
    const old = current;
    old.controller.abort();
    old.unsubscribe();
    await old.store.close();
    current = context();
    refreshKey++;
    render();
  },
  async retain(noteId: string, body: string) {
    const ctx = current,
      client = new DurableCloudClient(ctx.store, scope),
      old = await client.get(noteId);
    await client.save(
      noteId,
      {
        kind: "upsert",
        snapshot: {
          ...cloudDraft(body),
          collectionId: scope.collectionId,
          noteId,
        },
      },
      old?.generation ?? null,
    );
    if (current === ctx) {
      refreshKey++;
      render();
    }
  },
  async progress() {
    const p = (await current.store.readPull(scope, [])).progress;
    return {
      started: !!p,
      more: !!p?.next,
      complete: p?.next === null,
      sequence: p?.throughSequence ?? null,
    };
  },
  state(noteId: string) {
    return new DurableCloudClient(current.store, scope).get(noteId);
  },
  async destroy() {
    current.controller.abort();
    current.unsubscribe();
    root.unmount();
    await current.store.close();
    await deleteDB(databaseName);
  },
};
declare global {
  interface Window {
    cloudDownloadFixture: typeof fixture;
  }
}
window.cloudDownloadFixture = fixture;
render();
