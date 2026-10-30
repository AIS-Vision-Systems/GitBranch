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

/** HTTPS clone URL for a github.com SSH remote (scp-like or ssh://), or null for anything else. */
export function githubHttpsUrlOf(fetchUrl: string): string | null {
  if (/^https?:\/\//i.test(fetchUrl.trim())) return null;
  const web = webUrlOf(fetchUrl);
  if (web === null || hostOf(web)?.toLowerCase() !== "github.com") return null;
  return `${web}.git`;
}

export function hostOf(webUrl: string): string | null {
  try {
    return new URL(webUrl).hostname;
  } catch {
    return null;
  }
}
