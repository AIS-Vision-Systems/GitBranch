import { useEffect, useState } from "react";
import { githubAvatar, githubAvatarByEmail } from "../../ipc/github";

/** Avatar data URLs by cache key (`u:<login>` / `e:<email>`), fetched once per session (the backend caches too). */
const avatarCache = new Map<string, string | null>();

export function resetAvatarCache(): void {
  avatarCache.clear();
}

function useCachedAvatar(key: string | null, fetch: () => Promise<string | null>): string | null {
  const [, bump] = useState(0);
  useEffect(() => {
    if (key === null || avatarCache.has(key)) return;
    let live = true;
    // `Promise.resolve().then` turns a throwing fetch into a rejection (never an error for the UI).
    Promise.resolve()
      .then(fetch)
      .then((url) => avatarCache.set(key, url))
      .catch(() => avatarCache.set(key, null))
      .finally(() => {
        if (live) bump((n) => n + 1);
      });
    return () => {
      live = false;
    };
    // `fetch` is derived from `key` by every caller.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return key === null ? null : (avatarCache.get(key) ?? null);
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
