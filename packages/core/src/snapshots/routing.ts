import type { StorageDestination, TierDestinationConfig } from "./types";

/**
 * Resolve the destination set for a snapshot belonging to the tier at
 * `tierIndex`. If the config does not mention `tierIndex`, defaults to
 * `['local']` — the safest fallback (no archive write attempted).
 *
 * If the matching entry has an empty `destinations` array, that's a user
 * choice meaning "do not write this tier" (e.g. an `Archive only` tier
 * after the archive folder was unset). We surface that empty array
 * verbatim so the writer can no-op cleanly.
 */
export function routeSnapshot(
  tierIndex: number,
  config: TierDestinationConfig[],
): StorageDestination[] {
  const match = config.find((c) => c.tierIndex === tierIndex);
  if (!match) return ["local"];
  return [...match.destinations];
}
