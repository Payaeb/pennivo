/**
 * Format a Date as a local (not UTC) `YYYY-MM-DD` string. Local time matches
 * how the rest of Pennivo displays dates and the "local device date/midnight
 * boundary" rule for task agenda bucketing and completion dates.
 */
export function formatLocalIsoDate(date: Date): string {
  const yyyy = String(date.getFullYear()).padStart(4, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
