import { fireEvent, render } from "@testing-library/react";
import { waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Ref } from "../../ipc/types";
import type { RepoId } from "../../ipc/types";
import { useOpsStore } from "../../state/ops";
import { useRemotesStore } from "../../state/remotes";
import { resetAvatarCache } from "../github/useAvatar";
import { RefChip } from "./RefChip";

const local = (name: string, over: Partial<Ref> = {}): Ref => ({
  name,
  fullName: `refs/heads/${name}`,
  kind: "localBranch",
  target: "c0",
  upstream: null,
  isHead: false,
  ...over,
});
const remote = (name: string): Ref => ({
  name,
  fullName: `refs/remotes/${name}`,
  kind: { remoteBranch: { remote: name.split("/")[0]! } },
  target: "c0",
  upstream: null,
  isHead: false,
});
const up = { name: "origin/main", ahead: 0, behind: 0, gone: false };

const checkout = vi.fn().mockResolvedValue(true);
vi.mock("../../ipc/github", () => ({
  githubAvatar: vi.fn((login: string) => Promise.resolve(`data:image/png;base64,${login}`)),
}));
beforeEach(() => {
  resetAvatarCache();
  useRemotesStore.setState({ byRepo: {} } as never);
  checkout.mockClear();
  useOpsStore.setState({ checkout } as never);
});

describe("RefChip double-click", () => {
  const rid = "r1" as RepoId;
  const tag: Ref = {
    ...local("v1"),
    fullName: "refs/tags/v1",
    kind: { tag: { annotated: false } },
  };

  it("checks out a local branch", () => {
    const { container } = render(<RefChip repoId={rid} gitRef={local("dev")} />);
    const chip = container.firstElementChild as HTMLElement;
    expect(chip.title).toContain("Double-click to checkout");
    fireEvent.doubleClick(chip);
    expect(checkout).toHaveBeenCalledWith(rid, "dev");
  });

  it("checks out a remote branch by its full name", () => {
    const { container } = render(<RefChip repoId={rid} gitRef={remote("origin/dev")} />);
    fireEvent.doubleClick(container.firstElementChild as HTMLElement);
    expect(checkout).toHaveBeenCalledWith(rid, "origin/dev");
  });

  it("ignores tags and the current branch", () => {
    const t = render(<RefChip repoId={rid} gitRef={tag} />);
    fireEvent.doubleClick(t.container.firstElementChild as HTMLElement);
    const h = render(<RefChip repoId={rid} gitRef={local("main", { isHead: true })} />);
    fireEvent.doubleClick(h.container.firstElementChild as HTMLElement);
    expect(checkout).not.toHaveBeenCalled();
  });
});

describe("RefChip", () => {
  it("HEAD chip has the check icon, others do not", () => {
    const head = render(<RefChip gitRef={local("main", { isHead: true })} />);
    expect(head.container.querySelector('[data-icon="check"]')).not.toBeNull();
    const other = render(<RefChip gitRef={local("dev")} />);
    expect(other.container.querySelector('[data-icon="check"]')).toBeNull();
  });

  it("a local branch with its upstream shows the cloud icon and ahead/behind", () => {
    const { container } = render(
      <RefChip gitRef={local("main", { upstream: { ...up, ahead: 2, behind: 1 } })} withUpstream />,
    );
    expect(container.querySelector('[data-icon="laptop"]')).not.toBeNull();
    expect(container.querySelector('[data-icon="cloud"]')).not.toBeNull();
    expect(container.textContent).toContain("↑2 ↓1");
  });

  it("a remote chip dims the origin/ prefix", () => {
    const { container } = render(<RefChip gitRef={remote("origin/dev")} />);
    expect(container.querySelector('[data-icon="cloud"]')).not.toBeNull();
    expect(container.textContent?.endsWith("origin/dev")).toBe(true);
  });

  it("a tag chip has the tag icon", () => {
    const tag: Ref = {
      ...local("v1"),
      fullName: "refs/tags/v1",
      kind: { tag: { annotated: false } },
    };
    const { container } = render(<RefChip gitRef={tag} />);
    expect(container.querySelector('[data-icon="tag"]')).not.toBeNull();
  });
});

describe("RefChip remote logos", () => {
  const rid = "r1" as RepoId;
  const rem = (name: string, owner: string) => ({
    name,
    fetchUrl: `https://github.com/${owner}/x.git`,
    pushUrl: `https://github.com/${owner}/x.git`,
  });

  it("orders check, name, laptop, then one logo per remote with titles", async () => {
    useRemotesStore.setState({
      byRepo: { [rid]: [rem("origin", "alice"), rem("fork", "bob")] },
    } as never);
    const { container } = render(
      <RefChip
        repoId={rid}
        gitRef={local("main", { isHead: true })}
        remotes={["origin", "fork"]}
      />,
    );
    await waitFor(() => expect(container.querySelectorAll("img")).toHaveLength(2));
    const kids = Array.from(container.firstElementChild!.childNodes) as Element[];
    expect(kids[0]!.getAttribute("data-icon")).toBe("check");
    expect(kids[1]!.textContent).toBe("main");
    expect(kids[2]!.getAttribute("data-icon")).toBe("laptop");
    expect(kids.slice(3).map((k) => k.tagName)).toEqual(["IMG", "IMG"]);
    expect(kids.slice(3).map((k) => k.getAttribute("title"))).toEqual(["origin", "fork"]);
  });

  it("falls back to a titled cloud icon without an avatar", () => {
    const { container } = render(
      <RefChip repoId={rid} gitRef={local("dev")} remotes={["origin"]} />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector('[data-icon="cloud"] title')?.textContent).toBe("origin");
  });
});
