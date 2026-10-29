import "@vitejs/plugin-react/preamble";
import "../../apps/web/src/styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { deleteDB } from "idb";
import {
  CloudNoteUpload,
  type CloudMutationSender,
} from "../../apps/web/src/cloud-note-upload";
import { CloudUploadingNoteEditor } from "../../apps/web/src/cloud-uploading-note-editor";
import { IndexedDBCloudStateStore } from "../../packages/cloud-protocol/src/store-idb";
import type { CloudScope } from "../../packages/cloud-protocol/src/durable";

const config = Reflect.get(window, "syntheticUploadConfig") as {
  api: string;
  token: string;
  scope: CloudScope;
};
const url = new URL(config.api);
if (
  url.protocol !== "http:" ||
  url.hostname !== "127.0.0.1" ||
  url.origin !== config.api
)
  throw Error("Explicit owned loopback server required");
const name = new URL(location.href).searchParams.get("db");
if (!name || !/^peel-m0-cloud-upload-[a-z0-9-]+$/.test(name))
  throw Error("Explicit synthetic namespace required");
const store = new IndexedDBCloudStateStore(name),
  root = createRoot(document.getElementById("fixture")!),
  opened = new Set<CloudNoteUpload>();
const send: CloudMutationSender = async (request, signal) => {
  const response = await fetch(config.api + "/v1/mutations", {
    method: "POST",
    signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
    credentials: "omit",
    redirect: "error",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      "x-synthetic-fixture": config.token,
    },
    body: JSON.stringify(request),
  });
  const text = await response.text();
  if (new TextEncoder().encode(text).length > 1048576)
    throw Error("Fixture response bound");
  return { status: response.status, body: JSON.parse(text) };
};
let controller = new AbortController(),
  upload = CloudNoteUpload.capture(
    store,
    config.scope,
    send,
    controller.signal,
  ),
  shown = true;
opened.add(upload);
function render() {
  flushSync(() =>
    root.render(
      <StrictMode>
        {shown ? (
          <CloudUploadingNoteEditor
            upload={upload}
            onPutAway={() => {
              shown = false;
              render();
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
  snapshot: () => upload.session.snapshot(),
  uploadStatus: () => upload.snapshot(),
  async open(noteId: string) {
    controller.abort();
    controller = new AbortController();
    upload = await CloudNoteUpload.open(
      store,
      config.scope,
      noteId,
      send,
      controller.signal,
    );
    opened.add(upload);
    shown = true;
    render();
  },
  replace() {
    controller.abort();
    controller = new AbortController();
    upload = CloudNoteUpload.capture(
      store,
      config.scope,
      send,
      controller.signal,
    );
    opened.add(upload);
    shown = true;
    render();
  },
  async destroy() {
    controller.abort();
    root.unmount();
    await Promise.all([...opened].map((current) => current.upload()));
    await store.close();
    await deleteDB(name);
  },
};
render();
declare global {
  interface Window {
    cloudUploadFixture: typeof api;
  }
}
window.cloudUploadFixture = api;
