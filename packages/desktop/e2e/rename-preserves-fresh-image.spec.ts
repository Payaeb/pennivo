import { test, expect, _electron as electron } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  readdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const REPO_PACKAGE_DIR = path.resolve(__dirname, "..");

let app: ElectronApplication;
let window: Page;
let workspaceDir: string;
let userDataDir: string;

async function seedUserData(workspace: string): Promise<string> {
  const ud = await mkdtemp(path.join(tmpdir(), "pennivo-e2e-rfi-ud-"));
  await writeFile(
    path.join(ud, "sidebar-folder.json"),
    JSON.stringify(workspace),
    "utf-8",
  );
  return ud;
}

// 1×1 transparent PNG, base64-decoded into a buffer for fixture image files.
const PNG_BUFFER = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

test.beforeEach(async () => {
  workspaceDir = await mkdtemp(path.join(tmpdir(), "pennivo-e2e-rfi-ws-"));
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
});

test.afterEach(async () => {
  // Bypass the unsaved-changes prompt that blocks app.close().
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

// Reproduces the user-reported "image displays as text after rename" bug.
// Setup: file has a stale broken ref (legacy from earlier renames) AND a
// fresh valid image ref. Expectation: rename rewrites the fresh ref to the
// new canonical folder; image still resolves; the stale broken ref is
// preserved (we don't make it worse, but we also don't let it block the
// rewrite of the live one).
test("rename rewrites the fresh image ref even when the file has stale broken refs", async () => {
  // Seed: foo.md with one legitimate image and one stale-broken ref.
  const fooImagesDir = path.join(workspaceDir, "foo-md-images");
  await mkdir(fooImagesDir, { recursive: true });
  await writeFile(path.join(fooImagesDir, "fresh.png"), PNG_BUFFER);
  const initialContent = [
    "# Foo",
    "",
    "![](./legacy-broken-md-images/old.png)",
    "",
    "![](./foo-md-images/fresh.png)",
    "",
  ].join("\n");
  await writeFile(
    path.join(workspaceDir, "foo.md"),
    initialContent,
    "utf-8",
  );

  // Reload sidebar so it picks up foo.md
  await window.waitForTimeout(700);

  const fooPath = path.join(workspaceDir, "foo.md").replace(/\\/g, "/");
  const fooRow = window.locator(`[data-path="${fooPath}"]`);
  await fooRow.click();
  await window.waitForSelector(".ProseMirror", { timeout: 10_000 });

  // Rename foo.md → bar.md via right-click context menu
  await fooRow.click({ button: "right" });
  await window
    .locator(".context-menu-item-label", { hasText: "Rename" })
    .click();
  const renameInput = window.locator('input[aria-label="New name"]');
  await renameInput.fill("bar.md");
  await renameInput.press("Enter");

  // Wait for the rename + reload to settle by polling disk state
  const barPath = path.join(workspaceDir, "bar.md");
  await expect
    .poll(
      async () => {
        try {
          const entries = await readdir(workspaceDir);
          return entries.includes("bar.md") &&
            entries.includes("bar-md-images")
            ? "renamed"
            : "pending";
        } catch {
          return "error";
        }
      },
      { timeout: 5_000, intervals: [100, 250, 500] },
    )
    .toBe("renamed");
  void barPath;

  // Inspect disk state: bar-md-images/fresh.png should now exist (folder
  // promoted from foo-md-images) and bar.md should reference it.
  const dirEntries = await readdir(workspaceDir);
  expect(dirEntries).toContain("bar.md");
  expect(dirEntries).toContain("bar-md-images");
  expect(dirEntries).not.toContain("foo.md");
  expect(dirEntries).not.toContain("foo-md-images");

  const barImages = await readdir(path.join(workspaceDir, "bar-md-images"));
  expect(barImages).toContain("fresh.png");

  const barContent = await readFile(
    path.join(workspaceDir, "bar.md"),
    "utf-8",
  );
  // Live ref must be rewritten to canonical bar-md-images.
  expect(barContent).toContain("bar-md-images/fresh.png");
  expect(barContent).not.toContain("foo-md-images/fresh.png");
  // The stale broken ref is preserved as-is — it was already broken; we
  // don't make it worse and we don't let it block the live rewrite.
  expect(barContent).toContain("legacy-broken-md-images/old.png");
});
