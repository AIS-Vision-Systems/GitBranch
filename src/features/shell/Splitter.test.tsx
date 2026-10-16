import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_WIDTH, STORAGE_KEY, useDetailsWidth } from "./detailsWidth";
import { Splitter } from "./Splitter";

function Harness() {
  const [w, setW] = useDetailsWidth();
  return <Splitter width={w} onChange={setW} />;
}

beforeEach(() => {
  localStorage.clear();
  window.innerWidth = 1600;
});

describe("Splitter", () => {
  it("starts at the default width and resizes with arrow keys", () => {
    render(<Harness />);
    const sep = screen.getByRole("separator");
    expect(sep).toHaveAttribute("aria-orientation", "vertical");
    expect(sep).toHaveAttribute("aria-valuenow", String(DEFAULT_WIDTH));
    fireEvent.keyDown(sep, { key: "ArrowLeft" });
    expect(sep).toHaveAttribute("aria-valuenow", String(DEFAULT_WIDTH + 16));
    fireEvent.keyDown(sep, { key: "ArrowRight" });
    fireEvent.keyDown(sep, { key: "ArrowRight" });
    expect(sep).toHaveAttribute("aria-valuenow", String(DEFAULT_WIDTH - 16));
    expect(localStorage.getItem(STORAGE_KEY)).toBe(String(DEFAULT_WIDTH - 16));
  });

  it("clamps to the minimum width", () => {
    localStorage.setItem(STORAGE_KEY, "330");
    render(<Harness />);
    const sep = screen.getByRole("separator");
    fireEvent.keyDown(sep, { key: "ArrowRight" });
    expect(sep).toHaveAttribute("aria-valuenow", "320");
  });

  it("restores the persisted width on mount and resets on double-click", () => {
    localStorage.setItem(STORAGE_KEY, "600");
    render(<Harness />);
    const sep = screen.getByRole("separator");
    expect(sep).toHaveAttribute("aria-valuenow", "600");
    fireEvent.doubleClick(sep);
    expect(sep).toHaveAttribute("aria-valuenow", String(DEFAULT_WIDTH));
  });
});
