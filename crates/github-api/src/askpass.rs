//! Pure logic of the askpass bridge (D-024): classify git's credential prompt and answer it.

use crate::token::{GITHUB_HOST, TokenStore};

/// The user name git is told to use with a token.
pub const TOKEN_USERNAME: &str = "x-access-token";

/// What git (or ssh) is asking for.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Prompt {
    /// `Username for 'https://[user@]github.com[/path]': `.
    GithubUsername,
    /// `Password for 'https://[user@]github.com[/path]': `.
    GithubPassword,
    /// Anything else: other hosts, other schemes, ports, ssh passphrases, odd shapes.
    Other,
}

/// True when `url` is `https://` + optional `<user>@` + exactly the host `github.com` (any case,
/// no port) + optional `/<path>`. Strict on purpose: git decodes the URL user name into the prompt
/// unescaped, so a crafted `https://github.com%27@evil.com/r` must not look like github.com.
fn is_github_https_url(url: &str) -> bool {
    let Some(rest) = url.strip_prefix("https://") else { return false };
    let (authority, path) = match rest.split_once('/') {
        Some((a, p)) => (a, Some(p)),
        None => (rest, None),
    };
    if path.is_some_and(|p| p.contains('\'')) {
        return false;
    }
    let (user, host) = match authority.split_once('@') {
        Some((u, h)) => (Some(u), h),
        None => (None, authority),
    };
    if let Some(u) = user
        && (u.is_empty() || !u.bytes().all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b)))
    {
        return false;
    }
    host.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-')
        && host.eq_ignore_ascii_case(GITHUB_HOST)
}

/// Parses git's `Username for '<url>': ` / `Password for '<url>': ` prompts, accepting only
/// github.com over https.
pub fn parse_prompt(prompt: &str) -> Prompt {
    let prompt = prompt.trim_end_matches(['\r', '\n']);
    let (is_user, rest) = if let Some(r) = prompt.strip_prefix("Username for '") {
        (true, r)
    } else if let Some(r) = prompt.strip_prefix("Password for '") {
        (false, r)
    } else {
        return Prompt::Other;
    };
    // The URL ends at the *last* quote, which must be followed by `:` and an optional space.
    let Some(end) = rest.rfind('\'') else { return Prompt::Other };
    if !matches!(&rest[end + 1..], ":" | ": ") || !is_github_https_url(&rest[..end]) {
        return Prompt::Other;
    }
    if is_user { Prompt::GithubUsername } else { Prompt::GithubPassword }
}

/// The answer to `prompt`, or `None` when this bridge has nothing to say (git then falls back
/// to its own helpers).
pub fn answer(prompt: &str, store: &dyn TokenStore) -> Option<String> {
    match parse_prompt(prompt) {
        Prompt::GithubUsername => {
            store.get(GITHUB_HOST).ok().flatten().map(|_| TOKEN_USERNAME.to_string())
        }
        Prompt::GithubPassword => store.get(GITHUB_HOST).ok().flatten().map(|s| s.token),
        Prompt::Other => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::token::MemoryStore;

    fn store() -> MemoryStore {
        MemoryStore::with(GITHUB_HOST, "octo", "ghp_tok")
    }

    #[test]
    fn parses_prompt_forms() {
        use Prompt::*;
        assert_eq!(parse_prompt("Username for 'https://github.com': "), GithubUsername);
        assert_eq!(parse_prompt("Username for 'https://github.com':"), GithubUsername);
        assert_eq!(
            parse_prompt(
                "Password for 'https://x-access-token@GitHub.com': 
"
            ),
            GithubPassword
        );
        assert_eq!(parse_prompt("Password for 'https://GITHUB.COM/o/r.git': "), GithubPassword);
        assert_eq!(parse_prompt("Enter passphrase for key '/home/u/.ssh/id'"), Other);
        assert_eq!(parse_prompt("Username for 'nonsense': "), Other);
        assert_eq!(parse_prompt(""), Other);
    }

    #[test]
    fn rejects_crafted_and_lookalike_urls() {
        let s = store();
        for url in [
            "https://github.com'@evil.com",
            "https://github.com'@evil.com/r",
            "https://x@github.com'@evil.com/r",
            "https://x%40github.com%2F@evil.com/r",
            "https://x@github.com/@evil.com/r'@evil.com",
            "http://github.com",
            "https://github.com.evil.com",
            "https://evilgithub.com",
            "https://github.com:443",
            "https://github.com:443/o/r",
            "https://@github.com",
            "ssh://github.com",
        ] {
            for kind in ["Username", "Password"] {
                let prompt = format!("{kind} for '{url}': ");
                assert_eq!(parse_prompt(&prompt), Prompt::Other, "{prompt}");
                assert_eq!(answer(&prompt, &s), None, "{prompt}");
            }
        }
    }

    #[test]
    fn only_https_is_answered() {
        let s = store();
        assert_eq!(answer("Password for 'http://github.com': ", &s), None);
        assert_eq!(answer("Password for 'https://github.com': ", &s).as_deref(), Some("ghp_tok"));
    }

    #[test]
    fn answers_github_only() {
        let s = store();
        let user = answer("Username for 'https://github.com': ", &s);
        assert_eq!(user.as_deref(), Some(TOKEN_USERNAME));
        let pass = answer("Password for 'https://x-access-token@github.com': ", &s);
        assert_eq!(pass.as_deref(), Some("ghp_tok"));
        assert_eq!(answer("Password for 'https://gitlab.com': ", &s), None);
        assert_eq!(answer("Password for 'https://api.github.com': ", &s), None);
        assert_eq!(answer("Enter passphrase for key '/k': ", &s), None);
        assert_eq!(answer("Are you sure you want to continue connecting (yes/no)? ", &s), None);
    }

    #[test]
    fn no_token_no_answer() {
        let empty = MemoryStore::default();
        assert_eq!(answer("Username for 'https://github.com': ", &empty), None);
        assert_eq!(answer("Password for 'https://github.com': ", &empty), None);
    }
}
