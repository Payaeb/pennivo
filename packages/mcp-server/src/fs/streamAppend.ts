// Shared append-one-chunk primitive behind both the `stream_into_file` tool and
// the `pennivo --stream` CLI. Both surfaces must apply the exact same path
// safety boundary, markdown gate, create-if-absent behavior, and image-url
// encoding, so that logic lives here once. The CLI calls this per stdin chunk
// (progressive growth the file watcher can see); the tool calls it per request.

import { promises as fs } from "node:fs";
import { encodeImageUrlSpaces } from "@pennivo/core";
import { resolveInWorkspace, toWorkspaceRelative } from "./pathSafety.js";
import { isMarkdown } from "./workspaceFs.js";
import { writeFileAtomic } from "./atomicWrite.js";

export interface AppendChunkResult {
  /** Workspace-relative path of the target file (forward slashes). */
  path: string;
  /** Byte length of the encoded chunk that was appended. */
  bytesAppended: number;
}

export class AppendChunkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AppendChunkError";
  }
}

/**
 * Resolve `relOrAbs` inside `root`, ensure it is a markdown file, create it
 * (empty) if it does not yet exist, then append `chunk` to its end with image
 * URL spaces encoded to the editor's on-disk %20 form. Returns the
 * workspace-relative path and the number of bytes appended. Throws
 * `AppendChunkError` for a non-markdown target; path-safety violations surface
 * as the usual `WorkspacePathError` from `resolveInWorkspace`.
 */
export async function appendChunk(
  root: string,
  relOrAbs: string,
  chunk: string,
): Promise<AppendChunkResult> {
  const abs = resolveInWorkspace(root, relOrAbs, { followSymlinks: true });
  if (!isMarkdown(abs)) {
    throw new AppendChunkError(`Not a markdown file: ${relOrAbs}`);
  }

  // Create the file (empty) if absent, mirroring create_file's atomic write so
  // a reader never sees a half-written file, then append the chunk.
  let present = true;
  try {
    await fs.access(abs);
  } catch {
    present = false;
  }
  if (!present) {
    await writeFileAtomic(abs, "");
  }

  const encoded = encodeImageUrlSpaces(chunk);
  await fs.appendFile(abs, encoded, "utf-8");
  return {
    path: toWorkspaceRelative(root, abs),
    bytesAppended: Buffer.byteLength(encoded),
  };
}
