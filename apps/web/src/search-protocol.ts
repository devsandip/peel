import type { Note, SearchOptions } from "@peel/core";

export type SearchRequest =
  | { kind: "update"; notes: Note[]; removed: string[] }
  | { kind: "search"; request: number; options: SearchOptions; limit: number };
export interface SearchReply {
  request: number;
  results: { noteId: string; score: number; excerpt: string }[];
  total: number;
  tags: { key: string; label: string }[];
  error?: string;
}
