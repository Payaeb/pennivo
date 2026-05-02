import { test, expect, _electron as electron } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  stat,
  rename,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const REPO_PACKAGE_DIR = path.resolve(__dirname, "..");

// Force-set the sidebar folder via the Electron userData directory so the app
// auto-loads our test workspace at startup. main.ts reads
// `${app.getPath("userData")}/sidebar-folder.json` and parses it as a JSON-encoded string.
async function seedUserData(workspaceDir: string): Promise<string> {
  const userData = await mkdtemp(path.join(tmpdir(), "pennivo-e2e-userdata-"));
  await writeFile(
    path.join(userData, "sidebar-folder.json"),
    JSON.stringify(workspaceDir),
    "utf-8",
  );
  return userData;
}

async function makeWorkspace(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "pennivo-e2e-workspace-"));
  await writeFile(path.join(dir, "alpha.md"), "# Alpha\n\nfirst file.");
  await writeFile(path.join(dir, "bravo.md"), "# Bravo\n\nsecond file.");
  await writeFile(path.join(dir, "charlie.md"), "# Charlie\n\nthird file.");
  await mkdir(path.join(dir, "notes"));
  await writeFile(
    path.join(dir, "notes", "todo.md"),
    "# Todo\n\nin a folder.",
  );
  return dir;
}

let app: ElectronApplication;
let window: Page;
let workspaceDir: string;
let userDataDir: string;

test.beforeEach(async () => {
  workspaceDir = await makeWorkspace();
  userDataDir = await seedUserData(workspaceDir);
  // Strip ELECTRON_RUN_AS_NODE — when set, Electron runs as plain Node and
  // rejects Chromium flags like --remote-debugging-port. The dev script does
  // the same via `env -u ELECTRON_RUN_AS_NODE vite`.
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
  // Wait for the React tree to mount (the AppShell root is the canary).
  await window.waitForSelector(".app-shell, .app-root, [data-app-ready]", {
    timeout: 20_000,
  });
});

test.afterEach(async () => {
  if (app) await app.close();
  if (workspaceDir) await rm(workspaceDir, { recursive: true, force: true });
  if (userDataDir) await rm(userDataDir, { recursive: true, force: true });
});

test("sidebar is visible BY DEFAULT when a folder is configured (no toggle needed)", async () => {
  // This is the regression-guard: previously sidebar started hidden every launch
  // even when a folder was configured. After fix, it should be visible without
  // any user input (no Ctrl+Shift+B).
  await expect(window.locator(".sidebar")).toBeVisible({ timeout: 5_000 });
  await expect(window.getByText("alpha.md")).toBeVisible();
  await expect(window.getByText("bravo.md")).toBeVisible();
});

test("sort dropdown is rendered and opens with all 7 options", async () => {
  await expect(window.locator(".sidebar")).toBeVisible({ timeout: 5_000 });

  const sortBtn = window.locator(".sidebar-sort-btn");
  await expect(sortBtn).toBeVisible();
  await sortBtn.click();

  await expect(window.locator(".sidebar-sort-menu")).toBeVisible();

  for (const label of [
    "Name (A → Z)",
    "Name (Z → A)",
    "Modified (newest)",
    "Modified (oldest)",
    "Size (largest)",
    "Size (smallest)",
    "Recently opened",
  ]) {
    await expect(window.getByText(label)).toBeVisible();
  }
});

test("right-click on a file row opens the context menu with all 5 items", async () => {
  await expect(window.locator(".sidebar")).toBeVisible({ timeout: 5_000 });

  const fileRow = window.getByText("alpha.md").first();
  await fileRow.click({ button: "right" });

  await expect(window.locator(".context-menu")).toBeVisible();

  await expect(
    window.locator(".context-menu-item-label", { hasText: /Show in/ }),
  ).toBeVisible();
  await expect(
    window.locator(".context-menu-item-label", { hasText: "Rename" }),
  ).toBeVisible();
  await expect(
    window.locator(".context-menu-item-label", { hasText: "Copy Path" }),
  ).toBeVisible();
  await expect(
    window.locator(".context-menu-item-label", { hasText: "Copy Filename" }),
  ).toBeVisible();
  await expect(
    window.locator(".context-menu-item-label", { hasText: "Delete" }),
  ).toBeVisible();
});

