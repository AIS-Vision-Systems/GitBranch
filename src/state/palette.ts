import { create } from "zustand";

export interface Command {
  id: string;
  title: string;
  /** Shortcut hint, e.g. "Ctrl+Shift+F". */
  shortcut?: string;
  run: () => void | Promise<void>;
}

interface PaletteState {
  open: boolean;
  show: () => void;
  hide: () => void;
  toggle: () => void;
}

export const usePaletteStore = create<PaletteState>((set) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
  toggle: () => set((s) => ({ open: !s.open })),
}));

/** Lower is better; null when `q` (lowercase) is not even a subsequence of `text`. */
function score(q: string, text: string): number | null {
  const t = text.toLowerCase();
  const sub = t.indexOf(q);
  if (sub === 0) return 0;
  if (sub > 0) return 1 + sub;
  let at = -1;
  let gaps = 0;
  for (const ch of q) {
    const next = t.indexOf(ch, at + 1);
    if (next < 0) return null;
    if (at >= 0) gaps += next - at - 1;
    at = next;
  }
  return 1000 + gaps;
}

/** Substring matches first (prefix best), then fuzzy subsequence matches; stable otherwise. */
export function filterCommands<T extends { title: string }>(query: string, commands: T[]): T[] {
  const q = query.trim().toLowerCase();
  if (q === "") return commands;
  const scored: { c: T; s: number; i: number }[] = [];
  commands.forEach((c, i) => {
    const s = score(q, c.title);
    if (s !== null) scored.push({ c, s, i });
  });
  scored.sort((a, b) => a.s - b.s || a.i - b.i);
  return scored.map((x) => x.c);
}
