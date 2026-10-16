const MIN = 60;
const HOUR = 3600;
const DAY = 86400;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

/** Short relative time ("5m ago", "3d ago"). Both arguments are unix seconds. */
export function formatRelative(unixSec: number, now: number): string {
  const d = now - unixSec;
  if (d < MIN) return "just now";
  if (d < HOUR) return `${Math.floor(d / MIN)}m ago`;
  if (d < DAY) return `${Math.floor(d / HOUR)}h ago`;
  if (d < WEEK) return `${Math.floor(d / DAY)}d ago`;
  if (d < MONTH) return `${Math.floor(d / WEEK)}w ago`;
  if (d < YEAR) return `${Math.floor(d / MONTH)}mo ago`;
  return `${Math.floor(d / YEAR)}y ago`;
}
