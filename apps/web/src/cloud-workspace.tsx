import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
} from "react";
import "./cloud-workspace.css";
import { titleOf } from "../../../packages/core/src/index";
import {
  validateCloudNoteId,
  validateCloudScope,
  type CloudScope,
} from "../../../packages/cloud-protocol/src/durable";
import type { CloudLibraryStateStore } from "../../../packages/cloud-protocol/src/library-local";
import {
  CloudCachedLibrary,
  type CloudLibraryContext,
  type CloudLibraryNoteSelection,
} from "./cloud-cached-library";
import { CloudConflictPreview } from "./cloud-conflict-preview";
import { CloudConflictResolutionPanel } from "./cloud-conflict-resolution-panel";
import { CloudLibraryOwners } from "./cloud-library-owners";
import type { CloudDraftSession } from "./cloud-draft-session";
import type { CloudNoteUpload } from "./cloud-note-upload";
import { CloudUploadingNoteEditor } from "./cloud-uploading-note-editor";

export type CloudWorkspaceConnectionKind =
  "cached" | "syncing" | "offline" | "sign-in-required" | "paused";

export type CloudWorkspaceConnection = Readonly<{
  kind: CloudWorkspaceConnectionKind;
}>;

export type CloudWorkspacePutAway = Readonly<{
  context: CloudLibraryContext;
  upload: CloudNoteUpload;
  session: CloudDraftSession;
}>;

export type CloudWorkspaceProps = {
  context: CloudLibraryContext;
  signal: AbortSignal;
  refreshKey: number;
  connection?: CloudWorkspaceConnection;
  onOpen: (
    selection: CloudLibraryNoteSelection,
  ) => CloudNoteUpload | Promise<CloudNoteUpload>;
  onCreate: (
    context: CloudLibraryContext,
  ) => CloudNoteUpload | Promise<CloudNoteUpload>;
  onPutAway?: (closed: CloudWorkspacePutAway) => void | Promise<void>;
  onRetrySync?: (context: CloudLibraryContext) => void | Promise<void>;
  onSignIn?: (context: CloudLibraryContext) => void | Promise<void>;
  /** Explicit original parent binding. Omission preserves read-only inspection. */
  conflictOwners?: CloudLibraryOwners;
};

type ParsedConnection =
  | Readonly<{ mode: "omitted" }>
  | Readonly<{ mode: "valid"; kind: CloudWorkspaceConnectionKind }>
  | Readonly<{ mode: "malformed" }>;

const CONNECTION_COPY: Readonly<Record<CloudWorkspaceConnectionKind, string>> =
  Object.freeze({
    cached: "Showing notes cached on this device.",
    syncing: "Syncing with Cloud\u2026",
    offline: "Offline. New edits stay pending on this device.",
    paused: "Cloud sync is paused. Your pending drafts remain on this device.",
    "sign-in-required":
      "Sign in again to resume Cloud sync. Your pending drafts remain on this device.",
  });

const MALFORMED_CONNECTION_COPY =
  "Cloud sync status unavailable. Your pending drafts remain on this device.";

const RECOVERY_ERROR_COPY: Readonly<
  Record<"paused" | "sign-in-required", string>
> = Object.freeze({
  paused:
    "Could not resume Cloud sync. Your pending drafts remain on this device.",
  "sign-in-required":
    "Could not start Cloud sign-in. Your pending drafts remain on this device.",
});

function isConnectionKind(
  value: unknown,
): value is CloudWorkspaceConnectionKind {
  return (
    value === "cached" ||
    value === "syncing" ||
    value === "offline" ||
    value === "sign-in-required" ||
    value === "paused"
  );
}

function parseConnection(input: unknown): ParsedConnection {
  if (input === undefined) {
    return { mode: "omitted" };
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { mode: "malformed" };
  }
  try {
    const proto = Object.getPrototypeOf(input);
    if (proto !== Object.prototype && proto !== null) {
      return { mode: "malformed" };
    }
    const ownNames = Object.getOwnPropertyNames(input);
    if (ownNames.length !== 1 || ownNames[0] !== "kind") {
      return { mode: "malformed" };
    }
    if (Object.getOwnPropertySymbols(input).length !== 0) {
      return { mode: "malformed" };
    }
    const descriptor = Object.getOwnPropertyDescriptor(input, "kind");
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
      return { mode: "malformed" };
    }
    const kind = descriptor.value;
    if (!isConnectionKind(kind)) {
      return { mode: "malformed" };
    }
    return { mode: "valid", kind };
  } catch {
    return { mode: "malformed" };
  }
}

type ActiveEditor = {
  readonly context: CloudLibraryContext;
  readonly upload: CloudNoteUpload;
  readonly origin: "open" | "create";
  closingTask: Promise<void> | null;
  dismissWatching: boolean;
  notifiedParent: boolean;
  closedComplete: boolean;
};

type ActiveInspection = Readonly<{
  noteId: string;
}>;

type ReturnFocusTarget =
  | Readonly<{ kind: "new" }>
  | Readonly<{ kind: "card"; title: string }>
  | Readonly<{ kind: "conflict"; noteId: string }>;

const NARROW_QUERY = "(max-width: 820px)";

function readIsNarrow() {
  return typeof window !== "undefined" &&
    typeof window.matchMedia === "function"
    ? window.matchMedia(NARROW_QUERY).matches
    : false;
}

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

