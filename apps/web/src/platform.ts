import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { native } from "@peel/storage";
import { prepareDraftsForExit, releaseDrafts } from "./draft-registry";
export { invoke, getCurrentWindow };
let closeNoteHandler: (() => Promise<void>) | null = null;
export function registerNoteClose(handler: () => Promise<void>) {
  closeNoteHandler = handler;
  return () => {
    if (closeNoteHandler === handler) closeNoteHandler = null;
  };
}
export function installNativeLifecycle(isNote: boolean) {
  if (!native) return () => {};
  let disposed = false;
  const cleanups: (() => void)[] = [];
  const add = (p: Promise<() => void>) =>
    void p.then((fn) => (disposed ? fn() : cleanups.push(fn)));
  add(
    listenNative("peel-request-close", async () => {
      if (isNote) {
        if (closeNoteHandler) await closeNoteHandler();
        else await invoke("finish_close", { discardEmpty: false });
        return;
      }
      try {
        await prepareDraftsForExit("window-close");
        await invoke("finish_library_close");
      } catch {
        releaseDrafts("window-close");
        await getCurrentWindow().setFocus();
      }
    }),
  );
  add(
    listenNative<string>("peel-request-quit", async (quitId) => {
      try {
        await prepareDraftsForExit("quit:" + quitId);
        await invoke("quit_ack", { success: true, quitId });
      } catch {
        await invoke("quit_ack", { success: false, quitId });
        await getCurrentWindow().setFocus();
      }
    }),
  );
  add(
    listenNative<string>("peel-quit-cancelled", (quitId) =>
      releaseDrafts("quit:" + quitId),
    ),
  );
  add(
    listenNative<string>("peel-request-relocation", async (operationId) => {
      try {
        await prepareDraftsForExit("relocate:" + operationId);
        await invoke("relocation_ack", { success: true, operationId });
      } catch {
        await invoke("relocation_ack", { success: false, operationId });
        await getCurrentWindow().setFocus();
      }
    }),
  );
  add(
    listenNative<{ id: string; keepFrozen: boolean }>(
      "peel-relocation-finished",
      ({ id, keepFrozen }) => {
        if (!keepFrozen) releaseDrafts("relocate:" + id);
      },
    ),
  );
  return () => {
    disposed = true;
    cleanups.forEach((fn) => fn());
  };
}
export async function listenNative<T>(
  event: string,
  fn: (payload: T) => void,
): Promise<UnlistenFn> {
  if (!native) return () => {};
  return listen<T>(event, (e) => fn(e.payload));
}
export function download(bytes: Uint8Array, filename: string) {
  const blob = new Blob([new Uint8Array(bytes)], { type: "application/zip" }),
    url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
