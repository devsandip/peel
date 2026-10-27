import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { cloudDataIdentityTemplate } from "./data-identity.ts";
import {
  cloudCleanupGuardTemplate,
  cloudCleanupSentinelTemplate,
} from "./cleanup.ts";
import {
  cloudArtifactBootstrapTemplate,
  cloudPrivateHostingTemplate,
} from "./private-hosting.ts";

const repository = "devsandip/peel",
  repositoryId = 1435686213,
  workflowPath = ".github/workflows/checks.yml",
  jobs = ["cloud-artifact", "native", "web-and-core"] as const,
  limit = 2 * 1024 * 1024,
  deadlineMs = 90000,
  execute = promisify(execFile),
  root = fileURLToPath(new URL("../../", import.meta.url)),
  hash = (value: string | Uint8Array) =>
    createHash("sha256").update(value).digest("hex");
type Code =
  | "invalid-input"
  | "source-not-ready"
  | "repository-mismatch"
  | "checks-not-ready"
  | "source-drift"
  | "artifact-mismatch"
  | "read-unavailable"
  | "malformed-response"
  | "clock-invalid"
  | "deadline";
class SourceFailure extends Error {
  readonly code: Code;
  constructor(code: Code) {
    super("Cloud source observation unavailable");
    this.code = code;
  }
}
function fail(code: Code): never {
  throw new SourceFailure(code);
}
const full = (value: unknown, pattern: RegExp): value is string =>
  typeof value === "string" && pattern.exec(value)?.[0] === value;
const sha = (value: unknown, length = 40): value is string =>
  full(value, /^[a-f0-9]+$/) && value.length === length;
function positive(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}
export type CloudSourceCommand =
  | {
      kind:
        | "branch"
        | "status"
        | "head"
        | "tree"
        | "origin-main"
        | "origin"
        | "lock"
        | "repository"
        | "remote-main"
        | "workflow"
        | "latest-run";
    }
  | { kind: "jobs"; runId: number; attempt: number };
type Reader = (
  command: CloudSourceCommand,
  signal: AbortSignal,
) => Promise<string>;
type Artifact = { zip: Uint8Array; manifest: unknown };

