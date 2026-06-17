// Per-file image-folder coherence, ported from the desktop's
// `normalizeAssetsForFile` (main.ts) onto core's pure `planNormalize`. Used by
// `rename_file` (so a renamed doc's `*-md-images/` folder follows it) and by
// `delete_file(includeAssets)` (to discover owned asset folders). Keeping the
// behaviour identical to the editor means a file renamed via MCP ends up in the
// same coherent state as one renamed in the sidebar.

import { promises as fs } from "node:fs";
import path from "node:path";
import {
  planNormalize,
  extractReferencedFolders,
  decodeImageUrlSpaces,
  encodeImageUrlSpaces,
} from "@pennivo/core";

/** Canonical asset-folder name for a file, e.g. `notes.md` -> `notes-md-images`. */
export function imagesDirName(filePath: string): string {
  return path.basename(filePath).replace(/\./g, "-") + "-images";
}

async function listAssetFolders(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory() && e.name.endsWith("-md-images"))
      .map((e) => e.name);
  } catch {
    return [];
  }
}

/**
 * Asset folders this file owns on disk: the convention-named folder plus any
 * `*-md-images/` folder actually referenced in its content. Returns folder
 * names only (not full paths). Mirrors the desktop `findAssetFoldersForFile`.
 */
export async function findAssetFoldersForFile(
  filePath: string,
): Promise<string[]> {
  const dir = path.dirname(filePath);
  const candidates = new Set<string>([imagesDirName(filePath)]);
  try {
    const content = decodeImageUrlSpaces(await fs.readFile(filePath, "utf-8"));
    for (const folder of extractReferencedFolders(content)) {
      candidates.add(folder);
    }
  } catch {
    // Unreadable — the convention candidate alone has to do.
  }
  const existing: string[] = [];
  for (const name of candidates) {
    try {
      await fs.access(path.join(dir, name));
      existing.push(name);
    } catch {
      // Not on disk.
    }
  }
  return existing;
}

/**
 * Bring a file's `*-md-images/` folders into the coherent "one file → one
 * canonical folder" state and rewrite its content references. Promote/merge on
 * disk, then write back only if content changed AND the rewrite wouldn't NEWLY
 * break a reference (pre-existing broken refs are preserved, never block a
 * legitimate rewrite). Faithful port of the desktop implementation.
 */
export async function normalizeAssetsForFile(
  filePath: string,
): Promise<{ healed: boolean; newContent?: string }> {
  const dir = path.dirname(filePath);
  const desiredFolder = imagesDirName(filePath);
  const desiredFolderPath = path.join(dir, desiredFolder);

  let content: string;
  try {
    content = await fs.readFile(filePath, "utf-8");
  } catch {
    return { healed: false };
  }

  const onDisk = await listAssetFolders(dir);

  // The planner works in literal-space folder names (how on-disk names look);
  // saved markdown uses %20 for portability. Decode before planning, re-encode
  // before writing.
  const decodedContent = decodeImageUrlSpaces(content);
  const plan = planNormalize({
    content: decodedContent,
    onDiskFolders: onDisk,
    desiredFolder,
  });
  if (!plan.changed) return { healed: false };

  let promoteFailed = false;
  if (plan.promote) {
    const src = path.join(dir, plan.promote.from);
    const dst = path.join(dir, plan.promote.to);
    try {
      await fs.rename(src, dst);
    } catch {
      // Windows EBUSY/EPERM when handles are held — copy + rm fallback.
      try {
        await fs.cp(src, dst, {
          recursive: true,
          errorOnExist: false,
          force: true,
        });
        try {
          await fs.rm(src, { recursive: true, force: true });
        } catch {
          // Source may still be locked; leave it.
        }
      } catch {
        promoteFailed = true;
      }
    }
  }

  for (const folderName of plan.mergeFrom) {
    const srcFolder = path.join(dir, folderName);
    let items: string[];
    try {
      items = await fs.readdir(srcFolder);
    } catch {
      continue;
    }
    for (const item of items) {
      const destItem = path.join(desiredFolderPath, item);
      try {
        await fs.access(destItem); // conflict — leave the source copy in place
      } catch {
        try {
          await fs.rename(path.join(srcFolder, item), destItem);
        } catch {
          // best-effort
        }
      }
    }
    try {
      await fs.rmdir(srcFolder);
    } catch {
      // Not empty (had conflicts) — leave it.
    }
  }

  const newContentEncoded = encodeImageUrlSpaces(plan.newContent);

  if (newContentEncoded !== content) {
    const finalOnDisk = new Set(await listAssetFolders(dir));
    const onDiskBefore = new Set(onDisk);
    const preExistingBroken = new Set<string>();
    for (const ref of extractReferencedFolders(decodedContent)) {
      if (!onDiskBefore.has(ref)) preExistingBroken.add(ref);
    }
    for (const ref of extractReferencedFolders(plan.newContent)) {
      if (!finalOnDisk.has(ref) && !preExistingBroken.has(ref)) {
        // Would NEWLY break a reference — abort the rewrite, leave content intact.
        void promoteFailed;
        return { healed: false };
      }
    }
    try {
      await fs.writeFile(filePath, newContentEncoded, "utf-8");
    } catch {
      return { healed: false };
    }
    return { healed: true, newContent: newContentEncoded };
  }
  return { healed: true, newContent: content };
}
