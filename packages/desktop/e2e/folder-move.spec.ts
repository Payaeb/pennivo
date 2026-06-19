import { test, expect, _electron as electron } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Phase 11f (final sub-part): folders are draggable + droppable. A folder move
// is a recursive move (its inner files and per-file `*-md-images/` asset folders
// come along), guarded against self/descendant drops, with the same collision
// flow ("Replace existing folder?") and cross-document link integrity.

const REPO_PACKAGE_DIR = path.resolve(__dirname, "..");

let app: ElectronApplication;
let window: Page;
let workspaceDir: string;
let userDataDir: string;

async function seedUserData(workspace: string): Promise<string> {
  const ud = await mkdtemp(path.join(tmpdir(), "pennivo-e2e-foldermove-ud-"));
  await writeFile(
    path.join(ud, "sidebar-folder.json"),
    JSON.stringify(workspace),
    "utf-8",
  );
  return ud;
}

test.beforeEach(async () => {
  workspaceDir = await mkdtemp(path.join(tmpdir(), "pennivo-e2e-foldermove-ws-"));
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

// Dispatch the same drag/drop event sequence the renderer wires up, carrying
// the source path via the data-path attribute. Mirrors sidebar.spec.ts.
async function dragRowOntoRow(
  srcPath: string,
  destPath: string,
): Promise<void> {
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
    { srcPath, destPath },
  );
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

test("MOVE FOLDER: a folder and a file inside it move into the destination folder", async () => {
  // workspace/stuff/inner.md  ->  workspace/archive/stuff/inner.md
  await mkdir(path.join(workspaceDir, "stuff"));
  await writeFile(
    path.join(workspaceDir, "stuff", "inner.md"),
    "# Inner\n\nbody.\n",
    "utf-8",
  );
  await mkdir(path.join(workspaceDir, "archive"));
  await window.waitForTimeout(700);

  const stuffPath = path.join(workspaceDir, "stuff").replace(/\\/g, "/");
  const archivePath = path.join(workspaceDir, "archive").replace(/\\/g, "/");
  await dragRowOntoRow(stuffPath, archivePath);

  await expect
    .poll(
      async () => {
        const movedFolder = await exists(
          path.join(workspaceDir, "archive", "stuff"),
        );
        const movedFile = await exists(
          path.join(workspaceDir, "archive", "stuff", "inner.md"),
        );
        const srcGone = !(await exists(path.join(workspaceDir, "stuff")));
        return movedFolder && movedFile && srcGone ? "moved" : "pending";
      },
      { timeout: 6_000, intervals: [100, 250, 500] },
    )
    .toBe("moved");

  // The moved folder row should now be present at its new path in the tree.
  // (The nested file inside it requires expanding the moved folder, which is
  // collapsed by default after the move; the disk assertions above already
  // prove the file moved, so we assert the folder row's tree presence here.)
  await expect(
    window.locator(
      `[data-path="${path
        .join(workspaceDir, "archive", "stuff")
        .replace(/\\/g, "/")}"]`,
    ),
  ).toBeVisible({ timeout: 5_000 });
});

test("MOVE FOLDER: per-file asset folder inside the tree comes along automatically", async () => {
  // stuff/inner.md references ./inner-md-images/pic.png inside the moved tree.
  await mkdir(path.join(workspaceDir, "stuff"));
  await writeFile(
    path.join(workspaceDir, "stuff", "inner.md"),
    "# Inner\n\n![](./inner-md-images/pic.png)\n",
    "utf-8",
  );
  await mkdir(path.join(workspaceDir, "stuff", "inner-md-images"));
  await writeFile(
    path.join(workspaceDir, "stuff", "inner-md-images", "pic.png"),
    "fake png bytes",
    "binary",
  );
  await mkdir(path.join(workspaceDir, "archive"));
  await window.waitForTimeout(700);

  const stuffPath = path.join(workspaceDir, "stuff").replace(/\\/g, "/");
  const archivePath = path.join(workspaceDir, "archive").replace(/\\/g, "/");
  await dragRowOntoRow(stuffPath, archivePath);

  await expect
    .poll(
      async () => {
        const pic = await exists(
          path.join(
            workspaceDir,
            "archive",
            "stuff",
            "inner-md-images",
            "pic.png",
          ),
        );
        const srcGone = !(await exists(path.join(workspaceDir, "stuff")));
        return pic && srcGone ? "moved" : "pending";
      },
      { timeout: 6_000, intervals: [100, 250, 500] },
    )
    .toBe("moved");

  // The inner relative image link is unchanged (it co-moved with the file).
  const inner = await readFile(
    path.join(workspaceDir, "archive", "stuff", "inner.md"),
    "utf-8",
  );
  expect(inner).toContain("./inner-md-images/pic.png");
});

test("GUARD: dropping a folder into its own child does not move it (disk unchanged)", async () => {
  // stuff/deep is a descendant of stuff. Dropping stuff onto deep must no-op.
  await mkdir(path.join(workspaceDir, "stuff", "deep"), { recursive: true });
  await writeFile(
    path.join(workspaceDir, "stuff", "inner.md"),
    "# Inner\n",
    "utf-8",
  );
  await window.waitForTimeout(700);

  const stuffPath = path.join(workspaceDir, "stuff").replace(/\\/g, "/");
  const deepPath = path.join(workspaceDir, "stuff", "deep").replace(/\\/g, "/");
  await dragRowOntoRow(stuffPath, deepPath);

  // Give the (suppressed) drop a moment; nothing should change on disk.
  await window.waitForTimeout(600);

  // stuff still at root, with its original contents; no nested stuff/deep/stuff.
  expect(await exists(path.join(workspaceDir, "stuff", "inner.md"))).toBe(true);
  expect(await exists(path.join(workspaceDir, "stuff", "deep"))).toBe(true);
  expect(
    await exists(path.join(workspaceDir, "stuff", "deep", "stuff")),
  ).toBe(false);
});

test("LINK INTEGRITY: moving a folder rewrites an outside file's link to a file inside it", async () => {
  // outside.md links ./stuff/inner.md; move stuff/ into archive/.
  await mkdir(path.join(workspaceDir, "stuff"));
  await writeFile(
    path.join(workspaceDir, "stuff", "inner.md"),
    "# Inner\n",
    "utf-8",
  );
  await writeFile(
    path.join(workspaceDir, "outside.md"),
    "# Outside\n\nSee [inner](./stuff/inner.md).\n",
    "utf-8",
  );
  await mkdir(path.join(workspaceDir, "archive"));
  await window.waitForTimeout(700);

  const stuffPath = path.join(workspaceDir, "stuff").replace(/\\/g, "/");
  const archivePath = path.join(workspaceDir, "archive").replace(/\\/g, "/");
  await dragRowOntoRow(stuffPath, archivePath);

  await expect
    .poll(
      async () => {
        try {
          await stat(path.join(workspaceDir, "archive", "stuff", "inner.md"));
          const out = await readFile(
            path.join(workspaceDir, "outside.md"),
            "utf-8",
          );
          return out.includes("./archive/stuff/inner.md")
            ? "rewritten"
            : "pending";
        } catch {
          return "error";
        }
      },
      { timeout: 6_000, intervals: [100, 250, 500] },
    )
    .toBe("rewritten");

  const out = await readFile(path.join(workspaceDir, "outside.md"), "utf-8");
  expect(out).toContain("[inner](./archive/stuff/inner.md)");
  expect(out).not.toContain("./stuff/inner.md");
});

test("COLLISION: a same-named folder at the destination shows the Replace dialog; confirming replaces", async () => {
  // Both root/stuff and archive/stuff exist. Dropping stuff onto archive
  // collides; confirming Replace overwrites archive/stuff with root/stuff.
  await mkdir(path.join(workspaceDir, "stuff"));
  await writeFile(
    path.join(workspaceDir, "stuff", "fresh.md"),
    "# Fresh from root\n",
    "utf-8",
  );
  await mkdir(path.join(workspaceDir, "archive", "stuff"), { recursive: true });
  await writeFile(
    path.join(workspaceDir, "archive", "stuff", "stale.md"),
    "# Stale already in archive\n",
    "utf-8",
  );
  await window.waitForTimeout(700);

  const stuffPath = path.join(workspaceDir, "stuff").replace(/\\/g, "/");
  const archivePath = path.join(workspaceDir, "archive").replace(/\\/g, "/");
  await dragRowOntoRow(stuffPath, archivePath);

  const dialog = window.locator("[role=alertdialog]", {
    hasText: "Replace existing folder?",
  });
  await expect(dialog).toBeVisible({ timeout: 5_000 });

  await dialog.locator(".confirm-dialog-btn--danger").click();

  // After replace: archive/stuff holds the ROOT folder's content (fresh.md),
  // the stale file is gone, and the source folder no longer exists at root.
  await expect
    .poll(
      async () => {
        const fresh = await exists(
          path.join(workspaceDir, "archive", "stuff", "fresh.md"),
        );
        const staleGone = !(await exists(
          path.join(workspaceDir, "archive", "stuff", "stale.md"),
        ));
        const srcGone = !(await exists(path.join(workspaceDir, "stuff")));
        return fresh && staleGone && srcGone ? "replaced" : "pending";
      },
      { timeout: 6_000, intervals: [100, 250, 500] },
    )
    .toBe("replaced");
});
