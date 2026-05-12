import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRef, type MutableRefObject, type ReactNode } from "react";

vi.mock("../../../platform", () => ({
  getPlatform: () => mockPlatform,
}));

let mockPlatform: {
  snapshot: {
    list: ReturnType<typeof vi.fn>;
    read: ReturnType<typeof vi.fn>;
    restore: ReturnType<typeof vi.fn>;
    saveMerged: ReturnType<typeof vi.fn>;
    getCapStatus: ReturnType<typeof vi.fn>;
    onCapExceeded: ReturnType<typeof vi.fn>;
    onArchiveStatus: ReturnType<typeof vi.fn>;
    onExternalChangeDetected: ReturnType<typeof vi.fn>;
  };
};

import { CompareMergeView } from "../CompareMergeView";

const LEFT_CONTENT = "alpha\nB\ngamma";
const RIGHT_CONTENT = "alpha\nx\ngamma";

beforeEach(() => {
  mockPlatform = {
    snapshot: {
      list: vi.fn(async () => []),
      read: vi.fn(async (_p: string, id: string) => {
        if (id === "snap-left") {
          return {
            content: LEFT_CONTENT,
            meta: {
              id: "snap-left",
              ts: new Date("2026-05-07T09:14:00Z").getTime(),
              author: "external",
              deviceId: "d1",
              contentHash: "hash-l",
              sizeBytes: 12,
            },
          };
        }
        return {
          content: RIGHT_CONTENT,
          meta: {
            id: "snap-right",
            ts: new Date("2026-05-07T14:22:00Z").getTime(),
            author: "user",
            deviceId: "d1",
            deviceName: "this Mac",
            contentHash: "hash-r",
            sizeBytes: 12,
          },
        };
      }),
      restore: vi.fn(async () => null),
      saveMerged: vi.fn(async () => ({
        savedPath: "/path/test (merged 2026-05-07).md",
      })),
      getCapStatus: vi.fn(async () => null),
      onCapExceeded: vi.fn(() => () => {}),
      onArchiveStatus: vi.fn(() => () => {}),
      onExternalChangeDetected: vi.fn(() => () => {}),
    },
  };
});

function renderCompareMergeView(
  overrides: Partial<{
    selection: { left: string; right: string };
    currentContent: string;
    closeGuardRef: MutableRefObject<(() => void) | null>;
  }> = {},
): {
  onClose: ReturnType<typeof vi.fn>;
  onBack: ReturnType<typeof vi.fn>;
  onShowToast: ReturnType<typeof vi.fn>;
  onOpenFilePath: ReturnType<typeof vi.fn>;
  onAfterReplace: ReturnType<typeof vi.fn>;
  rerender: (ui: ReactNode) => void;
} {
  const onClose = vi.fn();
  const onBack = vi.fn();
  const onShowToast = vi.fn();
  const onOpenFilePath = vi.fn();
  const onAfterReplace = vi.fn();
  const view = render(
    <CompareMergeView
      filePath="/path/test.md"
      filename="test.md"
      selection={overrides.selection ?? { left: "snap-left", right: "snap-right" }}
      currentContent={overrides.currentContent ?? ""}
      onShowToast={onShowToast}
      onOpenFilePath={onOpenFilePath}
      onClose={onClose}
      onBack={onBack}
      onAfterReplace={onAfterReplace}
      closeGuardRef={overrides.closeGuardRef}
    />,
  );
  return {
    onClose,
    onBack,
    onShowToast,
    onOpenFilePath,
    onAfterReplace,
    rerender: view.rerender,
  };
}

