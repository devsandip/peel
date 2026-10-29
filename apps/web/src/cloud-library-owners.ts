import {
  assertCloudScope,
  validateCloudNoteId,
  validateCloudScope,
} from "../../../packages/cloud-protocol/src/durable";
import type {
  CloudLibraryContext,
  CloudLibraryNoteSelection,
} from "./cloud-cached-library";
import type { CloudDraftSession } from "./cloud-draft-session";
import { CloudNoteUpload, type CloudMutationSender } from "./cloud-note-upload";
import type { CloudWorkspacePutAway } from "./cloud-workspace";

type Entry = {
  upload: CloudNoteUpload;
  abort: AbortController;
  unsubscribe: () => void;
  viewClosed: boolean;
  capture: boolean;
  inspected: CloudDraftSession | null;
};
type Opening = { intent: number; task: Promise<CloudNoteUpload> };
const unavailable = () => Error("Could not open this Cloud note");

/** One workspace/account context. The authenticated parent owns storage and recovery. */
export class CloudLibraryOwners {
  readonly context: CloudLibraryContext;
  private entries = new Map<string, Entry>();
  private opening = new Map<string, Opening>();
  private pendingAborts = new Set<AbortController>();
  private acknowledged = new WeakMap<CloudDraftSession, CloudNoteUpload>();
  private intent = 0;
  private view: Readonly<{ refreshKey: number }> = Object.freeze({
    refreshKey: 0,
  });
  private listeners = new Set<() => void>();
  constructor(
    context: CloudLibraryContext,
    private send: CloudMutationSender,
    readonly signal: AbortSignal,
  ) {
    this.context = Object.freeze({
      store: context.store,
      scope: Object.freeze(validateCloudScope(context.scope)),
    });
    const abort = () => {
      this.intent++;
      for (const entry of this.entries.values()) entry.abort.abort();
      for (const candidate of this.pendingAborts) candidate.abort();
      // Keep even failed local retention reachable for the parent's recovery/copy flow.
      this.publish();
    };
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  }
  snapshot = () => this.view;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  retainedOwners() {
    return Object.freeze(
      [...this.entries.values()].map((entry) => entry.upload),
    );
  }
  private publish() {
    this.view = Object.freeze({ refreshKey: this.view.refreshKey + 1 });
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        /* Catalog observers cannot change owner lifetime. */
      }
    }
  }
  private validate(context: CloudLibraryContext) {
    try {
      this.signal.throwIfAborted();
      if (context.store !== this.context.store) throw unavailable();
      assertCloudScope(context.scope, this.context.scope);
    } catch {
      throw unavailable();
    }
  }
  private register(
    upload: CloudNoteUpload,
    abort: AbortController,
    capture: boolean,
  ) {
    const noteId = upload.session.snapshot().noteId;
    if (this.entries.has(noteId)) {
      abort.abort();
      throw unavailable();
    }
    const entry: Entry = {
      upload,
      abort,
      capture,
      viewClosed: false,
      inspected: null,
      unsubscribe: () => {},
    };
    this.entries.set(noteId, entry);
    entry.unsubscribe = upload.subscribe(() => {
      this.retire(entry);
      this.publish();
    });
    this.publish();
    return entry;
  }
  private release(entry: Entry) {
    const noteId = entry.upload.session.snapshot().noteId;
    if (this.entries.get(noteId) !== entry) return;
    // Idle notifications can precede task.finally and a queued timer. Revoke first.
    entry.abort.abort();
    entry.unsubscribe();
    this.entries.delete(noteId);
    this.publish();
  }
  private retire(entry: Entry) {
    const session = entry.upload.session,
      state = session.snapshot();
    if (
      this.signal.aborted ||
      !entry.viewClosed ||
      this.opening.has(state.noteId) ||
      !state.closed ||
      !state.retained ||
      state.error ||
      this.entries.get(state.noteId) !== entry
    )
      return;
    if (state.status === "Saved in Cloud") {
      this.release(entry);
    } else if (
      entry.capture &&
      state.bodyMarkdown === "" &&
      entry.inspected !== session
    ) {
      entry.inspected = session;
      void this.context.store.read(this.context.scope, state.noteId).then(
        (stored) => {
          const current = session.snapshot();
          if (
            stored === null &&
            !this.signal.aborted &&
            entry.viewClosed &&
            entry.upload.session === session &&
            current.closed &&
            current.retained &&
            !current.error &&
            !this.opening.has(state.noteId)
          )
            this.release(entry);
        },
        () => {
          /* Uncertain storage stays retained; no automatic read retry. */
        },
      );
    }
  }
  create = (context: CloudLibraryContext): CloudNoteUpload => {
    this.validate(context);
    this.intent++;
    const abort = new AbortController(),
      upload = CloudNoteUpload.capture(
        this.context.store,
        this.context.scope,
        this.send,
        AbortSignal.any([this.signal, abort.signal]),
      );
    this.register(upload, abort, true);
    return upload;
  };
  open = (selection: CloudLibraryNoteSelection): Promise<CloudNoteUpload> => {
    let noteId: string;
    try {
      this.validate(selection);
      noteId = selection.noteId;
      validateCloudNoteId(noteId);
    } catch {
      return Promise.reject(unavailable());
    }
    const intent = ++this.intent,
      pending = this.opening.get(noteId);
    if (pending) {
      pending.intent = intent;
      return pending.task;
    }
    const existing = this.entries.get(noteId),
      abort = existing?.abort ?? new AbortController(),
      slot = {} as Opening;
    slot.intent = intent;
    this.pendingAborts.add(abort);
    slot.task = Promise.resolve()
      .then(async () => {
        this.signal.throwIfAborted();
        const upload = existing
          ? existing.upload.session.snapshot().closed
            ? await existing.upload.reopen()
            : existing.upload
          : await CloudNoteUpload.open(
              this.context.store,
              this.context.scope,
              noteId,
              this.send,
              AbortSignal.any([this.signal, abort.signal]),
            );
        if (this.signal.aborted || slot.intent !== this.intent) {
          if (existing && !upload.session.snapshot().closed)
            await upload.session.putAway();
          throw unavailable();
        }
        const entry = existing ?? this.register(upload, abort, false);
        entry.viewClosed = false;
        return upload;
      })
      .catch(() => {
        if (!existing) abort.abort();
        throw unavailable();
      })
      .finally(() => {
        this.pendingAborts.delete(abort);
        this.opening.delete(noteId);
        if (existing) this.retire(existing);
        this.publish();
      });
    this.opening.set(noteId, slot);
    return slot.task;
  };
  putAway = (closed: CloudWorkspacePutAway): void => {
    // A late old-context acknowledgement must not reach any later context.
    this.validate(closed.context);
    if (this.acknowledged.get(closed.session) === closed.upload) return;
    const session = closed.session,
      state = session.snapshot(),
      entry = this.entries.get(state.noteId);
    if (
      !entry ||
      entry.upload !== closed.upload ||
      entry.upload.session !== session ||
      !state.closed ||
      !state.retained ||
      state.error
    )
      throw Error("Could not put away this Cloud note");
    this.acknowledged.set(session, closed.upload);
    entry.viewClosed = true;
    this.retire(entry);
    this.publish();
  };
}
