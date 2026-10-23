import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RepoId } from "../../ipc/types";
import { useRemotesStore } from "../../state/remotes";
import { githubAvatar } from "../../ipc/github";
import { useRemoteAvatar } from "./remoteAvatar";
import { resetAvatarCache } from "./useAvatar";

vi.mock("../../ipc/github", () => ({ githubAvatar: vi.fn() }));

const rid = "r1" as RepoId;

beforeEach(() => {
  resetAvatarCache();
  vi.mocked(githubAvatar).mockReset();
  vi.mocked(githubAvatar).mockResolvedValue("data:image/png;base64,AA");
  useRemotesStore.setState({
    byRepo: {
      [rid]: [
        { name: "origin", fetchUrl: "git@github.com:acme/app.git", pushUrl: "" },
        { name: "lab", fetchUrl: "https://gitlab.com/acme/app.git", pushUrl: "" },
      ],
    },
  } as never);
});

describe("useRemoteAvatar", () => {
  it("fetches the avatar of the GitHub owner of the remote", async () => {
    const { result } = renderHook(() => useRemoteAvatar(rid, "origin"));
    await waitFor(() => expect(result.current).toBe("data:image/png;base64,AA"));
    expect(githubAvatar).toHaveBeenCalledWith("acme");
  });

  it("returns null for non-GitHub and unknown remotes", () => {
    expect(renderHook(() => useRemoteAvatar(rid, "lab")).result.current).toBeNull();
    expect(renderHook(() => useRemoteAvatar(rid, "nope")).result.current).toBeNull();
    expect(githubAvatar).not.toHaveBeenCalled();
  });
});
