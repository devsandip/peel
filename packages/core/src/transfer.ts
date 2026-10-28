import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import { type Note, validateNote } from "./index";

export function exportNotes(notes: Note[]): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  const entries = notes.map((note) => {
    const { bodyMarkdown, ...metadata } = note;
    const file = `notes/${note.noteId}.md`;
    files[file] = strToU8(bodyMarkdown);
    return { ...metadata, file };
  });
  files["manifest.json"] = strToU8(
    JSON.stringify(
      {
        format: "peel-export",
        version: 1,
        exportedAt: new Date().toISOString(),
        notes: entries,
      },
      null,
      2,
    ),
  );
  return zipSync(files, { level: 6 });
}
export function importArchive(bytes: Uint8Array): Note[] {
  // Check ZIP metadata before allocating decompressed note data.
  let total = 0;
  const files = unzipSync(bytes, {
    filter(file) {
      total += file.originalSize;
      if (total > 128 * 1024 * 1024)
        throw new Error(
          "This export is too large. Import a smaller collection.",
        );
      return (
        file.name === "manifest.json" ||
        /^notes\/[a-zA-Z0-9-]{1,128}\.md$/.test(file.name)
      );
    },
  });
  if (!files["manifest.json"])
    throw new Error("This file is missing its Synkies manifest.");
  const manifest = JSON.parse(strFromU8(files["manifest.json"]));
  if (
    manifest.format !== "peel-export" ||
    manifest.version !== 1 ||
    !Array.isArray(manifest.notes)
  )
    throw new Error("Unsupported Synkies export.");
  const seen = new Set<string>();
  return manifest.notes.map((entry: Record<string, unknown>) => {
    if (typeof entry.file !== "string" || !files[entry.file])
      throw new Error("A Markdown file in this export is missing.");
    const { file, ...metadata } = entry;
    const note = validateNote({
      ...metadata,
      bodyMarkdown: strFromU8(files[entry.file]),
    });
    if (seen.has(note.noteId))
      throw new Error("Duplicate note identity in export.");
    seen.add(note.noteId);
    return note;
  });
}
