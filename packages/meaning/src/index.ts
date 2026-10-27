import { validateBody } from "../../core/src/index";

// M0 retrieval helpers. No model import, persistence or application integration.
export interface TextChunk {
  start: number;
  end: number;
  text: string;
  tokens: number;
}
export function chunkForEmbedding(
  text: string,
  countTokens: (text: string) => number,
  maxTokens = 224,
): TextChunk[] {
  validateBody(text);
  if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 254)
    throw new Error("Invalid embedding token budget");
  if (!text.length) return [];
  const boundaries = [0];
  for (const character of text)
    boundaries.push(boundaries[boundaries.length - 1] + character.length);
  const chunks: TextChunk[] = [];
  const count = (start: number, end: number) => {
    const tokens = countTokens(text.slice(boundaries[start], boundaries[end]));
    if (!Number.isSafeInteger(tokens) || tokens < 0)
      throw new Error("Invalid tokenizer result");
    return tokens;
  };
  for (let start = 0; start < boundaries.length - 1;) {
    let end = Math.min(start + 1000, boundaries.length - 1);
    if (count(start, end) > maxTokens) {
      let low = start + 1,
        high = end;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (count(start, middle) <= maxTokens) low = middle;
        else high = middle - 1;
      }
      end = low;
    }
    const tokens = count(start, end);
    if (tokens > maxTokens)
      throw new Error("Tokenizer cannot fit a source character");
    chunks.push({
      start: boundaries[start],
      end: boundaries[end],
      text: text.slice(boundaries[start], boundaries[end]),
      tokens,
    });
    if (chunks.length > 4096)
      throw new Error(
        "Embedding chunk capacity reached; indexing remains incomplete",
      );
    if (end === boundaries.length - 1) break;
    start = end - Math.min(96, Math.floor((end - start) / 2));
  }
  return chunks;
}
export interface EmbeddedNote {
  noteId: string;
  state: "active" | "archived" | "trashed";
  tags: string[];
  vectors: Float32Array[];
}
export interface SemanticMatch {
  noteId: string;
  score: number;
  chunk: number;
}
export function normalizedVector(input: Float32Array): Float32Array {
  if (
    !input.length ||
    input.length > 4096 ||
    [...input].some((value) => !Number.isFinite(value))
  )
    throw new Error("Invalid embedding vector");
  const norm = Math.sqrt(input.reduce((sum, value) => sum + value * value, 0));
  if (!Number.isFinite(norm) || norm === 0)
    throw new Error("Empty embedding vector");
  return Float32Array.from(input, (value) => value / norm);
}
export function rankSemantic(
  notes: EmbeddedNote[],
  input: Float32Array,
  options: { limit?: number; activeOnly?: boolean; tags?: string[] } = {},
): SemanticMatch[] {
  const query = normalizedVector(input),
    matches: SemanticMatch[] = [];
  const limit = options.limit ?? 30;
  if (!Number.isInteger(limit) || limit < 1 || limit > 10000)
    throw new Error("Invalid semantic result bound");
  const seen = new Set<string>();
  for (const note of notes) {
    if (seen.has(note.noteId))
      throw new Error("Duplicate semantic note identity");
    seen.add(note.noteId);
    if (
      note.state === "trashed" ||
      (options.activeOnly && note.state !== "active") ||
      options.tags?.some((tag) => !note.tags.includes(tag))
    )
      continue;
    let score = -Infinity,
      chunk = -1;
    for (let i = 0; i < note.vectors.length; i++) {
      const vector = note.vectors[i];
      if (vector.length !== query.length)
        throw new Error("Embedding model dimensions changed");
      let dot = 0;
      for (let d = 0; d < query.length; d++) {
        if (!Number.isFinite(vector[d]))
          throw new Error("Invalid stored vector");
        dot += vector[d] * query[d];
      }
      if (dot > score) {
        score = dot;
        chunk = i;
      }
    }
    if (chunk >= 0) matches.push({ noteId: note.noteId, score, chunk });
  }
  return matches
    .sort(
      (a, b) =>
        b.score - a.score ||
        (a.noteId < b.noteId ? -1 : a.noteId > b.noteId ? 1 : 0),
    )
    .slice(0, limit);
}
export function fuseRanks(
  semantic: SemanticMatch[],
  lexicalIds: string[],
  limit = 30,
) {
  const scores = new Map<string, number>();
  for (const ids of [semantic.map((match) => match.noteId), lexicalIds]) {
    const seen = new Set<string>();
    for (let i = 0; i < ids.length; i++)
      if (!seen.has(ids[i])) {
        seen.add(ids[i]);
        scores.set(ids[i], (scores.get(ids[i]) ?? 0) + 1 / (60 + i + 1));
      }
  }
  return [...scores]
    .map(([noteId, score]) => ({ noteId, score }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        (a.noteId < b.noteId ? -1 : a.noteId > b.noteId ? 1 : 0),
    )
    .slice(0, limit);
}
