import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  offlineShellState,
  subscribeOfflineShell,
  retryOfflineShell,
} from "./offline-shell";
import {
  newNote,
  setState,
  tagsOf,
  titleOf,
  type Note,
  type NoteState,
  type Placement,
} from "@peel/core";
import {
  importArchive,
  exportNotes,
} from "../../../packages/core/src/transfer";
import { repository, native, importInto } from "@peel/storage";
import { invoke, listenNative, download } from "./platform";
import { NoteEditor } from "./note";
import { useSearch } from "./use-search";
import { NativeFolderSettings } from "./native-library";
import { NativeShortcutSettings } from "./native-shortcuts";
import { NativeLoginItemSettings } from "./native-login-item";

export function Library() {
  const offline = useSyncExternalStore(
    subscribeOfflineShell,
    offlineShellState,
  );
  const [notes, setNotes] = useState<Note[]>([]),
    [placements, setPlacements] = useState<Placement[]>([]),
    [query, setQuery] = useState(""),
    [section, setSection] = useState<NoteState>("active"),
    [tag, setTag] = useState<string | null>(null),
    [editor, setEditor] = useState<Note | null>(null),
    [settings, setSettings] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [loading, setLoading] = useState(true),
    [limit, setLimit] = useState(80),
    [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(
      null,
    ),
    [confirmDelete, setConfirmDelete] = useState<Note | null>(null);
  const file = useRef<HTMLInputElement>(null),
    dragCancelled = useRef(false);
  const refresh = async () => {
    try {
      const [n, p] = await Promise.all([
        repository.list(),
        repository.placements(),
      ]);
      setNotes(n);
      setPlacements(p);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void repository
      .maintenance()
      .then(refresh)
      .catch((e) => setError(String(e)));
    let timer: ReturnType<typeof setTimeout>;
    const changed = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void refresh(), 80);
    };
    window.addEventListener("peel-changed", changed);
    window.addEventListener("focus", changed);
    const channel = native ? null : new BroadcastChannel("peel-local");
    if (channel) channel.onmessage = changed;
    let disposed = false;
    const unlisteners: (() => void)[] = [];
    for (const promise of [
      listenNative("peel-changed", changed),
      listenNative("peel-settings", () => setSettings(true)),
      listenNative<string>("peel-error", setError),
    ])
      promise.then((fn) => (disposed ? fn() : unlisteners.push(fn)));
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        dragCancelled.current = true;
        setMenu(null);
        setSettings(false);
        setConfirmDelete(null);
      }
    };
    window.addEventListener("keydown", escape);
    return () => {
      disposed = true;
      clearTimeout(timer);
      channel?.close();
      window.removeEventListener("peel-changed", changed);
      window.removeEventListener("focus", changed);
      window.removeEventListener("keydown", escape);
      unlisteners.forEach((fn) => fn());
    };
  }, []);
  const open = async (note: Note) => {
    try {
      if (native && note.state === "active")
        await invoke("open_note", { noteId: note.noteId });
      else setEditor(note);
    } catch (e) {
      setError(String(e));
    }
  };
  const create = async () => {
    try {
      if (native) await invoke("new_note");
      else {
        const n = await repository.save(newNote(), 0);
        setEditor(n);
      }
      void refresh();
    } catch (e) {
      setError(String(e));
    }
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        !native &&
        (e.metaKey || e.ctrlKey) &&
        e.key.toLowerCase() === "n" &&
        !editor
      ) {
        e.preventDefault();
        void create();
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        document.querySelector<HTMLInputElement>("#note-search")?.focus();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [editor]);
  const lifecycle = async (note: Note, state: NoteState) => {
    try {
      if (
        native &&
        placements.some((p) => p.noteId === note.noteId && p.pinned)
      ) {
        await invoke("note_lifecycle", { noteId: note.noteId, state });
      } else await repository.save(setState(note, state), note.localRevision);
      setMenu(null);
      void refresh();
    } catch (e) {
      setError(String(e));
    }
  };
  const exportAll = async () => {
    try {
      const bytes = exportNotes(await repository.list());
      if (native) await invoke("export_archive", { bytes: Array.from(bytes) });
      else download(bytes, "Synkies-notes.zip");
    } catch (e) {
      setError(String(e));
    }
  };
  const importFile = async (f: File) => {
    try {
      const incoming = f.name.toLowerCase().endsWith(".md")
        ? [newNote("local", await f.text())]
        : importArchive(new Uint8Array(await f.arrayBuffer()));
      const result = await importInto(repository, incoming);
      setNotice(
        `Imported ${result.added}. Already present: ${result.skipped}.${result.recovered ? ` Preserved as new copies: ${result.recovered}.` : ""}`,
      );
      void refresh();
    } catch (e) {
      setError(String(e));
    }
  };
  const search = useSearch(
    notes,
    {
      query,
      tags: tag ? [tag] : [],
      state:
        section === "trashed"
          ? "trashed"
          : section === "archived"
            ? "archived"
            : query || tag
              ? undefined
              : "active",
    },
    limit,
  );
  const { results, tags } = search;
  const selected = notes.find((n) => n.noteId === menu?.id);
  const openDesktop = (note: Note) =>
    void invoke("open_note", { noteId: note.noteId }).catch((e) =>
      setError(String(e)),
    );
  const counts = useMemo(() => {
    const totals = { active: 0, archived: 0, trashed: 0 };
    for (const note of notes) totals[note.state]++;
    return totals;
  }, [notes]);
  const count = (s: NoteState) => counts[s];
  const changeSection = (s: NoteState) => {
    setSection(s);
    setTag(null);
    setQuery("");
    setLimit(80);
  };
  return (
    <main className="library">
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="Synkies home">
          <picture>
            <source
              media="(prefers-color-scheme: dark)"
              srcSet="/synkies-logo-dark.svg"
            />
            <img src="/synkies-logo-light.svg" alt="Synkies" />
          </picture>
          <span>Notes, close by.</span>
        </a>
        <div className="collection-label">
          <span className="device-dot" />
          On-device · Free
        </div>
        <nav aria-label="Notes collections">
          {(["active", "archived", "trashed"] as const).map((s) => (
            <button
              key={s}
              className={section === s && !tag ? "selected" : ""}
              onClick={() => changeSection(s)}
            >
              <Icon name={s} />
              <span>
                {s === "active"
                  ? "Notes"
                  : s === "archived"
                    ? "Archive"
                    : "Trash"}
              </span>
              <small>{count(s)}</small>
            </button>
          ))}
        </nav>
        <div className="sidebar-label">TAGS</div>
        <div className="tag-list">
          {tags.length ? (
            tags.map((t) => (
              <button
                key={t.key}
                className={tag === t.key ? "selected" : ""}
                onClick={() => {
                  setTag(tag === t.key ? null : t.key);
                  setSection("active");
                }}
              >
                <span className="hash">##</span>
                {t.label}
              </button>
            ))
          ) : (
            <p>
              Type ##tag in a note
              <br />
              to keep ideas together.
            </p>
          )}
        </div>
        <div className="sidebar-bottom">
          <span className="local-status">
            <i />
            {native || offline === "ready" || offline === "update-ready"
              ? "Saved here. Available offline."
              : "Saved in this browser."}
          </span>
          <button onClick={() => setSettings(true)}>
            <Icon name="settings" />
            Settings
          </button>
        </div>
      </aside>
      <section className="library-main" aria-busy={search.pending || loading}>
        <header className="library-header">
          <div>
            <p className="eyebrow">YOUR SPACE, YOUR PACE</p>
            <h1>
              {tag
                ? `##${tags.find((t) => t.key === tag)?.label}`
                : section === "active"
                  ? "Notes"
                  : section === "archived"
                    ? "Archive"
                    : "Trash"}
            </h1>
            <p>
              {section === "trashed"
                ? "Restore notes for 30 days. Permanent deletion cannot be undone."
                : section === "archived"
                  ? "Put away, still easy to find."
                  : `${count("active")} ${count("active") === 1 ? "note" : "notes"} · A little room for every thought.`}
            </p>
          </div>
          <button className="primary" onClick={() => void create()}>
            <Icon name="plus" />
            New note <kbd>⌘ N</kbd>
          </button>
        </header>
        <div className="search-row">
          <Icon name="search" />
          <input
            id="note-search"
            aria-label="Search notes"
            placeholder="Find a word, a phrase, a thought…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setLimit(80);
            }}
          />
          {query && (
            <button aria-label="Clear search" onClick={() => setQuery("")}>
              ×
            </button>
          )}
          <span className="search-mode">Words</span>
        </div>
        {query && (
          <p className="result-label" role="status" aria-live="polite">
            {search.pending
              ? "Searching…"
              : `${search.total} ${search.total === 1 ? "match" : "matches"}`}
            {section === "active" ? " · includes archived notes" : ""}
          </p>
        )}
        {search.error && (
          <div className="banner error" role="alert">
            {search.error}
            <button onClick={search.retry}>Retry search</button>
          </div>
        )}
        {error && (
          <div className="banner error" role="alert">
            {error.replace(/^Error: /, "")}
            <button aria-label="Dismiss error" onClick={() => setError("")}>
              ×
            </button>
          </div>
        )}
        {notice && (
          <div className="banner" role="status">
            {notice}
            <button aria-label="Dismiss message" onClick={() => setNotice("")}>
              ×
            </button>
          </div>
        )}
        {loading || (search.pending && !results.length) ? (
          <div className="empty-state">
            <p>Opening your notes…</p>
          </div>
        ) : results.length === 0 ? (
          <div className="empty-state">
            <div className="empty-paper">
              <Icon name="active" />
            </div>
            <h2>
              {query
                ? "Nothing here yet."
                : section === "active"
                  ? "Give that thought a home."
                  : section === "archived"
                    ? "A clear shelf."
                    : "Nothing in Trash."}
            </h2>
            <p>
              {query
                ? "Try fewer words or clear your tag filter."
                : section === "active"
                  ? "Open a note, type, and carry on. Synkies saves as you go."
                  : "Your notes will appear here when you put them away."}
            </p>
            {section === "active" && !query && (
              <button className="primary" onClick={() => void create()}>
                Create your first note
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="note-grid">
              {results.map(({ note, excerpt }) => {
                const pinned = placements.some(
                  (p) => p.noteId === note.noteId && p.pinned,
                );
                return (
                  <article
                    key={note.noteId}
                    className="note-card"
                    draggable={native && note.state === "active"}
                    onDragStart={(e) => {
                      dragCancelled.current = false;
                      e.dataTransfer.setData("text/plain", note.noteId);
                      e.dataTransfer.effectAllowed = "copy";
                    }}
                    onDragEnd={(e) => {
                      if (
                        !native ||
                        dragCancelled.current ||
                        (e.screenX === 0 && e.screenY === 0)
                      )
                        return;
                      const inside =
                        e.screenX >= window.screenX &&
                        e.screenX <= window.screenX + window.outerWidth &&
                        e.screenY >= window.screenY &&
                        e.screenY <= window.screenY + window.outerHeight;
                      if (!inside)
                        void invoke("open_note", {
                          noteId: note.noteId,
                          x: e.screenX - 24,
                          y: e.screenY - 18,
                        }).catch((x) => setError(String(x)));
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setMenu({
                        id: note.noteId,
                        x: Math.max(
                          8,
                          Math.min(e.clientX, window.innerWidth - 232),
                        ),
                        y: Math.max(
                          8,
                          Math.min(e.clientY, window.innerHeight - 290),
                        ),
                      });
                    }}
                  >
                    <button
                      className="card-open"
                      onClick={() => void open(note)}
                      aria-label={`Open ${titleOf(note.bodyMarkdown)}`}
                    >
                      <div className="card-top">
                        <span>
                          {note.state === "archived"
                            ? "Archived"
                            : pinned
                              ? "On desktop"
                              : "Note"}
                        </span>
                        <span>
                          {new Date(note.updatedAt).toLocaleDateString(
                            undefined,
                            { month: "short", day: "numeric" },
                          )}
                        </span>
                      </div>
                      <h2>{titleOf(note.bodyMarkdown)}</h2>
                      <p>
                        {query
                          ? excerpt
                          : note.bodyMarkdown
                              .split("\n")
                              .slice(1)
                              .join("\n")
                              .replace(/\*\*/g, "")
                              .slice(0, 280) || "A little room to think."}
                      </p>
                      <div className="card-tags">
                        {tagsOf(note.bodyMarkdown)
                          .slice(0, 4)
                          .map((t) => (
                            <span key={t.key}>##{t.label}</span>
                          ))}
                      </div>
                    </button>
                    <button
                      className="card-actions"
                      aria-label={`Actions for ${titleOf(note.bodyMarkdown)}`}
                      onClick={(e) =>
                        setMenu({
                          id: note.noteId,
                          x: Math.min(e.clientX, window.innerWidth - 232),
                          y: Math.min(e.clientY, window.innerHeight - 290),
                        })
                      }
                    >
                      •••
                    </button>
                  </article>
                );
              })}
            </div>
            {search.total > limit && (
              <button
                className="load-more"
                disabled={search.pending}
                onClick={() => setLimit((x) => x + 80)}
              >
                Show more notes
              </button>
            )}
          </>
        )}
        <footer className="library-footer">
          Your notes stay on this device.
          {native
            ? " Drag a card out of this window to pin it."
            : " Export regularly to keep a portable backup."}
        </footer>
      </section>
      {editor && (
        <div className="editor-backdrop">
          <NoteEditor
            standalone={false}
            key={editor.noteId}
            initial={editor}
            onClose={() => {
              setEditor(null);
              void refresh();
            }}
            onLibrary={() => {
              setEditor(null);
              void refresh();
            }}
          />
        </div>
      )}
      {menu && selected && (
        <>
          <div className="menu-scrim" onClick={() => setMenu(null)} />
          <div
            className="context-menu"
            role="menu"
            style={{ left: menu.x, top: menu.y }}
          >
            {native && selected.state === "active" && (
              <>
                <button
                  role="menuitem"
                  onClick={() => {
                    openDesktop(selected);
                    setMenu(null);
                  }}
                >
                  {placements.some(
                    (p) => p.noteId === selected.noteId && p.pinned,
                  )
                    ? "Bring to front"
                    : "Pin to desktop"}
                </button>
                {placements.some(
                  (p) => p.noteId === selected.noteId && p.pinned,
                ) && (
                  <button
                    role="menuitem"
                    onClick={() => {
                      void invoke("close_desktop_note", {
                        noteId: selected.noteId,
                      }).catch((e) => setError(String(e)));
                      setMenu(null);
                    }}
                  >
                    Remove from desktop
                  </button>
                )}
                <hr />
              </>
            )}
            <button
              role="menuitem"
              onClick={() =>
                void lifecycle(
                  selected,
                  selected.state === "active" ? "archived" : "active",
                )
              }
            >
              {selected.state === "active"
                ? "Archive note"
                : "Restore to Notes"}
            </button>
            {selected.state !== "trashed" ? (
              <button
                role="menuitem"
                className="danger"
                onClick={() => void lifecycle(selected, "trashed")}
              >
                Move to Trash
              </button>
            ) : (
              <button
                role="menuitem"
                className="danger"
                onClick={() => {
                  setConfirmDelete(selected);
                  setMenu(null);
                }}
              >
                Delete permanently…
              </button>
            )}
          </div>
        </>
      )}
      {confirmDelete && (
        <div className="modal-backdrop">
          <section
            className="dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-title"
          >
            <p className="eyebrow">PERMANENT DELETION</p>
            <h2 id="delete-title">Delete this note forever?</h2>
            <p>
              “{titleOf(confirmDelete.bodyMarkdown)}” will be removed from this
              device. Exported copies are kept separately.
            </p>
            <div className="dialog-actions">
              <button onClick={() => setConfirmDelete(null)}>
                Keep in Trash
              </button>
              <button
                className="destructive"
                onClick={() =>
                  void repository
                    .purge(confirmDelete.noteId, confirmDelete.localRevision)
                    .then(() => {
                      setConfirmDelete(null);
                      void refresh();
                    })
                    .catch((e) => setError(String(e)))
                }
              >
                Delete permanently
              </button>
            </div>
          </section>
        </div>
      )}
      {settings && (
        <Settings
          onClose={() => setSettings(false)}
          onExport={() => void exportAll()}
          onImport={() => file.current?.click()}
        />
      )}
      <input
        hidden
        ref={file}
        type="file"
        accept=".zip,.md"
        aria-label="Import Synkies notes"
        onChange={(e) => {
          if (e.target.files?.[0]) void importFile(e.target.files[0]);
          e.target.value = "";
        }}
      />
    </main>
  );
}
function Settings({
  onClose,
  onExport,
  onImport,
}: {
  onClose: () => void;
  onExport: () => void;
  onImport: () => void;
}) {
  const [persistent, setPersistent] = useState<boolean | null>(null),
    [error, setError] = useState("");
  const offline = useSyncExternalStore(
    subscribeOfflineShell,
    offlineShellState,
  );
  useEffect(() => {
    if (!native)
      void navigator.storage
        ?.persisted()
        .then(setPersistent)
        .catch(() => setPersistent(false));
  }, []);
  return (
    <div className="modal-backdrop">
      <section
        className="dialog settings"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        <button
          className="dialog-close"
          aria-label="Close settings"
          onClick={onClose}
        >
          ×
        </button>
        <p className="eyebrow">MAKE YOURSELF AT HOME</p>
        <h2 id="settings-title">Settings</h2>
        <h3>Saving mode</h3>
        <div className="setting-row">
          <div>
            <strong>On-device · Free</strong>
            <p>
              {native
                ? "Your notes live in a small local database."
                : "Notes belong to this browser profile. Clearing site data removes them."}
            </p>
          </div>
          <span className="badge">Current mode</span>
        </div>
        <div className="setting-row">
          <div>
            <strong>Device sync</strong>
            <p>
              No device is paired in this development build. Your notes are
              saved here; remote sync is not enabled yet.
            </p>
          </div>
        </div>
        <div className="setting-row">
          <div>
            <strong>Synkies Cloud · Paid</strong>
            <p>
              Not available in this build. Cloud mode will store the whole
              library and sync live.
            </p>
          </div>
        </div>
        {!native && (
          <div className="setting-row">
            <div>
              <strong>Browser storage</strong>
              <p>
                {persistent
                  ? "Persistent storage granted. Keep backups of important notes."
                  : "The browser may reclaim storage. Export important notes regularly."}
              </p>
            </div>
            {!persistent && (
              <button
                onClick={() =>
                  void navigator.storage
                    ?.persist()
                    .then(setPersistent)
                    .catch(() =>
                      setError(
                        "Persistent storage is unavailable. Export important notes to keep a backup.",
                      ),
                    )
                }
              >
                Request persistence
              </button>
            )}
          </div>
        )}
        {!native && (
          <div className="setting-row">
            <div>
              <strong>Offline access</strong>
              <p role="status">
                {offline === "ready"
                  ? "Synkies can reopen without an internet connection. Browser data can still be cleared."
                  : offline === "update-ready"
                    ? "An update is ready. It will apply after all Synkies tabs close. Your notes save on this device."
                    : offline === "preparing"
                      ? "Preparing offline access…"
                      : offline === "development"
                        ? "Offline access is available in production browser builds."
                        : offline === "unsupported"
                          ? "This browser cannot prepare offline access. Saved notes remain in this browser profile."
                          : "Offline access could not be prepared. Notes already saved remain in this browser profile."}
              </p>
            </div>
            {offline === "unavailable" && (
              <button onClick={retryOfflineShell}>Retry offline setup</button>
            )}
          </div>
        )}
        <h3>Your notes, in your hands</h3>
        <p>
          Export Markdown files and a metadata manifest in a ZIP. Import a
          Synkies ZIP or a Markdown file. Importing never uploads notes.
        </p>
        <div className="setting-buttons">
          <button onClick={onExport}>Export notes…</button>
          <button onClick={onImport}>Import notes…</button>
        </div>
        {native && (
          <>
            <NativeFolderSettings />
            <NativeShortcutSettings />
            <NativeLoginItemSettings />
            <h3>Desktop</h3>
            <p>
              Command Shift L opens the library. Choose your global capture and
              arrangement keys above. The Window menu includes Undo last
              arrangement.
            </p>
          </>
        )}
        {error && <p role="alert">{error}</p>}
        <p className="version">Synkies 0.1 · Local development build</p>
      </section>
    </div>
  );
}
export function Icon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    plus: "M12 5v14M5 12h14",
    search: "m20 20-4.5-4.5M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0",
    active: "M5 3h14v13l-5 5H5zM14 21v-5h5",
    archived: "M4 8h16v12H4zM3 3h18v5H3zM9 12h6",
    trashed: "M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7",
    settings:
      "m10 3-1 3-3 1-3 3 3 2 1 4 3 1 2 4 3-3 4-1 1-4 3-2-3-3-3-1-1-3zM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
  };
  return (
    <svg
      width="19"
      height="19"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name] ?? paths.active} />
    </svg>
  );
}
