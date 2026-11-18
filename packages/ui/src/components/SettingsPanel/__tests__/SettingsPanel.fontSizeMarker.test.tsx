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

describe("font size migration marker in Settings", () => {
  it("shows the migrated 17 and keeps the marker when saving", async () => {
    stored = { editorFontSize: 17, fontSizeDefaultMigrated: true };
    render(
      <SettingsPanel
        visible
        onClose={() => {}}
        typewriterMode={false}
        onTypewriterModeChange={() => {}}
      />,
    );
    await screen.findByLabelText("Editor width");
    const slider = document.querySelector(
      "input.settings-slider",
    ) as HTMLInputElement;
    await waitFor(() => expect(slider.value).toBe("17"));
    fireEvent.change(slider, { target: { value: "16" } });
    await waitFor(() =>
      expect(mockPlatform.setSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          editorFontSize: 16,
          fontSizeDefaultMigrated: true,
        }),
      ),
    );
  });
});
