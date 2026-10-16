import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { Dialog } from "./Dialog";

describe("Dialog", () => {
  it("has dialog semantics and focuses the first focusable", () => {
    render(
      <Dialog title="Hello" onClose={vi.fn()}>
        <input aria-label="a" />
        <input aria-label="b" />
      </Dialog>,
    );
    expect(screen.getByRole("dialog", { name: "Hello" })).toHaveAttribute("aria-modal", "true");
    expect(screen.getByLabelText("a")).toHaveFocus();
  });

  it("honours initialFocusRef", () => {
    const ref = createRef<HTMLInputElement>();
    render(
      <Dialog title="T" onClose={vi.fn()} initialFocusRef={ref}>
        <input aria-label="a" />
        <input aria-label="b" ref={ref} />
      </Dialog>,
    );
    expect(screen.getByLabelText("b")).toHaveFocus();
  });

  it("closes on Escape and on backdrop click", async () => {
    const onClose = vi.fn();
    const { container } = render(
      <Dialog title="T" onClose={onClose}>
        <input aria-label="a" />
      </Dialog>,
    );
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    await userEvent.click(container.firstElementChild as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("wraps Tab and Shift+Tab", async () => {
    render(
      <Dialog title="T" onClose={vi.fn()} footer={<button type="button">Last</button>}>
        <input aria-label="a" />
      </Dialog>,
    );
    expect(screen.getByLabelText("a")).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(screen.getByRole("button", { name: "Last" })).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByLabelText("a")).toHaveFocus();
  });

  it("restores focus on unmount", () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    const { unmount } = render(
      <Dialog title="T" onClose={vi.fn()}>
        <input aria-label="a" />
      </Dialog>,
    );
    expect(opener).not.toHaveFocus();
    unmount();
    expect(opener).toHaveFocus();
    opener.remove();
  });
});
