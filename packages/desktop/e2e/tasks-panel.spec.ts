import { test, expect, _electron as electron } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const REPO_PACKAGE_DIR = path.resolve(__dirname, "..");

// Force-set the active folder via the Electron userData directory so the app
// auto-loads our test workspace at startup (same approach as
// global-search-ui.spec.ts / search.spec.ts).
async function seedUserData(workspaceDir: string): Promise<string> {
  const userData = await mkdtemp(path.join(tmpdir(), "pennivo-e2e-userdata-"));
  await writeFile(
    path.join(userData, "sidebar-folder.json"),
    JSON.stringify(workspaceDir),
    "utf-8",
  );
  return userData;
}

// Local YYYY-MM-DD for "today + offsetDays", matching the app's own
// `formatLocalIsoDate(new Date())` convention (local time, not UTC) so the
// agenda buckets land deterministically regardless of what day the suite
// actually runs on.
function isoDate(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const yyyy = String(d.getFullYear()).padStart(4, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// Seed a workspace with checklist items spanning every agenda bucket plus a
// no-date and a checked (done) item, across three files with labels.
async function makeWorkspace(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "pennivo-e2e-tasks-"));
  await writeFile(
    path.join(dir, "alpha.md"),
    [
      "# Alpha",
      "",
      `- [ ] Pay rent #urgent [due:: ${isoDate(-3)}]`,
      `- [ ] Call dentist [due:: ${isoDate(0)}]`,
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(dir, "bravo.md"),
    [
      "# Bravo",
      "",
      `- [ ] Buy groceries #home [due:: ${isoDate(1)}]`,
      `- [ ] Review PR #urgent [due:: ${isoDate(3)}]`,
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(dir, "charlie.md"),
    [
      "# Charlie",
      "",
      `- [ ] Plan trip [due:: ${isoDate(10)}]`,
      "- [ ] Clean garage #home",
      "- [x] Old done task",
      "",
    ].join("\n"),
  );
  // Labels-mode fixtures: labeled PLAIN bullets (one sharing #home with the
  // open tasks above) and a checked task carrying a [done::] stamp.
  await writeFile(
    path.join(dir, "notes.md"),
    [
      "# Notes",
      "",
      "- Big rewrite idea #ideas",
      "- Reorganize pantry #home",
      // Dated plain bullet, no label: belongs in the Tasks tab (Tomorrow).
      `- Renew passport [due:: ${isoDate(1)}]`,
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(dir, "delta.md"),
    [
      "# Delta",
      "",
      "- [x] Shipped thing #archive [done:: 2026-10-05]",
      "",
    ].join("\n"),
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
  await window.waitForSelector(".app-shell, .app-root, [data-app-ready]", {
    timeout: 20_000,
  });
  // The sidebar auto-opens with the seeded folder; wait for the tree.
  await expect(window.locator(".sidebar")).toBeVisible({ timeout: 5_000 });
  await expect(window.getByText("alpha.md")).toBeVisible();
});

test.afterEach(async () => {
  if (app) await app.close();
  if (workspaceDir) await rm(workspaceDir, { recursive: true, force: true });
  if (userDataDir) await rm(userDataDir, { recursive: true, force: true });
});

test("header toggle opens the tasks panel and groups items by agenda bucket", async () => {
  await window.locator('.sidebar-header [aria-label="Tasks"]').click();

  await expect(window.locator(".tasks-panel")).toBeVisible({
    timeout: 5_000,
  });

  // All six buckets are populated by the seeded fixture.
  const headers = window.locator(".tasks-panel-section-title");
  await expect(headers).toHaveText([
    "Overdue",
    "Today",
    "Tomorrow",
    "This Week",
    "Later",
    "No date",
  ]);

  // Spot-check a representative item per bucket; the checked item never
  // appears as a row (it is summarized only in the done count).
  await expect(
    window.locator(".tasks-panel-item", { hasText: "Pay rent" }),
  ).toBeVisible();
  await expect(
    window.locator(".tasks-panel-item", { hasText: "Call dentist" }),
  ).toBeVisible();
  await expect(
    window.locator(".tasks-panel-item", { hasText: "Buy groceries" }),
  ).toBeVisible();
  await expect(
    window.locator(".tasks-panel-item", { hasText: "Review PR" }),
  ).toBeVisible();
  await expect(
    window.locator(".tasks-panel-item", { hasText: "Plan trip" }),
  ).toBeVisible();
  await expect(
    window.locator(".tasks-panel-item", { hasText: "Clean garage" }),
  ).toBeVisible();
  await expect(
    window.locator(".tasks-panel-item", { hasText: "Old done task" }),
  ).toHaveCount(0);

  // The dated plain bullet (no label) sits under Tomorrow with a dot glyph;
  // the undated labeled bullets never appear in the Tasks tab.
  const passport = window.locator(".tasks-panel-item", {
    hasText: "Renew passport",
  });
  await expect(passport).toHaveCount(1);
  await expect(passport.locator("circle")).toHaveCount(1);
  await expect(passport.locator("rect")).toHaveCount(0);
  await expect(
    window.locator(
      ".tasks-panel-section-header:has-text('Tomorrow') ~ .tasks-panel-item",
      { hasText: "Renew passport" },
    ),
  ).toHaveCount(1);
  await expect(
    window.locator(".tasks-panel-item", { hasText: "Big rewrite idea" }),
  ).toHaveCount(0);

  // Overdue carries the danger styling class; the summary reports 7 open
  // (6 tasks + the dated bullet) / 2 done.
  await expect(
    window.locator(".tasks-panel-section-header--overdue"),
  ).toContainText("Overdue");
  await expect(window.locator(".tasks-panel-summary")).toContainText("7 open");
  await expect(window.locator(".tasks-panel-summary")).toContainText("2 done");
});

test("clicking a task opens that file and jumps to the correct line in WYSIWYG mode", async () => {
  await window.locator('.sidebar-header [aria-label="Tasks"]').click();

  // "Review PR" is bravo.md's SECOND task line, so a correct jump must move
  // past the top of the document.
  const row = window
    .locator(".tasks-panel-item", { hasText: "Review PR" })
    .first();
  await expect(row).toBeVisible({ timeout: 5_000 });
  await row.click();

  await expect(window.locator(".ProseMirror")).toContainText("Review PR", {
    timeout: 5_000,
  });
  // The jump re-finds the first term ("Review") and drives the same find
  // decoration FindReplace uses, so the matched occurrence carries the
  // find-match--current class — proving the editor landed on the task line,
  // not merely that the file opened.
  const current = window.locator(".ProseMirror .find-match--current");
  await expect(current).toHaveText("Review", { timeout: 5_000 });
});

test("filtering by a label chip narrows the list", async () => {
  await window.locator('.sidebar-header [aria-label="Tasks"]').click();
  await expect(window.locator(".tasks-panel")).toBeVisible({
    timeout: 5_000,
  });
  await expect(
    window.locator(".tasks-panel-item", { hasText: "Pay rent" }),
  ).toBeVisible();

  await window
    .locator(".tasks-panel-label-chip", { hasText: "#urgent" })
    .click();

  // Only the two #urgent-labeled items remain.
  await expect(
    window.locator(".tasks-panel-item", { hasText: "Pay rent" }),
  ).toBeVisible();
  await expect(
    window.locator(".tasks-panel-item", { hasText: "Review PR" }),
  ).toBeVisible();
  await expect(
    window.locator(".tasks-panel-item", { hasText: "Call dentist" }),
  ).toHaveCount(0);
  await expect(
    window.locator(".tasks-panel-item", { hasText: "Buy groceries" }),
  ).toHaveCount(0);

  // "All" resets the filter.
  await window.locator(".tasks-panel-label-chip", { hasText: "All" }).click();
  await expect(
    window.locator(".tasks-panel-item", { hasText: "Call dentist" }),
  ).toBeVisible();
});

test("Ctrl+Shift+T opens tasks and focuses the filter input", async () => {
  await window.keyboard.press("Control+Shift+T");
  const input = window.locator(".tasks-panel-input");
  await expect(input).toBeVisible({ timeout: 5_000 });
  await expect(input).toBeFocused();
});

test.describe("Labels mode", () => {
  async function openLabels() {
    await window.locator('.sidebar-header [aria-label="Tasks"]').click();
    await expect(window.locator(".tasks-panel")).toBeVisible({
      timeout: 5_000,
    });
    const tasksTab = window.getByRole("tab", { name: "Tasks" });
    await expect(tasksTab).toHaveAttribute("aria-selected", "true");
    const labelsTab = window.getByRole("tab", { name: "Labels" });
    await labelsTab.click();
    await expect(labelsTab).toHaveAttribute("aria-selected", "true");
  }

  test("Labels tab lists label group headers alphabetically, including plain bullets", async () => {
    await openLabels();

    await expect(
      window.locator(
        ".tasks-panel-label-group-header .tasks-panel-chip--label",
      ),
    ).toHaveText(["#archive", "#home", "#ideas", "#urgent"], {
      timeout: 5_000,
    });
    await expect(
      window.getByRole("option", { name: /Big rewrite idea/ }),
    ).toBeVisible();
    // The dated bullet has no label, so it has no group in the Labels tab.
    await expect(
      window.getByRole("option", { name: /Renew passport/ }),
    ).toHaveCount(0);
  });

  test("the label chip row shows in Labels mode and a chip narrows to that group", async () => {
    await openLabels();

    await expect(
      window.getByRole("group", { name: "Filter by label" }),
    ).toBeVisible();
    await window
      .locator(".tasks-panel-label-chip", { hasText: "#ideas" })
      .click();
    await expect(
      window.locator(
        ".tasks-panel-label-group-header .tasks-panel-chip--label",
      ),
    ).toHaveText(["#ideas"]);
    await expect(
      window.getByRole("option", { name: /Big rewrite idea/ }),
    ).toBeVisible();
    await expect(
      window.getByRole("option", { name: /Reorganize pantry/ }),
    ).toHaveCount(0);

    await window.locator(".tasks-panel-label-chip", { hasText: "All" }).click();
    await expect(
      window.locator(
        ".tasks-panel-label-group-header .tasks-panel-chip--label",
      ),
    ).toHaveText(["#archive", "#home", "#ideas", "#urgent"]);
  });

  test("a label shared by tasks and a plain bullet shows all rows under one header", async () => {
    await openLabels();

    const homeHeader = window.locator(".tasks-panel-label-group-header", {
      hasText: "#home",
    });
    await expect(homeHeader).toHaveCount(1);
    await expect(homeHeader.locator(".tasks-panel-section-count")).toHaveText(
      "3",
    );
    // Buy groceries + Clean garage (tasks) and Reorganize pantry (bullet).
    const homeRows = window.locator(
      ".tasks-panel-label-group-header:has-text('#home') ~ .tasks-panel-item",
    );
    await expect(homeRows.filter({ hasText: "Reorganize pantry" })).toHaveCount(
      1,
    );
    await expect(homeRows.filter({ hasText: "Buy groceries" })).toHaveCount(1);
    await expect(homeRows.filter({ hasText: "Clean garage" })).toHaveCount(1);
  });

  test("clicking a plain bullet row opens its file and jumps to that line", async () => {
    await openLabels();

    const row = window.getByRole("option", { name: /Big rewrite idea/ });
    await expect(row).toBeVisible({ timeout: 5_000 });
    await row.click();

    await expect(window.locator(".ProseMirror")).toContainText(
      "Big rewrite idea",
      { timeout: 5_000 },
    );
    const current = window.locator(".ProseMirror .find-match--current");
    await expect(current).toHaveText("Big", { timeout: 5_000 });
  });

  test("a checked task shows its done chip", async () => {
    await openLabels();

    const row = window.getByRole("option", { name: /Shipped thing/ });
    await expect(row).toBeVisible({ timeout: 5_000 });
    await expect(row.locator(".tasks-panel-chip--done")).toHaveText(
      "done 2026-10-05",
    );
  });
});