test("right-click on a folder row hides Show-in-OS and Delete (files-only items)", async () => {
  await expect(window.locator(".sidebar")).toBeVisible({ timeout: 5_000 });

  const folderRow = window.getByText("notes").first();
  await folderRow.click({ button: "right" });

  await expect(window.locator(".context-menu")).toBeVisible();
  await expect(
    window.locator(".context-menu-item-label", { hasText: "Rename" }),
  ).toBeVisible();
  await expect(
    window.locator(".context-menu-item-label", { hasText: /Show in/ }),
  ).not.toBeVisible();
  await expect(
    window.locator(".context-menu-item-label", { hasText: "Delete" }),
  ).not.toBeVisible();
});

test("drag-and-drop moves a file into a folder on disk", async () => {
  await expect(window.locator(".sidebar")).toBeVisible({ timeout: 5_000 });

  // Wait for both source and target rows to be present
  await expect(window.getByText("alpha.md")).toBeVisible();
  await expect(window.getByText("notes")).toBeVisible();

  // HTML5 drag-and-drop in Playwright Electron isn't reliably triggered by
  // the high-level dragTo() in headed mode without delays, so we dispatch
  // the events directly via the renderer. This invokes the React handlers
  // exactly as a real drag would, with a stub DataTransfer to carry the path.
  await window.evaluate(
    ({ srcText, destText }) => {
      const findRow = (label: string): HTMLElement | null => {
        const buttons = Array.from(
          document.querySelectorAll<HTMLButtonElement>(".tree-item"),
        );
        return (
          buttons.find((b) => b.textContent?.trim().includes(label)) ?? null
        );
      };
      const src = findRow(srcText);
      const dest = findRow(destText);
      if (!src || !dest) {
        throw new Error(`Could not find rows for ${srcText} or ${destText}`);
      }

      const dt = new DataTransfer();
      const dragStart = new DragEvent("dragstart", {
        bubbles: true,
        cancelable: true,
        dataTransfer: dt,
      });
      src.dispatchEvent(dragStart);

      const dragOver = new DragEvent("dragover", {
        bubbles: true,
        cancelable: true,
        dataTransfer: dt,
      });
      dest.dispatchEvent(dragOver);

      const drop = new DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        dataTransfer: dt,
      });
      dest.dispatchEvent(drop);
    },
    { srcText: "alpha.md", destText: "notes" },
  );

  // Wait for the file system to reflect the move
  await expect
    .poll(
      async () => {
        try {
          await stat(path.join(workspaceDir, "notes", "alpha.md"));
          return "moved";
        } catch {
          return "not-moved";
        }
      },
      { timeout: 5_000, intervals: [100, 250, 500] },
    )
    .toBe("moved");

  // And the source location should no longer have the file
  let srcStillExists = true;
  try {
    await stat(path.join(workspaceDir, "alpha.md"));
  } catch {
    srcStillExists = false;
  }
  expect(srcStillExists).toBe(false);
});

