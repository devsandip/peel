import { WordIndex } from "../../packages/search/src/index";
import { newNote } from "../../packages/core/src/index";
import { meaningNotes } from "./meaning-corpus";
const index = new WordIndex();
index.apply(
  meaningNotes.map((note) => ({
    ...newNote("local", note.body),
    noteId: note.noteId,
    state: note.state,
  })),
  [],
);
self.onmessage = ({
  data,
}: MessageEvent<{ request: number; query: string }>) => {
  const began = performance.now();
  const result = index.search({ query: data.query }, 30);
  self.postMessage({
    request: data.request,
    ids: result.results.map((row) => row.note.noteId),
    workerMs: performance.now() - began,
  });
};
self.postMessage({ ready: true });
