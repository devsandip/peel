# Synkies screen mockups (historical v0.7)

This is a historical v0.7 presentation-only gallery of 110 screens, plus five representative dark exports. The current v0.8 contract is independent Local storage and cloud-authoritative Cloud storage with pending offline drafts and Saved only after server confirmation. Peer pairing/relay/device-sync screens and earlier save labels are retired; the gallery is not v0.8 acceptance. See the [current tier/status specification](../ui-spec.md). It contains synthetic content and does not implement the app, call APIs, authenticate, persist notes, or provision infrastructure.

## Open

Open `index.html` in a browser. No build or dependency installation is required for the gallery. Alternatively, from the repository root:

```bash
python3 -m http.server 4319 --bind 127.0.0.1 --directory docs/mockups
```

Then open http://127.0.0.1:4319. Direct links use a screen ID, for example `index.html#mac-library-desktop`. The initial screen is the floating Mac desktop. Drag note title bars, drag library cards into the surrounding desktop, or right-click a card. Control Option Command plus arrow previews arrangement; Command Shift L opens the library. Each floating note has one top-left green minus Put away button. The intended native behavior is to save and close only that note; closing Notes Library leaves floating notes visible. The gallery depicts independent windows on wallpaper with a macOS Dock, and these presentation interactions stay inside the mockup. All six screens under Mac capture use the same desktop and draggable-note presentation; Menu bar capture shows New note available with the other windows closed. No actual note data is saved.

## Files

- `index.html`, `styles.css`, `screens.js`, `desktop.js`: editable gallery source.
- `screens/`: one PNG per canonical screen and five dark variants.
- `overview.png`: Mac and iPhone overview.
- `all-screens.png`: complete contact sheet.
- `desktop-overview.png`: floating notes, library pinning, and edge arrangements.
- `render-overviews.py`: optional Pillow tooling for the summary images.
- `inventory.json`: screen IDs, platform, purpose, and requirement mapping.
- `render-report.json`: presentation checks from the export pass.
- `render-mockups.cjs`: optional export tooling, validated with Playwright 1.64.1 and installed Chrome.

[Visual specification and inventory](../ui-spec.md) · [Product specification](../SPEC.md)

## Regenerate screen PNGs

Requires Node.js, Playwright, and a supported browser. Set `PEEL_BROWSER_PATH` to a browser executable when the Playwright-managed browser is unavailable. Run `node docs/mockups/render-mockups.cjs` from the repository root with Playwright resolvable by Node. This is design-export tooling, not a production dependency or test of the app.

Historical version 0.7 added free On-device remote periodic sync and paid whole-library live Cloud screens; those peer flows are removed by v0.8. Start at #storage-destination, #peer-devices, #cloud-plan or #cloud-live. The sole floating-note window control is a green minus with unchanged save-and-close behavior.

Brand update,28 October2026: Synkies uses Antigravity v2 Folded Horizon. The self-contained gallery includes exact SVG copies from the [canonical selected masters](../../ux/brand/folded-horizon/README.md). Its internal PEEL_* export hooks and stable screen IDs remain compatible. Regeneration uses the declared @playwright/test dependency; render-mockups.cjs also produces brand/logo-light.png for the overview renderer. Those115exports retain the historical v0.7 scope; they do not override the current v0.8 product contract.
