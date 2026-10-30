import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import "./cloud-conflict-preview.css";
import type {
  CloudClientState,
  CloudDraft,
} from "../../../packages/cloud-protocol/src/index";
import {
  DurableCloudClient,
  cloudStateInScope,
  validateCloudNoteId,
  validateCloudScope,
  type CloudScope,
} from "../../../packages/cloud-protocol/src/durable";
import type { CloudLibraryStateStore } from "../../../packages/cloud-protocol/src/library-local";
import type { CloudLibraryContext } from "./cloud-cached-library";

export type CloudConflictPreviewProps = {
  context: CloudLibraryContext;
  noteId: string;
  signal: AbortSignal;
  refreshKey: number;
};

type CapturedPreviewIdentity = Readonly<{
  store: CloudLibraryStateStore;
  scope: Readonly<CloudScope>;
  scopeKey: string;
  noteId: string;
  signal: AbortSignal;
}>;

type ActiveLifecycleLabel = "Active" | "Archived" | "In Trash";

type ProjectedLocalVersion =
  | Readonly<{
      kind: "upsert";
      lifecycle: ActiveLifecycleLabel;
      stateWord: CloudDraft["state"];
      bodyMarkdown: string;
    }>
  | Readonly<{
      kind: "purge";
      lifecycle: "Permanent purge queued";
      bodyMarkdown: null;
    }>;

type ProjectedRemoteVersion =
  | Readonly<{
      kind: "snapshot";
      lifecycle: ActiveLifecycleLabel;
      stateWord: CloudDraft["state"];
      revision: number;
      bodyMarkdown: string;
    }>
  | Readonly<{
      kind: "purged";
      lifecycle: "Permanently purged in Cloud";
      revision: number;
      bodyMarkdown: null;
    }>;

type ProjectedPreview =
  | Readonly<{
      kind: "no-conflict";
      status:
        | "No cached Cloud note"
        | "Pending upload"
        | "Deleted in Cloud"
        | "Saved in Cloud";
      detail: string;
    }>
  | Readonly<{
      kind: "conflict";
      baseRevision: number;
      local: ProjectedLocalVersion;
      remote: ProjectedRemoteVersion;
    }>;

type CopySide = "local" | "remote";

type SelectedConflictPreviewProps = {
  store: CloudLibraryStateStore;
  scope: Readonly<CloudScope>;
  noteId: string;
  signal: AbortSignal;
  refreshKey: number;
};

const UNAVAILABLE_COPY =
  "Cloud conflict preview unavailable. Preserved versions on this device were not changed.";

const LOADING_COPY = "Loading Cloud conflict preview...";

const CONFLICT_SUMMARY_COPY =
  "Conflict: Automatic Cloud upload is paused while both preserved versions remain on this device.";

const COPY_SUCCESS_MESSAGES: Readonly<Record<CopySide, string>> = Object.freeze(
  {
    local: "Draft text copied to clipboard.",
    remote: "Observed Cloud text copied to clipboard.",
  },
);

const COPY_ERROR_MESSAGES: Readonly<Record<CopySide, string>> = Object.freeze({
  local:
    "Could not copy draft text. Select the text below to copy it manually.",
  remote:
    "Could not copy observed Cloud text. Select the text below to copy it manually.",
});

function ownDataProperty(
  target: object,
  key: string,
): { ok: true; value: unknown } | { ok: false } {
  const descriptor = Object.getOwnPropertyDescriptor(target, key);
  if (!descriptor || !descriptor.enumerable || !("value" in descriptor))
    return { ok: false };
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

function captureScopeWithoutGetters(
  input: unknown,
): Readonly<CloudScope> | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const proto = Object.getPrototypeOf(input);
  if (proto !== Object.prototype && proto !== null) return null;
  if (Object.getOwnPropertySymbols(input).length > 0) return null;
  if (Object.getOwnPropertyNames(input).length !== 4) return null;
  const version = ownDataProperty(input, "version"),
    ownerSubject = ownDataProperty(input, "ownerSubject"),
    collectionId = ownDataProperty(input, "collectionId"),
    modeGeneration = ownDataProperty(input, "modeGeneration");
  if (!version.ok || !ownerSubject.ok || !collectionId.ok || !modeGeneration.ok)
    return null;
  return Object.freeze(
    validateCloudScope({
      version: version.value,
      ownerSubject: ownerSubject.value,
      collectionId: collectionId.value,
      modeGeneration: modeGeneration.value,
    } as CloudScope),
  );
}

