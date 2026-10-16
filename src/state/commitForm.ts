import { create } from "zustand";
import * as ipc from "../ipc/commit";
import type { CommitTemplate } from "../ipc/commit";
import { isIpcError } from "../ipc/core";
import type { RepoId } from "../ipc/types";
import { pushDefaults } from "../lib/pushTarget";
import { useGraphStore } from "./graph";
import { useOpsStore } from "./ops";
import { remotesOf, useRemotesStore } from "./remotes";
import { reportError, useUiStore } from "./ui";

export const SIGNOFF_KEY = "gitbranch.commit.signoff";

/** Per-repo commit form state. */
export interface FormState {
  message: string;
  amend: boolean;
  templateSource: CommitTemplate["source"] | null;
  committing: boolean;
  /** Template text last loaded (to detect an untouched template). */
  templateMessage: string | null;
  /** Message before the amend prefill replaced it; null when nothing was replaced. */
  previousMessage: string | null;
}

interface CommitFormState {
  byRepo: Record<RepoId, FormState>;
  signoff: boolean;
  setMessage: (repoId: RepoId, m: string) => void;
  setAmend: (repoId: RepoId, on: boolean) => Promise<void>;
  setSignoff: (on: boolean) => void;
  loadTemplate: (repoId: RepoId) => Promise<void>;
  commit: (repoId: RepoId) => Promise<boolean>;
  /** Commit, then push the current branch (sets the upstream when it has none). */
  commitAndPush: (repoId: RepoId) => Promise<boolean>;
  /** Forget one repo's form, or all of them. Invalidates in-flight replies. */
  reset: (repoId?: RepoId) => void;
}

function readSignoff(): boolean {
  try {
    return localStorage.getItem(SIGNOFF_KEY) === "1";
  } catch {
    return false;
  }
}

export const EMPTY_FORM: FormState = {
  message: "",
  amend: false,
  templateSource: null,
  committing: false,
  templateMessage: null,
  previousMessage: null,
};

/** Selector helper: the form of `repoId`, or the shared empty form. */
export function forRepo(s: Pick<CommitFormState, "byRepo">, repoId: RepoId): FormState {
  return s.byRepo[repoId] ?? EMPTY_FORM;
}

export const useCommitFormStore = create<CommitFormState>((set, get) => {
  // Bumped by reset(); async replies captured before a reset are dropped.
  let generation = 0;
  // Oid of the commit made by the latest commit() call (for commitAndPush messages).
  let lastOid = "";

  const patch = (repoId: RepoId, p: Partial<FormState>): void =>
    set((s) => ({ byRepo: { ...s.byRepo, [repoId]: { ...forRepo(s, repoId), ...p } } }));
  const cur = (repoId: RepoId): FormState => forRepo(get(), repoId);

  return {
    byRepo: {},
    signoff: readSignoff(),

    setMessage: (repoId, message) => patch(repoId, { message }),

    setAmend: async (repoId, on) => {
      if (!on) {
        const { previousMessage } = cur(repoId);
        patch(
          repoId,
          previousMessage !== null
            ? { amend: false, message: previousMessage, previousMessage: null }
            : { amend: false },
        );
        return;
      }
      patch(repoId, { amend: true });
      const { message, templateMessage } = cur(repoId);
      if (message.trim() !== "" && message !== templateMessage) return;
      const gen = generation;
      try {
        const head = await ipc.headMessage(repoId);
        if (gen !== generation) return;
        // The user may have toggled off or typed while we waited.
        if (!cur(repoId).amend) return;
        const now = cur(repoId).message;
        if (now.trim() !== "" && now !== templateMessage) return;
        patch(repoId, { message: head, previousMessage: now, templateSource: null });
      } catch (e) {
        if (gen !== generation) return;
        patch(repoId, { amend: false });
        reportError(e, "Could not read the last commit message");
      }
    },

    setSignoff: (signoff) => {
      set({ signoff });
      try {
        localStorage.setItem(SIGNOFF_KEY, signoff ? "1" : "0");
      } catch {
        /* storage unavailable */
      }
    },

    loadTemplate: async (repoId) => {
      const gen = generation;
      try {
        const t = await ipc.commitTemplate(repoId);
        if (gen !== generation) return;
        const { message, templateMessage, amend } = cur(repoId);
        if (t === null) {
          // The merge/squash message is gone (operation finished or aborted): drop it unless edited.
          if (templateMessage !== null && message === templateMessage) {
            patch(repoId, { message: "", templateSource: null, templateMessage: null });
          }
          return;
        }
        if (message.trim() !== "" || amend) return;
        patch(repoId, { message: t.message, templateSource: t.source, templateMessage: t.message });
      } catch (e) {
        if (gen !== generation) return;
        reportError(e, "Could not load the commit template");
      }
    },

    commit: async (repoId) => {
      const { message, amend, committing } = cur(repoId);
      const { signoff } = get();
      if (committing || message.trim() === "") return false;
      patch(repoId, { committing: true });
      try {
        const oid = await ipc.commit(repoId, {
          message,
          amend,
          signoff,
          allowEmpty: false,
          noVerify: false,
        });
        lastOid = oid;
        patch(repoId, { ...EMPTY_FORM });
        useUiStore.getState().pushToast({ kind: "success", title: `Committed ${oid.slice(0, 7)}` });
        return true;
      } catch (e) {
        patch(repoId, { committing: false });
        if (isIpcError(e) && e.error.code === "arg.invalid") {
          useUiStore.getState().pushToast({ kind: "error", title: e.error.message });
        } else {
          reportError(e, "Commit failed");
        }
        return false;
      }
    },

    commitAndPush: async (repoId) => {
      const ui = useUiStore.getState();
      if (useOpsStore.getState().busy) {
        ui.pushToast({ kind: "error", title: "Another operation is running" });
        return false;
      }
      if (!(await get().commit(repoId))) return false;
      const label = `Committed ${lastOid.slice(0, 7)}`;
      const skip = (reason: string): false => {
        useUiStore.getState().pushToast({ kind: "info", title: `${label}, not pushed: ${reason}` });
        return false;
      };
      const refs = useGraphStore.getState().byRepo[repoId]?.refs ?? null;
      if (refs === null) return skip("refs not loaded");
      const d = pushDefaults(refs, remotesOf(useRemotesStore.getState(), repoId));
      if (d === null) return skip("no remotes");
      if (d.branch === null) return skip("HEAD is detached");
      return useOpsStore.getState().push(repoId, {
        remote: d.remote,
        branch: d.branch,
        remoteBranch: d.remoteBranch,
        setUpstream: d.setUpstream,
        tags: false,
        forceWithLease: false,
      });
    },

    reset: (repoId) => {
      generation += 1;
      if (repoId === undefined) {
        set({ byRepo: {} });
      } else {
        set((s) => {
          const rest = { ...s.byRepo };
          delete rest[repoId];
          return { byRepo: rest };
        });
      }
    },
  };
});
