# Bounded audit diagnostic review packet

[Issue 219](https://github.com/devsandip/peel/issues/219) is one offline preparation slice under blocked [audit 51](https://github.com/devsandip/peel/issues/51) in [M2.2](https://github.com/devsandip/peel/milestone/2). SPEC FR-04/14/20 and AC-04/12/13 prerequisites, [audit observations](cloud-audit-observations.md) and [hosting controls](cloud-dev-hosting.md) govern it. This plan is committed before any candidate-program edits.

## Reviewable scope

Prepare a concrete operator candidate in this runbook, with exact extraction/invocation instructions and a hash of the reviewed source. The public deliverable is documentation, not a new runtime module, capability codec or app feature. Extracted candidate and its synthetic-only tests stay ignored under scratch. Use the existing inspection-identity and fixed audit-command helpers rather than inventing credentials or a new AWS client. No new package and no changes to those production helpers, the app or workflows.

A future explicitly authorized run may issue at most three sequential ListEventDataStores metadata reads, in order us-east-1, us-west-2, af-south-1, one item/page and no pagination. Independent original expected-account/profile pins must be supplied; never derive expected identity from observed STS output. Recheck current inspection identity and configured role before and after a completed sample. Do not export credentials or read audit event bodies, notes, selectors or configuration beyond the existing identity safety checks.

The hard combined deadline is 120 seconds, including both identity gates. Each Lake command has a 15-second maximum, one SDK/CLI attempt and fixed endpoint; identity retains its existing 45-second bound, capped by the same parent abort. The total deadline may refuse completion even when each individual bound has not expired. An operator-supplied fresh authorization cutoff must also be checked before/after every awaited stage; no default or automatically renewed cutoff.

Stop immediately on invalid/mismatched identity or role, unsupported environment, unknown/denied/malformed/nonempty/partial response, caller cancellation, expired cutoff or deadline. No later region or final identity read starts after such a stop. Only three complete empty pages proceed to the final identity check. Even then the result is merely a bounded diagnostic sample: full coverage, hooks/trails/organization visibility, auditReady and managed/teardown authority remain unproven. Never feed it into hosting readiness or infer SCP/opt-in/root cause.

Outputs contain fixed stage, reviewed public region, safe reason codes and small counts/booleans only. Drop raw provider output, messages, IDs, ARNs, account/profile strings and credentials. Preserve unrelated processes and settings. No provider/profile/config access is allowed during preparation. The expired October 28 allowance and stopped collector are not revived.

## Required offline evidence

Validate the exact extracted candidate with injected synthetic identity/commands, including full empty sample, immediate nonempty/partial/unknown/failure stopping, no retries/pagination, fixed scope/wire arguments, privacy, invalid inputs and getters, input capture, clock/cutoff/deadline/cancellation (including ignored stalls), account/role drift and absence of late work after stop. Deny network/default command execution in the tests. Document actual checks and limits; no fake live observation or passing unrun check.

Antigravity independently reviews a frozen source snapshot after its separate issue213 assignment exits. Codex runs the tests and checks, obtains the review, and submits one focused documentation PR closing219, referencing but not closing51. Required exact-source and separate actual-main gates still apply. Fresh specific operator approval of this concrete packet, private pins and current source/budget/authorization are separate from merging it. Actual51/30/31 acceptance stays blocked.

## Candidate status

The candidate below is implemented for offline review. No live command has been approved or executed. It is not an entry point in the app or hosting machinery. The explicit CLI flag records intent only; it does not grant permission. Fresh specific operator approval, independently pinned private identity, clean reviewed source and the existing cost/budget controls are still required before any live invocation.

## Execution conditions and extraction

Do not run the authorized invocation during preparation or from an automation. After explicit approval, use a clean verified checkout containing this reviewed runbook and unchanged identity/audit helper source. Confirm its commit and candidate hash against the final PR proof. Use the existing pinned Node 24.22.1 binary; do not acquire or install a runtime as part of this packet.

The exact program is the single JavaScript block below. Extracting/checking it writes only an ignored candidate, not a provider request. Extract from the repository root with this non-executing command:

````python
from pathlib import Path
import hashlib
source = Path("docs/features/cloud-audit-bounded-diagnostic.md").read_text()
parts = source.split("```javascript\n")
assert len(parts) == 2
code = parts[1].split("\n```", 1)[0] + "\n"
target = Path("scratch/audit-diagnostic-operator/candidate.mjs")
target.parent.mkdir(parents=True, exist_ok=True)
target.write_text(code)
print(hashlib.sha256(target.read_bytes()).hexdigest())
````

The hash must equal the reviewed hash recorded below. Do not execute if source or helper files changed, an authorization/budget gate is missing, or the inspected identity cannot be independently pinned.

Only after fresh approval, supply private values for `SYNKIES_AUDIT_PROFILE`, `SYNKIES_EXPECTED_ACCOUNT` and `SYNKIES_AUDIT_AUTHORIZED_UNTIL`. The account comes from the independent existing pin, never from current STS output. The cutoff is canonical UTC with milliseconds and must be future and no more than 15 minutes from startup. No defaults or credential values are accepted. The exact invocation is:

```bash
scratch/cloud-runtime/node-v24.22.1-darwin-arm64/bin/node scratch/audit-diagnostic-operator/candidate.mjs --execute-authorized "$SYNKIES_AUDIT_PROFILE" "$SYNKIES_EXPECTED_ACCOUNT" "$SYNKIES_AUDIT_AUTHORIZED_UNTIL"
```

The explicit flag is a deliberate-use guard, not proof of authorization. Calling the exported function with trusted synthetic dependencies likewise grants no live authority. Never paste raw operator inputs/provider output into GitHub. The before/after inspections may resolve the existing SSO identity through AWS CLI; they are included in the total deadline and are part of the future approval, not preparation. No credential export or login command is issued.

## Exact operator candidate

```javascript
import childProcess from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { collectCloudInspectionIdentity } from "../../infra/cloud/inspection-identity.ts";
import { assertCloudIdentityEnvironment } from "../../infra/cloud/identity-observations.ts";
import { cloudAuditCommercialRegions } from "../../infra/cloud/audit-regions.ts";
import {
  cloudAuditCommandArgs,
  cloudAuditLakeFailure,
} from "../../infra/cloud/audit-observations.ts";

const REGIONS = Object.freeze(["us-east-1", "us-west-2", "af-south-1"]);
class Stop extends Error {
  constructor(code) {
    super("Bounded audit diagnostic stopped");
    this.code = code;
  }
}
const stop = (code) => {
  throw new Stop(code);
};
function capture(value) {
  if (
    !value ||
    typeof value !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    return stop("invalid-input");
  const d = Object.getOwnPropertyDescriptors(value);
  if (
    Reflect.ownKeys(value).length !== 3 ||
    Object.keys(d).sort().join() !== "accountId,authorizedUntil,profile" ||
    Object.values(d).some((v) => !v.enumerable || !("value" in v))
  )
    return stop("invalid-input");
  const profile = d.profile.value,
    accountId = d.accountId.value,
    authorizedUntil = d.authorizedUntil.value;
  if (
    typeof profile !== "string" ||
    /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.exec(profile)?.[0] !== profile ||
    typeof accountId !== "string" ||
    /^\d{12}$/.exec(accountId)?.[0] !== accountId ||
    typeof authorizedUntil !== "string" ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(authorizedUntil) ||
    !Number.isSafeInteger(Date.parse(authorizedUntil)) ||
    new Date(authorizedUntil).toISOString() !== authorizedUntil
  )
    return stop("invalid-input");
  return Object.freeze({ profile, accountId, authorizedUntil });
}
const validClock = (n) =>
  Number.isSafeInteger(n) && n >= 0 && Number.isFinite(new Date(n).getTime());
async function execute(args, signal, env) {
  const { stdout } = await promisify(childProcess.execFile)("aws", args, {
    signal,
    env,
    timeout: 15000,
    maxBuffer: 65536,
    encoding: "utf8",
    windowsHide: true,
  });
  return stdout;
}
function countPage(raw) {
  if (typeof raw !== "string" || Buffer.byteLength(raw) > 65536)
    return stop("malformed-response");
  let page;
  try {
    page = JSON.parse(raw);
  } catch {
    return stop("malformed-response");
  }
  if (
    !page ||
    typeof page !== "object" ||
    Array.isArray(page) ||
    Object.keys(page).sort().join() !== "Count,NextToken" ||
    ![0, 1].includes(page.Count) ||
    !(
      page.NextToken === null ||
      (typeof page.NextToken === "string" && page.NextToken.length > 0)
    )
  )
    return stop("malformed-response");
  if (page.Count !== 0) return stop("nonempty");
  if (page.NextToken !== null) return stop("incomplete");
}

/** Trusted test dependencies do not authorize a live run. CLI requires explicit operator approval. */
export async function diagnose(input, dependencies = {}) {
  const identity = dependencies.identity ?? collectCloudInspectionIdentity,
    run = dependencies.execute ?? execute,
    clock = dependencies.clock ?? Date.now,
    caller = dependencies.signal,
    controller = new AbortController(),
    steps = [];
  let activeStage = null,
    activeRegion = null,
    before = false,
    after = false,
    terminal = null,
    globalTimer,
    cutoffTimer,
    callerListener,
    rejectCanceled,
    closeStage = () => {};
  const result = (code) =>
    Object.freeze({
      kind: "bounded-audit-diagnostic",
      status: code === "sample-complete" ? "sample-complete" : "stopped",
      code,
      stage: activeStage,
      region: [
        "aborted",
        "deadline",
        "authorization-expired",
        "clock-invalid",
      ].includes(code)
        ? null
        : activeRegion,
      identityBefore: before,
      identityAfter: after,
      steps: Object.freeze(steps.map((step) => Object.freeze({ ...step }))),
      fullCoverage: "unproven",
      auditReady: false,
      resourceWrites: 0,
    });
  const cancel = (code) => {
    terminal ??= code;
    controller.abort();
    rejectCanceled?.(new Stop(terminal));
  };
  try {
    const pinned = capture(input),
      started = clock(),
      cutoff = Date.parse(pinned.authorizedUntil);
    if (!validClock(started)) return stop("clock-invalid");
    if (caller?.aborted) return stop("aborted");
    if (cutoff <= started) return stop("authorization-expired");
    // A fresh short allowance is explicit input, never renewed by this program.
    if (cutoff - started > 15 * 60000) return stop("invalid-input");
    const sourceEnv = { ...(dependencies.env ?? process.env) };
    try {
      assertCloudIdentityEnvironment(sourceEnv);
    } catch {
      return stop("unsupported-environment");
    }
    const env = Object.freeze({
      ...sourceEnv,
      AWS_IGNORE_CONFIGURED_ENDPOINT_URLS: "true",
      AWS_EC2_METADATA_DISABLED: "true",
      AWS_MAX_ATTEMPTS: "1",
      AWS_RETRY_MODE: "standard",
      AWS_PAGER: "",
      AWS_CLI_AUTO_PROMPT: "off",
    });
    let last = started;
    const check = () => {
      if (terminal) return stop(terminal);
      const now = clock();
      if (!validClock(now) || now < last) return stop("clock-invalid");
      last = now;
      if (caller?.aborted || controller.signal.aborted) return stop("aborted");
      if (now >= cutoff) return stop("authorization-expired");
      if (now - started >= 120000) return stop("deadline");
    };
    const canceled = new Promise((_, reject) => {
      rejectCanceled = reject;
    });
    callerListener = () => cancel("aborted");
    caller?.addEventListener("abort", callerListener, { once: true });
    if (caller?.aborted) cancel("aborted");
    globalTimer = setTimeout(() => cancel("deadline"), 120000);
    cutoffTimer = setTimeout(
      () => cancel("authorization-expired"),
      cutoff - started,
    );
    const stage = async (name, region, ms, operation) => {
      check();
      activeStage = name;
      activeRegion = region;
      const child = new AbortController(),
        link = () => child.abort(),
        timer = setTimeout(() => cancel("deadline"), ms);
      controller.signal.addEventListener("abort", link, { once: true });
      if (controller.signal.aborted) child.abort();
      let closed = false;
      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearTimeout(timer);
        controller.signal.removeEventListener("abort", link);
      };
      closeStage = cleanup;
      try {
        const value = await Promise.race([
          Promise.resolve().then(() => {
            check();
            return operation(child.signal);
          }),
          canceled,
        ]);
        check();
        return value;
      } finally {
        cleanup();
      }
    };
    const inspect = async (name) => {
      const seen = await stage(name, null, 45000, (signal) =>
        identity(
          {
            profile: pinned.profile,
            accountId: pinned.accountId,
            region: "us-east-1",
          },
          { signal },
        ),
      );
      if (seen?.kind !== "observed" || seen.summary?.identityVerified !== true)
        return stop("identity-unavailable");
      if (
        seen.expectedIdentity?.profile !== pinned.profile ||
        seen.expectedIdentity?.accountId !== pinned.accountId ||
        seen.expectedIdentity?.region !== "us-east-1"
      )
        return stop("identity-mismatch");
      if (
        typeof seen.configuredRoleName !== "string" ||
        /^[A-Za-z0-9_+=,.@-]{1,32}$/.exec(seen.configuredRoleName)?.[0] !==
          seen.configuredRoleName
      )
        return stop("identity-mismatch");
      return seen.configuredRoleName;
    };
    const work = async () => {
      const role = await inspect("identity-before");
      before = true;
      for (const region of REGIONS) {
        let raw;
        try {
          raw = await stage("lake", region, 15000, (signal) =>
            run(
              Object.freeze([
                ...cloudAuditCommandArgs(
                  pinned.profile,
                  { kind: "lake", region },
                  cloudAuditCommercialRegions,
                ),
              ]),
              signal,
              env,
            ),
          );
        } catch (error) {
          if (error instanceof Stop) throw error;
          return stop(cloudAuditLakeFailure(error));
        }
        countPage(raw);
        steps.push({ region, code: "empty", count: 0 });
      }
      if ((await inspect("identity-after")) !== role)
        return stop("role-mismatch");
      after = true;
      check();
      return result("sample-complete");
    };
    return await Promise.race([work(), canceled]);
  } catch (error) {
    return result(
      terminal ?? (error instanceof Stop ? error.code : "read-unavailable"),
    );
  } finally {
    controller.abort();
    closeStage();
    clearTimeout(globalTimer);
    clearTimeout(cutoffTimer);
    if (callerListener) caller?.removeEventListener("abort", callerListener);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  let value;
  if (process.versions.node.split(".")[0] !== "24")
    value = {
      kind: "bounded-audit-diagnostic",
      status: "stopped",
      code: "unsupported-runtime",
      auditReady: false,
      resourceWrites: 0,
    };
  else if (
    process.argv.length !== 6 ||
    process.argv[2] !== "--execute-authorized"
  )
    value = {
      kind: "bounded-audit-diagnostic",
      status: "stopped",
      code: "explicit-authorization-required",
      auditReady: false,
      resourceWrites: 0,
    };
  else
    value = await diagnose({
      profile: process.argv[3],
      accountId: process.argv[4],
      authorizedUntil: process.argv[5],
    });
  console.log(JSON.stringify(value));
}
```

## Local evidence and limits

Pinned Node 24 executes the exact extracted candidate with synthetic identity and command injection. The private harness denies child-process execution and sockets/fetch, then asserts zero attempts; it never loads actual profiles or operator inputs. All 28 cases pass, covering actual constructed argv/endpoints/page size, ordering, immediate/later refusal, structured error privacy, malformed/oversized pages, strict/getter/newline inputs, captured pins/functions/environment, identity/account/role drift, reversed/invalid clocks, 15/45-second ignored stalls, combined 120-second deadline including final identity, cutoff expiry, abort/listener cleanup and suppression of late work. Both complete and stopped outputs are frozen and retain auditReady false/fullCoverage unproven.

Two temporary controls fail as intended: omitting the nonempty-page stop fails its refusal case; changing the third fixed region fails the actual-argv scope case. The candidate is restored byte-for-byte and all 28 cases pass again. A direct Node 24 invocation without the explicit flag returns explicit-authorization-required without requesting identity/provider data. These are offline synthetic results, not actual audit observations or proof that the operator environment/permissions will work. Extracted harness artifacts stay ignored; its exact synthetic source and replay instructions are included below. Hosted app checks do not execute this operator candidate. Antigravity independently reviewed the exact frozen runbook/candidate and synthetic harness snapshots at `d542c7d`, with Root-verified hashes and zero tools, and found no actionable blockers. Imported helpers were not re-read by that reviewer; Root reviewed their unchanged current implementations. Required exact-source and separate actual-main hosted gates remain pending.

Reviewed candidate SHA-256: 918a9f49d574da9b7f6d5c4c5dc385eb67debaf46bbfe83b259e4b6fc6b9437c.

## Reproduce the synthetic checks

The exact synthetic harness reviewed above is included here so the offline evidence is reproducible from this single runbook. This is the same reviewed harness, not private operator data. Its extracted files remain ignored under scratch; ordinary hosted app checks do not execute it.

After the program extraction, extract this one text block and write the fixed isolated Vitest configuration. This command writes files only and makes no provider request:

````python
from pathlib import Path
import hashlib
source = Path("docs/features/cloud-audit-bounded-diagnostic.md").read_text()
parts = source.split("```text\n")
assert len(parts) == 2
code = parts[1].split("\n```", 1)[0] + "\n"
folder = Path("scratch/audit-diagnostic-operator")
folder.mkdir(parents=True, exist_ok=True)
(folder / "candidate.test.ts").write_text(code)
assert hashlib.sha256(code.encode()).hexdigest() == "1a38efac554b006ffc911dbd8ef76a9bfb6cd862b7cbc7a4d395c5a467621ad5"
(folder / "vitest.config.ts").write_text('import { defineConfig } from "vitest/config"; export default defineConfig({ test: { include: ["scratch/audit-diagnostic-operator/candidate.test.ts"], maxWorkers: 4 } });\n')
````

Using the existing checked-in development dependencies and pinned runtime, run only the extracted synthetic harness. No runtime/package acquisition or live invocation is part of this command:

```bash
scratch/cloud-runtime/node-v24.22.1-darwin-arm64/bin/node node_modules/vitest/vitest.mjs run --config scratch/audit-diagnostic-operator/vitest.config.ts
```

Expected result is 28 passing synthetic cases with zero actual child-process or network attempts. Raw synthetic strings in refusal tests are deliberately fake. The harness below is plain text to preserve its exact reviewed bytes and hash through Markdown formatting:

```text
import cp from "node:child_process";
import net from "node:net";
import tls from "node:tls";
import http from "node:http";
import https from "node:https";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("node:child_process", () => {
  const forbidden = vi.fn(() => { throw Error("Provider process forbidden in synthetic tests"); });
  return { default: { execFile: forbidden }, execFile: forbidden };
});
import { diagnose } from "./candidate.mjs";

const NOW = Date.parse("2026-10-31T01:00:00.000Z");
const input = () => ({ profile: "synthetic-only", accountId: "111122223333", authorizedUntil: new Date(NOW + 600000).toISOString() });
const seen = (pin: object, role = "Synthetic") => ({ kind: "observed", expectedIdentity: pin, configuredRoleName: role, summary: { identityVerified: true } });
function fixture() {
  return { identity: vi.fn(async (pin: object) => seen(pin)), execute: vi.fn(async () => '{"Count":0,"NextToken":null}'), clock: () => NOW, env: {} };
}
function barrier() {
  let reached!: () => void, release!: () => void;
  const arrived = new Promise<void>((resolve) => { reached = resolve; });
  const pending = new Promise<void>((resolve) => { release = resolve; });
  return { arrived, reached, pending, release };
}
let network: ReturnType<typeof vi.fn>;
beforeEach(() => {
  network = vi.fn(() => { throw Error("Network forbidden in synthetic tests"); });
  vi.spyOn(net, "connect").mockImplementation(network as never);
  vi.spyOn(net, "createConnection").mockImplementation(network as never);
  vi.spyOn(tls, "connect").mockImplementation(network as never);
  vi.spyOn(http, "request").mockImplementation(network as never);
  vi.spyOn(https, "request").mockImplementation(network as never);
  vi.spyOn(globalThis, "fetch").mockImplementation(network as never);
});
afterEach(() => {
  try { expect(network).not.toHaveBeenCalled(); expect(cp.execFile).not.toHaveBeenCalled(); }
  finally { vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllEnvs(); }
});
function safe(result: unknown) {
  const text = JSON.stringify(result);
  for (const secret of ["111122223333", "999900001111", "synthetic-only", "Synthetic", "private", "arn:aws", "SecretAccessKey", "SessionToken"]) expect(text).not.toContain(secret);
  expect(result).toMatchObject({ fullCoverage: "unproven", auditReady: false, resourceWrites: 0 });
  function frozen(value: unknown) { if (value && typeof value === "object") { expect(Object.isFrozen(value)).toBe(true); Object.values(value).forEach(frozen); } }
  frozen(result);
}

it("uses the actual scoped argv once in each fixed region and never grants full coverage", async () => {
  const f = fixture(), result = await diagnose(input(), f);
  expect(result).toMatchObject({ status: "sample-complete", code: "sample-complete", identityBefore: true, identityAfter: true });
  expect(f.identity).toHaveBeenCalledTimes(2); expect(f.execute).toHaveBeenCalledTimes(3);
  for (const [index, region] of ["us-east-1", "us-west-2", "af-south-1"].entries()) {
    const [args, signal, env] = f.execute.mock.calls[index] as unknown as [string[], AbortSignal, Record<string,string>];
    expect(args).toContain("list-event-data-stores"); expect(args).toContain(`https://cloudtrail.${region}.amazonaws.com`);
    expect(args[args.indexOf("--region") + 1]).toBe(region); expect(args[args.indexOf("--max-results") + 1]).toBe("1");
    expect(args).toContain("--no-paginate"); expect(args).toContain("{Count:length(EventDataStores),NextToken:NextToken}");
    expect(args).toContain("--cli-error-format"); expect(args.join(" ")).not.toMatch(/export-credentials|lookup-events|start-query|next-token|create-|delete-|update-|debug/);
    expect(signal).toBeInstanceOf(AbortSignal); expect(env).toMatchObject({ AWS_MAX_ATTEMPTS: "1", AWS_PAGER: "", AWS_CLI_AUTO_PROMPT: "off", AWS_IGNORE_CONFIGURED_ENDPOINT_URLS: "true" });
    expect(Object.isFrozen(args) && Object.isFrozen(env)).toBe(true);
  }
  expect(result.steps).toEqual(["us-east-1", "us-west-2", "af-south-1"].map(region => ({ region, code: "empty", count: 0 })));
  safe(result);
});
it.each([
  ['{"Count":1,"NextToken":null}', "nonempty"],
  ['{"Count":0,"NextToken":"private-token"}', "incomplete"],
  ['{"Count":0,"NextToken":""}', "malformed-response"],
  ['{"Count":2,"NextToken":null}', "malformed-response"],
  ['{"Count":0,"NextToken":null,"private":"message"}', "malformed-response"],
  ["[]", "malformed-response"], ["{", "malformed-response"], ["x".repeat(65537), "malformed-response"],
])("stops at the first refused count page without a later read (%s)", async (raw, code) => {
  const f = fixture(); f.execute.mockResolvedValue(raw);
  const result = await diagnose(input(), f);
  expect(result).toMatchObject({ status: "stopped", code, stage: "lake", region: "us-east-1", identityAfter: false });
  expect(f.execute).toHaveBeenCalledTimes(1); expect(f.identity).toHaveBeenCalledTimes(1); safe(result);
});
it.each(["UnrecognizedClientException", "AccessDeniedException", "UnsupportedOperationException", "OtherException"])("drops service messages and stops without a retry (%s)", async (Code) => {
  const f = fixture(); f.execute.mockRejectedValue({ code: 254, stdout: "", stderr: JSON.stringify({ Code, Message: "private arn:aws fake", SessionToken: "private" }) });
  const result = await diagnose(input(), f);
  expect(result.status).toBe("stopped"); expect(result.code).toMatch(/^lake-/); expect(f.execute).toHaveBeenCalledTimes(1); expect(f.identity).toHaveBeenCalledTimes(1); safe(result);
});
it("stops a later region in order and does not perform the final identity read", async () => {
  const f = fixture(); f.execute.mockResolvedValueOnce('{"Count":0,"NextToken":null}').mockResolvedValueOnce('{"Count":1,"NextToken":null}');
  const result = await diagnose(input(), f);
  expect(result).toMatchObject({ code: "nonempty", region: "us-west-2" }); expect(result.steps).toHaveLength(1);
  expect(f.execute).toHaveBeenCalledTimes(2); expect(f.identity).toHaveBeenCalledTimes(1); safe(result);
});
it("rejects getters, extra fields, inherited objects, newlines, stale/unbounded cutoffs and invalid clocks before I/O", async () => {
  const getter = vi.fn(() => "synthetic-only");
  for (const bad of [null, { ...input(), region: "us-west-2" }, Object.create(input()), { ...input(), profile: "synthetic-only\n" }, { ...input(), accountId: "111122223333\n" }, { ...input(), authorizedUntil: new Date(NOW).toISOString() }, { ...input(), authorizedUntil: new Date(NOW+960000).toISOString() }, Object.defineProperty(input(), "profile", { get: getter })]) {
    const f = fixture(), result = await diagnose(bad, f); expect(result.status).toBe("stopped"); expect(f.identity).not.toHaveBeenCalled(); expect(f.execute).not.toHaveBeenCalled(); safe(result);
  }
  expect(getter).not.toHaveBeenCalled();
  for (const n of [NaN, -1]) { const f=fixture(); f.clock=()=>n; expect((await diagnose(input(),f)).code).toBe("clock-invalid"); expect(f.identity).not.toHaveBeenCalled(); }
  const f=fixture(); f.env={ AWS_ENDPOINT_URL: "https://private.example" }; expect((await diagnose(input(),f)).code).toBe("unsupported-environment"); expect(f.identity).not.toHaveBeenCalled();
});
it("captures pins, functions and environment before any await", async () => {
  const f=fixture(), original=f.execute, pin=input(), gate=barrier();
  f.identity.mockImplementationOnce(async (p) => { gate.reached(); await gate.pending; return seen(p); });
  const task=diagnose(pin,f); await gate.arrived;
  pin.profile="foreign"; pin.accountId="999900001111"; pin.authorizedUntil=new Date(NOW-1).toISOString();
  f.execute=vi.fn(async()=>{throw Error("private unexpected replacement");}); f.clock=()=>NaN; Object.assign(f.env,{AWS_ENDPOINT_URL:"https://private.example"}); gate.release();
  const result=await task; expect(result.status).toBe("sample-complete"); expect(original).toHaveBeenCalledTimes(3); expect(f.execute).not.toHaveBeenCalled(); for(const call of original.mock.calls) expect((call as unknown as [unknown,unknown,object])[2]).not.toHaveProperty("AWS_ENDPOINT_URL"); safe(result);
});
it.each(["before", "after", "role", "unavailable"])("refuses identity or role drift (%s)", async (kind) => {
  const f=fixture(); let count=0;
  f.identity.mockImplementation(async (pin) => { count++; if(kind==="unavailable") return {kind:"unavailable"} as never; const value=seen(pin,kind==="role"&&count===2?"Other":"Synthetic"); if((kind==="before"&&count===1)||(kind==="after"&&count===2)) value.expectedIdentity={...pin,accountId:"999900001111"}; return value; });
  const result=await diagnose(input(),f); expect(result.status).toBe("stopped"); expect(result.identityAfter).toBe(false); expect(f.execute).toHaveBeenCalledTimes(kind==="before"||kind==="unavailable"?0:3); safe(result);
});
it.each(["identity-before", "lake", "identity-after"])("bounds an ignored %s stall and suppresses all late work", async (stage) => {
  vi.useFakeTimers(); const f=fixture(), gate=barrier(); let signal!:AbortSignal, identities=0;
  f.identity.mockImplementation(async (pin, options) => { identities++; if(stage==="identity-before"&&identities===1||stage==="identity-after"&&identities===2) { signal=options.signal; gate.reached(); await gate.pending; } return seen(pin); });
  f.execute.mockImplementation(async (_args,s) => { if(stage==="lake") { signal=s; gate.reached(); await gate.pending; } return '{"Count":0,"NextToken":null}'; });
  const task=diagnose(input(),f); await gate.arrived; await vi.advanceTimersByTimeAsync(stage==="lake"?15000:45000);
  const result=await task; expect(result).toMatchObject({code:"deadline",region:null,identityAfter:false}); expect(signal.aborted).toBe(true); const counts=[f.identity.mock.calls.length,f.execute.mock.calls.length]; gate.release(); await vi.advanceTimersByTimeAsync(1); expect([f.identity.mock.calls.length,f.execute.mock.calls.length]).toEqual(counts); expect(vi.getTimerCount()).toBe(0); safe(result);
});
it("applies the combined 120s deadline including both identities and ignores a late final result", async () => {
  vi.useFakeTimers(); const f=fixture();
  f.identity.mockImplementation(async(pin)=>{await new Promise(r=>setTimeout(r,40000));return seen(pin);});
  f.execute.mockImplementation(async()=>{await new Promise(r=>setTimeout(r,14000));return '{"Count":0,"NextToken":null}';});
  const task=diagnose(input(),f); await vi.advanceTimersByTimeAsync(120000); const result=await task;
  expect(result).toMatchObject({code:"deadline",stage:"identity-after",identityBefore:true,identityAfter:false}); expect(result.steps).toHaveLength(3); expect(f.execute).toHaveBeenCalledTimes(3);
  await vi.advanceTimersByTimeAsync(10000); expect(f.execute).toHaveBeenCalledTimes(3); expect(result.identityAfter).toBe(false); expect(vi.getTimerCount()).toBe(0); safe(result);
});
it("expires a fresh cutoff during an ignored identity stall without starting a command", async () => {
  vi.useFakeTimers(); const f=fixture(), gate=barrier(), pin={...input(),authorizedUntil:new Date(NOW+5000).toISOString()};
  f.identity.mockImplementation(async(p)=>{gate.reached();await gate.pending;return seen(p);});
  const task=diagnose(pin,f); await gate.arrived; await vi.advanceTimersByTimeAsync(5000); const result=await task;
  expect(result.code).toBe("authorization-expired"); expect(f.execute).not.toHaveBeenCalled(); gate.release(); await vi.advanceTimersByTimeAsync(1); expect(vi.getTimerCount()).toBe(0); safe(result);
});
it("honors the original caller signal and removes its registration on abort", async () => {
  const f=fixture(), gate=barrier(), controller=new AbortController(), remove=vi.spyOn(controller.signal,"removeEventListener");
  f.execute.mockImplementation(async()=>{gate.reached();await gate.pending;return '{"Count":0,"NextToken":null}';});
  const deps={...f,signal:controller.signal}, task=diagnose(input(),deps); await gate.arrived; deps.signal=new AbortController().signal; controller.abort("private abort reason");
  const result=await task; expect(result.code).toBe("aborted"); expect(remove).toHaveBeenCalledWith("abort",expect.any(Function)); gate.release(); await Promise.resolve(); safe(result);
  const pre=fixture(); expect((await diagnose(input(),{...pre,signal:controller.signal})).code).toBe("aborted"); expect(pre.identity).not.toHaveBeenCalled();
});
it("refuses a reversed clock after identity without starting a metadata command", async () => {
  const f=fixture(); let reads=0; f.clock=()=>++reads<=3?NOW:NOW-1;
  const result=await diagnose(input(),f); expect(result.code).toBe("clock-invalid"); expect(f.execute).not.toHaveBeenCalled(); safe(result);
});
it("does not retain thrown identity details or start a command after identity failure", async () => {
  const f=fixture(); f.identity.mockRejectedValue(new Error("private 111122223333 arn:aws credential details"));
  const result=await diagnose(input(),f); expect(result).toMatchObject({status:"stopped",code:"read-unavailable",stage:"identity-before"}); expect(f.execute).not.toHaveBeenCalled(); safe(result);
});
```

## Automated synthetic validation follow-up, 31 October 2026

[Issue223](https://github.com/devsandip/peel/issues/223) adds an offline-only CI replay of this exact canonical candidate and harness. The earlier hosted-check limitation describes the original issue219 evidence. The new pinned Node24 cloud-artifact steps run `node --test tests/scripts/cloud-audit-diagnostic.test.mjs` and `node scripts/check-cloud-audit-diagnostic.mjs`; they verify the reviewed hashes before extraction, isolate temporary synthetic configuration and require all28 cases without skips. They never invoke the candidate CLI. No candidate/harness bytes, provider helpers, actual authorization or app behavior changes. See the [CI replay plan](cloud-audit-diagnostic-ci.md) for validation evidence and limits. Actual provider/profile execution remains subject to the separate review and authorization above.
