import { useEffect, useRef, useState, type ReactNode } from "react";
import { native } from "@peel/storage";
import { invoke, installNativeLifecycle, listenNative } from "./platform";

export interface LibraryInfo {
  available: boolean;
  folder: string | null;
  previousFolder: string | null;
  requiresRestart: boolean;
  error: string | null;
}
interface Finished {
  id: string;
  keepFrozen: boolean;
  error: string | null;
}
export function NativeLibraryGate({ children }: { children: ReactNode }) {
  const activeMove = useRef<string | null>(null);
  const [ready, setReady] = useState(!native),
    [loading, setLoading] = useState(native),
    [error, setError] = useState(""),
    [moving, setMoving] = useState(false),
    [restart, setRestart] = useState(false);
  const load = async (retry = false) => {
    setLoading(true);
    try {
      const info = await invoke<LibraryInfo>(
        retry ? "retry_open_library" : "library_location",
      );
      setError(info.error ?? "");
      if (info.available) setReady(true);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    if (!native) return;
    void load();
    const cleanups: (() => void)[] = [
      installNativeLifecycle(new URLSearchParams(location.search).has("note")),
    ];
    let disposed = false;
    const add = (p: Promise<() => void>) =>
      void p.then((fn) => (disposed ? fn() : cleanups.push(fn)));
    add(
      listenNative<string>("peel-request-relocation", (id) => {
        activeMove.current = id;
        setMoving(true);
        setError("");
      }),
    );
    add(
      listenNative<Finished>("peel-relocation-finished", (result) => {
        if (activeMove.current && activeMove.current !== result.id) return;
        if (!result.keepFrozen) activeMove.current = null;
        setMoving(false);
        setRestart(result.keepFrozen);
        setError(result.error ?? "");
      }),
    );
    return () => {
      disposed = true;
      cleanups.forEach((fn) => fn());
    };
  }, []);
  if (!ready)
    return (
      <main className="startup-state" aria-busy={loading}>
        <h1>
          {loading ? "Opening your library…" : "Reconnect your notes folder"}
        </h1>
        {error && <p role="alert">{error}</p>}
        <p>
          Synkies keeps your selected library in place. Reconnect its drive or
          restore access, then retry. No empty replacement library has been
          opened.
        </p>
        <button disabled={loading} onClick={() => void load(true)}>
          Retry opening library
        </button>{" "}
        <button onClick={() => void invoke("request_quit")}>
          Quit Synkies
        </button>
      </main>
    );
  return (
    <>
      {children}
      {native && (moving || restart || error) && (
        <aside className="storage-notice" role={error ? "alert" : "status"}>
          <p>
            {moving
              ? "Saving every open note and changing the library folder…"
              : error}
          </p>
          {restart ? (
            <button onClick={() => void invoke("request_quit")}>
              Quit and reopen Synkies
            </button>
          ) : (
            !moving && <button onClick={() => setError("")}>Dismiss</button>
          )}
        </aside>
      )}
    </>
  );
}
export function NativeFolderSettings() {
  const [info, setInfo] = useState<LibraryInfo | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const refresh = async () => {
    try {
      setInfo(await invoke<LibraryInfo>("library_location"));
    } catch (e) {
      setError(String(e));
    }
  };
  useEffect(() => {
    void refresh();
    const focus = () => void refresh();
    window.addEventListener("focus", focus);
    return () => window.removeEventListener("focus", focus);
  }, []);
  const choose = async () => {
    setBusy(true);
    setError("");
    try {
      const selected = await invoke<LibraryInfo | null>(
        "choose_library_folder",
      );
      if (selected) setInfo(selected);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
      await refresh();
    }
  };
  return (
    <div className="setting-row">
      <div>
        <strong>Notes folder</strong>
        {info?.folder && <p className="folder-path">{info.folder}</p>}
        <p>
          Choose a folder without an existing Synkies database. Synkies verifies
          a complete copy before using it. The previous folder stays as an
          inactive recovery copy.
        </p>
        {info?.previousFolder && (
          <p className="folder-path">Previous copy: {info.previousFolder}</p>
        )}
        {(error || info?.error) && <p role="alert">{error || info?.error}</p>}
        {info && !info.available && !info.requiresRestart && (
          <button
            onClick={() => {
              setError("");
              void refresh();
            }}
          >
            Check folder again
          </button>
        )}
        {info?.requiresRestart && (
          <button onClick={() => void invoke("request_quit")}>
            Quit and reopen Synkies
          </button>
        )}
      </div>
      <button
        disabled={busy || !info?.available || info.requiresRestart}
        onClick={() => void choose()}
      >
        {busy ? "Changing folder…" : "Choose notes folder…"}
      </button>
    </div>
  );
}
