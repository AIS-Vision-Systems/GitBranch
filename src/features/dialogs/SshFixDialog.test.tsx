import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../ipc/ssh", async (orig) => ({
  ...(await orig<typeof SshModule>()),
  sshReport: vi.fn(),
  sshEnableWindowsAgent: vi.fn(),
  sshUseWindowsOpenssh: vi.fn(),
  sshAddKey: vi.fn(),
  sshTestRemote: vi.fn(),
}));

import { IpcError } from "../../ipc/core";
import type { GithubAccount } from "../../ipc/github";
import type * as SshModule from "../../ipc/ssh";
import * as ssh from "../../ipc/ssh";
import type { SshKey, SshReport } from "../../ipc/ssh";
import type { RepoId } from "../../ipc/types";
import { useGithubStore } from "../../state/github";
import { useRemotesStore } from "../../state/remotes";
import { SshFixDialog } from "./SshFixDialog";

const id = "r1" as RepoId;
const key = (over: Partial<SshKey> = {}): SshKey => ({
  path: "C:/Users/x/.ssh/id_ed25519",
  kind: "ED25519",
  fingerprint: "SHA256:abcdefghijklmnopqrstuvwxyz0123456789",
  comment: "me@host",
  encrypted: false,
  badPermissions: false,
  loaded: false,
  ...over,
});
const report = (over: Partial<SshReport> = {}): SshReport => ({
  windows: false,
  sshCommand: null,
  sshCommandScope: null,
  usesWindowsOpenssh: false,
  windowsSshCommand: null,
  windowsAgent: null,
  agent: { kind: "ready", keys: 0 },
  keys: [key()],
  toolsError: null,
  ...over,
});

function setup(remote: string | null = "origin", repoId: RepoId | null = id) {
  const onClose = vi.fn();
  render(<SshFixDialog repoId={repoId} remote={remote} onClose={onClose} />);
  return onClose;
}

beforeEach(() => {
  vi.resetAllMocks();
  useGithubStore.setState({ account: null });
  useRemotesStore.setState({
    byRepo: {
      [id]: [{ name: "origin", fetchUrl: "git@github.com:octo/repo.git", pushUrl: null }],
    },
  });
});

describe("SshFixDialog", () => {
  it("offers to enable a disabled Windows agent", async () => {
    vi.mocked(ssh.sshReport).mockResolvedValue(
      report({
        windows: true,
        windowsAgent: "disabled",
        windowsSshCommand: "C:/x/ssh.exe",
        keys: [],
      }),
    );
    setup();
    expect(await screen.findByRole("button", { name: "Enable agent" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use it" })).toBeInTheDocument();
    expect(screen.getByText(/no SSH key in ~\/\.ssh/)).toBeInTheDocument();
  });

  it("shows a loaded key as done without a Load button", async () => {
    vi.mocked(ssh.sshReport).mockResolvedValue(report({ keys: [key({ loaded: true })] }));
    setup();
    expect(await screen.findByText("Loaded in the agent")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Load/ })).toBeNull();
  });

  it("loads an encrypted key with its passphrase, clears the input and maps a wrong passphrase", async () => {
    vi.mocked(ssh.sshReport).mockResolvedValue(report({ keys: [key({ encrypted: true })] }));
    vi.mocked(ssh.sshAddKey).mockRejectedValue(
      new IpcError({ code: "ssh.bad_passphrase", message: "bad" }),
    );
    setup();
    const input = await screen.findByLabelText(/Passphrase for/);
    await userEvent.type(input, "secret");
    await userEvent.click(screen.getByRole("button", { name: /^Load/ }));
    expect(ssh.sshAddKey).toHaveBeenCalledWith("C:/Users/x/.ssh/id_ed25519", "secret");
    expect(await screen.findByText("Wrong passphrase")).toBeInTheDocument();
    expect(input).toHaveValue("");
  });

  it("reloads the report after a successful load", async () => {
    vi.mocked(ssh.sshReport)
      .mockResolvedValueOnce(report())
      .mockResolvedValue(report({ keys: [key({ loaded: true })] }));
    vi.mocked(ssh.sshAddKey).mockResolvedValue(undefined);
    setup();
    await userEvent.click(await screen.findByRole("button", { name: /^Load/ }));
    expect(ssh.sshAddKey).toHaveBeenCalledWith("C:/Users/x/.ssh/id_ed25519", null);
    expect(await screen.findByText("Loaded in the agent")).toBeInTheDocument();
  });

  it("tests the connection", async () => {
    vi.mocked(ssh.sshReport).mockResolvedValue(report());
    vi.mocked(ssh.sshTestRemote).mockResolvedValue(undefined);
    setup();
    await userEvent.click(await screen.findByRole("button", { name: "Test connection" }));
    expect(ssh.sshTestRemote).toHaveBeenCalledWith(id, "origin");
    expect(await screen.findByText("Connected to origin")).toBeInTheDocument();
  });

  it("shows the HTTPS button only for a github SSH remote while signed in", async () => {
    vi.mocked(ssh.sshReport).mockResolvedValue(report());
    const { unmount } = render(<SshFixDialog repoId={id} remote="origin" onClose={vi.fn()} />);
    await screen.findByText("Keys");
    expect(screen.queryByRole("button", { name: "Use HTTPS for origin" })).toBeNull();
    unmount();
    useGithubStore.setState({ account: { offline: false } as GithubAccount });
    render(<SshFixDialog repoId={id} remote="origin" onClose={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Use HTTPS for origin" })).toBeInTheDocument(),
    );
  });

  it("hides the connection test without a remote", async () => {
    vi.mocked(ssh.sshReport).mockResolvedValue(report());
    setup(null, null);
    await screen.findByText("Keys");
    expect(screen.queryByRole("button", { name: "Test connection" })).toBeNull();
  });

  it("keeps Load disabled for an encrypted key until a passphrase is typed", async () => {
    vi.mocked(ssh.sshReport).mockResolvedValue(report({ keys: [key({ encrypted: true })] }));
    setup();
    const load = await screen.findByRole("button", { name: /^Load/ });
    expect(load).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/Passphrase for/), "x");
    expect(load).toBeEnabled();
  });

  it("explains a key file with bad permissions and offers no Load", async () => {
    vi.mocked(ssh.sshReport).mockResolvedValue(report({ keys: [key({ badPermissions: true })] }));
    setup();
    expect(await screen.findByText(/other users can read/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Load/ })).toBeDisabled();
  });

  it("shows the tools error instead of the no-key text", async () => {
    vi.mocked(ssh.sshReport).mockResolvedValue(
      report({ keys: [], toolsError: "Windows OpenSSH client is not installed" }),
    );
    setup();
    expect(await screen.findByText("Windows OpenSSH client is not installed")).toBeInTheDocument();
    expect(screen.queryByText(/no SSH key in/)).toBeNull();
  });

  it("warns about a repo-local or environment ssh command", async () => {
    vi.mocked(ssh.sshReport).mockResolvedValue(
      report({
        windows: true,
        windowsAgent: "running",
        windowsSshCommand: "C:/x/ssh.exe",
        sshCommand: "other",
        sshCommandScope: "local",
      }),
    );
    setup();
    expect(
      await screen.findByText(/overrides it with its own core.sshCommand/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use it" })).toBeInTheDocument();
  });
});