test("drag-and-drop also moves the per-file images folder alongside the .md", async () => {
  // Pennivo stores per-file assets in a sibling folder named "{name}-md-images".
  // alpha.md → alpha-md-images/. Pre-create that folder + an image file.
  const imgFolder = path.join(workspaceDir, "alpha-md-images");
  await mkdir(imgFolder);
  await writeFile(
    path.join(imgFolder, "paste-1.png"),
    "fake png bytes",
    "binary",
  );
  // Wait for file watcher to settle
  await window.waitForTimeout(500);

  await expect(window.locator(".sidebar")).toBeVisible({ timeout: 5_000 });

  const rootAlphaPath = path.join(workspaceDir, "alpha.md").replace(/\\/g, "/");
  const notesPath = path.join(workspaceDir, "notes").replace(/\\/g, "/");

  await window.evaluate(
    ({ srcPath, destPath }) => {
      const findByPath = (p: string): HTMLElement | null =>
        document.querySelector<HTMLElement>(
          `[data-path="${p.replace(/"/g, '\\"')}"]`,
        );
      const src = findByPath(srcPath);
      const dest = findByPath(destPath);
      if (!src || !dest) throw new Error("rows not found");
      const dt = new DataTransfer();
      src.dispatchEvent(
        new DragEvent("dragstart", {
          bubbles: true,
          cancelable: true,
          dataTransfer: dt,
        }),
      );
      dest.dispatchEvent(
        new DragEvent("dragover", {
          bubbles: true,
          cancelable: true,
          dataTransfer: dt,
        }),
      );
      dest.dispatchEvent(
        new DragEvent("drop", {
          bubbles: true,
          cancelable: true,
          dataTransfer: dt,
        }),
      );
    },
    { srcPath: rootAlphaPath, destPath: notesPath },
  );

  // Both the file AND the images folder should have moved into notes/
  await expect
    .poll(
      async () => {
        try {
          await stat(path.join(workspaceDir, "notes", "alpha.md"));
          await stat(path.join(workspaceDir, "notes", "alpha-md-images"));
          await stat(
            path.join(workspaceDir, "notes", "alpha-md-images", "paste-1.png"),
          );
          return "all-moved";
        } catch {
          return "incomplete";
        }
      },
      { timeout: 5_000, intervals: [100, 250, 500] },
    )
    .toBe("all-moved");

  // And neither should exist at the source location
  let srcFileExists = true;
  try {
    await stat(path.join(workspaceDir, "alpha.md"));
  } catch {
    srcFileExists = false;
  }
  let srcImagesExists = true;
  try {
    await stat(path.join(workspaceDir, "alpha-md-images"));
  } catch {
    srcImagesExists = false;
  }
  expect(srcFileExists).toBe(false);
  expect(srcImagesExists).toBe(false);
});

test("drag-and-drop carries the asset folder even after the .md was renamed (folder name no longer matches file basename)", async () => {
  // Simulate the rename case: file is named "renamed.md" but its asset folder
  // is still "alpha-md-images/" (because rename intentionally doesn't rename
  // the folder, to avoid breaking relative image links inside the .md).
  // Set up: rename alpha.md → renamed.md on disk, create the OLD-named
  // folder with an image, write content that references it.
  const renamedPath = path.join(workspaceDir, "renamed.md");
  const legacyImgFolder = path.join(workspaceDir, "alpha-md-images");
  // Replace alpha.md with renamed.md (content references the legacy folder name)
  await rm(path.join(workspaceDir, "alpha.md"));
  await writeFile(
    renamedPath,
    "# Renamed\n\n![](./alpha-md-images/paste-1.png)\n",
  );
  await mkdir(legacyImgFolder);
  await writeFile(
    path.join(legacyImgFolder, "paste-1.png"),
    "fake png bytes",
    "binary",
  );
  // Wait for file watcher to refresh the sidebar
  await window.waitForTimeout(700);

  await expect(window.locator(".sidebar")).toBeVisible({ timeout: 5_000 });

  const renamedRowPath = renamedPath.replace(/\\/g, "/");
  const notesPath = path.join(workspaceDir, "notes").replace(/\\/g, "/");

  await window.evaluate(
    ({ srcPath, destPath }) => {
      const findByPath = (p: string): HTMLElement | null =>
        document.querySelector<HTMLElement>(
          `[data-path="${p.replace(/"/g, '\\"')}"]`,
        );
      const src = findByPath(srcPath);
      const dest = findByPath(destPath);
      if (!src) throw new Error(`source row not found: ${srcPath}`);
      if (!dest) throw new Error(`dest row not found: ${destPath}`);
      const dt = new DataTransfer();
      src.dispatchEvent(
        new DragEvent("dragstart", {
          bubbles: true,
          cancelable: true,
          dataTransfer: dt,
        }),
      );
      dest.dispatchEvent(
        new DragEvent("dragover", {
          bubbles: true,
          cancelable: true,
          dataTransfer: dt,
        }),
      );
      dest.dispatchEvent(
        new DragEvent("drop", {
          bubbles: true,
          cancelable: true,
          dataTransfer: dt,
        }),
      );
    },
    { srcPath: renamedRowPath, destPath: notesPath },
  );

  // Both the file AND the LEGACY-named asset folder should have moved into notes/
  await expect
    .poll(
      async () => {
        try {
          await stat(path.join(workspaceDir, "notes", "renamed.md"));
          await stat(path.join(workspaceDir, "notes", "alpha-md-images"));
          await stat(
            path.join(workspaceDir, "notes", "alpha-md-images", "paste-1.png"),
          );
          return "all-moved";
        } catch {
          return "incomplete";
        }
      },
      { timeout: 5_000, intervals: [100, 250, 500] },
    )
    .toBe("all-moved");

  // And neither should remain at the root
  let srcFileExists = true;
  try {
    await stat(renamedPath);
  } catch {
    srcFileExists = false;
  }
  let srcImagesExists = true;
  try {
    await stat(legacyImgFolder);
  } catch {
    srcImagesExists = false;
  }
  expect(srcFileExists).toBe(false);
  expect(srcImagesExists).toBe(false);
});

