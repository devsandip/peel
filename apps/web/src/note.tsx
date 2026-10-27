import { useEffect, useState, useRef } from "react";
import {
  byteLength,
  MAX_NOTE_BYTES,
  setState,
  tagsOf,
  titleOf,
  type Note,
} from "@peel/core";
import { exportNotes } from "../../../packages/core/src/transfer";
import { repository, native } from "@peel/storage";
import { MarkdownEditor } from "./editor";
import { useNoteSession } from "./session";
import {
  invoke,
  listenNative,
  download,
  getCurrentWindow,
  registerNoteClose,
} from "./platform";

export function NoteEditor({
  initial,
  onClose,
  onLibrary,
  standalone = native,
}: {
  initial: Note;
  onClose: () => void;
  onLibrary?: () => void;
  standalone?: boolean;
}) {
  const session = useNoteSession(initial),
    [source, setSource] = useState(false),
    [menu, setMenu] = useState<{ x: number; y: number } | null>(null),
    [onTop, setOnTop] = useState(false),
    [closing, setClosing] = useState(false);
  const closeInProgress = useRef(false);
  const close = async () => {
    if (closeInProgress.current) return;
    closeInProgress.current = true;
    session.freeze("put-away");
    setClosing(true);
    try {
      await session.flush();
      if (standalone)
        await invoke("finish_close", {
          discardEmpty: session.untouchedEmpty(),
        });
      else {
        if (session.untouchedEmpty())
          await repository.purge(
            session.current().noteId,
            session.current().localRevision,
          );
        onClose();
      }
    } catch (error) {
      session.setError(String(error));
    } finally {
      closeInProgress.current = false;
      session.unfreeze("put-away");
      setClosing(false);
    }
  };
  const lifecycle = async (state: "active" | "archived" | "trashed") => {
    try {
      await session.flush();
      await session.replace(setState(session.current(), state));
      await close();
    } catch (error) {
      session.setError(String(error));
    }
  };
  const exportOne = async () => {
    try {
      await session.flush();
      const bytes = exportNotes([session.current()]);
      if (native) await invoke("export_archive", { bytes: Array.from(bytes) });
      else download(bytes, "Peel-note.zip");
    } catch (e) {
      session.setError(String(e));
    }
  };
  useEffect(() => {
    let disposed = false;
    const unlisten: (() => void)[] = [];
    const add = (p: Promise<() => void>) =>
      p.then((fn) => (disposed ? fn() : unlisten.push(fn)));
    if (!standalone) return;
    unlisten.push(registerNoteClose(close));
    add(
      listenNative<"active" | "archived" | "trashed">(
        "peel-lifecycle",
        (state) => void lifecycle(state),
      ),
    );
    add(
      listenNative<string>("peel-menu-action", (action) => {
        if (action === "close") void close();
        if (action === "source") setSource((x) => !x);
        if (action === "archive") void lifecycle("archived");
        if (action === "trash") void lifecycle("trashed");
      }),
    );
    if (native) {
      void repository
        .placements()
        .then((p) =>
          setOnTop(p.some((x) => x.noteId === initial.noteId && x.alwaysOnTop)),
        );
      void invoke("reveal_note");
    }
    return () => {
      disposed = true;
      unlisten.forEach((fn) => fn());
    };
  }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
      if (!native && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "w") {
        e.preventDefault();
        void close();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const act = (fn: () => void) => {
    setMenu(null);
    fn();
  };
  const size = byteLength(session.note.bodyMarkdown);
  return (
    <article
      className={`note-window ${native ? "native-note" : ""}`}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenu({
          x: Math.min(e.clientX, window.innerWidth - 228),
          y: Math.max(8, Math.min(e.clientY, window.innerHeight - 360)),
        });
      }}
    >
      <header
        className="note-titlebar"
        onMouseDown={(event) => {
          if (
            !standalone ||
            event.button !== 0 ||
            (event.target as Element).closest("button")
          )
            return;
          event.preventDefault();
          void getCurrentWindow()
            .startDragging()
            .catch((error) => session.setError(String(error)));
        }}
      >
        <button
          className="note-close"
          aria-label="Save and close note"
          title="Save and put away note"
          disabled={closing}
          onClick={() => void close()}
        >
          <span>−</span>
        </button>
        <span>{titleOf(session.note.bodyMarkdown)}</span>
      </header>
      {session.note.state !== "active" && (
        <div className="note-notice">
          {session.note.state === "archived" ? "Archived" : "In Trash"}{" "}
          <button onClick={() => void lifecycle("active")}>Restore</button>
        </div>
      )}
      <MarkdownEditor
        value={session.note.bodyMarkdown}
        onChange={session.edit}
        onError={session.setError}
        source={source}
        readOnly={session.frozen}
        canEdit={session.canEdit}
      />
      {session.error && (
        <div role="alert" className="save-error">
          <strong>
            {session.status === "Could not save"
              ? "Could not save on this device"
              : "Could not complete this action"}
          </strong>
          <p>{session.error.replace(/^Error: /, "")}</p>
          <button onClick={() => void session.flush().catch(() => {})}>
            Retry
          </button>
          <button
            onClick={() =>
              void navigator.clipboard.writeText(session.current().bodyMarkdown)
            }
          >
            Copy text
          </button>
        </div>
      )}
      <footer className="note-status" aria-live="polite">
        <span>
          {session.status === "Saved on this device" ? "✓ " : ""}
          {session.status}
        </span>
        <span>
          {size > MAX_NOTE_BYTES * 0.85
            ? `${(size / 1024).toFixed(0)} / 256 KiB`
            : "On this device"}
          {source ? " · Markdown" : ""}
        </span>
      </footer>
      {menu && (
        <>
          <div className="menu-scrim" onClick={() => setMenu(null)} />
          <div
            className="context-menu"
            role="menu"
            style={{ left: menu.x, top: menu.y }}
          >
            <button
              role="menuitem"
              onClick={() => act(() => setSource((x) => !x))}
            >
              {source ? "Formatted editing" : "Markdown source"}
            </button>
            {standalone && (
              <button
                role="menuitemcheckbox"
                aria-checked={onTop}
                onClick={() =>
                  act(
                    () =>
                      void invoke("keep_on_top", {
                        noteId: initial.noteId,
                        enabled: !onTop,
                      })
                        .then(() => setOnTop((x) => !x))
                        .catch((e) => session.setError(String(e))),
                  )
                }
              >
                {onTop ? "✓ " : ""}Keep on top
              </button>
            )}
            <hr />
            <button
              role="menuitem"
              onClick={() =>
                act(
                  () =>
                    void lifecycle(
                      session.note.state === "archived" ? "active" : "archived",
                    ),
                )
              }
            >
              {session.note.state === "archived" ? "Unarchive" : "Archive note"}
            </button>
            <button role="menuitem" onClick={() => act(() => void exportOne())}>
              Export Markdown…
            </button>
            <button
              role="menuitem"
              onClick={() =>
                act(
                  () =>
                    void session
                      .flush()
                      .then(() =>
                        native ? invoke("open_library") : onLibrary?.(),
                      )
                      .catch((e) => session.setError(String(e))),
                )
              }
            >
              Show Notes Library
            </button>
            <hr />
            <button
              role="menuitem"
              className="danger"
              onClick={() => act(() => void lifecycle("trashed"))}
            >
              Move to Trash
            </button>
          </div>
        </>
      )}
    </article>
  );
}
