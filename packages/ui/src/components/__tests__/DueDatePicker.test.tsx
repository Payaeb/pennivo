import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { DueDatePicker } from "../Editor/DueDatePicker";

const anchor = { top: 100, bottom: 118, left: 50 };

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Same local (not UTC) YYYY-MM-DD formula the component itself uses —
 *  computed independently here (not imported) so the test can catch a
 *  regression in the component's own date math, same convention as the
 *  tasks-panel e2e suite's isoDate() helper. */
function toLocalIso(date: Date): string {
  return `${String(date.getFullYear()).padStart(4, "0")}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

describe("DueDatePicker — rendering", () => {
  it("renders all four quick picks and a native date input", () => {
    render(
      <DueDatePicker anchor={anchor} onPick={vi.fn()} onClose={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: "Today" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Tomorrow" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Next week" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Next Monday" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Due date")).toHaveAttribute("type", "date");
  });

  it("renders into a portal on document.body, not inside the caller's tree", () => {
    const { container } = render(
      <DueDatePicker anchor={anchor} onPick={vi.fn()} onClose={vi.fn()} />,
    );
    // The component's own render root is empty (portal escapes it) while
    // the dialog itself is findable on the document.
    expect(container).toBeEmptyDOMElement();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("never steals focus on open", () => {
    render(
      <DueDatePicker anchor={anchor} onPick={vi.fn()} onClose={vi.fn()} />,
    );
    expect(document.activeElement).not.toBe(screen.getByRole("dialog"));
    expect(document.activeElement).not.toBe(screen.getByLabelText("Due date"));
  });
});

describe("DueDatePicker — picking a date", () => {
  it("clicking Today calls onPick with today's local ISO date", () => {
    const onPick = vi.fn();
    render(<DueDatePicker anchor={anchor} onPick={onPick} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    expect(onPick).toHaveBeenCalledWith(toLocalIso(new Date()));
  });

  it("clicking Tomorrow calls onPick with today+1", () => {
    const onPick = vi.fn();
    render(<DueDatePicker anchor={anchor} onPick={onPick} onClose={vi.fn()} />);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    fireEvent.click(screen.getByRole("button", { name: "Tomorrow" }));
    expect(onPick).toHaveBeenCalledWith(toLocalIso(tomorrow));
  });

  it("clicking Next week calls onPick with today+7", () => {
    const onPick = vi.fn();
    render(<DueDatePicker anchor={anchor} onPick={onPick} onClose={vi.fn()} />);
    const nextWeek = new Date();
    nextWeek.setDate(nextWeek.getDate() + 7);
    fireEvent.click(screen.getByRole("button", { name: "Next week" }));
    expect(onPick).toHaveBeenCalledWith(toLocalIso(nextWeek));
  });

  it("clicking Next Monday calls onPick with the next upcoming Monday, never today", () => {
    const onPick = vi.fn();
    render(<DueDatePicker anchor={anchor} onPick={onPick} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Next Monday" }));
    const [isoArg] = onPick.mock.calls[0] as [string];
    const picked = new Date(`${isoArg}T00:00:00`);
    expect(picked.getDay()).toBe(1); // Monday
    expect(toLocalIso(picked)).not.toBe(toLocalIso(new Date())); // never today
  });

  it("picking a date via the native input calls onPick with its value", () => {
    const onPick = vi.fn();
    render(<DueDatePicker anchor={anchor} onPick={onPick} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Due date"), {
      target: { value: "2026-12-25" },
    });
    expect(onPick).toHaveBeenCalledWith("2026-12-25");
  });
});

describe("DueDatePicker — dismissal", () => {
  it("Escape calls onClose without calling onPick", () => {
    const onClose = vi.fn();
    const onPick = vi.fn();
    render(<DueDatePicker anchor={anchor} onPick={onPick} onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
    expect(onPick).not.toHaveBeenCalled();
  });

  it("clicking outside the popover calls onClose", () => {
    const onClose = vi.fn();
    render(
      <DueDatePicker anchor={anchor} onPick={vi.fn()} onClose={onClose} />,
    );
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("clicking inside the popover does not call onClose", () => {
    const onClose = vi.fn();
    render(
      <DueDatePicker anchor={anchor} onPick={vi.fn()} onClose={onClose} />,
    );
    fireEvent.mouseDown(screen.getByRole("button", { name: "Today" }));
    expect(onClose).not.toHaveBeenCalled();
  });
});
