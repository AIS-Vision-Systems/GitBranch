import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadTheme, useUiStore } from "./ui";

function mockDark(dark: boolean): void {
  window.matchMedia = ((q: string) => ({
    matches: dark,
    media: q,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
}

describe("ui store", () => {
  beforeEach(() => {
    useUiStore.setState({ toasts: [], theme: "system" });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("caps toasts at 5, dropping the oldest", () => {
    for (let i = 0; i < 7; i++) useUiStore.getState().pushToast({ kind: "error", title: `t${i}` });
    const titles = useUiStore.getState().toasts.map((t) => t.title);
    expect(titles).toEqual(["t2", "t3", "t4", "t5", "t6"]);
  });

  it("dismisses a toast by id", () => {
    const id = useUiStore.getState().pushToast({ kind: "error", title: "x" });
    useUiStore.getState().dismissToast(id);
    expect(useUiStore.getState().toasts).toHaveLength(0);
  });

  it("auto-dismisses info toasts after 5s but not errors", () => {
    vi.useFakeTimers();
    useUiStore.getState().pushToast({ kind: "info", title: "hi" });
    useUiStore.getState().pushToast({ kind: "error", title: "err" });
    vi.advanceTimersByTime(5000);
    expect(useUiStore.getState().toasts.map((t) => t.title)).toEqual(["err"]);
  });

  it("setTheme resolves system via matchMedia", () => {
    mockDark(true);
    useUiStore.getState().setTheme("system");
    expect(useUiStore.getState().resolvedTheme).toBe("dark");
    mockDark(false);
    useUiStore.getState().setTheme("system");
    expect(useUiStore.getState().resolvedTheme).toBe("light");
    useUiStore.getState().setTheme("dark");
    expect(useUiStore.getState().resolvedTheme).toBe("dark");
  });

  it("defaults to dark and persists the choice", async () => {
    localStorage.removeItem("gitbranch.theme");
    vi.resetModules();
    const fresh = await import("./ui");
    expect(fresh.useUiStore.getState().theme).toBe("dark");
    expect(fresh.useUiStore.getState().resolvedTheme).toBe("dark");
    fresh.useUiStore.getState().setTheme("light");
    expect(localStorage.getItem("gitbranch.theme")).toBe("light");
    vi.resetModules();
    const again = await import("./ui");
    expect(again.useUiStore.getState().theme).toBe("light");
    localStorage.removeItem("gitbranch.theme");
  });

  it("ignores a corrupt stored value", () => {
    localStorage.setItem("gitbranch.theme", "neon");
    expect(loadTheme()).toBe("dark");
    localStorage.removeItem("gitbranch.theme");
  });

  it("showBlame sets the target and view; showGraph clears it", () => {
    useUiStore.getState().showBlame("r1" as never, "a/b.ts", "abc");
    expect(useUiStore.getState().centerView).toBe("blame");
    expect(useUiStore.getState().blameTarget).toEqual({ repoId: "r1", path: "a/b.ts", rev: "abc" });
    useUiStore.getState().showBlame("r1" as never, "c.ts");
    expect(useUiStore.getState().blameTarget).toEqual({ repoId: "r1", path: "c.ts" });
    useUiStore.getState().showGraph();
    expect(useUiStore.getState().centerView).toBe("graph");
    expect(useUiStore.getState().blameTarget).toBeNull();
  });
});
