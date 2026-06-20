// Standalone entry point: `npx @pennivo/mcp-server --workspace <path>` (or the
// `pennivo-mcp` bin). Boots a read-only stdio MCP server over the given folder.
// Write tools land in Slice 2; `--allow` is accepted now so the flag is stable.

import path from "node:path";
import { statSync, readFileSync } from "node:fs";
import { createPennivoMcpServer } from "../server.js";
import { runStdio } from "../transports/stdio.js";
import { runHttp } from "../transports/http.js";
import {
  ALL_TOOLS,
  DEFAULT_PERMISSIONS,
  mergeAndValidate,
  staticPermissionProvider,
} from "../config.js";
import type { PermissionProvider, WorkspaceEntry } from "../deps.js";
import { JsonlAuditSink, NullAuditSink } from "../audit/auditLog.js";
import type { AuditSink } from "../audit/auditLog.js";
import { mtimeRecentSource } from "../resources/recent.js";
import { PENNIVO_MCP_VERSION } from "../version.js";

interface ParsedArgs {
  workspace?: string;
  workspacesFile?: string;
  auditLog?: string;
  settings?: string;
  allow: string[];
  http: boolean;
  port?: number;
  help: boolean;
  version: boolean;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const out: ParsedArgs = {
    allow: [],
    http: false,
    help: false,
    version: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--workspace":
      case "-w":
        out.workspace = argv[++i];
        break;
      case "--workspaces-file":
        out.workspacesFile = argv[++i];
        break;
      case "--audit-log":
        out.auditLog = argv[++i];
        break;
      case "--settings":
        out.settings = argv[++i];
        break;
      case "--allow":
        out.allow = (argv[++i] ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        break;
      case "--http":
        out.http = true;
        break;
      case "--port": {
        const n = Number(argv[++i]);
        if (Number.isInteger(n) && n >= 0 && n <= 65535) out.port = n;
        break;
      }
      case "--help":
      case "-h":
        out.help = true;
        break;
      case "--version":
      case "-v":
        out.version = true;
        break;
      default:
        // Ignore unknown args so a host can pass extras harmlessly.
        break;
    }
  }
  return out;
}

function printHelp(): void {
  process.stdout.write(
    [
      "pennivo-mcp — Model Context Protocol server for a Pennivo markdown workspace",
      "",
      "Usage:",
      "  pennivo-mcp --workspace <path> [--audit-log <file>] [--allow tool1,tool2]",
      "",
      "Options:",
      "  -w, --workspace <path>   Folder to expose (required). Or set PENNIVO_WORKSPACE.",
      "      --audit-log <file>   Append a JSONL audit log of every tool call.",
      "      --allow <tools>      Comma-separated tools to enable beyond the read-only",
      "                           default, e.g. --allow write_file,edit_file,create_folder.",
      "      --settings <file>    Read permissions live from a JSON file's `mcp` slice",
      "                           (re-read per call). Overrides --allow. Used by the app.",
      "      --workspaces-file <file>",
      "                           JSON file listing the host's open workspaces so",
      "                           `list_workspaces` reports the real multi-workspace view",
      "                           instead of synthesizing one from --workspace.",
      "      --http               Serve over loopback HTTP instead of stdio.",
      "      --port <n>           HTTP port (default: an ephemeral free port). Implies --http.",
      "  -h, --help               Show this help.",
      "  -v, --version            Print version.",
      "",
    ].join("\n"),
  );
}

/**
 * Read + validate the host's workspaces file. Returns the active id and the
 * sanitized list, or `null` if the file is missing/corrupt or has no usable
 * entries — in which case the caller leaves `deps.workspaces` undefined and the
 * tool falls back to synthesizing a single entry from `--workspace`. Malformed
 * entries (missing/non-string id/name/rootPath) are dropped, not fatal.
 */
