import { useEffect, useState } from "react";
import { githubAvatar, githubAvatarByEmail } from "../../ipc/github";

/** A `null` (no photo, offline, CDN default) is retried after this long; photos stay for the session. */
const NULL_TTL_MS = 10 * 60_000;

/** Avatar data URLs by cache key (`u:<login>` / `e:<email>`); the backend caches on disk too. */
const avatarCache = new Map<string, { url: string | null; at: number }>();

function fresh(key: string): boolean {
  const hit = avatarCache.get(key);
  return hit !== undefined && (hit.url !== null || Date.now() - hit.at < NULL_TTL_MS);
}

export function resetAvatarCache(): void {
  avatarCache.clear();
}

function useCachedAvatar(key: string | null, fetch: () => Promise<string | null>): string | null {
  const [, bump] = useState(0);
  useEffect(() => {
    if (key === null || fresh(key)) return;
    let live = true;
    // `Promise.resolve().then` turns a throwing fetch into a rejection (never an error for the UI).
    Promise.resolve()
      .then(fetch)
      .then((url) => avatarCache.set(key, { url, at: Date.now() }))
      .catch(() => avatarCache.set(key, { url: null, at: Date.now() }))
      .finally(() => {
        if (live) bump((n) => n + 1);
      });
    return () => {
      live = false;
    };
    // `fetch` is derived from `key` by every caller.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return key === null ? null : (avatarCache.get(key)?.url ?? null);
}

/** Photo of a GitHub login as a data URL, or null (unknown login, offline, not fetched yet). */
export function useAvatar(login: string | null): string | null {
  return useCachedAvatar(login === null ? null : `u:${login.toLowerCase()}`, () =>
    githubAvatar(login ?? ""),
  );
}

/** Photo of the GitHub account owning `email`, or null (no account, offline, not fetched yet). */
export function useEmailAvatar(email: string | null): string | null {
  const e = email?.trim().toLowerCase() ?? "";
  return useCachedAvatar(e === "" ? null : `e:${e}`, () => githubAvatarByEmail(e));
}
