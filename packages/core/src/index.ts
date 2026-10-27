import { caseFolds } from "./unicode-case-fold";

export const MAX_NOTE_BYTES = 256 * 1024;
export const TRASH_DAYS = 30;
export type NoteState = "active" | "archived" | "trashed";
export interface Note {
  schemaVersion: 1;
  collectionId: string;
  noteId: string;
  bodyMarkdown: string;
  state: NoteState;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  purgeAfter: string | null;
  serverRevision: number | null;
  localRevision: number;
  origin?: { collectionId: string; noteId: string; moveId: string };
}
export interface Placement {
  noteId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  pinned: boolean;
  alwaysOnTop: boolean;
  displayId?: string;
}
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export type Edge = "left" | "right" | "top" | "bottom";
export const byteLength = (text: string) =>
  new TextEncoder().encode(text).length;
export const fold = (text: string) =>
  /^[\x00-\x7f]*$/.test(text)
    ? text.toLowerCase()
    : Array.from(text.normalize("NFC"), (c) => caseFolds[c] ?? c)
        .join("")
        .normalize("NFC");
export function validateBody(body: string): void {
  if (typeof body !== "string") throw new Error("The note must contain text.");
  if (byteLength(body) > MAX_NOTE_BYTES)
    throw new Error(
      "This note has reached its 256 KiB limit. Copy the extra text into a new note.",
    );
}
export function validateNote(value: unknown): Note {
  if (!value || typeof value !== "object") throw new Error("Invalid note.");
  const n = value as Note;
  if (n.schemaVersion !== 1)
    throw new Error("This note needs a newer version of Peel.");
  if (
    typeof n.noteId !== "string" ||
    !/^[a-zA-Z0-9-]{1,128}$/.test(n.noteId) ||
    typeof n.collectionId !== "string" ||
    !["active", "archived", "trashed"].includes(n.state)
  )
    throw new Error("Invalid note metadata.");
  if (
    ![n.createdAt, n.updatedAt].every(
      (x) => typeof x === "string" && Number.isFinite(Date.parse(x)),
    )
  )
    throw new Error("Invalid note dates.");
  if (
    ![n.deletedAt, n.purgeAfter].every(
      (x) =>
        x === null || (typeof x === "string" && Number.isFinite(Date.parse(x))),
    )
  )
    throw new Error("Invalid retention dates.");
  if (n.state === "trashed" && (!n.deletedAt || !n.purgeAfter))
    throw new Error("Missing Trash retention dates.");
  validateBody(n.bodyMarkdown);
  return n;
}
export function newNote(
  collectionId = "local",
  bodyMarkdown = "",
  now = new Date().toISOString(),
): Note {
  validateBody(bodyMarkdown);
  return {
    schemaVersion: 1,
    collectionId,
    noteId: crypto.randomUUID(),
    bodyMarkdown,
    state: "active",
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    purgeAfter: null,
    serverRevision: null,
    localRevision: 0,
  };
}
export function setState(
  note: Note,
  state: NoteState,
  now = new Date().toISOString(),
): Note {
  return {
    ...note,
    state,
    updatedAt: now,
    deletedAt: state === "trashed" ? now : null,
    purgeAfter:
      state === "trashed"
        ? new Date(Date.parse(now) + TRASH_DAYS * 86400000).toISOString()
        : null,
  };
}
export const isExpired = (n: Note, now = Date.now()) =>
  n.state === "trashed" &&
  n.purgeAfter !== null &&
  Date.parse(n.purgeAfter) <= now;
