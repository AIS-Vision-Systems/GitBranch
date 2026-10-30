import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import type { RepoId } from "./types";
import {
  sshAddKey,
  sshEnableWindowsAgent,
  sshReport,
  sshTestRemote,
  sshUseWindowsOpenssh,
} from "./ssh";

const inv = vi.mocked(invoke);
beforeEach(() => {
  inv.mockReset();
  inv.mockResolvedValue(undefined);
});

describe("ssh ipc", () => {
  it("passes camelCase args", async () => {
    await sshReport(null);
    await sshReport("r1" as RepoId);
    await sshEnableWindowsAgent();
    await sshUseWindowsOpenssh();
    await sshAddKey("/k", "pw");
    await sshTestRemote("r1" as RepoId, "origin");
    expect(inv.mock.calls).toEqual([
      ["ssh_report", { repoId: null }],
      ["ssh_report", { repoId: "r1" }],
      ["ssh_enable_windows_agent", undefined],
      ["ssh_use_windows_openssh", undefined],
      ["ssh_add_key", { path: "/k", passphrase: "pw" }],
      ["ssh_test_remote", { repoId: "r1", remote: "origin" }],
    ]);
  });
});
