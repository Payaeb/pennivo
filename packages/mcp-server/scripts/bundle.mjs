// Produce the runnable npm/npx artifact for @pennivo/mcp-server.
//
// `tsc -p tsconfig.build.json` already emitted the .d.ts files (declaration
// only). This step bundles the actual JS with esbuild so the published
// package is self-contained: `@pennivo/core` is private (never on the
// registry) so it MUST be inlined, while the MCP SDK + zod stay external as
// declared `dependencies` (npx resolves them from the package's own tree).
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outdir = path.join(pkgDir, "dist");

// The SDK ships deep subpath exports (server/mcp.js, server/stdio.js, …) so we
// externalize both the bare name and every subpath.
const external = [
  "@modelcontextprotocol/sdk",
  "@modelcontextprotocol/sdk/*",
  "zod",
  "zod/*",
];

const common = {
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  sourcemap: true,
  external,
  allowOverwrite: true,
  logLevel: "info",
};

// Library entry — no shebang.
await build({
  ...common,
  entryPoints: [path.join(pkgDir, "src/index.ts")],
  outfile: path.join(outdir, "index.js"),
});

// CLI entry — executable shebang so `npx`/`pennivo-mcp` can run it directly.
await build({
  ...common,
  entryPoints: [path.join(pkgDir, "src/bin/cli.ts")],
  outfile: path.join(outdir, "bin", "cli.js"),
  banner: { js: "#!/usr/bin/env node" },
});
