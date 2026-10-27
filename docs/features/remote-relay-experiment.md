# Isolated remote relay feasibility

## Requirements and plan

FR-14/17/19 and AC-10/21/25 require direct and forced-relay connectivity on different networks, authenticated peers and no server note storage. Current host-channel experiments do not establish those gates. Native WebKit repeatability is separately blocked in [native-peer-runtime.md](native-peer-runtime.md); do not rerun that component while conditions are unchanged.

1. Prepare a disposable CloudFormation stack: one t4g.micro with Standard CPU credits, encrypted 8 GB gp3 root, one public IPv4, its own VPC/subnet/gateway/security group and SSM administration. No SSH, NAT gateway, EIP reservation, note database, object bucket, load balancer or paid app entitlement. Restrict client ingress to the verified current client's single IPv4 address and relay self-traffic.
2. Install the Ubuntu repository's Coturn candidate and record the exact package version if deployed. Generate its authentication secret on the VM into /run; keep configuration/auth data in memory-backed paths. Use short-lived HMAC credentials, small allocation/bandwidth limits, bounded relay ports and an explicit peer allowlist. Disable payload/credential logs, capture, core dumps and swap. Serve no application API and accept no real notes.
3. Arm guest shutdown/termination before package setup, with an independent one-time Scheduler termination target and root-volume deletion. The launcher deletes the whole tagged stack in finally and verifies cleanup. The scheduled role can terminate only this instance and is scoped to its dedicated schedule group/account. No Auto Scaling replacement or retention/snapshot policy.
4. Reverify the admin profile's account and us-east-1 immediately before writes, match a private expected-account record, validate an official Canonical ARM64 AMI, fetch current prices and estimate the run before deployment. Reject broad ingress, larger resources, missing termination guards, stale plans and unrelated resource changes. Target under USD 0.10 for one run, with USD 2 as the experiment allowance; AWS billing is not a hard transactional spending cap, so termination/quotas/cleanup are the operational controls.
5. Test the lease/auth contract and unsafe-plan rejection locally, then use AWS template validation before provisioning. On deployment verify SSM, runtime flags/version and active termination guards before requesting credentials. Never print/store a master secret, access token, note, SDP or address in committed evidence. Private temporary lease/state files stay under ignored scratch with restrictive permissions.
6. Run synthetic browser transfers with relay-only ICE and inspect selected candidate types/DTLS. Invalid and expired credentials must not silently fall back to host connectivity. Delete resources and record only booleans/counters/environment/cost assumptions. Two clients on this Mac via a remote relay are a relay-operation experiment, not proof of different client networks, native/iPhone or production pairing. Broader acceptance remains open.

## Cost and account observations

