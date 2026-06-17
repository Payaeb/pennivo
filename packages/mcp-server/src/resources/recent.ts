// Source for the `pennivo://recent` resource. The desktop host will later
// inject one backed by the editor's real recent-files store; the standalone
// CLI falls back to most-recently-modified markdown under the workspace.

import { promises as fs } from "node:fs";
import type { RecentFile, RecentSource } from "../deps.js";
import { walkMarkdown } from "../fs/workspaceFs.js";

export function mtimeRecentSource(root: string): RecentSource {
  return {
    async list(limit: number): Promise<RecentFile[]> {
      const files: RecentFile[] = [];
      for await (const abs of walkMarkdown(root)) {
        try {
          const stat = await fs.stat(abs);
          files.push({ path: abs, mtimeMs: stat.mtimeMs });
        } catch {
          // Skip files we can't stat.
        }
      }
      files.sort((a, b) => (b.mtimeMs ?? 0) - (a.mtimeMs ?? 0));
      return files.slice(0, Math.max(0, limit));
    },
  };
}
