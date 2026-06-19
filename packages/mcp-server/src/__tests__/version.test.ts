import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PENNIVO_MCP_VERSION } from "../version.js";

// The version reported to MCP clients (version.ts) and the published package
// version (package.json) must stay in lockstep so a release never advertises a
// stale number in the initialize handshake.
describe("PENNIVO_MCP_VERSION", () => {
  it("matches the package.json version field", () => {
    const pkgPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
      "..",
      "package.json",
    );
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as {
      version: string;
    };
    expect(PENNIVO_MCP_VERSION).toBe(pkg.version);
  });
});