/** Fixed read-only commands; no git mutation, log download or account access. */
export function cloudSourceCommandArgs(command: CloudSourceCommand) {
  const git = {
    branch: ["symbolic-ref", "--quiet", "--short", "HEAD"],
    status: ["status", "--porcelain=v1", "--untracked-files=all"],
    head: ["rev-parse", "--verify", "HEAD^{commit}"],
    tree: ["rev-parse", "--verify", "HEAD^{tree}"],
    "origin-main": ["rev-parse", "--verify", "refs/remotes/origin/main"],
    origin: ["remote", "get-url", "origin"],
  };
  if (Object.hasOwn(git, command.kind))
    return {
      file: "git",
      args: git[command.kind as keyof typeof git],
    };
  const paths = {
    repository: ["", "{id,full_name,private,default_branch}"],
    "remote-main": [
      "/git/ref/heads/main",
      "{ref,object:{type:.object.type,sha:.object.sha}}",
    ],
    workflow: ["/actions/workflows/checks.yml", "{id,path,state}"],
    "latest-run": [
      "/actions/workflows/checks.yml/runs?branch=main&event=push&per_page=1",
      "{total_count,workflow_runs:[.workflow_runs[]|{id,workflow_id,head_sha,head_branch,event,status,conclusion,run_attempt,path,repository:{id:.repository.id,full_name:.repository.full_name},head_repository:{id:.head_repository.id,full_name:.head_repository.full_name}}]}",
    ],
  };
  let path: string, query: string;
  if (command.kind === "jobs") {
    if (!positive(command.runId) || !positive(command.attempt))
      return fail("invalid-input");
    path = `/actions/runs/${command.runId}/attempts/${command.attempt}/jobs?per_page=100`;
    query =
      "{total_count,jobs:[.jobs[]|{name,run_id,head_sha,status,conclusion}]}";
  } else if (Object.hasOwn(paths, command.kind)) {
    [path, query] = paths[command.kind as keyof typeof paths];
  } else return fail("invalid-input");
  return {
    file: "gh",
    args: [
      "api",
      "--hostname",
      "github.com",
      "--method",
      "GET",
      "-H",
      "Accept: application/vnd.github+json",
      "-H",
      "X-GitHub-Api-Version: 2026-03-10",
      `repos/${repository}${path}`,
      "--jq",
      query,
    ],
  };
}
const defaultReader: Reader = async (command, signal) => {
  if (command.kind === "lock") {
    const bytes = await readFile(
      new URL("../../pnpm-lock.yaml", import.meta.url),
      { signal },
    );
    if (bytes.length > limit) return fail("malformed-response");
    return bytes.toString("utf8");
  }
  const { file, args } = cloudSourceCommandArgs(command);
  const { stdout } = await execute(file, args, {
    cwd: root,
    signal,
    timeout: 15000,
    maxBuffer: limit,
    encoding: "utf8",
    windowsHide: true,
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
      GH_PROMPT_DISABLED: "1",
      GH_PAGER: "cat",
    },
  });
  return stdout;
};
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return fail("malformed-response");
  return value as Record<string, unknown>;
}
function json(value: string) {
  try {
    return object(JSON.parse(value));
  } catch {
    return fail("malformed-response");
  }
}
function publicRepository(value: unknown) {
  const repo = object(value);
  if (repo.id !== repositoryId || repo.full_name !== repository)
    return fail("repository-mismatch");
}
function run(value: string, commit: string, workflowId: number) {
  const list = json(value);
  if (
    !positive(list.total_count) ||
    !Array.isArray(list.workflow_runs) ||
    list.workflow_runs.length !== 1
  )
    return fail("checks-not-ready");
  const latest = object(list.workflow_runs[0]);
  publicRepository(latest.repository);
  publicRepository(latest.head_repository);
  if (
    !positive(latest.id) ||
    !positive(latest.run_attempt) ||
    latest.workflow_id !== workflowId ||
    latest.path !== workflowPath ||
    latest.head_sha !== commit ||
    latest.head_branch !== "main" ||
    latest.event !== "push" ||
    latest.status !== "completed" ||
    latest.conclusion !== "success"
  )
    return fail("checks-not-ready");
  return { runId: latest.id, attempt: latest.run_attempt, workflowId };
}
function artifact(value: Artifact, lockSha256: string) {
  if (
    !(value?.zip instanceof Uint8Array) ||
    !value.zip.length ||
    value.zip.length > 20 * 1024 * 1024
  )
    return fail("artifact-mismatch");
  const manifest = object(value.manifest),
    files = object(manifest.files);
  if (
    Object.keys(manifest).sort().join() !==
      "architecture,esbuild,files,format,handler,lockSha256,runtime,zipBytes,zipSha256" ||
    manifest.format !== 1 ||
    manifest.runtime !== "nodejs24.x" ||
    manifest.handler !== "handler.handler" ||
    manifest.architecture !== "x86_64" ||
    manifest.esbuild !== "0.28.2" ||
    manifest.zipBytes !== value.zip.length ||
    manifest.zipSha256 !== hash(value.zip) ||
    manifest.lockSha256 !== lockSha256 ||
    Object.keys(files).sort().join() !==
      "THIRD_PARTY_NOTICES.txt,handler.cjs" ||
    !Object.values(files).every((v) => sha(v, 64))
  )
    return fail("artifact-mismatch");
  return {
    zip: Uint8Array.from(value.zip),
    manifest: JSON.stringify(manifest),
  };
}

