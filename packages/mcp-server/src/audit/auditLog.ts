// Audit log data layer. The server only *emits* events through an injected
// sink; the host decides where they go. Paths recorded here are always
// workspace-relative — never absolute — so the log can't leak the user's
// directory layout.

import { appendFileSync } from "node:fs";

export type AuditOutcome = "ok" | "error" | "denied";

export interface AuditEvent {
  /** Wall-clock ms when the call resolved. */
  ts: number;
  /** Client name from the MCP initialize handshake (or "unknown"). */
  agent: string;
  /** Tool name, or `resource:<name>` for resource reads. */
  tool: string;
  /** Workspace-relative path the call touched, if any. */
  path?: string;
  outcome: AuditOutcome;
  /** Short error/denial detail. */
  detail?: string;
}

export interface AuditSink {
  record(event: AuditEvent): void;
  /** Most recent events, newest first, capped at `limit`. */
  recent(limit: number): AuditEvent[];
}

/** Fixed-size ring buffer. Used in tests and as the live in-memory mirror. */
export class InMemoryAuditSink implements AuditSink {
  private buffer: AuditEvent[] = [];

  constructor(private readonly cap = 500) {}

  record(event: AuditEvent): void {
    this.buffer.push(event);
    const overflow = this.buffer.length - this.cap;
    if (overflow > 0) {
      this.buffer.splice(0, overflow);
    }
  }

  recent(limit: number): AuditEvent[] {
    if (limit <= 0) return [];
    return this.buffer.slice(-limit).reverse();
  }
}

/** Appends one JSON line per event; mirrors into memory for `recent()`. */
export class JsonlAuditSink implements AuditSink {
  private readonly mirror: InMemoryAuditSink;

  constructor(
    private readonly filePath: string,
    cap = 500,
  ) {
    this.mirror = new InMemoryAuditSink(cap);
  }

  record(event: AuditEvent): void {
    this.mirror.record(event);
    try {
      appendFileSync(this.filePath, JSON.stringify(event) + "\n");
    } catch {
      // Audit logging must never break a tool call. Drop on write failure.
    }
  }

  recent(limit: number): AuditEvent[] {
    return this.mirror.recent(limit);
  }
}

/** Discards everything. Default for the standalone CLI unless --audit-log is set. */
export class NullAuditSink implements AuditSink {
  record(): void {}
  recent(): AuditEvent[] {
    return [];
  }
}
