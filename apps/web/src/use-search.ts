import { useEffect, useMemo, useRef, useState } from "react";
import type { Note, SearchOptions } from "@peel/core";
import type { SearchReply, SearchRequest } from "./search-protocol";

/** Each library owns its worker. Closing it discards private derived data. */
export function useSearch(
  notes: Note[],
  options: SearchOptions,
  limit: number,
) {
  const [attempt, setAttempt] = useState(0);
  const [reply, setReply] = useState<SearchReply | null>(null);
  const [error, setError] = useState("");
  const worker = useRef<Worker | null>(null);
  const posted = useRef(
    new Map<
      string,
      {
        revision: number;
        body: string;
        state: string;
        updatedAt: string;
        purgeAfter: string | null;
      }
    >(),
  );
  const sequence = useRef(0);
  const key = JSON.stringify(options);
  const request = useMemo(
    () => ++sequence.current,
    [notes, key, limit, attempt],
  );
  const latest = useRef(request);
  latest.current = request;
  useEffect(() => {
    posted.current.clear();
    setError("");
    let instance: Worker;
    try {
      instance = new Worker(new URL("./search.worker.ts", import.meta.url), {
        type: "module",
      });
      worker.current = instance;
      instance.onmessage = ({ data }: MessageEvent<SearchReply>) => {
        if (data.request !== latest.current) return;
        setReply(data);
        setError(data.error ?? "");
      };
      instance.onerror = (event) => {
        event.preventDefault();
        if (worker.current !== instance) return;
        setError("Search is unavailable. Retry to rebuild the local index.");
      };
      instance.onmessageerror = () => {
        if (worker.current === instance)
          setError("Search is unavailable. Retry to rebuild the local index.");
      };
    } catch {
      setError("Search is unavailable. Retry to rebuild the local index.");
    }
    return () => {
      instance?.terminate();
      worker.current = null;
      posted.current.clear();
    };
  }, [attempt]);
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const instance = worker.current;
    if (!instance) return;
    const send = (message: SearchRequest) => instance.postMessage(message);
    const current = new Set(notes.map((note) => note.noteId));
    const removed = [...posted.current.keys()].filter((id) => !current.has(id));
    for (const id of removed) posted.current.delete(id);
    send({ kind: "update", notes: [], removed });
    const changed = notes.filter((note) => {
      const old = posted.current.get(note.noteId);
      return (
        !old ||
        old.revision !== note.localRevision ||
        old.body !== note.bodyMarkdown ||
        old.state !== note.state ||
        old.updatedAt !== note.updatedAt ||
        old.purgeAfter !== note.purgeAfter
      );
    });
    let offset = 0;
    const batch = () => {
      if (cancelled) return;
      // Bound structured-clone work on the UI thread during a cold rebuild.
      const chunk: Note[] = [];
      let characters = 0;
      while (offset < changed.length && chunk.length < 128) {
        const note = changed[offset];
        if (chunk.length && characters + note.bodyMarkdown.length > 262144)
          break;
        chunk.push(note);
        characters += note.bodyMarkdown.length;
        offset++;
      }
      if (chunk.length) {
        send({ kind: "update", notes: chunk, removed: [] });
        for (const note of chunk)
          posted.current.set(note.noteId, {
            revision: note.localRevision,
            body: note.bodyMarkdown,
            state: note.state,
            updatedAt: note.updatedAt,
            purgeAfter: note.purgeAfter,
          });
      }
      if (offset < changed.length) timer = setTimeout(batch, 0);
      else send({ kind: "search", request, options: JSON.parse(key), limit });
    };
    batch();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [notes, key, limit, request, attempt]);
  const byId = useMemo(() => new Map(notes.map((n) => [n.noteId, n])), [notes]);
  return {
    results: (reply?.results ?? []).flatMap((row) => {
      const note = byId.get(row.noteId);
      return note ? [{ note, score: row.score, excerpt: row.excerpt }] : [];
    }),
    total: reply?.total ?? 0,
    tags: reply?.tags ?? [],
    pending: !error && reply?.request !== request,
    error,
    retry: () => setAttempt((x) => x + 1),
  };
}
