import { describe, it, expect } from "vitest";
import { formatTrashExpiry } from "../display";

describe("formatTrashExpiry", () => {
  const NOW = new Date(2026, 4, 7, 12, 0, 0).getTime();

  it("returns 'Never expires' for null retention", () => {
    expect(formatTrashExpiry(null, NOW)).toBe("Never expires");
  });

  it("returns 'Expired' when expiry is now or in the past", () => {
    expect(formatTrashExpiry(NOW, NOW)).toBe("Expired");
    expect(formatTrashExpiry(NOW - 60_000, NOW)).toBe("Expired");
  });

  it("returns days when at least 1 day remains", () => {
    expect(formatTrashExpiry(NOW + 30 * 24 * 3600_000, NOW)).toBe("30d left");
    expect(formatTrashExpiry(NOW + 24 * 3600_000, NOW)).toBe("1d left");
  });

  it("returns hours when less than a day remains", () => {
    expect(formatTrashExpiry(NOW + 5 * 3600_000, NOW)).toBe("5h left");
    expect(formatTrashExpiry(NOW + 3600_000, NOW)).toBe("1h left");
  });

  it("returns minutes (with 1m floor) for sub-hour values", () => {
    expect(formatTrashExpiry(NOW + 45 * 60_000, NOW)).toBe("45m left");
    expect(formatTrashExpiry(NOW + 90_000, NOW)).toBe("1m left");
    // Edge: 30s remaining should not say "0m left" while still positive.
    expect(formatTrashExpiry(NOW + 30_000, NOW)).toBe("1m left");
  });

  it("uses Date.now() by default when `now` is omitted", () => {
    // Smoke-test only — we don't assert exact strings, just stable behavior.
    const result = formatTrashExpiry(Date.now() + 24 * 3600_000);
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });
});
