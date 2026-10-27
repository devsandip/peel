# Desktop floating notes

## User direction

Make floating Mac notes the primary experience. Offer a separate full Notes Library. Let people drag notes around the desktop, pin notes by dragging them out of the library or through a right-click action, and arrange open notes against the left, right, top, or bottom with keyboard shortcuts.

This phase updates the canonical product documents and visual mockups. The browser gallery simulates window movement within the depicted desktop; it does not create macOS windows or register global OS shortcuts.

## Requirements

- FR-01, FR-11: floating capture and independently draggable note windows; a separate Notes Library.
- FR-15: drag-out and context-menu pinning without copying a note or changing its storage destination.
- FR-16: keyboard/menu arrangement at four edges, with configurable shortcuts and layout recovery.
- AC-17 through AC-20: drag/pin behavior, arrangement, display recovery, and independent pin/always-on-top states.

## Decisions

- Pinning is persistent desktop placement. A pinned note remains draggable and appears in the library.
- Always on top is a separate window preference. Pinning does not imply a locked position or forced visibility over every other app.
- New notes created on Mac open directly as desktop notes. Opening the library is an explicit action.
- Proposed arrangement shortcuts are Control Option Command plus an arrow key. Commands apply to open notes on the active display; notes on other displays keep their positions.
- Keep native note IDs and local/cloud destinations unchanged when pinning, dragging, or arranging.
- Preserve previous geometry so Undo last arrangement can restore it.

## Mockup work

1. Make the primary desktop scene draggable and add a direct Open Notes Library action.
2. Add the library alongside floating notes, a drag-out preview and completed drop, and the library context menu.
3. Add left, right, top, and bottom arrangement scenes and a Window menu listing the shortcuts.
4. Add desktop shortcut settings. Make movement, drag-out, right-click pinning, and arrangement interactive within the review gallery.
5. Render the complete gallery and inspect the new desktop scenes. Verify drag movement, successful drop, cancelled drop, no duplicate pin, all four arrangement commands, and Undo last arrangement.

## Implementation gate

M0 must validate native drag-out across a library window boundary, global shortcut registration, independent window movement/layers, and display/work-area restoration. Mockup checks are presentation evidence only.

## Independent windows and close control

Sandip clarified that floating notes must sit outside the larger application/library window. Each is an independent top-level macOS window. Closing or minimizing Notes Library leaves those notes visible. The wallpaper and OS Dock in the mockup represent the desktop, not a containing Peel window.

Each floating note has one top-left Close control. It has no minimize, maximize, pin, or overflow control in its title bar. The remainder of the title bar is draggable. Closing commits the latest local text, then closes only that note window while preserving the note in the library. A failed local save keeps the note open with recovery actions. Keep on top and note actions move to context/app menus.

Verify that notes are siblings of the library in the mockup scene, closing the library preserves existing note windows, each note title bar has exactly one Close button, and Close removes only its note. These remain visual/interaction checks rather than proof of native window ownership or actual persistence.

## Mac capture consistency

Apply the independent-window design to every screen in the Mac capture section: desktop notes, quick capture, formatted note, Markdown source, note actions, and menu bar capture. This follows FR-01, FR-02, FR-10, and FR-11 without changing the product contract.

Use the same desktop wallpaper, Dock, draggable note title bar, and sole Close control across capture and desktop scenes. Keep formatting/source content inside that note window and put actions in context/app menus. Show menu bar capture with the library and note windows closed to illustrate resident capture access. Remove the older desktop presentation path so subsequent visual changes reach the whole section.

Verify all six screens share the desktop presentation, quick/formatted/source notes drag by their title bars, note actions open through right-click, closing an empty capture dismisses its draft, and menu bar New note opens the updated capture scene. Regenerate the full gallery and inspect the changed screens.

## Result

The gallery contains 85 canonical screens and five dark exports, including a Library closed, notes visible scene. Floating notes sit outside the library's bounds and view hierarchy, with one Close button per title bar. The desktop preview supports title-bar drag, library drag-out, Escape cancellation, right-click pinning, existing-window focus, four keyboard edge arrangements, and Undo last arrangement.

Presentation checks cover library closure preserving the same note windows and positions, note closure affecting only its window while retaining its library entry, and save-failure recovery leaving the note open. All six Mac capture screens use the shared desktop design; quick/formatted/source dragging, empty-draft dismissal, context actions, and resident menu capture also pass. Native implementation, actual persistence, and M0 validation remain unstarted.

## Green Put away refinement

On 26 October Sandip requested a green minimize-style minus in place of the red cross, to avoid suggesting deletion. This supersedes the earlier Close appearance above. Keep the existing save-and-close behavior, single top-left control, retained library identity, and failed-save recovery. The tooltip reads Save and put away note. Update the shared renderer, Mac capture, native editor, and exported screens together.
