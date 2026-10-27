# Screen mockups

## Scope

Create reviewable mockups for the complete product described by [SPEC](../SPEC.md) and [PRFAQ](../PRFAQ.md). Include Mac, iPhone, browser, and the required recovery states. This work does not implement persistence, sync, search, authentication, inference, or infrastructure.

## Requirement coverage

- FR-01, FR-02, FR-10, FR-11: quick capture, floating notes, formatted/source editor, automatic saving, note actions, shortcut settings.
- FR-03, FR-04, FR-14: destination selection, Peel Cloud connection, moves, disconnect/account change, storage preferences, account boundaries.
- FR-05: Mac library and desktop, iPhone library/editor/navigation, browser library/editor and local-browser limitations.
- FR-06, FR-09: word and meaning search, tag filters, no matches, model consent/download/indexing/unavailable states.
- FR-07: archive, Trash, restore, permanent deletion.
- FR-08, FR-13: cached/offline states, initial sync, save failure, reconnect, sync paused, missing cloud data, conflicts.
- FR-12: export/import selection and results.

## Artifacts

- `docs/mockups/index.html`: local screen gallery with mockup navigation and light/dark appearance.
- `docs/mockups/styles.css` and `screens.js`: shared visual system and synthetic screen content.
- `docs/mockups/screens/`: rendered PNGs of the canonical screens.
- `docs/mockups/overview.png`: overview for review.
- `docs/ui-spec.md`: visual decisions and the canonical screen inventory.

## Decisions

- Use warm neutral library surfaces, pale yellow floating notes, system typography, and a restrained amber accent. Color is a visual treatment, not a new note-color feature.
- Keep the editor focused on content. Closing, archiving, and deleting remain separate. No Save button is introduced.
- Use the exact storage and search distinctions in the SPEC. Put mockup labels in the gallery chrome rather than in the depicted product.
- Use realistic synthetic notes only. Peel sign-in screens depict app-owned consent explanations, not copies of provider-controlled authentication pages.
- Make screen navigation interactive for review. Product controls navigate to corresponding mockups; they do not execute actual app actions.

## Verification

Render every inventory entry in a browser, inspect primary desktop/mobile screens and recovery dialogs, check runtime errors and clipping, and verify links/buttons between the key mockup flows. These checks validate mockup presentation only. They do not satisfy the application's functional acceptance criteria.

## Result

The latest mockup set contains 85 canonical screens and five representative dark exports. Every screen rendered without JavaScript errors; all screen routes and dialog placement checks passed. Capture/account navigation, theme switching, and 390-pixel gallery width were checked. See `docs/mockups/render-report.json` for the presentation report. I visually inspected core desktop, mobile, account, and recovery screens and fixed the iPhone formatting label before the final export.

The app name is now Peel. The cloud destination is DynamoDB-backed Peel Cloud; Google Drive is excluded. Canonical PRFAQ and SPEC were revised to version 0.2 to record this direction change.

The desktop refinement is recorded in [desktop-floating-notes.md](desktop-floating-notes.md) and SPEC/PRFAQ version 0.4. Floating notes are now the default gallery scene. The library, drag-out/right-click pinning, and four edge arrangements have interactive presentation checks. Notes are depicted as independent windows outside Notes Library. Each note has only a top-left Close control; close and save-failure states have presentation checks.

All six Mac capture screens now share the desktop renderer. Quick capture, formatted notes, and source view are draggable windows with the same sole Close control. The resident menu bar scene demonstrates capture with the library and note windows closed. See the desktop feature record for the consistency plan and presentation checks.

## Version 0.7 saving modes

The canonical gallery now has 110 screens plus five dark exports. See [storage-modes.md](storage-modes.md) for confirmed remote free peer sync and paid live Cloud. Existing per-note destination/move controls are replaced with a whole-library mode choice. Pairing, waiting/remote relay status, latest-edit recovery, paid activation/live/billing, cancellation, verified downgrade and separate cloud-data removal are represented on Mac, iPhone and browser. All current presentation checks pass; none establish production peer/cloud/payment behavior.
