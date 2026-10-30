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

Two temporary controls fail as intended: omitting the nonempty-page stop fails its refusal case; changing the third fixed region fails the actual-argv scope case. The candidate is restored byte-for-byte and all 28 cases pass again. A direct Node 24 invocation without the explicit flag returns explicit-authorization-required without requesting identity/provider data. These are offline synthetic results, not actual audit observations or proof that the operator environment/permissions will work. Private harness artifacts stay ignored; hosted app checks do not execute this operator candidate. Antigravity independently reviewed the exact frozen runbook/candidate and synthetic harness snapshots at `d542c7d`, with Root-verified hashes and zero tools, and found no actionable blockers. Imported helpers were not re-read by that reviewer; Root reviewed their unchanged current implementations. Required exact-source and separate actual-main hosted gates remain pending.

Reviewed candidate SHA-256: 918a9f49d574da9b7f6d5c4c5dc385eb67debaf46bbfe83b259e4b6fc6b9437c.
