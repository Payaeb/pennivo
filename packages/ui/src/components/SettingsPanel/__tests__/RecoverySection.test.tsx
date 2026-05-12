import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { defaultRecoverySettings, type RecoverySettings } from "@pennivo/core";

vi.mock("../../../platform", () => ({
  getPlatform: () => mockPlatform,
}));

let mockPlatform: {
  snapshot: {
    getStorageUsage: ReturnType<typeof vi.fn>;
    openFolder: ReturnType<typeof vi.fn>;
    clearAll: ReturnType<typeof vi.fn>;
  };
  openFolderDialog: ReturnType<typeof vi.fn>;
};

import { RecoverySection } from "../RecoverySection";

beforeEach(() => {
  mockPlatform = {
    snapshot: {
      getStorageUsage: vi.fn(async () => ({ bytes: 127 * 1024 * 1024 })),
      openFolder: vi.fn(async () => true),
      clearAll: vi.fn(async () => true),
    },
    openFolderDialog: vi.fn(async () => "/Users/me/OneDrive/Pennivo"),
  };
});

function renderSection(initial: RecoverySettings = defaultRecoverySettings()) {
  const onChange = vi.fn();
  const onShowToast = vi.fn();
  const utils = render(
    <RecoverySection
      initial={initial}
      onChange={onChange}
      onShowToast={onShowToast}
    />,
  );
  return { ...utils, onChange, onShowToast };
}

describe("RecoverySection", () => {
  it("renders the snapshot toggle, retention table, storage select, trash retention, device name", () => {
    renderSection();
    expect(screen.getByText("Recovery")).toBeInTheDocument();
    expect(
      screen.getByRole("switch", { name: /Snapshot history/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("Retention tiers")).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: /Maximum storage/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: /Trash retention/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: /Device name/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Open snapshot folder/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Clear all snapshots/i }),
    ).toBeInTheDocument();
  });

  it("toggling Snapshot history calls onChange with the new value", () => {
    const { onChange } = renderSection();
    fireEvent.click(screen.getByRole("switch", { name: /Snapshot history/i }));
    expect(onChange).toHaveBeenCalledWith({ enabled: false });
  });

  it("changing a retention tier granularity emits a partial update", () => {
    const { onChange } = renderSection();
    const selects = screen.getAllByRole("combobox", {
      name: /Granularity for tier/i,
    });
    expect(selects.length).toBeGreaterThan(0);
    fireEvent.change(selects[0], { target: { value: "off" } });
    expect(onChange).toHaveBeenCalled();
    const lastCall = onChange.mock.calls.at(-1)![0];
    expect(lastCall.retentionPolicy.tiers[0].granularity).toBe("off");
  });

  it("'+ Add tier' opens the inline form and adding produces a new tier", () => {
    const { onChange } = renderSection();
    fireEvent.click(screen.getByRole("button", { name: "+ Add tier" }));
    const countInput = screen.getByRole("spinbutton", {
      name: /Tier max-age count/i,
    });
    fireEvent.change(countInput, { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    const lastCall = onChange.mock.calls.at(-1)![0];
    expect(lastCall.retentionPolicy.tiers.length).toBeGreaterThan(
      defaultRecoverySettings().retentionPolicy.tiers.length,
    );
  });

  it("hover-only Remove buttons exist for each tier and remove on click", () => {
    const { onChange } = renderSection();
    const removes = screen.getAllByRole("button", { name: /Remove tier/i });
    const before = defaultRecoverySettings().retentionPolicy.tiers.length;
    fireEvent.click(removes[0]);
    const lastCall = onChange.mock.calls.at(-1)![0];
    expect(lastCall.retentionPolicy.tiers.length).toBe(before - 1);
  });

  it("max-storage select emits null for Unlimited", () => {
    const { onChange } = renderSection();
    fireEvent.change(
      screen.getByRole("combobox", { name: /Maximum storage/i }),
      { target: { value: "unlimited" } },
    );
    expect(onChange).toHaveBeenCalledWith({ maxStorageBytes: null });
  });

  it("trash retention select emits the chosen value", () => {
    const { onChange } = renderSection();
    fireEvent.change(
      screen.getByRole("combobox", { name: /Trash retention/i }),
      { target: { value: "90" } },
    );
    expect(onChange).toHaveBeenCalledWith({ trashRetentionDays: 90 });
  });

  it("device-name input emits its value", () => {
    const { onChange } = renderSection();
    fireEvent.change(
      screen.getByRole("textbox", { name: /Device name/i }),
      { target: { value: "MacBook" } },
    );
    expect(onChange).toHaveBeenCalledWith({ deviceName: "MacBook" });
  });

  it("storage usage sub-label fetches via getStorageUsage", async () => {
    renderSection();
    await waitFor(() =>
      expect(mockPlatform.snapshot.getStorageUsage).toHaveBeenCalled(),
    );
    expect(
      await screen.findByText(/127 MB of 200 MB used/i),
    ).toBeInTheDocument();
  });

  it("archive folder picker shows empty state then chosen state", async () => {
    const { onChange } = renderSection();
    expect(
      screen.getByRole("button", { name: /Choose folder/i }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Choose folder/i }));
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          archiveFolder: "/Users/me/OneDrive/Pennivo",
        }),
      ),
    );
    // After picking, the per-tier matrix appears.
    expect(
      await screen.findByRole("table", { name: /Per-tier routing/i }),
    ).toBeInTheDocument();
  });

  it("per-tier routing matrix only renders when archive folder is set", () => {
    renderSection();
    expect(
      screen.queryByRole("table", { name: /Per-tier routing/i }),
    ).not.toBeInTheDocument();
  });

  it("Clear all snapshots opens a confirm dialog", () => {
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: /Clear all snapshots/i }));
    expect(
      screen.getByRole("alertdialog", { name: /Clear all snapshots/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Permanently delete all snapshots for every file/i),
    ).toBeInTheDocument();
  });
});