function capturePreviewProps(rawProps: unknown): {
  identity: CapturedPreviewIdentity | null;
  refreshKey: unknown;
} {
  try {
    if (!rawProps || typeof rawProps !== "object" || Array.isArray(rawProps)) {
      return { identity: null, refreshKey: -1 };
    }
    const contextProp = ownDataProperty(rawProps, "context"),
      noteIdProp = ownDataProperty(rawProps, "noteId"),
      signalProp = ownDataProperty(rawProps, "signal"),
      refreshKeyProp = ownDataProperty(rawProps, "refreshKey");
    if (
      !contextProp.ok ||
      !noteIdProp.ok ||
      !signalProp.ok ||
      !refreshKeyProp.ok
    ) {
      return { identity: null, refreshKey: -1 };
    }
    return {
      identity: capturePreviewIdentity(
        contextProp.value,
        noteIdProp.value,
        signalProp.value,
      ),
      refreshKey: refreshKeyProp.value,
    };
  } catch {
    return { identity: null, refreshKey: -1 };
  }
}

function capturePreviewIdentity(
  rawContext: unknown,
  rawNoteId: unknown,
  rawSignal: unknown,
): CapturedPreviewIdentity | null {
  try {
    if (
      !rawContext ||
      typeof rawContext !== "object" ||
      Array.isArray(rawContext)
    )
      return null;
    const proto = Object.getPrototypeOf(rawContext);
    if (proto !== Object.prototype && proto !== null) return null;
    if (Object.getOwnPropertySymbols(rawContext).length > 0) return null;
    for (const key of Object.getOwnPropertyNames(rawContext)) {
      if (!ownDataProperty(rawContext, key).ok) return null;
    }
    const storeProp = ownDataProperty(rawContext, "store"),
      scopeProp = ownDataProperty(rawContext, "scope");
    if (!storeProp.ok || !scopeProp.ok) return null;
    const store = storeProp.value;
    if (
      !store ||
      typeof store !== "object" ||
      typeof (store as CloudLibraryStateStore).read !== "function"
    )
      return null;
    const scope = captureScopeWithoutGetters(scopeProp.value);
    if (!scope) return null;
    if (typeof rawNoteId !== "string") return null;
    validateCloudNoteId(rawNoteId);
    if (!isAbortSignalLike(rawSignal)) return null;
    return Object.freeze({
      store: store as CloudLibraryStateStore,
      scope,
      scopeKey: JSON.stringify(scope),
      noteId: rawNoteId,
      signal: rawSignal,
    });
  } catch {
    return null;
  }
}

function lifecycleLabel(state: CloudDraft["state"]): ActiveLifecycleLabel {
  if (state === "archived") return "Archived";
  if (state === "trashed") return "In Trash";
  return "Active";
}

