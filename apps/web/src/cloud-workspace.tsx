import {
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
  validateCloudScope,
  type CloudScope,
} from "../../../packages/cloud-protocol/src/durable";
import type { CloudLibraryStateStore } from "../../../packages/cloud-protocol/src/library-local";
import {
  CloudCachedLibrary,
  type CloudLibraryContext,
  type CloudLibraryNoteSelection,
} from "./cloud-cached-library";
import type { CloudDraftSession } from "./cloud-draft-session";
import type { CloudNoteUpload } from "./cloud-note-upload";
import { CloudUploadingNoteEditor } from "./cloud-uploading-note-editor";

export type CloudWorkspacePutAway = Readonly<{
  context: CloudLibraryContext;
  upload: CloudNoteUpload;
  session: CloudDraftSession;
}>;

export type CloudWorkspaceProps = {
  context: CloudLibraryContext;
  signal: AbortSignal;
  refreshKey: number;
  onOpen: (
    selection: CloudLibraryNoteSelection,
  ) => CloudNoteUpload | Promise<CloudNoteUpload>;
  onCreate: (
    context: CloudLibraryContext,
  ) => CloudNoteUpload | Promise<CloudNoteUpload>;
  onPutAway?: (closed: CloudWorkspacePutAway) => void | Promise<void>;
};

type ActiveEditor = Readonly<{
  context: CloudLibraryContext;
  upload: CloudNoteUpload;
  origin: "open" | "create";
}>;

type ReturnFocusTarget =
  Readonly<{ kind: "new" }> | Readonly<{ kind: "card"; title: string }>;

const NARROW_QUERY = "(max-width: 820px)";

function readIsNarrow() {
  return typeof window !== "undefined" &&
    typeof window.matchMedia === "function"
    ? window.matchMedia(NARROW_QUERY).matches
    : false;
}

function captureStore(
  context: CloudLibraryContext | null | undefined,
): CloudLibraryStateStore | null {
  const store = context?.store;
  if (
    !store ||
    typeof store.read !== "function" ||
    typeof store.commit !== "function" ||
    typeof store.close !== "function" ||
    typeof store.listLibrary !== "function"
  ) {
    return null;
  }
  return store;
}

