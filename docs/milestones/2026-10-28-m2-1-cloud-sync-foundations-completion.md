# M2.1 completion report: Cloud sync foundations

- Milestone: [M2.1: Cloud sync foundations](https://github.com/devsandip/peel/milestone/1)
- Completed: 27 October 2026, 22:11 IST (16:41 UTC)
- Report written: 28 October 2026, retrospectively
- Completion merge: [092437a](https://github.com/devsandip/peel/commit/092437a927a2786076916a4e941bf559ac0d1bd9)
- Status: completed against this backend milestone's exit criteria; Cloud mode remains disabled in the app.

## Outcome

The Cloud backend foundations are implemented and tested together. They can validate signed identities, keep accounts isolated, save conditional revisions, download complete paginated libraries, persist protected browser sessions and preserve pending edits through retries, restarts and conflicts in isolated tests.

This milestone delivered reusable server and protocol components. A user still cannot sign in and sync their Peel library through a deployed Cloud service. Real managed login, hosting, app integration, live delivery and billing remain required.

## Delivered scope and implementation links

| Deliverable | Evidence |
| --- | --- |
| Conditional DynamoDB mutations | [Issue 7](https://github.com/devsandip/peel/issues/7), [PR 5](https://github.com/devsandip/peel/pull/5) |
| Complete paginated library download | [Issue 8](https://github.com/devsandip/peel/issues/8), [PR 6](https://github.com/devsandip/peel/pull/6) |
| Access-token signature, issuer, client, scope and expiry validation | [Issue 9](https://github.com/devsandip/peel/issues/9), [verifier evidence](../features/cloud-access-token-auth.md); reviewed source is in the clean repository snapshot and regressions ran in PR 6 |
| Browser cookie/session and CSRF request boundary | [Issue 10](https://github.com/devsandip/peel/issues/10), [PR 15](https://github.com/devsandip/peel/pull/15) |
| Durable DynamoDB browser-session storage and revocation | [Issue 11](https://github.com/devsandip/peel/issues/11), [PR 19](https://github.com/devsandip/peel/pull/19) |
| PKCE authorization-attempt and callback validation | [Issue 12](https://github.com/devsandip/peel/issues/12), [PR 20](https://github.com/devsandip/peel/pull/20) |
| Composed bounded Lambda HTTP entry point | [Issue 13](https://github.com/devsandip/peel/issues/13), [PR 23](https://github.com/devsandip/peel/pull/23) |
| Composed durable-client recovery and account isolation | [Issue 14](https://github.com/devsandip/peel/issues/14), [PR 25](https://github.com/devsandip/peel/pull/25) |
| TTL cleanup rounding that respects logical retention | [Issue 16](https://github.com/devsandip/peel/issues/16), [PR 17](https://github.com/devsandip/peel/pull/17) |
| Bounded Lambda payload-v2 event/response conversion | [Issue 21](https://github.com/devsandip/peel/issues/21), [PR 22](https://github.com/devsandip/peel/pull/22) |

All ten milestone issues are closed. Those ten deliverables define this milestone's scope; they do not represent ten completed public features.

## Validation and its limits

At completion, 135 shared cases and 27 DynamoDB Local cases passed, with TypeScript, source formatting and the web build. The configured hosted web/core and native jobs passed on PR 25 in [run 40539973774](https://github.com/devsandip/peel/actions/runs/40539973774), source `17d8d58a4cdf7b067c42cab58efe9516b42228db`.

The [composed recovery evidence](../features/cloud-foundations-evidence.md) uses DynamoDB Local 3.3.2, synthetic signed identities and disposable Node SQLite clients. It verifies:

- Complete one-record-page download across failed transactions and reopen, with account isolation and durable checkpoints.
- Retry after a lost successful response while preserving a later local draft and a concurrent remote head, followed by explicit conflict resolution.
- Purge protection against stale edits after modeled retention, with recovery under a new note ID.
- Rejection of expired/revoked authentication, inactive paid policy and private storage failures without losing pending local work.

These tests do not establish real Cognito issuance/refresh, physical power-loss behavior, production session/key storage, browser login interaction, native/iPhone persistence parity or live subscriptions. Modeled elapsed days are not a real multiweek retention test. No real note/default database or managed AWS resource was used for this milestone's composed evidence.

## Main, deployment and customer availability

The foundation work merged into the public repository's main branch. No hosted HTTP API or public app was released by this milestone. Cloud activation, browser/native sign-in and live push are not enabled. Local Mac/browser capture and saving remain the most usable development-build capabilities; [the dated status report](../reports/2026-10-28-peel-status.md) covers the whole product.

## Overall progress and remaining work

At report time, the rough engineering estimate is about **35% of the full public-v1 scope**, with a 30-40% range. This includes implemented foundations and is not an acceptance score or an issue-count calculation.

Major remaining work includes verified native dragging/shortcuts and reliability, managed Cloud login/hosting/live delivery/app integration, whole-library mode transitions and paid terms, remote periodic peer sync, iPhone, meaning-search integration, signed distribution and 14 days of dogfooding. The canonical [SPEC](../SPEC.md) owns the complete scope and release gates.

## Next milestone and blockers

[M2.2: Controlled Cloud dev hosting](https://github.com/devsandip/peel/milestone/2) is active. Its exit requires a bounded synthetic managed identity/data run and verified owned-resource teardown. Current work includes [domain-prefix observation](https://github.com/devsandip/peel/issues/71) and [deployment/ownership/recovery tooling](https://github.com/devsandip/peel/issues/30). [Audit coverage](https://github.com/devsandip/peel/issues/51) and [the actual managed run](https://github.com/devsandip/peel/issues/31) remain blocked.

The [Peel Project](https://github.com/users/devsandip/projects/12) shows live issue/PR status. This report preserves the milestone result and does not certify later hosting or public-release acceptance.
