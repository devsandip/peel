import { vi } from "vitest";
import { cloudStackFixture } from "./cloud-stack-pages.ts";

// Synthetic projected pages only, with no real account/pool/user access.
export const name = "peel-cloud-dev-00000000-0000-4000-8000-000000000001";
export const row = (id = "us-east-1_Private1", Name = name) => ({
  Id: id,
  Name,
});
export function fixture(
  pages: Record<string, unknown>[] = [
    { NextToken: null, Count: 0, Matches: [] },
  ],
) {
  let page = 0;
  return {
    ...cloudStackFixture(),
    pages,
    run: vi.fn(async (_args: readonly string[], _signal: AbortSignal) => ({
      stdout: JSON.stringify(pages[page++]),
      stderr: "",
    })),
  };
}
