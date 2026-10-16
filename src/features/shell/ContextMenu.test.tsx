import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ContextMenu, type MenuItem } from "./ContextMenu";

function setup() {
  const onClose = vi.fn();
  const onC = vi.fn();
  const items: MenuItem[] = [
    { kind: "item", id: "a", label: "Alpha", onSelect: vi.fn() },
    { kind: "item", id: "b", label: "Beta", disabled: true, onSelect: vi.fn() },
    { kind: "separator" },
    { kind: "item", id: "c", label: "Gamma", shortcut: "Ctrl+G", onSelect: onC },
  ];
  render(
    <div>
      <button type="button">outside</button>
      <ContextMenu x={10} y={10} items={items} onClose={onClose} />
    </div>,
  );
  return { onClose, onC };
}

describe("ContextMenu", () => {
  it("renders roles and focuses the first enabled item", () => {
    setup();
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getByRole("separator")).toBeInTheDocument();
    expect(screen.getAllByRole("menuitem")).toHaveLength(3);
    expect(screen.getByRole("menuitem", { name: "Alpha" })).toHaveFocus();
  });

  it("arrows skip disabled items and wrap", async () => {
    setup();
    await userEvent.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: /Gamma/ })).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Alpha" })).toHaveFocus();
    await userEvent.keyboard("{ArrowUp}");
    expect(screen.getByRole("menuitem", { name: /Gamma/ })).toHaveFocus();
    await userEvent.keyboard("{Home}");
    expect(screen.getByRole("menuitem", { name: "Alpha" })).toHaveFocus();
    await userEvent.keyboard("{End}");
    expect(screen.getByRole("menuitem", { name: /Gamma/ })).toHaveFocus();
  });

  it("Enter selects and closes", async () => {
    const { onClose, onC } = setup();
    await userEvent.keyboard("{ArrowDown}{Enter}");
    expect(onC).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalled();
  });

  it("Escape and outside click close", async () => {
    const { onClose } = setup();
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "outside" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("restores focus to the previously focused element on unmount", () => {
    const { unmount } = render(
      <div>
        <button type="button">opener</button>
      </div>,
    );
    const opener = screen.getByRole("button", { name: "opener" });
    opener.focus();
    const menu = render(
      <ContextMenu
        x={1}
        y={1}
        items={[{ kind: "item", id: "a", label: "Alpha", onSelect: vi.fn() }]}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole("menuitem", { name: "Alpha" })).toHaveFocus();
    menu.unmount();
    expect(opener).toHaveFocus();
    unmount();
  });
});
