// "Connect to Claude" helpers: detect the Claude Desktop config file, generate
// the Pennivo MCP server entry, and merge it in without clobbering other
// servers. The JSON-shaping is the package's pure `mergeServerIntoConfig`; this
// module owns path detection + fs + clipboard.
//
// The server runs the installed Pennivo binary AS NODE (ELECTRON_RUN_AS_NODE)
// against the bundled standalone server (`dist/mcp/server.js`). Running as Node
// is required because Electron's GUI main process doesn't receive piped stdin
// on Windows. Permissions are read live from the app's settings.json via
// `--settings`, and every call is logged to `mcp-audit.jsonl` for the
// Settings → MCP activity view.

import path from "node:path";
import { app, clipboard } from "electron";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import {
  buildConfigSnippet,
  mergeServerIntoConfig,
  type McpServerDefinition,
} from "@pennivo/mcp-server/embed";

const SERVER_NAME = "pennivo";

/**
 * The Microsoft Store (MSIX) build of Claude Desktop is sandboxed and reads its
 * config from a virtualized AppData path under its package, NOT the real
 * %APPDATA%\Claude. If that package exists, target it — otherwise the config we
 * write is silently ignored. Returns the package config path or null.
 */
function storeClaudeConfigPath(): string | null {
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) return null;
  const packagesDir = path.join(localAppData, "Packages");
  try {
    for (const name of readdirSync(packagesDir)) {
      if (!name.startsWith("Claude")) continue;
      const claudeDir = path.join(
        packagesDir,
        name,
        "LocalCache",
        "Roaming",
        "Claude",
      );
      if (existsSync(claudeDir)) {
        return path.join(claudeDir, "claude_desktop_config.json");
      }
    }
  } catch {
    // No Packages dir / not Windows / unreadable — fall back below.
  }
  return null;
}

function readSidebarFolder(): string | null {
  try {
    return JSON.parse(
      readFileSync(
        path.join(app.getPath("userData"), "sidebar-folder.json"),
        "utf-8",
      ),
    ) as string | null;
  } catch {
    return null;
  }
}

function serverScriptPath(): string {
  // dist/mcp/server.js sits under the app path in both dev (packages/desktop)
  // and prod (app.asar).
  return path.join(app.getAppPath(), "dist", "mcp", "server.js");
}

/** How a client should launch the Pennivo MCP server: the installed binary run
 * as Node against the bundled server, pointed at the current workspace, reading
 * permissions live from settings.json and logging to the audit file. */
export function pennivoServerDefinition(): McpServerDefinition {
  const userData = app.getPath("userData");
  const args = [
    serverScriptPath(),
    "--settings",
    path.join(userData, "settings.json"),
    "--audit-log",
    path.join(userData, "mcp-audit.jsonl"),
  ];
  const folder = readSidebarFolder();
  if (folder) {
    args.push("--workspace", folder);
  }
  return {
    command: app.getPath("exe"),
    args,
    env: { ELECTRON_RUN_AS_NODE: "1" },
  };
}

/** Claude Desktop config path. Prefers the sandboxed Microsoft Store location
 * when that build is installed; otherwise the standard %APPDATA%\Claude
 * (Windows) / Application Support / .config location. */
export function claudeDesktopConfigPath(): string {
  return (
    storeClaudeConfigPath() ??
    path.join(app.getPath("appData"), "Claude", "claude_desktop_config.json")
  );
}

export function configSnippet(): string {
  return buildConfigSnippet(SERVER_NAME, pennivoServerDefinition());
}

export function detectClaude(): {
  found: boolean;
  path: string;
  snippet: string;
} {
  const configPath = claudeDesktopConfigPath();
  return {
    found: existsSync(configPath),
    path: configPath,
    snippet: configSnippet(),
  };
}

export function writeClaudeConfig(): {
  ok: boolean;
  path: string;
  error?: string;
} {
  const configPath = claudeDesktopConfigPath();
  try {
    let existing: unknown = {};
    try {
      existing = JSON.parse(readFileSync(configPath, "utf-8"));
    } catch {
      existing = {};
    }
    const merged = mergeServerIntoConfig(
      existing,
      SERVER_NAME,
      pennivoServerDefinition(),
    );
    mkdirSync(path.dirname(configPath), { recursive: true });
    writeFileSync(configPath, JSON.stringify(merged, null, 2), "utf-8");
    return { ok: true, path: configPath };
  } catch (err) {
    return {
      ok: false,
      path: configPath,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function copyConfigSnippet(): string {
  const snippet = configSnippet();
  clipboard.writeText(snippet);
  return snippet;
}
