import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RepoId } from "../../ipc/types";
import { githubAvatar, githubAvatarByEmail } from "../../ipc/github";
import { useGithubStore } from "../../state/github";
import { useRemotesStore } from "../../state/remotes";
import { useAuthorAvatar } from "./useAuthorAvatar";
import { resetAvatarCache } from "./useAvatar";

vi.mock("../../ipc/github", () => ({ githubAvatar: vi.fn(), githubAvatarByEmail: vi.fn() }));

const GH = "gh" as RepoId;
const LAB = "lab" as RepoId;

beforeEach(() => {
  resetAvatarCache();
  vi.mocked(githubAvatar).mockReset();
  vi.mocked(githubAvatarByEmail).mockReset();
  vi.mocked(githubAvatar).mockResolvedValue("data:image/png;base64,LOGIN");
  vi.mocked(githubAvatarByEmail).mockResolvedValue("data:image/png;base64,EMAIL");
  useGithubStore.setState({ account: null });
  useRemotesStore.setState({
    byRepo: {
      [GH]: [{ name: "origin", fetchUrl: "git@github.com:acme/app.git", pushUrl: "" }],
      [LAB]: [{ name: "origin", fetchUrl: "https://gitlab.com/acme/app.git", pushUrl: "" }],
    },
  } as never);
});

describe("useAuthorAvatar", () => {
  it("resolves unknown authors by email when the repo has a GitHub remote", async () => {
    const { result } = renderHook(() => useAuthorAvatar("Anthony@Example.com", GH));
    await waitFor(() => expect(result.current).toBe("data:image/png;base64,EMAIL"));
    expect(githubAvatarByEmail).toHaveBeenCalledWith("anthony@example.com");
    expect(githubAvatar).not.toHaveBeenCalled();
  });

  it("sends no email for repos without a GitHub remote, or without a repo", () => {
    expect(renderHook(() => useAuthorAvatar("a@example.com", LAB)).result.current).toBeNull();
    expect(renderHook(() => useAuthorAvatar("a@example.com")).result.current).toBeNull();
    expect(githubAvatarByEmail).not.toHaveBeenCalled();
  });

  it("prefers the lookup-free login path", async () => {
    const { result } = renderHook(() => useAuthorAvatar("1+alice@users.noreply.github.com", GH));
    await waitFor(() => expect(result.current).toBe("data:image/png;base64,LOGIN"));
    expect(githubAvatar).toHaveBeenCalledWith("alice");
    expect(githubAvatarByEmail).not.toHaveBeenCalled();
  });

  it("shows initials (null) when the CDN has no photo for the email", async () => {
    vi.mocked(githubAvatarByEmail).mockResolvedValue(null);
    const { result } = renderHook(() => useAuthorAvatar("nobody@example.com", GH));
    await waitFor(() => expect(githubAvatarByEmail).toHaveBeenCalledTimes(1));
    expect(result.current).toBeNull();
  });
});
