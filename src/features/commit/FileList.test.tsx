import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { StatusEntry } from "../../ipc/types";
import { FileList, type FileListItem } from "./FileList";
import { commitItems, wipItems } from "./items";

const item = (over: Partial<FileListItem>): FileListItem => ({
  key: "k",
  path: "src/a.ts",
  origPath: null,
  kind: "modified",
  target: { kind: "commit", oid: "o", path: "src/a.ts" },
  label: "src/a.ts",
  ...over,
});

describe("FileList", () => {
  it("renders badges per kind", () => {
    const files = [
      item({ key: "1", kind: "added", path: "a" }),
      item({ key: "2", kind: "deleted", path: "b" }),
      item({ key: "3", kind: "typeChanged", path: "c" }),
    ];
    render(<FileList files={files} selectedKey={null} onSelect={() => undefined} />);
    expect(screen.getByRole("list")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByLabelText("added")).toHaveTextContent("A");
    expect(screen.getByLabelText("deleted")).toHaveTextContent("D");
    expect(screen.getByLabelText("typeChanged")).toHaveTextContent("T");
  });

  it("shows rename as orig -> new", () => {
    render(
      <FileList
        files={[item({ kind: "renamed", origPath: "old/x.ts", path: "new/y.ts" })]}
        selectedKey={null}
        onSelect={() => undefined}
      />,
    );
    expect(screen.getByRole("button")).toHaveTextContent("old/x.ts → new/y.ts");
    expect(screen.getByLabelText("renamed")).toHaveTextContent("R");
  });

  it("selects on click and highlights the selected row", () => {
    const onSelect = vi.fn();
    const f = item({});
    render(<FileList files={[f]} selectedKey="k" onSelect={onSelect} />);
    const b = screen.getByRole("button");
    expect(b).toHaveAttribute("aria-current", "true");
    fireEvent.click(b);
    expect(onSelect).toHaveBeenCalledWith(f);
  });
});

describe("item mapping", () => {
  const entry = (over: Partial<StatusEntry>): StatusEntry => ({
    path: "p",
    origPath: null,
    staged: "unmodified",
    unstaged: "unmodified",
    conflicted: false,
    submodule: false,
    ...over,
  });

  it("maps WIP entries to one row per target", () => {
    const rows = wipItems([
      entry({ path: "a", staged: "modified", unstaged: "modified" }),
      entry({ path: "b", unstaged: "untracked" }),
      entry({ path: "c", staged: "added" }),
    ]);
    expect(rows.map((r) => [r.target.kind, r.path, r.label])).toEqual([
      ["staged", "a", "a (staged)"],
      ["unstaged", "a", "a (unstaged)"],
      ["untracked", "b", "b (untracked)"],
      ["staged", "c", "c (staged)"],
    ]);
  });

  it("maps commit files to commit targets", () => {
    const rows = commitItems({
      oid: "abc",
      parents: [],
      authorName: "",
      authorEmail: "",
      authorTime: 0,
      committerName: "",
      committerEmail: "",
      committerTime: 0,
      subject: "",
      body: "",
      files: [{ path: "n", origPath: "o", kind: "renamed", similarity: 90 }],
    });
    expect(rows[0]?.target).toEqual({ kind: "commit", oid: "abc", path: "n" });
    expect(rows[0]?.label).toBe("o → n");
  });
});
