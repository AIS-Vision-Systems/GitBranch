import { create } from "zustand";
import * as ipc from "../ipc/github";
import type { GithubAccount, GithubDeviceCode, GithubRepo, GithubStatus } from "../ipc/github";
import { classifyGithubError } from "../lib/githubErrors";
import type { GithubProblem } from "../lib/githubErrors";
import { isIpcError } from "../ipc/core";

export type LoginState =
  | { step: "idle" }
  | { step: "starting" }
  | { step: "code"; code: GithubDeviceCode; startedAt: number }
  | { step: "done" }
  | { step: "error"; message: string; code: string };

interface GithubState {
  /** undefined = not loaded yet. */
  account: GithubAccount | null | undefined;
  loading: boolean;
  error: string | null;
  login: LoginState;
  repos: GithubRepo[] | null;
  reposLoading: boolean;
  reposError: string | null;
  reposProblem: GithubProblem | null;
  status: GithubStatus | null;
  /** Last GitHub problem (offline, rate limit, ...); cleared by the next successful call. */
  problem: GithubProblem | null;
  loadStatus: () => Promise<void>;
  noteError: (e: unknown) => void;
  noteSuccess: () => void;
  clearProblem: () => void;
  loadRepos: (force?: boolean) => Promise<void>;
  refresh: () => Promise<void>;
  startLogin: (workflow: boolean) => Promise<void>;
  cancelLogin: () => Promise<void>;
  resetLogin: () => void;
  logout: () => Promise<void>;
  /** The backend said the token is invalid: drop the account locally (no backend call). */
  signedOut: () => void;
}

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const codeOf = (e: unknown): string => (isIpcError(e) ? e.error.code : "ipc.unknown");

/** Login reject codes that mean "nothing to report": the user cancelled, or no login was pending. */
const SILENT_CODES = new Set(["github.cancelled", "github.no_login"]);

export const useGithubStore = create<GithubState>((set, get) => {
  // Bumped by every startLogin and cancelLogin; a stale attempt must not touch the state.
  let generation = 0;
  return {
    account: undefined,
    loading: false,
    error: null,
    login: { step: "idle" },
    repos: null,
    reposLoading: false,
    reposError: null,
    reposProblem: null,
    status: null,
    problem: null,

    loadStatus: async () => {
      try {
        const status = await ipc.githubStatus();
        set({ status });
      } catch {
        // Informational only.
      }
    },

    noteError: (e) => {
      set({ problem: classifyGithubError(e) });
      void get().loadStatus();
    },

    noteSuccess: () => {
      const st = get().status;
      set({ problem: null, ...(st !== null ? { status: { ...st, online: true } } : {}) });
    },

    clearProblem: () => set({ problem: null }),

    loadRepos: async (force = false) => {
      const st = get();
      if (st.reposLoading || (!force && st.repos !== null)) return;
      set({ reposLoading: true, reposError: null, reposProblem: null });
      try {
        const repos = await ipc.githubRepos();
        set({ repos, reposLoading: false });
        get().noteSuccess();
      } catch (e) {
        set({
          reposLoading: false,
          reposError: messageOf(e),
          reposProblem: classifyGithubError(e),
        });
        get().noteError(e);
      }
    },

    refresh: async () => {
      set({ loading: true, error: null });
      try {
        const account = await ipc.githubAccount();
        set({ account, loading: false });
        get().clearProblem();
      } catch (e) {
        set({ loading: false, error: messageOf(e) });
      }
    },

    startLogin: async (workflow) => {
      const gen = ++generation;
      set({ login: { step: "starting" } });
      try {
        const code = await ipc.githubLoginStart(workflow);
        if (gen !== generation) {
          // Cancelled while starting: stop the backend poll that just began.
          await ipc.githubLoginCancel().catch(() => undefined);
          return;
        }
        set({ login: { step: "code", code, startedAt: Date.now() } });
        const account = await ipc.githubLoginWait();
        if (gen !== generation) return;
        set({ account, error: null, login: { step: "done" } });
      } catch (e) {
        if (gen !== generation) return;
        const code = codeOf(e);
        if (SILENT_CODES.has(code)) set({ login: { step: "idle" } });
        else set({ login: { step: "error", message: messageOf(e), code } });
      }
    },

    cancelLogin: async () => {
      generation++;
      set({ login: { step: "idle" } });
      try {
        await ipc.githubLoginCancel();
      } catch {
        // Nothing pending to cancel.
      }
    },

    resetLogin: () => set({ login: { step: "idle" } }),

    signedOut: () => set({ account: null, error: null, repos: null, reposError: null }),

    logout: async () => {
      try {
        await ipc.githubLogout();
        set({ account: null, error: null, repos: null, reposError: null });
      } catch (e) {
        set({ error: messageOf(e) });
      }
    },
  };
});
