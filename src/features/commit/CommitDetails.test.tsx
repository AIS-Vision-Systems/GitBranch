import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTreeExpansionStore } from "../../state/treeExpansion";

vi.mock("../../ipc/github", () => ({ githubAvatar: vi.fn().mockResolvedValue(null) }));

import type { CommitDetails as Details } from "../../ipc/commit";
import type { RepoId } from "../../ipc/types";
import { CommitDetails } from "./CommitDetails";
import { commitItems } from "./items";

const details: Details = {
  oid: "a".repeat(40),
  parents: [],
  authorName: "A",
  authorEmail: "a@x",
  authorTime: 1,
  committerName: "A",
  committerEmail: "a@x",
  committerTime: 1,
  subject: "s",
  body: "",
  coAuthors: [],
  files: [
    { path: "src/a.ts", origPath: null, kind: "modified", similarity: null },
    { path: "src/b.ts", origPath: null, kind: "added", similarity: null },
    { path: "src/lib/c.ts", origPath: null, kind: "added", similarity: null },
    { path: "d.ts", origPath: null, kind: "deleted", similarity: null },
  ],
};

function setup(d: Details = details) {
  return render(
    <CommitDetails
      repoId={"r1" as RepoId}
      details={d}
      files={commitItems(d)}
      selectedKey={null}
      onSelectFile={vi.fn()}
      onSelectParent={vi.fn()}
    />,
  );
}

describe("CommitDetails file list", () => {
  beforeEach(() => useTreeExpansionStore.getState().reset());

  it("uses the tree by default with a summary line and folder counts", () => {
    localStorage.removeItem("gitbranch.fileTree");
    setup();
    expect(screen.getByText("1 modified · 2 added · 1 deleted")).toBeInTheDocument();
    const src = screen.getByTitle("src");
    expect(src).toHaveAttribute("aria-expanded", "false");
    expect(src).toHaveTextContent("1");
    expect(screen.queryByTitle("src/a.ts")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Expand all" }));
    expect(screen.getByTitle("src/a.ts")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Collapse all" }));
    expect(screen.queryByTitle("src/a.ts")).toBeNull();
  });

  it("remembers expanded folders per commit for the session", () => {
    localStorage.removeItem("gitbranch.fileTree");
    const first = setup();
    fireEvent.click(screen.getByTitle("src"));
    expect(screen.getByTitle("src/a.ts")).toBeInTheDocument();
    first.unmount();
    const again = setup();
    expect(screen.getByTitle("src")).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTitle("src/a.ts")).toBeInTheDocument();
    again.unmount();
    setup({ ...details, oid: "b".repeat(40) });
    expect(screen.getByTitle("src")).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTitle("src/a.ts")).toBeNull();
  });

  it("Flat mode lists full paths", () => {
    localStorage.removeItem("gitbranch.fileTree");
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Flat" }));
    expect(screen.queryByTitle("src")).toBeNull();
    expect(screen.getByTitle("src/lib/c.ts")).toBeInTheDocument();
    localStorage.removeItem("gitbranch.fileTree");
  });
});

describe("CommitDetails header", () => {
  it("shows authored date, no co-author section when empty, and scrolls only the files", () => {
    const { container } = setup();
    expect(screen.getByText(/^authored /)).toBeInTheDocument();
    expect(screen.queryByText("Co-authors:")).toBeNull();
    const header = container.querySelector("header");
    const files = container.querySelector("[class*=files]");
    expect(header).not.toBeNull();
    expect(files).not.toBeNull();
    expect(header?.className).not.toMatch(/files/);
    expect(files?.contains(screen.getByTitle("src"))).toBe(true);
    expect(header?.contains(files)).toBe(false);
  });

  it("renders a chip per co-author", () => {
    setup({
      ...details,
      coAuthors: [
        { name: "Bob", email: "bob@x" },
        { name: "Carol", email: "carol@x" },
      ],
    });
    expect(screen.getByText("Co-authors:")).toBeInTheDocument();
    expect(screen.getAllByTitle("Bob <bob@x>")[0]).toHaveTextContent("Bob");
    expect(screen.getAllByTitle("Carol <carol@x>")[0]).toHaveTextContent("Carol");
  });
});