function readWorkspacesFile(
  filePath: string,
): { activeWorkspaceId?: string; workspaces: WorkspaceEntry[] } | null {
  try {
    const raw = JSON.parse(readFileSync(filePath, "utf-8")) as unknown;
    if (typeof raw !== "object" || raw === null) return null;
    const obj = raw as Record<string, unknown>;
    if (!Array.isArray(obj.workspaces)) return null;
    const workspaces: WorkspaceEntry[] = [];
    for (const entry of obj.workspaces) {
      if (typeof entry !== "object" || entry === null) continue;
      const e = entry as Record<string, unknown>;
      if (
        typeof e.id === "string" &&
        typeof e.name === "string" &&
        typeof e.rootPath === "string"
      ) {
        workspaces.push({ id: e.id, name: e.name, rootPath: e.rootPath });
      }
    }
    if (workspaces.length === 0) return null;
    const activeWorkspaceId =
      typeof obj.activeWorkspaceId === "string"
        ? obj.activeWorkspaceId
        : undefined;
    return { activeWorkspaceId, workspaces };
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    return;
  }
  if (args.version) {
    process.stdout.write(`${PENNIVO_MCP_VERSION}\n`);
    return;
  }

  const workspace = args.workspace ?? process.env.PENNIVO_WORKSPACE;
  if (!workspace) {
    process.stderr.write(
      "Error: --workspace <path> is required (or set PENNIVO_WORKSPACE).\n",
    );
    process.exit(2);
  }

  const root = path.resolve(workspace);
  try {
    if (!statSync(root).isDirectory()) {
      throw new Error("not a directory");
    }
  } catch {
    process.stderr.write(
      `Error: workspace is not an accessible directory: ${root}\n`,
    );
    process.exit(2);
  }

  // Permissions. With --settings, read the host's settings file's `mcp` slice
  // live on every call (so a toggle in the app takes effect without a restart).
  // Otherwise, start from read-only defaults and apply --allow.
  let permissions: PermissionProvider;
  if (args.settings) {
    const settingsPath = path.resolve(args.settings);
    const readConfig = () => {
      try {
        const raw = JSON.parse(readFileSync(settingsPath, "utf-8")) as {
          mcp?: unknown;
        };
        return mergeAndValidate(raw.mcp);
      } catch {
        return mergeAndValidate(undefined); // read-only default on any error
      }
    };
    permissions = {
      isEnabled: () => readConfig().enabled,
      isAllowed: (tool) => {
        const c = readConfig();
        return c.enabled && (c.tools as Record<string, boolean>)[tool] === true;
      },
    };
  } else {
    const permissionInput = {
      enabled: true,
      tools: { ...DEFAULT_PERMISSIONS.tools },
    };
    for (const tool of args.allow) {
      if ((ALL_TOOLS as readonly string[]).includes(tool)) {
        permissionInput.tools[tool as keyof typeof permissionInput.tools] =
          true;
      } else {
        process.stderr.write(
          `Warning: unknown tool in --allow ignored: ${tool}\n`,
        );
      }
    }
    permissions = staticPermissionProvider(mergeAndValidate(permissionInput));
  }

  // The bare CLI keeps audit silent unless --audit-log is given; hosts that
  // want to surface recent calls inject an InMemoryAuditSink instead.
  const audit: AuditSink = args.auditLog
    ? new JsonlAuditSink(path.resolve(args.auditLog))
    : new NullAuditSink();

  // Optional host workspace injection. The file is re-read per call so the app
  // can keep it current as the user opens/closes workspaces. Read failures fall
  // back to undefined, so `list_workspaces` synthesizes the single --workspace
  // root instead of crashing.
  let workspaces:
    | (() => Promise<WorkspaceEntry[]>)
    | undefined;
  let activeWorkspaceId: string | undefined;
  if (args.workspacesFile) {
    const workspacesPath = path.resolve(args.workspacesFile);
    workspaces = async () => readWorkspacesFile(workspacesPath)?.workspaces ?? [];
    activeWorkspaceId = readWorkspacesFile(workspacesPath)?.activeWorkspaceId;
  }

  const deps = {
    root,
    permissions,
    audit,
    now: () => Date.now(),
    recent: mtimeRecentSource(root),
    workspaces,
    activeWorkspaceId,
  };

  if (args.http || args.port !== undefined) {
    const running = await runHttp(() => createPennivoMcpServer(deps), {
      port: args.port,
    });
    process.stderr.write(`Pennivo MCP server listening on ${running.url}\n`);
    return;
  }

  await runStdio(createPennivoMcpServer(deps));
}

main().catch((err) => {
  process.stderr.write(
    `${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
  );
  process.exit(1);
});
