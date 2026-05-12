import type { Snapshot } from "./types";

/**
 * Returns true when a new snapshot would be redundant — i.e. its content
 * hash matches the most recent snapshot already on disk for this file.
 *
 * Caller passes the most-recent snapshot (or `undefined` if there is no
 * prior history). When there is no prior, we never dedupe — the first
 * snapshot for a file is always written.
 */
export function shouldDedupe(
  newContentHash: string,
  mostRecentSnapshot: Snapshot | undefined,
): boolean {
  if (!mostRecentSnapshot) return false;
  return mostRecentSnapshot.contentHash === newContentHash;
}