test("drag-and-drop on collision shows replace dialog", async () => {
  // Pre-create a colliding file inside notes/ so dropping alpha.md on notes triggers the dialog
  await writeFile(
    path.join(workspaceDir, "notes", "alpha.md"),
    "# Existing Alpha in notes",
  );
  // Wait for the file watcher to refresh the sidebar tree (debounce is 300ms)
  await window.waitForTimeout(700);

  await expect(window.locator(".sidebar")).toBeVisible({ timeout: 5_000 });

  // Find by the EXACT data-path attribute — both the root alpha.md and the
  // newly-added notes/alpha.md now exist in the tree, and we need the root one.
  const rootAlphaPath = path.join(workspaceDir, "alpha.md").replace(/\\/g, "/");
  const notesPath = path.join(workspaceDir, "notes").replace(/\\/g, "/");

  await window.evaluate(
    ({ srcPath, destPath }) => {
      const findByPath = (p: string): HTMLElement | null =>
        document.querySelector<HTMLElement>(
          `[data-path="${p.replace(/"/g, '\\"')}"]`,
        );
      const src = findByPath(srcPath);
      const dest = findByPath(destPath);
      if (!src) throw new Error(`source row not found: ${srcPath}`);
      if (!dest) throw new Error(`dest row not found: ${destPath}`);
      const dt = new DataTransfer();
      src.dispatchEvent(
        new DragEvent("dragstart", {
          bubbles: true,
          cancelable: true,
          dataTransfer: dt,
        }),
      );
      dest.dispatchEvent(
        new DragEvent("dragover", {
          bubbles: true,
          cancelable: true,
          dataTransfer: dt,
        }),
      );
      dest.dispatchEvent(
        new DragEvent("drop", {
          bubbles: true,
          cancelable: true,
          dataTransfer: dt,
        }),
      );
    },
    { srcPath: rootAlphaPath, destPath: notesPath },
  );

  // The replace-existing dialog should appear
  const dialog = window.locator("[role=alertdialog]", {
    hasText: "Replace existing file?",
  });
  await expect(dialog).toBeVisible({ timeout: 5_000 });
});

