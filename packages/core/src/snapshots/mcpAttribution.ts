// MCP write attribution — pure correlation between the out-of-process MCP
// server's audit log and a snapshot captured on the next file open.
//
// When an MCP agent writes a file through the server, the Pennivo app only
// notices on the next OPEN, as an `external` snapshot. The agent identity is
// gone by then. But the server records every write to mcp-audit.jsonl as a
// JSONL line { ts, agent, tool, path (workspace-relative), outcome }. This
// module correlates: given the recent audit events and the just-opened file's
// workspace-relative path, find the agent of the most recent successful write
// to that path inside a recency window.
//
// Framework-free: no fs, no Node, no DOM. The host tails the file and hands
// the parsed events in. Unit-testable in isolation.

import { normalizeAbsolutePath } from "./path";

/**
 * One line of the MCP server's audit log. Mirrors the server's `AuditEvent`
 * shape (packages/mcp-server/src/audit/auditLog.ts). `path` is always
 * workspace-relative (forward slashes, drive letter lowercased) and present
 * only for path-touching calls.
 */
export interface McpAuditEvent {
  /** Wall-clock ms when the call resolved. */
  ts: number;
  /** Client name from the MCP initialize handshake (or "unknown"). */
  agent: string;
  /** Tool name, or `resource:<name>` for resource reads. */
  tool: string;
  /** Workspace-relative path the call touched, if any. */
  path?: string;
  /** "ok" | "error" | "denied" — we only correlate on "ok". */
  outcome: string;
}

/**
 * MCP tool names that write file content. Only writes are correlated to a
 * snapshot — reads / lists / searches never produced the on-disk change we
 * are attributing. Kept here (not in the host) so the rule travels with the
 * pure matcher and stays test-covered.
 */
export const MCP_WRITE_TOOLS: ReadonlySet<string> = new Set([
  "write_file",
  "create_file",
  "append_to_file",
  "rename_file",
  "edit_file",
  "replace_in_file",
  "stream_into_file",
  "restore_snapshot",
  "restore_from_trash",
]);

/**
 * Normalize a workspace-relative path for comparison against an audit event's
 * `path`. The server emits paths via `toWorkspaceRelative`, which forward-
 * slashes and lowercases a leading drive letter but does NOT lowercase the
 * rest. Windows is case-insensitive beyond the drive letter, so we lowercase
 * the whole thing here for a robust compare; on POSIX the same fold only ever
 * widens a match within the same workspace and never crosses files in
 * practice (an agent and the opener resolve the identical path).
 */
function normalizeRelForCompare(rel: string): string {
  // Reuse the absolute-path normalizer for slash/drive folding, then drop any
  // leading "./" the audit may emit for the workspace root itself.
  let p = normalizeAbsolutePath(rel);
  if (p.startsWith("./")) p = p.slice(2);
  return p.toLowerCase();
}

export interface McpWriteMatch {
  agentName: string;
}

/**
 * Scan audit `events` (any order) for the most recent successful MCP write to
 * `relPath` within the recency window `[nowMs - sinceMs, nowMs]`, and return
 * the writing agent. Pure: no I/O, never throws.
 *
 * A candidate event must satisfy ALL of:
 *   - outcome === "ok"
 *   - tool is in `writeTools` (defaults to MCP_WRITE_TOOLS)
 *   - path, normalized, equals `relPath` normalized
 *   - ts >= nowMs - sinceMs (and not in the future relative to nowMs)
 *
 * The most recent (highest `ts`) qualifying event wins. Returns its agent, or
 * null when nothing matches.
 */
export function matchMcpWrite(
  events: McpAuditEvent[],
  relPath: string,
  sinceMs: number,
  nowMs: number,
  writeTools: ReadonlySet<string> = MCP_WRITE_TOOLS,
): McpWriteMatch | null {
  const target = normalizeRelForCompare(relPath);
  const floor = nowMs - sinceMs;

  let best: McpAuditEvent | null = null;
  for (const ev of events) {
    if (!ev || ev.outcome !== "ok") continue;
    if (typeof ev.ts !== "number" || ev.ts < floor || ev.ts > nowMs) continue;
    if (!writeTools.has(ev.tool)) continue;
    if (typeof ev.path !== "string") continue;
    if (normalizeRelForCompare(ev.path) !== target) continue;
    if (best === null || ev.ts > best.ts) best = ev;
  }

  if (!best) return null;
  return { agentName: best.agent };
}

/**
 * Parse raw JSONL audit-log text (typically a bounded tail of the file) into
 * `McpAuditEvent[]`. Malformed / partial lines are skipped silently — a tail
 * read can begin mid-line, and a crashed writer can leave a truncated last
 * line. Only objects carrying a numeric `ts`, string `agent`, string `tool`,
 * and string `outcome` are kept. Pure: no I/O, never throws.
 */
export function parseAuditLines(text: string): McpAuditEvent[] {
  const out: McpAuditEvent[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof parsed !== "object" || parsed === null) continue;
    const o = parsed as Record<string, unknown>;
    if (
      typeof o.ts !== "number" ||
      typeof o.agent !== "string" ||
      typeof o.tool !== "string" ||
      typeof o.outcome !== "string"
    ) {
      continue;
    }
    const ev: McpAuditEvent = {
      ts: o.ts,
      agent: o.agent,
      tool: o.tool,
      outcome: o.outcome,
    };
    if (typeof o.path === "string") ev.path = o.path;
    out.push(ev);
  }
  return out;
}
