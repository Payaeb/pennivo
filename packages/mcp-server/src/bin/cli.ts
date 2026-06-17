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
import type { PermissionProvider } from "../deps.js";
import { JsonlAuditSink, NullAuditSink } from "../audit/auditLog.js";
import type { AuditSink } from "../audit/auditLog.js";
import { mtimeRecentSource } from "../resources/recent.js";
import { PENNIVO_MCP_VERSION } from "../version.js";

interface ParsedArgs {
  workspace?: string;
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
      "                           default, e.g. --allow write_file,create_file,rename_file.",
      "      --settings <file>    Read permissions live from a JSON file's `mcp` slice",
      "                           (re-read per call). Overrides --allow. Used by the app.",
      "      --http               Serve over loopback HTTP instead of stdio.",
      "      --port <n>           HTTP port (default: an ephemeral free port). Implies --http.",
      "  -h, --help               Show this help.",
      "  -v, --version            Print version.",
      "",
    ].join("\n"),
  );
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

  const deps = {
    root,
    permissions,
    audit,
    now: () => Date.now(),
    recent: mtimeRecentSource(root),
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
