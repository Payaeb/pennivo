import { test, expect, _electron as electron } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { deflateSync } from "node:zlib";

const REPO_PACKAGE_DIR = path.resolve(__dirname, "..");
const SHOTS = path.resolve(__dirname, "../test-results/uat-screenshots");

let app: ElectronApplication;
let window: Page;
let workspaceDir: string;
let userDataDir: string;

// --- fixture images (real PNGs built with zlib, no dependencies) ---------

function crc32(buf: Buffer): number {
  let c: number;
  let crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]!) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function makePng(
  w: number,
  h: number,
  px: (x: number, y: number) => [number, number, number],
): Buffer {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    const row = y * (w * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < w; x++) {
      const [r, g, b] = px(x, y);
      raw[row + 1 + x * 3] = r;
      raw[row + 2 + x * 3] = g;
      raw[row + 3 + x * 3] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 1 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// Quadrant colours + a fine grid so zoom/pan focus is visible.
function gridPixel(w: number, h: number, cell: number) {
  return (x: number, y: number): [number, number, number] => {
    const left = x < w / 2;
    const top = y < h / 2;
    const base: [number, number, number] = top
      ? left
        ? [214, 120, 98]
        : [120, 168, 132]
      : left
        ? [110, 150, 196]
        : [226, 196, 110];
    if (x % cell < 2 || y % cell < 2) return [40, 40, 40];
    return base;
  };
}

// Raw mouse double-click at the element centre. (Playwright's locator.dblclick
// leaves empty style="" attributes on editor nodes via its hit-target checks,
// which would muddy the "editor DOM untouched" assertion.)
async function dblclick(loc: ReturnType<Page["locator"]>): Promise<void> {
  const bb = (await loc.boundingBox())!;
  await window.mouse.dblclick(bb.x + bb.width / 2, bb.y + bb.height / 2);
}

async function shot(name: string): Promise<void> {
  await window.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}

async function readoutPercent(): Promise<number> {
  const t = (await window.locator(".iv-readout").textContent()) ?? "";
  return parseInt(t, 10);
}

async function viewerTransform(): Promise<{
  scale: number;
  tx: number;
  ty: number;
}> {
  return window.evaluate(() => {
    const img = document.querySelector<HTMLElement>(".iv-img")!;
    const m =
      /translate3d\((-?[\d.]+)px, (-?[\d.]+)px, 0px?\) scale\(([\d.e-]+)\)/.exec(
        img.style.transform,
      )!;
    return {
      tx: parseFloat(m[1]!),
      ty: parseFloat(m[2]!),
      scale: parseFloat(m[3]!),
    };
  });
}

async function zoomLevel(): Promise<number> {
  return app.evaluate(
    ({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.webContents.zoomLevel ?? 0,
  );
}

async function isFullScreen(): Promise<boolean> {
  return app.evaluate(
    ({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.isFullScreen() ?? false,
  );
}

async function editorSnapshot() {
  return window.evaluate(() => {
    const area = document.querySelector<HTMLElement>(".app-editor-area");
    const pm = document.querySelector<HTMLElement>(".ProseMirror")!;
    const img = pm.querySelectorAll(
      "img:not(.ProseMirror-separator)",
    )[1] as HTMLElement;
    const r = img.getBoundingClientRect();
    return {
      scrollTop: area?.scrollTop ?? -1,
      box: [r.x, r.y, r.width, r.height].map(Math.round),
      // Playwright's screenshot + first dblclick leaves empty style=""
      // attributes on editor nodes even with the viewer disabled (verified
      // by a control run), so they are ignored here.
      html: pm.innerHTML.replace(/ style=""/g, ""),
      selectedNodes: pm.querySelectorAll(".ProseMirror-selectednode").length,
      focusInEditor: pm.contains(document.activeElement),
      bodyH: document.body.getBoundingClientRect().height,
    };
  });
}

async function setTheme(mode: "light" | "dark", scheme: string) {
  await window.evaluate(
    ([m, s]) => {
      document.documentElement.setAttribute("data-theme", m!);
      document.documentElement.setAttribute("data-color-scheme", s!);
    },
    [mode, scheme],
  );
  // controls fade after 2.5s of no pointer movement; wake them for the shot
  await window.mouse.move(520, 420);
  await window.mouse.move(522, 422);
  await window.waitForTimeout(350);
}

test.beforeAll(async () => {
  await mkdir(SHOTS, { recursive: true });
  workspaceDir = await mkdtemp(path.join(tmpdir(), "pennivo-e2e-iv-ws-"));
  userDataDir = await mkdtemp(path.join(tmpdir(), "pennivo-e2e-iv-ud-"));
  await writeFile(
    path.join(userDataDir, "sidebar-folder.json"),
    JSON.stringify(workspaceDir),
    "utf-8",
  );
  const imgDir = path.join(workspaceDir, "doc-md-images");
  await mkdir(imgDir, { recursive: true });
  await writeFile(
    path.join(imgDir, "tiny.png"),
    makePng(24, 16, gridPixel(24, 16, 8)),
  );
  await writeFile(
    path.join(imgDir, "normal.png"),
    makePng(1600, 900, gridPixel(1600, 900, 100)),
  );
  await writeFile(
    path.join(imgDir, "huge.png"),
    makePng(6000, 4000, gridPixel(6000, 4000, 40)),
  );
  const filler = Array.from(
    { length: 30 },
    (_, i) =>
      `Paragraph ${i + 1}. The quick brown fox jumps over the lazy dog while the editor scrolls.`,
  ).join("\n\n");
  const md = [
    "# Image viewer UAT",
    "",
    filler,
    "",
    "![Tiny swatch](./doc-md-images/tiny.png)",
    "",
    "![Quadrant chart](./doc-md-images/normal.png)",
    "",
    "![Huge grid](./doc-md-images/huge.png)",
    "",
    "![Missing picture](./doc-md-images/missing.png)",
    "",
    "Closing paragraph.",
    "",
  ].join("\n");
  await writeFile(path.join(workspaceDir, "doc.md"), md, "utf-8");

  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k !== "ELECTRON_RUN_AS_NODE" && typeof v === "string") env[k] = v;
  }
  app = await electron.launch({
    args: [REPO_PACKAGE_DIR, `--user-data-dir=${userDataDir}`],
    env,
    timeout: 30_000,
  });
  window = await app.firstWindow();
  await window.waitForSelector(".sidebar", { timeout: 20_000 });
});

test.afterAll(async () => {
  try {
    await app.evaluate(({ BrowserWindow }) => {
      for (const w of BrowserWindow.getAllWindows()) {
        try {
          w.destroy();
        } catch {
          // ignore
        }
      }
    });
  } catch {
    // ignore
  }
  try {
    await app.close();
  } catch {
    // ignore
  }
  await rm(workspaceDir, { recursive: true, force: true });
  await rm(userDataDir, { recursive: true, force: true });
});

test("image viewer: open, zoom, pan, full screen, isolation, themes", async () => {
  test.setTimeout(240_000);
  await window.waitForTimeout(700);
  const docPath = path.join(workspaceDir, "doc.md").replace(/\\/g, "/");
  await window.locator(`[data-path="${docPath}"]`).click();
  await window.waitForSelector(".ProseMirror img:not(.ProseMirror-separator)", {
    timeout: 15_000,
  });
  await expect
    .poll(() =>
      window.evaluate(
        () =>
          Array.from(
            document.querySelectorAll(
              ".ProseMirror img:not(.ProseMirror-separator)",
            ),
          ).filter((i) => (i as HTMLImageElement).naturalWidth > 0).length,
      ),
    )
    .toBe(3);

  const imgs = window.locator(".ProseMirror img:not(.ProseMirror-separator)");
  const normal = imgs.nth(1);
  await normal.scrollIntoViewIfNeeded();
  await window.waitForTimeout(200);

  // ---------- 1. double-click opens; editor is not disturbed ----------
  await normal.click(); // single click selects the image
  await expect(window.locator(".ProseMirror-selectednode")).toHaveCount(1);
  const before = await editorSnapshot();
  await shot("01-editor-before");

  await dblclick(normal);
  const dialog = window.locator('[role="dialog"][aria-modal="true"]');
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("aria-label", /Quadrant chart/);
  await window.waitForTimeout(400);
  await shot("02-viewer-light-fit");
  const fitPct = await readoutPercent();
  expect(fitPct).toBeGreaterThan(20);
  expect(fitPct).toBeLessThan(100);

  // ---------- 2. wheel zoom anchored at the cursor ----------
  const cx = 700;
  const cy = 300;
  await window.locator('button[aria-label="Actual size"]').click();
  await window.mouse.move(cx, cy);
  const t0 = await viewerTransform();
  const imgPt0 = { x: (cx - t0.tx) / t0.scale, y: (cy - t0.ty) / t0.scale };
  for (let i = 0; i < 2; i++) await window.mouse.wheel(0, -120);
  await window.waitForTimeout(200);
  const t1 = await viewerTransform();
  expect(t1.scale).toBeGreaterThan(t0.scale * 1.2);
  const imgPt1 = { x: (cx - t1.tx) / t1.scale, y: (cy - t1.ty) / t1.scale };
  expect(Math.abs(imgPt1.x - imgPt0.x)).toBeLessThan(2);
  expect(Math.abs(imgPt1.y - imgPt0.y)).toBeLessThan(2);
  await shot("03-viewer-zoomed-at-cursor");

  // ---------- 3. Ctrl+wheel / Ctrl+= must not zoom the app ----------
  const appZoomBefore = await zoomLevel();
  const pctBefore = await readoutPercent();
  await window.keyboard.down("Control");
  await window.mouse.wheel(0, -200);
  await window.keyboard.up("Control");
  await window.keyboard.press("Control+=");
  await window.keyboard.press("Control+-");
  await window.waitForTimeout(250);
  expect(await zoomLevel()).toBe(appZoomBefore);
  // Ctrl+wheel zoomed the image instead
  expect(await readoutPercent()).not.toBe(pctBefore);

  // ---------- 4. 1:1, pan by drag, Fit ----------
  await window.locator('button[aria-label="Actual size"]').click();
  expect(await readoutPercent()).toBe(100);
  const p0 = await viewerTransform();
  await window.mouse.move(600, 400);
  await window.mouse.down();
  await window.mouse.move(500, 340, { steps: 6 });
  await window.mouse.up();
  await window.waitForTimeout(100);
  const p1 = await viewerTransform();
  expect(p1.tx).toBeLessThan(p0.tx);
  expect(p1.ty).toBeLessThan(p0.ty);
  await shot("04-viewer-100pct-panned");
  await window.keyboard.press("ArrowLeft");
  await window.keyboard.press("0");
  expect(await readoutPercent()).toBe(fitPct);
  await window.locator('button[aria-label="Actual size"]').click();
  await window.locator('button[aria-label="Fit to window"]').click();
  expect(await readoutPercent()).toBe(fitPct);

  // double-click toggles 200% and back
  await dialog.locator(".iv-stage").dblclick({ position: { x: 500, y: 300 } });
  expect(await readoutPercent()).toBe(200);
  await dialog.locator(".iv-stage").dblclick({ position: { x: 500, y: 300 } });
  expect(await readoutPercent()).toBe(fitPct);

  // ---------- 5. full screen and back ----------
  expect(await isFullScreen()).toBe(false);
  await window.locator('button[aria-label="Full screen"]').click();
  await expect.poll(isFullScreen).toBe(true);
  await window.waitForTimeout(500);
  await shot("05-viewer-fullscreen");
  await window.keyboard.press("f");
  await expect.poll(isFullScreen).toBe(false);
  // leave it in full screen and close with Esc: viewer must restore it
  await window.keyboard.press("f");
  await expect.poll(isFullScreen).toBe(true);
  await window.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect.poll(isFullScreen).toBe(false);

  // ---------- 6. editor exactly as before ----------
  await window.waitForTimeout(300);
  const after = await editorSnapshot();
  expect(after.scrollTop).toBe(before.scrollTop);
  expect(after.box).toEqual(before.box);
  expect(after.html).toBe(before.html);
  expect(after.selectedNodes).toBe(before.selectedNodes);
  expect(after.focusInEditor).toBe(true);
  expect(after.bodyH).toBe(before.bodyH);
  await shot("06-editor-after-close");

  // ---------- 7. hover badge ----------
  await normal.hover();
  const badge = window.locator(".pennivo-image-badge");
  await expect(badge).toBeVisible();
  await shot("07-hover-badge");
  await badge.click();
  await expect(dialog).toBeVisible();
  await window.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  // ---------- 9. themes ----------
  await dblclick(normal);
  await expect(dialog).toBeVisible();
  await window.waitForTimeout(300);
  const themes: Array<["light" | "dark", string, string]> = [
    ["light", "default", "light"],
    ["dark", "default", "dark"],
    ["light", "sepia", "sepia-light"],
    ["dark", "sepia", "sepia-dark"],
    ["dark", "nord", "nord"],
    ["dark", "rosepine", "rosepine"],
  ];
  for (const [mode, scheme, name] of themes) {
    await setTheme(mode, scheme);
    await shot(`08-theme-${name}`);
  }
  await setTheme("light", "default");
  await window.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  // ---------- 10. tiny image ----------
  const tiny = imgs.nth(0);
  await tiny.scrollIntoViewIfNeeded();
  await dblclick(tiny);
  await expect(dialog).toBeVisible();
  await window.waitForTimeout(300);
  expect(await readoutPercent()).toBe(100);
  await shot("09-tiny-at-100");
  await window.keyboard.press("-");
  await window.keyboard.press("-");
  await window.keyboard.press("-");
  await window.keyboard.press("-");
  await window.keyboard.press("-");
  await window.keyboard.press("-");
  await window.keyboard.press("-");
  expect(await readoutPercent()).toBe(25);
  await window.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  // ---------- 11. very large image ----------
  const huge = imgs.nth(2);
  await huge.scrollIntoViewIfNeeded();
  await dblclick(huge);
  await expect(dialog).toBeVisible();
  await window.waitForTimeout(800);
  await shot("10-huge-fit");
  const hugeFit = await readoutPercent();
  expect(hugeFit).toBeLessThan(30);
  await window.mouse.move(640, 360);
  const t = Date.now();
  for (let i = 0; i < 70; i++) await window.mouse.wheel(0, -120);
  await window.waitForTimeout(300);
  console.log(`huge image: 70 wheel events + settle in ${Date.now() - t}ms`);
  expect(await readoutPercent()).toBe(3200);
  await shot("11-huge-3200pct");
  await window.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  // ---------- 12. broken image: editor refuses, viewer shows calm state ----------
  const broken = imgs.nth(3);
  await broken.scrollIntoViewIfNeeded();
  await dblclick(broken);
  await window.waitForTimeout(300);
  await expect(dialog).toHaveCount(0);
  await window.evaluate(() => {
    window.dispatchEvent(
      new CustomEvent("pennivo-open-image-viewer", {
        detail: {
          src: "pennivo-file:///nope/missing.png",
          alt: "Missing picture",
        },
      }),
    );
  });
  await expect(dialog).toBeVisible();
  await expect(window.getByText("Couldn't load this image")).toBeVisible();
  await expect(window.locator('button[aria-label="Zoom in"]')).toBeDisabled();
  await shot("12-broken-state");
  await window.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  // ---------- 13. focus mode: Esc closes only the viewer ----------
  await normal.scrollIntoViewIfNeeded();
  await window.keyboard.press("Control+Shift+P");
  await expect(window.locator(".command-palette-input")).toBeFocused();
  await window.keyboard.type("Toggle Focus Mode");
  await window.keyboard.press("Enter");
  await expect(window.locator(".app-shell--focus")).toHaveCount(1);
  await expect.poll(isFullScreen).toBe(true);
  await window.waitForTimeout(600);
  await dblclick(normal);
  await expect(dialog).toBeVisible();
  const fsBtn = window.locator(
    'button[aria-label="Already full screen (focus mode)"]',
  );
  await expect(fsBtn).toBeEnabled();
  await expect(fsBtn).toHaveAttribute("aria-pressed", "true");
  // zoom and pan stay fully available in focus mode
  const focusFit = await readoutPercent();
  await window.mouse.move(700, 300);
  for (let i = 0; i < 6; i++) await window.mouse.wheel(0, -120);
  await window.waitForTimeout(200);
  expect(await readoutPercent()).toBeGreaterThan(focusFit);
  await fsBtn.click();
  await window.waitForTimeout(200);
  expect(await isFullScreen()).toBe(true);
  await window.keyboard.press("0");
  await shot("13-viewer-in-focus-mode");
  await window.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await window.waitForTimeout(300);
  await expect(window.locator(".app-shell--focus")).toHaveCount(1);
  expect(await isFullScreen()).toBe(true);
  // a second Esc now leaves focus mode as before
  await window.keyboard.press("Escape");
  await expect(window.locator(".app-shell--focus")).toHaveCount(0);
  await expect.poll(isFullScreen).toBe(false);

  // ---------- 14. resize re-fits when at fit ----------
  await normal.scrollIntoViewIfNeeded();
  await dblclick(normal);
  await expect(dialog).toBeVisible();
  const wide = await readoutPercent();
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setSize(900, 620);
  });
  await window.waitForTimeout(500);
  const narrow = await readoutPercent();
  expect(narrow).toBeLessThan(wide);
  await shot("14-resized-refit");
  await window.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("full screen: zoom into a region and keep zooming far past 800%", async () => {
  test.setTimeout(180_000);
  const dialog = window.locator('[role="dialog"][aria-modal="true"]');
  const huge = window
    .locator(".ProseMirror img:not(.ProseMirror-separator)")
    .nth(2);
  await huge.scrollIntoViewIfNeeded();
  await dblclick(huge);
  await expect(dialog).toBeVisible();
  await window.waitForTimeout(500);

  // enter viewer-owned OS full screen with the button
  await window.locator('button[aria-label="Full screen"]').click();
  await expect.poll(isFullScreen).toBe(true);
  await window.waitForTimeout(800);
  await expect(dialog).toBeVisible();
  // keys must still reach the viewer: focus is inside the overlay
  expect(
    await window.evaluate(() =>
      document
        .querySelector('[role="dialog"]')!
        .contains(document.activeElement),
    ),
  ).toBe(true);
  const vp = await window.evaluate(() => ({
    w: window.innerWidth,
    h: window.innerHeight,
  }));
  const fsFit = await readoutPercent();
  await shot("15-fullscreen-fit");

  // zoom at an off-centre point, step after step, far past the old 800% cap
  const cx = Math.round(vp.w * 0.7);
  const cy = Math.round(vp.h * 0.3);
  await window.mouse.move(cx, cy);
  for (let i = 0; i < 24; i++) await window.mouse.wheel(0, -120);
  await window.waitForTimeout(250);
  let t = await viewerTransform();
  expect(t.scale).toBeGreaterThan(1);
  const imgPt = { x: (cx - t.tx) / t.scale, y: (cy - t.ty) / t.scale };
  const anchorDrift = async () => {
    const n = await viewerTransform();
    return Math.max(
      Math.abs(n.tx + imgPt.x * n.scale - cx),
      Math.abs(n.ty + imgPt.y * n.scale - cy),
    );
  };
  let peak = await readoutPercent();
  for (let round = 0; round < 6; round++) {
    for (let i = 0; i < 8; i++) await window.mouse.wheel(0, -120);
    await window.waitForTimeout(150);
    expect(await anchorDrift()).toBeLessThan(2);
    peak = Math.max(peak, await readoutPercent());
  }
  expect(peak).toBeGreaterThan(800);
  expect(peak).toBe(3200);
  t = await viewerTransform();
  expect(await anchorDrift()).toBeLessThan(2);
  await shot("16-fullscreen-3200pct-region");

  // pan at max zoom, by drag and by arrows, and zoom back out with keys
  const before = await viewerTransform();
  await window.mouse.move(cx, cy);
  await window.mouse.down();
  await window.mouse.move(cx - 150, cy + 90, { steps: 8 });
  await window.mouse.up();
  await window.waitForTimeout(150);
  const dragged = await viewerTransform();
  expect(dragged.tx).toBeLessThan(before.tx - 100);
  expect(dragged.ty).toBeGreaterThan(before.ty);
  await window.keyboard.press("Shift+ArrowRight");
  await window.waitForTimeout(150);
  const panned = await viewerTransform();
  expect(panned.tx).toBeLessThan(dragged.tx - 200);
  await window.keyboard.press("-");
  await window.waitForTimeout(100);
  expect(await readoutPercent()).toBeLessThan(3200);
  await window.keyboard.press("+");
  await window.waitForTimeout(100);
  expect(await readoutPercent()).toBe(3200);

  // zoom out to a mid level, remember the region at the viewport centre
  for (let i = 0; i < 8; i++) await window.keyboard.press("-");
  await window.waitForTimeout(150);
  const mid = await viewerTransform();
  const centreBefore = {
    x: (vp.w / 2 - mid.tx) / mid.scale,
    y: (vp.h / 2 - mid.ty) / mid.scale,
  };

  // leave full screen: zoom level and focal region survive the resize
  await window.keyboard.press("f");
  await expect.poll(isFullScreen).toBe(false);
  await window.waitForTimeout(800);
  const vp2 = await window.evaluate(() => ({
    w: window.innerWidth,
    h: window.innerHeight,
  }));
  expect(vp2.w).toBeLessThan(vp.w);
  const after = await viewerTransform();
  expect(after.scale).toBeCloseTo(mid.scale, 6);
  const centreAfter = {
    x: (vp2.w / 2 - after.tx) / after.scale,
    y: (vp2.h / 2 - after.ty) / after.scale,
  };
  expect(Math.abs(centreAfter.x - centreBefore.x)).toBeLessThan(1);
  expect(Math.abs(centreAfter.y - centreBefore.y)).toBeLessThan(1);
  await shot("17-windowed-after-fullscreen-exit");
  expect(fsFit).toBeGreaterThan(0);

  // zoom still works in the windowed state
  const level = await readoutPercent();
  await window.keyboard.press("+");
  await window.waitForTimeout(100);
  expect(await readoutPercent()).toBeGreaterThan(level);
  await window.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("open animation plays, and is opacity-only under reduced motion", async () => {
  test.setTimeout(60_000);
  const dialog = window.locator('[role="dialog"][aria-modal="true"]');
  const normal = window
    .locator(".ProseMirror img:not(.ProseMirror-separator)")
    .nth(1);
  const anim = () =>
    window.evaluate(() => {
      const el = document.querySelector<HTMLElement>(".iv-overlay")!;
      const cs = getComputedStyle(el);
      return { name: cs.animationName, duration: cs.animationDuration };
    });

  await normal.scrollIntoViewIfNeeded();
  await dblclick(normal);
  await expect(dialog).toBeVisible();
  const full = await anim();
  expect(full.name).toBe("iv-in");
  expect(parseFloat(full.duration)).toBeGreaterThanOrEqual(0.12);
  expect(parseFloat(full.duration)).toBeLessThanOrEqual(0.16);
  await window.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  await window.emulateMedia({ reducedMotion: "reduce" });
  await dblclick(normal);
  await expect(dialog).toBeVisible();
  expect((await anim()).name).toBe("iv-in-reduced");
  await window.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await window.emulateMedia({ reducedMotion: "no-preference" });
});
