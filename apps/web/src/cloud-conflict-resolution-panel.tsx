import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import "./cloud-conflict-resolution-panel.css";
import { MAX_NOTE_BYTES, byteLength } from "../../../packages/core/src/index";
import type {
  CloudClientState,
  CloudDraft,
} from "../../../packages/cloud-protocol/src/index";
import {
  validateCloudNoteId,
  validateCloudScope,
  type CloudScope,
} from "../../../packages/cloud-protocol/src/durable";
import type { CloudLibraryStateStore } from "../../../packages/cloud-protocol/src/library-local";
import type { CloudLibraryContext } from "./cloud-cached-library";
import {
  CloudConflictResolutionController,
  type CloudConflictResolutionChoice,
  type CloudConflictResolutionKind,
  type CloudConflictResolutionResult,
  type CloudConflictResolutionView,
} from "./cloud-conflict-resolution";
import { CloudLibraryOwners } from "./cloud-library-owners";

export type CloudConflictResolutionPanelProps = {
  context: CloudLibraryContext;
  owners: CloudLibraryOwners;
  signal: AbortSignal;
  noteId: string;
  refreshKey: number;
};

type CapturedPanelIdentity = Readonly<{
  store: CloudLibraryStateStore;
  scope: Readonly<CloudScope>;
  scopeKey: string;
  owners: CloudLibraryOwners;
  conflicts: CloudLibraryOwners["conflicts"];
  subscribe: CloudLibraryOwners["subscribe"];
  signal: AbortSignal;
  noteId: string;
}>;

type SelectedIdentityState = Readonly<{
  store: CloudLibraryStateStore | null;
  scope: Readonly<CloudScope> | null;
  scopeKey: string | null;
  owners: CloudLibraryOwners | null;
  conflicts: CloudLibraryOwners["conflicts"] | null;
  subscribe: CloudLibraryOwners["subscribe"] | null;
  signal: AbortSignal | null;
  noteId: string | null;
  serial: number;
}>;

type ActiveLifecycleLabel = "Active" | "Archived" | "In Trash";

type ProposalKind = "local" | "cloud" | "merge";

type ResolutionProposal = Readonly<{
  kind: ProposalKind;
  capturedGeneration: number;
  acknowledgedLifecycle: boolean;
}>;

type CombineDraftState = Readonly<{
  text: string;
  dirty: boolean;
}>;

type OutcomeNotice = Readonly<{
  kind: CloudConflictResolutionKind;
  role: "status" | "alert";
  tone: "info" | "warning" | "error";
  message: string;
}>;

type CopySide = "local" | "remote" | "combined";

type CapturedControllerBinding = Readonly<{
  controller: CloudConflictResolutionController;
  read: CloudConflictResolutionController["read"];
  resolve: CloudConflictResolutionController["resolve"];
  retry: CloudConflictResolutionController["retry"];
}>;

type SelectedResolutionPanelProps = {
  identity: CapturedPanelIdentity;
  refreshKey: number;
};

export const RESOLUTION_UNAVAILABLE_COPY =
  "Cloud conflict resolution unavailable. This view is inactive and cannot submit further changes.";

const LOADING_COPY = "Loading Cloud conflict resolution...";

const CONFLICT_SUMMARY_COPY =
  "Conflict: Automatic Cloud upload is paused while both preserved versions remain on this device. Cached Cloud observation may not reflect newer Cloud changes.";

const CACHED_OBSERVATION_CAVEAT =
  "Cached Cloud observations reflect what this device last received and are not necessarily the current Cloud state.";

const BODY_LIMIT_ERROR_COPY =
  "This note has reached its 256 KiB limit. Copy the extra text into a new note.";

const OUTCOME_MESSAGES: Readonly<
  Record<
    Exclude<
      CloudConflictResolutionKind,
      "complete" | "unavailable" | "canceled"
    >,
    string
  >
> = Object.freeze({
  pending:
    "Resolution retained on this device as Pending upload. Use Retry upload when ready to confirm with Cloud.",
  paused:
    "Cloud upload paused before confirmation. Your chosen version remains durably retained as Pending upload on this device.",
  "sign-in-required":
    "Sign in again to upload this retained Cloud resolution. Your chosen version remains Pending upload on this device.",
  conflict:
    "Cloud reported a newer conflicting revision before this upload could apply. Both versions remain preserved on this device for a fresh decision.",
  stale:
    "This note changed on this device before confirmation completed. Any manual combined text was preserved; review the updated versions and make a fresh choice.",
  busy: "This note is currently open or busy in another Cloud view. Put away the open note first; any manual combined text was preserved.",
  "new-note-required":
    "This note identity was permanently purged in Cloud and cannot be restored under its old ID. Copy your preserved text to save it in a new note.",
});

const COPY_SUCCESS_MESSAGES: Readonly<Record<CopySide, string>> = Object.freeze(
  {
    local: "Draft text copied to clipboard.",
    remote: "Observed Cloud text copied to clipboard.",
    combined: "Combined text copied to clipboard.",
  },
);

const COPY_ERROR_MESSAGES: Readonly<Record<CopySide, string>> = Object.freeze({
  local:
    "Could not copy draft text. Select the text below to copy it manually.",
  remote:
    "Could not copy observed Cloud text. Select the text below to copy it manually.",
  combined:
    "Could not copy combined text. Select the text below to copy it manually.",
});

const COPY_STATUS_LABELS: Readonly<Record<CopySide, string>> = Object.freeze({
  local: "Draft copy status",
  remote: "Observed Cloud copy status",
  combined: "Combined text copy status",
});

function ownDataProperty(
  target: object,
  key: string,
): { ok: true; value: unknown } | { ok: false } {
  const descriptor = Object.getOwnPropertyDescriptor(target, key);
  if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
    return { ok: false };
  }
  return { ok: true, value: descriptor.value };
}

function hasOnlyOwnDataProperties(target: object): boolean {
  if (Object.getOwnPropertySymbols(target).length > 0) return false;
  for (const key of Object.getOwnPropertyNames(target)) {
    const descriptor = Object.getOwnPropertyDescriptor(target, key);
    if (!descriptor || !("value" in descriptor)) return false;
  }
  return true;
}

function readFunctionWithoutGetter(
  target: object,
  key: string,
): ((...args: never[]) => unknown) | null {
  let cursor: object | null = target;
  while (cursor !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(cursor, key);
    if (descriptor) {
      if (!("value" in descriptor) || typeof descriptor.value !== "function") {
        return null;
      }
      return descriptor.value as (...args: never[]) => unknown;
    }
    cursor = Object.getPrototypeOf(cursor);
  }
  return null;
}

