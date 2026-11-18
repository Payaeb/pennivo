import { test, expect, _electron as electron } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  copyFile,
  rm,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { deflateSync } from "node:zlib";

// Export must contain the document, not the editor's own chrome (collapse
// handles, image badge, decoration classes), and collapsed bullets must still
// export in full.

const REPO_PACKAGE_DIR = path.resolve(__dirname, "..");
const OUT_DIR = path.resolve(__dirname, "../test-results/export-clean");
// Optional: path to a real markdown file to export as well (never written to).
const REAL_MD = process.env.PENNIVO_EXPORT_REAL_MD ?? "";

let app: ElectronApplication;
let window: Page;
let workspaceDir: string;
let userDataDir: string;

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

function makePng(w: number, h: number): Buffer {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    const row = y * (w * 3 + 1);
    for (let x = 0; x < w; x++) {
      raw[row + 1 + x * 3] = 200;
      raw[row + 2 + x * 3] = 90 + (x % 50);
      raw[row + 3 + x * 3] = 80;
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

const FIXTURE = [
  "# Export fixture",
  "",
  "* Launch plan #planning",
  "",
  "  * Audience research",
  "",
  "    * Interview five early readers",
  "",
  "    * Compare launch timing",
  "",
  "  * Launch tasks",
  "",
  "    * [ ] Draft social captions #marketing \\[due:: 2026-10-11]",
  "",
  "    * [x] Schedule launch emails \\[done:: 2026-10-12]",
  "",
  "* Press list",
  "",
  "  * Pitch the regional paper",
  "",
  "1. Week one: teaser excerpt",
  "2. Week two: behind-the-scenes photos",
  "",
  "   1. [ ] nested task one",
  "   2. [ ] nested task two",
  "",
  "![Swatch](./doc-md-images/pic.png)",
  "",
  "| Name | Role |",
  "| ---- | ---- |",
  "| Ada | Author |",
  "| Bo | Editor |",
  "",
  "```ts",
  "const answer = 42;",
  "```",
  "",
  "```mermaid",
  "graph TD",
  "  A[Start] --> B[Finish]",
  "```",
  "",
  "Closing paragraph.",
  "",
].join("\n");

async function launch(files: Record<string, string | Buffer>): Promise<void> {
  workspaceDir = await mkdtemp(path.join(tmpdir(), "pennivo-e2e-export-ws-"));
  userDataDir = await mkdtemp(path.join(tmpdir(), "pennivo-e2e-export-ud-"));
  await writeFile(
    path.join(userDataDir, "sidebar-folder.json"),
    JSON.stringify(workspaceDir),
    "utf-8",
  );
  await mkdir(path.join(workspaceDir, "doc-md-images"), { recursive: true });
  await writeFile(
    path.join(workspaceDir, "doc-md-images", "pic.png"),
    makePng(120, 60),
  );
  for (const [name, content] of Object.entries(files)) {
    await writeFile(path.join(workspaceDir, name), content);
  }
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
  await window.waitForTimeout(700);
}

async function close(): Promise<void> {
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
}

async function openDoc(name: string): Promise<void> {
  const docPath = path.join(workspaceDir, name).replace(/\\/g, "/");
  await window.locator(`[data-path="${docPath}"]`).click();
  await window.waitForSelector(".ProseMirror li", { timeout: 15_000 });
}

/** Run an export through the real menu IPC with the save dialog stubbed. */
async function runExport(kind: "html" | "pdf", target: string): Promise<void> {
  await rm(target, { force: true });
  await app.evaluate(
    async ({ dialog, BrowserWindow }, { kind: k, target: t }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (dialog as any).showSaveDialog = async () => ({
        canceled: false,
        filePath: t,
      });
      BrowserWindow.getAllWindows()[0]!.webContents.send(
        k === "html" ? "menu:export-html" : "menu:export-pdf",
      );
    },
    { kind, target },
  );
  await expect
    .poll(
      async () => {
        try {
          return (await stat(target)).size;
        } catch {
          return 0;
        }
      },
      { timeout: 30_000 },
    )
    .toBeGreaterThan(0);
  // let the writer finish
  await window.waitForTimeout(300);
}

function pageCount(pdf: Buffer): number {
  const text = pdf.toString("latin1");
  return (text.match(/\/Type\s*\/Page(?![A-Za-z])/g) ?? []).length;
}

const EDITOR_ONLY = [
  "collapse-toggle",
  "list-item--collapsible",
  "list-item--collapsed",
  "pennivo-image-badge",
  "mermaid-gantt-edit-btn",
  "ProseMirror-separator",
  "ProseMirror-trailingBreak",
  "ProseMirror-selectednode",
  "ProseMirror-gapcursor",
  "bullet-zoom",
  "find-match",
  "meta-chip",
  "contenteditable",
];

test.afterEach(async () => {
  await close();
});

test("export html and pdf contain the document and no editor chrome", async () => {
  test.setTimeout(180_000);
  await mkdir(OUT_DIR, { recursive: true });
  await launch({ "doc.md": FIXTURE });
  await openDoc("doc.md");
  await window.waitForSelector(".mermaid-preview-widget svg", {
    timeout: 20_000,
  });
  await window.waitForSelector(".ProseMirror img:not(.ProseMirror-separator)");

  // Collapse the first parent bullet, as a user would.
  const toggles = window.locator(".ProseMirror .collapse-toggle");
  expect(await toggles.count()).toBeGreaterThan(0);
  await toggles.first().click();
  await expect(
    window.locator(".ProseMirror .list-item--collapsed"),
  ).toHaveCount(1);

  const htmlPath = path.join(OUT_DIR, "fixture.html");
  const pdfPath = path.join(OUT_DIR, "fixture.pdf");
  await runExport("html", htmlPath);
  await runExport("pdf", pdfPath);
  const html = await readFile(htmlPath, "utf-8");
  const pdf = await readFile(pdfPath);

  for (const needle of EDITOR_ONLY) {
    expect(html, `export must not contain ${needle}`).not.toContain(needle);
  }
  // Collapsed content is still in the export.
  expect(html).toContain("Audience research");
  expect(html).toContain("Interview five early readers");
  expect(html).toContain("Draft social captions");
  // Kept content.
  expect(html).toContain("Week two: behind-the-scenes photos");
  expect(html).toContain("nested task two");
  expect(html).toMatch(/data-checked="true"/);
  expect(html).toMatch(/data-checked="false"/);
  // HTML export never carries a local image path.
  expect(html).not.toContain("pennivo-file:");
  expect(html).not.toMatch(/file:\/\//i);
  expect(html).not.toContain(workspaceDir);
  expect(html).not.toContain(workspaceDir.replace(/\\/g, "/"));
  expect(html).not.toMatch(/(?<![A-Za-z])[A-Za-z]:[\\/]/);
  expect(html).not.toContain("pic.png");
  expect(html).toMatch(/<table[\s\S]*Ada[\s\S]*<\/table>/);
  expect(html).toContain("const answer");
  expect(html).toMatch(/<svg[\s\S]*Finish[\s\S]*<\/svg>/);
  expect(html).not.toContain("<button");

  // The live editor is untouched by exporting.
  await expect(window.locator(".ProseMirror .collapse-toggle")).not.toHaveCount(
    0,
  );
  await expect(
    window.locator(".ProseMirror .list-item--collapsed"),
  ).toHaveCount(1);

  const pages = pageCount(pdf);
  expect(pages).toBeGreaterThanOrEqual(1);
  expect(pages).toBeLessThanOrEqual(3);
  expect(pdf.length).toBeLessThan(400_000);
  // PDF export still draws the local image (embedded as an image XObject).
  expect(pdf.toString("latin1")).toMatch(/\/Subtype\s*\/Image/);
});

test("real markdown file exports cleanly", async () => {
  test.skip(!REAL_MD, "set PENNIVO_EXPORT_REAL_MD to a markdown file");
  test.setTimeout(180_000);
  await mkdir(OUT_DIR, { recursive: true });
  await launch({});
  await copyFile(REAL_MD, path.join(workspaceDir, "real.md"));
  // Sidebar listing was read at launch; reopen via a fresh window reload.
  await window.reload();
  await window.waitForSelector(".sidebar", { timeout: 20_000 });
  await window.waitForTimeout(700);
  await openDoc("real.md");
  const htmlPath = path.join(OUT_DIR, "real.html");
  const pdfPath = path.join(OUT_DIR, "real.pdf");
  await runExport("html", htmlPath);
  await runExport("pdf", pdfPath);
  const html = await readFile(htmlPath, "utf-8");
  for (const needle of EDITOR_ONLY) {
    expect(html).not.toContain(needle);
  }
  const pages = pageCount(await readFile(pdfPath));
  console.log(`REAL_MD_PAGES=${pages}`);
  expect(pages).toBeLessThanOrEqual(3);
});