On 27 October IST, a read-only STS check verified the existing admin profile in us-east-1. The account identity is held only in ignored private scratch. No resource was created by that check. AWS Price List API currently reports Linux t4g.micro at USD 0.0084/hour, public IPv4 at USD 0.005/hour and gp3 at USD 0.08/GB-month (effective 1 October 2026). Ordinary first-tier internet transfer out is USD 0.09/GB beyond the shared free tier; do not assume unused free allowance. A one-hour compute/address/8 GB disk allowance is approximately USD 0.0143 before transfer and tax. Bound Coturn capacity/time and retain headroom for overhead. [Pricing API](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/price-changes.html), [IPv4 pricing](https://aws.amazon.com/vpc/pricing/).

Use Coturn's documented authentication, allocation and bytes-per-second options, and explicitly avoid anonymous defaults. [Coturn upstream configuration](https://github.com/coturn/coturn/blob/master/examples/etc/turnserver.conf), [Coturn server reference](https://github.com/coturn/coturn/wiki/turnserver). Package-supported options must be verified on the candidate before opening the experiment.

Canonical documents the regional Ubuntu image SSM parameters. [Ubuntu image selection](https://documentation.ubuntu.com/aws/aws-how-to/instances/build-cloudformation-templates/). AWS documents OS-initiated termination and Scheduler universal targets. Scope the Scheduler trust condition to a schedule-group ARN, not a schedule ARN. [Shutdown behavior](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/Using_ChangingInstanceInitiatedShutdownBehavior.html), [universal target](https://docs.aws.amazon.com/scheduler/latest/UserGuide/managing-targets-universal.html), [Scheduler trust](https://docs.aws.amazon.com/scheduler/latest/UserGuide/cross-service-confused-deputy-prevention.html).

## Evidence

CloudFormation source, memory-backed runtime configuration, HMAC lease/metadata-only readiness helpers, a read-only prepare script and preflight/cleanup contracts are implemented. TypeScript, shell/Python syntax and all 66 shared cases pass. Seven new cases cover account/client drift, stale plans, cost/volume/ingress/termination mutations, Python/Node HMAC agreement, expired/substituted leases, cleanup on success/failure/lost create response, unrelated-stack refusal and local checkpoint failure not preventing deletion.

The prepare script reverified the private expected account, single client address, official Canonical Ubuntu 24.04 ARM64 image/owner and current rates, then passed AWS template validation. It wrote only private ignored plan/template/validation files. Its deliberately conservative allowance estimate is USD 0.2286 (two hours of base resources plus USD 0.20 transfer headroom), below the USD 2 experiment allowance. These preparation checks created no resources. Actual disposable execution and its limits are recorded below; the estimate is not an observed bill.

The current candidate image is the official regional noble ARM64 server image dated 23 October 2026. Verify it again on each prepared plan. Runtime flags, guest timer, Scheduler configuration and peer self-routing require execution evidence. Scheduler invocation itself remains untested. Keep the native WebKit stall separate. This experiment does not enable paid app billing, app sync or a public endpoint for general users.

## Read-only preflight

```bash
node scripts/prepare-relay.mjs
```

The script requires the ignored private account-verification record. It validates a fresh plan and creates no resources. Only synthetic fixtures are permitted for the later disposable run; the normal application must not read its temporary TURN lease.

## Disposable runner

scripts/run-relay.mjs now checks the current account/client/cutoff, plan age and exact template/source hash before an optional --apply. It checkpoints before create, inspects ownership after failed/unknown create responses, refuses to claim an unresolved absent create as cleaned up, waits for stack settlement and deletes by the verified stack ID. Cleanup also checks no tagged nonterminated instance remains. Failed status writes cannot skip the lifecycle's deletion path. The lifecycle's simulated failure cases are separate from the first actual execution below.

The runner verifies active Scheduler/guest controls and metadata-only service health before reading a short-lived lease. Its separate fresh-profile browser fixture requests relay-only UDP/TCP channels and bounded invalid/expired-credential controls. It returns hashes-as-booleans, counts and candidate types; no credential, SDP, address or synthetic body enters committed output. An expired lease helper option exists only for the private M0 negative control.

```bash
PEEL_RELAY_CUTOFF=2026-10-27T02:30:00Z node scripts/run-relay.mjs scratch/relay-<fresh-run>
# Add --apply only after the same fresh plan passes the read-only runner.
```

The source/metadata gates and JavaScript/TypeScript checks pass. The original user authorization permits the bounded isolated experiment once these gates are concrete; no live app billing or public release follows from --apply.

## First disposable execution

The first apply created the isolated stack, verified Coturn 4.6.1-1build4, active guest timer and Scheduler configuration, no swap/core dumps, memory-backed runtime, configured authentication/quotas, disabled traffic logs and the peer allowlist. Its UDP browser step failed before the initial coarse fixture returned detailed diagnostics. This does not establish whether allocation, connectivity, transfer or the original statistics assertion failed. No TCP or credential-negative result is claimed. The finally path deleted the stack and verified no tagged nonterminated instance remained. [Attempt 1 metadata](../experiments/remote-relay-2026-10-27-attempt1.json) contains no address or credential. Its failureOperation field records only the last AWS operation, not the cause of the browser failure. Neither scheduled termination nor an actual bill was observed.

Prepare one controlled second attempt with stage/candidate/error-code diagnostics and selected local-candidate/DTLS/relay-protocol checks at both endpoints. This does not broaden network access. Keep remote-candidate observations as metadata, rather than using one side's remote-candidate label as the sole proof for both clients. [W3C relay policy](https://www.w3.org/TR/webrtc/#dom-rtcicetransportpolicy), [statistics](https://www.w3.org/TR/webrtc-stats/#dom-rtcicecandidatestats-relayprotocol). If the second attempt also fails, stop that live component and preserve the evidence for a controlled follow-up. No infrastructure change or third blind deployment.

## Second execution and stop boundary

The controlled second run again passed runtime/expiry configuration checks and reached browser ICE gathering. Endpoint A reported one candidate, endpoint B none, both gathering states completed and the connection phase timed out. The observed ICE error code was 486. TURN defines 486 as allocation quota reached for the username. [RFC 8656 section 7.4](https://www.rfc-editor.org/rfc/rfc8656.html#section-7.4). The fixture currently shares one short-lived username between both endpoints with user-quota 2; extra browser allocations exhausting that quota are a plausible explanation, not an observed allocation trace. No successful transfer, TCP or invalid/expired-credential control is claimed. [Attempt 2 metadata](../experiments/remote-relay-2026-10-27-attempt2.json).

The finally path again deleted the whole owned stack and verified no tagged nonterminated instance remained. Both disposable runs are cleaned up. The two allowance forecasts total approximately USD 0.4571, below the USD 2 experiment allowance; this is not the actual bill. No note database or payload log was created. Scheduler configuration and guest readiness were observed, but scheduled termination was not exercised.

Live relay execution is stopped after two failed attempts. Do not deploy a third experiment overnight. A future controlled plan should review endpoint-specific leases and actual browser allocation demand against per-user/total quotas, retaining the bandwidth/expiry/ingress limits. Then verify allocation before investigating routing. No quota or firewall change was applied speculatively. Remote direct/relay and native/iPhone acceptance remain open.
