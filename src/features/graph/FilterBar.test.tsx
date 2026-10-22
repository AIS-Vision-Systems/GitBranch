import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RepoId } from "../../ipc/types";
import { NO_FILTER, useGraphStore } from "../../state/graph";
import { FilterBar } from "./FilterBar";

const REPO = "r1" as RepoId;

beforeEach(() => {
  vi.useFakeTimers();
  useGraphStore.setState({ filters: {}, filterBarOpen: { [REPO]: true }, filterError: {} });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("FilterBar", () => {
  it("follows an external path change and keeps typing working", async () => {
    render(<FilterBar repoId={REPO} />);
    const path = screen.getByLabelText<HTMLInputElement>("Path");
    expect(path.value).toBe("");

    act(() => {
      useGraphStore.setState({ filters: { [REPO]: { ...NO_FILTER, path: "src/a.ts" } } });
    });
    expect(path.value).toBe("src/a.ts");

    fireEvent.change(path, { target: { value: "src/a.tsx" } });
    expect(path.value).toBe("src/a.tsx");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(useGraphStore.getState().filters[REPO]?.path).toBe("src/a.tsx");
    expect(path.value).toBe("src/a.tsx");
  });

  it("typing in another field does not wipe the externally set path", async () => {
    render(<FilterBar repoId={REPO} />);
    act(() => {
      useGraphStore.setState({ filters: { [REPO]: { ...NO_FILTER, path: "src/a.ts" } } });
    });
    fireEvent.change(screen.getByLabelText("Author"), { target: { value: "xavi" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(useGraphStore.getState().filters[REPO]).toEqual({
      author: "xavi",
      message: "",
      path: "src/a.ts",
    });
  });
});
