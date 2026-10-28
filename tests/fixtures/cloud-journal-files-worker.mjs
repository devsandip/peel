import { readFileSync, writeSync } from "node:fs";
import { createCloudJournalFiles } from "../../infra/cloud/journal-files.ts";

const anchor = JSON.parse(readFileSync(process.argv[2], "utf8"));
writeSync(1, "ready\n");
await new Promise((resolve) => process.stdin.once("data", resolve));
try {
  const files = createCloudJournalFiles(anchor);
  files.close();
  writeSync(
    1,
    JSON.stringify({
      kind: "files-created",
      runAuthority: files.runAuthority,
    }) + "\n",
  );
} catch (error) {
  writeSync(
    1,
    JSON.stringify({ kind: "refused", code: error?.code ?? "unexpected" }) +
      "\n",
  );
}
