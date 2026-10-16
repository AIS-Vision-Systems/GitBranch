import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { HunkSelection } from "../../ipc/stage";
import { sampleDiff } from "../../test/diffFixtures";
import { useDialogsStore } from "../../state/dialogs";
import { useWipStore } from "../../state/wip";
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

  describe("hunk and line staging", () => {
    const unstaged = { kind: "unstaged", path: "a.ts" } as const;

    it("shows hunk buttons only for staged/unstaged targets", () => {
      const onHunkOp = vi.fn();
      const { rerender } = render(
        <DiffView
          {...base}
          diff={sampleDiff()}
          view="unified"
          target={unstaged}
          onHunkOp={onHunkOp}
        />,
      );
      expect(screen.getByRole("button", { name: "Stage hunk" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Discard hunk" })).toBeInTheDocument();
      rerender(
        <DiffView
          {...base}
          diff={sampleDiff()}
          view="unified"
          target={{ kind: "staged", path: "a.ts" }}
          onHunkOp={onHunkOp}
        />,
      );
      expect(screen.getByRole("button", { name: "Unstage hunk" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Stage hunk" })).toBeNull();
      for (const target of [
        { kind: "untracked", path: "a.ts" } as const,
        { kind: "commit", oid: "o", path: "a.ts" } as const,
      ]) {
        rerender(
          <DiffView
            {...base}
            diff={sampleDiff()}
            view="unified"
            target={target}
            onHunkOp={onHunkOp}
          />,
        );
        expect(screen.queryByRole("button", { name: /hunk/ })).toBeNull();
      }
    });

    it("gutter click selects a line and stages exactly it", () => {
      const onHunkOp = vi.fn();
      render(
        <DiffView
          {...base}
          diff={sampleDiff()}
          view="unified"
          target={unstaged}
          onHunkOp={onHunkOp}
        />,
      );
      const rows = screen.getAllByRole("row");
      // hunk, context, del, nonl, add
      fireEvent.click(within(rows[4]!).getAllByRole("cell")[1]!);
      expect(rows[4]).toHaveAttribute("aria-selected", "true");
      fireEvent.click(screen.getByRole("button", { name: "Stage 1 line" }));
      expect(onHunkOp).toHaveBeenCalledWith(
        { target: unstaged, hunkIndex: 0, hunkHeader: "@@ -1,2 +1,2 @@ fn main", lines: [2] },
        "stage",
      );
    });

    it("shift-click extends, Escape clears", () => {
      render(
        <DiffView
          {...base}
          diff={sampleDiff()}
          view="unified"
          target={unstaged}
          onHunkOp={vi.fn()}
        />,
      );
      const rows = screen.getAllByRole("row");
      fireEvent.click(within(rows[2]!).getAllByRole("cell")[0]!);
      fireEvent.click(within(rows[4]!).getAllByRole("cell")[1]!, { shiftKey: true });
      expect(screen.getByRole("button", { name: "Stage 2 lines" })).toBeInTheDocument();
      fireEvent.keyDown(document, { key: "Escape" });
      expect(screen.getByRole("button", { name: "Stage hunk" })).toBeInTheDocument();
    });

    it("context lines are not selectable; hunk op sends null lines", () => {
      const onHunkOp = vi.fn();
      render(
        <DiffView
          {...base}
          diff={sampleDiff()}
          view="unified"
          target={unstaged}
          onHunkOp={onHunkOp}
        />,
      );
      const rows = screen.getAllByRole("row");
      fireEvent.click(within(rows[1]!).getAllByRole("cell")[0]!);
      fireEvent.click(screen.getByRole("button", { name: "Stage hunk" }));
      expect((onHunkOp.mock.calls[0]![0] as HunkSelection).lines).toBeNull();
    });

    it("split gutters toggle only their own side", () => {
      const onHunkOp = vi.fn();
      render(
        <DiffView
          {...base}
          diff={sampleDiff()}
          view="split"
          target={unstaged}
          onHunkOp={onHunkOp}
        />,
      );
      const rows = screen.getAllByRole("row");
      const cells = within(rows[2]!).getAllByRole("cell");
      fireEvent.click(cells[0]!);
      fireEvent.click(screen.getByRole("button", { name: "Stage 1 line" }));
      expect((onHunkOp.mock.calls[0]![0] as HunkSelection).lines).toEqual([1]);
      fireEvent.click(cells[2]!);
      fireEvent.click(screen.getByRole("button", { name: "Stage 1 line" }));
      expect((onHunkOp.mock.calls[1]![0] as HunkSelection).lines).toEqual([2]);
    });

    it("Space on a focused row toggles the line, Shift+Space extends", () => {
      const onHunkOp = vi.fn();
      render(
        <DiffView
          {...base}
          diff={sampleDiff()}
          view="unified"
          target={unstaged}
          onHunkOp={onHunkOp}
        />,
      );
      const rows = screen.getAllByRole("row");
      expect(rows[1]).not.toHaveAttribute("tabindex");
      expect(rows[2]).toHaveAttribute("tabindex", "0");
      fireEvent.keyDown(rows[2]!, { key: " " });
      expect(rows[2]).toHaveAttribute("aria-selected", "true");
      fireEvent.keyDown(rows[4]!, { key: " ", shiftKey: true });
      expect(screen.getByRole("button", { name: "Stage 2 lines" })).toBeInTheDocument();
      fireEvent.keyDown(rows[2]!, { key: " " });
      expect(rows[2]).toHaveAttribute("aria-selected", "false");
    });

    it("Space on a split gutter toggles that side", () => {
      render(
        <DiffView
          {...base}
          diff={sampleDiff()}
          view="split"
          target={unstaged}
          onHunkOp={vi.fn()}
        />,
      );
      const cells = within(screen.getAllByRole("row")[2]!).getAllByRole("cell");
      fireEvent.keyDown(cells[2]!, { key: " " });
      expect(screen.getByRole("button", { name: "Stage 1 line" })).toBeInTheDocument();
    });

    it("Discard hunk confirm shows git apply -R --recount with the hunk patch", () => {
      useDialogsStore.setState({ current: null, busy: false });
      render(
        <DiffView
          {...base}
          diff={sampleDiff()}
          view="unified"
          target={unstaged}
          onHunkOp={vi.fn()}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Discard hunk" }));
      const spec = useDialogsStore.getState().current;
      expect(spec).toMatchObject({ kind: "confirm", danger: true });
      const cmd = spec?.kind === "confirm" ? (spec.command ?? "") : "";
      expect(cmd.startsWith("git apply -R --recount\n")).toBe(true);
      expect(cmd).toContain("--- a.ts\n+++ a.ts\n@@ -1,2 +1,2 @@ fn main\n");
      expect(cmd).toContain(
        " const a = 1;\n-const b = 2;\n\\ No newline at end of file\n+const b = 3;",
      );
      useDialogsStore.getState().close();
    });

    it("hunk buttons are disabled while a stage operation is busy", () => {
      useWipStore.setState({ busy: true });
      render(
        <DiffView
          {...base}
          diff={sampleDiff()}
          view="unified"
          target={unstaged}
          onHunkOp={vi.fn()}
        />,
      );
      expect(screen.getByRole("button", { name: "Stage hunk" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Discard hunk" })).toBeDisabled();
      useWipStore.setState({ busy: false });
    });
  });
});
