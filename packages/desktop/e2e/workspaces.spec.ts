import { test, expect, _electron as electron } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const REPO_PACKAGE_DIR = path.resolve(__dirname, "..");

// Force-set the legacy sidebar folder via the Electron userData directory so the
// app auto-loads our test workspace at startup. main.ts reads
// `${app.getPath("userData")}/sidebar-folder.json` and parses it as a
// JSON-encoded string. This is the PRE-workspaces (legacy) seed path.
async function seedUserData(workspaceDir: string): Promise<string> {
  const userData = await mkdtemp(path.join(tmpdir(), "pennivo-e2e-userdata-"));
  await writeFile(
    path.join(userData, "sidebar-folder.json"),
    JSON.stringify(workspaceDir),
    "utf-8",
  );
  return userData;
}

// Standard workspace fixture: alpha.md/bravo.md/charlie.md + notes/todo.md.
// Matches sidebar.spec.ts so the tree assertions line up.
async function makeWorkspace(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "pennivo-e2e-workspace-"));
  await writeFile(path.join(dir, "alpha.md"), "# Alpha\n\nfirst file.");
  await writeFile(path.join(dir, "bravo.md"), "# Bravo\n\nsecond file.");
  await writeFile(path.join(dir, "charlie.md"), "# Charlie\n\nthird file.");
  await mkdir(path.join(dir, "notes"));
  await writeFile(path.join(dir, "notes", "todo.md"), "# Todo\n\nin a folder.");
  return dir;
}

// A second workspace fixture with DISTINCT files so switching is observable.
async function makeWorkspaceB(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "pennivo-e2e-workspace-b-"));
  await writeFile(path.join(dir, "delta.md"), "# Delta\n\nb first file.");
  await writeFile(path.join(dir, "echo.md"), "# Echo\n\nb second file.");
  return dir;
}

// Seed settings.json under userData with a well-formed `workspaces` block.
// The shape mirrors WorkspacesState / WorkspacePrefs from @pennivo/core exactly
// (workspaces[] with id/name/rootPath, activeWorkspaceId, prefs keyed by id with
// lastOpenFile/sortKey/fileOpenTimestamps). settings.json needs no other keys to
// be valid — readSettings just JSON.parses it and settings:get migrates the rest.
async function seedSettingsWorkspaces(
  wsADir: string,
  wsBDir: string,
): Promise<string> {
  const userData = await mkdtemp(path.join(tmpdir(), "pennivo-e2e-userdata-"));
  const nameA = path.basename(wsADir);
  const nameB = path.basename(wsBDir);
  const settings = {
    workspaces: {
      workspaces: [
        { id: "wsA", name: nameA, rootPath: wsADir },
        { id: "wsB", name: nameB, rootPath: wsBDir },
      ],
      activeWorkspaceId: "wsA",
      prefs: {
        wsA: { lastOpenFile: null, sortKey: "name-asc", fileOpenTimestamps: {} },
        wsB: { lastOpenFile: null, sortKey: "name-asc", fileOpenTimestamps: {} },
      },
    },
  };
  await writeFile(
    path.join(userData, "settings.json"),
    JSON.stringify(settings, null, 2),
    "utf-8",
  );
  // Keep the legacy file pointed at A too, so the legacy fallback never
  // contradicts the active workspace if anything reads it.
  await writeFile(
    path.join(userData, "sidebar-folder.json"),
    JSON.stringify(wsADir),
    "utf-8",
  );
  return userData;
}

// Launch Electron exactly like sidebar.spec.ts: point at the package dir, pass
// the user-data-dir, and strip ELECTRON_RUN_AS_NODE so Chromium flags work.
async function launchApp(userDataDir: string): Promise<{
  app: ElectronApplication;
  window: Page;
}> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k !== "ELECTRON_RUN_AS_NODE" && typeof v === "string") env[k] = v;
  }
  const app = await electron.launch({
    args: [REPO_PACKAGE_DIR, `--user-data-dir=${userDataDir}`],
    env,
    timeout: 30_000,
  });
  const window = await app.firstWindow();
  // Wait for the React tree to mount (the AppShell root is the canary).
  await window.waitForSelector(".app-shell, .app-root, [data-app-ready]", {
    timeout: 20_000,
  });
  return { app, window };
}

let app: ElectronApplication | undefined;
let window: Page;
// Temp dirs created per test; cleaned up in afterEach.
const cleanupDirs: string[] = [];

