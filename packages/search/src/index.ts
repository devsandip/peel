import {
  fold,
  tokenize,
  searchTerms,
  tagsOf,
  titleOf,
  isExpired,
  type Note,
  type SearchOptions,
  type SearchResult,
  type SearchTerm,
} from "../../core/src/index";

type TextIndex = { words: Set<string>; phrase: string };
type Entry = {
  note: Note;
  bodySource: string;
  body: TextIndex;
  title: TextIndex;
  tags: Map<string, TextIndex & { label: string }>;
};
const textIndex = (text: string): TextIndex => {
  const tokens = tokenize(text);
  return { words: new Set(tokens), phrase: " " + tokens.join(" ") + " " };
};
const matches = (index: TextIndex, term: SearchTerm) =>
  term.words.length > 0 &&
  (term.phrase
    ? index.phrase.includes(" " + term.words.join(" ") + " ")
    : term.words.every((w) =>
        term.prefix
          ? [...index.words].some((t) => t.startsWith(w))
          : index.words.has(w),
      ));

/** Rebuildable private derived data. No networking, persistence or account globals. */
export class WordIndex {
  private entries = new Map<string, Entry>();
  private postings = new Map<string, Set<string>>();
  clear() {
    this.entries.clear();
    this.postings.clear();
  }
  update(notes: Note[]) {
    const current = new Set(notes.map((n) => n.noteId));
    this.apply(
      notes,
      [...this.entries.keys()].filter((id) => !current.has(id)),
    );
  }
  apply(notes: Note[], removed: string[]) {
    for (const id of removed) this.remove(id);
    for (const note of notes) {
      const previous = this.entries.get(note.noteId);
      if (previous && previous.bodySource === note.bodyMarkdown) {
        previous.note = note;
        continue;
      }
      this.remove(note.noteId);
      const entry = {
        note,
        bodySource: note.bodyMarkdown,
        body: textIndex(note.bodyMarkdown),
        title: textIndex(titleOf(note.bodyMarkdown)),
        tags: new Map(
          tagsOf(note.bodyMarkdown).map((t) => [
            t.key,
            { ...textIndex(t.label), label: t.label },
          ]),
        ),
      };
      this.entries.set(note.noteId, entry);
      for (const word of entry.body.words) {
        let posting = this.postings.get(word);
        if (!posting) {
          posting = new Set();
          this.postings.set(word, posting);
        }
        posting.add(note.noteId);
      }
    }
  }
  tags() {
    const tags = new Map<string, { key: string; label: string }>();
    for (const { note, tags: entryTags } of this.entries.values())
      if (note.state !== "trashed" && !isExpired(note))
        for (const [key, value] of entryTags)
          tags.set(key, { key, label: value.label });
    return [...tags.values()].sort((a, b) => a.label.localeCompare(b.label));
  }
  private remove(id: string) {
    const old = this.entries.get(id);
    if (!old) return;
    for (const word of old.body.words) {
      const posting = this.postings.get(word);
      posting?.delete(id);
      if (!posting?.size) this.postings.delete(word);
    }
    this.entries.delete(id);
  }
  search(
    options: SearchOptions = {},
    limit = Infinity,
  ): { results: SearchResult[]; total: number } {
    const terms = searchTerms(options.query ?? "");
    if (terms.some((t) => !t.words.length)) return { results: [], total: 0 };
    let candidates: Set<string> | undefined;
    for (const term of terms) {
      for (const word of term.words) {
        const posting = new Set<string>();
        if (term.prefix) {
          for (const [key, ids] of this.postings)
            if (key.startsWith(word)) for (const id of ids) posting.add(id);
        } else for (const id of this.postings.get(word) ?? []) posting.add(id);
        if (!candidates) candidates = posting;
        else
          candidates = new Set([...candidates].filter((id) => posting.has(id)));
        if (!candidates.size) return { results: [], total: 0 };
      }
    }
    const selectedTags = (options.tags ?? []).map(fold);
    const rows: { entry: Entry; score: number }[] = [];
    for (const id of candidates ?? this.entries.keys()) {
      const entry = this.entries.get(id)!;
      const { note } = entry;
      if (
        isExpired(note, options.now) ||
        (options.state
          ? note.state !== options.state
          : note.state === "trashed") ||
        (options.activeOnly && note.state !== "active")
      )
        continue;
      if (
        selectedTags.some((t) => !entry.tags.has(t)) ||
        terms.some((t) => !matches(entry.body, t))
      )
        continue;
      let score = 0;
      for (const term of terms) {
        score++;
        if (matches(entry.title, term)) score += 5;
        if ([...entry.tags.values()].some((tag) => matches(tag, term)))
          score += 8;
      }
      rows.push({ entry, score });
    }
    rows.sort(
      (a, b) =>
        b.score - a.score ||
        b.entry.note.updatedAt.localeCompare(a.entry.note.updatedAt) ||
        a.entry.note.noteId.localeCompare(b.entry.note.noteId),
    );
    const first = terms[0]?.words[0];
    return {
      total: rows.length,
      results: rows.slice(0, Math.max(0, limit)).map(({ entry, score }) => {
        const offset = first
          ? Math.max(0, fold(entry.note.bodyMarkdown).indexOf(first) - 45)
          : 0;
        return {
          note: entry.note,
          score,
          excerpt:
            (offset ? "…" : "") +
            entry.note.bodyMarkdown.slice(offset, offset + 180),
        };
      }),
    };
  }
}
