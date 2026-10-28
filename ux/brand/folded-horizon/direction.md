# 01 — Folded Horizon

## Concept
**Folded Horizon** resolves the sticky note and the cloud into a single quiet gesture. Set against a warm charcoal tile (`#292C28`), a pale-yellow sheet of paper (`#FFF5C7`) folds inward at its bottom-right corner—not as a sharp triangle, but as a softly billowed amber cloud silhouette (`#EFD06B`) separated by a deliberate negative-space channel.

## Why It Fits Synkies
- **Unified Metaphor**: Rather than bolting a stock refresh arrow onto a cloud, the corner fold of the sticky note *is* the cloud horizon—suggesting that every note written on your desk is effortlessly present in the cloud.
- **Warm Paper Contrast**: Pale yellow paper (`#FFF5C7`) and soft amber (`#EFD06B`) glow with calm warmth against the dark charcoal surface (`#292C28`), echoing Synkies' dark-mode canvas and light-mode note paper.
- **16 px Clarity**: Bold, flat planes and a generous `28 px` negative-space reveal keep the folded-note silhouette and cloud corner unmistakably legible at `16 × 16 px`.

## Typeface & Source
- **Wordmark**: **Plus Jakarta Sans** (`SemiBold`, weight `600`) — sourced from **Google Fonts** (OFL free license). All lettering in the SVG files is converted to outlined `<path>` geometry with zero runtime font dependencies.
- **UI Recommendation**: **Inter** (`Regular`, weight `400`, **Google Fonts**).

## Construction & Usage Details
- The app icon (`icon.svg`) is built on a `1024 × 1024` canvas with a `22.5%` (`230.4 px`) corner radius tile in `#292C28`.
- Horizontal lockups (`lockup-light.svg` and `lockup-dark.svg`) are `256 px` tall with `32 px` outer padding, the `192 × 192 px` icon at `(32, 32)`, and a `32 px` horizontal gap before the vertically centered wordmark.

## Do
- Use `lockup-light.svg` (charcoal `#292C28` lettering) on warm off-white surfaces (`#FFFEFA` / `#EEEDE8`).
- Use `lockup-dark.svg` (off-white `#EFEEE4` lettering) on dark charcoal surfaces (`#20231F` / `#30342E`).
- Preserve the negative-space channel separating the pale-yellow paper body from the amber cloud fold.

## Don't
- Do not add drop shadows, glossy highlights, or multi-stop gradients to the paper surfaces.
- Do not close or narrow the gap around the amber cloud fold, which is essential for `16 px` recognition.
- Do not recolor the wordmark in pale yellow (`#FFF5C7`) on light backgrounds.
