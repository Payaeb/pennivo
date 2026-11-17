// GH #1: configurable editor maximum width (Narrow / Default / Wide / Full).
// Measures the real editor column in WYSIWYG and source mode, checks restart
// persistence and that nothing scrolls horizontally in a small window, and
// writes screenshots of every preset to test-results/editor-width-shots.

import { test, expect, _electron as electron } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { deflateSync } from "node:zlib";

const REPO_PACKAGE_DIR = path.resolve(__dirname, "..");
const SHOTS = path.resolve(__dirname, "../test-results/editor-width-shots");

const PRESETS = ["narrow", "default", "wide", "full"] as const;
type Preset = (typeof PRESETS)[number];
const MAX_PX: Record<Preset, number | null> = {
  narrow: 560,
  default: 680,
  wide: 960,
  full: null,
};
const FULL_GUTTER = 56;

let app: ElectronApplication;
let window: Page;
let workspaceDir: string;
let userDataDir: string;
let docPath: string;

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    let c = (crc ^ buf[n]!) & 0xff;
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
function makePng(w: number, h: number): Buffer {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    const row = y * (w * 3 + 1);
    for (let x = 0; x < w; x++) {
      const band = Math.floor(x / 80) % 2 === 0;
      raw[row + 1 + x * 3] = band ? 74 : 120;
      raw[row + 2 + x * 3] = band ? 124 : 160;
      raw[row + 3 + x * 3] = band ? 89 : 130;
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
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const PROSE =
  "Most of the writing people do is read far more often than it is written, so the shape of the column matters. A line that runs too long tires the eye, while a line that runs too short breaks every thought in half.";

const DOC = [
  "# Editor width check",
  "",
  PROSE,
  "",
  PROSE,
  "",
  "| Name | Role | Region | Quarter | Status | Notes |",
  "| --- | --- | --- | --- | --- | --- |",
  "| Ada | Editor | West | Q1 | Done | Shipped the first draft early |",
  "| Grace | Author | East | Q2 | Open | Needs a second pass on chapter four |",
  "| Linus | Reviewer | North | Q3 | Open | Waiting on the revised outline |",
  "",
  "```ts",
  "export function describeWidth(preset: string): string {",
  "  return `The editor column uses the ${preset} preset, which keeps long lines readable on a wide monitor.`;",
  "}",
  "```",
  "",
  "![Wide banner](./doc-md-images/banner.png)",
  "",
  PROSE,
  "",
].join("\n");

function buildEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k !== "ELECTRON_RUN_AS_NODE" && typeof v === "string") env[k] = v;
  }
  return env;
}

async function launch(): Promise<void> {
  app = await electron.launch({
    args: [REPO_PACKAGE_DIR, `--user-data-dir=${userDataDir}`],
    env: buildEnv(),
    timeout: 30_000,
  });
  window = await app.firstWindow();
  await window.waitForSelector(".sidebar", { timeout: 20_000 });
  await window.locator(`[data-path="${docPath.replace(/\\/g, "/")}"]`).click();
  await window.waitForSelector(".ProseMirror", { timeout: 10_000 });
  // let the startup width hydration settle
  await window.waitForTimeout(300);
}

async function close(): Promise<void> {
  try {
    // destroy() skips the app's close-confirmation path, like other specs.
    await app.evaluate(({ BrowserWindow }) => {
      for (const w of BrowserWindow.getAllWindows()) w.destroy();
    });
  } catch {
    // ignore
  }
  try {
    await app.close();
  } catch {
    // ignore
  }
}

async function setWindowSize(w: number, h: number): Promise<void> {
  await app.evaluate(
    ({ BrowserWindow }, [cw, ch]) => {
      const win = BrowserWindow.getAllWindows()[0]!;
      win.setMinimumSize(300, 300);
      win.setContentSize(cw!, ch!);
    },
    [w, h],
  );
  await window.waitForTimeout(400);
}

async function chooseWidth(preset: Preset): Promise<void> {
  await window.keyboard.press("Control+,");
  const select = window.getByLabel("Editor width");
  await select.waitFor({ state: "visible" });
  await select.selectOption(preset);
  await expect(select).toHaveValue(preset);
  await window.keyboard.press("Escape");
  await expect(window.locator(".settings-panel")).toHaveCount(0);
  await window.waitForTimeout(200);
}

