import { test, expect, _electron as electron } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const REPO_PACKAGE_DIR = path.resolve(__dirname, "..");

let app: ElectronApplication;
let window: Page;
let workspaceDir: string;
let userDataDir: string;
let filePath: string;

async function seedUserData(workspace: string): Promise<string> {
  const ud = await mkdtemp(path.join(tmpdir(), "pennivo-e2e-mlist-ud-"));
  await writeFile(
    path.join(ud, "sidebar-folder.json"),
    JSON.stringify(workspace),
    "utf-8",
  );
  return ud;
}

test.beforeEach(async () => {
  workspaceDir = await mkdtemp(path.join(tmpdir(), "pennivo-e2e-mlist-ws-"));
  filePath = path.join(workspaceDir, "scratch.md");
  // Three paragraphs (blank lines between them = three separate blocks in
  // the ProseMirror doc, which is the precondition for the bug).
  await writeFile(filePath, "alpha\n\nbravo\n\ncharlie\n", "utf-8");
  userDataDir = await seedUserData(workspaceDir);
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
  const filePathFwd = filePath.replace(/\\/g, "/");
  await window.locator(`[data-path="${filePathFwd}"]`).click();
  await window.waitForSelector(".ProseMirror", { timeout: 10_000 });
  // Wait for the editor content to actually render
  await expect(window.locator(".ProseMirror")).toContainText("alpha", {
    timeout: 5_000,
  });
});

test.afterEach(async () => {
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
    if (app) await app.close();
  } catch {
    // ignore
  }
  if (workspaceDir) await rm(workspaceDir, { recursive: true, force: true });
  if (userDataDir) await rm(userDataDir, { recursive: true, force: true });
});

async function selectAllAndApply(label: string): Promise<void> {
  // Click into the editor and select everything
  await window.locator(".ProseMirror").first().click();
  await window.keyboard.press("Control+a");
  // Click the toolbar button
  await window.locator(`button[aria-label="${label}"]`).first().click();
  // Wait for autosave to fire (3s debounce + buffer)
  await window.waitForTimeout(4_000);
}

test("Bullet List on multi-line selection makes each line its own bullet", async () => {
  await selectAllAndApply("Bullet List");

  const onDisk = await readFile(filePath, "utf-8");
  // Three separate bullets, NOT one bullet wrapping all the text.
  expect(onDisk).toMatch(/^[*-]\s+alpha\s*$/m);
  expect(onDisk).toMatch(/^[*-]\s+bravo\s*$/m);
  expect(onDisk).toMatch(/^[*-]\s+charlie\s*$/m);
});

test("Ordered List on multi-line selection makes each line its own numbered item", async () => {
  await selectAllAndApply("Ordered List");

  const onDisk = await readFile(filePath, "utf-8");
  expect(onDisk).toMatch(/^1\.\s+alpha\s*$/m);
  expect(onDisk).toMatch(/^2\.\s+bravo\s*$/m);
  expect(onDisk).toMatch(/^3\.\s+charlie\s*$/m);
});

test("Task List on multi-line selection makes each line its own checkbox", async () => {
  await selectAllAndApply("Task List");

  const onDisk = await readFile(filePath, "utf-8");
  const checkboxLines = onDisk
    .split("\n")
    .filter((l) => /^[*-]\s+\[\s?\]\s+/.test(l));
  expect(checkboxLines).toHaveLength(3);
  expect(onDisk).toContain("alpha");
  expect(onDisk).toContain("bravo");
  expect(onDisk).toContain("charlie");
});
