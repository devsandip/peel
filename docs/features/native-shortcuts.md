# Configurable native shortcuts

## Requirements and plan

FR-01/16, AC-01/18 and the local Mac milestone. Global capture and four-edge arrangement need configurable keys, honest collision status and usable File/Window menu alternatives. Previous real global-key geometry checks remain unresolved; adding preferences does not establish OS interaction acceptance.

1. Define a versioned device-local configuration for capture/left/right/top/bottom, with optional disabled bindings. Validate supported physical keys, modifiers, duplicate combinations and reserved editing/app commands before contacting the OS.
2. Manage registrations with explicit rollback and per-action status. Reuse existing registered key IDs when actions swap, route newly registered keys only after persistence, and preserve the previous preference on failure. Expose failed rollback/cleanup rather than claiming a global key is active.
3. Persist only after registrations succeed, using the selected local database. Serialize changes with library/window operations. Do not hold the library controller while dispatching OS registration calls. Update Window menu labels; keep Command N and other standard app-level actions as alternatives.
4. Add accessible modifier controls and a named-key picker in Settings, avoiding a live keystroke recorder that could trigger existing global bindings. Offer Disable, Restore defaults and Retry activation. A form cancel must not change registrations or notes.
5. Exercise collision, duplicate/reserved inputs, swaps, failed persistence, failed rollback and restart loading with a fake OS backend; check the form/IPC contract separately. Verify actual global capture/arrangement, keyboard layouts and accessibility on Mac when unlocked.

## Decisions and limits

Use the already pinned global-shortcut plugin and its normalized hotkey IDs. Its implementation dispatches registration calls to the main thread; commands use a background worker and a separate routing map so a hotkey callback never waits on the preference mutex. Device-local preferences are not note content and never enter peer/cloud payloads.

Menu choices stay clickable when a global binding cannot register. Defaults remain Control Option N and Control Option Command with arrows. No new runtime dependency, telemetry, infrastructure or public-release claim follows from this feature. Physical-key labels and non-US layouts remain a native verification gate.

## Implementation and evidence

The native manager now validates versioned settings and normalized key IDs, serializes registration/persistence and publishes callbacks through a separate routing map. A failed unregister is treated as uncertain, even if the OS might still own the key. Retry first releases uncertain keys before rebuilding the desired registrations. Restart/recovery displays the saved desired binding with unavailable status if it cannot activate; it does not silently substitute a different saved preference.

The Settings form supports save/cancel, disable, defaults and activation retry with visible errors. Native startup loads the selected database's device-local setting; the generic setting IPC cannot bypass shortcut validation. Async worker commands avoid holding the library controller across OS calls. Window menu labels follow the preference while standard File New note remains Command N.

Seven Rust cases cover validation before OS/persistence, duplicates/reserved/unsupported input, ID swaps, collision, failed persistence, failed rollback, uncertain release, retry, disabled bindings, invalid saved data and failed activation of a saved preference. They pass within the 23-case native suite. TypeScript, 58 shared cases, formatting and Clippy pass. Ten browser flows pass, including three mocked native-IPC flows; the new form flow checks cancel, collision, replacement, disable, defaults and retry. The production build, 11 offline browser checks and native release bundle (14.72 MiB) pass after integration.

These use synthetic data and a fake registration backend. Actual global dispatch, menu labels, frontmost-editor focus, collisions with other apps, keyboard layouts and VoiceOver remain unverified while the Mac is locked. The earlier global-key geometry check remains unresolved. Do not mark AC-01/18 passed from model/form tests.
