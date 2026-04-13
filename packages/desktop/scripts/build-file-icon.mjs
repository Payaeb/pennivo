// Generate a document-style file association icon for .md files.
//
// Design: white rounded-corner page with dog-ear fold, "MD" label in
// muted gray, and the Pennivo nib glyph (c2 green) badged in the
// bottom-right to brand the file as a Pennivo markdown document.
//
// Source:  brand/pennivo-nib-glyph.svg
// Output:  packages/desktop/build/file-icon.ico + .png preview
//
// Run: pnpm --filter @pennivo/desktop build:file-icon

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import sharp from "sharp";
import png2icons from "png2icons";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const NIB_GLYPH_PATH = resolve(__dirname, "../../../brand/pennivo-nib-glyph.svg");
const BUILD_DIR = resolve(__dirname, "../build");
const OUTPUT_ICO = resolve(BUILD_DIR, "file-icon.ico");
const OUTPUT_PNG = resolve(BUILD_DIR, "file-icon-preview.png");

const SIZE = 1024;

const PAGE_PAD = 80;
const PAGE_X = PAGE_PAD;
const PAGE_Y = PAGE_PAD * 0.6;
const PAGE_W = SIZE - PAGE_PAD * 2;
const PAGE_H = SIZE - PAGE_PAD * 1.4;
const CORNER_R = 40;
const FOLD = 120;

function buildPageSvg() {
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
      <path d="${pagePath}" fill="#ffffff" stroke="#c8c8c8" stroke-width="6" filter="url(#shadow)"/>
      <path d="${foldPath}" fill="#e8e8e8" stroke="#c8c8c8" stroke-width="4"/>
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

  const pageSvg = buildPageSvg();
  const pageBuffer = await sharp(Buffer.from(pageSvg)).png().toBuffer();

  const badgeSize = Math.round(SIZE * 0.38);
  const nibSvg = readFileSync(NIB_GLYPH_PATH);
  const badgeBuffer = await sharp(nibSvg, { density: 384 })
    .resize(badgeSize, badgeSize, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  const badgeX = Math.round(PAGE_X + PAGE_W - badgeSize - 20);
  const badgeY = Math.round(PAGE_Y + PAGE_H - badgeSize - 20);

  const compositePng = await sharp(pageBuffer)
    .composite([{ input: badgeBuffer, left: badgeX, top: badgeY }])
    .png()
    .toBuffer();

  writeFileSync(OUTPUT_PNG, compositePng);
  console.log(`Preview: ${OUTPUT_PNG} (${compositePng.length} bytes)`);

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
