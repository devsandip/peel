# Browser offline application shell

## Requirements and plan

FR-02/05/06/08/13/14 and AC-02/05/14/16, supporting the SPEC's cached web start and offline capture contracts. The current browser saves notes to IndexedDB but has no application-shell cache; a cold offline navigation cannot reliably open Peel.

1. Generate a service worker and versioned static manifest from the production bundle. Include the library, editor, styles and search-worker assets. Verify all public asset hashes before completing installation; a partial or failed install must leave the previous usable shell intact.
2. Cache only the known public application files. Keep note bodies, queries, auth responses, APIs and arbitrary requests out of CacheStorage. Notes remain in IndexedDB. Do not register the worker in development or native Tauri windows.
3. Serve the installed shell offline without waiting for network access. Use the standard waiting update lifecycle, no skipWaiting or forced page reload while drafts are open. Activate a new shell after the old clients close. Show truthful preparation/update/failure status in browser settings.
4. Exercise a production build in an isolated browser: initial install, network-disabled reload/capture/search, worker availability, API/cache boundaries, failed update and a waiting update while a draft remains editable. Close clients and verify the new shell and saved note after returning offline.

## Decisions and limits

Use the browser service worker/CacheStorage APIs directly, with the existing pinned Vite/Oxc build tools and no new runtime dependency. TypeScript 7's installed package does not expose the old JavaScript transpile API; compilation uses Vite's existing Oxc transform. Register after page load, independently of capture. The standard install/wait/activate lifecycle avoids replacing code beneath a live editor. [Service Workers](https://www.w3.org/TR/service-workers/), [Chrome lifecycle reference](https://developer.chrome.com/docs/workbox/service-worker-lifecycle).

The manifest version hashes the source, compiled worker and sorted public-file hashes. Installation checks every response digest and rejects redirects or mismatched content. Fetch handling serves only the known files and root/index navigations; APIs, non-GET requests, cross-origin requests and arbitrary URLs bypass it. There is no runtime response cache. Retry can repair missing public files without touching IndexedDB. New versions wait for old clients to close; there is no skipWaiting, reload or schema migration in the worker. Cleanup is limited to this application's scope-specific cache prefix.

Browser storage can still be cleared or evicted. First-time offline visits cannot install the app. Persistence requests and portable exports remain separate protections. Test Chrome first; Safari/iPhone and supported browser/device performance gates remain open. No remote sync, Cloud activation or public deployment follows from this change.

## Evidence

Eleven production Chrome 155 checks pass: initial verified installation/status; offline reload/edit/search-worker availability; offline creation surviving reload; public-only cache contents excluding note/query/API data; repair after removing only the public cache; failed integrity update preserving the old offline shell; a waiting update retaining the editable draft and acknowledged save; activation after clients close with note recovery; unrelated-cache preservation; initial installation failure leaving capture usable, followed by successful Retry and offline recovery; and a truthful unavailable state when the service-worker API is absent. Raw synthetic metadata is in [the report](../experiments/offline-shell-2026-10-27.json). The production check runs in CI after building the app. Two consecutive unchanged builds also produced the same generated worker hash.

TypeScript, 58 shared cases, formatting and the seven development-browser flows pass. The development flow additionally checks that no service worker was registered and denied persistence queries/requests do not produce unhandled errors or block export. Native registration is guarded off, with native UI/runtime verification still pending while the Mac is locked. The native release bundle rebuild passes at 14.27 MiB. No complete AC-14 budget, Safari/iPhone, whole-browser eviction, native behavior, remote sync or public release acceptance is claimed.

Production preview defaults to port 4322; development remains on 4320. Separate origins prevent a previously installed production worker from controlling the development page, and each origin keeps its own IndexedDB library.

The production harness waits for the note's save-and-close operation to finish before explicitly reloading the page. A browser reload during an unacknowledged write is not a durability mechanism and is not reported as a saved revision.

## Reproduce

```bash
pnpm check
pnpm test
pnpm build
node scripts/check-offline-shell.mjs
pnpm test:e2e
```

The production harness serves only built public files plus a synthetic API probe on an isolated loopback port. It uses a temporary browser profile and synthetic notes, and changes only its in-memory worker revision/integrity fixture when testing updates. It reads no real account, note database or browser profile. Reports contain only environment, boolean outcomes and errors.
