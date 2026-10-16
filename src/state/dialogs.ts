import { create } from "zustand";
import { reportError } from "./ui";

interface ConfirmSpec {
  kind: "confirm";
  title: string;
  message: string;
  command?: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void | Promise<void>;
}

export type DialogSpec =
  ConfirmSpec | { kind: "custom"; id: string; props: Record<string, unknown> };

interface DialogsState {
  current: DialogSpec | null;
  busy: boolean;
  open: (d: DialogSpec) => void;
  close: () => void;
  setBusy: (b: boolean) => void;
}

export const useDialogsStore = create<DialogsState>((set) => ({
  current: null,
  busy: false,
  open: (d) => set({ current: d, busy: false }),
  close: () => set({ current: null, busy: false }),
  setBusy: (busy) => set({ busy }),
}));

/** Open a confirm dialog. Resolves true once onConfirm finished, false on cancel or error. */
export function confirm(spec: Omit<ConfirmSpec, "kind">): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const settle = (v: boolean): void => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    const wrapped: ConfirmSpec = {
      ...spec,
      kind: "confirm",
      onConfirm: async () => {
        useDialogsStore.getState().setBusy(true);
        try {
          await spec.onConfirm();
          settle(true);
        } catch (err) {
          reportError(err);
          settle(false);
        } finally {
          if (useDialogsStore.getState().current === wrapped) useDialogsStore.getState().close();
        }
      },
    };
    useDialogsStore.getState().open(wrapped);
    // Cancel (or replacement) clears `current` without running onConfirm.
    const unsub = useDialogsStore.subscribe((s) => {
      if (s.current !== wrapped) {
        unsub();
        settle(false);
      }
    });
  });
}
