import { deleteDB } from "idb";
import { createCloudMutationWebSender } from "../../apps/web/src/cloud-mutation-web-transport";
import { CloudNoteUpload } from "../../apps/web/src/cloud-note-upload";
import {
  DurableCloudClient,
  validateCloudScope,
  type CloudScope,
} from "../../packages/cloud-protocol/src/durable";
import { IndexedDBCloudStateStore } from "../../packages/cloud-protocol/src/store-idb";

const config = Reflect.get(window, "syntheticMutationConfig") as {
    scope: CloudScope;
  },
  scope = validateCloudScope(config.scope),
  name = new URL(location.href).searchParams.get("db");
if (!name || !/^peel-m0-cloud-web-mutation-[a-z0-9-]+$/.test(name))
  throw Error("Explicit owned mutation fixture required");
const databaseName = name,
  store = new IndexedDBCloudStateStore(databaseName),
  controller = new AbortController(),
  sender = createCloudMutationWebSender({
    origin: location.origin,
    csrfToken: "c".repeat(43),
  }),
  tasks = new Set<Promise<unknown>>(),
  subscriptions = new Set<() => void>();
let upload: CloudNoteUpload | null = null;
function render() {
  document.getElementById("status")!.textContent = upload
    ? `${upload.snapshot().kind}; ${upload.session.snapshot().status}`
    : "No active synthetic owner";
}
function retainOwner(owner: CloudNoteUpload) {
  upload = owner;
  subscriptions.add(
    owner.subscribe(() => {
      if (upload === owner) render();
    }),
  );
  render();
}
const fixture = {
  async capture(body: string) {
    const owner = CloudNoteUpload.capture(
      store,
      scope,
      sender,
      controller.signal,
    );
    retainOwner(owner);
    owner.session.edit(body);
    await owner.session.flush();
    owner.schedule();
    render();
    return owner.session.snapshot().noteId;
  },
  async open(noteId: string) {
    retainOwner(
      await CloudNoteUpload.open(
        store,
        scope,
        noteId,
        sender,
        controller.signal,
      ),
    );
  },
  async edit(body: string) {
    if (!upload) throw Error("No synthetic owner");
    upload.session.edit(body);
    await upload.session.flush();
    upload.schedule();
    render();
  },
  schedule() {
    upload?.schedule();
  },
  upload() {
    if (!upload) throw Error("No synthetic owner");
    const owner = upload,
      task = owner
        .upload()
        .then((view) => {
          if (upload === owner) render();
          return view;
        })
        .finally(() => tasks.delete(task));
    tasks.add(task);
    return task;
  },
  noteId() {
    return upload?.session.snapshot().noteId ?? null;
  },
  view() {
    return upload
      ? {
          upload: upload.snapshot().kind,
          status: upload.session.snapshot().status,
          retained: upload.session.snapshot().retained,
        }
      : null;
  },
  state(noteId: string) {
    return new DurableCloudClient(store, scope).get(noteId);
  },
  async destroy() {
    controller.abort();
    for (const off of subscriptions) off();
    await Promise.allSettled([...tasks]);
    await store.close();
    await deleteDB(databaseName);
  },
};
window.addEventListener("pagehide", () => controller.abort(), { once: true });
declare global {
  interface Window {
    cloudMutationWebFixture: typeof fixture;
  }
}
window.cloudMutationWebFixture = fixture;
render();
