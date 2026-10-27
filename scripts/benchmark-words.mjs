import { performance } from "node:perf_hooks";
import { writeFile } from "node:fs/promises";
import { WordIndex } from "../scratch/word-bench/index.js";
import { wordFixtures, wordQueries as queries } from "./word-fixtures.mjs";
const notes = wordFixtures();
const index = new WordIndex();
const start = performance.now();
index.update(notes);
const buildMs = performance.now() - start;
const samples = [];
for (let i = 0; i < 100; i++) {
  const start = performance.now();
  const result = index.search({ query: queries[i % queries.length] }, 80);
  samples.push({
    queryId: (i % queries.length) + 1,
    ms: Math.round((performance.now() - start) * 100) / 100,
    total: result.total,
  });
}
const sorted = samples.map((s) => s.ms).sort((a, b) => a - b);
const report = {
  scope: "Node component experiment, not native/browser release acceptance",
  runtime: process.version,
  noteCount: notes.length,
  averageBytes: Math.round(
    notes.reduce((n, x) => n + Buffer.byteLength(x.bodyMarkdown), 0) /
      notes.length,
  ),
  buildMs: Math.round(buildMs * 100) / 100,
  pageSize: 80,
  p50Ms: sorted[49],
  p95Ms: sorted[94],
  maxMs: sorted[99],
  samples,
};
await writeFile(
  new URL("../scratch/word-search-node.json", import.meta.url),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify({ ...report, samples: undefined }, null, 2));
