// Generate a document-style file association icon for .md files.
//
// Design: white rounded-corner page with dog-ear fold, "MD" label in
// muted gray, and a small Pennivo glyph badge in the bottom-right.
//
// Source:  assets/pennivo clean square large.png
// Output:  packages/desktop/build/file-icon.ico
//
// Run: node packages/desktop/scripts/build-file-icon.mjs

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import sharp from "sharp";
import png2icons from "png2icons";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const LOGO_PATH = resolve(
  __dirname,
  "../../../assets/pennivo clean square large.png",
);
const BUILD_DIR = resolve(__dirname, "../build");
const OUTPUT_ICO = resolve(BUILD_DIR, "file-icon.ico");
const OUTPUT_PNG = resolve(BUILD_DIR, "file-icon-preview.png");

// Canvas size for the master image (will be downsampled into the .ico)
const SIZE = 1024;

// Page dimensions within the canvas (centered, with padding for shadow)
const PAGE_PAD = 80;
const PAGE_X = PAGE_PAD;
const PAGE_Y = PAGE_PAD * 0.6;
const PAGE_W = SIZE - PAGE_PAD * 2;
const PAGE_H = SIZE - PAGE_PAD * 1.4;
const CORNER_R = 40;
const FOLD = 120; // dog-ear size

// Brand color (Pennivo dark green)
const GREEN = "#3d6b4e";

// Build the page shape as an SVG
function buildPageSvg() {
  // Page outline with dog-ear cutout in top-right
  // The path goes: top-left (rounded) → top-right minus fold → fold diagonal → right side → bottom-right (rounded) → bottom-left (rounded)
  const x = PAGE_X;
  const y = PAGE_Y;
  const w = PAGE_W;
  const h = PAGE_H;
  const r = CORNER_R;
  const f = FOLD;

  const pagePath = `
    M ${x + r} ${y}
    L ${x + w - f} ${y}
    L ${x + w} ${y + f}
    L ${x + w} ${y + h - r}
    Q ${x + w} ${y + h} ${x + w - r} ${y + h}
    L ${x + r} ${y + h}
    Q ${x} ${y + h} ${x} ${y + h - r}
    L ${x} ${y + r}
    Q ${x} ${y} ${x + r} ${y}
    Z
  `;

  // Dog-ear fold triangle (slightly darker)
  const foldPath = `
    M ${x + w - f} ${y}
    L ${x + w - f} ${y + f - r / 2}
    Q ${x + w - f} ${y + f} ${x + w - f + r / 2} ${y + f}
    L ${x + w} ${y + f}
    Z
  `;

  return `
    <svg width="${SIZE}" height="${SIZE}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="shadow" x="-10%" y="-10%" width="130%" height="130%">
          <feDropShadow dx="0" dy="8" stdDeviation="18" flood-color="#000" flood-opacity="0.18"/>
        </filter>
      </defs>

      <!-- Page body -->
      <path d="${pagePath}" fill="#ffffff" stroke="#c8c8c8" stroke-width="6" filter="url(#shadow)"/>

      <!-- Dog-ear fold -->
      <path d="${foldPath}" fill="#e8e8e8" stroke="#c8c8c8" stroke-width="4"/>

      <!-- "MD" text -->
      <text x="${x + 80}" y="${y + 320}"
            font-family="Segoe UI, Arial, Helvetica, sans-serif"
            font-weight="700"
            font-size="240"
            fill="#b0b0b0"
            letter-spacing="8">MD</text>
    </svg>
  `;
}

async function main() {
  mkdirSync(BUILD_DIR, { recursive: true });

  // 1. Render the page SVG to a buffer
  const pageSvg = buildPageSvg();
  const pageBuffer = await sharp(Buffer.from(pageSvg)).png().toBuffer();

  // 2. Resize the Pennivo logo for the badge (bottom-right of the page)
  const badgeSize = Math.round(SIZE * 0.32);
  const logoBuf = readFileSync(LOGO_PATH);
  const badgeBuffer = await sharp(logoBuf)
    .resize(badgeSize, badgeSize, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  // 3. Composite: page + badge
  const badgeX = Math.round(PAGE_X + PAGE_W - badgeSize - 20);
  const badgeY = Math.round(PAGE_Y + PAGE_H - badgeSize - 20);

  const compositePng = await sharp(pageBuffer)
    .composite([{ input: badgeBuffer, left: badgeX, top: badgeY }])
    .png()
    .toBuffer();

  // 4. Save a preview PNG so user can see it
  writeFileSync(OUTPUT_PNG, compositePng);
  console.log(`Preview: ${OUTPUT_PNG} (${compositePng.length} bytes)`);

  // 5. Convert to .ico via png2icons
  const ico = png2icons.createICO(compositePng, png2icons.BICUBIC, 0, false);
  if (!ico) {
    console.error("Failed to generate ICO");
    process.exit(1);
  }

  writeFileSync(OUTPUT_ICO, ico);
  console.log(`Wrote ${OUTPUT_ICO} (${ico.length} bytes)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