async function setSource(on: boolean): Promise<void> {
  const isSource = (await window.locator(".app-shell--source").count()) > 0;
  if (isSource === on) return;
  await window.keyboard.press("Control+Shift+P");
  await window.waitForSelector(".command-palette", { timeout: 3000 });
  await window.waitForTimeout(150);
  await window.keyboard.type("Toggle Source Mode");
  await window.keyboard.press("Enter");
  await expect(window.locator(".command-palette")).toHaveCount(0);
  await window.waitForTimeout(500);
  await expect(window.locator(".app-shell--source")).toHaveCount(on ? 1 : 0);
}

async function measure() {
  return window.evaluate(() => {
    const col = document.querySelector<HTMLElement>(".app-editor-column")!;
    const area = document.querySelector<HTMLElement>(".app-editor-area")!;
    const cs = getComputedStyle(area);
    const padL = parseFloat(cs.paddingLeft);
    const padR = parseFloat(cs.paddingRight);
    const r = col.getBoundingClientRect();
    const ar = area.getBoundingClientRect();
    const inner = document.querySelector<HTMLElement>(
      ".app-shell--source .cm-editor, .ProseMirror",
    );
    return {
      col: r.width,
      areaInner: area.clientWidth - padL - padR,
      areaClient: area.clientWidth,
      leftGap: r.left - ar.left,
      rightGap: ar.right - r.right,
      docScrollW: document.documentElement.scrollWidth,
      docClientW: document.documentElement.clientWidth,
      areaScrollW: area.scrollWidth,
      innerRight: inner ? inner.getBoundingClientRect().right : 0,
      winW: window.innerWidth,
      varValue: getComputedStyle(document.documentElement)
        .getPropertyValue("--editor-max-width")
        .trim(),
    };
  });
}

function expectedWidth(
  preset: Preset,
  m: { areaInner: number; areaClient: number },
  source: boolean,
) {
  // In source mode the area has no padding; the column carries its own.
  const avail = source ? m.areaClient : m.areaInner;
  const cap = MAX_PX[preset];
  return cap === null ? avail : Math.min(cap, avail);
}

test.beforeAll(async () => {
  await mkdir(SHOTS, { recursive: true });
  workspaceDir = await mkdtemp(path.join(tmpdir(), "pennivo-e2e-ew-ws-"));
  userDataDir = await mkdtemp(path.join(tmpdir(), "pennivo-e2e-ew-ud-"));
  await mkdir(path.join(workspaceDir, "doc-md-images"), { recursive: true });
  await writeFile(
    path.join(workspaceDir, "doc-md-images", "banner.png"),
    makePng(1400, 360),
  );
  docPath = path.join(workspaceDir, "doc.md");
  await writeFile(docPath, DOC, "utf-8");
  await writeFile(
    path.join(userDataDir, "sidebar-folder.json"),
    JSON.stringify(workspaceDir),
    "utf-8",
  );
});

test.afterAll(async () => {
  await close();
  await rm(workspaceDir, { recursive: true, force: true }).catch(() => {});
  await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
});

test("every preset sets the measured column width in WYSIWYG and source mode", async () => {
  test.setTimeout(180_000);
  await launch();
  await setWindowSize(1600, 900);

  // Default before anything is touched is exactly today's 680px.
  let m = await measure();
  expect(m.col).toBe(680);

  for (const source of [false, true]) {
    await setSource(source);
    for (const preset of PRESETS) {
      await chooseWidth(preset);
      m = await measure();
      const want = expectedWidth(preset, m, source);
      expect(m.col, `${preset} source=${source}`).toBeCloseTo(want, 0);
      if (preset === "default") {
        expect(m.col).toBe(680);
        expect(m.varValue).toBe("680px");
      }
      if (preset === "full") {
        // Full equals the available width: the area minus the gutter on each
        // side (WYSIWYG: area padding; source: the column's own padding).
        expect(m.col).toBeCloseTo(
          source ? m.areaClient : m.areaClient - FULL_GUTTER * 2,
          0,
        );
        expect(m.leftGap).toBeGreaterThanOrEqual(source ? 0 : FULL_GUTTER);
        expect(m.rightGap).toBeGreaterThanOrEqual(source ? 0 : FULL_GUTTER);
      }
      expect(m.docScrollW).toBeLessThanOrEqual(m.docClientW);
    }
  }
  await chooseWidth("default");
  await setSource(false);
  await close();
});

