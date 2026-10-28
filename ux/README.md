# Synkies brand assets

**Adopted:** [Antigravity v2 Folded Horizon](brand/folded-horizon/README.md), selected by Sandip on28 October2026. The shipping app is Synkies. Canonical masters, provenance and regeneration notes live with the selected assets.

The earlier Peel explorations below are historical alternatives, not the shipping identity.

# Peel logo work

Logo exploration for Peel, 27 October 2026. Nothing here is adopted yet. The app still ships [`apps/web/public/peel.svg`](../apps/web/public/peel.svg) and `apps/native/src-tauri/icons/`.

## Palette

All concepts use the tokens from [ui-spec.md](../docs/ui-spec.md):

| Role | Hex | Notes |
| --- | --- | --- |
| Amber accent | `#efd06b` | |
| Note paper | `#fff5c7` | |
| Primary ink | `#292c28` | |
| Canvas | `#eeede8` | |
| Fold shade | `#d4aa3c` | Logo only |
| Fold edge | `#c19a30` | Taken from the current `peel.svg` |

## Files

```text
ux/logos/
  concepts/                  AI-generated raster explorations, 1024 px
    01-peeling-corner.jpg    Refined version of today's icon
    02-peel-ribbon-p.jpg     Citrus-peel curl shaped into a "p"
    03-folded-note-p.jpg     Sticky note whose folded corner forms the P  (recommended)
    04-floating-notes.jpg    Floating notes with the green Put away control
    05-wordmark.jpg          Lowercase "peel" lockup
  svg/
    current-peel.svg         Copy of the shipping mark, for comparison
    peel-mark.svg            Vector draft of concept 3, 64-unit grid
    peel-app-icon.svg        Concept 3 on a dark squircle, macOS 1024 icon grid
    peel-wordmark.svg        Concept 3 mark with "peel" (live text)
  png/                       Exports rendered from the SVGs with rsvg-convert
```

## Concept tradeoffs

| # | Concept | Strengths | Risks |
| --- | --- | --- | --- |
| 1 | Peeling corner | Natural next step from today's icon; feels at home in the Dock | Generic: many sticky-note apps look like this |
| 2 | Peel ribbon "p" | Most ownable mark; plays on the name | Doesn't read as a notes app straight away |
| 3 | Folded-note "P" | Name and object in one shape; legible at 16–32 px | Needs a designer's pass to refine the fold |
| 4 | Floating notes + green minus | Shows the signature Put away behavior | Too busy for the menu bar or favicon |
| 5 | Wordmark | Ready for web, README and launch pages | Not an icon by itself |

**Recommendation:**

- Use concept 3 for the app icon, menu-bar icon and favicon.
- Pair it with the concept 5 wordmark.
- Concept 4 suits onboarding or marketing illustration.

## Before adopting

1. Refine `peel-mark.svg`: fold proportions, optical centering, and a 16 px hint pass.
2. Make a monochrome template version for the macOS menu-bar (tray) icon. The current tray icon is not set as a template image.
3. Pick the wordmark typeface and convert the text to outlines. `peel-wordmark.svg` currently renders with whatever rounded system font is available.
4. Generate the app icon set with `pnpm tauri icon ux/logos/png/peel-app-icon-1024.png`. Replace `apps/web/public/peel.svg` and update `docs/ui-spec.md` in the same branch.
5. Check the mark on dark appearance and at small sizes in the Dock, Finder and browser tab.

The raster concepts are AI-generated. Check that the chosen direction doesn't resemble an existing trademark before public launch.
