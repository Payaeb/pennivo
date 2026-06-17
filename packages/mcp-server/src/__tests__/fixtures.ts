// Temp-workspace fixture helpers.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export function makeWorkspace(): string {
  return mkdtempSync(path.join(tmpdir(), "pennivo-mcp-test-"));
}

export function cleanup(root: string): void {
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    // best-effort
  }
}

export function writeFile(
  root: string,
  relPath: string,
  content: string,
): string {
  const abs = path.join(root, relPath);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, content, "utf-8");
  return abs;
}

export function makeDir(root: string, relPath: string): string {
  const abs = path.join(root, relPath);
  mkdirSync(abs, { recursive: true });
  return abs;
}

/** Seed a small, predictable workspace and return its root. */
export function seedWorkspace(): string {
  const root = makeWorkspace();
  writeFile(root, "notes.md", "# Notes\n\nThe quick brown fox.\n");
  writeFile(root, "todo.txt", "buy milk\nwrite tests\n");
  writeFile(root, "sub/deep.md", "# Deep\n\nfox runs here too.\n");
  writeFile(root, "sub/nested/leaf.markdown", "# Leaf\n\nnothing special.\n");
  makeDir(root, "empty-folder");
  writeFile(root, ".hidden/secret.md", "# Secret\n\nhidden file.\n");
  makeDir(root, "node_modules/pkg");
  writeFile(
    root,
    "node_modules/pkg/readme.md",
    "# Dep\n\nshould be skipped.\n",
  );
  writeFile(
    root,
    "image-doc.md",
    "# Pic\n\n![alt](./image-doc-md-images/my%20pic.png)\n",
  );
  return root;
}
