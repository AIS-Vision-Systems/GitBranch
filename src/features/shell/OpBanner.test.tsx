import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InProgress } from "../../ipc/merge";
import type { RepoId, StatusEntry } from "../../ipc/types";
import { EMPTY_GRAPH, useGraphStore } from "../../state/graph";
import { useOpsStore } from "../../state/ops";
import { OpBanner } from "./OpBanner";
import { opBannerText } from "./opBannerText";

const id = "r1" as RepoId;
const opAbort = vi.fn();
const opContinue = vi.fn();
const opSkip = vi.fn();

const entry = (path: string, conflicted: boolean): StatusEntry => ({
  path,
  origPath: null,
  staged: "unmodified",
  unstaged: "modified",
  conflicted,
  submodule: false,
});

function seed(inProgress: InProgress | null, entries: StatusEntry[]): void {
  useGraphStore.setState({
    byRepo: {
      [id]: { ...EMPTY_GRAPH, inProgress, status: { branch: null, entries } },
    },
  });
}

const rebaseOp: InProgress = {
  kind: "rebase",
  headName: "refs/heads/feat",
  onto: "abcdef1234567890abcdef1234567890abcdef12",
  done: 3,
  total: 7,
};

beforeEach(() => {
  vi.clearAllMocks();
  useOpsStore.setState({ opAbort, opContinue, opSkip, busy: false });
});

describe("OpBanner", () => {
  it("renders nothing when no operation is in progress", () => {
    seed(null, []);
    const { container } = render(<OpBanner repoId={id} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("describes a rebase and disables Continue while conflicts remain", async () => {
    seed(rebaseOp, [entry("a", true), entry("b", true), entry("c", false)]);
    render(<OpBanner repoId={id} />);
    expect(screen.getByText("Rebase in progress (3/7) — rebasing feat onto abcdef1")).toBeVisible();
    expect(screen.getByText("2 conflicted files")).toBeVisible();
    const cont = screen.getByRole("button", { name: "Continue" });
    expect(cont).toBeDisabled();
    expect(cont).toHaveAttribute("title", "Resolve all conflicts first");
    await userEvent.click(screen.getByRole("button", { name: "Abort" }));
    expect(opAbort).toHaveBeenCalledWith(id, "rebase");
    await userEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(opSkip).toHaveBeenCalledWith(id, "rebase");
  });

  it("enables Continue once resolved; merge has no Skip", async () => {
    seed({ kind: "merge", headName: null, onto: null, done: 0, total: 0 }, [entry("c", false)]);
    render(<OpBanner repoId={id} />);
    expect(screen.queryByRole("button", { name: "Skip" })).toBeNull();
    const cont = screen.getByRole("button", { name: "Continue" });
    expect(cont).toBeEnabled();
    await userEvent.click(cont);
    expect(opContinue).toHaveBeenCalledWith(id, "merge");
  });

  it("opBannerText covers the other kinds", () => {
    const base = { headName: null, onto: null, done: 0, total: 0 };
    expect(opBannerText({ ...base, kind: "merge" })).toBe("Merge in progress");
    expect(opBannerText({ ...base, kind: "cherryPick" })).toBe("Cherry-pick in progress");
    expect(opBannerText({ ...base, kind: "revert" })).toBe("Revert in progress");
  });
});