function projectConflictPreviewState(
  scope: CloudScope,
  noteId: string,
  raw: CloudClientState | null,
): ProjectedPreview {
  const state = raw === null ? null : cloudStateInScope(scope, noteId, raw);
  if (!state?.current) {
    return Object.freeze({
      kind: "no-conflict",
      status: "No cached Cloud note",
      detail:
        "No cached Cloud note is stored for this selection on this device.",
    });
  }
  if (!state.conflict) {
    if (state.pending || state.inFlight || state.baseRevision === 0) {
      return Object.freeze({
        kind: "no-conflict",
        status: "Pending upload",
        detail:
          state.current.kind === "purge"
            ? "No Cloud conflict is recorded for this note. Permanent deletion remains pending upload on this device."
            : "No Cloud conflict is recorded for this note. Local changes remain pending upload on this device.",
      });
    }
    if (state.current.kind === "purge") {
      return Object.freeze({
        kind: "no-conflict",
        status: "Deleted in Cloud",
        detail:
          "No Cloud conflict is recorded for this note. This note identity was permanently deleted in Cloud.",
      });
    }
    return Object.freeze({
      kind: "no-conflict",
      status: "Saved in Cloud",
      detail: "No Cloud conflict is recorded for this note.",
    });
  }
  const local: ProjectedLocalVersion =
    state.conflict.local.kind === "purge"
      ? Object.freeze({
          kind: "purge",
          lifecycle: "Permanent purge queued",
          bodyMarkdown: null,
        })
      : Object.freeze({
          kind: "upsert",
          lifecycle: lifecycleLabel(state.conflict.local.snapshot.state),
          stateWord: state.conflict.local.snapshot.state,
          bodyMarkdown: state.conflict.local.snapshot.bodyMarkdown,
        });
  const remote: ProjectedRemoteVersion =
    state.conflict.remote === null
      ? Object.freeze({
          kind: "purged",
          lifecycle: "Permanently purged in Cloud",
          revision: state.conflict.remoteRevision,
          bodyMarkdown: null,
        })
      : Object.freeze({
          kind: "snapshot",
          lifecycle: lifecycleLabel(state.conflict.remote.state),
          stateWord: state.conflict.remote.state,
          revision: state.conflict.remoteRevision,
          bodyMarkdown: state.conflict.remote.bodyMarkdown,
        });
  return Object.freeze({
    kind: "conflict",
    baseRevision: state.baseRevision,
    local,
    remote,
  });
}

function UnavailablePreview() {
  const headingId = useId();
  return (
    <section
      className="cloud-conflict-preview"
      aria-labelledby={headingId}
      aria-busy={false}
    >
      <header className="cloud-conflict-preview-header">
        <h1 id={headingId}>Cloud conflict preview</h1>
      </header>
      <p className="cloud-conflict-preview-unavailable" role="alert">
        {UNAVAILABLE_COPY}
      </p>
    </section>
  );
}

/**
 * Read-only scoped Cloud conflict preview. Reads only the originally captured
 * store/scope/noteId cache and copies only on explicit user clicks; never
 * opens/closes storage, resolves conflicts, calls network transports or
 * activates Cloud mode.
 */
export function CloudConflictPreview(props: CloudConflictPreviewProps) {
  const { identity: captured, refreshKey } = capturePreviewProps(props),
    [selected, setSelected] = useState(() => ({
      store: captured?.store ?? null,
      signal: captured?.signal ?? null,
      scope: captured?.scope ?? null,
      scopeKey: captured?.scopeKey ?? null,
      noteId: captured?.noteId ?? null,
      serial: 0,
    }));

  if (
    selected.store !== (captured?.store ?? null) ||
    selected.signal !== (captured?.signal ?? null) ||
    selected.scopeKey !== (captured?.scopeKey ?? null) ||
    selected.noteId !== (captured?.noteId ?? null)
  ) {
    setSelected({
      store: captured?.store ?? null,
      signal: captured?.signal ?? null,
      scope: captured?.scope ?? null,
      scopeKey: captured?.scopeKey ?? null,
      noteId: captured?.noteId ?? null,
      serial: selected.serial + 1,
    });
    return null;
  }

  if (
    !selected.store ||
    !selected.scope ||
    !selected.noteId ||
    !selected.signal
  ) {
    return <UnavailablePreview />;
  }

  return (
    <SelectedConflictPreview
      key={selected.serial}
      store={selected.store}
      scope={selected.scope}
      noteId={selected.noteId}
      signal={selected.signal}
      refreshKey={refreshKey as number}
    />
  );
}

