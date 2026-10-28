import { vi } from "vitest";
import { cloudStackFixture } from "./cloud-stack-pages.ts";

// Synthetic projected metadata/process errors only. No real account call.
export const name = "peel-cloud-dev-00000000-0000-4000-8000-000000000001-auth";
export const metadata = () => ({
  Shape: "object",
  Domain: name,
  AccountId: "111122223333",
  PoolId: "us-east-1_Private1",
  Status: "ACTIVE",
});
export const empty = (Shape = "null") => ({
  Shape,
  Domain: null,
  AccountId: null,
  PoolId: null,
  Status: null,
});
export const response = (data: unknown) => ({
  stdout: JSON.stringify(data),
  stderr: "",
});
export function fixture(data: unknown = metadata()) {
  return {
    ...cloudStackFixture(),
    run: vi.fn(async (_args: readonly string[], _signal: AbortSignal) =>
      response(data),
    ),
  };
}
export const missing = () => ({
  code: 254,
  stdout: "",
  stderr: JSON.stringify({
    Code: "ResourceNotFoundException",
    Message: "private-message",
  }),
  killed: false,
  signal: null,
});
