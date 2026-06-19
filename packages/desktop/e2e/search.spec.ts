import { test, expect, _electron as electron } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const REPO_PACKAGE_DIR = path.resolve(__dirname, "..");

// The result shape returned by window.pennivo.searchWorkspace (core's
// SearchResults). Declared locally so the spec can assert against it without
// importing across the package boundary.
interface SearchResultLine {
  line: number;
  fileOffset: number;
  snippet: string;
  truncatedStart: boolean;
  truncatedEnd: boolean;
  ranges: { start: number; end: number }[];
}
interface SearchFileResult {
  path: string;
  matchCount: number;
  lines: SearchResultLine[];
}
interface SearchResults {
  query: string;
  files: SearchFileResult[];
  totalMatches: number;
  capped: boolean;
  invalidPattern?: boolean;
}

// Force-set the active folder via the Electron userData directory so the app
// auto-loads our test workspace at startup (same approach as sidebar.spec.ts).
async function seedUserData(workspaceDir: string): Promise<string> {
  const userData = await mkdtemp(path.join(tmpdir(), "pennivo-e2e-userdata-"));
  await writeFile(
    path.join(userData, "sidebar-folder.json"),
    JSON.stringify(workspaceDir),
    "utf-8",
  );
  return userData;
}

// Seed a workspace with known content. "salmon" appears in two files (alpha
// once, bravo twice across two lines); "unicorn" appears only in charlie;
// nothing contains "zzqqxx".
async function makeWorkspace(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "pennivo-e2e-search-"));
  await writeFile(
    path.join(dir, "alpha.md"),
    "# Alpha\n\nThe salmon swam upstream.\n",
  );
  await writeFile(
    path.join(dir, "bravo.md"),
    "# Bravo\n\nA salmon dinner.\n\nAnother salmon line here.\n",
  );
  await writeFile(
    path.join(dir, "charlie.md"),
    "# Charlie\n\nThe unicorn galloped away.\n",
  );
  await mkdir(path.join(dir, "notes"));
  await writeFile(
    path.join(dir, "notes", "todo.md"),
    "# Todo\n\nNothing special in here.\n",
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
  // rejects Chromium flags like --remote-debugging-port.
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
});

test.afterEach(async () => {
  if (app) await app.close();
  if (workspaceDir) await rm(workspaceDir, { recursive: true, force: true });
  if (userDataDir) await rm(userDataDir, { recursive: true, force: true });
});

// Drive the dormant IPC directly through the preload bridge — there is no UI
// yet, so we call window.pennivo.searchWorkspace from the renderer context.
function runSearch(query: string, options?: unknown): Promise<SearchResults> {
  return window.evaluate(
    ({ q, o }) =>
      window.pennivo.searchWorkspace(
        q,
        o as Parameters<typeof window.pennivo.searchWorkspace>[1],
      ) as Promise<unknown>,
    { q: query, o: options },
  ) as Promise<SearchResults>;
}

test("term present in two files returns both with expected match counts", async () => {
  const result = await runSearch("salmon");

  expect(result.query).toBe("salmon");
  const paths = result.files.map((f) => f.path).sort();
  expect(paths).toEqual(["alpha.md", "bravo.md"]);

  const alpha = result.files.find((f) => f.path === "alpha.md")!;
  const bravo = result.files.find((f) => f.path === "bravo.md")!;
  expect(alpha.matchCount).toBe(1);
  expect(bravo.matchCount).toBe(2);
  // alpha matches one occurrence on one line; bravo on two distinct lines.
  expect(alpha.lines.length).toBe(1);
  expect(bravo.lines.length).toBe(2);
  expect(result.totalMatches).toBe(3);
  expect(result.capped).toBe(false);
});

test("term present in one file returns one result with line + snippet", async () => {
  const result = await runSearch("unicorn");

  expect(result.files.length).toBe(1);
  const charlie = result.files[0];
  expect(charlie.path).toBe("charlie.md");
  expect(charlie.matchCount).toBe(1);
  expect(charlie.lines.length).toBe(1);
  // "The unicorn galloped away." sits on line 3 of the file.
  expect(charlie.lines[0].line).toBe(3);
  expect(charlie.lines[0].snippet.toLowerCase()).toContain("unicorn");
  expect(result.totalMatches).toBe(1);
});

test("short query (1 char) returns empty results without walking the fs", async () => {
  const result = await runSearch("u");

  expect(result.query).toBe("u");
  expect(result.files).toEqual([]);
  expect(result.totalMatches).toBe(0);
  expect(result.capped).toBe(false);
});

test("term absent everywhere returns empty results", async () => {
  const result = await runSearch("zzqqxx");

  expect(result.query).toBe("zzqqxx");
  expect(result.files).toEqual([]);
  expect(result.totalMatches).toBe(0);
  expect(result.capped).toBe(false);
});
