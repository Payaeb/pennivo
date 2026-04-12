import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  root: ".",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    cssCodeSplit: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // React runtime — small (~140KB) but shared by everything
          if (
            id.includes("node_modules/react/") ||
            id.includes("node_modules/react-dom/")
          ) {
            return "react-vendor";
          }

          // ProseMirror core — the editing engine under Milkdown
          if (id.includes("node_modules/prosemirror-")) {
            return "prosemirror-vendor";
          }

          // Milkdown framework layer
          if (id.includes("node_modules/@milkdown/")) {
            return "milkdown-vendor";
          }

          // Syntax highlighting (lowlight + highlight.js languages) is
          // lazy-loaded on first code-block render — see
          // `packages/ui/src/components/Editor/syntaxHighlight.ts`.
          // We deliberately do NOT force it into a manual chunk because
          // forcing lazy modules into a named chunk defeats rollup's
          // tree-shaking of the `lowlight/index.js` re-export barrels and
          // balloons the chunk to ~1 MB. Letting rollup form the chunk
          // naturally keeps it at ~60 KB.

          // Markdown parsing (remark / mdast / micromark / unified ecosystem)
          if (
            id.includes("node_modules/remark") ||
            id.includes("node_modules/mdast") ||
            id.includes("node_modules/micromark") ||
            id.includes("node_modules/unified") ||
            id.includes("node_modules/unist") ||
            id.includes("node_modules/hast") ||
            id.includes("node_modules/vfile")
          ) {
            return "remark-vendor";
          }

          // Capacitor / platform bridge
          if (id.includes("node_modules/@capacitor/")) {
            return "capacitor-vendor";
          }
        },
      },
    },
  },
});
