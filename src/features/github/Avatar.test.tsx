import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { githubAvatar } from "../../ipc/github";
import { useGithubStore } from "../../state/github";
import { useIdentityStore } from "../../state/identity";
import { Avatar } from "./Avatar";
import { resetAvatarCache } from "./useAvatar";
import type { RepoId } from "../../ipc/types";

const R1 = "r1" as RepoId;

vi.mock("../../ipc/github", () => ({ githubAvatar: vi.fn() }));

beforeEach(() => {
  resetAvatarCache();
  vi.mocked(githubAvatar).mockReset();
  useGithubStore.setState({ account: null });
});

describe("Avatar", () => {
  it("shows the GitHub photo for a noreply author", async () => {
    vi.mocked(githubAvatar).mockResolvedValue("data:image/png;base64,AAAA");
    render(<Avatar name="Alice Doe" email="1+alice@users.noreply.github.com" size={24} />);
    const img = await screen.findByRole("img");
    expect(img.getAttribute("src")).toBe("data:image/png;base64,AAAA");
    expect(githubAvatar).toHaveBeenCalledWith("alice");
  });
  it("shows the signed-in user's photo for the repo's git identity email", async () => {
    vi.mocked(githubAvatar).mockResolvedValue("data:image/png;base64,BBBB");
    useGithubStore.setState({
      account: { user: { login: "xavi", email: null } },
    } as unknown as Partial<ReturnType<typeof useGithubStore.getState>>);
    useIdentityStore.setState({ byRepo: { [R1]: { name: "X", email: "me@work.io" } } });
    render(<Avatar name="X" email="me@work.io" size={24} repoId={R1} />);
    const img = await screen.findByRole("img");
    expect(img.getAttribute("src")).toBe("data:image/png;base64,BBBB");
    expect(githubAvatar).toHaveBeenCalledWith("xavi");
    useIdentityStore.setState({ byRepo: {} });
  });
  it("falls back to initials for unknown authors", () => {
    render(<Avatar name="Bob Smith" email="bob@example.com" size={24} />);
    expect(screen.getByText("BS")).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
    expect(githubAvatar).not.toHaveBeenCalled();
  });
});
