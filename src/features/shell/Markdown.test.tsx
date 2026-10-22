import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Markdown } from "./Markdown";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

describe("Markdown", () => {
  it("renders semantic elements with heading ids", () => {
    const { container } = render(
      <Markdown source={"## Commit graph\n\n- a\n\n| H |\n| - |\n| `x` |\n\n```\ncode\n```"} />,
    );
    expect(screen.getByRole("heading", { level: 2 }).id).toBe("commit-graph");
    expect(container.querySelector("ul li")).not.toBeNull();
    expect(container.querySelector("table thead th")?.textContent).toBe("H");
    expect(container.querySelector("tbody td code")?.textContent).toBe("x");
    expect(container.querySelector("pre code")?.textContent).toBe("code");
  });

  it("renders http links as anchors and other schemes as plain text", () => {
    render(<Markdown source="[ok](https://a.b) and [bad](javascript:alert(1))" />);
    expect(screen.getByRole("link", { name: "ok" }).getAttribute("href")).toBe("https://a.b");
    expect(screen.queryByRole("link", { name: "bad" })).toBeNull();
    expect(screen.getByText("bad")).toBeTruthy();
  });
});
