# Synkies

Formerly Peel. The app now uses **Synkies** and Antigravity's **Folded Horizon** identity. The repository and compatible storage/package identifiers keep their existing names. [Selected brand assets](ux/brand/folded-horizon/README.md).

A Mac app centered on independent floating notes and a searchable Notes Library, with a local browser development client and an iPhone client planned. Two app-wide modes are confirmed: free On-device storage with periodic remote peer sync, and paid DynamoDB-backed Synkies Cloud with live sync.

Implementation has started on a local Mac development build. Peer sync, paid Cloud, live delivery, iPhone and meaning search are not implemented yet. The complete intended product is documented below.

## Canonical documents

- [PRD](docs/PRD.md): product scope, free/paid modes and delivery goals.
- [PRFAQ](docs/PRFAQ.md): customer promise, proposed launch narrative, and product questions.
- [SPEC](docs/SPEC.md): requirements, storage design and cost model, behavior, architecture, milestones, and acceptance criteria.
- [Screen mockups](docs/mockups/index.html): the complete local gallery.
- [Visual specification](docs/ui-spec.md): design decisions and PNG screen inventory.
- [Milestone reports](docs/milestones/README.md): completed scope, validation evidence and dated status snapshots.

## Development approach

Track current work in the [Synkies GitHub Project](https://github.com/users/devsandip/projects/12). Its current-milestone view shows deliverable issues, with separate issue, pull-request and backlog views. Repository Issues and Milestones retain acceptance criteria and completion evidence; board card counts are not product-completion percentages.

Use spec driven development. Start each milestone with a requirement-linked plan in `docs/features/`. Resolve the feasibility gates in the SPEC, implement a small vertical slice, and attach verification evidence to the matching acceptance criteria. Update the canonical specification when product behavior changes.

The first implementation target is local Mac capture and durable automatic saving. Synkies Remote peer sync, paid live Cloud and the web app follow, then the iPhone app and search by meaning. All are required for the intended public release.

Both modes use local persistence for speed. Free peer sync keeps notes only on devices; paid Cloud uses DynamoDB and push delivery. AWS will host the browser shell, signaling and cloud services. This public repository starts from a reviewed snapshot; earlier development history and CI records remain in a private archive. Historical commit/run identifiers in experiment records refer to that archive. Public source access does not mean the application has passed its public-beta or distribution gates.

## Run the development app

Use Node 26, pnpm 11, Rust 1.99.1, and Xcode command-line tools on Mac.

```bash
pnpm install --frozen-lockfile
pnpm dev
```

The browser development app is served on http://127.0.0.1:4320. It uses IndexedDB in that browser profile.

To try production offline capture and search, use a separate preview origin:

```bash
pnpm build
pnpm --filter @peel/web preview
```

Open http://127.0.0.1:4322 online once and wait for Settings to report offline access ready. It can then reload, capture, save and search without a connection. Updates wait for all Synkies tabs to close. Only public app files are cached; notes remain in IndexedDB. Browser data can still be cleared or evicted, so keep exports. Development disables service workers; the separate port prevents an installed production shell from controlling the development server. Each origin has its own browser library.

```bash
export PATH="$HOME/.cargo/bin:$PATH"
pnpm mac:dev
pnpm mac:build
```

The native bundle is generated at `apps/native/src-tauri/target/release/bundle/macos/Synkies.app`. It is a development build, without distribution signing/notarization. The app is resident: use the File menu or Command Shift L for Notes Library; Quit Synkies exits it. Each note has a green minus that saves and puts it away.

Native notes default to `~/Library/Application Support/com.peelnotes.desktop/notes.sqlite3`. Settings can choose another empty notes folder after every open editor saves. Synkies verifies the copy and retains the previous folder as an inactive recovery copy; later edits use the selected folder only. Missing storage opens a reconnect/retry view. Quit older Synkies builds before testing, since they do not honor the new process locks.

Settings also configures device-local global capture and four-edge arrangement shortcuts. It supports disabled bindings, defaults, activation retry and visible registration failures. File and Window menu actions remain available.

Launch at login is an explicit Settings choice backed by the Mac's reported status, including pending approval. It requires an installed signed app and stays unavailable in development executables and isolated test runs. Automated checks leave actual login items unchanged.

For isolated tests, set `PEEL_DATA_DIR` to a separate directory before launching the native binary. This isolates the database and selection/journal metadata. Never use real notes as test fixtures or commit databases/exports. The relocation picker/runtime, actual global shortcut dispatch and remaining native acceptance/performance checks still need verification on an unlocked Mac. Remote peer sync and paid Cloud are not enabled in this build.

## Checks

```bash
pnpm check
pnpm test
pnpm test:e2e
pnpm build
node scripts/check-offline-shell.mjs
cargo test --manifest-path apps/native/src-tauri/Cargo.toml
cargo clippy --manifest-path apps/native/src-tauri/Cargo.toml --all-targets -- -D warnings
```

On Mac, browser checks use installed Google Chrome. Set `PEEL_BROWSER_PATH` to override it; Linux CI installs Playwright Chromium. CI builds and tests the web/core and native app separately. See [local implementation evidence](docs/features/local-mac-app.md) for the distinction between passing component checks and full product acceptance.

For the isolated production browser word-search experiment, run `pnpm build` and then `node scripts/benchmark-browser.mjs`. It creates only synthetic notes in a temporary browser profile, runs 100 warm offline searches, and writes raw results under ignored `scratch/`. See [search evidence and remaining gates](docs/features/local-search-performance.md).
