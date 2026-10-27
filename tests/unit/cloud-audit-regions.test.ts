import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cloudAuditRegistryUrl,
  collectCloudAuditRegions,
  parseCloudAuditRegions,
} from "../../infra/cloud/audit-regions.ts";

const checkedAt = "2026-10-28T00:00:00.000Z",
  now = Date.parse(checkedAt),
  // Independent fixture of the published complete table, including another partition.
  regions =
    "us-east-1 us-east-2 us-west-1 us-west-2 af-south-1 ap-east-1 ap-south-2 ap-southeast-3 ap-southeast-4 ap-south-1 ap-northeast-3 ap-northeast-2 ap-southeast-1 ap-southeast-2 ap-northeast-1 ca-central-1 eu-central-1 eu-west-1 eu-west-2 eu-south-1 eu-west-3 eu-south-2 eu-north-1 eu-central-2 il-central-1 me-south-1 me-central-1 sa-east-1 us-gov-east-1 us-gov-west-1".split(
      " ",
    );
function table(rows = regions) {
  return (
    '<table id="region-table"><thead><tr><th>Region Name</th><th>Region</th></tr></thead>' +
    rows
      .map(
        (r) =>
          `<tr><td tabindex="-1">Synthetic region</td><td tabindex="-1">${r}</td></tr>`,
      )
      .join("") +
    "</table>"
  );
}
function response(
  body: string | ReadableStream<Uint8Array> = table(),
  options: ResponseInit = {},
) {
  const value = new Response(body, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
    ...options,
  });
  Object.defineProperty(value, "url", {
    value: cloudAuditRegistryUrl,
    configurable: true,
  });
  return value;
}
afterEach(() => vi.useRealTimers());
describe("Cloud audit region registry", () => {
  it("validates the complete table before excluding only the separate GovCloud partition", () => {
    const html = "<!doctype html><html>" + table() + "</html>",
      result = parseCloudAuditRegions(html, checkedAt);
    expect(result.regions).toHaveLength(28);
    expect(result.publishedRegionCount).toBe(30);
    expect(result.regions).toContain("ap-southeast-4");
    expect(result.regions).toContain("us-east-1");
    expect(result.regions).not.toContain("us-gov-east-1");
    expect(result.excludedRegions).toEqual(["us-gov-east-1", "us-gov-west-1"]);
    expect(result.sourceUrl).toBe(cloudAuditRegistryUrl);
    expect(result.sourceSha256).toBe(
      createHash("sha256").update(html).digest("hex"),
    );
    expect(result.checkedAt).toBe(checkedAt);
    expect(Object.isFrozen(result) && Object.isFrozen(result.regions)).toBe(
      true,
    );
    expect(
      parseCloudAuditRegions(table([...regions].reverse()), checkedAt).regions,
    ).toEqual(result.regions);
  });
  it("refuses added/missing/duplicate/changed regions, including omitted noncommercial coverage", () => {
    for (const rows of [
      regions.slice(0, -1),
      [...regions, "ap-southeast-5"],
      [...regions.slice(1), regions[1]],
      regions.map((r) => (r === "us-east-2" ? "us-east-9" : r)),
    ]) {
      expect(() => parseCloudAuditRegions(table(rows), checkedAt)).toThrow(
        "Cloud audit region registry unavailable",
      );
    }
  });
  it("refuses malformed or partial markup rather than selecting a convenient subset", () => {
    const html = table();
    for (const value of [
      "",
      "<!--" + html + "-->",
      "<script>" + html + "</script>",
      html.replace("</th>", "</th><th>"),
      html + table(),
      html + "<table>",
      html.replace("Region Name", "Other"),
      html.replace("</tr>", ""),
      html.replace(
        '<td tabindex="-1">us-east-1</td>',
        "<td>us-east-1</td><td>extra</td>",
      ),
      html.replace("us-east-1</td>", "<code>us-east-1</code></td>"),
      html.replace("us-east-1</td>", "us-east-1&#10;</td>"),
      "x".repeat(256 * 1024 + 1),
    ]) {
      expect(() => parseCloudAuditRegions(value, checkedAt)).toThrow(
        "Cloud audit region registry unavailable",
      );
    }
    expect(() =>
      parseCloudAuditRegions(html, "2026-02-30T00:00:00.000Z"),
    ).toThrow("Cloud audit region registry unavailable");
  });
  it("requests one fixed public HTTPS page with no credential, redirect, retry or cache fallback", async () => {
    const fetcher = vi.fn(async () => response());
    const result = await collectCloudAuditRegions({
      fetch: fetcher,
      clock: () => now,
    });
    expect(result.kind).toBe("observed");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]).toEqual([
      cloudAuditRegistryUrl,
      expect.objectContaining({
        method: "GET",
        credentials: "omit",
        redirect: "error",
        cache: "no-store",
        headers: { accept: "text/html", "accept-encoding": "identity" },
        signal: expect.any(AbortSignal),
      }),
    ]);
    expect(result.resourceWrites).toBe(0);
  });
  it("rejects wrong status/origin/type and redirects, with a private fixed failure", async () => {
    const wrongUrl = response();
    Object.defineProperty(wrongUrl, "url", {
      value: "https://fixture.invalid/",
      configurable: true,
    });
    const redirected = response();
    Object.defineProperty(redirected, "redirected", { value: true });
    for (const value of [
      response("denied", { status: 403 }),
      response(table(), { headers: { "content-type": "application/json" } }),
      wrongUrl,
      redirected,
    ]) {
      expect(
        await collectCloudAuditRegions({
          fetch: async () => value,
          clock: () => now,
        }),
      ).toEqual({
        kind: "unavailable",
        code: "registry-unavailable",
        resourceWrites: 0,
      });
    }
    expect(
      await collectCloudAuditRegions({
        fetch: async () => {
          throw Error("private upstream details");
        },
        clock: () => now,
      }),
    ).toEqual({
      kind: "unavailable",
      code: "registry-unavailable",
      resourceWrites: 0,
    });
  });
  it("bounds streamed bytes, cancels excess input and refuses invalid UTF-8", async () => {
    const cancel = vi.fn(),
      stream = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(new Uint8Array(256 * 1024));
          c.enqueue(new Uint8Array(1));
        },
        cancel,
      });
    expect(
      await collectCloudAuditRegions({
        fetch: async () => response(stream),
        clock: () => now,
      }),
    ).toEqual({
      kind: "unavailable",
      code: "registry-format",
      resourceWrites: 0,
    });
    expect(cancel).toHaveBeenCalled();
    const invalid = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(Uint8Array.of(0xff));
        c.close();
      },
    });
    expect(
      (
        await collectCloudAuditRegions({
          fetch: async () => response(invalid),
          clock: () => now,
        })
      ).kind,
    ).toBe("unavailable");
  });
  it("aborts fetch and pending body work at the same deadline, without retries", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      signal = init.signal as AbortSignal;
      return new Promise<Response>(() => {});
    });
    const pending = collectCloudAuditRegions({
      fetch: fetcher,
      clock: () => now,
    });
    await vi.advanceTimersByTimeAsync(10000);
    expect(await pending).toEqual({
      kind: "unavailable",
      code: "deadline",
      resourceWrites: 0,
    });
    expect(signal?.aborted).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const cancel = vi.fn(),
      body = new ReadableStream<Uint8Array>({ cancel });
    const stalled = collectCloudAuditRegions({
      fetch: async () => response(body),
      clock: () => now,
    });
    await vi.advanceTimersByTimeAsync(10000);
    expect(await stalled).toEqual({
      kind: "unavailable",
      code: "deadline",
      resourceWrites: 0,
    });
    expect(cancel).toHaveBeenCalled();
  });
  it("refuses invalid, reversed and overrun clocks, and does not mutate output with later source changes", async () => {
    for (const end of [now - 1, now + 10001, NaN]) {
      const times = [now, end];
      expect(
        await collectCloudAuditRegions({
          fetch: async () => response(),
          clock: () => times.shift()!,
        }),
      ).toEqual({
        kind: "unavailable",
        code: "clock-invalid",
        resourceWrites: 0,
      });
    }
    const fetcher = vi.fn(async () => response());
    expect(
      await collectCloudAuditRegions({ fetch: fetcher, clock: () => NaN }),
    ).toEqual({
      kind: "unavailable",
      code: "clock-invalid",
      resourceWrites: 0,
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