/** A point-in-time input snapshot, never a run reservation or provisioning permission. */
export async function collectCloudSourceObservation(
  input: { runId: string },
  dependencies: {
    build: () => Promise<Artifact>;
    read?: Reader;
    clock?: () => number;
  },
) {
  const clock = dependencies.clock ?? Date.now,
    controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined,
    timedOut = false;
  try {
    if (
      !input ||
      typeof input !== "object" ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(input)) ||
      Reflect.ownKeys(input).length !== 1
    )
      return fail("invalid-input");
    const descriptor = Object.getOwnPropertyDescriptor(input, "runId"),
      runId: unknown = descriptor?.value;
    if (
      !descriptor?.enumerable ||
      !("value" in descriptor) ||
      !full(
        runId,
        /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,
      )
    )
      return fail("invalid-input");
    const started = clock();
    if (!Number.isSafeInteger(started) || started < 0)
      return fail("clock-invalid");
    const reader = dependencies.read ?? defaultReader;
    const read = async (command: CloudSourceCommand) => {
      const value = await reader(command, controller.signal);
      if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > limit)
        return fail("malformed-response");
      return value;
    };
    const snapshot = async () => {
      const kinds = [
        "branch",
        "status",
        "head",
        "tree",
        "origin-main",
        "origin",
        "lock",
      ] as const;
      const values = Object.fromEntries(
        await Promise.all(
          kinds.map(async (kind) => [kind, await read({ kind })]),
        ),
      );
      const line = (key: string) => values[key].replace(/\r?\n$/, "");
      if (
        line("branch") !== "main" ||
        values.status !== "" ||
        !sha(line("head")) ||
        !sha(line("tree")) ||
        line("head") !== line("origin-main") ||
        !values.lock.length
      )
        return fail("source-not-ready");
      if (
        ![
          "https://github.com/devsandip/peel.git",
          "git@github.com:devsandip/peel.git",
        ].includes(line("origin"))
      )
        return fail("repository-mismatch");
      return {
        commit: line("head"),
        tree: line("tree"),
        lockSha256: hash(values.lock),
      };
    };
    const work = async () => {
      const source = await snapshot();
      const repo = json(await read({ kind: "repository" }));
      publicRepository(repo);
      if (repo.private !== false || repo.default_branch !== "main")
        return fail("repository-mismatch");
      const remote = async () => {
        const ref = json(await read({ kind: "remote-main" })),
          target = object(ref.object);
        if (
          ref.ref !== "refs/heads/main" ||
          target.type !== "commit" ||
          target.sha !== source.commit
        )
          return fail("source-drift");
      };
      await remote();
      const workflow = json(await read({ kind: "workflow" }));
      if (
        !positive(workflow.id) ||
        workflow.path !== workflowPath ||
        workflow.state !== "active"
      )
        return fail("checks-not-ready");
      const ci = run(
        await read({ kind: "latest-run" }),
        source.commit,
        workflow.id,
      );
      const found = json(
        await read({ kind: "jobs", runId: ci.runId, attempt: ci.attempt }),
      );
      if (
        found.total_count !== jobs.length ||
        !Array.isArray(found.jobs) ||
        found.jobs.length !== jobs.length
      )
        return fail("checks-not-ready");
      const names = new Set();
      for (const item of found.jobs) {
        const job = object(item);
        if (
          !jobs.includes(job.name as (typeof jobs)[number]) ||
          names.has(job.name) ||
          job.run_id !== ci.runId ||
          job.head_sha !== source.commit ||
          job.status !== "completed" ||
          job.conclusion !== "success"
        )
          return fail("checks-not-ready");
        names.add(job.name);
      }
      const first = artifact(await dependencies.build(), source.lockSha256),
        second = artifact(await dependencies.build(), source.lockSha256);
      if (
        first.manifest !== second.manifest ||
        !Buffer.from(first.zip).equals(second.zip)
      )
        return fail("artifact-mismatch");
      if (JSON.stringify(await snapshot()) !== JSON.stringify(source))
        return fail("source-drift");
      await remote();
      const latest = run(
        await read({ kind: "latest-run" }),
        source.commit,
        workflow.id,
      );
      if (JSON.stringify(ci) !== JSON.stringify(latest))
        return fail("source-drift");
      const ended = clock();
      if (
        !Number.isSafeInteger(ended) ||
        ended < started ||
        ended - started > deadlineMs
      )
        return fail("clock-invalid");
      const start = Math.floor(ended / 1000) * 1000,
        lease = Object.freeze({
          startedAt: new Date(start).toISOString(),
          expiresAt: new Date(start + 90 * 60000).toISOString(),
        }),
        zipSha256 = hash(first.zip),
        zipBytes = first.zip.length;
      const templates = JSON.stringify({
        "data-identity": cloudDataIdentityTemplate(runId),
        "artifact-bootstrap": cloudArtifactBootstrapTemplate(runId),
        "cleanup-guard": cloudCleanupGuardTemplate({ runId, lease }),
        "cleanup-sentinel": cloudCleanupSentinelTemplate(runId),
        "private-hosting": cloudPrivateHostingTemplate({
          runId,
          lease,
          artifact: { sha256: zipSha256, bytes: zipBytes },
        }),
      });
      return Object.freeze({
        kind: "observed" as const,
        observation: Object.freeze({
          checkedAt: new Date(started).toISOString(),
          repository,
          repositoryId,
          runId,
          lease,
          source: Object.freeze({
            ...source,
            zipSha256,
            zipBytes,
            templatesSha256: hash(templates),
          }),
          mainCommit: source.commit,
          testedCommit: source.commit,
          worktree: "clean" as const,
          checks: Object.freeze({
            "cloud-artifact": "success",
            "web-and-core": "success",
            native: "success",
          }),
          ci: Object.freeze(ci),
          resourceWrites: 0 as const,
        }),
        zip: first.zip,
        templates,
      });
    };
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(new SourceFailure("deadline"));
      }, deadlineMs);
    });
    return await Promise.race([work(), timeout]);
  } catch (error) {
    controller.abort();
    return Object.freeze({
      kind: "unavailable" as const,
      code: timedOut
        ? "deadline"
        : error instanceof SourceFailure
          ? error.code
          : "read-unavailable",
      resourceWrites: 0 as const,
    });
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