test("rename consolidates fragmented asset folders into the new convention name and rewrites content", async () => {
  // Simulate the "rename → save image → rename → save image" history that
  // produces multiple folders. We hand-craft the end-state on disk:
  //   final.md  (current name; says it should own "final-md-images")
  //   notes-md-images/paste-1.png  (from before first rename)
  //   mid-md-images/paste-2.png    (from between renames)
  //   final-md-images/paste-3.png  (from after last rename)
  // and content references all three.
  await rm(path.join(workspaceDir, "alpha.md")); // free up name to avoid confusion
  const finalPath = path.join(workspaceDir, "final.md");
  await writeFile(
    finalPath,
    [
      "# Final",
      "",
      "![](./notes-md-images/paste-1.png)",
      "![](./mid-md-images/paste-2.png)",
      "![](./final-md-images/paste-3.png)",
      "",
    ].join("\n"),
  );
  for (const [folder, file] of [
    ["notes-md-images", "paste-1.png"],
    ["mid-md-images", "paste-2.png"],
    ["final-md-images", "paste-3.png"],
  ]) {
    await mkdir(path.join(workspaceDir, folder));
    await writeFile(
      path.join(workspaceDir, folder, file),
      "fake png bytes",
      "binary",
    );
  }
  await window.waitForTimeout(700);

  await expect(window.locator(".sidebar")).toBeVisible({ timeout: 5_000 });

  // Right-click the file and Rename → "renamed.md"
  const fileRow = window.locator(`[data-path="${finalPath.replace(/\\/g, "/")}"]`);
  await fileRow.click({ button: "right" });
  await window.locator(".context-menu-item-label", { hasText: "Rename" }).click();
  const input = window.locator('input[aria-label="New name"]');
  await input.fill("renamed.md");
  await input.press("Enter");

  // After rename, normalize should:
  //   - Promote one of the existing folders → renamed-md-images
  //   - Merge the other two into renamed-md-images
  //   - Rewrite all content references to ./renamed-md-images/
  //   - Remove the empty source folders
  const expectedFolder = path.join(workspaceDir, "renamed-md-images");
  await expect
    .poll(
      async () => {
        try {
          await stat(path.join(workspaceDir, "renamed.md"));
          await stat(path.join(expectedFolder, "paste-1.png"));
          await stat(path.join(expectedFolder, "paste-2.png"));
          await stat(path.join(expectedFolder, "paste-3.png"));
          return "consolidated";
        } catch {
          return "incomplete";
        }
      },
      { timeout: 5_000, intervals: [100, 250, 500] },
    )
    .toBe("consolidated");

  // Content should now reference ONLY the canonical folder
  const renamedContent = await readFile(
    path.join(workspaceDir, "renamed.md"),
    "utf-8",
  );
  expect(renamedContent).toContain("./renamed-md-images/paste-1.png");
  expect(renamedContent).toContain("./renamed-md-images/paste-2.png");
  expect(renamedContent).toContain("./renamed-md-images/paste-3.png");
  expect(renamedContent).not.toContain("notes-md-images/");
  expect(renamedContent).not.toContain("mid-md-images/");
  expect(renamedContent).not.toContain("final-md-images/");

  // Source folders should be empty + removed (best-effort cleanup)
  for (const folder of ["notes-md-images", "mid-md-images", "final-md-images"]) {
    let stillExists = true;
    try {
      await stat(path.join(workspaceDir, folder));
    } catch {
      stillExists = false;
    }
    expect(stillExists).toBe(false);
  }
});

test("self-heal on open: file renamed outside Pennivo finds and consolidates its old asset folder", async () => {
  // Rename alpha.md → externally-renamed.md on disk, leaving alpha-md-images
  // behind with its content. Content references ./alpha-md-images/...
  // When the user opens the file in Pennivo, it should auto-heal.
  await rm(path.join(workspaceDir, "alpha.md"));
  const renamedPath = path.join(workspaceDir, "externally-renamed.md");
  await writeFile(
    renamedPath,
    "# Externally renamed\n\n![](./alpha-md-images/paste-1.png)\n",
  );
  await mkdir(path.join(workspaceDir, "alpha-md-images"));
  await writeFile(
    path.join(workspaceDir, "alpha-md-images", "paste-1.png"),
    "fake png bytes",
    "binary",
  );
  await window.waitForTimeout(700);

  await expect(window.locator(".sidebar")).toBeVisible({ timeout: 5_000 });

  // Click the externally-renamed file in the sidebar to open it
  const fileRow = window.locator(
    `[data-path="${renamedPath.replace(/\\/g, "/")}"]`,
  );
  await fileRow.click();

  // The healing happens during the open IPC, so by the time content arrives
  // the disk should already reflect the new state.
  const expectedFolder = path.join(
    workspaceDir,
    "externally-renamed-md-images",
  );
  await expect
    .poll(
      async () => {
        try {
          await stat(path.join(expectedFolder, "paste-1.png"));
          return "healed";
        } catch {
          return "not-healed";
        }
      },
      { timeout: 5_000, intervals: [100, 250, 500] },
    )
    .toBe("healed");

  // Content on disk should be rewritten to point at the canonical folder
  const healedContent = await readFile(renamedPath, "utf-8");
  expect(healedContent).toContain("./externally-renamed-md-images/paste-1.png");
  expect(healedContent).not.toContain("alpha-md-images/");

  // Old folder should be gone
  let oldFolderExists = true;
  try {
    await stat(path.join(workspaceDir, "alpha-md-images"));
  } catch {
    oldFolderExists = false;
  }
  expect(oldFolderExists).toBe(false);
});

