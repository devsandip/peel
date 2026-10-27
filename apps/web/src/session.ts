import { useCallback, useEffect, useRef, useState } from "react";
import { validateBody, type Note } from "@peel/core";
import { repository } from "@peel/storage";
import { registerDraft, draftsAreFrozen } from "./draft-registry";

export function useNoteSession(initial: Note) {
  const [note, setNote] = useState(initial),
    [status, setStatus] = useState("Saved on this device"),
    [error, setError] = useState(""),
    [frozen, setFrozen] = useState(false);
  const locks = useRef(new Set<string>());
  const freeze = useCallback((reason: string) => {
    locks.current.add(reason);
    setFrozen(true);
  }, []);
  const unfreeze = useCallback((reason: string) => {
    locks.current.delete(reason);
    setFrozen(locks.current.size > 0);
  }, []);
  const latest = useRef(initial),
    revision = useRef(initial.localRevision),
    dirty = useRef(false),
    running = useRef<Promise<void> | null>(null),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    everHadContent = useRef(initial.bodyMarkdown.length > 0);
  const flush = useCallback(async (): Promise<void> => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (running.current) {
      await running.current;
      if (dirty.current) return flush();
      return;
    }
    const task = (async () => {
      while (dirty.current) {
        const snapshot = { ...latest.current };
        dirty.current = false;
        setStatus("Saving");
        try {
          const saved = await repository.save(snapshot, revision.current);
          revision.current = saved.localRevision;
          latest.current = {
            ...latest.current,
            localRevision: saved.localRevision,
          };
          setNote(latest.current);
          setError("");
        } catch (error) {
          dirty.current = true;
          setStatus("Could not save");
          setError(String(error));
          throw error;
        }
      }
      setStatus("Saved on this device");
    })();
    running.current = task;
    try {
      await task;
    } finally {
      running.current = null;
    }
  }, []);
  const edit = useCallback(
    (body: string) => {
      if (locks.current.size || draftsAreFrozen()) return;
      try {
        validateBody(body);
      } catch (error) {
        setError(String(error));
        return;
      }
      latest.current = {
        ...latest.current,
        bodyMarkdown: body,
        updatedAt: new Date().toISOString(),
      };
      if (body.length) everHadContent.current = true;
      dirty.current = true;
      setNote(latest.current);
      setStatus("Saving");
      if (!timer.current)
        timer.current = setTimeout(() => {
          timer.current = null;
          void flush().catch(() => {});
        }, 50);
    },
    [flush],
  );
  const replace = useCallback(
    async (next: Note) => {
      await flush();
      if (locks.current.size || draftsAreFrozen())
        throw new Error(
          "Peel is finishing a storage operation. Retry this action afterward.",
        );
      latest.current = { ...next, localRevision: revision.current };
      dirty.current = true;
      await flush();
    },
    [flush],
  );
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") void flush().catch(() => {});
    };
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (dirty.current || running.current) {
        void flush().catch(() => {});
        event.preventDefault();
      }
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("beforeunload", beforeUnload);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [flush]);
  useEffect(
    () => registerDraft({ flush, freeze, unfreeze }),
    [flush, freeze, unfreeze],
  );
  return {
    note,
    status,
    error,
    setError,
    edit,
    flush,
    replace,
    current: () => latest.current,
    untouchedEmpty: () =>
      !everHadContent.current && latest.current.bodyMarkdown.length === 0,
    frozen,
    freeze,
    unfreeze,
    canEdit: () => locks.current.size === 0 && !draftsAreFrozen(),
  };
}
