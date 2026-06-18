import { describe, it, expect } from "vitest";
import { routeSnapshot } from "../routing";
import type { TierDestinationConfig } from "../types";

describe("routeSnapshot", () => {
  it("returns ['local'] when no config matches the tier", () => {
    expect(routeSnapshot(0, [])).toEqual(["local"]);
    expect(
      routeSnapshot(2, [{ tierIndex: 0, destinations: ["local"] }]),
    ).toEqual(["local"]);
  });

  it("returns the configured destinations for a matching tier", () => {
    const config: TierDestinationConfig[] = [
      { tierIndex: 0, destinations: ["local"] },
      { tierIndex: 1, destinations: ["local", "archive"] },
      { tierIndex: 2, destinations: ["archive"] },
    ];
    expect(routeSnapshot(0, config)).toEqual(["local"]);
    expect(routeSnapshot(1, config)).toEqual(["local", "archive"]);
    expect(routeSnapshot(2, config)).toEqual(["archive"]);
  });

  it("returns an empty array verbatim when configured (e.g. archive unset)", () => {
    const config: TierDestinationConfig[] = [
      { tierIndex: 0, destinations: [] },
    ];
    expect(routeSnapshot(0, config)).toEqual([]);
  });

  it("returns a fresh array (does not alias the config)", () => {
    const config: TierDestinationConfig[] = [
      { tierIndex: 0, destinations: ["local", "archive"] },
    ];
    const out = routeSnapshot(0, config);
    out.pop();
    expect(config[0]!.destinations).toEqual(["local", "archive"]);
  });
});
