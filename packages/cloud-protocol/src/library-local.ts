import { titleOf } from "../../core/src/index";
import type { CloudClientState } from "./index";
import {
  assertCloudScope,
  cloudStateInScope,
  validateCloudNoteId,
  validateCloudScope,
  type CloudScope,
  type CloudStateStore,
} from "./durable";
import { validatePullProgress, type CloudPullProgress } from "./pull-local";

export type CloudLibraryCollection =
  "notes" | "archive" | "trash" | "attention";
export type CloudLibraryEntry = Readonly<{
  noteId: string;
  title: string | null;
  updatedAt: string | null;
  kind: "active" | "archived" | "trashed" | "recovery" | "purged" | "missing";
  status:
    | "Pending upload"
    | "Saved in Cloud"
    | "Conflict"
    | "Deleted in Cloud"
    | "No cached Cloud note";
}>;
export type CloudLibraryCursor = {
  scope: CloudScope;
  collection: CloudLibraryCollection;
  updatedAt: string | null;
  noteId: string;
};
export type CloudLibraryRequest = {
  collection: CloudLibraryCollection;
  limit: number;
  cursor: CloudLibraryCursor | null;
};
export type CloudLibraryPage = {
  version: 1;
  scope: CloudScope;
  collection: CloudLibraryCollection;
  entries: CloudLibraryEntry[];
  next: CloudLibraryCursor | null;
  pull: CloudPullProgress | null;
};
export interface CloudLibraryStateStore extends CloudStateStore {
  listLibrary(
    scope: CloudScope,
    request: CloudLibraryRequest,
  ): Promise<CloudLibraryPage>;
}
const fields = (value: object, keys: string[]) => {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  )
    throw Error("Invalid cached Cloud library data");
};
const date = (value: unknown) =>
  value === null ||
  (typeof value === "string" &&
    value.length <= 64 &&
    Number.isFinite(Date.parse(value)));
const collections = ["notes", "archive", "trash", "attention"];
export function compareCloudLibraryEntries(
  a: Pick<CloudLibraryEntry, "updatedAt" | "noteId">,
  b: Pick<CloudLibraryEntry, "updatedAt" | "noteId">,
) {
  const at = a.updatedAt === null ? -Infinity : Date.parse(a.updatedAt),
    bt = b.updatedAt === null ? -Infinity : Date.parse(b.updatedAt);
  return at !== bt
    ? at > bt
      ? -1
      : 1
    : a.noteId === b.noteId
      ? 0
      : a.noteId < b.noteId
        ? -1
        : 1;
}
export function validateCloudLibraryRequest(
  inputScope: CloudScope,
  input: CloudLibraryRequest,
) {
  const scope = validateCloudScope(inputScope),
    request = structuredClone(input);
  fields(request, ["collection", "limit", "cursor"]);
  if (
    !collections.includes(request.collection) ||
    !Number.isSafeInteger(request.limit) ||
    request.limit < 1 ||
    request.limit > 32
  )
    throw Error("Invalid cached Cloud library request");
  if (request.cursor !== null) {
    const cursor = request.cursor;
    fields(cursor, ["scope", "collection", "updatedAt", "noteId"]);
    assertCloudScope(validateCloudScope(cursor.scope), scope);
    validateCloudNoteId(cursor.noteId);
    if (cursor.collection !== request.collection || !date(cursor.updatedAt))
      throw Error("Foreign cached Cloud cursor");
  }
  return { scope, request };
}
function belongs(entry: CloudLibraryEntry, collection: CloudLibraryCollection) {
  return collection === "attention"
    ? entry.kind === "recovery" || entry.status === "Conflict"
    : entry.kind ===
        ({ notes: "active", archive: "archived", trash: "trashed" } as const)[
          collection
        ];
}
function entryOf(
  scope: CloudScope,
  noteId: string,
  input: CloudClientState,
): CloudLibraryEntry {
  const state = cloudStateInScope(scope, noteId, input),
    draft = state.current?.snapshot;
  let kind: CloudLibraryEntry["kind"] =
    draft?.state ?? (state.current?.kind === "purge" ? "purged" : "missing");
  if (
    draft &&
    ((state.conflict &&
      (!state.conflict.remote ||
        (state.conflict.remote.state === "trashed" &&
          draft.state !== "trashed"))) ||
      (state.observed &&
        (!state.observed.snapshot ||
          (state.observed.snapshot.state === "trashed" &&
            draft.state !== "trashed"))))
  )
    kind = "recovery";
  const status = !state.current
    ? "No cached Cloud note"
    : state.conflict
      ? "Conflict"
      : state.pending || state.inFlight || state.baseRevision === 0
        ? "Pending upload"
        : state.current.kind === "purge"
          ? "Deleted in Cloud"
          : "Saved in Cloud";
  return Object.freeze({
    noteId,
    title: draft && kind !== "recovery" ? titleOf(draft.bodyMarkdown) : null,
    updatedAt: draft?.updatedAt ?? state.base?.updatedAt ?? null,
    kind,
    status,
  });
}

