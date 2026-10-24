/** Web URL of a git remote URL (https, http, scp-like ssh, ssh://), or null when not recognised. */
export function webUrlOf(fetchUrl: string): string | null {
  const url = fetchUrl.trim();
  let host: string;
  let path: string;
  let m = /^(https?):\/\/(?:[^@/]+@)?([^/:\s@?#]+)(?::\d+)?\/(.+)$/.exec(url);
  if (m !== null) {
    host = m[2] ?? "";
    path = m[3] ?? "";
    const scheme = m[1] ?? "https";
    return finish(scheme, host, path);
  }
  m = /^ssh:\/\/(?:[^@/]+@)?([^/:\s@?#]+)(?::\d+)?\/(.+)$/.exec(url);
  if (m !== null) return finish("https", m[1] ?? "", m[2] ?? "");
  m = /^[^@/\s]+@([^/:\s]+):(.+)$/.exec(url);
  if (m !== null) return finish("https", m[1] ?? "", m[2] ?? "");
  return null;
}

function finish(scheme: string, host: string, rawPath: string): string | null {
  const path = rawPath
    .replace(/\/+$/, "")
    .replace(/\.git$/, "")
    .replace(/\/+$/, "");
  if (host === "" || path === "") return null;
  return `${scheme}://${host}/${path}`;
}

export function hostOf(webUrl: string): string | null {
  try {
    return new URL(webUrl).hostname;
  } catch {
    return null;
  }
}
