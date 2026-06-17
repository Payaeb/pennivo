import { useCallback, useEffect, useState } from "react";
import { ConfirmDialog } from "../ConfirmDialog/ConfirmDialog";
import { getPlatform } from "../../platform";
import type { McpAuditEntry } from "../../platform/platform";
import {
  MCP_READ_TOOLS,
  MCP_WRITE_TOOLS,
  MCP_TOOL_LABELS,
  type McpSettings,
  type McpToolName,
} from "./mcpSettings";
import "./McpSection.css";

interface McpSectionProps {
  /** Initial MCP settings — caller hands us a fully-populated shape. */
  initial: McpSettings;
  /** Persist a partial update; caller merges + writes through `settings:set`. */
  onChange: (update: Partial<McpSettings>) => void;
  /** Surface a transient toast. Same channel SettingsPanel exposes. */
  onShowToast?: (message: string, isError?: boolean) => void;
}

function formatAuditTime(ts: number): string {
  try {
    return new Date(ts).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export function McpSection({
  initial,
  onChange,
  onShowToast,
}: McpSectionProps) {
  const [settings, setSettings] = useState<McpSettings>(initial);
  const [audit, setAudit] = useState<McpAuditEntry[]>([]);
  const [auditLoaded, setAuditLoaded] = useState(false);
  const [connectInfo, setConnectInfo] = useState<{
    found: boolean;
    path: string;
  } | null>(null);

  const refreshAudit = useCallback(async () => {
    try {
      const entries = await getPlatform().mcp.getAudit(50);
      setAudit(entries);
    } catch {
      setAudit([]);
    } finally {
      setAuditLoaded(true);
    }
  }, []);

  useEffect(() => {
    void refreshAudit();
  }, [refreshAudit]);

  const updateEnabled = useCallback(
    (enabled: boolean) => {
      setSettings((prev) => ({ ...prev, enabled }));
      onChange({ enabled });
    },
    [onChange],
  );

  const updateTool = useCallback(
    (tool: McpToolName, value: boolean) => {
      // Call onChange in the event handler — never inside the setSettings
      // updater (that runs during render → "setState while rendering").
      const tools = { ...settings.tools, [tool]: value };
      setSettings((prev) => ({
        ...prev,
        tools: { ...prev.tools, [tool]: value },
      }));
      onChange({ tools });
    },
    [settings.tools, onChange],
  );

  const handleConnect = useCallback(async () => {
    try {
      const result = await getPlatform().mcp.detectClaude();
      // When Claude Desktop isn't found, copy the snippet so the not-found
      // dialog's "paste it in" instruction is actionable immediately.
      if (!result.found) {
        await getPlatform().mcp.copyConfigSnippet();
      }
      // Always surface a dialog so there's clear, unmissable feedback.
      setConnectInfo({ found: result.found, path: result.path });
    } catch {
      onShowToast?.("Couldn't reach the MCP connector.", true);
    }
  }, [onShowToast]);

  const confirmWriteConfig = useCallback(async () => {
    setConnectInfo(null);
    try {
      const result = await getPlatform().mcp.writeClaudeConfig();
      if (result.ok) {
        onShowToast?.(
          "Added Pennivo to Claude Desktop — restart Claude to connect.",
        );
      } else {
        onShowToast?.(
          `Couldn't write the config${result.error ? `: ${result.error}` : "."}`,
          true,
        );
      }
    } catch {
      onShowToast?.("Couldn't write the Claude config.", true);
    }
  }, [onShowToast]);

  const copySnippet = useCallback(async () => {
    try {
      await getPlatform().mcp.copyConfigSnippet();
      onShowToast?.("MCP config snippet copied to clipboard.");
    } catch {
      onShowToast?.("Couldn't copy the config snippet.", true);
    }
  }, [onShowToast]);

  const renderToolToggle = (tool: McpToolName) => (
    <div className="settings-row" key={tool}>
      <div className="settings-label">{MCP_TOOL_LABELS[tool]}</div>
      <button
        className={`settings-toggle${settings.tools[tool] ? " settings-toggle--on" : ""}`}
        onClick={() => updateTool(tool, !settings.tools[tool])}
        role="switch"
        aria-checked={settings.tools[tool]}
        aria-label={MCP_TOOL_LABELS[tool]}
        disabled={!settings.enabled}
      >
        <span className="settings-toggle-knob" />
      </button>
    </div>
  );

  return (
    <div className="settings-section">
      <div className="settings-section-title">AI / MCP server</div>

      <p className="mcp-section-intro">
        Let AI assistants (Claude Desktop, Claude Code, Cursor) read, search,
        and edit the markdown in your sidebar folder through a built-in{" "}
        <span className="mcp-mono">Model Context Protocol</span> server. Read
        access is on by default; writing is opt-in.
      </p>

      <div className="settings-row">
        <div className="settings-label">
          Enable MCP server
          <span className="settings-label-desc">
            Master switch. When off, every tool is refused.
          </span>
        </div>
        <button
          className={`settings-toggle${settings.enabled ? " settings-toggle--on" : ""}`}
          onClick={() => updateEnabled(!settings.enabled)}
          role="switch"
          aria-checked={settings.enabled}
          aria-label="Enable MCP server"
        >
          <span className="settings-toggle-knob" />
        </button>
      </div>

      <div className="mcp-subpanel">
        <div className="mcp-subpanel-title">Reading</div>
        {MCP_READ_TOOLS.map(renderToolToggle)}
      </div>

      <div className="mcp-subpanel">
        <div className="mcp-subpanel-title">
          Writing
          <span className="mcp-optin-badge">opt-in</span>
        </div>
        <p className="mcp-subpanel-desc">
          Off by default. Enable only the write actions you want an assistant to
          perform. Deletions made through MCP are permanent — enable with care.
        </p>
        {MCP_WRITE_TOOLS.map(renderToolToggle)}
      </div>

      <div className="mcp-subpanel">
        <div className="mcp-subpanel-title">Connect</div>
        <p className="mcp-subpanel-desc">
          Add Pennivo to your AI client so it can reach this workspace.
        </p>
        <div className="mcp-button-row">
          <button
            className="mcp-button mcp-button--primary"
            onClick={handleConnect}
          >
            Connect to Claude
          </button>
          <button className="mcp-button" onClick={copySnippet}>
            Copy config
          </button>
        </div>
      </div>

      <div className="mcp-subpanel">
        <div className="mcp-subpanel-title">
          Recent activity
          <button
            className="mcp-refresh"
            onClick={() => void refreshAudit()}
            aria-label="Refresh activity"
          >
            Refresh
          </button>
        </div>
        {auditLoaded && audit.length === 0 ? (
          <p className="mcp-subpanel-desc">No MCP tool calls recorded yet.</p>
        ) : (
          <div className="mcp-audit-list">
            {audit.map((e, i) => (
              <div className="mcp-audit-row" key={`${e.ts}-${i}`}>
                <div className="mcp-audit-line1">
                  <span className="mcp-mono mcp-audit-tool">{e.tool}</span>
                  <span
                    className={`mcp-audit-outcome mcp-audit-outcome--${e.outcome}`}
                  >
                    {e.outcome}
                  </span>
                  <span className="mcp-audit-time">
                    {formatAuditTime(e.ts)}
                  </span>
                </div>
                <div className="mcp-audit-line2">
                  <span className="mcp-audit-agent">{e.agent}</span>
                  {e.path ? (
                    <span className="mcp-mono mcp-audit-path">{e.path}</span>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={connectInfo !== null}
        title={
          connectInfo?.found
            ? "Connect to Claude Desktop"
            : "Connect your MCP client"
        }
        message={
          connectInfo?.found
            ? `Add Pennivo to your Claude Desktop config at:\n${connectInfo.path}\n\nOther MCP servers are preserved. Restart Claude Desktop to use it.`
            : "Claude Desktop's config wasn't found, so the connection snippet has been copied to your clipboard. Paste it into your MCP client's config (the mcpServers section), then restart the client."
        }
        confirmLabel={connectInfo?.found ? "Add to Claude" : "Copy again"}
        cancelLabel={connectInfo?.found ? "Cancel" : "Done"}
        onConfirm={() => {
          if (connectInfo?.found) {
            void confirmWriteConfig();
          } else {
            void copySnippet();
            setConnectInfo(null);
          }
        }}
        onCancel={() => setConnectInfo(null)}
      />
    </div>
  );
}