function captureScope(scope: CloudScope | null | undefined): CloudScope | null {
  if (!scope) return null;
  try {
    return validateCloudScope(scope);
  } catch {
    return null;
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

/** Explicit scoped composition only; neither this workspace nor its callbacks grant Cloud auth. */
export function CloudWorkspace(props: CloudWorkspaceProps) {
  const store = captureStore(props.context),
    scope = store ? captureScope(props.context.scope) : null,
    key = scope ? JSON.stringify(scope) : null,
    [selected, setSelected] = useState({
      store,
      signal: props.signal,
      scope,
      key,
      serial: 0,
    });
  if (
    selected.store !== store ||
    selected.signal !== props.signal ||
    selected.key !== key
  ) {
    setSelected({
      store,
      signal: props.signal,
      scope,
      key,
      serial: selected.serial + 1,
    });
    return null;
  }
  if (!selected.store || !selected.scope) {
    return (
      <div className="cloud-workspace" data-editor-open="false">
        <p className="cloud-workspace-unavailable" role="alert">
          Cached Cloud library unavailable
        </p>
      </div>
    );
  }
  return (
    <SelectedWorkspace
      key={selected.serial}
      {...props}
      store={selected.store}
      scope={selected.scope}
    />
  );
}

function SelectedWorkspace({
  store,
  scope,
  signal,
  refreshKey,
  onOpen,
  onCreate,
  onPutAway,
}: CloudWorkspaceProps & {
  store: CloudLibraryStateStore;
  scope: CloudScope;
}) {
  const scopeKey = useMemo(() => JSON.stringify(scope), [scope]);
  const workspaceContext = useMemo<CloudLibraryContext>(
    () => Object.freeze({ store, scope: Object.freeze({ ...scope }) }),
    [store, scope],
  );
  const [aborted, setAborted] = useState(() => signal.aborted),
    [isNarrow, setIsNarrow] = useState(readIsNarrow),
    [localRefresh, setLocalRefresh] = useState(0),
    [activeEditor, setActiveEditor] = useState<ActiveEditor | null>(null),
    [workspaceIssue, setWorkspaceIssue] = useState<string | null>(null),
    [returnFocus, setReturnFocus] = useState<ReturnFocusTarget | null>(null);

  const mounted = useRef(false),
    transitioning = useRef(false),
    latestRequest = useRef(0),
    activeEditorRef = useRef<ActiveEditor | null>(null),
    desiredCardTitleRef = useRef<string | null>(null),
    provisionalFocusRef = useRef(false),
    provisionalButtonRef = useRef<HTMLButtonElement | null>(null),
    libraryPaneRef = useRef<HTMLDivElement>(null),
    editorPaneRef = useRef<HTMLDivElement>(null);

  activeEditorRef.current = activeEditor;

  const validRefreshKey = Number.isSafeInteger(refreshKey) && refreshKey >= 0;
  const usable = !aborted && !signal.aborted && validRefreshKey;
  const visibleEditor = usable ? activeEditor : null;

  useLayoutEffect(() => {
    mounted.current = true;
    const handleAbort = () => {
      latestRequest.current++;
      activeEditorRef.current = null;
      desiredCardTitleRef.current = null;
      provisionalButtonRef.current = null;
      setAborted(true);
      setActiveEditor(null);
      setWorkspaceIssue(null);
      setReturnFocus(null);
    };
    if (signal.aborted) {
      handleAbort();
    } else {
      signal.addEventListener("abort", handleAbort, { once: true });
    }
    return () => {
      mounted.current = false;
      signal.removeEventListener("abort", handleAbort);
    };
  }, [signal]);

  useEffect(() => {
    if (!validRefreshKey) {
      latestRequest.current++;
      activeEditorRef.current = null;
      desiredCardTitleRef.current = null;
      provisionalButtonRef.current = null;
      setActiveEditor(null);
      setWorkspaceIssue(null);
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
    editorPaneRef.current
      ?.querySelector<HTMLElement>('[role="textbox"]')
      ?.focus();
  };

  useEffect(() => {
    if (
      isNarrow &&
      visibleEditor &&
      typeof document !== "undefined" &&
      libraryPaneRef.current?.contains(document.activeElement)
    ) {
      focusOpenEditor();
    }
  }, [isNarrow, visibleEditor]);

  useEffect(() => {
    if (!usable || visibleEditor || typeof document === "undefined") {
      return;
    }
    const libraryEl = libraryPaneRef.current;
    if (!libraryEl) {
      if (returnFocus) setReturnFocus(null);
      return;
    }
    const findNewButton = () =>
      Array.from(libraryEl.querySelectorAll<HTMLButtonElement>("button")).find(
        (btn) => btn.textContent?.trim() === "New note" && !btn.disabled,
      ) ?? null;

    const focusNewButton = (provisional: boolean) => {
      const btn = findNewButton();
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
      focusNewButton(false);
      setReturnFocus(null);
      return;
    }

    if (returnFocus?.kind === "card") {
      desiredCardTitleRef.current = returnFocus.title;
    }

    const targetTitle = desiredCardTitleRef.current;
    if (!targetTitle) {
      return;
    }

    if (!document.activeElement || document.activeElement === document.body) {
      focusNewButton(true);
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
        const cardButton = Array.from(
          section.querySelectorAll<HTMLButtonElement>(
            ".note-grid button.card-open",
          ),
        ).find((btn) => btn.getAttribute("aria-label") === expectedLabel);
        if (cardButton) {
          provisionalButtonRef.current = null;
          cardButton.focus();
        } else {
          desiredCardTitleRef.current = null;
          focusNewButton(false);
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
  }, [usable, visibleEditor, returnFocus, effectiveRefreshKey]);

  const matchesWorkspaceContext = (candidate: CloudLibraryContext) => {
    if (!candidate || candidate.store !== store) return false;
    const candidateScope = captureScope(candidate.scope);
    return (
      candidateScope !== null && JSON.stringify(candidateScope) === scopeKey
    );
  };

  const closeActiveBeforeSwitch = async (): Promise<boolean> => {
    const current = activeEditorRef.current;
    if (!current) return true;
    const initialSnap = current.upload.session.snapshot();
    if (!initialSnap.canEdit && !initialSnap.closed) return false;
    transitioning.current = true;
    try {
      await current.upload.session.flush();
      if (
        !mounted.current ||
        signal.aborted ||
        activeEditorRef.current?.upload !== current.upload
      ) {
        return false;
      }
      await current.upload.session.putAway();
      if (
        !mounted.current ||
        signal.aborted ||
        activeEditorRef.current?.upload !== current.upload
      ) {
        return false;
      }
      void current.upload.upload();
      if (onPutAway) {
        try {
          await onPutAway(
            Object.freeze({
              context: current.context,
              upload: current.upload,
              session: current.upload.session,
            }),
          );
        } catch {
          if (
            mounted.current &&
            !signal.aborted &&
            activeEditorRef.current?.upload === current.upload
          ) {
            setWorkspaceIssue(
              "Could not put away this note. Retry or copy the text.",
            );
          }
          return false;
        }
      }
      if (
        !mounted.current ||
        signal.aborted ||
        activeEditorRef.current?.upload !== current.upload
      ) {
        return false;
      }
      activeEditorRef.current = null;
      setActiveEditor(null);
      setLocalRefresh((previous) => previous + 1);
      return true;
    } catch {
      focusOpenEditor();
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
      const next: ActiveEditor = Object.freeze({
        context: workspaceContext,
        upload,
        origin: "open",
      });
      activeEditorRef.current = next;
      desiredCardTitleRef.current = null;
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
      const next: ActiveEditor = Object.freeze({
        context: workspaceContext,
        upload,
        origin: "create",
      });
      activeEditorRef.current = next;
      desiredCardTitleRef.current = null;
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

  const handleEditorPutAway = async (
    entry: ActiveEditor,
    session: CloudDraftSession,
  ) => {
    if (
      !mounted.current ||
      signal.aborted ||
      activeEditorRef.current?.upload !== entry.upload ||
      entry.upload.session !== session
    ) {
      return;
    }
    const snapshot = session.snapshot();
    const focusTarget: ReturnFocusTarget =
      snapshot.bodyMarkdown.length > 0 || entry.origin === "open"
        ? { kind: "card", title: titleOf(snapshot.bodyMarkdown) }
        : { kind: "new" };
    if (onPutAway) {
      await onPutAway(
        Object.freeze({
          context: entry.context,
          upload: entry.upload,
          session,
        }),
      );
    }
    if (
      !mounted.current ||
      signal.aborted ||
      activeEditorRef.current?.upload !== entry.upload
    ) {
      return;
    }
    latestRequest.current++;
    activeEditorRef.current = null;
    desiredCardTitleRef.current =
      focusTarget.kind === "card" ? focusTarget.title : null;
    setWorkspaceIssue(null);
    setReturnFocus(focusTarget);
    setActiveEditor(null);
    setLocalRefresh((previous) => previous + 1);
  };

  const handleLibraryFocusCapture = (event: FocusEvent<HTMLDivElement>) => {
    if (provisionalFocusRef.current) return;
    provisionalButtonRef.current = null;
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

  return (
    <div
      className="cloud-workspace"
      data-editor-open={visibleEditor ? "true" : "false"}
    >
      <div
        ref={libraryPaneRef}
        className="cloud-workspace-library"
        inert={isNarrow && visibleEditor !== null}
        onFocusCapture={handleLibraryFocusCapture}
        onBlurCapture={handleLibraryBlurCapture}
      >
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
        />
      </div>
      {visibleEditor && (
        <div
          ref={editorPaneRef}
          className="cloud-workspace-editor"
          onFocusCapture={() => {
            desiredCardTitleRef.current = null;
            provisionalButtonRef.current = null;
          }}
        >
          <CloudUploadingNoteEditor
            upload={visibleEditor.upload}
            onPutAway={(session) => handleEditorPutAway(visibleEditor, session)}
          />
        </div>
      )}
    </div>
  );
}
