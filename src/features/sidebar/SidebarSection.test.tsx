import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { SIDEBAR_SECTIONS_KEY, loadSidebarSections, useUiStore } from "../../state/ui";
import { SidebarSection } from "./SidebarSection";

describe("SidebarSection", () => {
  beforeEach(() => {
    localStorage.clear();
    useUiStore.setState({ sidebarSections: {} });
  });

  it("toggles on header click and persists the state", () => {
    render(
      <SidebarSection id="t" icon={null} title="Thing" count={4}>
        <p>body</p>
      </SidebarSection>,
    );
    const btn = screen.getByRole("button", { name: /Thing/ });
    expect(btn).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("body")).toBeTruthy();
    fireEvent.click(btn);
    expect(btn).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("body")).toBeNull();
    expect(useUiStore.getState().sidebarSections["t"]).toBe(false);
    expect(JSON.parse(localStorage.getItem(SIDEBAR_SECTIONS_KEY) ?? "{}")).toEqual({ t: false });
    expect(loadSidebarSections()).toEqual({ t: false });
    fireEvent.click(btn);
    expect(screen.getByText("body")).toBeTruthy();
  });

  it("exposes data-section and the count", () => {
    const { container } = render(
      <SidebarSection id="abc" icon={null} title="X" count={7}>
        <p>b</p>
      </SidebarSection>,
    );
    expect(container.querySelector("[data-section=abc]")).not.toBeNull();
    expect(screen.getByText("7")).toBeTruthy();
  });
});