function captureScope(input: unknown): Readonly<CloudScope> | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  try {
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

function captureContext(rawContext: unknown): {
  store: CloudLibraryStateStore;
  scope: Readonly<CloudScope>;
} | null {
  if (
    !rawContext ||
    typeof rawContext !== "object" ||
    Array.isArray(rawContext)
  ) {
    return null;
  }
  try {
    const proto = Object.getPrototypeOf(rawContext);
    if (proto !== Object.prototype && proto !== null) return null;
    if (Object.getOwnPropertySymbols(rawContext).length > 0) return null;
    for (const key of Object.getOwnPropertyNames(rawContext)) {
      if (!ownDataProperty(rawContext, key).ok) return null;
    }
    const storeProp = ownDataProperty(rawContext, "store"),
      scopeProp = ownDataProperty(rawContext, "scope");
    if (!storeProp.ok || !scopeProp.ok) return null;
    const store = storeProp.value as Partial<CloudLibraryStateStore> | null;
    if (
      !store ||
      typeof store !== "object" ||
      typeof store.read !== "function" ||
      typeof store.commit !== "function" ||
      typeof store.close !== "function" ||
      typeof store.listLibrary !== "function"
    ) {
      return null;
    }
    const scope = captureScope(scopeProp.value);
    if (!scope) return null;
    return { store: store as CloudLibraryStateStore, scope };
  } catch {
    return null;
  }
}

function captureWorkspaceProps(rawProps: unknown): {
  store: CloudLibraryStateStore | null;
  scope: Readonly<CloudScope> | null;
  signal: AbortSignal | null;
  refreshKey: number;
  connection: unknown;
  onOpen: CloudWorkspaceProps["onOpen"] | null;
  onCreate: CloudWorkspaceProps["onCreate"] | null;
  onPutAway: CloudWorkspaceProps["onPutAway"];
  onRetrySync: CloudWorkspaceProps["onRetrySync"];
  onSignIn: CloudWorkspaceProps["onSignIn"];
  conflictOwners: CloudWorkspaceProps["conflictOwners"];
} {
  if (!rawProps || typeof rawProps !== "object" || Array.isArray(rawProps)) {
    return {
      store: null,
      scope: null,
      signal: null,
      refreshKey: -1,
      connection: undefined,
      onOpen: null,
      onCreate: null,
      onPutAway: undefined,
      onRetrySync: undefined,
      onSignIn: undefined,
      conflictOwners: undefined,
    };
  }
  const contextProp = ownDataProperty(rawProps, "context"),
    signalProp = ownDataProperty(rawProps, "signal"),
    refreshKeyProp = ownDataProperty(rawProps, "refreshKey"),
    connectionProp = ownDataProperty(rawProps, "connection"),
    onOpenProp = ownDataProperty(rawProps, "onOpen"),
    onCreateProp = ownDataProperty(rawProps, "onCreate"),
    onPutAwayProp = ownDataProperty(rawProps, "onPutAway"),
    onRetrySyncProp = ownDataProperty(rawProps, "onRetrySync"),
    onSignInProp = ownDataProperty(rawProps, "onSignIn"),
    conflictOwnersProp = ownDataProperty(rawProps, "conflictOwners");
  if (
    !contextProp.ok ||
    !signalProp.ok ||
    !refreshKeyProp.ok ||
    !connectionProp.ok ||
    !onOpenProp.ok ||
    !onCreateProp.ok ||
    !onPutAwayProp.ok ||
    !onRetrySyncProp.ok ||
    !onSignInProp.ok
  ) {
    return {
      store: null,
      scope: null,
      signal: null,
      refreshKey: -1,
      connection: undefined,
      onOpen: null,
      onCreate: null,
      onPutAway: undefined,
      onRetrySync: undefined,
      onSignIn: undefined,
      conflictOwners: undefined,
    };
  }
  const signal = isAbortSignalLike(signalProp.value) ? signalProp.value : null;
  const context = signal ? captureContext(contextProp.value) : null;
  return {
    store: context?.store ?? null,
    scope: context?.scope ?? null,
    signal,
    refreshKey: refreshKeyProp.value as number,
    connection: connectionProp.value,
    onOpen:
      typeof onOpenProp.value === "function"
        ? (onOpenProp.value as CloudWorkspaceProps["onOpen"])
        : null,
    onCreate:
      typeof onCreateProp.value === "function"
        ? (onCreateProp.value as CloudWorkspaceProps["onCreate"])
        : null,
    onPutAway:
      typeof onPutAwayProp.value === "function"
        ? (onPutAwayProp.value as CloudWorkspaceProps["onPutAway"])
        : undefined,
    onRetrySync: onRetrySyncProp.value as CloudWorkspaceProps["onRetrySync"],
    onSignIn: onSignInProp.value as CloudWorkspaceProps["onSignIn"],
    // A malformed optional binding must not discard an active editor.
    // Refuse accessors without invoking them and retain read-only inspection.
    conflictOwners: conflictOwnersProp.ok
      ? (conflictOwnersProp.value as CloudWorkspaceProps["conflictOwners"])
      : undefined,
  };
}

function isValidNoteId(candidate: unknown): candidate is string {
  if (typeof candidate !== "string") return false;
  try {
    validateCloudNoteId(candidate);
    return true;
  } catch {
    return false;
  }
}

function isValidUpload(candidate: unknown): candidate is CloudNoteUpload {
  if (!candidate || typeof candidate !== "object") return false;
  const upload = candidate as Partial<CloudNoteUpload>;
  return (
    Boolean(upload.session) &&
    typeof upload.session?.snapshot === "function" &&
    typeof upload.session?.flush === "function" &&
    typeof upload.session?.putAway === "function" &&
    typeof upload.upload === "function" &&
    typeof upload.schedule === "function" &&
    typeof upload.subscribe === "function"
  );
}

type RecoveryOpenBinding = Readonly<{
  owners: CloudLibraryOwners;
  context: CloudLibraryContext;
  open: CloudLibraryOwners["open"];
}>;

function captureRecoveryOpenBinding(
  owners: unknown,
  context: CloudLibraryContext,
  signal: AbortSignal,
): RecoveryOpenBinding | null {
  try {
    if (
      !owners ||
      typeof owners !== "object" ||
      Object.getPrototypeOf(owners) !== CloudLibraryOwners.prototype ||
      !(owners instanceof CloudLibraryOwners) ||
      signal.aborted
    )
      return null;
    const ownerContext = ownDataProperty(owners, "context"),
      ownerSignal = ownDataProperty(owners, "signal"),
      open = ownDataProperty(owners, "open");
    if (
      !ownerContext.ok ||
      !ownerSignal.ok ||
      !open.ok ||
      ownerSignal.value !== signal ||
      typeof open.value !== "function" ||
      !ownerContext.value ||
      typeof ownerContext.value !== "object"
    )
      return null;
    const store = ownDataProperty(ownerContext.value, "store"),
      scope = ownDataProperty(ownerContext.value, "scope");
    if (!store.ok || !scope.ok || store.value !== context.store) return null;
    const checked = captureScope(scope.value);
    if (!checked || JSON.stringify(checked) !== JSON.stringify(context.scope))
      return null;
    return Object.freeze({
      owners,
      context: ownerContext.value as CloudLibraryContext,
      open: open.value as CloudLibraryOwners["open"],
    });
  } catch {
    return null;
  }
}

/** Explicit scoped composition only; neither this workspace nor its callbacks grant Cloud auth. */
export function CloudWorkspace(props: CloudWorkspaceProps) {
  const captured = captureWorkspaceProps(props),
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
  if (
    !selected.store ||
    !selected.scope ||
    !selected.signal ||
    !captured.onOpen ||
    !captured.onCreate
  ) {
    return (
      <div
        className="cloud-workspace"
        data-editor-open="false"
        data-inspection-open="false"
      >
        <p className="cloud-workspace-unavailable" role="alert">
          Cached Cloud library unavailable
        </p>
      </div>
    );
  }
  const parsedConnection = parseConnection(captured.connection);
  return (
    <SelectedWorkspace
      key={selected.serial}
      store={selected.store}
      scope={selected.scope}
      signal={selected.signal}
      refreshKey={captured.refreshKey}
      parsedConnection={parsedConnection}
      onOpen={captured.onOpen}
      onCreate={captured.onCreate}
      onPutAway={captured.onPutAway}
      onRetrySync={captured.onRetrySync}
      onSignIn={captured.onSignIn}
      conflictOwners={captured.conflictOwners}
    />
  );
}

function SelectedWorkspace({
  store,
  scope,
  signal,
  refreshKey,
  parsedConnection,
  onOpen,
  onCreate,
  onPutAway,
  onRetrySync,
  onSignIn,
  conflictOwners,
}: Omit<CloudWorkspaceProps, "context" | "connection"> & {
  store: CloudLibraryStateStore;
  scope: CloudScope;
  parsedConnection: ParsedConnection;
}) {
  const scopeKey = useMemo(() => JSON.stringify(scope), [scope]);
  const workspaceContext = useMemo<CloudLibraryContext>(
    () => Object.freeze({ store, scope: Object.freeze({ ...scope }) }),
    [store, scopeKey],
  );
  const [aborted, setAborted] = useState(() => signal.aborted),
    [isNarrow, setIsNarrow] = useState(readIsNarrow),
    [localRefresh, setLocalRefresh] = useState(0),
    [activeEditor, setActiveEditor] = useState<ActiveEditor | null>(null),
    [activeInspection, setActiveInspection] = useState<ActiveInspection | null>(
      null,
    ),
    [workspaceIssue, setWorkspaceIssue] = useState<string | null>(null),
    [returnFocus, setReturnFocus] = useState<ReturnFocusTarget | null>(null);

  const recoveryOpenBinding = useMemo(
    () => captureRecoveryOpenBinding(conflictOwners, workspaceContext, signal),
    [conflictOwners, workspaceContext, signal],
  );
  const recoveryOpenBindingRef = useRef(recoveryOpenBinding),
    recoveryOpeningRef = useRef(false);
  recoveryOpenBindingRef.current = recoveryOpenBinding;

  const validRefreshKey = Number.isSafeInteger(refreshKey) && refreshKey >= 0;
  const usable = !aborted && !signal.aborted && validRefreshKey;
  const visibleEditor = usable ? activeEditor : null;
  const visibleInspection = usable && !visibleEditor ? activeInspection : null;
  const hasRetryAction =
    parsedConnection.mode === "valid" &&
    parsedConnection.kind === "paused" &&
    typeof onRetrySync === "function";
  const hasSignInAction =
    parsedConnection.mode === "valid" &&
    parsedConnection.kind === "sign-in-required" &&
    typeof onSignIn === "function";
  const connectionStateKey = !usable
    ? "unusable"
    : parsedConnection.mode === "valid"
      ? `valid:${parsedConnection.kind}:${hasRetryAction || hasSignInAction ? "action" : "plain"}`
      : parsedConnection.mode;

  const [connectionState, setConnectionState] = useState(() => ({
    key: connectionStateKey,
    epoch: 0,
  }));
  let currentRecoveryEpoch = connectionState.epoch;
  if (connectionState.key !== connectionStateKey) {
    currentRecoveryEpoch = connectionState.epoch + 1;
    setConnectionState({
      key: connectionStateKey,
      epoch: currentRecoveryEpoch,
    });
  }
  const [recoveryPendingEpoch, setRecoveryPendingEpoch] = useState<
      number | null
    >(null),
    [recoveryError, setRecoveryError] = useState<Readonly<{
      epoch: number;
      message: string;
    }> | null>(null);

  const mounted = useRef(false),
    transitioning = useRef(false),
    latestRequest = useRef(0),
    recoveryEpochRef = useRef(0),
    recoveryInFlightEpochRef = useRef<number | null>(null),
    validRefreshKeyRef = useRef(validRefreshKey),
    activeEditorRef = useRef<ActiveEditor | null>(null),
    activeInspectionRef = useRef<ActiveInspection | null>(null),
    pendingInspectionFocusRef = useRef<ActiveInspection | null>(null),
    desiredCardTitleRef = useRef<string | null>(null),
    desiredConflictNoteIdRef = useRef<string | null>(null),
    provisionalFocusRef = useRef(false),
    provisionalButtonRef = useRef<HTMLButtonElement | null>(null),
    libraryPaneRef = useRef<HTMLDivElement>(null),
    editorPaneRef = useRef<HTMLDivElement>(null),
    inspectionPaneRef = useRef<HTMLDivElement>(null),
    inspectionBackButtonRef = useRef<HTMLButtonElement>(null);

  activeEditorRef.current = activeEditor;
  activeInspectionRef.current = activeInspection;
  validRefreshKeyRef.current = validRefreshKey;

  useLayoutEffect(() => {
    recoveryEpochRef.current = Math.max(
      recoveryEpochRef.current,
      currentRecoveryEpoch,
    );
    if (
      recoveryInFlightEpochRef.current !== null &&
      recoveryInFlightEpochRef.current !== currentRecoveryEpoch
    ) {
      recoveryInFlightEpochRef.current = null;
    }
  }, [currentRecoveryEpoch]);

  useLayoutEffect(() => {
    mounted.current = true;
    const handleAbort = () => {
      latestRequest.current++;
      recoveryEpochRef.current++;
      recoveryInFlightEpochRef.current = null;
      activeEditorRef.current = null;
      activeInspectionRef.current = null;
      pendingInspectionFocusRef.current = null;
      desiredCardTitleRef.current = null;
      desiredConflictNoteIdRef.current = null;
      provisionalButtonRef.current = null;
      setAborted(true);
      setActiveEditor(null);
      setActiveInspection(null);
      setWorkspaceIssue(null);
      setRecoveryPendingEpoch(null);
      setRecoveryError(null);
      setReturnFocus(null);
    };
    if (signal.aborted) {
      handleAbort();
    } else {
      signal.addEventListener("abort", handleAbort, { once: true });
    }
    return () => {
      mounted.current = false;
      recoveryInFlightEpochRef.current = null;
      signal.removeEventListener("abort", handleAbort);
    };
  }, [signal]);

  useEffect(() => {
    if (!validRefreshKey) {
      latestRequest.current++;
      recoveryEpochRef.current++;
      recoveryInFlightEpochRef.current = null;
      activeEditorRef.current = null;
      activeInspectionRef.current = null;
      pendingInspectionFocusRef.current = null;
      desiredCardTitleRef.current = null;
      desiredConflictNoteIdRef.current = null;
      provisionalButtonRef.current = null;
      setActiveEditor(null);
      setActiveInspection(null);
      setWorkspaceIssue(null);
      setRecoveryPendingEpoch(null);
      setRecoveryError(null);
      setReturnFocus(null);
    }
  }, [validRefreshKey]);

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function"
    ) {
      return;
    }
    const media = window.matchMedia(NARROW_QUERY);
    const update = () => setIsNarrow(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  const effectiveRefreshKey =
    validRefreshKey && Number.isSafeInteger(refreshKey + localRefresh)
      ? refreshKey + localRefresh
      : refreshKey;

  const focusOpenEditor = () => {
    desiredCardTitleRef.current = null;
    desiredConflictNoteIdRef.current = null;
    editorPaneRef.current
      ?.querySelector<HTMLElement>('[role="textbox"]')
      ?.focus();
  };

  const focusInspectionBack = () => {
    desiredCardTitleRef.current = null;
    desiredConflictNoteIdRef.current = null;
    provisionalButtonRef.current = null;
    inspectionBackButtonRef.current?.focus();
  };

  useLayoutEffect(() => {
    if (
      visibleInspection &&
      pendingInspectionFocusRef.current === visibleInspection
    ) {
      pendingInspectionFocusRef.current = null;
      focusInspectionBack();
    }
  }, [visibleInspection]);

  useEffect(() => {
    if (
      isNarrow &&
      typeof document !== "undefined" &&
      libraryPaneRef.current?.contains(document.activeElement)
    ) {
      if (visibleEditor) {
        focusOpenEditor();
      } else if (visibleInspection) {
        focusInspectionBack();
      }
    }
  }, [isNarrow, visibleEditor, visibleInspection]);

  useEffect(() => {
    if (
      !usable ||
      visibleEditor ||
      visibleInspection ||
      typeof document === "undefined"
    ) {
      return;
    }
    const libraryEl = libraryPaneRef.current;
    if (!libraryEl) {
      if (returnFocus) setReturnFocus(null);
      return;
    }
    const findFallbackButton = () => {
      const buttons = Array.from(
        libraryEl.querySelectorAll<HTMLButtonElement>("button"),
      );
      return (
        buttons.find(
          (btn) => btn.textContent?.trim() === "New note" && !btn.disabled,
        ) ??
        buttons.find(
          (btn) =>
            btn.textContent?.trim() === "Refresh cached notes" && !btn.disabled,
        ) ??
        null
      );
    };

    const focusFallbackButton = (provisional: boolean) => {
      const btn = findFallbackButton();
      if (!btn) return null;
      if (provisional) {
        provisionalFocusRef.current = true;
        try {
          provisionalButtonRef.current = btn;
          btn.focus();
        } finally {
          provisionalFocusRef.current = false;
        }
      } else {
        provisionalButtonRef.current = null;
        btn.focus();
      }
      return btn;
    };

    if (returnFocus?.kind === "new") {
      desiredCardTitleRef.current = null;
      desiredConflictNoteIdRef.current = null;
      focusFallbackButton(false);
      setReturnFocus(null);
      return;
    }

    if (returnFocus?.kind === "conflict") {
      desiredCardTitleRef.current = null;
      desiredConflictNoteIdRef.current = returnFocus.noteId;
    } else if (returnFocus?.kind === "card") {
      desiredConflictNoteIdRef.current = null;
      desiredCardTitleRef.current = returnFocus.title;
    }

    const targetConflictNoteId = desiredConflictNoteIdRef.current;
    if (targetConflictNoteId) {
      const tryFocusConflict = () => {
        const noteId = desiredConflictNoteIdRef.current;
        if (!noteId) return true;
        const section = libraryEl.querySelector<HTMLElement>(
          ".cloud-cached-library",
        );
        if (!section || section.getAttribute("aria-busy") === "true") {
          return false;
        }
        const active = document.activeElement;
        const focusDropped =
          !active ||
          active === document.body ||
          (provisionalButtonRef.current !== null &&
            active === provisionalButtonRef.current);
        desiredConflictNoteIdRef.current = null;
        if (focusDropped) {
          const matchingButtons = Array.from(
            section.querySelectorAll<HTMLButtonElement>(
              ".note-grid button.card-inspect-conflict",
            ),
          ).filter(
            (btn) =>
              btn.getAttribute("data-conflict-note-id") === noteId &&
              !btn.disabled,
          );
          if (matchingButtons.length === 1) {
            provisionalButtonRef.current = null;
            matchingButtons[0].focus();
          } else {
            focusFallbackButton(false);
          }
        }
        return true;
      };

      if (tryFocusConflict()) {
        if (returnFocus) setReturnFocus(null);
        return;
      }

      if (!document.activeElement || document.activeElement === document.body) {
        focusFallbackButton(true);
      }

      const observer = new MutationObserver(() => {
        if (tryFocusConflict()) {
          observer.disconnect();
          if (mounted.current && returnFocus) setReturnFocus(null);
        }
      });
      observer.observe(libraryEl, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ["aria-busy"],
      });
      return () => observer.disconnect();
    }

    const targetTitle = desiredCardTitleRef.current;
    if (!targetTitle) {
      return;
    }

    if (!document.activeElement || document.activeElement === document.body) {
      focusFallbackButton(true);
    }

    const tryFocusCard = () => {
      const title = desiredCardTitleRef.current;
      if (!title) return true;
      const section = libraryEl.querySelector<HTMLElement>(
        ".cloud-cached-library",
      );
      if (!section || section.getAttribute("aria-busy") === "true") {
        return false;
      }
      const active = document.activeElement;
      const focusDropped =
        !active ||
        active === document.body ||
        (provisionalButtonRef.current !== null &&
          active === provisionalButtonRef.current);
      if (focusDropped) {
        const expectedLabel = `Open ${title}`;
        const matchingCards = Array.from(
          section.querySelectorAll<HTMLButtonElement>(
            ".note-grid button.card-open",
          ),
        ).filter((btn) => btn.getAttribute("aria-label") === expectedLabel);
        if (matchingCards.length === 1) {
          provisionalButtonRef.current = null;
          matchingCards[0].focus();
        } else {
          desiredCardTitleRef.current = null;
          focusFallbackButton(false);
        }
      }
      return true;
    };

    if (tryFocusCard()) {
      if (returnFocus) setReturnFocus(null);
      return;
    }

    const observer = new MutationObserver(() => {
      if (tryFocusCard()) {
        observer.disconnect();
        if (mounted.current && returnFocus) setReturnFocus(null);
      }
    });
    observer.observe(libraryEl, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["aria-busy"],
    });
    return () => observer.disconnect();
  }, [
    usable,
    visibleEditor,
    visibleInspection,
    returnFocus,
    effectiveRefreshKey,
  ]);

  const matchesWorkspaceContext = (candidate: CloudLibraryContext) => {
    if (!candidate || candidate.store !== store) return false;
    const candidateScope = captureScope(candidate.scope);
    return (
      candidateScope !== null && JSON.stringify(candidateScope) === scopeKey
    );
  };

  const putAwayActiveEditor = (
    entry: ActiveEditor,
    intent: "dismiss" | "switch",
  ): Promise<void> => {
    if (intent === "dismiss") {
      entry.dismissWatching = true;
    }
    if (entry.closedComplete) {
      return Promise.resolve();
    }
    if (entry.closingTask) {
      return entry.closingTask;
    }
    const task = (async () => {
      await entry.upload.session.putAway();
      if (
        !mounted.current ||
        signal.aborted ||
        activeEditorRef.current !== entry
      ) {
        return;
      }
      try {
        if (!entry.notifiedParent && onPutAway) {
          await onPutAway(
            Object.freeze({
              context: entry.context,
              upload: entry.upload,
              session: entry.upload.session,
            }),
          );
          entry.notifiedParent = true;
        }
      } finally {
        void entry.upload.upload();
      }
      if (
        !mounted.current ||
        signal.aborted ||
        activeEditorRef.current !== entry
      ) {
        return;
      }
      entry.closedComplete = true;
      activeEditorRef.current = null;
      setWorkspaceIssue(null);
      if (entry.dismissWatching) {
        latestRequest.current++;
        const snapshot = entry.upload.session.snapshot();
        const focusTarget: ReturnFocusTarget =
          snapshot.bodyMarkdown.length > 0 || entry.origin === "open"
            ? { kind: "card", title: titleOf(snapshot.bodyMarkdown) }
            : { kind: "new" };
        desiredCardTitleRef.current =
          focusTarget.kind === "card" ? focusTarget.title : null;
        setReturnFocus(focusTarget);
      }
      setActiveEditor(null);
      setLocalRefresh((previous) => previous + 1);
    })().finally(() => {
      entry.closingTask = null;
    });
    entry.closingTask = task;
    return task;
  };

  const closeActiveBeforeSwitch = async (): Promise<boolean> => {
    const current = activeEditorRef.current;
    if (!current) return true;
    transitioning.current = true;
    try {
      await putAwayActiveEditor(current, "switch");
      return (
        mounted.current &&
        !signal.aborted &&
        current.closedComplete &&
        !current.dismissWatching
      );
    } catch {
      if (
        mounted.current &&
        !signal.aborted &&
        activeEditorRef.current === current
      ) {
        if (
          current.upload.session.snapshot().closed &&
          !current.dismissWatching
        ) {
          setWorkspaceIssue(
            "Could not put away this note. Retry or copy the text.",
          );
        }
        focusOpenEditor();
      }
      return false;
    } finally {
      transitioning.current = false;
    }
  };

  const handleOpen = async (selection: CloudLibraryNoteSelection) => {
    if (
      !mounted.current ||
      signal.aborted ||
      !validRefreshKey ||
      transitioning.current ||
      !matchesWorkspaceContext(selection)
    ) {
      return;
    }
    const existing = activeEditorRef.current;
    if (existing) {
      const existingSnap = existing.upload.session.snapshot();
      if (existingSnap.noteId === selection.noteId && !existingSnap.closed) {
        setWorkspaceIssue(null);
        focusOpenEditor();
        return;
      }
      if (!(await closeActiveBeforeSwitch())) return;
    }
    const requestId = ++latestRequest.current;
    activeInspectionRef.current = null;
    pendingInspectionFocusRef.current = null;
    desiredConflictNoteIdRef.current = null;
    setActiveInspection(null);
    setWorkspaceIssue(null);
    setReturnFocus(null);
    try {
      const upload = await onOpen(selection);
      if (!isValidUpload(upload)) throw Error("Invalid Cloud upload owner");
      if (
        !mounted.current ||
        signal.aborted ||
        requestId !== latestRequest.current
      ) {
        return;
      }
      const next: ActiveEditor = {
        context: workspaceContext,
        upload,
        origin: "open",
        closingTask: null,
        dismissWatching: false,
        notifiedParent: false,
        closedComplete: false,
      };
      activeEditorRef.current = next;
      activeInspectionRef.current = null;
      pendingInspectionFocusRef.current = null;
      desiredCardTitleRef.current = null;
      desiredConflictNoteIdRef.current = null;
      setActiveInspection(null);
      setActiveEditor(next);
    } catch {
      if (
        mounted.current &&
        !signal.aborted &&
        requestId === latestRequest.current
      ) {
        setWorkspaceIssue(
          "Could not open this cached note. Your drafts remain on this device.",
        );
      }
    }
  };

  const inspectedRecoverySource = visibleInspection?.noteId ?? null;
  const handleNewNoteRetained = useCallback(
    async (newNoteId: string) => {
      const binding = recoveryOpenBinding,
        inspection = activeInspectionRef.current;
      const unavailable = () =>
        Error("Could not open this retained Cloud draft");
      const currentBinding = () => {
        if (!binding || recoveryOpenBindingRef.current !== binding)
          return false;
        const live = captureRecoveryOpenBinding(
          binding.owners,
          workspaceContext,
          signal,
        );
        return (
          live !== null &&
          live.context === binding.context &&
          live.open === binding.open
        );
      };
      if (
        !binding ||
        !mounted.current ||
        signal.aborted ||
        !validRefreshKeyRef.current ||
        transitioning.current ||
        recoveryOpeningRef.current ||
        activeEditorRef.current ||
        !inspection ||
        inspection.noteId !== inspectedRecoverySource ||
        !isValidNoteId(newNoteId) ||
        newNoteId === inspection.noteId ||
        !currentBinding()
      ) {
        throw unavailable();
      }
      const requestId = ++latestRequest.current;
      recoveryOpeningRef.current = true;
      try {
        const upload = await binding.open.call(binding.owners, {
          ...workspaceContext,
          noteId: newNoteId,
        });
        if (
          !isValidUpload(upload) ||
          upload.session.snapshot().noteId !== newNoteId ||
          upload.session.snapshot().closed ||
          !mounted.current ||
          signal.aborted ||
          !validRefreshKeyRef.current ||
          latestRequest.current !== requestId ||
          activeInspectionRef.current !== inspection ||
          activeEditorRef.current ||
          !currentBinding()
        ) {
          throw unavailable();
        }
        const next: ActiveEditor = {
          context: workspaceContext,
          upload,
          origin: "open",
          closingTask: null,
          dismissWatching: false,
          notifiedParent: false,
          closedComplete: false,
        };
        activeEditorRef.current = next;
        activeInspectionRef.current = null;
        pendingInspectionFocusRef.current = null;
        desiredCardTitleRef.current = null;
        desiredConflictNoteIdRef.current = null;
        setWorkspaceIssue(null);
        setReturnFocus(null);
        setActiveInspection(null);
        setActiveEditor(next);
      } catch {
        // The source inspection and panel keep the retained ID for an explicit retry.
        throw unavailable();
      } finally {
        recoveryOpeningRef.current = false;
      }
    },
    [recoveryOpenBinding, inspectedRecoverySource, workspaceContext, signal],
  );

  const handleCreate = async (context: CloudLibraryContext) => {
    if (
      !mounted.current ||
      signal.aborted ||
      !validRefreshKey ||
      transitioning.current ||
      !matchesWorkspaceContext(context)
    ) {
      return;
    }
    if (activeEditorRef.current && !(await closeActiveBeforeSwitch())) {
      return;
    }
    const requestId = ++latestRequest.current;
    activeInspectionRef.current = null;
    pendingInspectionFocusRef.current = null;
    desiredConflictNoteIdRef.current = null;
    setActiveInspection(null);
    setWorkspaceIssue(null);
    setReturnFocus(null);
    try {
      const upload = await onCreate(context);
      if (!isValidUpload(upload)) throw Error("Invalid Cloud upload owner");
      if (
        !mounted.current ||
        signal.aborted ||
        requestId !== latestRequest.current
      ) {
        return;
      }
      const next: ActiveEditor = {
        context: workspaceContext,
        upload,
        origin: "create",
        closingTask: null,
        dismissWatching: false,
        notifiedParent: false,
        closedComplete: false,
      };
      activeEditorRef.current = next;
      activeInspectionRef.current = null;
      pendingInspectionFocusRef.current = null;
      desiredCardTitleRef.current = null;
      desiredConflictNoteIdRef.current = null;
      setActiveInspection(null);
      setActiveEditor(next);
    } catch {
      if (
        mounted.current &&
        !signal.aborted &&
        requestId === latestRequest.current
      ) {
        setWorkspaceIssue(
          "Could not create a Cloud note. Your drafts remain on this device.",
        );
      }
    }
  };

  const handleInspectConflict = async (
    selection: CloudLibraryNoteSelection,
  ) => {
    if (
      !mounted.current ||
      signal.aborted ||
      !validRefreshKeyRef.current ||
      transitioning.current ||
      !matchesWorkspaceContext(selection) ||
      !isValidNoteId(selection.noteId)
    ) {
      return;
    }
    if (activeEditorRef.current && !(await closeActiveBeforeSwitch())) {
      return;
    }
    if (!mounted.current || signal.aborted || !validRefreshKeyRef.current) {
      return;
    }
    latestRequest.current++;
    desiredCardTitleRef.current = null;
    desiredConflictNoteIdRef.current = null;
    provisionalButtonRef.current = null;
    setWorkspaceIssue(null);
    setReturnFocus(null);
    const existing = activeInspectionRef.current;
    if (existing && existing.noteId === selection.noteId) {
      focusInspectionBack();
      return;
    }
    const nextInspection: ActiveInspection = Object.freeze({
      noteId: selection.noteId,
    });
    activeInspectionRef.current = nextInspection;
    pendingInspectionFocusRef.current = nextInspection;
    setActiveInspection(nextInspection);
  };

  const handleCloseInspection = () => {
    if (!mounted.current || signal.aborted || !validRefreshKeyRef.current) {
      return;
    }
    const current = activeInspectionRef.current;
    if (!current) return;
    latestRequest.current++;
    activeInspectionRef.current = null;
    pendingInspectionFocusRef.current = null;
    desiredCardTitleRef.current = null;
    desiredConflictNoteIdRef.current = current.noteId;
    setWorkspaceIssue(null);
    setReturnFocus({ kind: "conflict", noteId: current.noteId });
    setActiveInspection(null);
  };

  const handleEditorPutAway = async (
    entry: ActiveEditor,
    session: CloudDraftSession,
  ) => {
    if (
      !mounted.current ||
      signal.aborted ||
      entry.upload.session !== session ||
      entry.closedComplete ||
      activeEditorRef.current !== entry
    ) {
      return;
    }
    await putAwayActiveEditor(entry, "dismiss");
  };

  const handleLibraryFocusCapture = (event: FocusEvent<HTMLDivElement>) => {
    if (provisionalFocusRef.current) return;
    provisionalButtonRef.current = null;
    desiredConflictNoteIdRef.current = null;
    const target = event.target;
    if (
      target instanceof HTMLButtonElement &&
      target.classList.contains("card-open")
    ) {
      const label = target.getAttribute("aria-label");
      desiredCardTitleRef.current =
        label && label.startsWith("Open ") ? label.slice(5) : null;
    } else {
      desiredCardTitleRef.current = null;
    }
  };

  const handleLibraryBlurCapture = (event: FocusEvent<HTMLDivElement>) => {
    const target = event.target;
    if (
      !(target instanceof HTMLButtonElement) ||
      !target.classList.contains("card-open")
    ) {
      return;
    }
    const label = target.getAttribute("aria-label");
    const blurredTitle =
      label && label.startsWith("Open ") ? label.slice(5) : null;
    queueMicrotask(() => {
      if (
        blurredTitle &&
        desiredCardTitleRef.current === blurredTitle &&
        target.isConnected &&
        typeof document !== "undefined" &&
        document.activeElement !== target
      ) {
        desiredCardTitleRef.current = null;
      }
    });
  };

  const handleRecovery = async (
    kind: "paused" | "sign-in-required",
    callback: (context: CloudLibraryContext) => void | Promise<void>,
  ) => {
    const requestEpoch = currentRecoveryEpoch;
    if (
      !mounted.current ||
      signal.aborted ||
      !validRefreshKey ||
      parsedConnection.mode !== "valid" ||
      parsedConnection.kind !== kind ||
      recoveryInFlightEpochRef.current === requestEpoch
    ) {
      return;
    }
    recoveryInFlightEpochRef.current = requestEpoch;
    setRecoveryPendingEpoch(requestEpoch);
    setRecoveryError(null);
    try {
      await callback(workspaceContext);
      if (recoveryInFlightEpochRef.current === requestEpoch) {
        recoveryInFlightEpochRef.current = null;
      }
      if (
        !mounted.current ||
        signal.aborted ||
        !validRefreshKeyRef.current ||
        recoveryEpochRef.current !== requestEpoch
      ) {
        return;
      }
      setRecoveryPendingEpoch((previous) =>
        previous === requestEpoch ? null : previous,
      );
    } catch {
      if (recoveryInFlightEpochRef.current === requestEpoch) {
        recoveryInFlightEpochRef.current = null;
      }
      if (
        !mounted.current ||
        signal.aborted ||
        !validRefreshKeyRef.current ||
        recoveryEpochRef.current !== requestEpoch
      ) {
        return;
      }
      setRecoveryPendingEpoch((previous) =>
        previous === requestEpoch ? null : previous,
      );
      setRecoveryError({
        epoch: requestEpoch,
        message: RECOVERY_ERROR_COPY[kind],
      });
    }
  };

  const libraryInert =
    isNarrow && (visibleEditor !== null || visibleInspection !== null);
  const activeRecoveryPending =
    usable && recoveryPendingEpoch === currentRecoveryEpoch;
  const activeRecoveryError =
    usable && recoveryError?.epoch === currentRecoveryEpoch
      ? recoveryError.message
      : null;

  return (
    <div
      className="cloud-workspace"
      data-editor-open={visibleEditor ? "true" : "false"}
      data-inspection-open={visibleInspection ? "true" : "false"}
    >
      <div
        ref={libraryPaneRef}
        className="cloud-workspace-library"
        inert={libraryInert}
        onFocusCapture={handleLibraryFocusCapture}
        onBlurCapture={handleLibraryBlurCapture}
      >
        {usable && parsedConnection.mode === "valid" && (
          <div
            className="cloud-workspace-connection"
            data-connection-kind={parsedConnection.kind}
          >
            <p
              className="cloud-workspace-connection-text"
              role="status"
              aria-live={libraryInert ? "off" : "polite"}
            >
              {CONNECTION_COPY[parsedConnection.kind]}
            </p>
            {hasRetryAction && typeof onRetrySync === "function" && (
              <button
                type="button"
                className="cloud-workspace-connection-action"
                disabled={activeRecoveryPending}
                onClick={() => void handleRecovery("paused", onRetrySync)}
              >
                Retry sync
              </button>
            )}
            {hasSignInAction && typeof onSignIn === "function" && (
              <button
                type="button"
                className="cloud-workspace-connection-action"
                disabled={activeRecoveryPending}
                onClick={() =>
                  void handleRecovery("sign-in-required", onSignIn)
                }
              >
                Sign in again
              </button>
            )}
          </div>
        )}
        {usable && parsedConnection.mode === "malformed" && (
          <p className="cloud-workspace-unavailable" role="alert">
            {MALFORMED_CONNECTION_COPY}
          </p>
        )}
        {activeRecoveryError && (
          <p className="cloud-workspace-alert" role="alert">
            {activeRecoveryError}
          </p>
        )}
        {usable && workspaceIssue && (
          <p className="cloud-workspace-alert" role="alert">
            {workspaceIssue}
          </p>
        )}
        <CloudCachedLibrary
          store={store}
          scope={scope}
          signal={signal}
          refreshKey={effectiveRefreshKey}
          onOpen={handleOpen}
          onCreate={handleCreate}
          onInspectConflict={handleInspectConflict}
        />
      </div>
      {visibleEditor && (
        <div
          ref={editorPaneRef}
          className="cloud-workspace-editor"
          onFocusCapture={() => {
            desiredCardTitleRef.current = null;
            desiredConflictNoteIdRef.current = null;
            provisionalButtonRef.current = null;
          }}
        >
          <CloudUploadingNoteEditor
            upload={visibleEditor.upload}
            onPutAway={(session) => handleEditorPutAway(visibleEditor, session)}
          />
        </div>
      )}
      {visibleInspection && (
        <div
          ref={inspectionPaneRef}
          className="cloud-workspace-inspection"
          onFocusCapture={() => {
            desiredCardTitleRef.current = null;
            desiredConflictNoteIdRef.current = null;
            provisionalButtonRef.current = null;
          }}
        >
          <div className="cloud-workspace-inspection-bar">
            <button
              ref={inspectionBackButtonRef}
              type="button"
              className="cloud-workspace-inspection-back"
              onClick={handleCloseInspection}
            >
              Back to notes
            </button>
          </div>
          {conflictOwners === undefined ? (
            <CloudConflictPreview
              context={workspaceContext}
              noteId={visibleInspection.noteId}
              signal={signal}
              refreshKey={effectiveRefreshKey}
            />
          ) : (
            <CloudConflictResolutionPanel
              context={workspaceContext}
              owners={conflictOwners}
              onNewNoteRetained={
                recoveryOpenBinding ? handleNewNoteRetained : undefined
              }
              noteId={visibleInspection.noteId}
              signal={signal}
              refreshKey={effectiveRefreshKey}
            />
          )}
        </div>
      )}
    </div>
  );
}
