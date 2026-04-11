/**
 * lint-tokens.mjs — CSS custom property reference validator
 *
 * Ensures every `var(--xxx)` in the project's CSS files resolves to a
 * custom property defined somewhere in the project's CSS.  Catches the
 * class of bug where a renamed or removed token leaves behind a broken
 * `var()` reference that silently falls back to a hardcoded value.
 *
 * Usage:  node scripts/lint-tokens.mjs
 * Exit 0 on success, exit 1 if any unresolved references are found.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// ── Helpers ──────────────────────────────────────────────────────────

/** Recursively collect all `.css` files under `dir`. */
function collectCssFiles(dir) {
  const results = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip build artifacts, dist output, and node_modules
      if (
        entry.name === "node_modules" ||
        entry.name === "build" ||
        entry.name === "dist"
      ) {
        continue;
      }
      results.push(...collectCssFiles(full));
    } else if (entry.name.endsWith(".css")) {
      results.push(full);
    }
  }
  return results;
}

/** Strip CSS block comments from source text. */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, (match) =>
    // Preserve line count so line numbers stay correct
    match.replace(/[^\n]/g, " ")
  );
}

/**
 * Extract all CSS custom property definitions (`--xxx: value;`) from
 * source text.  Returns a Set of property names (e.g. `--bg-surface`).
 */
function extractDefinitions(src) {
  const defs = new Set();
  const cleaned = stripComments(src);
  // Match lines like `  --foo-bar: somevalue;`
  const re = /(?:^|[{;\s])\s*(--[a-zA-Z][\w-]*)\s*:/gm;
  let m;
  while ((m = re.exec(cleaned)) !== null) {
    defs.add(m[1]);
  }
  return defs;
}

/**
 * Extract all `var(--xxx)` references from source text.
 * Returns an array of { name, line } objects.
 * Handles nested `var()` in fallbacks like `var(--a, var(--b))`.
 */
function extractReferences(src) {
  const refs = [];
  const cleaned = stripComments(src);
  const lines = cleaned.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Match all var(--xxx...) calls, including nested ones
    const re = /var\(\s*(--[a-zA-Z][\w-]*)/g;
    let m;
    while ((m = re.exec(line)) !== null) {
      refs.push({ name: m[1], line: i + 1 });
    }
  }
  return refs;
}

// ── Configuration ────────────────────────────────────────────────────

// CSS custom properties that are set via inline styles in JS/TSX
// rather than defined in any CSS file.  These are legitimate and
// should not be flagged.
const INLINE_STYLE_ALLOWLIST = new Set([
  "--depth", // Sidebar tree indent depth, set in Sidebar.tsx
]);

// ── Main ─────────────────────────────────────────────────────────────

const ROOT = join(import.meta.dirname, "..");

// Directories to scan for source CSS
const scanDirs = [
  join(ROOT, "packages", "ui", "src"),
  join(ROOT, "packages", "android", "src"),
];

// 1. Collect all source CSS files
const allCssFiles = scanDirs.flatMap(collectCssFiles);

// 2. Build a global set of every custom property defined in ANY CSS file
const globalDefs = new Set();
const fileDefMap = new Map(); // file -> Set of defs in that file

for (const file of allCssFiles) {
  const src = readFileSync(file, "utf-8");
  const defs = extractDefinitions(src);
  fileDefMap.set(file, defs);
  for (const d of defs) {
    globalDefs.add(d);
  }
}

// 3. Scan all files for var() references and check against global defs
const violations = [];

for (const file of allCssFiles) {
  const src = readFileSync(file, "utf-8");
  const refs = extractReferences(src);

  for (const { name, line } of refs) {
    if (!globalDefs.has(name) && !INLINE_STYLE_ALLOWLIST.has(name)) {
      violations.push({
        file: relative(ROOT, file).replace(/\\/g, "/"),
        line,
        variable: name,
      });
    }
  }
}

// 4. Report results
if (violations.length === 0) {
  console.log("\u2713 All CSS token references valid");
  process.exit(0);
} else {
  console.error(
    `\u2717 Found ${violations.length} unresolved CSS variable reference(s):\n`
  );
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  ${v.variable}`);
  }
  console.error("");
  process.exit(1);
}
