// Generate the Windows multi-resolution .ico for Pennivo from the master logo,
// and refresh the runtime PNG used by BrowserWindow in dev mode.
//
// Source:  assets/pennivo clean square large.png   (1024x1024 PNG)
// Outputs:
//   packages/desktop/build/icon.ico       — used by electron-builder (installer, .exe, .md association)
//   packages/desktop/resources/icon.ico   — same .ico, bundled with the app for runtime use
//   packages/desktop/resources/icon.png   — runtime BrowserWindow icon (Electron downscales as needed)
//
// Run: pnpm --filter @pennivo/desktop build:icon

import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import png2icons from 'png2icons';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SOURCE = resolve(__dirname, '../../../assets/pennivo clean square large.png');
const BUILD_DIR = resolve(__dirname, '../build');
const RESOURCES_DIR = resolve(__dirname, '../resources');
const BUILD_ICO = resolve(BUILD_DIR, 'icon.ico');
const RESOURCES_ICO = resolve(RESOURCES_DIR, 'icon.ico');
const RESOURCES_PNG = resolve(RESOURCES_DIR, 'icon.png');

const sourceBuf = readFileSync(SOURCE);

// png2icons.createICO embeds 16/24/32/48/64/128/256 layers automatically.
// BICUBIC is the highest-quality resampler available in the package.
const ico = png2icons.createICO(sourceBuf, png2icons.BICUBIC, 0, false);

if (!ico) {
  console.error('Failed to generate ICO from', SOURCE);
  process.exit(1);
}

mkdirSync(BUILD_DIR, { recursive: true });
mkdirSync(RESOURCES_DIR, { recursive: true });

writeFileSync(BUILD_ICO, ico);
writeFileSync(RESOURCES_ICO, ico);
copyFileSync(SOURCE, RESOURCES_PNG);

console.log(`Wrote ${BUILD_ICO} (${ico.length} bytes)`);
console.log(`Wrote ${RESOURCES_ICO} (${ico.length} bytes)`);
console.log(`Wrote ${RESOURCES_PNG} (copy of master)`);
