import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { ImageViewer } from "../ImageViewer";

const SRC = "pennivo-file:///C:/notes/photo%20one.png";

function mockNatural(width: number, height: number) {
  Object.defineProperty(HTMLImageElement.prototype, "naturalWidth", {
    configurable: true,
    get: () => width,
  });
  Object.defineProperty(HTMLImageElement.prototype, "naturalHeight", {
    configurable: true,
    get: () => height,
  });
}

function loadImage() {
  const img = screen.getByTestId("image-viewer").querySelector("img")!;
  act(() => {
    fireEvent.load(img);
  });
  return img;
}

function readout() {
  return screen.getByRole("button", { name: "Reset zoom to fit" });
}

beforeEach(() => {
  window.innerWidth = 1000;
  window.innerHeight = 800;
  mockNatural(2000, 1000);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("ImageViewer", () => {
  it("is a labelled modal dialog and starts at fit", () => {
    render(<ImageViewer src={SRC} alt="Quarterly chart" onClose={() => {}} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog.getAttribute("aria-label")).toContain("Quarterly chart");
    loadImage();
    // 888 / 2000 = 44.4%
    expect(readout()).toHaveTextContent("44%");
  });

  it("falls back to the file name for the caption", () => {
    render(<ImageViewer src={SRC} alt="" onClose={() => {}} />);
    expect(screen.getByRole("dialog").getAttribute("aria-label")).toContain(
      "photo one.png",
    );
  });

  it("Esc closes and is not seen by window listeners", () => {
    const onClose = vi.fn();
    const seen = vi.fn();
    window.addEventListener("keydown", seen);
    render(<ImageViewer src={SRC} alt="x" onClose={onClose} />);
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(seen).not.toHaveBeenCalled();
    window.removeEventListener("keydown", seen);
  });

  it("+ - 0 and 1 change the readout", () => {
    render(<ImageViewer src={SRC} alt="x" onClose={() => {}} />);
    loadImage();
    fireEvent.keyDown(document.body, { key: "1" });
    expect(readout()).toHaveTextContent("100%");
    fireEvent.keyDown(document.body, { key: "+" });
    expect(readout()).toHaveTextContent("125%");
    fireEvent.keyDown(document.body, { key: "=" });
    expect(readout()).toHaveTextContent("156%");
    fireEvent.keyDown(document.body, { key: "-" });
    expect(readout()).toHaveTextContent("125%");
    fireEvent.keyDown(document.body, { key: "0" });
    expect(readout()).toHaveTextContent("44%");
  });

  it("clamps zoom between fit and the 3200% ceiling", () => {
    render(<ImageViewer src={SRC} alt="x" onClose={() => {}} />);
    loadImage();
    for (let i = 0; i < 60; i++) fireEvent.keyDown(document.body, { key: "+" });
    expect(readout()).toHaveTextContent("3200%");
    for (let i = 0; i < 80; i++) fireEvent.keyDown(document.body, { key: "-" });
    expect(readout()).toHaveTextContent("44%");
  });

  it("never upscales a small image on open", () => {
    mockNatural(120, 80);
    render(<ImageViewer src={SRC} alt="x" onClose={() => {}} />);
    loadImage();
    expect(readout()).toHaveTextContent("100%");
  });

  it("Ctrl+wheel zooms the image and never reaches window listeners", () => {
    const seen = vi.fn();
    window.addEventListener("wheel", seen);
    render(<ImageViewer src={SRC} alt="x" onClose={() => {}} />);
    loadImage();
    const before = readout().textContent;
    const ev = new WheelEvent("wheel", {
      deltaY: -100,
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
      clientX: 500,
      clientY: 400,
    });
    act(() => {
      screen.getByTestId("image-viewer").dispatchEvent(ev);
    });
    expect(seen).not.toHaveBeenCalled();
    expect(ev.defaultPrevented).toBe(true);
    expect(readout().textContent).not.toBe(before);
    window.removeEventListener("wheel", seen);
  });

  it("Ctrl+= does not reach window listeners", () => {
    const seen = vi.fn();
    window.addEventListener("keydown", seen);
    render(<ImageViewer src={SRC} alt="x" onClose={() => {}} />);
    loadImage();
    fireEvent.keyDown(document.body, { key: "=", ctrlKey: true });
    expect(seen).not.toHaveBeenCalled();
    window.removeEventListener("keydown", seen);
  });

  it("double-click toggles fit and 200%", () => {
    render(<ImageViewer src={SRC} alt="x" onClose={() => {}} />);
    loadImage();
    const stage = screen
      .getByTestId("image-viewer")
      .querySelector(".iv-stage")!;
    fireEvent.doubleClick(stage, { clientX: 300, clientY: 300 });
    expect(readout()).toHaveTextContent("200%");
    fireEvent.doubleClick(stage, { clientX: 300, clientY: 300 });
    expect(readout()).toHaveTextContent("44%");
  });

  it("traps Tab inside the dialog", () => {
    render(
      <>
        <button>outside</button>
        <ImageViewer src={SRC} alt="x" onClose={() => {}} />
      </>,
    );
    loadImage();
    const dialog = screen.getByRole("dialog");
    const buttons = Array.from(
      dialog.querySelectorAll<HTMLElement>("button:not([disabled])"),
    );
    buttons[buttons.length - 1]!.focus();
    fireEvent.keyDown(document.body, { key: "Tab" });
    expect(document.activeElement).toBe(buttons[0]);
    fireEvent.keyDown(document.body, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(buttons[buttons.length - 1]);
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("returns focus to the previously focused element", () => {
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    outside.focus();
    const { unmount } = render(
      <ImageViewer src={SRC} alt="x" onClose={() => {}} />,
    );
    expect(document.activeElement).toBe(screen.getByRole("dialog"));
    unmount();
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it("shows a calm error state and disables zoom controls", () => {
    render(<ImageViewer src={SRC} alt="x" onClose={() => {}} />);
    const img = screen.getByTestId("image-viewer").querySelector("img")!;
    act(() => {
      fireEvent.error(img);
    });
    expect(screen.getByText("Couldn't load this image")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Zoom in" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Zoom out" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Fit to window" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Close" })).toBeEnabled();
  });

  it("applies the reduced-motion variant", () => {
    (
      window.matchMedia as unknown as ReturnType<typeof vi.fn>
    ).mockImplementation((query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    render(<ImageViewer src={SRC} alt="x" onClose={() => {}} />);
    expect(screen.getByRole("dialog")).toHaveClass("iv-overlay--reduced");
  });

  it("hides the full screen button when unsupported and never exits focus-mode full screen", () => {
    const first = render(<ImageViewer src={SRC} alt="x" onClose={() => {}} />);
    expect(
      screen.queryByRole("button", { name: /full screen/i }),
    ).not.toBeInTheDocument();
    first.unmount();

    const set = vi.fn();
    const r = render(
      <ImageViewer
        src={SRC}
        alt="x"
        onClose={() => {}}
        fullScreen={{
          ownedByApp: true,
          set,
          isActive: () => Promise.resolve(true),
        }}
      />,
    );
    loadImage();
    fireEvent.keyDown(document.body, { key: "f" });
    r.unmount();
    expect(set).not.toHaveBeenCalled();
  });

  it("restores full screen only if the viewer entered it", async () => {
    const set = vi.fn();
    const r = render(
      <ImageViewer
        src={SRC}
        alt="x"
        onClose={() => {}}
        fullScreen={{
          ownedByApp: false,
          set,
          isActive: () => Promise.resolve(false),
        }}
      />,
    );
    loadImage();
    await act(async () => {
      fireEvent.keyDown(document.body, { key: "F" });
    });
    expect(set).toHaveBeenCalledWith(true);
    r.unmount();
    expect(set).toHaveBeenLastCalledWith(false);
  });

  it("keeps the zoom level when the window resizes while zoomed", () => {
    render(<ImageViewer src={SRC} alt="x" onClose={() => {}} />);
    loadImage();
    fireEvent.keyDown(document.body, { key: "1" });
    fireEvent.keyDown(document.body, { key: "+" });
    expect(readout()).toHaveTextContent("125%");
    window.innerWidth = 1400;
    window.innerHeight = 900;
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(readout()).toHaveTextContent("125%");
  });

  it("shows focus-mode full screen as active, not disabled", () => {
    render(
      <ImageViewer
        src={SRC}
        alt="x"
        onClose={() => {}}
        fullScreen={{
          ownedByApp: true,
          set: vi.fn(),
          isActive: () => Promise.resolve(true),
        }}
      />,
    );
    const btn = screen.getByRole("button", {
      name: "Already full screen (focus mode)",
    });
    expect(btn).toBeEnabled();
    expect(btn).toHaveAttribute("aria-pressed", "true");
  });

  it("swallows other Ctrl shortcuts so dialogs cannot open behind it", () => {
    const seen = vi.fn();
    window.addEventListener("keydown", seen);
    render(<ImageViewer src={SRC} alt="x" onClose={() => {}} />);
    loadImage();
    fireEvent.keyDown(document.body, {
      key: "P",
      ctrlKey: true,
      shiftKey: true,
    });
    expect(seen).not.toHaveBeenCalled();
    window.removeEventListener("keydown", seen);
  });

  it("leaves keys alone for a text field in a dialog stacked above it", () => {
    const onClose = vi.fn();
    render(<ImageViewer src={SRC} alt="x" onClose={onClose} />);
    loadImage();
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    const ev = new KeyboardEvent("keydown", {
      key: "1",
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    input.remove();
  });

  it("does not enter full screen if closed while the check is pending", async () => {
    const set = vi.fn();
    let resolve!: (v: boolean) => void;
    const r = render(
      <ImageViewer
        src={SRC}
        alt="x"
        onClose={() => {}}
        fullScreen={{
          ownedByApp: false,
          set,
          isActive: () => new Promise<boolean>((res) => (resolve = res)),
        }}
      />,
    );
    loadImage();
    fireEvent.keyDown(document.body, { key: "f" });
    r.unmount();
    await act(async () => {
      resolve(false);
    });
    expect(set).not.toHaveBeenCalled();
  });
});
