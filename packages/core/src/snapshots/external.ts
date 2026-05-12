import type { Snapshot } from "./types";

/**
 * Classification returned by `detectExternalChange`. The host (Electron main
 * today; future Android / cloud) maps this to a follow-up action:
 *
 * - `first-seen`  — no prior snapshots; capture a baseline `user`-authored
 *                   snapshot so future opens have something to compare to.
 *   No toast.
 * - `external`    — disk hash differs from the most recent snapshot's
 *                   content hash. Capture a snapshot tagged `author:
 *                   external` and surface a one-time toast: "This file was
 *                   changed outside Pennivo since you last saved it."
 * - `unchanged`   — disk hash matches the most recent snapshot's hash.
 *                   No-op.
 */
export type ExternalChangeStatus = "first-seen" | "external" | "unchanged";

/**
 * Pure classifier for external-change detection on file open. Inputs are
 * the just-read disk content hash and the most recent snapshot for that
 * file (or `undefined` if none). Returns the action class — never throws,
 * never logs, no I/O.
 */
export function detectExternalChange(
  diskContentHash: string,
  mostRecentSnapshot: Snapshot | undefined,
): ExternalChangeStatus {
  if (!mostRecentSnapshot) return "first-seen";
  if (mostRecentSnapshot.contentHash === diskContentHash) return "unchanged";
  return "external";
}
