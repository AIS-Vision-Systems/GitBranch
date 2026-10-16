import { create } from "zustand";
import { cancelOp } from "../ipc/progress";
import type { OpProgress } from "../ipc/progress";
import type { RepoId } from "../ipc/types";
import { reportError } from "./ui";

export interface ActiveOp {
  opId: string;
  repoId: RepoId;
  title: string;
  phase: string;
  pct: number | null;
  msg: string;
  startedAt: number;
}

interface ProgressState {
  active: ActiveOp | null;
  cancelling: boolean;
  start: (op: { opId: string; repoId: RepoId; title: string }) => void;
  update: (ev: OpProgress) => void;
  finish: (opId: string) => void;
  cancel: () => Promise<void>;
}

/** Progress of the one running network operation. Events are fed by `App` via `onOpProgress`. */
export const useProgressStore = create<ProgressState>((set, get) => ({
  active: null,
  cancelling: false,
  start: (op) =>
    set({
      active: { ...op, phase: "", pct: null, msg: "", startedAt: Date.now() },
      cancelling: false,
    }),
  update: (ev) =>
    set((s) =>
      s.active?.opId !== ev.opId
        ? s
        : { active: { ...s.active, phase: ev.phase, pct: ev.pct, msg: ev.msg } },
    ),
  finish: (opId) => set((s) => (s.active?.opId === opId ? { active: null, cancelling: false } : s)),
  cancel: async () => {
    const { active, cancelling } = get();
    if (active === null || cancelling) return;
    set({ cancelling: true });
    try {
      const ok = await cancelOp(active.opId);
      if (!ok) set({ cancelling: false });
    } catch (e) {
      set({ cancelling: false });
      reportError(e, "Cancel failed");
    }
  },
}));
