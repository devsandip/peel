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
export type CloudCachedLibraryProps = {
  store: CloudLibraryStateStore;
  scope: CloudScope;
  signal: AbortSignal;
  refreshKey: number;
  onOpen?: (selection: CloudLibraryNoteSelection) => void | Promise<void>;
  onCreate?: (context: CloudLibraryContext) => void | Promise<void>;
  onInspectConflict?: (
    selection: CloudLibraryNoteSelection,
  ) => void | Promise<void>;
};

const DEFAULT_ACTION_ERROR =
  "Could not open this cached note. Your drafts remain on this device.";
const INSPECT_CONFLICT_ERROR =
  "Could not inspect this Cloud conflict. Preserved versions on this device were not changed.";

function ownDataProperty(
  target: object,
  key: string,
): { ok: true; value: unknown } | { ok: false } {
  const descriptor = Object.getOwnPropertyDescriptor(target, key);
  if (!descriptor) return { ok: true, value: undefined };
  if (!descriptor.enumerable || !("value" in descriptor)) return { ok: false };
  return { ok: true, value: descriptor.value };
}

function isAbortSignalLike(input: unknown): input is AbortSignal {
  if (typeof AbortSignal === "function" && input instanceof AbortSignal)
    return true;
  if (!input || typeof input !== "object") return false;
  const candidate = input as AbortSignal;
  return (
    typeof candidate.aborted === "boolean" &&
    typeof candidate.addEventListener === "function" &&
    typeof candidate.removeEventListener === "function"
  );
}

function capture(input: unknown): Readonly<CloudScope> | null {
  try {
    if (!input || typeof input !== "object" || Array.isArray(input))
      return null;
    const proto = Object.getPrototypeOf(input);
    if (proto !== Object.prototype && proto !== null) return null;
    if (Object.getOwnPropertySymbols(input).length > 0) return null;
    const names = Object.getOwnPropertyNames(input);
    if (names.length !== 4) return null;
    for (const name of names) {
      const descriptor = Object.getOwnPropertyDescriptor(input, name);
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor))
        return null;
    }
    const raw = input as CloudScope;
    return Object.freeze(
      validateCloudScope({
        version: raw.version,
        ownerSubject: raw.ownerSubject,
        collectionId: raw.collectionId,
        modeGeneration: raw.modeGeneration,
      }),
    );
  } catch {
    return null;
  }
}

function captureLibraryProps(rawProps: unknown): {
  store: CloudLibraryStateStore | null;
  scope: Readonly<CloudScope> | null;
  signal: AbortSignal | null;
  refreshKey: number;
  onOpen: CloudCachedLibraryProps["onOpen"];
  onCreate: CloudCachedLibraryProps["onCreate"];
  onInspectConflict: CloudCachedLibraryProps["onInspectConflict"];
} {
  if (!rawProps || typeof rawProps !== "object" || Array.isArray(rawProps)) {
    return {
      store: null,
      scope: null,
      signal: null,
      refreshKey: -1,
      onOpen: undefined,
      onCreate: undefined,
      onInspectConflict: undefined,
    };
  }
  const storeProp = ownDataProperty(rawProps, "store"),
    scopeProp = ownDataProperty(rawProps, "scope"),
    signalProp = ownDataProperty(rawProps, "signal"),
    refreshKeyProp = ownDataProperty(rawProps, "refreshKey"),
    onOpenProp = ownDataProperty(rawProps, "onOpen"),
    onCreateProp = ownDataProperty(rawProps, "onCreate"),
    onInspectProp = ownDataProperty(rawProps, "onInspectConflict");
  if (
    !storeProp.ok ||
    !scopeProp.ok ||
    !signalProp.ok ||
    !refreshKeyProp.ok ||
    !onOpenProp.ok ||
    !onCreateProp.ok ||
    !onInspectProp.ok
  ) {
    return {
      store: null,
      scope: null,
      signal: null,
      refreshKey: -1,
      onOpen: undefined,
      onCreate: undefined,
      onInspectConflict: undefined,
    };
  }
  const rawStore = storeProp.value;
  const store =
    rawStore &&
    typeof rawStore === "object" &&
    typeof (rawStore as CloudLibraryStateStore).listLibrary === "function"
      ? (rawStore as CloudLibraryStateStore)
      : null;
  const signal = isAbortSignalLike(signalProp.value) ? signalProp.value : null;
  const scope = store && signal ? capture(scopeProp.value) : null;
  return {
    store,
    scope,
    signal,
    refreshKey: refreshKeyProp.value as number,
    onOpen:
      typeof onOpenProp.value === "function"
        ? (onOpenProp.value as CloudCachedLibraryProps["onOpen"])
        : undefined,
    onCreate:
      typeof onCreateProp.value === "function"
        ? (onCreateProp.value as CloudCachedLibraryProps["onCreate"])
        : undefined,
    onInspectConflict:
      typeof onInspectProp.value === "function"
        ? (onInspectProp.value as CloudCachedLibraryProps["onInspectConflict"])
        : undefined,
  };
}

/** Cached metadata only; neither this panel nor its callbacks authenticate Cloud. */
export function CloudCachedLibrary(props: CloudCachedLibraryProps) {
  const captured = captureLibraryProps(props),
    key = captured.scope ? JSON.stringify(captured.scope) : null,
    [selected, setSelected] = useState({
      store: captured.store,
      signal: captured.signal,
      scope: captured.scope,
      key,
      serial: 0,
    });
  if (
    selected.store !== captured.store ||
    selected.signal !== captured.signal ||
    selected.key !== key
  ) {
    setSelected({
      store: captured.store,
      signal: captured.signal,
      scope: captured.scope,
      key,
      serial: selected.serial + 1,
    });
    return null;
  }
  if (!selected.store || !selected.signal || !selected.scope)
    return <p role="alert">Cached Cloud library unavailable</p>;
  return (
    <SelectedLibrary
      key={selected.serial}
      store={selected.store}
      scope={selected.scope}
      signal={selected.signal}
      refreshKey={captured.refreshKey}
      onOpen={captured.onOpen}
      onCreate={captured.onCreate}
      onInspectConflict={captured.onInspectConflict}
    />
  );
}
function SelectedLibrary({
  store,
  scope,
  signal,
  refreshKey,
  onOpen,
  onCreate,
  onInspectConflict,
}: CloudCachedLibraryProps) {
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
  const invoke = async (
    action: (() => void | Promise<void>) | undefined,
    errorMessage = DEFAULT_ACTION_ERROR,
  ) => {
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
          message: errorMessage,
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
              const canInspectConflict =
                  entry.status === "Conflict" &&
                  typeof onInspectConflict === "function",
                cardTitle = entry.title ?? "Cloud note needs recovery";
              return (
                <li
                  key={entry.noteId}
                  className={
                    canInspectConflict
                      ? "note-card note-card-conflict"
                      : "note-card"
                  }
                >
                  {entry.kind === "active" && typeof onOpen === "function" ? (
                    <button
                      type="button"
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
                  {canInspectConflict && (
                    <div className="card-conflict-footer">
                      <button
                        type="button"
                        className="card-inspect-conflict"
                        data-conflict-note-id={entry.noteId}
                        disabled={!selection || signal.aborted}
                        aria-label={`Inspect conflict for ${cardTitle}`}
                        onClick={() =>
                          void invoke(
                            () =>
                              onInspectConflict(
                                Object.freeze({
                                  ...context,
                                  noteId: entry.noteId,
                                }),
                              ),
                            INSPECT_CONFLICT_ERROR,
                          )
                        }
                      >
                        Inspect conflict
                      </button>
                    </div>
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
