import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { McpSection } from "../McpSection";
import { defaultMcpSettings, type McpSettings } from "../mcpSettings";

vi.mock("../../../platform", () => ({
  getPlatform: () => mockPlatform,
}));

let mockPlatform: {
  mcp: {
    getAudit: ReturnType<typeof vi.fn>;
    detectClaude: ReturnType<typeof vi.fn>;
    writeClaudeConfig: ReturnType<typeof vi.fn>;
    copyConfigSnippet: ReturnType<typeof vi.fn>;
  };
};

beforeEach(() => {
  mockPlatform = {
    mcp: {
      getAudit: vi.fn(async () => []),
      detectClaude: vi.fn(async () => ({
        found: false,
        path: "",
        snippet: "{}",
      })),
      writeClaudeConfig: vi.fn(async () => ({ ok: true, path: "/cfg" })),
      copyConfigSnippet: vi.fn(async () => "{}"),
    },
  };
});

function renderSection(initial: McpSettings = defaultMcpSettings()) {
  const onChange = vi.fn();
  const onShowToast = vi.fn();
  const utils = render(
    <McpSection
      initial={initial}
      onChange={onChange}
      onShowToast={onShowToast}
    />,
  );
  return { ...utils, onChange, onShowToast };
}

describe("McpSection", () => {
  it("renders read tools on and write tools off by default", () => {
    renderSection();
    expect(screen.getByRole("switch", { name: "Read file" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("switch", { name: "Write file" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("toggling a write tool emits a tools patch", () => {
    const { onChange } = renderSection();
    fireEvent.click(screen.getByRole("switch", { name: "Write file" }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: expect.objectContaining({ write_file: true }),
      }),
    );
  });

  it("toggling the master switch emits enabled:false and disables tool toggles", () => {
    const { onChange } = renderSection();
    fireEvent.click(screen.getByRole("switch", { name: "Enable MCP server" }));
    expect(onChange).toHaveBeenCalledWith({ enabled: false });
    expect(screen.getByRole("switch", { name: "Read file" })).toBeDisabled();
  });

  it("copies the config snippet and toasts", async () => {
    const { onShowToast } = renderSection();
    fireEvent.click(screen.getByRole("button", { name: "Copy config" }));
    await waitFor(() =>
      expect(mockPlatform.mcp.copyConfigSnippet).toHaveBeenCalled(),
    );
    expect(onShowToast).toHaveBeenCalled();
  });

  it("Connect opens a setup dialog and creates config when none is detected", async () => {
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: "Connect to Claude" }));
    await waitFor(() =>
      expect(screen.getByText("Set up Claude Desktop")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Create config" }));
    await waitFor(() =>
      expect(mockPlatform.mcp.writeClaudeConfig).toHaveBeenCalled(),
    );
  });

  it("Connect opens a confirm dialog and writes config when Claude is detected", async () => {
    mockPlatform.mcp.detectClaude = vi.fn(async () => ({
      found: true,
      path: "/Users/me/Claude/claude_desktop_config.json",
      snippet: "{}",
    }));
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: "Connect to Claude" }));
    await waitFor(() =>
      expect(screen.getByText("Connect to Claude Desktop")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Add to Claude" }));
    await waitFor(() =>
      expect(mockPlatform.mcp.writeClaudeConfig).toHaveBeenCalled(),
    );
  });

  it("renders recent audit activity", async () => {
    mockPlatform.mcp.getAudit = vi.fn(async () => [
      {
        ts: 1_700_000_000_000,
        agent: "claude",
        tool: "read_file",
        path: "notes.md",
        outcome: "ok",
      },
      {
        ts: 1_700_000_000_001,
        agent: "claude",
        tool: "write_file",
        path: "x.md",
        outcome: "denied",
      },
    ]);
    renderSection();
    await waitFor(() =>
      expect(screen.getByText("read_file")).toBeInTheDocument(),
    );
    expect(screen.getByText("write_file")).toBeInTheDocument();
    expect(screen.getByText("denied")).toBeInTheDocument();
  });

  it("shows an empty state when there is no activity", async () => {
    renderSection();
    await waitFor(() =>
      expect(
        screen.getByText("No MCP tool calls recorded yet."),
      ).toBeInTheDocument(),
    );
  });
});
