import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cloudSourceCommandArgs,
  collectCloudSourceObservation,
  type CloudSourceCommand,
} from "../../infra/cloud/source-observations.ts";

const runId = "00000000-0000-4000-8000-000000000001",
  commit = "a".repeat(40),
  tree = "b".repeat(40),
  now = Date.parse("2026-10-28T00:00:00.500Z"),
  hash = (data: string | Uint8Array) =>
    createHash("sha256").update(data).digest("hex"),
  repository = { id: 1435686213, full_name: "devsandip/peel" },
  latest = () => ({
    total_count: 3,
    workflow_runs: [
      {
        id: 123,
        run_attempt: 2,
        workflow_id: 456,
        head_sha: commit,
        head_branch: "main",
        event: "push",
        status: "completed",
        conclusion: "success",
        path: ".github/workflows/checks.yml",
        repository,
        head_repository: repository,
      },
    ],
  }),
  jobList = () => ({
    total_count: 3,
    jobs: ["cloud-artifact", "native", "web-and-core"].map((name) => ({
      name,
      run_id: 123,
      head_sha: commit,
      status: "completed",
      conclusion: "success",
    })),
  });
function artifact() {
  const zip = new TextEncoder().encode("synthetic ZIP fixture");
  return {
    zip,
    manifest: {
      format: 1,
      runtime: "nodejs24.x",
      handler: "handler.handler",
      architecture: "x86_64",
      esbuild: "0.28.2",
      zipBytes: zip.length,
      zipSha256: hash(zip),
      lockSha256: hash("lock\n"),
      files: {
        "handler.cjs": "c".repeat(64),
        "THIRD_PARTY_NOTICES.txt": "d".repeat(64),
      },
    },
  };
}
function fixture() {
  const values: Record<string, string> = {
    branch: "main\n",
    status: "",
    head: commit + "\n",
    tree: tree + "\n",
    "origin-main": commit + "\n",
    origin: "https://github.com/devsandip/peel.git\n",
    lock: "lock\n",
    repository: JSON.stringify({
      ...repository,
      private: false,
      default_branch: "main",
    }),
    "remote-main": JSON.stringify({
      ref: "refs/heads/main",
      object: { type: "commit", sha: commit },
    }),
    workflow: JSON.stringify({
      id: 456,
      path: ".github/workflows/checks.yml",
      state: "active",
    }),
    "latest-run": JSON.stringify(latest()),
    jobs: JSON.stringify(jobList()),
  };
  const read = vi.fn(
      async (command: CloudSourceCommand, _signal: AbortSignal) =>
        values[command.kind],
    ),
    build = vi.fn(async () => artifact());
  return { values, read, build, clock: () => now };
}
afterEach(() => vi.useRealTimers());
describe("Cloud source observations", () => {
  it("binds reproducible bytes, current lock, exact latest attempt and five templates to clean main", async () => {
    const f = fixture(),
      result = await collectCloudSourceObservation({ runId }, f);
    expect(result.kind).toBe("observed");
    if (result.kind !== "observed") throw Error("missing observation");
    const o = result.observation;
    expect(o.source).toEqual({
      commit,
      tree,
      lockSha256: hash("lock\n"),
      zipSha256: hash(result.zip),
      zipBytes: result.zip.length,
      templatesSha256: hash(result.templates),
    });
    expect(o.lease).toEqual({
      startedAt: "2026-10-28T00:00:00.000Z",
      expiresAt: "2026-10-28T01:30:00.000Z",
    });
    expect(o.ci).toEqual({ runId: 123, attempt: 2, workflowId: 456 });
    expect(Object.keys(JSON.parse(result.templates))).toHaveLength(5);
    expect(result.templates).toContain(runId);
    expect(f.build).toHaveBeenCalledTimes(2);
    expect(f.read.mock.calls.find(([c]) => c.kind === "jobs")?.[0]).toEqual({
      kind: "jobs",
      runId: 123,
      attempt: 2,
    });
    expect(
      Object.isFrozen(o.source) &&
        Object.isFrozen(o.ci) &&
        Object.isFrozen(o.lease),
    ).toBe(true);
    expect(o.resourceWrites).toBe(0);
  });
  it("stops before hosted metadata/build for dirty, detached, non-main or stale local refs without reflecting names", async () => {
    for (const [kind, value] of [
      ["status", "?? private-note.txt\n"],
      ["branch", "feature\n"],
      ["head", "bad\n"],
      ["tree", "f".repeat(40) + "\nextra"],
      ["origin-main", "f".repeat(40) + "\n"],
    ]) {
      const f = fixture();
      f.values[kind] = value;
      const result = await collectCloudSourceObservation({ runId }, f);
      expect(result).toEqual({
        kind: "unavailable",
        code: "source-not-ready",
        resourceWrites: 0,
      });
      expect(f.build).not.toHaveBeenCalled();
      expect(f.read.mock.calls.some(([c]) => c.kind === "repository")).toBe(
        false,
      );
    }
  });
  it("rejects an archive/fork/private repository or wrong default branch/origin", async () => {
    for (const update of [
      { origin: "https://github.com/devsandip/peel-private-archive.git\n" },
      {
        repository: JSON.stringify({
          ...repository,
          id: 9,
          private: false,
          default_branch: "main",
        }),
      },
      {
        repository: JSON.stringify({
          ...repository,
          private: true,
          default_branch: "main",
        }),
      },
      {
        repository: JSON.stringify({
          ...repository,
          private: false,
          default_branch: "other",
        }),
      },
    ]) {
      const f = fixture();
      Object.assign(f.values, update);
      expect(await collectCloudSourceObservation({ runId }, f)).toMatchObject({
        kind: "unavailable",
        code: "repository-mismatch",
      });
      expect(f.build).not.toHaveBeenCalled();
    }
  });
  it("requires the latest main push, matching workflow/source/repository and successful completion", async () => {
    for (const patch of [
      { head_sha: "e".repeat(40) },
      { event: "pull_request" },
      { head_branch: "feature" },
      { workflow_id: 789 },
      { path: ".github/workflows/other.yml" },
      { status: "in_progress" },
      { conclusion: "failure" },
      { run_attempt: 0 },
      { repository: { ...repository, id: 9 } },
      { head_repository: { ...repository, id: 9 } },
    ]) {
      const f = fixture(),
        list = latest();
      Object.assign(list.workflow_runs[0], patch);
      f.values["latest-run"] = JSON.stringify(list);
      expect((await collectCloudSourceObservation({ runId }, f)).kind).toBe(
        "unavailable",
      );
      expect(f.build).not.toHaveBeenCalled();
    }
    for (const list of [
      { total_count: 0, workflow_runs: [] },
      {
        total_count: 2,
        workflow_runs: [...latest().workflow_runs, ...latest().workflow_runs],
      },
    ]) {
      const f = fixture();
      f.values["latest-run"] = JSON.stringify(list);
      expect(await collectCloudSourceObservation({ runId }, f)).toMatchObject({
        kind: "unavailable",
        code: "checks-not-ready",
      });
    }
  });
  it("requires exactly the complete three jobs from that attempt, with no duplicate/truncated/extra jobs", async () => {
    for (const patch of [
      { name: "extra" },
      { name: "native" },
      { run_id: 999 },
      { head_sha: "e".repeat(40) },
      { status: "queued" },
      { conclusion: "skipped" },
    ]) {
      const f = fixture(),
        list = jobList();
      Object.assign(list.jobs[0], patch);
      f.values.jobs = JSON.stringify(list);
      expect(await collectCloudSourceObservation({ runId }, f)).toMatchObject({
        kind: "unavailable",
        code: "checks-not-ready",
      });
      expect(f.build).not.toHaveBeenCalled();
    }
    for (const total_count of [2, 4, 101]) {
      const f = fixture();
      f.values.jobs = JSON.stringify({ ...jobList(), total_count });
      expect(await collectCloudSourceObservation({ runId }, f)).toMatchObject({
        kind: "unavailable",
        code: "checks-not-ready",
      });
    }
  });
  it("rejects source/lock/remote drift and a superseding retry or run after building", async () => {
    for (const drift of [
      "head",
      "tree",
      "lock",
      "status",
      "remote-main",
      "attempt",
      "run",
    ]) {
      const f = fixture();
      f.build.mockImplementation(async () => {
        if (drift === "remote-main")
          f.values["remote-main"] = JSON.stringify({
            ref: "refs/heads/main",
            object: { type: "commit", sha: "e".repeat(40) },
          });
        else if (drift === "attempt" || drift === "run") {
          const list = latest();
          if (drift === "attempt") list.workflow_runs[0].run_attempt++;
          else list.workflow_runs[0].id++;
          f.values["latest-run"] = JSON.stringify(list);
        } else
          f.values[drift] =
            drift === "lock" ? "changed lock" : "e".repeat(40) + "\n";
        return artifact();
      });
      expect((await collectCloudSourceObservation({ runId }, f)).kind).toBe(
        "unavailable",
      );
    }
  });
  it("rejects altered bytes, manifest identity/lock/file digests and nonreproducible builds", async () => {
    for (const patch of [
      { runtime: "nodejs26.x" },
      { architecture: "arm64" },
      { handler: "other" },
      { esbuild: "other" },
      { zipSha256: "e".repeat(64) },
      { zipBytes: 0 },
      { lockSha256: "e".repeat(64) },
      { files: { "handler.cjs": "bad" } },
    ]) {
      const f = fixture();
      f.build.mockImplementation(async () => {
        const a = artifact();
        Object.assign(a.manifest, patch);
        return a;
      });
      expect(await collectCloudSourceObservation({ runId }, f)).toMatchObject({
        kind: "unavailable",
        code: "artifact-mismatch",
      });
    }
    const f = fixture();
    f.build.mockImplementationOnce(async () => {
      const a = artifact();
      a.manifest.files["handler.cjs"] = "e".repeat(64);
      return a;
    });
    expect(await collectCloudSourceObservation({ runId }, f)).toMatchObject({
      kind: "unavailable",
      code: "artifact-mismatch",
    });
    const g = fixture();
    g.build.mockImplementationOnce(async () => {
      const a = artifact();
      a.zip[0] ^= 1;
      a.manifest.zipSha256 = hash(a.zip);
      return a;
    });
    expect(await collectCloudSourceObservation({ runId }, g)).toMatchObject({
      kind: "unavailable",
      code: "artifact-mismatch",
    });
  });
  it("captures input before awaits and rejects accessors/prototypes/extra fields", async () => {
    const f = fixture(),
      input = { runId };
    f.read.mockImplementation(async (c) => {
      input.runId = "changed";
      return f.values[c.kind];
    });
    const result = await collectCloudSourceObservation(input, f);
    expect(result.kind === "observed" && result.observation.runId).toBe(runId);
    let accessed = false;
    for (const bad of [
      { runId: runId + "\n" },
      { runId, extra: true },
      Object.create({ runId }),
      Object.defineProperty({}, "runId", {
        enumerable: true,
        get() {
          accessed = true;
          return runId;
        },
      }),
    ]) {
      expect(await collectCloudSourceObservation(bad, f)).toMatchObject({
        kind: "unavailable",
        code: "invalid-input",
      });
    }
    expect(accessed).toBe(false);
  });
  it("returns fixed errors for oversized, malformed or unavailable metadata without raw causes", async () => {
    for (const value of ["{private", "[]", "x".repeat(2 * 1024 * 1024 + 1)]) {
      const f = fixture();
      f.values.repository = value;
      expect(await collectCloudSourceObservation({ runId }, f)).toEqual({
        kind: "unavailable",
        code: "malformed-response",
        resourceWrites: 0,
      });
    }
    const f = fixture();
    f.read.mockRejectedValue(Error("private credentials"));
    expect(await collectCloudSourceObservation({ runId }, f)).toEqual({
      kind: "unavailable",
      code: "read-unavailable",
      resourceWrites: 0,
    });
  });
  it("aborts the shared deadline and refuses reversed or overrun clocks", async () => {
    vi.useFakeTimers();
    const f = fixture();
    let signal: AbortSignal | undefined;
    f.read.mockImplementation(async (_c, s) => {
      signal = s;
      return new Promise(() => {});
    });
    const pending = collectCloudSourceObservation({ runId }, f);
    await vi.advanceTimersByTimeAsync(90000);
    expect(await pending).toEqual({
      kind: "unavailable",
      code: "deadline",
      resourceWrites: 0,
    });
    expect(signal?.aborted).toBe(true);
    vi.useRealTimers();
    for (const end of [now - 1, now + 90001, NaN]) {
      const g = fixture(),
        times = [now, end];
      g.clock = () => times.shift()!;
      expect(await collectCloudSourceObservation({ runId }, g)).toMatchObject({
        kind: "unavailable",
        code: "clock-invalid",
      });
    }
  });
  it("exposes only fixed GET/git commands, latest attempt jobs and no success/head filter or pagination fallback", () => {
    for (const kind of [
      "branch",
      "status",
      "head",
      "tree",
      "origin-main",
      "origin",
      "repository",
      "remote-main",
      "workflow",
      "latest-run",
    ] as const) {
      const command = cloudSourceCommandArgs({ kind });
      expect(command.args.join(" ")).not.toMatch(
        /fetch|pull |reset|stash|--paginate|status=success|head_sha=/,
      );
      if (command.file === "gh") {
        expect(command.args).toContain("GET");
        expect(command.args).toContain("github.com");
      }
    }
    expect(
      cloudSourceCommandArgs({ kind: "jobs", runId: 123, attempt: 2 }).args,
    ).toContain(
      "repos/devsandip/peel/actions/runs/123/attempts/2/jobs?per_page=100",
    );
    expect(() =>
      cloudSourceCommandArgs({ kind: "jobs", runId: NaN, attempt: 2 }),
    ).toThrow("Cloud source observation unavailable");
  });
});
