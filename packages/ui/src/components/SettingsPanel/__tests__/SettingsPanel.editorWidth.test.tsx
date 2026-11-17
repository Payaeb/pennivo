import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SettingsPanel } from "../SettingsPanel";

vi.mock("../../../platform", () => ({
  getPlatform: () => mockPlatform,
}));

let stored: Record<string, unknown>;
let mockPlatform: {
  getSettings: ReturnType<typeof vi.fn>;
  setSettings: ReturnType<typeof vi.fn>;
  setSpellCheckLanguages: ReturnType<typeof vi.fn>;
  mcp: Record<string, unknown>;
};

beforeEach(() => {
  stored = {};
  mockPlatform = {
    getSettings: vi.fn(async () => stored),
    setSettings: vi.fn(async (s: Record<string, unknown>) => {
      stored = s;
    }),
    setSpellCheckLanguages: vi.fn(),
    mcp: {
      getAudit: vi.fn(async () => []),
      detectClaude: vi.fn(async () => ({
        found: false,
        path: "",
        snippet: "",
      })),
    },
  };
});

function renderPanel() {
  const onChange = vi.fn();
  render(
    <SettingsPanel
      visible
      onClose={() => {}}
      typewriterMode={false}
      onTypewriterModeChange={() => {}}
      onChange={onChange}
    />,
  );
  return onChange;
}

async function getControl(): Promise<HTMLSelectElement> {
  const el = (await screen.findByLabelText(
    "Editor width",
  )) as HTMLSelectElement;
  await waitFor(() => expect(mockPlatform.getSettings).toHaveBeenCalled());
  return el;
}

describe("Editor width setting", () => {
  it("renders the four presets with Default selected", async () => {
    renderPanel();
    const select = await getControl();
    const labels = Array.from(select.options).map((o) => o.textContent);
    expect(labels).toEqual(["Narrow", "Default", "Wide", "Full"]);
    expect(select.value).toBe("default");
    expect(select.tagName).toBe("SELECT");
  });

  it("is a native select, so it is keyboard operable and labelled", async () => {
    renderPanel();
    const select = await getControl();
    expect(select).toHaveAttribute("aria-label", "Editor width");
    select.focus();
    expect(document.activeElement).toBe(select);
  });

  it("changing the value persists and notifies", async () => {
    const onChange = renderPanel();
    const select = await getControl();
    fireEvent.change(select, { target: { value: "wide" } });
    await waitFor(() =>
      expect(mockPlatform.setSettings).toHaveBeenCalledWith(
        expect.objectContaining({ editorWidth: "wide" }),
      ),
    );
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ editorWidth: "wide" }),
    );
    expect(select.value).toBe("wide");
  });

  it("shows the stored preset on open", async () => {
    stored = { editorWidth: "full" };
    renderPanel();
    const select = await getControl();
    await waitFor(() => expect(select.value).toBe("full"));
  });

  it("falls back to Default for a corrupt stored value", async () => {
    stored = { editorWidth: "ludicrous" };
    renderPanel();
    const select = await getControl();
    await waitFor(() => expect(mockPlatform.getSettings).toHaveBeenCalled());
    expect(select.value).toBe("default");
  });
});