describe("CompareMergeView", () => {
  it("loads both snapshots and renders the per-hunk action chips", async () => {
    renderCompareMergeView();
    // Wait for the chips to render.
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Take left" }),
      ).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "Take right" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Both" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit…" })).toBeInTheDocument();
  });

  it("disables the Save buttons until every hunk is resolved", async () => {
    renderCompareMergeView();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Take left" })).toBeInTheDocument(),
    );
    const saveAsNew = screen.getByRole("button", { name: /Save as new file/ });
    const replace = screen.getByRole("button", { name: /Replace current file/ });
    expect(saveAsNew).toBeDisabled();
    expect(replace).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Take left" }));
    await waitFor(() => expect(saveAsNew).not.toBeDisabled());
    expect(replace).not.toBeDisabled();
  });

  it("counter updates as hunks resolve", async () => {
    renderCompareMergeView();
    await waitFor(() =>
      expect(screen.getByTestId("compare-merge-counter")).toBeInTheDocument(),
    );
    expect(
      screen.getByTestId("compare-merge-counter").textContent,
    ).toMatch(/0 resolved/);
    fireEvent.click(screen.getByRole("button", { name: "Take right" }));
    await waitFor(() =>
      expect(
        screen.getByTestId("compare-merge-counter").textContent,
      ).toMatch(/1 resolved/),
    );
  });

  it("Replace current opens a confirm dialog with pre-restore copy", async () => {
    renderCompareMergeView();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Take left" })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Take left" }));
    fireEvent.click(screen.getByRole("button", { name: /Replace current file/ }));
    expect(
      screen.getByRole("alertdialog", { name: /Replace current file/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/pre-restore snapshot will be taken/i),
    ).toBeInTheDocument();
  });

  it("Save as new file calls saveMerged with mode=as-new-file and opens the new path", async () => {
    const { onOpenFilePath, onClose } = renderCompareMergeView();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Take left" })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Both" }));
    fireEvent.click(screen.getByRole("button", { name: /Save as new file/ }));
    await waitFor(() =>
      expect(mockPlatform.snapshot.saveMerged).toHaveBeenCalledOnce(),
    );
    const callArg = mockPlatform.snapshot.saveMerged.mock.calls[0][0];
    expect(callArg.mode).toBe("as-new-file");
    expect(callArg.left).toBe("snap-left");
    expect(callArg.right).toBe("snap-right");
    // Merged content for "Both" = left lines then right lines.
    expect(callArg.content).toBe("alpha\nB\nx\ngamma");
    await waitFor(() =>
      expect(onOpenFilePath).toHaveBeenCalledWith(
        "/path/test (merged 2026-05-07).md",
      ),
    );
    expect(onClose).toHaveBeenCalled();
  });

  it("Edit… opens a textarea and confirming saves the user text", async () => {
    renderCompareMergeView();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Edit…" })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit…" }));
    const ta = screen.getByLabelText(/Edit hunk 1/);
    fireEvent.change(ta, { target: { value: "USER-TYPED" } });
    fireEvent.click(screen.getByRole("button", { name: "Save edit" }));
    fireEvent.click(screen.getByRole("button", { name: /Save as new file/ }));
    await waitFor(() =>
      expect(mockPlatform.snapshot.saveMerged).toHaveBeenCalled(),
    );
    const callArg = mockPlatform.snapshot.saveMerged.mock.calls[0][0];
    expect(callArg.content).toBe("alpha\nUSER-TYPED\ngamma");
  });

  it("renders an empty state when both sides are byte-identical", async () => {
    mockPlatform.snapshot.read = vi.fn(async () => ({
      content: "same",
      meta: {
        id: "x",
        ts: 0,
        author: "user",
        deviceId: "d",
        contentHash: "h",
        sizeBytes: 4,
      },
    }));
    const { onBack } = renderCompareMergeView();
    await waitFor(() =>
      expect(screen.getByText(/identical/i)).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalled();
  });

  it("publishes a closeGuardRef handler that fires the discard-confirm when there's progress", async () => {
    // Use a 2-hunk diff so resolving ONE leaves the body in
    // hasProgress=true (resolvedCount=1, !allResolved).
    mockPlatform.snapshot.read = vi.fn(async (_p: string, id: string) => ({
      content:
        id === "snap-left"
          ? "alpha\nB\ngamma\nC\nepsilon"
          : "alpha\nx\ngamma\ny\nepsilon",
      meta: {
        id,
        ts: 0,
        author: "user",
        deviceId: "d",
        contentHash: "h",
        sizeBytes: 4,
      },
    }));
    const closeGuardRef = createRef<(() => void) | null>() as MutableRefObject<
      (() => void) | null
    >;
    closeGuardRef.current = null;
    const { onClose } = renderCompareMergeView({ closeGuardRef });
    await waitFor(() =>
      expect(
        screen.getAllByRole("button", { name: "Take left" }).length,
      ).toBeGreaterThanOrEqual(2),
    );

    // No progress yet: invoking the published guard should close immediately.
    expect(typeof closeGuardRef.current).toBe("function");
    act(() => {
      closeGuardRef.current!();
    });
    expect(onClose).toHaveBeenCalledOnce();

    onClose.mockClear();

    // Resolve ONE of the two hunks → progress without allResolved.
    fireEvent.click(screen.getAllByRole("button", { name: "Take left" })[0]);
    await waitFor(() =>
      expect(
        screen.getByTestId("compare-merge-counter").textContent,
      ).toMatch(/1 resolved · 1 remaining/),
    );

    // With progress, the guard should NOT close immediately — instead it
    // surfaces the discard confirm.
    act(() => {
      closeGuardRef.current!();
    });
    expect(onClose).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(
        screen.getByRole("alertdialog", { name: /Discard merge progress/ }),
      ).toBeInTheDocument(),
    );

    // Confirming Discard fires onClose; cancelling keeps the modal open.
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("Keep editing dismisses the discard-confirm without closing", async () => {
    mockPlatform.snapshot.read = vi.fn(async (_p: string, id: string) => ({
      content:
        id === "snap-left"
          ? "alpha\nB\ngamma\nC\nepsilon"
          : "alpha\nx\ngamma\ny\nepsilon",
      meta: {
        id,
        ts: 0,
        author: "user",
        deviceId: "d",
        contentHash: "h",
        sizeBytes: 4,
      },
    }));
    const closeGuardRef = createRef<(() => void) | null>() as MutableRefObject<
      (() => void) | null
    >;
    closeGuardRef.current = null;
    const { onClose } = renderCompareMergeView({ closeGuardRef });
    await waitFor(() =>
      expect(
        screen.getAllByRole("button", { name: "Take left" }).length,
      ).toBeGreaterThanOrEqual(2),
    );
    fireEvent.click(screen.getAllByRole("button", { name: "Take left" })[0]);
    await waitFor(() =>
      expect(
        screen.getByTestId("compare-merge-counter").textContent,
      ).toMatch(/1 resolved · 1 remaining/),
    );

    act(() => {
      closeGuardRef.current!();
    });
    await waitFor(() =>
      expect(
        screen.getByRole("alertdialog", { name: /Discard merge progress/ }),
      ).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(onClose).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("alertdialog", { name: /Discard merge progress/ }),
    ).toBeNull();
  });

  it("clears the closeGuardRef on unmount", async () => {
    const closeGuardRef = createRef<(() => void) | null>() as MutableRefObject<
      (() => void) | null
    >;
    closeGuardRef.current = null;
    const onClose = vi.fn();
    const { unmount } = render(
      <CompareMergeView
        filePath="/path/test.md"
        filename="test.md"
        selection={{ left: "snap-left", right: "snap-right" }}
        currentContent=""
        onShowToast={vi.fn()}
        onOpenFilePath={vi.fn()}
        onClose={onClose}
        onBack={vi.fn()}
        closeGuardRef={closeGuardRef}
      />,
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Take left" })).toBeInTheDocument(),
    );
    expect(typeof closeGuardRef.current).toBe("function");
    unmount();
    expect(closeGuardRef.current).toBeNull();
  });

  it("supports 'current' as the right side and uses currentContent prop", async () => {
    renderCompareMergeView({
      selection: { left: "snap-left", right: "current" },
      currentContent: "alpha\nx\ngamma",
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Take left" })).toBeInTheDocument(),
    );
    // The "current file" chip appears in the right pane header (and Replace
    // current file button label also matches /current file/i — narrow the
    // assertion to the chip element).
    expect(
      screen.getByText("current file", { selector: ".compare-merge-side-chip" }),
    ).toBeInTheDocument();
  });
});
