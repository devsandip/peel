# Native launch at login

## Requirements and plan

FR-01 and SPEC capture behavior require an explicit launch-at-login preference while preserving resident capture and normal Quit. AC-01/15 need truthful state, a keyboard-accessible control and real native verification. No setting should be enabled just by installing, starting or testing Peel.

1. Use Apple's macOS 13+ SMAppService main application service rather than generating LaunchAgents or scripting System Settings. Peel currently targets macOS 14+. Add a narrow Objective-C bridge compiled by the installed Xcode toolchain; pin the already-resolved build helper if needed. No runtime package or helper process.
2. Treat the OS status as the source of truth. Query without registration when Settings opens and after returning to Peel. Only an explicit user action may register/unregister; do not persist a second Boolean that silently re-enables an item disabled in System Settings.
3. Serialize changes separately from note persistence. Return not registered, enabled, requires approval, unavailable/not found and errors honestly. Do not show enabled optimistically after an API call. Check again after returning from System Settings.
4. Refuse registration from a development/unbundled executable or an isolated PEEL_DATA_DIR run, so synthetic tests cannot alter the user's login items. Keep the existing app running on disable; never touch notes or quit as a side effect.
5. Verify the state/error contract with a fake OS backend and the Settings/IPC form with isolated fixtures. Build/link the real bridge without registering it. Actual approval, login/relaunch, disable, signed install and moved-bundle behavior remain unlocked-Mac/distribution gates.

## Sources and decisions

[Apple SMAppService](https://developer.apple.com/documentation/servicemanagement/smappservice?language=objc) provides the main application service and exposes current authorization status. [Registration](https://developer.apple.com/documentation/servicemanagement/smappservice/register%28%29?language=objc) schedules the main application for subsequent logins. [Unregister](https://developer.apple.com/documentation/servicemanagement/smappservice/unregister%28%29?language=objc) leaves the running main application alive. Inspect the installed SDK declarations before implementation. No application launch, actual OS-setting mutation or new infrastructure is part of automated verification.

## Implementation and evidence

The installed Xcode SDK confirms the main application service, four status values, code-signing requirement and synchronous registration/unregistration contracts. A narrow Objective-C bridge owns its autorelease pools and returns only integers. Calls dispatch to the main thread from async Rust workers without holding the note database controller. The already-resolved cc 1.10.0 is now a pinned build dependency; Cargo.lock adds only that direct edge, with no new runtime package. The bridge links Foundation and ServiceManagement and retains the configured macOS 14 minimum.

Settings reports the observed status, explicit on/off actions, Check again and Open Login Items for pending approval. A held operation never shows optimistic enabled state. Focus refresh does not race an in-flight mutation. Failed changes retain the actual OS state and display the error. The generic settings IPC cannot introduce a duplicate launchAtLogin Boolean. No OS registration occurs at startup.

Four fake-backend cases cover query-only behavior, enable/disable/idempotence, external status changes, approval without re-registration, operation errors, unconfirmed success and blocked test/development/unsupported runs. A fifth native case invokes the compiled bridge from the unbundled test executable, verifies its eligibility guard first, and confirms mutation/settings entry points refuse without reaching SMAppService. All 28 native cases, Rust formatting/Clippy, TypeScript and 11 browser flows pass. Four browser flows mock native IPC; the new login flow covers pending registration, approval, System Settings action, external state refresh, failed disable, retry and isolated-run controls. The production/native release build passes and produces a 14.85 MiB bundle.

No actual login item was registered, unregistered or opened during checks. Actual signed-app registration/approval, login/relaunch, moved-bundle behavior and VoiceOver remain open. Compilation and fake state tests cannot prove those behaviors.
