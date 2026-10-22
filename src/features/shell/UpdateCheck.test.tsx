import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { useUpdaterStore } from "../../state/updater";
import { UpdateCheck } from "./UpdateCheck";

describe("UpdateCheck", () => {
  it("renders the error hint when the status is error", () => {
    useUpdaterStore.setState({ status: "error", error: "offline" });
    render(<UpdateCheck />);
    expect(screen.getByRole("alert")).toHaveTextContent("Update check failed: offline");
    expect(screen.getByRole("button", { name: "Check for updates" })).toBeEnabled();
  });
});
