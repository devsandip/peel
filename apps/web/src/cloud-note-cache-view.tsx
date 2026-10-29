import { useEffect, useMemo, useState } from "react";
import {
  DurableCloudClient,
  validateCloudNoteId,
  validateCloudScope,
  type CloudScope,
  type CloudStateStore,
} from "../../../packages/cloud-protocol/src/durable";
import { projectCloudCachedNote } from "./cloud-note-cache";

type Props = {
  store: CloudStateStore;
  scope: CloudScope;
  noteId: string;
  refreshKey: number;
};
function capture(scope: CloudScope, noteId: string, refreshKey: number) {
  try {
    const selected = validateCloudScope(scope);
    validateCloudNoteId(noteId);
    if (!Number.isSafeInteger(refreshKey) || refreshKey < 0) return null;
    return { scope: selected, noteId, refreshKey };
  } catch {
    return null;
  }
}

/** Explicit scoped cache only; no Local repository, transport or Cloud activation. */
export function CloudNoteCacheView({
  store,
  scope,
  noteId,
  refreshKey,
}: Props) {
  // Capture values every render, including when a caller mutates its scope object.
  const captured = capture(scope, noteId, refreshKey),
    key = captured ? JSON.stringify(captured) : null;
  const selection = useMemo(
    () =>
      captured
        ? {
            client: new DurableCloudClient(store, captured.scope),
            scope: captured.scope,
            noteId: captured.noteId,
          }
        : null,
    [store, key],
  );
  const [loaded, setLoaded] = useState<{
    selection: NonNullable<typeof selection>;
    view: ReturnType<typeof projectCloudCachedNote> | null;
  } | null>(null);
  useEffect(() => {
    if (!selection) return;
    let active = true;
    void Promise.resolve()
      .then(() => selection.client.get(selection.noteId))
      .then((state) =>
        projectCloudCachedNote(selection.scope, selection.noteId, state),
      )
      .then(
        (view) => {
          if (active) setLoaded({ selection, view });
        },
        () => {
          if (active) setLoaded({ selection, view: null });
        },
      );
    return () => {
      active = false;
    };
  }, [selection]);
  // Effects run after render. Never flash the previous account/note while loading.
  const visible = loaded?.selection === selection ? loaded : null;
  const unavailable = !selection || (visible && !visible.view);
  const view = unavailable ? null : visible?.view;
  return (
    <article aria-label="Cloud note" aria-busy={!unavailable && !view}>
      <p role="status" aria-live="polite">
        {unavailable
          ? "Cloud note unavailable"
          : (view?.status ?? "Loading Cloud note")}
      </p>
      {view?.bodyMarkdown !== null && view?.bodyMarkdown !== undefined && (
        <>
          <h2>{view.title}</h2>
          <div
            role="region"
            aria-label="Cached note text"
            style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
          >
            {view.bodyMarkdown}
          </div>
        </>
      )}
    </article>
  );
}
