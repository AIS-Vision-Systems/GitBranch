import { beforeEach, describe, expect, it, vi } from "vitest";
import { gitIdentity } from "../ipc/identity";
import type { RepoId } from "../ipc/types";
import { useIdentityStore } from "./identity";

vi.mock("../ipc/identity", () => ({ gitIdentity: vi.fn() }));

const ident = (email: string) => ({
  name: { value: "Ann", scope: "global" },
  email: { value: email, scope: "global" },
});

const R1 = "r1" as RepoId;

beforeEach(() => {
  vi.mocked(gitIdentity).mockReset();
  useIdentityStore.setState({ byRepo: {} });
});

describe("identity store", () => {
  it("loads once per repo", async () => {
    vi.mocked(gitIdentity).mockResolvedValue(ident("a@x.io"));
    await useIdentityStore.getState().load(R1);
    await useIdentityStore.getState().load(R1);
    expect(gitIdentity).toHaveBeenCalledTimes(1);
    expect(useIdentityStore.getState().byRepo[R1]).toEqual({ name: "Ann", email: "a@x.io" });
  });
  it("force reloads", async () => {
    vi.mocked(gitIdentity).mockResolvedValueOnce(ident("a@x.io"));
    await useIdentityStore.getState().load(R1);
    vi.mocked(gitIdentity).mockResolvedValueOnce(ident("b@x.io"));
    await useIdentityStore.getState().load(R1, true);
    expect(useIdentityStore.getState().byRepo[R1]?.email).toBe("b@x.io");
  });
  it("ignores errors", async () => {
    vi.mocked(gitIdentity).mockRejectedValue(new Error("boom"));
    await expect(useIdentityStore.getState().load(R1)).resolves.toBeUndefined();
    expect(useIdentityStore.getState().byRepo[R1]).toBeUndefined();
  });
});