test("a wide preset in a small window fills the width with no horizontal scroll", async () => {
  test.setTimeout(120_000);
  await launch();
  await setWindowSize(620, 760);
  for (const preset of ["wide", "full"] as const) {
    for (const source of [false, true]) {
      await setSource(source);
      await chooseWidth(preset);
      const m = await measure();
      expect(m.col, `${preset} source=${source}`).toBeLessThanOrEqual(
        m.areaClient,
      );
      expect(m.docScrollW).toBeLessThanOrEqual(m.docClientW);
      expect(m.areaScrollW).toBeLessThanOrEqual(m.areaClient);
      expect(m.innerRight).toBeLessThanOrEqual(m.winW);
    }
  }
  await setSource(false);
  await chooseWidth("default");
  await close();
});

test("the choice persists to settings.json and survives a restart", async () => {
  test.setTimeout(120_000);
  await launch();
  await setWindowSize(1600, 900);
  await chooseWidth("wide");
  await expect
    .poll(async () => {
      const raw = await readFile(
        path.join(userDataDir, "settings.json"),
        "utf-8",
      );
      return JSON.parse(raw).editorWidth;
    })
    .toBe("wide");
  await close();

  await launch();
  await setWindowSize(1600, 900);
  expect((await measure()).col).toBe(960);
  await window.keyboard.press("Control+,");
  await expect(window.getByLabel("Editor width")).toHaveValue("wide");
  await window.keyboard.press("Escape");
  await close();

  // a corrupt stored value falls back to Default
  const sp = path.join(userDataDir, "settings.json");
  const cur = JSON.parse(await readFile(sp, "utf-8"));
  cur.editorWidth = "gigantic";
  await writeFile(sp, JSON.stringify(cur), "utf-8");
  await launch();
  await setWindowSize(1600, 900);
  expect((await measure()).col).toBe(680);
  await window.keyboard.press("Control+,");
  await expect(window.getByLabel("Editor width")).toHaveValue("default");
  await window.keyboard.press("Escape");
  await close();
});

test("screenshots of every preset, both themes, wide and narrow windows", async () => {
  test.setTimeout(300_000);
  await launch();
  const sizes: Array<[string, number, number]> = [
    ["wide", 1920, 1000],
    ["small", 760, 800],
  ];
  for (const [label, w, h] of sizes) {
    await setWindowSize(w, h);
    for (const preset of PRESETS) {
      await chooseWidth(preset);
      for (const theme of ["light", "dark"] as const) {
        await window.evaluate((t) => {
          document.documentElement.setAttribute("data-theme", t);
        }, theme);
        await window.waitForTimeout(250);
        await window.screenshot({
          path: path.join(SHOTS, `${label}-${preset}-${theme}.png`),
        });
      }
    }
  }
  // source mode at the wide window
  await setWindowSize(1920, 1000);
  await setSource(true);
  for (const preset of ["default", "full"] as const) {
    await chooseWidth(preset);
    await window.screenshot({
      path: path.join(SHOTS, `wide-${preset}-source.png`),
    });
  }
  await setSource(false);
  // the control itself
  await window.evaluate(() =>
    document.documentElement.setAttribute("data-theme", "light"),
  );
  await window.keyboard.press("Control+,");
  await window.getByLabel("Editor width").waitFor();
  await window.screenshot({
    path: path.join(SHOTS, "settings-control-light.png"),
  });
  await window.evaluate(() =>
    document.documentElement.setAttribute("data-theme", "dark"),
  );
  await window.waitForTimeout(200);
  await window.screenshot({
    path: path.join(SHOTS, "settings-control-dark.png"),
  });
  await window.keyboard.press("Escape");
  await close();
});
