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

// Phase 11f e2e: file MOVE and RENAME must preserve cross-document link
// integrity across the workspace, not just the moved file's own image sidecar.

const REPO_PACKAGE_DIR = path.resolve(__dirname, "..");

let app: ElectronApplication;
let window: Page;
let workspaceDir: string;
let userDataDir: string;

async function seedUserData(workspace: string): Promise<string> {
  const ud = await mkdtemp(path.join(tmpdir(), "pennivo-e2e-link-ud-"));
  await writeFile(
    path.join(ud, "sidebar-folder.json"),
    JSON.stringify(workspace),
    "utf-8",
  );
  return ud;
}

test.beforeEach(async () => {
  workspaceDir = await mkdtemp(path.join(tmpdir(), "pennivo-e2e-link-ws-"));
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
async function dragRowOntoRow(srcPath: string, destPath: string): Promise<void> {
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

async function renameViaContextMenu(
  rowPath: string,
  newName: string,
): Promise<void> {
  const row = window.locator(`[data-path="${rowPath}"]`);
  await row.click();
  await row.click({ button: "right" });
  await window
    .locator(".context-menu-item-label", { hasText: "Rename" })
    .click();
  const input = window.locator('input[aria-label="New name"]');
  await input.fill(newName);
  await input.press("Enter");
}

test("RENAME: an inbound link from another file is rewritten to the new name", async () => {
  await writeFile(
    path.join(workspaceDir, "fileA.md"),
    "# A\n\nSee [the target](./target.md) for details.\n",
    "utf-8",
  );
  await writeFile(
    path.join(workspaceDir, "target.md"),
    "# Target\n\nbody.\n",
    "utf-8",
  );
  await window.waitForTimeout(700);

  const targetRowPath = path
    .join(workspaceDir, "target.md")
    .replace(/\\/g, "/");
  await renameViaContextMenu(targetRowPath, "renamed.md");

  await expect
    .poll(
      async () => {
        try {
          await stat(path.join(workspaceDir, "renamed.md"));
          const a = await readFile(
            path.join(workspaceDir, "fileA.md"),
            "utf-8",
          );
          return a.includes("./renamed.md") ? "rewritten" : "pending";
        } catch {
          return "error";
        }
      },
      { timeout: 6_000, intervals: [100, 250, 500] },
    )
    .toBe("rewritten");

  const a = await readFile(path.join(workspaceDir, "fileA.md"), "utf-8");
  expect(a).toContain("[the target](./renamed.md)");
  expect(a).not.toContain("./target.md");
});

test("MOVE: an inbound link is rewritten to point into the destination subfolder", async () => {
  await writeFile(
    path.join(workspaceDir, "fileA.md"),
    "# A\n\nGo to [target](./target.md).\n",
    "utf-8",
  );
  await writeFile(
    path.join(workspaceDir, "target.md"),
    "# Target\n\nbody.\n",
    "utf-8",
  );
  await mkdir(path.join(workspaceDir, "notes"));
  await window.waitForTimeout(700);

  const targetPath = path.join(workspaceDir, "target.md").replace(/\\/g, "/");
  const notesPath = path.join(workspaceDir, "notes").replace(/\\/g, "/");
  await dragRowOntoRow(targetPath, notesPath);

  await expect
    .poll(
      async () => {
        try {
          await stat(path.join(workspaceDir, "notes", "target.md"));
          const a = await readFile(
            path.join(workspaceDir, "fileA.md"),
            "utf-8",
          );
          return a.includes("./notes/target.md") ? "rewritten" : "pending";
        } catch {
          return "error";
        }
      },
      { timeout: 6_000, intervals: [100, 250, 500] },
    )
    .toBe("rewritten");

  const a = await readFile(path.join(workspaceDir, "fileA.md"), "utf-8");
  expect(a).toContain("[target](./notes/target.md)");
});

test("MOVE outbound: a moved file's link to an unmoved sibling is recomputed", async () => {
  await writeFile(
    path.join(workspaceDir, "mover.md"),
    "# Mover\n\nLink to [sibling](./sibling.md).\n",
    "utf-8",
  );
  await writeFile(
    path.join(workspaceDir, "sibling.md"),
    "# Sibling\n\nbody.\n",
    "utf-8",
  );
  await mkdir(path.join(workspaceDir, "notes"));
  await window.waitForTimeout(700);

  const moverPath = path.join(workspaceDir, "mover.md").replace(/\\/g, "/");
  const notesPath = path.join(workspaceDir, "notes").replace(/\\/g, "/");
  await dragRowOntoRow(moverPath, notesPath);

  await expect
    .poll(
      async () => {
        try {
          await stat(path.join(workspaceDir, "notes", "mover.md"));
          const m = await readFile(
            path.join(workspaceDir, "notes", "mover.md"),
            "utf-8",
          );
          return m.includes("../sibling.md") ? "rewritten" : "pending";
        } catch {
          return "error";
        }
      },
      { timeout: 6_000, intervals: [100, 250, 500] },
    )
    .toBe("rewritten");

  const m = await readFile(
    path.join(workspaceDir, "notes", "mover.md"),
    "utf-8",
  );
  expect(m).toContain("[sibling](../sibling.md)");
  // The original same-dir form must be gone (guard against substring overlap
  // with "../sibling.md" by checking the exact inline-link form).
  expect(m).not.toContain("(./sibling.md)");
});

test("MOVE: reference-style link and image ref are both rewritten", async () => {
  await writeFile(
    path.join(workspaceDir, "fileA.md"),
    [
      "# A",
      "",
      "Inline [t][ref] then an image ![pic][img].",
      "",
      "[ref]: ./target.md",
      "[img]: ./pic.png",
      "",
    ].join("\n"),
    "utf-8",
  );
  await writeFile(
    path.join(workspaceDir, "target.md"),
    "# Target\n",
    "utf-8",
  );
  await writeFile(path.join(workspaceDir, "pic.png"), "x", "utf-8");
  await mkdir(path.join(workspaceDir, "notes"));
  await window.waitForTimeout(700);

  // Move target.md into notes/. The reference-style link to it must update.
  const targetPath = path.join(workspaceDir, "target.md").replace(/\\/g, "/");
  const notesPath = path.join(workspaceDir, "notes").replace(/\\/g, "/");
  await dragRowOntoRow(targetPath, notesPath);

  await expect
    .poll(
      async () => {
        try {
          await stat(path.join(workspaceDir, "notes", "target.md"));
          const a = await readFile(
            path.join(workspaceDir, "fileA.md"),
            "utf-8",
          );
          return a.includes("[ref]: ./notes/target.md")
            ? "rewritten"
            : "pending";
        } catch {
          return "error";
        }
      },
      { timeout: 6_000, intervals: [100, 250, 500] },
    )
    .toBe("rewritten");

  const a = await readFile(path.join(workspaceDir, "fileA.md"), "utf-8");
  // Reference link to the moved doc is rewritten.
  expect(a).toContain("[ref]: ./notes/target.md");
  // The image ref to an UNMOVED asset is left untouched.
  expect(a).toContain("[img]: ./pic.png");
});

test("MOVE: anchors are preserved and external/absolute links untouched", async () => {
  await writeFile(
    path.join(workspaceDir, "fileA.md"),
    [
      "# A",
      "",
      "Jump to [section](./target.md#heading).",
      "",
      "External [site](https://example.com/page).",
      "",
      "Absolute [root](/abs/path.md).",
      "",
    ].join("\n"),
    "utf-8",
  );
  await writeFile(
    path.join(workspaceDir, "target.md"),
    "# Target\n\n## heading\n",
    "utf-8",
  );
  await mkdir(path.join(workspaceDir, "notes"));
  await window.waitForTimeout(700);

  const targetPath = path.join(workspaceDir, "target.md").replace(/\\/g, "/");
  const notesPath = path.join(workspaceDir, "notes").replace(/\\/g, "/");
  await dragRowOntoRow(targetPath, notesPath);

  await expect
    .poll(
      async () => {
        try {
          await stat(path.join(workspaceDir, "notes", "target.md"));
          const a = await readFile(
            path.join(workspaceDir, "fileA.md"),
            "utf-8",
          );
          return a.includes("./notes/target.md#heading")
            ? "rewritten"
            : "pending";
        } catch {
          return "error";
        }
      },
      { timeout: 6_000, intervals: [100, 250, 500] },
    )
    .toBe("rewritten");

  const a = await readFile(path.join(workspaceDir, "fileA.md"), "utf-8");
  // Anchor fragment survives the rewrite.
  expect(a).toContain("[section](./notes/target.md#heading)");
  // External and absolute links are left exactly as written.
  expect(a).toContain("[site](https://example.com/page)");
  expect(a).toContain("[root](/abs/path.md)");
});
