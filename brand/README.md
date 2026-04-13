# Pennivo Brand Assets

Single source of truth for the Pennivo visual identity. Downstream platform
builds (desktop `.ico`, Android adaptive icon, website favicon) render from
these SVGs — do not hand-edit rasterized output.

## Files

- `pennivo-icon.svg` — master app icon: white nib on `#34b56f` rounded
  square, subtle radial vignette. Used for desktop, website, press kit.
- `pennivo-icon-flat.svg` — flat variant without vignette, for very small
  sizes, print, or monochrome contexts where the gradient is noise.
- `pennivo-nib-glyph.svg` — standalone green nib, transparent background.
  Used as the badge on the `.md` file-association icon and for inline use
  against neutral surfaces.

## Color

Accent green: `#34b56f` (HSL 146 / 55 / 46) — "c2" variant, picked for
taskbar presence while staying clear of Spotify `#1DB954`, Evernote 2025
`#00aa29`, and WhatsApp `#25D366`.

In-app accent (UI theme, buttons, links) remains `#4a7c59` — the icon
green is intentionally brighter than the UI green; do not sync them.

## Regenerating rasters

- Desktop icons: `pnpm --filter @pennivo/desktop build:icon`
  → writes `packages/desktop/build/icon.ico`, `resources/icon.ico`,
  `resources/icon.png`.
- File-association icon: `pnpm --filter @pennivo/desktop build:file-icon`
  → writes `packages/desktop/build/file-icon.ico`.
- Android adaptive icon: edit
  `packages/android/android/app/src/main/res/drawable/ic_launcher_foreground.xml`
  and `ic_launcher_background.xml` (vector drawables, no raster step).
