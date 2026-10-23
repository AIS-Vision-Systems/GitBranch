import { create } from "zustand";

export type Expanded = ReadonlySet<string> | "all";

interface TreeExpansionState {
  byKey: Record<string, Expanded>;
  get: (key: string) => Expanded | undefined;
  set: (key: string, e: Expanded) => void;
  reset: () => void;
}

/** Session-only (not persisted) expanded-folder state per tree key. */
export const useTreeExpansionStore = create<TreeExpansionState>((set, get) => ({
  byKey: {},
  get: (key) => get().byKey[key],
  set: (key, e) => set((s) => ({ byKey: { ...s.byKey, [key]: e } })),
  reset: () => set({ byKey: {} }),
}));
