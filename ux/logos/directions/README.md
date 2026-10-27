# Peel logo directions

Five logo directions for Peel, drawn as SVG with the colors from [docs/ui-spec.md](../../../docs/ui-spec.md). Made on 27 October 2026. None is adopted; the app still ships `apps/web/public/peel.svg` and `apps/native/src-tauri/icons/`.

The sibling folders `../concepts`, `../svg` and `../png` are a separate exploration from another session, described in [ux/README.md](../../README.md).

Open [index.html](index.html) to compare the five side by side. It needs internet access for the wordmark fonts.

## Directions

| # | Folder | Idea | Wordmark | Tradeoff |
| --- | --- | --- | --- | --- |
| 1 | `01-corner-lift` | Amber note with its bottom-right corner curling up | Geist 600 | Follows on from the mockups' folded-corner mark; close to other sticky-note apps |
| 2 | `02-note-window` | Note with an amber title bar, one close dot and a folded corner | Instrument Sans 600 | Most Mac-like; closest to a generic notes icon |
| 3 | `03-p-monogram` | Bold P whose bowl has a folded amber corner | Bricolage Grotesque 700 | Clearest at 16 px; loses the paper-note idea |
| 4 | `04-two-notes` | Amber note over a tilted ochre note | Figtree 700 | Library plus desktop notes, or synced devices; busy when small |
| 5 | `05-peel-sticker` | Round sticker with its edge peeling back | Fraunces 600, soft | Most distinctive shape; furthest from notes |

## Files in each folder

| File | Use |
| --- | --- |
| `mark-light.svg` | Mark on light backgrounds, 32 px and up |
| `mark-dark.svg` | Mark on dark backgrounds, 32 px and up. Identical to `mark-light.svg` where one mark works on both. |
| `mark-small-light.svg`, `mark-small-dark.svg` | 24 px and below (favicon, menu items), with fine details removed |
| `app-icon-light.svg`, `app-icon-dark.svg` | macOS app icon on the 1024 grid: an 824 px rounded square, radius 185, no drop shadow |
| `png/` | Exports from `build.mjs`: marks at 512 px, small marks at 32 px, app icons at 1024 px, and both lockups on transparent backgrounds |

Marks use a 120-unit grid. The gap in Two notes is a mask, so that mark works on any background.

## Palette

| Role | Hex | Source |
| --- | --- | --- |
| Amber | `#EFD06B` | ui-spec amber accent |
| Paper | `#FFF5C7` | ui-spec note paper |
| Ink | `#292C28` | ui-spec primary text |
| Note ink | `#45412D` | ui-spec note text |
| Deep amber | `#D9AE34` | Logo only: folds and outlines |
| Ochre | `#B98E22` | Logo only: curl edges and the back note |
| Icon cream | `#F7F2E2` | Logo only: light app icon background |
| Icon dark | `#30342E` | ui-spec dark app surface |
| Dark text | `#EFEEE4` | ui-spec dark primary text |

## Rebuild

From the repository root:

```bash
node ux/logos/directions/build.mjs
```

The script regenerates `index.html` and every `png/` folder from the SVGs. It uses the workspace's `@playwright/test` Chromium and fetches the wordmark fonts from Google Fonts. If a font fails to load it stops, rather than exporting a lockup in a fallback font.

## Before adopting one

1. Convert the chosen wordmark to outlines so the lockup exists as SVG. It is live text in the preview and raster in the PNGs.
2. Replace the rounded square with Apple's continuous-corner icon shape and add the standard drop shadow.
3. Draw a monochrome template version for the macOS menu-bar icon.
4. Check the small sizes in the real Dock, Finder and a browser tab. So far they have only been checked in renders.
5. Run a trademark search on the chosen direction. The fonts are Google Fonts under the SIL Open Font License.
