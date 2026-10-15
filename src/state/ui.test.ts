import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useUiStore } from "./ui";

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
});
