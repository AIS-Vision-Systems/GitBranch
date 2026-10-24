import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TabAliasBar } from "./TabAliasBar";

function setup(current = "") {
  const props = { onSave: vi.fn(), onClear: vi.fn(), onCancel: vi.fn() };
  render(<TabAliasBar current={current} {...props} />);
  return props;
}

afterEach(cleanup);

describe("TabAliasBar", () => {
  it("disables Save while the alias is empty", () => {
    const p = setup();
    const save = screen.getByRole("button", { name: "Save alias" });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(screen.getByLabelText("Repository alias", { selector: "input" }), {
      key: "Enter",
    });
    expect(p.onSave).not.toHaveBeenCalled();
  });

  it("Enter saves the trimmed alias", () => {
    const p = setup();
    const input = screen.getByLabelText("Repository alias", { selector: "input" });
    fireEvent.change(input, { target: { value: "  Work  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(p.onSave).toHaveBeenCalledWith("Work");
  });

  it("Escape cancels", () => {
    const p = setup("Old");
    fireEvent.keyDown(screen.getByLabelText("Repository alias", { selector: "input" }), {
      key: "Escape",
    });
    expect(p.onCancel).toHaveBeenCalled();
    expect(p.onSave).not.toHaveBeenCalled();
  });
});