export function titleOf(body: string): string {
  return (
    body
      .split(/\r?\n/)
      .map((x) => x.trim())
      .find(Boolean)
      ?.replace(/^#\s+|^- \[[ xX]\] |^- |^\d+\. /, "")
      .replace(/\*\*(.*?)\*\*/g, "$1") || "Untitled"
  ).slice(0, 80);
}
export interface Tag {
  key: string;
  label: string;
  from: number;
  to: number;
}
export function tagsIn(body: string): Tag[] {
  const found: Tag[] = [];
  const pattern =
    /(^|\s)##([\p{L}\p{N}][\p{L}\p{N}\p{M}_-]{0,63})(?![\p{L}\p{N}\p{M}_-])/gu;
  for (const m of body.matchAll(pattern)) {
    const from = m.index! + m[1].length;
    found.push({
      key: fold(m[2]),
      label: m[2].normalize("NFC"),
      from,
      to: from + m[2].length + 2,
    });
  }
  return found;
}
export function tagsOf(body: string): Tag[] {
  const seen = new Set<string>();
  return tagsIn(body).filter((t) => !seen.has(t.key) && !!seen.add(t.key));
}
export type Block = {
  kind: "heading" | "paragraph" | "bullet" | "number" | "task";
  text: string;
  sourceLine: number;
  checked?: boolean;
  number?: string;
};
export function blocksOf(body: string): Block[] {
  return body.split("\n").map((line, sourceLine) => {
    if (/^# /.test(line))
      return { kind: "heading", text: line.slice(2), sourceLine };
    const task = line.match(/^- \[([ xX])\] (.*)$/);
    if (task)
      return {
        kind: "task",
        text: task[2],
        checked: task[1].toLowerCase() === "x",
        sourceLine,
      };
    if (line.startsWith("- "))
      return { kind: "bullet", text: line.slice(2), sourceLine };
    const number = line.match(/^(\d+)\. (.*)$/);
    if (number)
      return { kind: "number", text: number[2], number: number[1], sourceLine };
    return { kind: "paragraph", text: line, sourceLine };
  });
}
export function toggleTask(body: string, line: number): string {
  const lines = body.split("\n");
  lines[line] =
    lines[line]?.replace(
      /^- \[([ xX])\]/,
      (_, x) => `- [${x === " " ? "x" : " "}]`,
    ) ?? "";
  return lines.join("\n");
}
export interface SearchOptions {
  query?: string;
  tags?: string[];
  activeOnly?: boolean;
  state?: NoteState;
  now?: number;
}
export interface SearchResult {
  note: Note;
  score: number;
  excerpt: string;
}
export const tokenize = (text: string) =>
  fold(text).match(/[\p{L}\p{N}\p{M}_-]+/gu) ?? [];
const words = tokenize;
export interface SearchTerm {
  words: string[];
  phrase: boolean;
  prefix: boolean;
}
export function searchTerms(input: string): SearchTerm[] {
  const query = fold(input).trim();
  return Array.from(query.matchAll(/"([^"]+)"|(\S+)/g)).map((m, i, arr) => ({
    words: words(m[1] ?? m[2]),
    phrase: !!m[1],
    prefix: !m[1] && i === arr.length - 1 && !/\s$/.test(input),
  }));
}
export function searchNotes(
  notes: Note[],
  options: SearchOptions = {},
): SearchResult[] {
  const parts = searchTerms(options.query ?? "");
  const results: SearchResult[] = [];
  for (const note of notes) {
    if (
      isExpired(note, options.now) ||
      (options.state
        ? note.state !== options.state
        : note.state === "trashed") ||
      (options.activeOnly && note.state !== "active")
    )
      continue;
    const tags = tagsOf(note.bodyMarkdown);
    if (options.tags?.some((t) => !tags.some((x) => x.key === fold(t))))
      continue;
    const bodyWords = words(note.bodyMarkdown),
      titleWords = words(titleOf(note.bodyMarkdown));
    const matches = (hay: string[], p: (typeof parts)[number]) =>
      p.words.length > 0 &&
      (p.phrase
        ? hay.some((_, i) => p.words.every((w, j) => hay[i + j] === w))
        : p.words.every((w) =>
            hay.some((h) => (p.prefix ? h.startsWith(w) : h === w)),
          ));
    if (parts.some((p) => !matches(bodyWords, p))) continue;
    let score = 0;
    for (const p of parts) {
      score += 1;
      if (matches(titleWords, p)) score += 5;
      if (tags.some((t) => matches(words(t.label), p))) score += 8;
    }
    const first = parts[0]?.words[0];
    const offset = first
      ? Math.max(0, fold(note.bodyMarkdown).indexOf(first) - 45)
      : 0;
    results.push({
      note,
      score,
      excerpt:
        (offset ? "…" : "") + note.bodyMarkdown.slice(offset, offset + 180),
    });
  }
  return results.sort(
    (a, b) =>
      b.score - a.score ||
      b.note.updatedAt.localeCompare(a.note.updatedAt) ||
      a.note.noteId.localeCompare(b.note.noteId),
  );
}
export function clampRect(r: Rect, area: Rect): Rect {
  const width = Math.min(Math.max(r.width, 280), area.width),
    height = Math.min(Math.max(r.height, 180), area.height);
  return {
    width,
    height,
    x: Math.max(area.x, Math.min(r.x, area.x + area.width - width)),
    y: Math.max(area.y, Math.min(r.y, area.y + area.height - height)),
  };
}
export function arrange(
  notes: Placement[],
  area: Rect,
  edge: Edge,
): Placement[] {
  const vertical = edge === "left" || edge === "right",
    gap = 12;
  const extent = vertical ? area.height : area.width;
  const min = vertical ? 180 : 280;
  const fits =
    notes.length * min + Math.max(0, notes.length - 1) * gap <= extent;
  const step = fits
    ? (extent - gap * (notes.length - 1)) / Math.max(1, notes.length)
    : Math.max(
        18,
        Math.min(32, (extent - min) / Math.max(1, notes.length - 1)),
      );
  return notes.map((p, i) => {
    const width = Math.min(
      vertical
        ? p.width
        : fits
          ? Math.min(p.width, step)
          : Math.min(p.width, 280),
      area.width,
    );
    const height = Math.min(
      vertical
        ? fits
          ? Math.min(p.height, step)
          : Math.min(p.height, 180)
        : p.height,
      area.height,
    );
    let x = edge === "right" ? area.x + area.width - width : area.x;
    let y = edge === "bottom" ? area.y + area.height - height : area.y;
    if (vertical) y += i * (fits ? step + gap : step);
    else x += i * (fits ? step + gap : step);
    return { ...p, ...clampRect({ x, y, width, height }, area) };
  });
}
