# Native peer runtime feasibility

## Requirements and plan

FR-05/14/17/19 and AC-10/21/25 require native runtime feasibility before relying on browser-only peer experiments. The Mac is locked, but a separate hidden synthetic WebView can exercise APIs without inspecting other apps, bypassing the lock or opening Peel's real library.

1. Add a separate Tauri example using the pinned production runtime, custom-protocol origin and CSP. Replace embedded assets with an empty synthetic page and inject only the probe. Do not call the app's run function, initialize repositories or install shortcut/dialog/login plugins.
2. Require a marker-verified fresh temporary root, use a separate app identifier, nonpersistent/incognito WebKit storage, an explicit temporary data directory, no focus/visible window and prohibited activation. A watchdog exits only this probe process. No note, account, existing browser profile or OS login item is read or changed.
3. Check the actual tauri origin, secure context, WebRTC data-channel availability, P-256 signing/verification and private-key non-extractability. Exercise a CryptoKey through IndexedDB commit/connection reopen in this ephemeral store, without claiming disk/relaunch durability or Keychain integration.
4. Negotiate two local host peer connections with no STUN/TURN server. Transfer bounded synthetic bytes in 16 KiB frames and compare hashes. Record only capability flags, counts, candidate types and DTLS status, never SDP, addresses, keys, signatures or payload.
5. Run through a bounded launcher that compiles the example, isolates data, collects an allowlisted report and always removes its temporary root. Preserve failed capability evidence; do not mark native app pairing, remote connectivity, signed distribution, iPhone or full sync acceptance passed.
6. After the basic runtime passes, serve the existing bound-channel fixture as one explicitly named temporary asset in that same native origin. Execute its fifteen authentication/store/framing/revocation checks in the ephemeral WebView and allowlist only their boolean outcomes/counts. This tests the actual shared prototype on WebKit without importing it into the app or persisting native keys/notes.

## Source checks and limits

Pinned Tauri 2.12.4 exposes Context::set_assets and a custom-protocol origin of tauri://localhost, with an explicit custom-protocol feature. Its hidden/incognito WebviewWindowBuilder options reach Wry's WKWebsiteDataStore::nonPersistentDataStore on Mac. Use these actual runtime APIs rather than a generic WebKit substitute. The production capability label library can authorize the example's one report command without broadening production permissions. The example has no other command handlers or plugins.

This experiment uses an unbundled development executable and one hidden WebView. Local host success is a runtime prerequisite only. Actual app integration, secure native key storage, process persistence, cross-network direct/forced relay, native window interaction and iPhone remain open. No infrastructure or new runtime dependency is required.

## Evidence and unresolved repeatability

The separate example compiles and runs on macOS 26.6.2 (25G83), Darwin 25.6.0, M4/16 GB with pinned Tauri 2.12.4/Wry 0.57.1. It uses a different app identifier, a marker-verified temporary root, hidden unfocused window and WebKit's nonpersistent store. No production app startup, repository or plugin is invoked.

At 2026-10-26 21:21:20 UTC, the initial basic probe passed all ten checks: actual tauri scheme/secure context, WebRTC/Web Crypto availability, P-256 sign/verify, non-extractable private key, CryptoKey IndexedDB commit/connection reopen, local data-channel open, bounded hash-equal transfer and connected DTLS. It transferred 217,000 synthetic bytes in fourteen frames capped at 16,384 bytes. Both candidate types were host; no external ICE service was configured. This is one observation, not a repeatability or persistence gate.

Two later attempts to extend that probe with the shared bound-channel harness ended at the 30-second native watchdog. The diagnostic attempt reached the CryptoKey IndexedDB phase with scheme/secure-context/WebRTC/Web Crypto/P-256 checks true, but never requested the bound module. Its exact open/write/read/sign substep is unknown. The fifteen shared bound-channel checks therefore have not run successfully on WebKit. The cause of the intermittent stall is unknown; the Mac was locked and the WebView hidden, which are conditions to control rather than a proven explanation.

I stopped native execution after those two failed attempts. Fine-grained body-free progress hooks are prepared for a later unlocked control run but have not been exercised. [Recorded observations](../experiments/native-peer-runtime-2026-10-27.json) preserve the initial captured basic result and the latest raw diagnostic report. The launcher removes temporary storage and the watchdog exits only its own process. No real/default notes, existing browser profile, OS login item or AWS service was used.

Rust formatting/Clippy across all targets, JavaScript syntax and formatting pass. Production code and its 14.85 MiB bundle are unchanged. Native peer feasibility remains open: ephemeral transaction completion cannot prove disk/process durability or Keychain integration, and there is no app sync, remote direct/relay, iPhone or full acceptance claim. Next compare an unlocked control and ordinary IndexedDB versus CryptoKey serialization before choosing a native key/store adapter.

## Reproduce after the control environment is available

```bash
export PATH="$HOME/.cargo/bin:$PATH"
node scripts/experiment-native-peer.mjs
```

This is a manual M0 experiment. CI compiles/lints the example but does not treat its runtime gate as passed. Do not repeatedly rerun the stalled native experiment without a controlled change or new evidence.