function SelectedConflictPreview({
  store,
  scope,
  noteId,
  signal,
  refreshKey,
}: SelectedConflictPreviewProps) {
  const sectionHeadingId = useId(),
    localHeadingId = useId(),
    remoteHeadingId = useId();
  const validRefreshKey =
    typeof refreshKey === "number" &&
    Number.isSafeInteger(refreshKey) &&
    refreshKey >= 0;
  const selection = useMemo(
    () => (validRefreshKey ? Object.freeze({ refreshKey }) : null),
    [validRefreshKey, refreshKey],
  );
  const client = useMemo(
    () => new DurableCloudClient(store, scope),
    [store, scope],
  );

  const [aborted, setAborted] = useState(() => signal.aborted);
  const [loaded, setLoaded] = useState<{
    selection: NonNullable<typeof selection>;
    view: ProjectedPreview | null;
  } | null>(null);
  const [copyingSide, setCopyingSide] = useState<{
    local: typeof selection;
    remote: typeof selection;
  }>({ local: null, remote: null });
  const [copyOutcomes, setCopyOutcomes] = useState<{
    local: { selection: NonNullable<typeof selection>; ok: boolean } | null;
    remote: { selection: NonNullable<typeof selection>; ok: boolean } | null;
  }>({ local: null, remote: null });

  const mountedRef = useRef(false),
    currentSelectionRef = useRef(selection),
    copyAttemptCounterRef = useRef(0),
    inFlightCopyRef = useRef<{
      local: {
        selection: NonNullable<typeof selection>;
        attempt: number;
      } | null;
      remote: {
        selection: NonNullable<typeof selection>;
        attempt: number;
      } | null;
    }>({ local: null, remote: null });
  currentSelectionRef.current = selection;

  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      inFlightCopyRef.current = { local: null, remote: null };
    };
  }, []);

  useEffect(() => {
    if (signal.aborted) {
      inFlightCopyRef.current = { local: null, remote: null };
      setAborted(true);
      return;
    }
    const onAbort = () => {
      inFlightCopyRef.current = { local: null, remote: null };
      setAborted(true);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    return () => {
      signal.removeEventListener("abort", onAbort);
    };
  }, [signal]);

  useEffect(() => {
    if (!selection || signal.aborted) return;
    let pending = true;
    const onAbort = () => {
      pending = false;
      if (mountedRef.current) setLoaded({ selection, view: null });
    };
    signal.addEventListener("abort", onAbort, { once: true });
    void Promise.resolve()
      .then(() => {
        if (!pending || signal.aborted) return undefined;
        return client.get(noteId);
      })
      .then((raw) => {
        if (!pending || signal.aborted || raw === undefined) return undefined;
        return projectConflictPreviewState(scope, noteId, raw);
      })
      .then(
        (view) => {
          if (
            view !== undefined &&
            pending &&
            mountedRef.current &&
            !signal.aborted
          ) {
            setLoaded({ selection, view });
          }
        },
        () => {
          if (pending && mountedRef.current && !signal.aborted)
            setLoaded({ selection, view: null });
        },
      );
    return () => {
      pending = false;
      signal.removeEventListener("abort", onAbort);
    };
  }, [client, scope, noteId, signal, selection]);

  const isAborted = aborted || signal.aborted;
  const visible =
    selection && !isAborted && loaded?.selection === selection ? loaded : null;
  const unavailable =
    !selection || isAborted || (visible !== null && visible.view === null);
  const view = unavailable ? null : (visible?.view ?? null);
  const loading = !unavailable && view === null;

  if (unavailable) {
    return <UnavailablePreview />;
  }

  const localCopying =
    selection !== null && !isAborted && copyingSide.local === selection;
  const remoteCopying =
    selection !== null && !isAborted && copyingSide.remote === selection;
  const localOutcome =
    selection !== null &&
    !isAborted &&
    copyOutcomes.local?.selection === selection
      ? copyOutcomes.local
      : null;
  const remoteOutcome =
    selection !== null &&
    !isAborted &&
    copyOutcomes.remote?.selection === selection
      ? copyOutcomes.remote
      : null;

  const handleCopy = async (side: CopySide, capturedBody: string) => {
    if (
      !mountedRef.current ||
      isAborted ||
      signal.aborted ||
      !selection ||
      currentSelectionRef.current !== selection ||
      view?.kind !== "conflict"
    )
      return;
    const activeBody =
      side === "local" ? view.local.bodyMarkdown : view.remote.bodyMarkdown;
    if (
      typeof capturedBody !== "string" ||
      capturedBody.length === 0 ||
      activeBody !== capturedBody
    )
      return;
    if (inFlightCopyRef.current[side]?.selection === selection) return;

    const startedSelection = selection;
    const attempt = ++copyAttemptCounterRef.current;
    inFlightCopyRef.current[side] = { selection: startedSelection, attempt };
    setCopyingSide((prev) => ({ ...prev, [side]: startedSelection }));
    setCopyOutcomes((prev) => ({ ...prev, [side]: null }));

    let ok = false;
    try {
      const clipboard =
        typeof navigator === "object" && navigator !== null
          ? navigator.clipboard
          : undefined;
      if (!clipboard || typeof clipboard.writeText !== "function")
        throw Error("Clipboard unavailable");
      await clipboard.writeText(capturedBody);
      ok = true;
    } catch {
      ok = false;
    }

    if (inFlightCopyRef.current[side]?.attempt === attempt) {
      inFlightCopyRef.current[side] = null;
    }
    if (
      !mountedRef.current ||
      signal.aborted ||
      currentSelectionRef.current !== startedSelection
    )
      return;
    setCopyingSide((prev) =>
      prev[side] === startedSelection ? { ...prev, [side]: null } : prev,
    );
    setCopyOutcomes((prev) => ({
      ...prev,
      [side]: { selection: startedSelection, ok },
    }));
  };

  return (
    <section
      className="cloud-conflict-preview"
      aria-labelledby={sectionHeadingId}
      aria-busy={loading}
    >
      <header className="cloud-conflict-preview-header">
        <h1 id={sectionHeadingId}>Cloud conflict preview</h1>
      </header>

      {loading && (
        <p className="cloud-conflict-preview-loading">{LOADING_COPY}</p>
      )}

      {view?.kind === "no-conflict" && (
        <div className="cloud-conflict-preview-nonconflict">
          <p
            className="cloud-conflict-preview-nonconflict-status"
            role="status"
            aria-live="polite"
          >
            {view.status}
          </p>
          <p className="cloud-conflict-preview-nonconflict-detail">
            {view.detail}
          </p>
        </div>
      )}

      {view?.kind === "conflict" && (
        <>
          <p
            className="cloud-conflict-preview-summary"
            role="status"
            aria-live="polite"
          >
            {CONFLICT_SUMMARY_COPY}
          </p>

          <div className="cloud-conflict-preview-grid">
            <article
              className="cloud-conflict-preview-card"
              data-version-side="local"
              aria-labelledby={localHeadingId}
            >
              <header className="cloud-conflict-preview-card-header">
                <div className="cloud-conflict-preview-card-titles">
                  <h2 id={localHeadingId}>Draft on this device</h2>
                  <div className="cloud-conflict-preview-meta">
                    <span
                      className="cloud-conflict-preview-badge"
                      data-lifecycle={
                        view.local.kind === "purge" ? "purged" : "present"
                      }
                    >
                      Local state: {view.local.lifecycle}
                    </span>
                    <span className="cloud-conflict-preview-badge">
                      {view.baseRevision === 0
                        ? "Base revision: None (created offline before conflict)"
                        : `Base revision: ${view.baseRevision} (unconfirmed local change)`}
                    </span>
                  </div>
                </div>
                {view.local.bodyMarkdown !== null &&
                  view.local.bodyMarkdown.length > 0 && (
                    <button
                      type="button"
                      className="cloud-conflict-preview-copy"
                      disabled={localCopying}
                      onClick={() => {
                        if (view.local.bodyMarkdown !== null)
                          void handleCopy("local", view.local.bodyMarkdown);
                      }}
                    >
                      Copy draft text
                    </button>
                  )}
              </header>

              {localOutcome &&
                (localOutcome.ok ? (
                  <p
                    className="cloud-conflict-preview-copy-status"
                    role="status"
                    aria-live="polite"
                  >
                    {COPY_SUCCESS_MESSAGES.local}
                  </p>
                ) : (
                  <p className="cloud-conflict-preview-copy-error" role="alert">
                    {COPY_ERROR_MESSAGES.local}
                  </p>
                ))}

              {view.local.kind === "purge" ? (
                <p className="cloud-conflict-preview-empty">
                  Permanent deletion is queued on this device. No local draft
                  text is stored for this version.
                </p>
              ) : view.local.bodyMarkdown.length === 0 ? (
                <p className="cloud-conflict-preview-empty">
                  {`This local draft is an empty ${view.local.stateWord} note with no text.`}
                </p>
              ) : (
                <pre className="cloud-conflict-preview-body">
                  {view.local.bodyMarkdown}
                </pre>
              )}
            </article>

            <article
              className="cloud-conflict-preview-card"
              data-version-side="remote"
              aria-labelledby={remoteHeadingId}
            >
              <header className="cloud-conflict-preview-card-header">
                <div className="cloud-conflict-preview-card-titles">
                  <h2 id={remoteHeadingId}>Observed Cloud version</h2>
                  <div className="cloud-conflict-preview-meta">
                    <span
                      className="cloud-conflict-preview-badge"
                      data-lifecycle={
                        view.remote.kind === "purged" ? "purged" : "present"
                      }
                    >
                      Observed Cloud state: {view.remote.lifecycle}
                    </span>
                    <span className="cloud-conflict-preview-badge">
                      {`Observed Cloud revision ${view.remote.revision} (cached on this device)`}
                    </span>
                  </div>
                </div>
                {view.remote.bodyMarkdown !== null &&
                  view.remote.bodyMarkdown.length > 0 && (
                    <button
                      type="button"
                      className="cloud-conflict-preview-copy"
                      disabled={remoteCopying}
                      onClick={() => {
                        if (view.remote.bodyMarkdown !== null)
                          void handleCopy("remote", view.remote.bodyMarkdown);
                      }}
                    >
                      Copy observed Cloud text
                    </button>
                  )}
              </header>

              {remoteOutcome &&
                (remoteOutcome.ok ? (
                  <p
                    className="cloud-conflict-preview-copy-status"
                    role="status"
                    aria-live="polite"
                  >
                    {COPY_SUCCESS_MESSAGES.remote}
                  </p>
                ) : (
                  <p className="cloud-conflict-preview-copy-error" role="alert">
                    {COPY_ERROR_MESSAGES.remote}
                  </p>
                ))}

              {view.remote.kind === "purged" ? (
                <p className="cloud-conflict-preview-purge-notice">
                  {`This note identity was permanently purged in Cloud at observed revision ${view.remote.revision}. No remote note text exists. A permanently purged note ID cannot be restored; saving your draft later requires a new note ID.`}
                </p>
              ) : view.remote.bodyMarkdown.length === 0 ? (
                <p className="cloud-conflict-preview-empty">
                  {`This observed Cloud version is an empty ${view.remote.stateWord} note with no text.`}
                </p>
              ) : (
                <pre className="cloud-conflict-preview-body">
                  {view.remote.bodyMarkdown}
                </pre>
              )}
            </article>
          </div>
        </>
      )}
    </section>
  );
}
