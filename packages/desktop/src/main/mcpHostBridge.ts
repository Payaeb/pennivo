// MCP host control bridge — the desktop side of A4b.
//
// The Pennivo MCP server runs as a SEPARATE process spawned by the MCP client
// (Claude Desktop), not by this app. The snapshot/trash stores, however, live
// ONLY in this main process (they import electron `app`). To let the server
// expose list/restore history tools, the app runs this loopback HTTP control
// endpoint; the server calls it and we forward to the existing store functions
// verbatim (so dedupe / pre-restore-snapshot / collision handling are kept).
//
// SECURITY (see SECURITY CHECKLIST in the A4b brief):
//   - bind EXACTLY 127.0.0.1 (never 0.0.0.0), ephemeral port
//   - per-run random Bearer token required on every request (401 otherwise)
//   - DNS-rebinding guard: reject any request whose Host header is not loopback
//   - descriptor written under userData with a restrictive (0600) mode
//   - failure to start NEVER breaks app startup (callers wrap in try/catch)
//   - when the app is not running the server's fetch simply fails -> the tool
//     reports "app is not running"; standalone servers get no descriptor at all

import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { Server } from "node:http";
import { randomBytes } from "node:crypto";
import { writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { app } from "electron";
import {
  listSnapshots,
  restoreSnapshot,
  type SnapshotWithSource,
} from "./snapshotStore";
import { listTrash, restoreFromTrash, getTrashEntry } from "./trashStore";

// ---------- Pure, unit-testable helpers ----------

/**
 * Constant-time-ish Bearer check. Returns true only when the `authorization`
 * header is exactly `Bearer <token>` for the live token. We compare lengths
 * first then char-by-char without early-out to avoid a trivial timing oracle;
 * the token is 256 bits of randomness so this is belt-and-suspenders.
 */
export function isAuthorized(
  headerValue: string | undefined,
  token: string,
): boolean {
  if (!headerValue) return false;
  const prefix = "Bearer ";
  if (!headerValue.startsWith(prefix)) return false;
  const provided = headerValue.slice(prefix.length);
  if (provided.length !== token.length) return false;
  let diff = 0;
  for (let i = 0; i < token.length; i++) {
    diff |= provided.charCodeAt(i) ^ token.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * DNS-rebinding guard. The bridge only ever answers requests whose Host header
 * names loopback (with our ephemeral port or none). Anything else — including a
 * rebound attacker domain pointed at 127.0.0.1 — is rejected. Mirrors the
 * allowedHosts approach in the server's streamable-HTTP transport.
 */
export function isLoopbackHost(
  hostHeader: string | undefined,
  port: number,
): boolean {
  if (!hostHeader) return false;
  const allowed = new Set([
    `127.0.0.1:${port}`,
    `localhost:${port}`,
    "127.0.0.1",
    "localhost",
    `[::1]:${port}`,
    "[::1]",
  ]);
  return allowed.has(hostHeader.toLowerCase());
}

/**
 * True when `candidate` is the same as `root` or lives inside it. Used as the
 * pre-restore workspace boundary for /trash/restore so a trashId belonging to
 * another workspace can NEVER be materialized outside the agent's root, even
 * for a moment. Case-folds on win32 (case-insensitive filesystem); a leading
 * `..` (or an absolute relative result, which happens across Windows drive
 * letters) means the candidate escaped the root.
 */
export function isInsideRoot(root: string, candidate: string): boolean {
  if (!root || !candidate) return false;
  let nRoot = path.resolve(root).replace(/\\/g, "/");
  let nCandidate = path.resolve(candidate).replace(/\\/g, "/");
  if (process.platform === "win32") {
    nRoot = nRoot.toLowerCase();
    nCandidate = nCandidate.toLowerCase();
  }
  if (nRoot === nCandidate) return true;
  const rel = path.posix.relative(nRoot, nCandidate);
  if (rel === "") return true;
  if (rel === ".." || rel.startsWith("../") || path.posix.isAbsolute(rel)) {
    return false;
  }
  return true;
}

/**
 * Project the desktop snapshot record down to the wire shape the server's
 * SnapshotSummary expects. Drops internal fields (contentHash, device info,
 * absolutePath) the agent has no need for.
 */
export function toSnapshotSummary(s: SnapshotWithSource): {
  id: string;
  ts: number;
  sizeBytes: number;
  author: string;
  agentName?: string;
  source: string;
} {
  return {
    id: s.id,
    ts: s.ts,
    sizeBytes: s.sizeBytes,
    author: s.author,
    agentName: s.agentName,
    source: s.source,
  };
}

// ---------- Bridge lifecycle ----------

const DESCRIPTOR_FILE = "mcp-host-bridge.json";

interface BridgeState {
  server: Server;
  token: string;
  port: number;
  descriptorPath: string;
}

let state: BridgeState | null = null;
// Synchronous re-entrancy guard. `state` is only assigned inside the async
// `listen` callback, so two calls before that callback fires would both bind a
// server. This flag flips synchronously at the top of startMcpHostBridge so a
// second synchronous call is a no-op. Reset on stop.
let starting = false;

function descriptorPath(): string {
  return path.join(app.getPath("userData"), DESCRIPTOR_FILE);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(text);
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    total += buf.length;
    // Defensive cap — these payloads are tiny (a path + a few ids).
    if (total > 1_000_000) throw new Error("payload too large");
    chunks.push(buf);
  }
  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks).toString("utf-8");
  if (!raw) return {};
  return JSON.parse(raw);
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  token: string,
  port: number,
): Promise<void> {
  // DNS-rebinding guard FIRST: reject any non-loopback Host outright.
  if (!isLoopbackHost(req.headers.host, port)) {
    sendJson(res, 403, { error: "forbidden host" });
    return;
  }
  // Auth: Bearer token required on every request.
  if (!isAuthorized(req.headers.authorization, token)) {
    sendJson(res, 401, { error: "unauthorized" });
    return;
  }
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "method not allowed" });
    return;
  }

  const url = req.url ?? "/";
  let body: Record<string, unknown>;
  try {
    const parsed = await readJsonBody(req);
    body = (typeof parsed === "object" && parsed ? parsed : {}) as Record<
      string,
      unknown
    >;
  } catch {
    sendJson(res, 400, { error: "invalid json" });
    return;
  }

  try {
    switch (url) {
      case "/snapshot/list": {
        const absPath = String(body.absPath ?? "");
        if (!absPath) return sendJson(res, 400, { error: "absPath required" });
        const list = await listSnapshots(absPath);
        return sendJson(res, 200, {
          snapshots: list.map(toSnapshotSummary),
        });
      }
      case "/snapshot/restore": {
        const absPath = String(body.absPath ?? "");
        const snapshotId = String(body.snapshotId ?? "");
        const mode = body.mode === "overwrite" ? "overwrite" : "as-new-file";
        if (!absPath || !snapshotId) {
          return sendJson(res, 400, {
            error: "absPath and snapshotId required",
          });
        }
        const result = await restoreSnapshot(absPath, { snapshotId, mode });
        if (!result) {
          return sendJson(res, 200, { error: "snapshot not found" });
        }
        return sendJson(res, 200, { newPath: result.newPath });
      }
      case "/trash/list": {
        const entries = await listTrash();
        return sendJson(res, 200, {
          entries: entries.map((e) => ({
            trashId: e.id,
            originalPath: e.absolutePath,
            deletedAtMs: e.deletedAtMs,
            expiresAtMs: e.expiresAtMs,
          })),
        });
      }
      case "/trash/restore": {
        const trashId = String(body.trashId ?? "");
        if (!trashId) return sendJson(res, 400, { error: "trashId required" });
        const rootPath = String(body.rootPath ?? "");
        if (!rootPath) {
          return sendJson(res, 400, { error: "rootPath required" });
        }
        // Workspace boundary BEFORE any write. Look up the entry's original
        // absolutePath and refuse to restore if it falls outside the caller's
        // workspace root. This closes the confused-deputy gap where a trashId
        // from another workspace would otherwise be materialized on disk first
        // and only rejected afterwards by the tool layer.
        try {
          const entry = await getTrashEntry(trashId);
          if (!entry) {
            return sendJson(res, 200, { error: "trash entry not found" });
          }
          if (!isInsideRoot(rootPath, entry.absolutePath)) {
            return sendJson(res, 200, { error: "outside workspace" });
          }
          const result = await restoreFromTrash(trashId);
          return sendJson(res, 200, { newPath: result.restoredPath });
        } catch (err) {
          return sendJson(res, 200, {
            error: err instanceof Error ? err.message : "restore failed",
          });
        }
      }
      default:
        return sendJson(res, 404, { error: "not found" });
    }
  } catch (err) {
    console.error(`[mcpHostBridge] ${url} failed:`, err);
    sendJson(res, 500, {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Start the loopback control bridge. Idempotent: a second call is a no-op while
 * one is running. Generates a fresh token, binds 127.0.0.1 on an ephemeral
 * port, and writes the descriptor file so the spawned server can find it. Wrap
 * the call site in try/catch — a thrown error here must NOT abort app startup;
 * if the bridge fails the history tools simply degrade to "app not running".
 */
export function startMcpHostBridge(): void {
  if (state || starting) return;
  // Set the synchronous guard BEFORE any async work so a second call that races
  // in before the `listen` callback assigns `state` is a clean no-op.
  starting = true;

  const token = randomBytes(32).toString("hex");
  const server = createServer((req, res) => {
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    void handle(req, res, token, port).catch((err) => {
      if (!res.headersSent) {
        sendJson(res, 500, {
          error: err instanceof Error ? err.message : String(err),
        });
      } else {
        res.end();
      }
    });
  });

  server.on("error", (err) => {
    console.error("[mcpHostBridge] server error:", err);
    // A bind failure means `state` will never be assigned; clear the guard so a
    // later call can retry rather than being wedged as a permanent no-op.
    if (!state) starting = false;
  });

  // Bind EXACTLY 127.0.0.1 (never 0.0.0.0) on an ephemeral port.
  server.listen(0, "127.0.0.1", () => {
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    const dPath = descriptorPath();
    try {
      // Restrictive mode (owner read/write only). On Windows the mode is
      // advisory but the file already lives under the per-user userData dir.
      writeFileSync(
        dPath,
        JSON.stringify({ url: `http://127.0.0.1:${port}`, token }, null, 2),
        { encoding: "utf-8", mode: 0o600 },
      );
    } catch (err) {
      console.error("[mcpHostBridge] failed to write descriptor:", err);
    }
    state = { server, token, port, descriptorPath: dPath };
    starting = false;
    console.log(`[mcpHostBridge] listening on 127.0.0.1:${port}`);
  });
}

/**
 * Stop the bridge and best-effort delete the descriptor. Safe to call when the
 * bridge never started.
 */
export function stopMcpHostBridge(): void {
  const current = state;
  state = null;
  starting = false;
  if (!current) {
    // Even if we never recorded state, try to clear any stale descriptor.
    try {
      rmSync(descriptorPath(), { force: true });
    } catch {
      // ignore
    }
    return;
  }
  try {
    current.server.close();
  } catch (err) {
    console.error("[mcpHostBridge] close failed:", err);
  }
  try {
    rmSync(current.descriptorPath, { force: true });
  } catch (err) {
    console.error("[mcpHostBridge] descriptor cleanup failed:", err);
  }
}

/** Test/inspection helper: the live descriptor path. */
export function mcpHostBridgeDescriptorPath(): string {
  return descriptorPath();
}