test.afterEach(async () => {
  if (app) {
    await app.close();
    app = undefined;
  }
  for (const dir of cleanupDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

test("migration: legacy single folder becomes one workspace", async () => {
  // Seed ONLY the legacy sidebar-folder.json (no settings.json workspaces key),
  // so settings:get runs migrateWorkspaces and synthesizes a single workspace
  // from the folder the user already had open. Validates the non-destructive
  // migration end to end through real app startup.
  const workspaceDir = await makeWorkspace();
  const userDataDir = await seedUserData(workspaceDir);
  cleanupDirs.push(workspaceDir, userDataDir);
  ({ app, window } = await launchApp(userDataDir));

  // The sidebar renders and the seeded files appear in the tree.
  await expect(window.locator(".sidebar")).toBeVisible({ timeout: 10_000 });
  await expect(window.getByText("alpha.md")).toBeVisible();
  await expect(window.getByText("bravo.md")).toBeVisible();

  // The switcher trigger is visible and its label is the folder basename.
  const expectedName = path.basename(workspaceDir);
  const trigger = window.locator(".sidebar-workspace-trigger");
  await expect(trigger).toBeVisible();
  await expect(trigger.locator(".sidebar-title")).toHaveText(expectedName);

  // Open the popover: exactly one workspace row, and it is marked active.
  await trigger.click();
  await expect(window.locator(".sidebar-workspace-menu")).toBeVisible();
  const rows = window.locator(".sidebar-workspace-row");
  await expect(rows).toHaveCount(1);
  const option = rows.first().locator(".sidebar-workspace-option");
  await expect(option).toHaveAttribute("aria-checked", "true");
  await expect(rows.first()).toHaveClass(/sidebar-workspace-row--selected/);
});

test("switcher lists and switches between multiple workspaces", async () => {
  // Two workspaces with distinct files, seeded directly into settings.json.
  const wsADir = await makeWorkspace();
  const wsBDir = await makeWorkspaceB();
  const userDataDir = await seedSettingsWorkspaces(wsADir, wsBDir);
  cleanupDirs.push(wsADir, wsBDir, userDataDir);
  ({ app, window } = await launchApp(userDataDir));

  const nameA = path.basename(wsADir);
  const nameB = path.basename(wsBDir);

  // Workspace A is active on launch — its files show. Settling on A here lets the
  // three mount-time startup loads (settings, folder, tree) resolve before we
  // switch, which keeps THIS test deterministic across repeats. The launch-race
  // itself (switching before those loads resolve) is closed by the guards in
  // App.tsx — userTouchedWorkspacesRef + the refreshSidebarTree last-write-wins
  // token — and exercised separately; clicking sub-300ms here is inherently
  // nondeterministic and is intentionally not relied on for the assertion.
  await expect(window.locator(".sidebar")).toBeVisible({ timeout: 10_000 });
  await expect(window.getByText("alpha.md")).toBeVisible();
  await expect(window.getByText("bravo.md")).toBeVisible();

  // Open the switcher: both rows listed, A active.
  const trigger = window.locator(".sidebar-workspace-trigger");
  await expect(trigger.locator(".sidebar-title")).toHaveText(nameA);
  await trigger.click();
  await expect(window.locator(".sidebar-workspace-menu")).toBeVisible();
  const rows = window.locator(".sidebar-workspace-row");
  await expect(rows).toHaveCount(2);

  const optionA = window
    .locator(".sidebar-workspace-option")
    .filter({ hasText: nameA });
  const optionB = window
    .locator(".sidebar-workspace-option")
    .filter({ hasText: nameB });
  await expect(optionA).toHaveAttribute("aria-checked", "true");
  await expect(optionB).toHaveAttribute("aria-checked", "false");

  // Drain any trailing mount-time startup loads (settings / folder / tree all
  // resolve independently) before switching, so this test stays deterministic
  // across repeats. The launch-race where a switch beats these loads is closed
  // by the App.tsx guards, not relied on here.
  await window.waitForTimeout(400);

  // Switch to B by clicking its row.
  await optionB.click();

  // The popover closes, B's files now show while A's files are gone, and the
  // trigger label becomes B's name — proving per-workspace tree + active state.
  await expect(window.locator(".sidebar-workspace-menu")).toBeHidden();
  await expect(window.getByText("delta.md")).toBeVisible({ timeout: 10_000 });
  await expect(window.getByText("echo.md")).toBeVisible();
  await expect(window.getByText("alpha.md")).toBeHidden();
  await expect(trigger.locator(".sidebar-title")).toHaveText(nameB);

  // Re-assert AFTER a short wait: a late async load (or a reverted active id)
  // would surface here. Both the tree (delta.md) and the trigger label must STAY
  // on B, confirming the switch is not clobbered by any trailing startup work.
  await window.waitForTimeout(500);
  await expect(trigger.locator(".sidebar-title")).toHaveText(nameB);
  await expect(window.getByText("delta.md")).toBeVisible();
  await expect(window.getByText("alpha.md")).toBeHidden();
});

test("remove a workspace from the switcher", async () => {
  // Same two-workspace seed. Remove B and confirm only A remains, still active
  // with its files. The remove handler never touches files on disk (not
  // asserted here per the brief).
  const wsADir = await makeWorkspace();
  const wsBDir = await makeWorkspaceB();
  const userDataDir = await seedSettingsWorkspaces(wsADir, wsBDir);
  cleanupDirs.push(wsADir, wsBDir, userDataDir);
  ({ app, window } = await launchApp(userDataDir));

  const nameA = path.basename(wsADir);
  const nameB = path.basename(wsBDir);

  await expect(window.locator(".sidebar")).toBeVisible({ timeout: 10_000 });

  // Open the switcher and locate B's row.
  const trigger = window.locator(".sidebar-workspace-trigger");
  await trigger.click();
  await expect(window.locator(".sidebar-workspace-menu")).toBeVisible();
  const rowB = window
    .locator(".sidebar-workspace-row")
    .filter({ hasText: nameB });
  await expect(rowB).toHaveCount(1);

  // The remove control is revealed on hover/focus; hovering the row makes it
  // interactable. Click it (no confirm dialog — handleRemoveWorkspace calls the
  // platform remove directly).
  await rowB.hover();
  const removeBtn = rowB.locator(".sidebar-workspace-remove");
  await removeBtn.click();

  // B's row disappears; exactly one row remains and it is A, still active.
  await expect(window.locator(".sidebar-workspace-row")).toHaveCount(1);
  await expect(
    window.locator(".sidebar-workspace-row").filter({ hasText: nameB }),
  ).toHaveCount(0);
  const optionA = window
    .locator(".sidebar-workspace-option")
    .filter({ hasText: nameA });
  await expect(optionA).toHaveAttribute("aria-checked", "true");

  // A's files are still present in the tree.
  await expect(window.getByText("alpha.md")).toBeVisible();
});
