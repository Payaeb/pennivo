// Pure display helpers for the Trash list — used by the renderer to format
// a trash entry's "expires-in" hint. Lives in @pennivo/core so the same
// rules apply on every host (desktop, mobile, future cloud) without a
// renderer dependency.

/**
 * Compute a short "expires-in" label for a trash entry given its
 * `expiresAtMs` field (or `null` for "Forever").
 *
 * Rules (locked 2026-05-07):
 * - `expiresAtMs === null` → `"Never expires"`.
 * - `expiresAtMs <= now`   → `"Expired"`.
 * - days >= 1              → `"<n>d left"` (whole days, floored).
 * - hours >= 1             → `"<n>h left"`.
 * - else                   → `"<n>m left"` (with a 1-minute floor so we
 *                            never show `"0m left"` while the entry is
 *                            technically still in the future).
 */
export function formatTrashExpiry(
  expiresAtMs: number | null,
  now: number = Date.now(),
): string {
  if (expiresAtMs === null) return "Never expires";
  const ms = expiresAtMs - now;
  if (ms <= 0) return "Expired";
  const minutes = Math.floor(ms / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days >= 1) return `${days}d left`;
  if (hours >= 1) return `${hours}h left`;
  return `${Math.max(1, minutes)}m left`;
}