function isAbortSignalWithoutGetters(input: unknown): input is AbortSignal {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  for (const key of ["aborted", "addEventListener", "removeEventListener"]) {
    const own = Object.getOwnPropertyDescriptor(input, key);
    if (own && !("value" in own)) return false;
  }
  if (typeof AbortSignal === "function" && input instanceof AbortSignal) {
    return true;
  }
  const aborted = ownDataProperty(input, "aborted"),
    add = readFunctionWithoutGetter(input, "addEventListener"),
    remove = readFunctionWithoutGetter(input, "removeEventListener");
  return (
    aborted.ok &&
    typeof aborted.value === "boolean" &&
    add !== null &&
    remove !== null
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

function scopesEqual(
  left: Readonly<CloudScope>,
  right: Readonly<CloudScope>,
): boolean {
  return (
    left.version === right.version &&
    left.ownerSubject === right.ownerSubject &&
    left.collectionId === right.collectionId &&
    left.modeGeneration === right.modeGeneration
  );
}

function captureStoreWithoutGetters(
  input: unknown,
): CloudLibraryStateStore | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  if (
    readFunctionWithoutGetter(input, "read") === null ||
    readFunctionWithoutGetter(input, "commit") === null ||
    readFunctionWithoutGetter(input, "close") === null ||
    readFunctionWithoutGetter(input, "listLibrary") === null
  ) {
    return null;
  }
  return input as CloudLibraryStateStore;
}

function captureContextWithoutGetters(
  rawContext: unknown,
): { store: CloudLibraryStateStore; scope: Readonly<CloudScope> } | null {
  if (
    !rawContext ||
    typeof rawContext !== "object" ||
    Array.isArray(rawContext)
  ) {
    return null;
  }
  const proto = Object.getPrototypeOf(rawContext);
  if (proto !== Object.prototype && proto !== null) return null;
  if (!hasOnlyOwnDataProperties(rawContext)) return null;
  for (const key of Object.getOwnPropertyNames(rawContext)) {
    if (!ownDataProperty(rawContext, key).ok) return null;
  }
  const storeProp = ownDataProperty(rawContext, "store"),
    scopeProp = ownDataProperty(rawContext, "scope");
  if (!storeProp.ok || !scopeProp.ok) return null;
  const store = captureStoreWithoutGetters(storeProp.value);
  if (!store) return null;
  const scope = captureScopeWithoutGetters(scopeProp.value);
  if (!scope) return null;
  return { store, scope };
}

function capturePanelProps(rawProps: unknown): {
  identity: CapturedPanelIdentity | null;
  refreshKey: number;
} {
  try {
    if (!rawProps || typeof rawProps !== "object" || Array.isArray(rawProps)) {
      return { identity: null, refreshKey: -1 };
    }
    const contextProp = ownDataProperty(rawProps, "context"),
      ownersProp = ownDataProperty(rawProps, "owners"),
      signalProp = ownDataProperty(rawProps, "signal"),
      noteIdProp = ownDataProperty(rawProps, "noteId"),
      refreshKeyProp = ownDataProperty(rawProps, "refreshKey");
    if (
      !contextProp.ok ||
      !ownersProp.ok ||
      !signalProp.ok ||
      !noteIdProp.ok ||
      !refreshKeyProp.ok
    ) {
      return { identity: null, refreshKey: -1 };
    }
    const rawRefreshKey = refreshKeyProp.value;
    if (
      typeof rawRefreshKey !== "number" ||
      !Number.isSafeInteger(rawRefreshKey) ||
      rawRefreshKey < 0
    ) {
      return { identity: null, refreshKey: -1 };
    }
    const rawNoteId = noteIdProp.value;
    if (typeof rawNoteId !== "string" || /[\r\n]/.test(rawNoteId)) {
      return { identity: null, refreshKey: -1 };
    }
    validateCloudNoteId(rawNoteId);

    const rawSignal = signalProp.value;
    if (!isAbortSignalWithoutGetters(rawSignal) || rawSignal.aborted) {
      return { identity: null, refreshKey: -1 };
    }

    const parsedContext = captureContextWithoutGetters(contextProp.value);
    if (!parsedContext) {
      return { identity: null, refreshKey: -1 };
    }

    const rawOwners = ownersProp.value;
    if (
      !rawOwners ||
      typeof rawOwners !== "object" ||
      Array.isArray(rawOwners) ||
      Object.getPrototypeOf(rawOwners) !== CloudLibraryOwners.prototype ||
      !(rawOwners instanceof CloudLibraryOwners) ||
      !hasOnlyOwnDataProperties(rawOwners)
    ) {
      return { identity: null, refreshKey: -1 };
    }
    for (const protoKey of [
      "context",
      "signal",
      "conflicts",
      "subscribe",
    ] as const) {
      const protoDesc = Object.getOwnPropertyDescriptor(
        CloudLibraryOwners.prototype,
        protoKey,
      );
      if (protoDesc && !("value" in protoDesc)) {
        return { identity: null, refreshKey: -1 };
      }
    }

    const ownersContextProp = ownDataProperty(rawOwners, "context"),
      ownersSignalProp = ownDataProperty(rawOwners, "signal"),
      conflictsProp = ownDataProperty(rawOwners, "conflicts"),
      subscribeProp = ownDataProperty(rawOwners, "subscribe");
    if (
      !ownersContextProp.ok ||
      !ownersSignalProp.ok ||
      !conflictsProp.ok ||
      !subscribeProp.ok ||
      typeof conflictsProp.value !== "function" ||
      typeof subscribeProp.value !== "function" ||
      ownersSignalProp.value !== rawSignal
    ) {
      return { identity: null, refreshKey: -1 };
    }

    const parsedOwnersContext = captureContextWithoutGetters(
      ownersContextProp.value,
    );
    if (
      !parsedOwnersContext ||
      parsedOwnersContext.store !== parsedContext.store ||
      !scopesEqual(parsedOwnersContext.scope, parsedContext.scope)
    ) {
      return { identity: null, refreshKey: -1 };
    }

    return {
      identity: Object.freeze({
        store: parsedContext.store,
        scope: parsedContext.scope,
        scopeKey: JSON.stringify(parsedContext.scope),
        owners: rawOwners,
        conflicts: conflictsProp.value as CloudLibraryOwners["conflicts"],
        subscribe: subscribeProp.value as CloudLibraryOwners["subscribe"],
        signal: rawSignal,
        noteId: rawNoteId,
      }),
      refreshKey: rawRefreshKey,
    };
  } catch {
    return { identity: null, refreshKey: -1 };
  }
}

function captureControllerBinding(
  identity: CapturedPanelIdentity,
): CapturedControllerBinding | null {
  try {
    if (identity.signal.aborted) return null;
    const candidate = identity.conflicts.call(identity.owners);
    if (
      !candidate ||
      typeof candidate !== "object" ||
      Array.isArray(candidate) ||
      !(candidate instanceof CloudConflictResolutionController) ||
      !hasOnlyOwnDataProperties(candidate)
    ) {
      return null;
    }
    const signalProp = ownDataProperty(candidate, "signal"),
      readProp = ownDataProperty(candidate, "read"),
      resolveProp = ownDataProperty(candidate, "resolve"),
      retryProp = ownDataProperty(candidate, "retry");
    if (
      !signalProp.ok ||
      signalProp.value !== identity.signal ||
      !readProp.ok ||
      typeof readProp.value !== "function" ||
      !resolveProp.ok ||
      typeof resolveProp.value !== "function" ||
      !retryProp.ok ||
      typeof retryProp.value !== "function"
    ) {
      return null;
    }
    return Object.freeze({
      controller: candidate,
      read: readProp.value as CloudConflictResolutionController["read"],
      resolve:
        resolveProp.value as CloudConflictResolutionController["resolve"],
      retry: retryProp.value as CloudConflictResolutionController["retry"],
    });
  } catch {
    return null;
  }
}

export function hasSamePanelIdentity(
  selected: SelectedIdentityState,
  captured: CapturedPanelIdentity | null,
): boolean {
  return (
    selected.store === (captured?.store ?? null) &&
    selected.scopeKey === (captured?.scopeKey ?? null) &&
    selected.owners === (captured?.owners ?? null) &&
    selected.signal === (captured?.signal ?? null) &&
    selected.noteId === (captured?.noteId ?? null)
  );
}

export function isCurrentReadSerial(
  requestSerial: number,
  latestSerial: number,
  aborted: boolean,
  mounted: boolean,
): boolean {
  return mounted && !aborted && requestSerial === latestSerial;
}

export function isProposalGenerationCurrent(
  proposedGeneration: number,
  displayedGeneration: number | null,
): boolean {
  return (
    typeof displayedGeneration === "number" &&
    Number.isSafeInteger(displayedGeneration) &&
    proposedGeneration === displayedGeneration
  );
}

function lifecycleLabel(state: CloudDraft["state"]): ActiveLifecycleLabel {
  if (state === "archived") return "Archived";
  if (state === "trashed") return "In Trash";
  return "Active";
}

function restoredRemoteLifecycle(
  conflict: NonNullable<CloudClientState["conflict"]>,
): "archived" | "trashed" | null {
  if (conflict.local.kind !== "upsert" || conflict.remote === null) {
    return null;
  }
  const localState = conflict.local.snapshot.state,
    remoteState = conflict.remote.state;
  if (remoteState === "trashed" && localState !== "trashed") {
    return "trashed";
  }
  if (remoteState === "archived" && localState === "active") {
    return "archived";
  }
  return null;
}

function nonConflictDetail(
  status: Exclude<CloudConflictResolutionView["status"], "Conflict">,
  uploading: boolean,
  adoptedRevision: number | null,
): string {
  if (status === "No cached Cloud note") {
    return "No cached Cloud note is stored for this selection on this device.";
  }
  if (status === "Pending upload") {
    return uploading
      ? "Saving to Cloud... Waiting for matching server confirmation; this version is still pending."
      : "Chosen resolution is durably retained on this device as Pending upload until Cloud confirms it.";
  }
  if (status === "Deleted in Cloud") {
    if (adoptedRevision !== null) {
      return `Adopted cached observed Cloud deletion (revision ${adoptedRevision}) on this device without a new Cloud request.`;
    }
    return "No Cloud conflict is recorded for this note. This note identity was permanently deleted in Cloud.";
  }
  if (adoptedRevision !== null) {
    return `Adopted cached observed Cloud revision ${adoptedRevision} on this device without a new Cloud request. Cached observation only; Cloud may have newer changes.`;
  }
  return "No Cloud conflict is recorded for this note.";
}

function UnavailableResolutionPanel() {
  const headingId = useId();
  return (
    <section
      className="cloud-conflict-resolution-panel"
      aria-labelledby={headingId}
      aria-busy={false}
    >
      <header className="cloud-conflict-resolution-header">
        <h1 id={headingId}>Cloud conflict resolution</h1>
      </header>
      <p className="cloud-conflict-resolution-unavailable" role="alert">
        {RESOLUTION_UNAVAILABLE_COPY}
      </p>
    </section>
  );
}

/**
 * Explicit original-context Cloud conflict resolution panel. Validates genuine
 * parent CloudLibraryOwners identity without invoking getters, uses a single
 * controller.read view for displayed versions and generation, requires inline
 * confirmation pinned to the proposed generation, preserves manual combined
 * text across stale/busy/error outcomes and never closes caller-owned stores.
 */
export function CloudConflictResolutionPanel(
  props: CloudConflictResolutionPanelProps,
) {
  const { identity: captured, refreshKey } = capturePanelProps(props),
    [selected, setSelected] = useState<SelectedIdentityState>(() => ({
      store: captured?.store ?? null,
      scope: captured?.scope ?? null,
      scopeKey: captured?.scopeKey ?? null,
      owners: captured?.owners ?? null,
      conflicts: captured?.conflicts ?? null,
      subscribe: captured?.subscribe ?? null,
      signal: captured?.signal ?? null,
      noteId: captured?.noteId ?? null,
      serial: 0,
    }));

  if (!hasSamePanelIdentity(selected, captured)) {
    setSelected({
      store: captured?.store ?? null,
      scope: captured?.scope ?? null,
      scopeKey: captured?.scopeKey ?? null,
      owners: captured?.owners ?? null,
      conflicts: captured?.conflicts ?? null,
      subscribe: captured?.subscribe ?? null,
      signal: captured?.signal ?? null,
      noteId: captured?.noteId ?? null,
      serial: selected.serial + 1,
    });
    return null;
  }

  if (
    !captured ||
    !selected.store ||
    !selected.scope ||
    !selected.owners ||
    !selected.conflicts ||
    !selected.subscribe ||
    !selected.signal ||
    !selected.noteId
  ) {
    return <UnavailableResolutionPanel />;
  }

  return (
    <SelectedResolutionPanel
      key={selected.serial}
      identity={captured}
      refreshKey={refreshKey}
    />
  );
}

function SelectedResolutionPanel({
  identity,
  refreshKey,
}: SelectedResolutionPanelProps) {
  const sectionHeadingId = useId(),
    localHeadingId = useId(),
    remoteHeadingId = useId(),
    decisionsHeadingId = useId(),
    confirmHeadingId = useId(),
    combineInputId = useId(),
    preservedInputId = useId();

  const controllerBinding = useMemo(
    () => captureControllerBinding(identity),
    [identity],
  );

  const [aborted, setAborted] = useState(() => identity.signal.aborted),
    [bindingInvalid, setBindingInvalid] = useState(
      () => controllerBinding === null,
    ),
    [unavailable, setUnavailable] = useState(false),
    [ownerTick, setOwnerTick] = useState(0),
    [view, setView] = useState<CloudConflictResolutionView | null>(null),
    [proposal, setProposal] = useState<ResolutionProposal | null>(null),
    [combineDraft, setCombineDraft] = useState<CombineDraftState | null>(null),
    [actionMode, setActionMode] = useState<
      "uploading" | "adopting" | "reloading" | null
    >(null),
    [outcome, setOutcome] = useState<OutcomeNotice | null>(null),
    [adoptedRevision, setAdoptedRevision] = useState<number | null>(null),
    [copyingSide, setCopyingSide] = useState<Record<CopySide, boolean>>({
      local: false,
      remote: false,
      combined: false,
    }),
    [copyOutcomes, setCopyOutcomes] = useState<
      Record<CopySide, { ok: boolean } | null>
    >({
      local: null,
      remote: null,
      combined: null,
    });

  const mountedRef = useRef(false),
    readSerialRef = useRef(0),
    unavailableRef = useRef(false),
    actionLatchRef = useRef(false),
    proposalRef = useRef<ResolutionProposal | null>(null),
    combineDraftRef = useRef<CombineDraftState | null>(null),
    viewRef = useRef<CloudConflictResolutionView | null>(null),
    copyAttemptCounterRef = useRef(0),
    inFlightCopyRef = useRef<Record<CopySide, number | null>>({
      local: null,
      remote: null,
      combined: null,
    });

  proposalRef.current = proposal;
  combineDraftRef.current = combineDraft;
  viewRef.current = view;

  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      actionLatchRef.current = false;
      inFlightCopyRef.current = { local: null, remote: null, combined: null };
    };
  }, []);

  useEffect(() => {
    if (identity.signal.aborted) {
      readSerialRef.current += 1;
      inFlightCopyRef.current = { local: null, remote: null, combined: null };
      setAborted(true);
      return;
    }
    const onAbort = () => {
      readSerialRef.current += 1;
      inFlightCopyRef.current = { local: null, remote: null, combined: null };
      setAborted(true);
    };
    identity.signal.addEventListener("abort", onAbort, { once: true });
    return () => {
      identity.signal.removeEventListener("abort", onAbort);
    };
  }, [identity.signal]);

  useEffect(() => {
    if (!controllerBinding || identity.signal.aborted) return;
    let active = true;
    let unsubscribe: (() => void) | null = null;
    try {
      const candidate = identity.subscribe.call(identity.owners, () => {
        if (active && mountedRef.current && !identity.signal.aborted) {
          setOwnerTick((count) => count + 1);
        }
      });
      if (typeof candidate !== "function") {
        setBindingInvalid(true);
        return;
      }
      unsubscribe = candidate;
    } catch {
      setBindingInvalid(true);
      return;
    }
    return () => {
      active = false;
      if (unsubscribe) {
        try {
          unsubscribe();
        } catch {
          /* Unmount cleanup never surfaces observer errors. */
        }
      }
    };
  }, [controllerBinding, identity]);

  const enterUnavailable = useCallback(() => {
    if (!mountedRef.current) return;
    if (identity.signal.aborted) {
      readSerialRef.current += 1;
      inFlightCopyRef.current = { local: null, remote: null, combined: null };
      setAborted(true);
      return;
    }
    readSerialRef.current += 1;
    unavailableRef.current = true;
    setUnavailable(true);
    setView(null);
    setProposal(null);
    setOutcome(null);
    setAdoptedRevision(null);
    setCopyOutcomes((prev) =>
      prev.local || prev.remote ? { ...prev, local: null, remote: null } : prev,
    );
  }, [identity.signal]);

  const runRead = useCallback(() => {
    if (
      !controllerBinding ||
      identity.signal.aborted ||
      unavailableRef.current
    ) {
      return () => {};
    }
    const requestSerial = ++readSerialRef.current;
    let active = true;
    void Promise.resolve()
      .then(() => {
        if (!active || unavailableRef.current || identity.signal.aborted) {
          return undefined;
        }
        return controllerBinding.read.call(
          controllerBinding.controller,
          identity.noteId,
        );
      })
      .then(
        (nextView) => {
          if (
            nextView === undefined ||
            !active ||
            unavailableRef.current ||
            !isCurrentReadSerial(
              requestSerial,
              readSerialRef.current,
              identity.signal.aborted,
              mountedRef.current,
            )
          ) {
            return;
          }
          const previousGeneration = viewRef.current?.generation;
          if (
            previousGeneration !== undefined &&
            previousGeneration !== nextView.generation
          ) {
            // A receipt or adopted-observation notice belongs to its old generation.
            // A later local edit must not retain that success claim beside Pending.
            setOutcome((current) =>
              current?.kind === "complete" ? null : current,
            );
            setAdoptedRevision(null);
          }
          const activeProposal = proposalRef.current;
          if (
            activeProposal !== null &&
            !actionLatchRef.current &&
            !isProposalGenerationCurrent(
              activeProposal.capturedGeneration,
              nextView.generation,
            )
          ) {
            setProposal(null);
            if (nextView.status === "Conflict") {
              setOutcome({
                kind: "stale",
                role: "alert",
                tone: "warning",
                message: OUTCOME_MESSAGES.stale,
              });
            }
          }
          setCopyOutcomes((prev) =>
            prev.local || prev.remote
              ? { ...prev, local: null, remote: null }
              : prev,
          );
          setView(nextView);
        },
        () => {
          if (!active || !mountedRef.current) return;
          if (identity.signal.aborted) {
            readSerialRef.current += 1;
            inFlightCopyRef.current = {
              local: null,
              remote: null,
              combined: null,
            };
            setAborted(true);
            return;
          }
          if (
            isCurrentReadSerial(
              requestSerial,
              readSerialRef.current,
              identity.signal.aborted,
              mountedRef.current,
            )
          ) {
            enterUnavailable();
          }
        },
      );
    return () => {
      active = false;
    };
  }, [controllerBinding, enterUnavailable, identity]);

  useEffect(() => {
    if (unavailableRef.current) return;
    return runRead();
  }, [runRead, refreshKey, ownerTick]);

  const isAborted = aborted || identity.signal.aborted;
  if (isAborted || bindingInvalid || !controllerBinding) {
    return <UnavailableResolutionPanel />;
  }

  const initialLoading = view === null && !unavailable;
  const actionInFlight = actionMode !== null;
  const uploadingToCloud = actionMode === "uploading";
  const reloadingConflict = actionMode === "reloading";

  const handleCopy = async (side: CopySide, capturedBody: string) => {
    if (
      !mountedRef.current ||
      identity.signal.aborted ||
      typeof capturedBody !== "string" ||
      (side !== "combined" && capturedBody.length === 0)
    ) {
      return;
    }
    const currentView = viewRef.current;
    if (side === "local") {
      if (
        currentView?.status !== "Conflict" ||
        currentView.conflict?.local.kind !== "upsert" ||
        currentView.conflict.local.snapshot.bodyMarkdown !== capturedBody
      ) {
        return;
      }
    } else if (side === "remote") {
      if (
        currentView?.status !== "Conflict" ||
        currentView.conflict?.remote === null ||
        currentView.conflict?.remote.bodyMarkdown !== capturedBody
      ) {
        return;
      }
    } else if (
      !combineDraftRef.current?.dirty ||
      combineDraftRef.current.text !== capturedBody
    ) {
      return;
    }
    if (inFlightCopyRef.current[side] !== null) return;

    const capturedGeneration = currentView?.generation ?? null,
      attempt = ++copyAttemptCounterRef.current;
    inFlightCopyRef.current[side] = attempt;
    setCopyingSide((prev) => ({ ...prev, [side]: true }));
    setCopyOutcomes((prev) => ({ ...prev, [side]: null }));

    let ok = false;
    try {
      const clipboard =
        typeof navigator === "object" && navigator !== null
          ? navigator.clipboard
          : undefined;
      if (!clipboard || typeof clipboard.writeText !== "function") {
        throw Error("Clipboard unavailable");
      }
      await clipboard.writeText(capturedBody);
      ok = true;
    } catch {
      ok = false;
    }

    const stillCurrentAttempt = inFlightCopyRef.current[side] === attempt;
    if (stillCurrentAttempt) {
      inFlightCopyRef.current[side] = null;
    }
    if (
      !stillCurrentAttempt ||
      !mountedRef.current ||
      identity.signal.aborted
    ) {
      return;
    }
    setCopyingSide((prev) => ({ ...prev, [side]: false }));

    if (side === "combined") {
      if (
        !combineDraftRef.current?.dirty ||
        combineDraftRef.current.text !== capturedBody
      ) {
        return;
      }
    } else if ((viewRef.current?.generation ?? null) !== capturedGeneration) {
      return;
    }
    setCopyOutcomes((prev) => ({ ...prev, [side]: { ok } }));
  };

  const handleRetryLoad = async () => {
    if (
      actionLatchRef.current ||
      !mountedRef.current ||
      identity.signal.aborted ||
      !unavailableRef.current
    ) {
      return;
    }
    const requestSerial = ++readSerialRef.current;
    actionLatchRef.current = true;
    setActionMode("reloading");

    try {
      const nextView = await controllerBinding.read.call(
        controllerBinding.controller,
        identity.noteId,
      );
      if (
        !isCurrentReadSerial(
          requestSerial,
          readSerialRef.current,
          identity.signal.aborted,
          mountedRef.current,
        )
      ) {
        return;
      }
      unavailableRef.current = false;
      setUnavailable(false);
      setProposal(null);
      setOutcome(null);
      setAdoptedRevision(null);
      setCopyOutcomes((prev) => {
        const nextCombined =
          nextView.status === "Conflict" && nextView.canMerge
            ? null
            : prev.combined;
        if (
          prev.local === null &&
          prev.remote === null &&
          prev.combined === nextCombined
        ) {
          return prev;
        }
        return { local: null, remote: null, combined: nextCombined };
      });
      setView(nextView);
    } catch {
      if (!mountedRef.current) return;
      if (identity.signal.aborted) {
        enterUnavailable();
        return;
      }
      if (requestSerial === readSerialRef.current) {
        unavailableRef.current = true;
        setUnavailable(true);
      }
    } finally {
      actionLatchRef.current = false;
      if (mountedRef.current && !identity.signal.aborted) {
        setActionMode(null);
      }
    }
  };

  const applyControllerResult = (
    result: CloudConflictResolutionResult,
    source:
      | { kind: "resolve"; choiceKind: ProposalKind; remoteRevision: number }
      | { kind: "retry" },
  ) => {
    if (!mountedRef.current) return;
    if (identity.signal.aborted || result.kind === "canceled") {
      readSerialRef.current += 1;
      inFlightCopyRef.current = { local: null, remote: null, combined: null };
      setAborted(true);
      return;
    }
    if (result.kind === "unavailable") {
      enterUnavailable();
      return;
    }
    if (result.view !== null) {
      readSerialRef.current += 1;
      setView(result.view);
    } else {
      runRead();
    }

    if (result.kind === "complete") {
      setProposal(null);
      setCombineDraft(null);
      setCopyOutcomes({ local: null, remote: null, combined: null });
      if (source.kind === "resolve" && source.choiceKind === "cloud") {
        setAdoptedRevision(source.remoteRevision);
        const deleted = result.view?.status === "Deleted in Cloud";
        setOutcome({
          kind: "complete",
          role: "status",
          tone: "info",
          message: deleted
            ? `Adopted cached observed Cloud deletion (revision ${source.remoteRevision}) on this device without a new Cloud request.`
            : `Adopted cached observed Cloud revision ${source.remoteRevision} on this device without a new Cloud request. Cached observation only; Cloud may have newer changes.`,
        });
      } else {
        setAdoptedRevision(null);
        const deleted = result.view?.status === "Deleted in Cloud";
        setOutcome({
          kind: "complete",
          role: "status",
          tone: "info",
          message: deleted
            ? "Permanent deletion confirmed in Cloud."
            : "Resolution confirmed and saved in Cloud.",
        });
      }
      return;
    }

    setAdoptedRevision(null);
    setProposal(null);

    if (result.kind === "pending") {
      setOutcome({
        kind: "pending",
        role: "status",
        tone: "warning",
        message: OUTCOME_MESSAGES.pending,
      });
      return;
    }

    setOutcome({
      kind: result.kind,
      role: "alert",
      tone: result.kind === "new-note-required" ? "error" : "warning",
      message: OUTCOME_MESSAGES[result.kind],
    });
  };

  const selectProposal = (kind: ProposalKind) => {
    if (
      actionLatchRef.current ||
      actionInFlight ||
      !view ||
      view.status !== "Conflict" ||
      !view.conflict ||
      view.generation === null
    ) {
      return;
    }
    if (
      kind === "local" &&
      view.conflict.remote === null &&
      view.conflict.local.kind !== "purge"
    ) {
      return;
    }
    if (kind === "merge" && !view.canMerge) {
      return;
    }
    if (
      kind === "merge" &&
      (combineDraft === null || !combineDraft.dirty) &&
      view.conflict.local.kind === "upsert"
    ) {
      setCombineDraft({
        text: view.conflict.local.snapshot.bodyMarkdown,
        dirty: false,
      });
    }
    setOutcome(null);
    setProposal({
      kind,
      capturedGeneration: view.generation,
      acknowledgedLifecycle: false,
    });
  };

  const handleConfirmResolution = async () => {
    if (
      actionLatchRef.current ||
      !mountedRef.current ||
      identity.signal.aborted ||
      !view ||
      view.status !== "Conflict" ||
      !view.conflict ||
      !proposal
    ) {
      return;
    }
    if (
      !isProposalGenerationCurrent(proposal.capturedGeneration, view.generation)
    ) {
      setProposal(null);
      setOutcome({
        kind: "stale",
        role: "alert",
        tone: "warning",
        message: OUTCOME_MESSAGES.stale,
      });
      return;
    }
    const restoreKind = restoredRemoteLifecycle(view.conflict);
    if (
      proposal.kind === "local" &&
      restoreKind !== null &&
      !proposal.acknowledgedLifecycle
    ) {
      return;
    }

    let choice: CloudConflictResolutionChoice;
    if (proposal.kind === "local") {
      choice = { kind: "local" };
    } else if (proposal.kind === "cloud") {
      choice = { kind: "cloud" };
    } else {
      if (!view.canMerge) return;
      const bodyMarkdown =
        combineDraft?.text ??
        (view.conflict.local.kind === "upsert"
          ? view.conflict.local.snapshot.bodyMarkdown
          : "");
      if (byteLength(bodyMarkdown) > MAX_NOTE_BYTES) {
        return;
      }
      choice = { kind: "merge", bodyMarkdown };
    }

    const expectedGeneration = proposal.capturedGeneration,
      choiceKind = proposal.kind,
      remoteRevision = view.conflict.remoteRevision;

    actionLatchRef.current = true;
    setActionMode(choiceKind === "cloud" ? "adopting" : "uploading");
    setOutcome(null);

    try {
      const result = await controllerBinding.resolve.call(
        controllerBinding.controller,
        identity.noteId,
        expectedGeneration,
        choice,
      );
      applyControllerResult(result, {
        kind: "resolve",
        choiceKind,
        remoteRevision,
      });
    } catch {
      enterUnavailable();
    } finally {
      actionLatchRef.current = false;
      if (mountedRef.current && !identity.signal.aborted) {
        setActionMode(null);
      }
    }
  };

  const handleRetryUpload = async () => {
    if (
      actionLatchRef.current ||
      !mountedRef.current ||
      identity.signal.aborted ||
      !view ||
      view.status !== "Pending upload" ||
      view.generation === null
    ) {
      return;
    }
    const expectedGeneration = view.generation;
    actionLatchRef.current = true;
    setActionMode("uploading");
    setOutcome(null);

    try {
      const result = await controllerBinding.retry.call(
        controllerBinding.controller,
        identity.noteId,
        expectedGeneration,
      );
      applyControllerResult(result, { kind: "retry" });
    } catch {
      enterUnavailable();
    } finally {
      actionLatchRef.current = false;
      if (mountedRef.current && !identity.signal.aborted) {
        setActionMode(null);
      }
    }
  };

  const preservedCombineCard = combineDraft?.dirty ? (
    <div className="cloud-conflict-resolution-combine">
      <div className="cloud-conflict-resolution-combine-header">
        <label htmlFor={preservedInputId}>Preserved manual combined text</label>
        <button
          type="button"
          className="cloud-conflict-resolution-copy"
          data-busy={copyingSide.combined ? "true" : "false"}
          disabled={copyingSide.combined}
          onClick={() => {
            void handleCopy("combined", combineDraft.text);
          }}
        >
          Copy combined text
        </button>
      </div>
      {copyOutcomes.combined &&
        (copyOutcomes.combined.ok ? (
          <p
            className="cloud-conflict-resolution-copy-status"
            role="status"
            aria-label={COPY_STATUS_LABELS.combined}
            aria-live="polite"
          >
            {COPY_SUCCESS_MESSAGES.combined}
          </p>
        ) : (
          <p className="cloud-conflict-resolution-copy-error" role="alert">
            {COPY_ERROR_MESSAGES.combined}
          </p>
        ))}
      <textarea
        id={preservedInputId}
        className="cloud-conflict-resolution-textarea"
        value={combineDraft.text}
        readOnly
        rows={5}
      />
    </div>
  ) : null;

  if (unavailable) {
    return (
      <section
        className="cloud-conflict-resolution-panel"
        aria-labelledby={sectionHeadingId}
        aria-busy={reloadingConflict}
      >
        <header className="cloud-conflict-resolution-header">
          <h1 id={sectionHeadingId}>Cloud conflict resolution</h1>
        </header>

        <p className="cloud-conflict-resolution-unavailable" role="alert">
          {RESOLUTION_UNAVAILABLE_COPY}
        </p>

        <div className="cloud-conflict-resolution-retry-row">
          <button
            type="button"
            className="cloud-conflict-resolution-button"
            data-busy={reloadingConflict ? "true" : "false"}
            disabled={reloadingConflict}
            onClick={() => {
              void handleRetryLoad();
            }}
          >
            Retry loading conflict
          </button>
        </div>

        {preservedCombineCard}
      </section>
    );
  }

  const conflict =
    view?.status === "Conflict" && view.conflict ? view.conflict : null;
  const activeProposal =
    conflict &&
    proposal &&
    isProposalGenerationCurrent(
      proposal.capturedGeneration,
      view?.generation ?? null,
    )
      ? proposal
      : null;

  const canKeepDevice =
    conflict !== null &&
    (conflict.remote !== null || conflict.local.kind === "purge");
  const restoreTarget = conflict ? restoredRemoteLifecycle(conflict) : null;
  const needsLifecycleAck =
    activeProposal?.kind === "local" && restoreTarget !== null;
  const isDestructiveProposal =
    (activeProposal?.kind === "local" && conflict?.local.kind === "purge") ||
    (activeProposal?.kind === "cloud" && conflict?.remote === null);

  const combineValue =
    combineDraft?.text ??
    (conflict?.local.kind === "upsert"
      ? conflict.local.snapshot.bodyMarkdown
      : "");
  const combineOverLimit = byteLength(combineValue) > MAX_NOTE_BYTES;
  const showEditableCombine =
    conflict !== null &&
    Boolean(view?.canMerge) &&
    (activeProposal?.kind === "merge" || Boolean(combineDraft?.dirty));
  const showPreservedReadonlyCombine =
    Boolean(combineDraft?.dirty) && !showEditableCombine;

  return (
    <section
      className="cloud-conflict-resolution-panel"
      aria-labelledby={sectionHeadingId}
      aria-busy={initialLoading}
    >
      <header className="cloud-conflict-resolution-header">
        <h1 id={sectionHeadingId}>Cloud conflict resolution</h1>
      </header>

      {initialLoading && (
        <p className="cloud-conflict-resolution-loading">{LOADING_COPY}</p>
      )}

      {outcome && (
        <p
          className="cloud-conflict-resolution-outcome"
          data-tone={outcome.tone}
          data-outcome-kind={outcome.kind}
          role={outcome.role}
          aria-label="Resolution notice"
          aria-live={outcome.role === "status" ? "polite" : undefined}
        >
          {outcome.message}
        </p>
      )}

      {view && view.status !== "Conflict" && (
        <div className="cloud-conflict-resolution-nonconflict">
          <p
            className="cloud-conflict-resolution-nonconflict-status"
            role="status"
            aria-label="Resolution status"
            aria-live="polite"
          >
            {view.status === "Pending upload" && uploadingToCloud
              ? "Pending upload — Saving to Cloud..."
              : view.status}
          </p>
          <p className="cloud-conflict-resolution-nonconflict-detail">
            {nonConflictDetail(view.status, uploadingToCloud, adoptedRevision)}
          </p>
          {view.status === "Pending upload" && view.generation !== null && (
            <div className="cloud-conflict-resolution-retry-row">
              <button
                type="button"
                className="cloud-conflict-resolution-button"
                data-variant="primary"
                data-busy={actionInFlight ? "true" : "false"}
                disabled={actionInFlight}
                onClick={() => {
                  void handleRetryUpload();
                }}
              >
                Retry upload
              </button>
            </div>
          )}
        </div>
      )}

      {conflict && view && (
        <>
          <p
            className="cloud-conflict-resolution-summary"
            role="status"
            aria-label="Resolution status"
            aria-live="polite"
          >
            {CONFLICT_SUMMARY_COPY}
          </p>

          <div className="cloud-conflict-resolution-grid">
            <article
              className="cloud-conflict-resolution-card"
              data-version-side="local"
              aria-labelledby={localHeadingId}
            >
              <header className="cloud-conflict-resolution-card-header">
                <div className="cloud-conflict-resolution-card-titles">
                  <h2 id={localHeadingId}>Draft on this device</h2>
                  <div className="cloud-conflict-resolution-meta">
                    <span
                      className="cloud-conflict-resolution-badge"
                      data-lifecycle={
                        conflict.local.kind === "purge" ? "purged" : "present"
                      }
                    >
                      Local state:{" "}
                      {conflict.local.kind === "purge"
                        ? "Permanent purge queued"
                        : lifecycleLabel(conflict.local.snapshot.state)}
                    </span>
                    <span className="cloud-conflict-resolution-badge">
                      Unconfirmed on this device
                    </span>
                  </div>
                </div>
                {conflict.local.kind === "upsert" &&
                  conflict.local.snapshot.bodyMarkdown.length > 0 && (
                    <button
                      type="button"
                      className="cloud-conflict-resolution-copy"
                      data-busy={copyingSide.local ? "true" : "false"}
                      disabled={copyingSide.local}
                      onClick={() => {
                        if (conflict.local.kind === "upsert") {
                          void handleCopy(
                            "local",
                            conflict.local.snapshot.bodyMarkdown,
                          );
                        }
                      }}
                    >
                      Copy draft text
                    </button>
                  )}
              </header>

              {copyOutcomes.local &&
                (copyOutcomes.local.ok ? (
                  <p
                    className="cloud-conflict-resolution-copy-status"
                    role="status"
                    aria-label={COPY_STATUS_LABELS.local}
                    aria-live="polite"
                  >
                    {COPY_SUCCESS_MESSAGES.local}
                  </p>
                ) : (
                  <p
                    className="cloud-conflict-resolution-copy-error"
                    role="alert"
                  >
                    {COPY_ERROR_MESSAGES.local}
                  </p>
                ))}

              {conflict.local.kind === "purge" ? (
                <p className="cloud-conflict-resolution-empty">
                  Permanent deletion is queued on this device. No local draft
                  text is stored for this version.
                </p>
              ) : conflict.local.snapshot.bodyMarkdown.length === 0 ? (
                <p className="cloud-conflict-resolution-empty">
                  {`This local draft is an empty ${conflict.local.snapshot.state} note with no text.`}
                </p>
              ) : (
                <pre className="cloud-conflict-resolution-body">
                  {conflict.local.snapshot.bodyMarkdown}
                </pre>
              )}
            </article>

            <article
              className="cloud-conflict-resolution-card"
              data-version-side="remote"
              aria-labelledby={remoteHeadingId}
            >
              <header className="cloud-conflict-resolution-card-header">
                <div className="cloud-conflict-resolution-card-titles">
                  <h2 id={remoteHeadingId}>Observed Cloud version</h2>
                  <div className="cloud-conflict-resolution-meta">
                    <span
                      className="cloud-conflict-resolution-badge"
                      data-lifecycle={
                        conflict.remote === null ? "purged" : "present"
                      }
                    >
                      Observed Cloud state:{" "}
                      {conflict.remote === null
                        ? "Permanently purged in Cloud"
                        : lifecycleLabel(conflict.remote.state)}
                    </span>
                    <span className="cloud-conflict-resolution-badge">
                      {`Observed Cloud revision ${conflict.remoteRevision} (cached on this device)`}
                    </span>
                  </div>
                </div>
                {conflict.remote !== null &&
                  conflict.remote.bodyMarkdown.length > 0 && (
                    <button
                      type="button"
                      className="cloud-conflict-resolution-copy"
                      data-busy={copyingSide.remote ? "true" : "false"}
                      disabled={copyingSide.remote}
                      onClick={() => {
                        if (conflict.remote !== null) {
                          void handleCopy(
                            "remote",
                            conflict.remote.bodyMarkdown,
                          );
                        }
                      }}
                    >
                      Copy observed Cloud text
                    </button>
                  )}
              </header>

              {copyOutcomes.remote &&
                (copyOutcomes.remote.ok ? (
                  <p
                    className="cloud-conflict-resolution-copy-status"
                    role="status"
                    aria-label={COPY_STATUS_LABELS.remote}
                    aria-live="polite"
                  >
                    {COPY_SUCCESS_MESSAGES.remote}
                  </p>
                ) : (
                  <p
                    className="cloud-conflict-resolution-copy-error"
                    role="alert"
                  >
                    {COPY_ERROR_MESSAGES.remote}
                  </p>
                ))}

              {conflict.remote === null ? (
                <p className="cloud-conflict-resolution-purge-notice">
                  {`This note identity was permanently purged in Cloud at observed revision ${conflict.remoteRevision}. No remote note text exists. A permanently purged note ID cannot be restored; saving your draft later requires a new note ID.`}
                </p>
              ) : conflict.remote.bodyMarkdown.length === 0 ? (
                <p className="cloud-conflict-resolution-empty">
                  {`This observed Cloud version is an empty ${conflict.remote.state} note with no text.`}
                </p>
              ) : (
                <pre className="cloud-conflict-resolution-body">
                  {conflict.remote.bodyMarkdown}
                </pre>
              )}
            </article>
          </div>

          <div
            className="cloud-conflict-resolution-decisions"
            role="group"
            aria-labelledby={decisionsHeadingId}
          >
            <h2 id={decisionsHeadingId}>Choose a resolution</h2>
            <p className="cloud-conflict-resolution-caveat">
              {CACHED_OBSERVATION_CAVEAT}
            </p>

            {conflict.remote === null && conflict.local.kind === "upsert" && (
              <p className="cloud-conflict-resolution-purge-notice">
                {`Because this note ID was permanently purged in Cloud at observed revision ${conflict.remoteRevision}, it cannot be resurrected or combined under the old ID. Copy your preserved draft text above to create a new note separately, or accept permanent deletion below.`}
              </p>
            )}

            <div className="cloud-conflict-resolution-choice-row">
              {canKeepDevice && (
                <button
                  type="button"
                  className="cloud-conflict-resolution-button"
                  aria-pressed={activeProposal?.kind === "local"}
                  disabled={actionInFlight}
                  onClick={() => selectProposal("local")}
                >
                  Keep device version
                </button>
              )}
              <button
                type="button"
                className="cloud-conflict-resolution-button"
                aria-pressed={activeProposal?.kind === "cloud"}
                disabled={actionInFlight}
                onClick={() => selectProposal("cloud")}
              >
                Use observed Cloud version
              </button>
              {view.canMerge && (
                <button
                  type="button"
                  className="cloud-conflict-resolution-button"
                  aria-pressed={activeProposal?.kind === "merge"}
                  disabled={actionInFlight}
                  onClick={() => selectProposal("merge")}
                >
                  Combine text
                </button>
              )}
            </div>

            {!view.canMerge && conflict.remote !== null && (
              <p className="cloud-conflict-resolution-merge-note">
                Combining text is available only when both the device draft and
                observed Cloud version are Active.
              </p>
            )}

            {showEditableCombine && (
              <div className="cloud-conflict-resolution-combine">
                <div className="cloud-conflict-resolution-combine-header">
                  <label htmlFor={combineInputId}>Combined note text</label>
                </div>
                <textarea
                  id={combineInputId}
                  className="cloud-conflict-resolution-textarea"
                  value={combineValue}
                  disabled={actionInFlight}
                  rows={7}
                  onChange={(event) => {
                    setCopyOutcomes((prev) =>
                      prev.combined ? { ...prev, combined: null } : prev,
                    );
                    setCombineDraft({
                      text: event.target.value,
                      dirty: true,
                    });
                  }}
                />
                {combineOverLimit && (
                  <p
                    className="cloud-conflict-resolution-limit-error"
                    role="alert"
                  >
                    {BODY_LIMIT_ERROR_COPY}
                  </p>
                )}
              </div>
            )}

            {activeProposal && (
              <div
                className="cloud-conflict-resolution-confirm"
                data-destructive={isDestructiveProposal ? "true" : "false"}
                role="region"
                aria-labelledby={confirmHeadingId}
              >
                <h3 id={confirmHeadingId}>Confirm chosen version</h3>

                {activeProposal.kind === "local" &&
                  (conflict.local.kind === "purge" ? (
                    <p className="cloud-conflict-resolution-confirm-warning">
                      {`Destructive action: Confirming your device version queues permanent deletion of this note in Cloud against observed revision ${conflict.remoteRevision}. Once confirmed by Cloud, this note identity and its text cannot be restored.`}
                    </p>
                  ) : (
                    <>
                      <p className="cloud-conflict-resolution-confirm-detail">
                        {`Confirm keeping the full device version (Local state: ${lifecycleLabel(conflict.local.snapshot.state)}) and queueing it for Cloud upload in place of observed Cloud revision ${conflict.remoteRevision}.`}
                      </p>
                      {restoreTarget !== null && (
                        <>
                          <p className="cloud-conflict-resolution-confirm-warning">
                            {restoreTarget === "trashed"
                              ? `Observed Cloud revision ${conflict.remoteRevision} moved this note to Trash. Keeping your device version will restore it to ${lifecycleLabel(conflict.local.snapshot.state)} in Cloud.`
                              : `Observed Cloud revision ${conflict.remoteRevision} archived this note. Keeping your device version will restore it to Active in Cloud.`}
                          </p>
                          <label className="cloud-conflict-resolution-ack">
                            <input
                              type="checkbox"
                              checked={activeProposal.acknowledgedLifecycle}
                              disabled={actionInFlight}
                              onChange={(event) => {
                                const checked = event.target.checked;
                                setProposal((current) =>
                                  current
                                    ? {
                                        ...current,
                                        acknowledgedLifecycle: checked,
                                      }
                                    : null,
                                );
                              }}
                            />
                            <span>
                              {restoreTarget === "trashed"
                                ? "I understand this restores a note that was moved to Trash in the observed Cloud version."
                                : "I understand this restores a note that was archived in the observed Cloud version."}
                            </span>
                          </label>
                        </>
                      )}
                    </>
                  ))}

                {activeProposal.kind === "cloud" &&
                  (conflict.remote === null ? (
                    <p className="cloud-conflict-resolution-confirm-warning">
                      {`Destructive action: Confirming the observed Cloud version accepts permanent deletion (observed revision ${conflict.remoteRevision}) on this device without uploading to Cloud. Copy your draft text first if you need to save it in a new note.`}
                    </p>
                  ) : (
                    <p className="cloud-conflict-resolution-confirm-detail">
                      {`Confirm adopting the cached observed Cloud version (Observed Cloud state: ${lifecycleLabel(conflict.remote.state)}, revision ${conflict.remoteRevision}) on this device and discarding the unuploaded local draft. This adopts the cached observation without a new Cloud request.`}
                    </p>
                  ))}

                {activeProposal.kind === "merge" && (
                  <p className="cloud-conflict-resolution-confirm-detail">
                    {`Confirm queueing the combined Active note text above for Cloud upload against observed Cloud revision ${conflict.remoteRevision}.`}
                  </p>
                )}

                <div className="cloud-conflict-resolution-confirm-actions">
                  <button
                    type="button"
                    className="cloud-conflict-resolution-button"
                    data-variant={
                      isDestructiveProposal ? "destructive" : "primary"
                    }
                    data-busy={actionInFlight ? "true" : "false"}
                    disabled={
                      actionInFlight ||
                      (needsLifecycleAck &&
                        !activeProposal.acknowledgedLifecycle) ||
                      (activeProposal.kind === "merge" && combineOverLimit)
                    }
                    onClick={() => {
                      void handleConfirmResolution();
                    }}
                  >
                    Confirm resolution
                  </button>
                  <button
                    type="button"
                    className="cloud-conflict-resolution-button"
                    disabled={actionInFlight}
                    onClick={() => {
                      setProposal(null);
                    }}
                  >
                    Cancel choice
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {showPreservedReadonlyCombine && preservedCombineCard}
    </section>
  );
}
