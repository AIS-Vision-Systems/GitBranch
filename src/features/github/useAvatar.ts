import { useEffect, useState } from "react";
import { githubAvatar } from "../../ipc/github";

/** Avatar data URLs by login, fetched once per login per session (the backend caches too). */
const avatarCache = new Map<string, string | null>();

export function resetAvatarCache(): void {
  avatarCache.clear();
}

export function useAvatar(login: string | null): string | null {
  const [, bump] = useState(0);
  useEffect(() => {
    if (login === null || avatarCache.has(login)) return;
    let live = true;
    githubAvatar(login)
      .then((url) => avatarCache.set(login, url))
      .catch(() => avatarCache.set(login, null))
      .finally(() => {
        if (live) bump((n) => n + 1);
      });
    return () => {
      live = false;
    };
  }, [login]);
  return login === null ? null : (avatarCache.get(login) ?? null);
}
