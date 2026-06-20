// Pure gating decision for the Phase 12d streaming-render reload path.
//
// The live external-change reload funnel (App.tsx) must decide, for each
// incoming on-disk change to the open document, whether to apply an INCREMENTAL
// streaming update or fall back to the shipped full reload (loadContent ->
// Milkdown replaceAll). This module isolates that decision so it can be unit
// tested without a live editor.
//
// Default policy: streaming is ON only for agent-written files, OFF for normal
// user saves. The per-doc user override, when set, always wins. The decision is
// also gated by the same hard constraints the funnel already enforces for the
// clean reload branch: WYSIWYG mode only, and under the source-mode size limit.
//
// Pure TypeScript. No React, DOM, Milkdown, Electron, or node dependencies.

import type { SnapshotAuthor } from "@pennivo/core";

export interface StreamingGateInput {
  /** Author of the snapshot that produced this change. */
  author: SnapshotAuthor;
  /** Agent name attached to the snapshot (set for mcp / external-agent writes). */
  agentName?: string;
  /** True when the open document has unsaved edits. Streaming never runs dirty. */
  dirty: boolean;
  /** True when the editor is in raw source (CodeMirror) mode, not WYSIWYG. */
  sourceMode: boolean;
  /** True when the file is at/over the WYSIWYG size limit (forces source mode). */
  sizeOver: boolean;
  /**
   * Per-document user override. `undefined` means "no override, use the
   * attribution default"; `true`/`false` force streaming on/off for this doc.
   */
  userOverride?: boolean;
}

/**
 * True if the change carries agent attribution: an `mcp` author, or an
 * `external` author that an attribution pass tagged with an agent name. Normal
 * user saves are `user` (or `external` with no agent) and are NOT agent writes.
 */
export function isAgentAuthored(
  author: SnapshotAuthor,
  agentName?: string,
): boolean {
  if (author === "mcp") return true;
  if (author === "external" && !!agentName && agentName.length > 0) return true;
  return false;
}

/**
 * Decide whether the streaming incremental path should be used for this reload.
 *
 * Hard gates (any failing routes to the full reload): not in source mode, not
 * over the size limit, and not dirty. The clean reload branch in the funnel is
 * already non-dirty, but `dirty` is included so the helper is total and the
 * unit tests can assert it.
 *
 * Default: enabled for agent-authored changes, disabled otherwise. The per-doc
 * `userOverride` wins over the attribution default when defined.
 */
export function shouldStream(input: StreamingGateInput): boolean {
  // Hard constraints first. These mirror the funnel's existing guards and never
  // depend on attribution or override.
  if (input.dirty) return false;
  if (input.sourceMode) return false;
  if (input.sizeOver) return false;

  // User override, when set, beats the attribution default in either direction.
  if (input.userOverride !== undefined) {
    return input.userOverride;
  }

  // No override: stream only for agent-written files.
  return isAgentAuthored(input.author, input.agentName);
}
