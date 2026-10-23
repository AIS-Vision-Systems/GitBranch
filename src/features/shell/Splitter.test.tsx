import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_WIDTH, STORAGE_KEY, useDetailsWidth } from "./detailsWidth";
import { Splitter } from "./Splitter";
import { createWidthStore } from "./paneWidth";

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

describe("Splitter side=left", () => {
  const store = createWidthStore({
    key: "test.leftWidth",
    defaultWidth: 260,
    min: 180,
    maxFraction: 0.45,
  });
  function LeftHarness() {
    const [w, setW] = store.useWidth();
    return (
      <div>
        <Splitter
          side="left"
          width={w}
          onChange={setW}
          label="Resize sidebar"
          min={store.MIN}
          defaultWidth={store.DEFAULT}
        />
      </div>
    );
  }

  it("drags relative to the parent's left edge and persists", () => {
    render(<LeftHarness />);
    const sep = screen.getByRole("separator", { name: "Resize sidebar" });
    sep.setPointerCapture = vi.fn();
    sep.hasPointerCapture = vi.fn(() => false);
    sep.parentElement!.getBoundingClientRect = () => ({ left: 10 }) as DOMRect;
    fireEvent.pointerDown(sep, { pointerId: 1 });
    fireEvent.pointerMove(sep, { pointerId: 1, clientX: 350 });
    expect(sep).toHaveAttribute("aria-valuenow", "340");
    expect(localStorage.getItem("test.leftWidth")).toBe("340");
    fireEvent.pointerMove(sep, { pointerId: 1, clientX: 20 });
    expect(sep).toHaveAttribute("aria-valuenow", "180");
  });

  it("ArrowRight grows, ArrowLeft shrinks, double-click resets", () => {
    render(<LeftHarness />);
    const sep = screen.getByRole("separator", { name: "Resize sidebar" });
    fireEvent.keyDown(sep, { key: "ArrowRight" });
    expect(sep).toHaveAttribute("aria-valuenow", "276");
    fireEvent.keyDown(sep, { key: "ArrowLeft" });
    fireEvent.keyDown(sep, { key: "ArrowLeft" });
    expect(sep).toHaveAttribute("aria-valuenow", "244");
    fireEvent.doubleClick(sep);
    expect(sep).toHaveAttribute("aria-valuenow", "260");
  });
});
