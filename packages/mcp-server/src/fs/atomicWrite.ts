// Atomic-ish file write shared by every write tool: stage the content in a
// temp file in the same directory, then rename it over the target so a reader
// never sees a half-written file. Cleans up the temp file if the rename fails.
// Extracted so the edit tools (and later streaming) reuse the exact behavior.

import { promises as fs } from "node:fs";
import path from "node:path";

/** Atomic-ish write: temp file in the same dir, then rename over the target. */
export async function writeFileAtomic(
  abs: string,
  content: string,
): Promise<void> {
  await fs.mkdir(path.dirname(abs), { recursive: true });
  const tmp = `${abs}.pennivo-tmp-${process.pid}`;
  await fs.writeFile(tmp, content, "utf-8");
  try {
    await fs.rename(tmp, abs);
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}
