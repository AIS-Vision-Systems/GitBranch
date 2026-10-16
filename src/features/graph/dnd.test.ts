import type { DragEvent } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  REF_MIME,
  acceptDrag,
  endDrag,
  getDragged,
  installDragCleanup,
  startDrag,
  takeDrop,
} from "./dnd";

function fake(types: string[], el: HTMLElement, data = "") {
  const preventDefault = vi.fn();
  const e = {
    currentTarget: el,
    preventDefault,
    stopPropagation: vi.fn(),
    relatedTarget: null,
    dataTransfer: {
      types,
      getData: () => data,
      setData: vi.fn(),
      dropEffect: "",
      effectAllowed: "",
    },
  };
  return { e: e as unknown as DragEvent<HTMLElement>, preventDefault };
}

afterEach(() => endDrag());

describe("dnd", () => {
  it("window dragend clears a stale dragged name and every highlight", () => {
    const remove = installDragCleanup();
    const el = document.createElement("div");
    startDrag(fake([REF_MIME], el).e, "feat");
    acceptDrag(fake([REF_MIME], el).e, "hl");
    expect(getDragged()).toBe("feat");
    expect(el.classList.contains("hl")).toBe(true);
    window.dispatchEvent(new Event("dragend"));
    expect(getDragged()).toBeNull();
    expect(el.classList.contains("hl")).toBe(false);
    remove();
  });

  it("window drop clears too", () => {
    const remove = installDragCleanup();
    startDrag(fake([REF_MIME], document.createElement("div")).e, "feat");
    window.dispatchEvent(new Event("drop"));
    expect(getDragged()).toBeNull();
    remove();
  });

  it("does not accept a text/plain drag even when a stale name is set", () => {
    const el = document.createElement("div");
    startDrag(fake([REF_MIME], el).e, "feat");
    const { e, preventDefault } = fake(["text/plain"], el);
    acceptDrag(e, "hl");
    expect(preventDefault).not.toHaveBeenCalled();
    expect(el.classList.contains("hl")).toBe(false);
    expect(takeDrop(e, "hl")).toBeNull();
  });

  it("refuses the source's own target: no preventDefault, no highlight", () => {
    const el = document.createElement("div");
    startDrag(fake([REF_MIME], el).e, "feat");
    const { e, preventDefault } = fake([REF_MIME], el, "feat");
    acceptDrag(e, "hl", (s) => s === "feat");
    expect(preventDefault).not.toHaveBeenCalled();
    expect(el.classList.contains("hl")).toBe(false);
    expect(takeDrop(e, "hl", (s) => s === "feat")).toBeNull();
    acceptDrag(e, "hl", (s) => s === "other");
    expect(preventDefault).toHaveBeenCalled();
    expect(el.classList.contains("hl")).toBe(true);
  });

  it("takeDrop returns the branch name and ends the drag", () => {
    const el = document.createElement("div");
    startDrag(fake([REF_MIME], el).e, "feat");
    expect(takeDrop(fake([REF_MIME], el, "feat").e, "hl")).toBe("feat");
    expect(getDragged()).toBeNull();
  });
});
