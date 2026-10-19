import { isIpcError } from "../ipc/core";

export type GithubProblem =
  | { kind: "offline" }
  | { kind: "rateLimited"; resetAt: number | null }
  | { kind: "signedOut" }
  | { kind: "other"; message: string };

export function classifyGithubError(e: unknown): GithubProblem {
  if (isIpcError(e)) {
    switch (e.error.code) {
      case "github.network":
        return { kind: "offline" };
      case "github.rate_limit": {
        const n = Number(e.error.detail);
        const has = typeof e.error.detail === "string" && e.error.detail.trim() !== "";
        return { kind: "rateLimited", resetAt: has && Number.isFinite(n) ? n : null };
      }
      case "github.unauthorized":
        return { kind: "signedOut" };
    }
  }
  return { kind: "other", message: e instanceof Error ? e.message : String(e) };
}

/** Local wall-clock HH:MM of an epoch-seconds instant. */
export function formatClock(epochSeconds: number): string {
  const d = new Date(epochSeconds * 1000);
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function describeProblem(p: GithubProblem, now = Date.now()): string {
  switch (p.kind) {
    case "offline":
      return "GitHub is unreachable. Working offline.";
    case "signedOut":
      return "Signed out of GitHub.";
    case "other":
      return p.message;
    case "rateLimited": {
      if (p.resetAt === null) return "GitHub API rate limit reached.";
      if (p.resetAt * 1000 <= now) return "GitHub API rate limit window ended. Retry now.";
      const mins = Math.max(1, Math.ceil((p.resetAt * 1000 - now) / 60000));
      return `GitHub API rate limit reached. Resets at ${formatClock(p.resetAt)} (in ${mins} min).`;
    }
  }
}
