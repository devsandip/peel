import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import "./cloud-cached-library.css";
import {
  validateCloudScope,
  type CloudScope,
} from "../../../packages/cloud-protocol/src/durable";
import { cloudScopeHash } from "../../../packages/cloud-protocol/src/pull";
import {
  validateCloudLibraryPage,
  type CloudLibraryCollection,
  type CloudLibraryCursor,
  type CloudLibraryPage,
  type CloudLibraryStateStore,
} from "../../../packages/cloud-protocol/src/library-local";

export type CloudLibraryContext = Readonly<{
  store: CloudLibraryStateStore;
  scope: Readonly<CloudScope>;
}>;
export type CloudLibraryNoteSelection = CloudLibraryContext &
  Readonly<{ noteId: string }>;
type Props = {
  store: CloudLibraryStateStore;
  scope: CloudScope;
  signal: AbortSignal;
  refreshKey: number;
  onOpen?: (selection: CloudLibraryNoteSelection) => void | Promise<void>;
  onCreate?: (context: CloudLibraryContext) => void | Promise<void>;
};
function capture(scope: CloudScope) {
  try {
    return validateCloudScope(scope);
  } catch {
    return null;
  }
}
/** Cached metadata only; neither this panel nor its callbacks authenticate Cloud. */
export function CloudCachedLibrary(props: Props) {
  const scope = capture(props.scope),
    key = scope ? JSON.stringify(scope) : null,
    [selected, setSelected] = useState({
      store: props.store,
      signal: props.signal,
      scope,
      key,
      serial: 0,
    });
  if (
    selected.store !== props.store ||
    selected.signal !== props.signal ||
    selected.key !== key
  ) {
    setSelected({
      store: props.store,
      signal: props.signal,
      scope,
      key,
      serial: selected.serial + 1,
    });
    return null;
  }
  if (!selected.scope)
    return <p role="alert">Cached Cloud library unavailable</p>;
  return (
    <SelectedLibrary key={selected.serial} {...props} scope={selected.scope} />
  );
}
function SelectedLibrary({
  store,
  scope,
  signal,
  refreshKey,
  onOpen,
  onCreate,
}: Props) {
  const [collection, setCollection] = useState<CloudLibraryCollection>("notes"),
    [position, setPosition] = useState<{
      collection: CloudLibraryCollection;
      refreshKey: number;
      cursor: CloudLibraryCursor | null;
    }>({ collection: "notes", refreshKey, cursor: null }),
    [revision, setRevision] = useState(0);
  const cursor =
    position.collection === collection && position.refreshKey === refreshKey
      ? position.cursor
      : null;
  const selection = useMemo(
    () =>
      Number.isSafeInteger(refreshKey) && refreshKey >= 0
        ? {
            request: { collection, limit: 32, cursor },
            revision,
            refreshKey,
          }
        : null,
    [collection, cursor, revision, refreshKey],
  );
  const context = useMemo(
    () => Object.freeze({ store, scope: Object.freeze({ ...scope }) }),
    [store, scope],
  );
  const [loaded, setLoaded] = useState<{
      selection: NonNullable<typeof selection>;
      page: CloudLibraryPage | null;
    } | null>(null),
    [issue, setIssue] = useState<{
      selection: typeof selection;
      message: string;
    } | null>(null);
  const active = useRef(false),
    current = useRef(selection);
  current.current = selection;
  useLayoutEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(() => {
    if (!selection) return;
    let pending = true;
    const abort = () => {
      pending = false;
      if (active.current) setLoaded({ selection, page: null });
    };
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    void Promise.resolve()
      .then(() => store.listLibrary(scope, selection.request))
      .then(async (raw) => {
        const page = validateCloudLibraryPage(scope, selection.request, raw);
        if (page.pull && page.pull.scopeHash !== (await cloudScopeHash(scope)))
          throw Error("Foreign cached download");
        return page;
      })
      .then(
        (page) => {
          if (pending && !signal.aborted) setLoaded({ selection, page });
        },
        () => {
          if (pending && !signal.aborted) setLoaded({ selection, page: null });
        },
      );
    return () => {
      pending = false;
      signal.removeEventListener("abort", abort);
    };
  }, [store, scope, signal, selection]);
  const visible = loaded?.selection === selection ? loaded : null,
    unavailable =
      !selection ||
      signal.aborted ||
      (visible !== null && visible.page === null),
    page = unavailable ? null : visible?.page;
  const invoke = async (action: (() => void | Promise<void>) | undefined) => {
    if (
      !action ||
      !active.current ||
      signal.aborted ||
      !selection ||
      current.current !== selection
    )
      return;
    try {
      await action();
    } catch {
      if (active.current && !signal.aborted && current.current === selection)
        setIssue({
          selection,
          message:
            "Could not open this cached note. Your drafts remain on this device.",
        });
    }
  };
  const refresh = () => {
    setPosition({ collection, refreshKey, cursor: null });
    setRevision((old) => old + 1);
  };
  const status = unavailable
    ? "Cached Cloud library unavailable"
    : !page
      ? "Loading cached notes"
      : !page.pull
        ? "Cloud library has not been downloaded on this device."
        : page.pull.next
          ? "Cloud download is incomplete. Showing cached notes."
          : "Last Cloud download complete. Showing cached notes.";
  return (
    <section
      className="library-main cloud-cached-library"
      aria-label="Cached Cloud library"
      aria-busy={!unavailable && !page}
    >
      <header className="library-header">
        <h1>Cached Cloud notes</h1>
        {onCreate && (
          <button
            className="primary"
            disabled={!selection || signal.aborted}
            onClick={() => void invoke(() => onCreate(context))}
          >
            New note
          </button>
        )}
        <button disabled={!selection || signal.aborted} onClick={refresh}>
          Refresh cached notes
        </button>
      </header>
      <nav aria-label="Cached collections">
        {(
          [
            ["notes", "Notes"],
            ["archive", "Archive"],
            ["trash", "Trash"],
            ["attention", "Needs attention"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            className={collection === value ? "primary" : undefined}
            aria-pressed={collection === value}
            onClick={() => setCollection(value)}
          >
            {label}
          </button>
        ))}
      </nav>
      <p className="result-label" role="status" aria-live="polite">
        {status}
      </p>
      {issue?.selection === selection && <p role="alert">{issue.message}</p>}
      {page && (
        <>
          {!page.entries.length && <p>No cached notes in this collection.</p>}
          <ul className="note-grid">
            {page.entries.map((entry) => {
              const content = (
                <>
                  <div className="card-top">
                    <span>{entry.status}</span>
                    {entry.updatedAt && (
                      <time dateTime={entry.updatedAt}>
                        {new Date(entry.updatedAt).toLocaleDateString()}
                      </time>
                    )}
                  </div>
                  <h2>{entry.title ?? "Cloud note needs recovery"}</h2>
                  {entry.kind === "recovery" && <p>Local recovery required</p>}
                </>
              );
              return (
                <li key={entry.noteId} className="note-card">
                  {entry.kind === "active" && onOpen ? (
                    <button
                      className="card-open"
                      aria-label={`Open ${entry.title}`}
                      onClick={() =>
                        void invoke(() =>
                          onOpen(
                            Object.freeze({ ...context, noteId: entry.noteId }),
                          ),
                        )
                      }
                    >
                      {content}
                    </button>
                  ) : (
                    <div className="card-open">{content}</div>
                  )}
                </li>
              );
            })}
          </ul>
          {page.next && (
            <button
              onClick={() =>
                setPosition({ collection, refreshKey, cursor: page.next })
              }
            >
              More cached notes
            </button>
          )}
          {cursor && <button onClick={refresh}>Back to recent notes</button>}
        </>
      )}
    </section>
  );
}