test("delete with 'Also delete N assets' checked removes the file AND its asset folder", async () => {
  // Set up alpha.md with an alpha-md-images/ folder containing 2 images
  const imgFolder = path.join(workspaceDir, "alpha-md-images");
  await mkdir(imgFolder);
  await writeFile(
    path.join(imgFolder, "paste-1.png"),
    "fake png bytes",
    "binary",
  );
  await writeFile(
    path.join(imgFolder, "paste-2.png"),
    "fake png bytes",
    "binary",
  );
  // Update alpha.md content to reference them so findAssetFoldersForFile
  // includes the folder
  await writeFile(
    path.join(workspaceDir, "alpha.md"),
    "# Alpha\n\n![](./alpha-md-images/paste-1.png)\n![](./alpha-md-images/paste-2.png)\n",
  );
  await window.waitForTimeout(500);

  await expect(window.locator(".sidebar")).toBeVisible({ timeout: 5_000 });

  // Right-click → Delete
  const fileRow = window.locator(
    `[data-path="${path.join(workspaceDir, "alpha.md").replace(/\\/g, "/")}"]`,
  );
  await fileRow.click({ button: "right" });
  await window
    .locator(".context-menu-item-label", { hasText: "Delete" })
    .click();

  // Dialog should show the asset checkbox
  const dialog = await window.waitForSelector("[role=alertdialog]", {
    timeout: 5_000,
  });
  const checkbox = await dialog.$('input[type="checkbox"]');
  if (!checkbox) {
    throw new Error(
      "Expected delete-confirm checkbox for file with assets, found none",
    );
  }
  // Tick the checkbox + confirm
  await checkbox.click();
  await window.locator(".confirm-dialog-btn--danger").click();

  // Both the .md and the asset folder should disappear
  await expect
    .poll(
      async () => {
        let fileGone = false;
        let folderGone = false;
        try {
          await stat(path.join(workspaceDir, "alpha.md"));
        } catch {
          fileGone = true;
        }
        try {
          await stat(imgFolder);
        } catch {
          folderGone = true;
        }
        return fileGone && folderGone ? "all-gone" : "still-present";
      },
      { timeout: 5_000, intervals: [100, 250, 500] },
    )
    .toBe("all-gone");
});

test("delete with the asset checkbox unchecked leaves the asset folder behind", async () => {
  const imgFolder = path.join(workspaceDir, "alpha-md-images");
  await mkdir(imgFolder);
  await writeFile(
    path.join(imgFolder, "paste-1.png"),
    "fake png bytes",
    "binary",
  );
  await writeFile(
    path.join(workspaceDir, "alpha.md"),
    "# Alpha\n\n![](./alpha-md-images/paste-1.png)\n",
  );
  await window.waitForTimeout(500);

  await expect(window.locator(".sidebar")).toBeVisible({ timeout: 5_000 });

  const fileRow = window.locator(
    `[data-path="${path.join(workspaceDir, "alpha.md").replace(/\\/g, "/")}"]`,
  );
  await fileRow.click({ button: "right" });
  await window
    .locator(".context-menu-item-label", { hasText: "Delete" })
    .click();
  await window.waitForSelector("[role=alertdialog]", { timeout: 5_000 });
  // Don't click the checkbox — confirm directly
  await window.locator(".confirm-dialog-btn--danger").click();

  // File should be gone but folder should remain
  await expect
    .poll(
      async () => {
        let fileGone = false;
        try {
          await stat(path.join(workspaceDir, "alpha.md"));
        } catch {
          fileGone = true;
        }
        return fileGone ? "file-gone" : "still-present";
      },
      { timeout: 5_000, intervals: [100, 250, 500] },
    )
    .toBe("file-gone");

  // Folder still there
  let folderStillExists = false;
  try {
    await stat(imgFolder);
    folderStillExists = true;
  } catch {
    folderStillExists = false;
  }
  expect(folderStillExists).toBe(true);
});

test("sidebar visibility persists across launches", async () => {
  // Hide the sidebar via shortcut, close + relaunch, expect it still hidden.
  await expect(window.locator(".sidebar")).toBeVisible({ timeout: 5_000 });
  await window.keyboard.press("Control+Shift+B");
  await expect(window.locator(".sidebar")).not.toBeVisible({ timeout: 5_000 });
  await app.close();

  // Relaunch with the SAME userDataDir so settings persist
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
  await window.waitForSelector(".app-shell", { timeout: 20_000 });

  // Sidebar should STILL be hidden because the user explicitly toggled it off
  await expect(window.locator(".sidebar")).not.toBeVisible({ timeout: 5_000 });
});
