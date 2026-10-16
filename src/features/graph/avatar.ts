import { AVATAR_PALETTE } from "./constants";

/** Up to two uppercase letters: first letters of the first two words, or the first two letters of a single word. */
export function initials(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .filter((w) => w !== "");
  if (words.length === 0) return "?";
  const first = Array.from(words[0]!);
  if (words.length === 1) return first.slice(0, 2).join("").toUpperCase();
  return (first[0]! + (Array.from(words[1]!)[0] ?? "")).toUpperCase();
}

/** Stable palette index (0..11, see `--avatar-N`) for an author email (FNV-1a hash). */
export function avatarColor(email: string): number {
  let h = 0x811c9dc5;
  const s = email.trim().toLowerCase();
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % AVATAR_PALETTE;
}
