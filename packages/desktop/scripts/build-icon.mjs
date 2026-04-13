// Generate the Windows multi-resolution .ico for Pennivo from the master SVG,
// and refresh every raster that the app ships with.
//
// Source:  brand/pennivo-icon.svg  (512 viewBox, vignette nib on #34b56f)
// Outputs:
//   packages/desktop/build/icon.ico       — electron-builder installer + .exe
//   packages/desktop/resources/icon.ico   — bundled with the app for runtime
//   packages/desktop/resources/icon.png   — BrowserWindow icon (1024px)
//   packages/desktop/public/favicon.png   — dev-mode favicon (256px)
//   packages/ui/src/assets/logo-32.png    — custom titlebar + About dialog
//   packages/ui/src/assets/logo-16.png    — reserved for 16px UI contexts
//
// Run: pnpm --filter @pennivo/desktop build:icon

import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import sharp from 'sharp';
import png2icons from 'png2icons';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SOURCE_SVG = resolve(__dirname, '../../../brand/pennivo-icon.svg');
const BUILD_DIR = resolve(__dirname, '../build');
const RESOURCES_DIR = resolve(__dirname, '../resources');
const PUBLIC_DIR = resolve(__dirname, '../public');

const UI_ASSETS_DIR = resolve(__dirname, '../../ui/src/assets');

const BUILD_ICO = resolve(BUILD_DIR, 'icon.ico');
const RESOURCES_ICO = resolve(RESOURCES_DIR, 'icon.ico');
const RESOURCES_PNG = resolve(RESOURCES_DIR, 'icon.png');
const PUBLIC_FAVICON = resolve(PUBLIC_DIR, 'favicon.png');
const UI_LOGO_32 = resolve(UI_ASSETS_DIR, 'logo-32.png');
const UI_LOGO_16 = resolve(UI_ASSETS_DIR, 'logo-16.png');

const svgBuf = readFileSync(SOURCE_SVG);

// Render master PNG at 1024x1024 from the SVG. png2icons will embed
// 16/24/32/48/64/128/256 layers internally.
const masterPng = await sharp(svgBuf, { density: 384 })
  .resize(1024, 1024)
  .png()
  .toBuffer();

const faviconPng = await sharp(svgBuf, { density: 192 })
  .resize(256, 256)
  .png()
  .toBuffer();

const logo32Png = await sharp(svgBuf, { density: 96 })
  .resize(32, 32)
  .png()
  .toBuffer();

const logo16Png = await sharp(svgBuf, { density: 48 })
  .resize(16, 16)
  .png()
  .toBuffer();

const ico = png2icons.createICO(masterPng, png2icons.BICUBIC, 0, false);
if (!ico) {
  console.error('Failed to generate ICO from', SOURCE_SVG);
  process.exit(1);
}

mkdirSync(BUILD_DIR, { recursive: true });
mkdirSync(RESOURCES_DIR, { recursive: true });
mkdirSync(PUBLIC_DIR, { recursive: true });

writeFileSync(BUILD_ICO, ico);
writeFileSync(RESOURCES_ICO, ico);
writeFileSync(RESOURCES_PNG, masterPng);
writeFileSync(PUBLIC_FAVICON, faviconPng);
writeFileSync(UI_LOGO_32, logo32Png);
writeFileSync(UI_LOGO_16, logo16Png);

console.log(`Wrote ${BUILD_ICO} (${ico.length} bytes)`);
console.log(`Wrote ${RESOURCES_ICO} (${ico.length} bytes)`);
console.log(`Wrote ${RESOURCES_PNG} (${masterPng.length} bytes, 1024x1024)`);
console.log(`Wrote ${PUBLIC_FAVICON} (${faviconPng.length} bytes, 256x256)`);
console.log(`Wrote ${UI_LOGO_32} (${logo32Png.length} bytes, 32x32)`);
console.log(`Wrote ${UI_LOGO_16} (${logo16Png.length} bytes, 16x16)`);
