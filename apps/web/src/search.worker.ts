import { WordIndex } from "../../../packages/search/src/index";
import type { SearchReply, SearchRequest } from "./search-protocol";

const index = new WordIndex();
let failure = false;
self.onmessage = ({ data }: MessageEvent<SearchRequest>) => {
  try {
    if (data.kind === "update") index.apply(data.notes, data.removed);
    else {
      if (failure) throw new Error("Index update failed");
      const { results, total } = index.search(data.options, data.limit);
      const reply: SearchReply = {
        request: data.request,
        results: results.map(({ note, score, excerpt }) => ({
          noteId: note.noteId,
          score,
          excerpt,
        })),
        total,
        tags: index.tags(),
      };
      self.postMessage(reply);
    }
  } catch {
    failure = true;
    if (data.kind === "search")
      self.postMessage({
        request: data.request,
        results: [],
        total: 0,
        tags: [],
        error: "Search is unavailable. Retry to rebuild the local index.",
      } satisfies SearchReply);
  }
};
