// Workspace change watcher. Drives `notifications/resources/list_changed` so
// connected agents re-read the workspace when files appear, vanish, or change.
// The desktop host injects its own (already-running) folder watcher via
// `deps.subscribeToChanges`; the standalone server uses this fs.watch fallback.

import { watch, type FSWatcher } from "node:fs";
import path from "node:path";

const WATCH_EXTENSIONS = new Set([".md", ".markdown", ".txt"]);

/** Debounce a zero-arg callback, coalescing bursts within `ms`. */
export function debounce(
  fn: () => void,
  ms: number,
): { call: () => void; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    call() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        fn();
      }, ms);
    },
    cancel() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}

/** True for filenames the workspace cares about (markdown, or a directory event). */
export function isRelevantChange(filename: string | null): boolean {
  if (!filename) return false;
  const ext = path.extname(filename).toLowerCase();
  return ext === "" || WATCH_EXTENSIONS.has(ext);
}

/**
 * Recursively watch `root`, calling `onChange` (debounced) on any relevant
 * change. Returns a disposer. fs.watch recursion is supported on Windows and
 * macOS; on Linux it falls back to a shallow watch — acceptable since the
 * desktop host injects its own watcher and the standalone fallback is
 * best-effort.
 */
export function createWorkspaceWatcher(
  root: string,
  onChange: () => void,
  debounceMs = 200,
): () => void {
  const debounced = debounce(onChange, debounceMs);
  let watcher: FSWatcher | null = null;
  try {
    watcher = watch(root, { recursive: true }, (_event, filename) => {
      if (isRelevantChange(typeof filename === "string" ? filename : null)) {
        debounced.call();
      }
    });
    watcher.on("error", () => {
      // A recursive watch error (subdir removed/renamed, EPERM, inotify limit)
      // must not crash the server. On Linux/macOS recursive watching is
      // emulated and the FSWatcher emits 'error' on these conditions; with no
      // listener Node rethrows it as an uncaught exception. Stop the broken
      // watcher and degrade to no live notifications — reads still work. Log to
      // STDERR only (stdout is the MCP JSON-RPC channel and must stay clean).
      try {
        debounced.cancel();
      } catch {
        // ignore
      }
      try {
        watcher?.close();
      } catch {
        // ignore
      }
      watcher = null;
      console.error("[pennivo-mcp] workspace watcher stopped after error");
    });
  } catch {
    // Watching may be unsupported on some filesystems; degrade silently.
  }
  return () => {
    debounced.cancel();
    watcher?.close();
    watcher = null;
  };
}
