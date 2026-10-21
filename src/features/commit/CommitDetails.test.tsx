import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CommitDetails as Details } from "../../ipc/commit";
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
  files: [
    { path: "src/a.ts", origPath: null, kind: "modified", similarity: null },
    { path: "src/b.ts", origPath: null, kind: "added", similarity: null },
    { path: "src/lib/c.ts", origPath: null, kind: "added", similarity: null },
    { path: "d.ts", origPath: null, kind: "deleted", similarity: null },
  ],
};

function setup() {
  return render(
    <CommitDetails
      details={details}
      files={commitItems(details)}
      selectedKey={null}
      onSelectFile={vi.fn()}
      onSelectParent={vi.fn()}
    />,
  );
}

describe("CommitDetails file list", () => {
  it("uses the tree by default with a summary line and folder counts", () => {
    localStorage.removeItem("gitbranch.fileTree");
    setup();
    expect(screen.getByText("1 modified · 2 added · 1 deleted")).toBeInTheDocument();
    const src = screen.getByTitle("src");
    expect(src).toHaveAttribute("aria-expanded", "true");
    expect(src).toHaveTextContent("1");
    fireEvent.click(screen.getByRole("button", { name: "Collapse all" }));
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
