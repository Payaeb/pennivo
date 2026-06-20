// Thin fetch client for the Pennivo desktop loopback control bridge.
//
// The desktop app writes a descriptor file `${userData}/mcp-host-bridge.json`
// = { url, token } when it starts the bridge. The spawned MCP server reads it
// (via `--host-bridge-file`) and POSTs JSON + a Bearer token to the bridge's
// endpoints. The bridge in turn calls the desktop's snapshot/trash stores.
//
// Every method THROWS on a transport failure (app not running, port changed,
// stale descriptor, non-200). The tool layer catches that and reports a clean
// "app is not running" result. This module never imports electron or the
// desktop package — it only speaks HTTP to the loopback bridge.

import { readFileSync } from "node:fs";
import type {
  SnapshotHost,
  TrashHost,
  SnapshotSummary,
  TrashEntrySummary,
} from "../deps.js";

interface BridgeDescriptor {
  url: string;
  token: string;
}

/**
 * Read + parse the bridge descriptor. Returns null when the file is missing,
 * unreadable, corrupt, or missing the `url`/`token` fields — in which case the
 * caller leaves `deps.snapshots`/`deps.trash` undefined and the history tools
 * are omitted entirely.
 */
export function readBridgeDescriptor(
  filePath: string,
): BridgeDescriptor | null {
  try {
    const raw = JSON.parse(readFileSync(filePath, "utf-8")) as unknown;
    if (typeof raw !== "object" || raw === null) return null;
    const obj = raw as Record<string, unknown>;
    if (typeof obj.url !== "string" || typeof obj.token !== "string") {
      return null;
    }
    if (obj.url.length === 0 || obj.token.length === 0) return null;
    return { url: obj.url, token: obj.token };
  } catch {
    return null;
  }
}

/**
 * POST a JSON body to one bridge endpoint and return the parsed JSON response.
 * Re-reads the descriptor file each call so a restart of the desktop app (new
 * port/token) is picked up without restarting the server. Throws on any
 * network error, a missing/corrupt descriptor, or a non-200 response.
 */
async function bridgePost<T>(
  descriptorPath: string,
  endpoint: string,
  body: unknown,
): Promise<T> {
  const desc = readBridgeDescriptor(descriptorPath);
  if (!desc) {
    throw new Error("Pennivo host bridge descriptor is unavailable.");
  }
  const res = await fetch(`${desc.url}${endpoint}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${desc.token}`,
    },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) {
    throw new Error(`Pennivo host bridge returned ${res.status}.`);
  }
  return (await res.json()) as T;
}

/**
 * Build the snapshot + trash host clients for a given descriptor path. The
 * descriptor is re-read per call so we never cache a stale port/token. Returns
 * a pair of capability objects ready to drop into `ServerDeps`.
 */
export function createBridgeHosts(descriptorPath: string): {
  snapshots: SnapshotHost;
  trash: TrashHost;
} {
  const snapshots: SnapshotHost = {
    async list(absPath) {
      const out = await bridgePost<{ snapshots: SnapshotSummary[] }>(
        descriptorPath,
        "/snapshot/list",
        { absPath },
      );
      return out.snapshots ?? [];
    },
    async restore(absPath, snapshotId, mode) {
      return bridgePost<{ newPath: string } | { error: string }>(
        descriptorPath,
        "/snapshot/restore",
        { absPath, snapshotId, mode },
      );
    },
  };

  const trash: TrashHost = {
    async list() {
      const out = await bridgePost<{ entries: TrashEntrySummary[] }>(
        descriptorPath,
        "/trash/list",
        {},
      );
      return out.entries ?? [];
    },
    async restore(trashId, rootPath) {
      // Send the workspace root so the bridge can enforce the boundary BEFORE
      // it writes the file back to disk (pre-move confused-deputy guard).
      return bridgePost<{ newPath: string } | { error: string }>(
        descriptorPath,
        "/trash/restore",
        { trashId, rootPath },
      );
    },
  };

  return { snapshots, trash };
}
