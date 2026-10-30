import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { initRepo } from "./init";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

beforeEach(() => vi.resetAllMocks());

describe("initRepo ipc", () => {
  it("sends the args under init_repo", async () => {
    vi.mocked(invoke).mockResolvedValue({ path: "/p/r", commitError: null });
    const args = { dest: "/p/r", initialBranch: null, readme: true };
    expect(await initRepo(args)).toEqual({ path: "/p/r", commitError: null });
    expect(invoke).toHaveBeenCalledWith("init_repo", { args });
  });
});
