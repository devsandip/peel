import { vi } from "vitest";
import { cloudStackFixture } from "./cloud-stack-pages.ts";

// Synthetic XML and credentials; transport injection makes no provider request.
export const name = "peel-cloud-dev-00000000-0000-4000-8000-000000000001";
export const xml = (text: string) => new TextEncoder().encode(text);
export const tags =
  '<Tagging xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><TagSet><Tag><Key>private-key</Key><Value>private-value</Value></Tag></TagSet></Tagging>';
export function response(
  statusCode = 200,
  body: unknown = xml(tags),
  headers = {},
) {
  return {
    response: {
      statusCode,
      headers: { "content-type": "application/xml", ...headers },
      body,
    },
  };
}
export function fixture() {
  const handle = vi.fn(async (..._args: any[]) => response());
  return {
    ...cloudStackFixture(),
    credentials: {
      accessKeyId: "synthetic-access-key",
      secretAccessKey: "synthetic-secret",
    },
    transport: { handle, destroy: vi.fn() },
  };
}
export const errorResponse = (code: string, status = 404, headers = {}) =>
  response(
    status,
    xml(
      `<Error><Code>${code}</Code><Message>private-provider-message</Message></Error>`,
    ),
    headers,
  );
