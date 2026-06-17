import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import electron from "vite-plugin-electron";
import renderer from "vite-plugin-electron-renderer";

export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        entry: "src/main/main.ts",
        vite: {
          build: {
            outDir: "dist/main",
            rollupOptions: {
              external: ["electron", "electron-updater"],
            },
          },
        },
        // Restart the entire Electron process when main.ts changes —
        // without this, IPC handlers added in main never get registered
        // until the dev server is killed and re-launched.
        onstart(args) {
          args.startup();
        },
      },
      {
        entry: "src/main/preload.ts",
        vite: {
          build: {
            outDir: "dist/preload",
            rollupOptions: {
              external: ["electron", "electron-updater"],
            },
          },
        },
        onstart(args) {
          args.reload();
        },
      },
      {
        // Standalone MCP server, run by the binary as Node (Phase 12a). Bundled
        // self-contained (only `electron` external — it's never imported here).
        entry: "src/mcp/server.ts",
        vite: {
          build: {
            outDir: "dist/mcp",
            rollupOptions: {
              external: ["electron"],
            },
          },
        },
        // Not an Electron process — just build it; don't start/reload anything.
        onstart() {},
      },
    ]),
    renderer(),
  ],
  build: {
    outDir: "dist/renderer",
  },
});
