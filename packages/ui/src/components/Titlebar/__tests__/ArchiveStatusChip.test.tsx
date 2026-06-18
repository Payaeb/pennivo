import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ArchiveStatusChip } from "../ArchiveStatusChip";

describe("ArchiveStatusChip", () => {
  it("renders nothing when status is 'ok'", () => {
    const { container } = render(
      <ArchiveStatusChip status="ok" count={0} onClick={vi.fn()} />,
    );
    expect(container.querySelector(".archive-status-chip")).toBeNull();
  });

  it("renders nothing when status is 'queued' but count is 0", () => {
    const { container } = render(
      <ArchiveStatusChip status="queued" count={0} onClick={vi.fn()} />,
    );
    expect(container.querySelector(".archive-status-chip")).toBeNull();
  });

  it("renders the chip when status is 'unavailable' with the unreachable tooltip", () => {
    render(
      <ArchiveStatusChip status="unavailable" count={3} onClick={vi.fn()} />,
    );
    const btn = screen.getByRole("button", { name: /unreachable/i });
    expect(btn).toBeInTheDocument();
    expect(btn.textContent).toMatch(/Archive offline/);
  });

  it("renders the chip when status is 'queued' with N count tooltip", () => {
    render(<ArchiveStatusChip status="queued" count={5} onClick={vi.fn()} />);
    const btn = screen.getByRole("button", { name: /5 snapshots waiting/ });
    expect(btn).toBeInTheDocument();
  });

  it("singularizes the queued count copy", () => {
    render(<ArchiveStatusChip status="queued" count={1} onClick={vi.fn()} />);
    expect(
      screen.getByRole("button", { name: /1 snapshot waiting/ }),
    ).toBeInTheDocument();
  });

  it("fires onClick when the chip is clicked", () => {
    const onClick = vi.fn();
    render(<ArchiveStatusChip status="queued" count={2} onClick={onClick} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledOnce();
  });
});
