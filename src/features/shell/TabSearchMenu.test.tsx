import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenedRepo, RepoId } from "../../ipc/types";
import { TabSearchMenu } from "./TabSearchMenu";

function repo(id: string, name: string): OpenedRepo {
  return {
    repoId: id as RepoId,
    name,
    path: `/p/${name}`,
    gitDir: `/p/${name}/.git`,
    isWorktree: false,
    mainWorkTree: null,
    isBare: false,
  };
}

const tabs = [repo("a", "alpha"), repo("b", "beta"), repo("c", "gamma")];

function setup() {
  const props = {
    onSelect: vi.fn(),
    onCloseTab: vi.fn(),
    onClose: vi.fn(),
  };
  render(<TabSearchMenu x={100} y={20} tabs={tabs} aliases={{}} currentId="a" {...props} />);
  return props;
}

afterEach(cleanup);

describe("TabSearchMenu", () => {
  it("filters the list while typing", () => {
    setup();
    fireEvent.change(screen.getByLabelText("Search Tabs"), { target: { value: "ga" } });
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(1);
    expect(options[0]?.textContent).toContain("gamma");
  });

  it("ArrowDown then Enter selects the highlighted tab and closes", () => {
    const p = setup();
    const input = screen.getByLabelText("Search Tabs");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(screen.getAllByRole("option")[1]?.getAttribute("aria-selected")).toBe("true");
    expect(input.getAttribute("aria-activedescendant")).toBe(screen.getAllByRole("option")[1]?.id);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(p.onSelect).toHaveBeenCalledWith("b");
    expect(p.onClose).toHaveBeenCalled();
  });

  it("Escape closes", () => {
    const p = setup();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(p.onClose).toHaveBeenCalled();
  });

  it("Tab closes instead of leaving the popover", () => {
    const p = setup();
    fireEvent.keyDown(screen.getByLabelText("Search Tabs"), { key: "Tab" });
    expect(p.onClose).toHaveBeenCalled();
  });

  it("the X button closes that tab without selecting it", () => {
    const p = setup();
    fireEvent.click(screen.getByRole("button", { name: "Close beta from list" }));
    expect(p.onCloseTab).toHaveBeenCalledWith("b");
    expect(p.onSelect).not.toHaveBeenCalled();
  });
});
