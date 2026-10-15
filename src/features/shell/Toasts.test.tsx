import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { useUiStore } from "../../state/ui";
import { Toasts } from "./Toasts";

describe("Toasts", () => {
  beforeEach(() => useUiStore.setState({ toasts: [] }));

  it("renders a pushed toast and dismisses it", async () => {
    render(<Toasts />);
    act(() => {
      useUiStore.getState().pushToast({ kind: "error", title: "Kaboom", detail: "stack" });
    });
    expect(screen.getByText("Kaboom")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(screen.queryByText("Kaboom")).not.toBeInTheDocument();
  });
});
