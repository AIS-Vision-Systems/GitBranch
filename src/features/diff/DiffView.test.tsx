import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { sampleDiff } from "../../test/diffFixtures";
import { DiffView } from "./DiffView";

const base = { loading: false, label: "a.ts", onViewChange: () => undefined };

describe("DiffView", () => {
  it("renders unified gutters and markers", () => {
    render(<DiffView {...base} diff={sampleDiff()} view="unified" />);
    expect(screen.getByText("@@ -1,2 +1,2 @@ fn main")).toBeInTheDocument();
    const rows = screen.getAllByRole("row");
    // hunk, context, del, nonl, add
    expect(rows).toHaveLength(5);
    const cells = (i: number): string[] =>
      within(rows[i]!)
        .getAllByRole("cell")
        .map((c) => c.textContent ?? "");
    expect(cells(1).slice(0, 3)).toEqual(["1", "1", " "]);
    expect(cells(2).slice(0, 3)).toEqual(["2", "", "-"]);
    expect(cells(4).slice(0, 3)).toEqual(["", "2", "+"]);
  });

  it("shows the no-newline marker", () => {
    render(<DiffView {...base} diff={sampleDiff()} view="unified" />);
    expect(screen.getByText("↵ No newline at end of file")).toBeInTheDocument();
  });

  it("renders split pairs on one row", () => {
    render(<DiffView {...base} diff={sampleDiff()} view="split" />);
    const rows = screen.getAllByRole("row");
    // hunk, context, del/add pair, nonl
    expect(rows).toHaveLength(4);
    const pair = within(rows[2]!)
      .getAllByRole("cell")
      .map((c) => c.textContent);
    expect(pair).toEqual(["2", "const b = 2;", "2", "const b = 3;"]);
  });

  it("shows binary and empty states", () => {
    const d = { ...sampleDiff(), binary: true, hunks: [] };
    const { rerender } = render(<DiffView {...base} diff={d} view="unified" />);
    expect(screen.getByText("Binary file")).toBeInTheDocument();
    rerender(<DiffView {...base} diff={{ ...d, binary: false }} view="unified" />);
    expect(screen.getByText("No changes")).toBeInTheDocument();
  });

  it("shows combined and too-large notices", () => {
    const d = { ...sampleDiff(), hunks: [] };
    const { rerender } = render(
      <DiffView {...base} diff={{ ...d, combined: true }} view="unified" />,
    );
    expect(screen.getByText(/Conflicted file: combined diff is not shown yet/)).toBeInTheDocument();
    rerender(<DiffView {...base} diff={{ ...d, tooLarge: true }} view="unified" />);
    expect(screen.getByText("File is too large to display (> 8 MiB)")).toBeInTheDocument();
  });

  it("toggle is a radiogroup and reports changes", () => {
    const onViewChange = vi.fn();
    render(<DiffView {...base} onViewChange={onViewChange} diff={sampleDiff()} view="unified" />);
    expect(screen.getByRole("radiogroup")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Unified" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("radio", { name: "Split" }));
    expect(onViewChange).toHaveBeenCalledWith("split");
  });

  it("shows mode change", () => {
    const d = { ...sampleDiff(), oldMode: "100644", newMode: "100755" };
    render(<DiffView {...base} diff={d} view="unified" />);
    expect(screen.getByText("mode 100644 → 100755")).toBeInTheDocument();
  });
});
