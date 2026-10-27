import { openDB, type IDBPDatabase } from "idb";
import { isTauri, invoke } from "@tauri-apps/api/core";
import {
  newNote,
  validateNote,
  isExpired,
  type Note,
  type Placement,
} from "@peel/core";

export interface Repository {
  list(): Promise<Note[]>;
  get(noteId: string): Promise<Note | null>;
  save(note: Note, expectedRevision: number): Promise<Note>;
  purge(noteId: string, expectedRevision: number): Promise<void>;
  placements(): Promise<Placement[]>;
  place(placement: Placement): Promise<void>;
  setting<T>(key: string, fallback: T): Promise<T>;
  setSetting(key: string, value: unknown): Promise<void>;
  maintenance(): Promise<void>;
}
export class BrowserRepository implements Repository {
  private db: Promise<IDBPDatabase>;
  constructor(name = "peel-local-v1") {
    this.db = openDB(name, 1, {
      upgrade(db) {
        db.createObjectStore("notes", { keyPath: "noteId" });
        db.createObjectStore("placements", { keyPath: "noteId" });
        db.createObjectStore("tombstones");
        db.createObjectStore("settings");
      },
    });
  }
  async list() {
    return (await (await this.db).getAll("notes")).filter(
      (n: Note) => !isExpired(n),
    );
  }
  async get(noteId: string): Promise<Note | null> {
    const note = await (await this.db).get("notes", noteId);
    return note && !isExpired(note) ? note : null;
  }
  async save(note: Note, expectedRevision: number) {
    validateNote(note);
    if (note.collectionId !== "local")
      throw new Error(
        "Peel Cloud is not connected. Your local note has not been uploaded.",
      );
    const tx = (await this.db).transaction(
      ["notes", "tombstones"],
      "readwrite",
      { durability: "strict" },
    );
    const previous = await tx.objectStore("notes").get(note.noteId);
    if (await tx.objectStore("tombstones").get(note.noteId)) {
      tx.abort();
      throw new Error(
        "This note was permanently deleted. Recover its text as a new note.",
      );
    }
    if ((previous?.localRevision ?? 0) !== expectedRevision) {
      tx.abort();
      throw new Error(
        "This note changed in another window. Copy your text before reloading.",
      );
    }
    const saved = { ...note, localRevision: expectedRevision + 1 };
    await tx.objectStore("notes").put(saved);
    await tx.done;
    this.changed();
    return saved;
  }
  async purge(noteId: string, expectedRevision: number) {
    const tx = (await this.db).transaction(
      ["notes", "placements", "tombstones"],
      "readwrite",
      { durability: "strict" },
    );
    const note = await tx.objectStore("notes").get(noteId);
    if (note?.localRevision !== expectedRevision) {
      tx.abort();
      throw new Error("The note changed. Refresh before deleting.");
    }
    await tx
      .objectStore("tombstones")
      .put({ purgedAt: new Date().toISOString() }, noteId);
    await tx.objectStore("notes").delete(noteId);
    await tx.objectStore("placements").delete(noteId);
    await tx.done;
    this.changed();
  }
  async placements() {
    return (await this.db).getAll("placements");
  }
  async place(p: Placement) {
    await (await this.db).put("placements", p);
    this.changed();
  }
  async setting<T>(key: string, fallback: T): Promise<T> {
    return (await (await this.db).get("settings", key)) ?? fallback;
  }
  async setSetting(key: string, value: unknown) {
    await (await this.db).put("settings", value, key);
    this.changed();
  }
  async maintenance() {
    for (const n of await (await this.db).getAll("notes"))
      if (isExpired(n)) await this.purge(n.noteId, n.localRevision);
  }
  private changed() {
    const channel = new BroadcastChannel("peel-local");
    channel.postMessage("changed");
    channel.close();
    window.dispatchEvent(new Event("peel-changed"));
  }
}
export class NativeRepository implements Repository {
  list() {
    return invoke<Note[]>("list_notes");
  }
  get(noteId: string) {
    return invoke<Note | null>("get_note", { noteId });
  }
  save(note: Note, expectedRevision: number) {
    validateNote(note);
    return invoke<Note>("save_note", { note, expectedRevision });
  }
  purge(noteId: string, expectedRevision: number) {
    return invoke<void>("purge_note", { noteId, expectedRevision });
  }
  placements() {
    return invoke<Placement[]>("list_placements");
  }
  place(placement: Placement) {
    return invoke<void>("save_placement", { placement });
  }
  async setting<T>(key: string, fallback: T): Promise<T> {
    return (await invoke<T | null>("get_setting", { key })) ?? fallback;
  }
  setSetting(key: string, value: unknown) {
    return invoke<void>("set_setting", { key, value });
  }
  maintenance() {
    return invoke<void>("maintenance");
  }
}
export const native = isTauri();
export const repository: Repository = native
  ? new NativeRepository()
  : new BrowserRepository();

export async function importInto(
  repo: Repository,
  notes: Note[],
): Promise<{ added: number; skipped: number; recovered: number }> {
  const existing = new Map((await repo.list()).map((n) => [n.noteId, n]));
  const result = { added: 0, skipped: 0, recovered: 0 };
  // Imported cloud notes become explicit local copies. Import never uploads.
  for (const input of notes) {
    const old = existing.get(input.noteId);
    if (
      old &&
      old.bodyMarkdown === input.bodyMarkdown &&
      old.state === input.state &&
      old.updatedAt === input.updatedAt
    ) {
      result.skipped++;
      continue;
    }
    const note = {
      ...input,
      collectionId: "local",
      serverRevision: null,
      localRevision: 0,
    };
    if (old) {
      note.noteId = crypto.randomUUID();
      note.origin = {
        collectionId: input.collectionId,
        noteId: input.noteId,
        moveId: crypto.randomUUID(),
      };
      result.recovered++;
    }
    try {
      await repo.save(note, 0);
      result.added++;
    } catch (error) {
      if (String(error).includes("permanently deleted")) {
        await repo.save({ ...note, noteId: newNote().noteId }, 0);
        result.added++;
        result.recovered++;
      } else throw error;
    }
  }
  return result;
}