/** One-pass M0 catalog; retains at most limit+1 metadata entries and no bodies. */
export class CloudLibraryPageBuilder {
  readonly scope: CloudScope;
  readonly request: CloudLibraryRequest;
  private entries: CloudLibraryEntry[] = [];
  constructor(scope: CloudScope, request: CloudLibraryRequest) {
    ({ scope: this.scope, request: this.request } = validateCloudLibraryRequest(
      scope,
      request,
    ));
  }
  add(noteId: string, state: CloudClientState) {
    const entry = entryOf(this.scope, noteId, state);
    if (
      !belongs(entry, this.request.collection) ||
      (this.request.cursor &&
        compareCloudLibraryEntries(entry, this.request.cursor) <= 0)
    )
      return;
    this.entries.push(entry);
    this.entries.sort(compareCloudLibraryEntries);
    if (this.entries.length > this.request.limit + 1) this.entries.pop();
  }
  finish(pull: CloudPullProgress | null): CloudLibraryPage {
    const entries = this.entries.slice(0, this.request.limit),
      last = entries.at(-1);
    return {
      version: 1,
      scope: structuredClone(this.scope),
      collection: this.request.collection,
      entries,
      next:
        this.entries.length > this.request.limit && last
          ? {
              scope: structuredClone(this.scope),
              collection: this.request.collection,
              updatedAt: last.updatedAt,
              noteId: last.noteId,
            }
          : null,
      pull: pull === null ? null : validatePullProgress(pull),
    };
  }
}

/** Metadata integrity only. Neither this page nor its cursor grants authentication. */
export function validateCloudLibraryPage(
  scope: CloudScope,
  request: CloudLibraryRequest,
  input: CloudLibraryPage,
) {
  const checked = validateCloudLibraryRequest(scope, request),
    page = structuredClone(input);
  fields(page, ["version", "scope", "collection", "entries", "next", "pull"]);
  assertCloudScope(validateCloudScope(page.scope), checked.scope);
  if (
    page.version !== 1 ||
    page.collection !== checked.request.collection ||
    !Array.isArray(page.entries) ||
    page.entries.length > checked.request.limit
  )
    throw Error("Invalid cached Cloud library page");
  let previous: Pick<CloudLibraryEntry, "updatedAt" | "noteId"> | null =
    checked.request.cursor;
  const ids = new Set<string>();
  for (const entry of page.entries) {
    fields(entry, ["noteId", "title", "updatedAt", "kind", "status"]);
    validateCloudNoteId(entry.noteId);
    if (
      !date(entry.updatedAt) ||
      ![
        "active",
        "archived",
        "trashed",
        "recovery",
        "purged",
        "missing",
      ].includes(entry.kind) ||
      ![
        "Pending upload",
        "Saved in Cloud",
        "Conflict",
        "Deleted in Cloud",
        "No cached Cloud note",
      ].includes(entry.status) ||
      (entry.title !== null &&
        (typeof entry.title !== "string" ||
          entry.title.length > 320 ||
          /[\r\n]/.test(entry.title))) ||
      (["recovery", "purged", "missing"].includes(entry.kind)
        ? entry.title !== null
        : entry.title === null) ||
      (entry.kind === "missing") !==
        (entry.status === "No cached Cloud note") ||
      (entry.status === "Deleted in Cloud" && entry.kind !== "purged") ||
      (entry.status === "Saved in Cloud" &&
        ["recovery", "purged", "missing"].includes(entry.kind)) ||
      !belongs(entry, page.collection) ||
      ids.has(entry.noteId) ||
      (previous && compareCloudLibraryEntries(previous, entry) >= 0)
    )
      throw Error("Invalid cached Cloud library entry");
    ids.add(entry.noteId);
    previous = entry;
  }
  if (page.next !== null) {
    validateCloudLibraryRequest(checked.scope, {
      ...checked.request,
      cursor: page.next,
    });
    const last = page.entries.at(-1);
    if (
      page.entries.length !== checked.request.limit ||
      !last ||
      page.next.noteId !== last.noteId ||
      page.next.updatedAt !== last.updatedAt
    )
      throw Error("Invalid cached Cloud library continuation");
  }
  if (page.pull !== null) page.pull = validatePullProgress(page.pull);
  return page;
}
