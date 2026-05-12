// Pure visibility predicate for the cap-exceeded in-modal banner.
//
// The banner re-appears when the warning's overage exceeds the
// previously-dismissed value — "dismiss is for the current overage." When
// no warning is active the banner is hidden regardless of dismissal state.

import type { PruneWarning } from "./types";

/**
 * Decide whether the in-modal cap-exceeded banner should render given the
 * current warning + the persisted dismissal state.
 *
 * - No warning → never show.
 * - No prior dismissal → show.
 * - Prior dismissal but the current overage is greater than the dismissed
 *   overage → re-surface.
 * - Otherwise → keep hidden.
 *
 * The dismissed-at timestamp is currently unused by the predicate (the
 * overage check is sufficient) but the persisted shape carries it so future
 * variants — e.g. "remind me again after 24h" — can land without a
 * settings migration.
 */
export function shouldShowCapBanner(
  warning: PruneWarning | null,
  state: {
    capBannerDismissedAt: number | null;
    lastCapWarningOverageBytes: number | null;
  },
): boolean {
  if (!warning) return false;
  if (state.capBannerDismissedAt === null) return true;
  if (state.lastCapWarningOverageBytes === null) return true;
  return warning.overageBytes > state.lastCapWarningOverageBytes;
}
