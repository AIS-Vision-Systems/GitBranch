//! Offline validation of branch and tag names (the rules of `git check-ref-format --branch`).

/// Whether `name` is acceptable as a branch or tag name.
///
/// Rejects: empty names, a leading `-`, `@` alone, `..`, `@{`, `//`, a trailing `/` or `.`,
/// components that start with `.` or end in `.lock`, and the characters space, control
/// characters, `:`, `?`, `*`, `[`, `\`, `~` and `^`.
#[allow(clippy::case_sensitive_file_extension_comparisons)] // git's `.lock` rule is case-sensitive
pub fn is_valid_branch_name(name: &str) -> bool {
    if name.is_empty() || name == "@" || name.starts_with(['-', '/']) {
        return false;
    }
    if name.ends_with('/') || name.ends_with('.') {
        return false;
    }
    if name.contains("..") || name.contains("@{") || name.contains("//") {
        return false;
    }
    let bad_char =
        |c: char| c.is_control() || matches!(c, ' ' | ':' | '?' | '*' | '[' | '\\' | '~' | '^');
    if name.chars().any(bad_char) {
        return false;
    }
    name.split('/').all(|c| !c.starts_with('.') && !c.ends_with(".lock"))
}

/// Whether `name` is acceptable as a remote name; git checks `refs/remotes/<name>`, so `foo/bar`
/// is fine and the rules are those of a branch name.
pub fn is_valid_remote_name(name: &str) -> bool {
    is_valid_branch_name(name)
}

/// Loose check for revision arguments (oids, `name~1`, `origin/main`): non-empty, no leading
/// `-`, no whitespace or control characters.
pub fn is_safe_revision(rev: &str) -> bool {
    !rev.is_empty()
        && !rev.starts_with('-')
        && !rev.chars().any(|c| c.is_whitespace() || c.is_control())
}

/// Whether `url` is `http://` or `https://` with any userinfo (`user@host`, `token@host`,
/// `user:pw@host`). `ssh://git@host/...` and `git@host:path` are not affected.
pub fn has_http_userinfo(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    let Some(rest) = lower.strip_prefix("https://").or_else(|| lower.strip_prefix("http://"))
    else {
        return false;
    };
    rest.split(['/', '?', '#']).next().unwrap_or("").contains('@')
}

/// Whether `url` embeds credentials: any userinfo on `http(s)://` (the usual PAT form
/// `https://TOKEN@host`) or a `user:pw@` password on another scheme. Tokens belong in the
/// keyring only.
pub fn has_embedded_password(url: &str) -> bool {
    has_http_userinfo(url)
        || crate::runner::redact_credentials(url) != url
            && url.split_once("://").is_some_and(|(_, rest)| {
                let auth = rest.split('/').next().unwrap_or("");
                auth.rsplit_once('@').is_some_and(|(ui, _)| ui.contains(':'))
            })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn url_credentials() {
        for u in [
            "https://ghp_x@github.com/o/r.git",
            "http://u:pw@h/r.git",
            "HTTPS://tok@github.com/o/r",
            "ssh://u:pw@h/r.git",
        ] {
            assert!(has_embedded_password(u), "{u}");
        }
        for u in [
            "https://github.com/o/r.git",
            "https://github.com/o/r@v1",
            "ssh://git@github.com/o/r.git",
            "git@github.com:o/r.git",
            "/tmp/a@b",
        ] {
            assert!(!has_embedded_password(u), "{u}");
        }
        assert!(has_http_userinfo("https://ghp_x@github.com/o/r.git"));
        assert!(!has_http_userinfo("ssh://git@github.com/o/r.git"));
    }

    #[test]
    fn branch_names() {
        let good = ["main", "feat/x", "release-1.2", "a/b/c", "v1.0.0", "x@y", "ünï", "a.b", "#12"];
        for n in good {
            assert!(is_valid_branch_name(n), "{n:?} should be valid");
        }
        let bad = [
            "",
            "-x",
            "@",
            ".hidden",
            "a/.b",
            "a..b",
            "a@{b",
            "a:b",
            "a?b",
            "a*b",
            "a[b",
            "a\\b",
            "a~1",
            "a^",
            "a b",
            "a\tb",
            "a\nb",
            "a/",
            "a.",
            "a//b",
            "a.lock",
            "a/b.lock/c",
            "a\u{7f}",
        ];
        for n in bad {
            assert!(!is_valid_branch_name(n), "{n:?} should be invalid");
        }
    }

    #[test]
    fn revisions() {
        for r in ["main", "HEAD~1", "origin/main", "0123abcd", "v1.0^{commit}"] {
            assert!(is_safe_revision(r), "{r:?}");
        }
        for r in ["", "-x", "a b", "a\nb", "--upload-pack=x"] {
            assert!(!is_safe_revision(r), "{r:?}");
        }
    }
}
