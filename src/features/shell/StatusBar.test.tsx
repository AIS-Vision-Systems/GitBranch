import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { RepoId } from "../../ipc/types";
import { useProgressStore } from "../../state/progress";
import { StatusBar } from "./StatusBar";

beforeEach(() => useProgressStore.setState({ active: null, cancelling: false }));

describe("StatusBar", () => {
  it("shows the version and no progress when idle", () => {
    render(<StatusBar version="1.2.3" />);
    expect(screen.getByText("v1.2.3")).toBeTruthy();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("hosts the progress of the running operation", () => {
    useProgressStore
      .getState()
      .start({ opId: "op", repoId: "r1" as RepoId, title: "Fetching origin" });
    render(<StatusBar version="1.2.3" />);
    expect(screen.getByRole("progressbar", { name: "Fetching origin" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
    expect(screen.getByText("v1.2.3")).toBeTruthy();
  });
});
