import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { titleOf } from "../../../packages/core/src/index";
import type { CloudDraftSession } from "./cloud-draft-session";
import { MarkdownEditor } from "./editor";

type Props = {
  session: CloudDraftSession;
  refreshKey: number;
  onPutAway: (session: CloudDraftSession) => void | Promise<void>;
  source?: boolean;
};

/** Explicit scoped composition only; never activates Cloud or opens Local storage. */
export function CloudNoteEditor(props: Props) {
  const [selected, setSelected] = useState({ session: props.session, key: 0 });
  if (selected.session !== props.session) {
    setSelected({ session: props.session, key: selected.key + 1 });
    return null;
  }
  if (!Number.isSafeInteger(props.refreshKey) || props.refreshKey < 0)
    return <p role="alert">Cloud note unavailable</p>;
  // Remount CodeMirror on every session change, including its private undo history.
  return <SelectedEditor key={selected.key} {...props} />;
}

function SelectedEditor({
  session,
  refreshKey,
  onPutAway,
  source = false,
}: Props) {
  const [view, setView] = useState(() => session.snapshot()),
    [closing, setClosing] = useState(false),
    [issue, setIssue] = useState<string | null>(null),
    [copyResult, setCopyResult] = useState("");
  const active = useRef(false),
    busy = useRef(false);
  useLayoutEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const sync = () => {
    if (active.current) setView(session.snapshot());
  };
  useEffect(() => {
    let current = true;
    void session.refresh().then(() => {
      if (current) sync();
    });
    return () => {
      current = false;
    };
  }, [session, refreshKey]);
  const edit = (body: string) => {
    if (!active.current) return;
    try {
      session.edit(body);
      setIssue(null);
      setCopyResult("");
      sync();
      void session.flush().then(sync, sync);
    } catch {
      if (active.current)
        setIssue("Could not edit this draft. Copy the text before reopening.");
    }
  };
  const putAway = async () => {
    if (busy.current) return;
    busy.current = true;
    setClosing(true);
    setIssue(null);
    try {
      const pending = session.putAway();
      sync();
      await pending;
      if (!active.current) return;
      sync();
      await onPutAway(session);
    } catch {
      if (active.current && session.snapshot().closed)
        setIssue("Could not put away this note. Retry or copy the text.");
      sync();
    } finally {
      busy.current = false;
      if (active.current) {
        setClosing(false);
        sync();
      }
    }
  };
  const retry = async () => {
    if (session.snapshot().closed) return putAway();
    try {
      await session.flush();
      if (active.current) setIssue(null);
    } catch {
      /* Session exposes only its generic recovery state. */
    }
    sync();
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(session.snapshot().bodyMarkdown);
      if (active.current) setCopyResult("Text copied.");
    } catch {
      if (active.current)
        setCopyResult("Could not copy. Select the note text to copy it.");
    }
  };
  const error = issue ?? view.error;
  return (
    <article
      className="note-window"
      aria-label="Cloud note editor"
      aria-busy={closing}
      onKeyDown={(event) => {
        if (
          (event.metaKey || event.ctrlKey) &&
          event.key.toLowerCase() === "w"
        ) {
          event.preventDefault();
          event.stopPropagation();
          void putAway();
        }
      }}
    >
      <header className="note-titlebar">
        <button
          className="note-close"
          aria-label="Put away note"
          title="Put away note"
          disabled={closing}
          onClick={() => void putAway()}
        >
          <span>−</span>
        </button>
        <span>{titleOf(view.bodyMarkdown)}</span>
      </header>
      {error && (
        <div className="note-notice" role="alert">
          <p>{error}</p>
          <button disabled={closing} onClick={() => void retry()}>
            Retry
          </button>
          <button onClick={() => void copy()}>Copy text</button>
          <span aria-live="polite">{copyResult}</span>
        </div>
      )}
      <MarkdownEditor
        value={view.bodyMarkdown}
        onChange={edit}
        onError={(message) => {
          if (active.current) setIssue(message);
        }}
        source={source}
        readOnly={closing || !view.canEdit}
        canEdit={() =>
          active.current && !busy.current && session.snapshot().canEdit
        }
      />
      <footer className="note-status">
        <span role="status" aria-live="polite">
          {closing && !view.retained ? "Retaining draft" : view.status}
        </span>
        <span>Cloud storage</span>
      </footer>
    </article>
  );
}
