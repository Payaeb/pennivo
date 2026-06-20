// Targeted edit tools: replace_in_file (single find/replace) and edit_file
// (a batch of sequential find/replace edits applied atomically). Both gate on
// the WRITE permission (off by default) and resolve through the workspace
// safety boundary with symlink-aware checks.
//
// Matching happens against the DECODED content: the on-disk form stores image
// URLs with %20, but an agent reasons about the literal-space form it reads
// back. So an oldText containing a literal space still matches a path the
// editor stored as %20, and the re-encode on write restores the %20.
//
// All matching is LITERAL: oldText / newText are never interpreted as regex.

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { decodeImageUrlSpaces, encodeImageUrlSpaces } from "@pennivo/core";
import type { ServerDeps } from "../deps.js";
import { resolveInWorkspace, toWorkspaceRelative } from "../fs/pathSafety.js";
import { writeFileAtomic } from "../fs/atomicWrite.js";
import { isMarkdown, readFileText } from "../fs/workspaceFs.js";
import {
  guardedTool,
  jsonResult,
  errorResult,
  type ToolResult,
} from "./shared.js";

interface EditSpec {
  oldText: string;
  newText: string;
  replaceAll?: boolean;
}

interface ReplaceInFileArgs {
  path: string;
  oldText: string;
  newText: string;
  replaceAll?: boolean;
}

interface EditFileArgs {
  path: string;
  edits: EditSpec[];
}

interface AppliedEdit {
  oldText: string;
  replacements: number;
}

const MAX_SNIPPET = 60;

/** A short, single-line form of a match string for error/output readability. */
function snippet(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > MAX_SNIPPET
    ? `${oneLine.slice(0, MAX_SNIPPET)}...`
    : oneLine;
}

/** Count non-overlapping occurrences of `needle` (literal) in `haystack`. */
function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let from = 0;
  for (;;) {
    const idx = haystack.indexOf(needle, from);
    if (idx === -1) break;
    count++;
    from = idx + needle.length;
  }
  return count;
}

/** Replace the first occurrence of `needle` with `replacement` (literal). */
function replaceFirst(
  haystack: string,
  needle: string,
  replacement: string,
): string {
  const idx = haystack.indexOf(needle);
  if (idx === -1) return haystack;
  return haystack.slice(0, idx) + replacement + haystack.slice(idx + needle.length);
}

/** Replace every occurrence of `needle` with `replacement` (literal). */
function replaceAllLiteral(
  haystack: string,
  needle: string,
  replacement: string,
): string {
  return haystack.split(needle).join(replacement);
}

interface ApplyOk {
  ok: true;
  working: string;
  applied: AppliedEdit[];
}
interface ApplyErr {
  ok: false;
  error: string;
}

/**
 * Apply each edit sequentially against the evolving `working` string. Aborts
 * the whole batch (returning an error) the moment any edit's match check fails,
 * so the caller writes nothing. Edits see the result of earlier edits.
 */
function applyEdits(initial: string, edits: EditSpec[]): ApplyOk | ApplyErr {
  let working = initial;
  const applied: AppliedEdit[] = [];
  for (const edit of edits) {
    const count = countOccurrences(working, edit.oldText);
    if (count === 0) {
      return { ok: false, error: `oldText not found: ${snippet(edit.oldText)}` };
    }
    if (count > 1 && edit.replaceAll !== true) {
      return {
        ok: false,
        error: `oldText is ambiguous (${count} matches); set replaceAll or add surrounding context: ${snippet(
          edit.oldText,
        )}`,
      };
    }
    working = edit.replaceAll
      ? replaceAllLiteral(working, edit.oldText, edit.newText)
      : replaceFirst(working, edit.oldText, edit.newText);
    applied.push({
      oldText: snippet(edit.oldText),
      replacements: edit.replaceAll ? count : 1,
    });
  }
  return { ok: true, working, applied };
}

/** Shared body for both edit tools once the edit list is normalized. */
async function runEdits(
  deps: ServerDeps,
  relPath: string,
  edits: EditSpec[],
): Promise<ToolResult> {
  const abs = resolveInWorkspace(deps.root, relPath, { followSymlinks: true });
  if (!isMarkdown(abs)) return errorResult(`Not a markdown file: ${relPath}`);

  let raw: string;
  try {
    raw = await readFileText(abs);
  } catch {
    return errorResult(`File does not exist: ${relPath}`);
  }

  // Match against the decoded view so a literal space matches an on-disk %20.
  const working = decodeImageUrlSpaces(raw);
  const result = applyEdits(working, edits);
  if (!result.ok) return errorResult(result.error);

  const out = encodeImageUrlSpaces(result.working);
  await writeFileAtomic(abs, out);

  return jsonResult({
    path: toWorkspaceRelative(deps.root, abs),
    edits: result.applied,
    bytesBefore: Buffer.byteLength(raw),
    bytesAfter: Buffer.byteLength(out),
  });
}

export function registerEditTools(
  server: McpServer,
  deps: ServerDeps,
  getAgent: () => string,
): void {
  server.registerTool(
    "replace_in_file",
    {
      title: "Replace text in file",
      description:
        "Find and replace a single block of literal text in an existing markdown file. Fails (writing nothing) if `oldText` is not found, or if it matches more than once without `replaceAll`. Matching is literal, not regex; image URLs are matched in their space form and re-stored as %20.",
      inputSchema: {
        path: z
          .string()
          .describe("Workspace-relative path to an existing markdown file."),
        oldText: z
          .string()
          .min(1)
          .describe("Exact literal text to find. Add surrounding context to disambiguate."),
        newText: z.string().describe("Literal replacement text (may be empty)."),
        replaceAll: z
          .boolean()
          .optional()
          .describe("Replace every occurrence instead of requiring a unique match."),
      },
      annotations: { readOnlyHint: false },
    },
    guardedTool<ReplaceInFileArgs>(
      deps,
      getAgent,
      "replace_in_file",
      (a) => a.path,
      async (a) =>
        runEdits(deps, a.path, [
          {
            oldText: a.oldText,
            newText: a.newText,
            replaceAll: a.replaceAll,
          },
        ]),
    ),
  );

  server.registerTool(
    "edit_file",
    {
      title: "Edit file (batch)",
      description:
        "Apply an ordered list of literal find/replace edits to an existing markdown file. Edits run sequentially against the evolving content, so a later edit can target text an earlier one produced. The whole call is atomic: if any edit's `oldText` is not found or is ambiguous (without `replaceAll`), nothing is written.",
      inputSchema: {
        path: z
          .string()
          .describe("Workspace-relative path to an existing markdown file."),
        edits: z
          .array(
            z.object({
              oldText: z
                .string()
                .min(1)
                .describe("Exact literal text to find."),
              newText: z
                .string()
                .describe("Literal replacement text (may be empty)."),
              replaceAll: z
                .boolean()
                .optional()
                .describe("Replace every occurrence instead of a unique match."),
            }),
          )
          .min(1)
          .describe("Edits applied in order against the evolving content."),
      },
      annotations: { readOnlyHint: false },
    },
    guardedTool<EditFileArgs>(
      deps,
      getAgent,
      "edit_file",
      (a) => a.path,
      async (a) => runEdits(deps, a.path, a.edits),
    ),
  );
}
