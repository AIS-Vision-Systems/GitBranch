//! Parsers for remote configuration and `git push --porcelain` output.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use super::ParseError;

/// A configured remote.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Remote {
    /// Remote name (`origin`).
    pub name: String,
    /// Fetch URL (`remote.<name>.url`).
    pub fetch_url: String,
    /// `remote.<name>.pushurl` when set.
    pub push_url: Option<String>,
}

/// One ref line of `git push --porcelain`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PushedRef {
    /// One character: ' ' fast-forward, '+' forced, '-' deleted, '*' new, '!' rejected, '=' up to date.
    pub flag: String,
    /// Source ref (empty for deletions).
    pub from: String,
    /// Destination ref.
    pub to: String,
    /// Summary such as `abc..def`, `[new branch]` or `[rejected] (fetch first)`.
    pub summary: String,
}

/// Parses `git config -z --get-regexp ^remote\..*\.(url|pushurl)$` (entries are `key\nvalue\0`).
///
/// Remotes are sorted by name; those with only a `pushurl` are skipped.
///
/// # Errors
/// [`ParseError`] when an entry has no `\n` key/value separator.
pub fn parse_remotes(bytes: &[u8]) -> Result<Vec<Remote>, ParseError> {
    let mut urls: BTreeMap<String, String> = BTreeMap::new();
    let mut push: BTreeMap<String, String> = BTreeMap::new();
    for entry in bytes.split(|b| *b == 0).filter(|e| !e.is_empty()) {
        let text = String::from_utf8_lossy(entry);
        let (key, value) = text
            .split_once('\n')
            .ok_or_else(|| ParseError(format!("config entry without value: {text:?}")))?;
        let Some(rest) = key.strip_prefix("remote.") else { continue };
        let Some((name, var)) = rest.rsplit_once('.') else { continue };
        match var.to_ascii_lowercase().as_str() {
            // The first url wins; later ones are additional URLs.
            "url" => {
                urls.entry(name.to_string()).or_insert_with(|| value.to_string());
            }
            "pushurl" => {
                push.entry(name.to_string()).or_insert_with(|| value.to_string());
            }
            _ => {}
        }
    }
    Ok(urls
        .into_iter()
        .map(|(name, fetch_url)| {
            let push_url = push.remove(&name);
            Remote { name, fetch_url, push_url }
        })
        .collect())
}

/// Parses the stdout of `git push --porcelain`: `<flag>\t<from>:<to>\t<summary>` lines.
///
/// The `To <url>` and `Done` lines and anything else not matching are skipped.
pub fn parse_push_porcelain(bytes: &[u8]) -> Vec<PushedRef> {
    String::from_utf8_lossy(bytes)
        .lines()
        .filter_map(|line| {
            let mut chars = line.chars();
            let flag = chars.next()?;
            if !matches!(flag, ' ' | '+' | '-' | '*' | '!' | '=') || chars.next()? != '\t' {
                return None;
            }
            let (refs, summary) = chars.as_str().split_once('\t')?;
            let (from, to) = refs.split_once(':')?;
            Some(PushedRef {
                flag: flag.to_string(),
                from: from.to_string(),
                to: to.to_string(),
                summary: summary.to_string(),
            })
        })
        .collect()
}

#[cfg(test)]
#[allow(clippy::unwrap_used)] // tests: unwrap is fine
mod tests {
    use super::*;

    #[test]
    fn remotes_sorted_with_push_urls() {
        let raw = b"remote.origin.url\nhttps://github.com/a/b.git\0remote.up.stream.url\n/x/y\0remote.up.stream.pushurl\nssh://z\0remote.only.pushurl\nq\0remote.origin.pushurl\n/p\0";
        let got = parse_remotes(raw).unwrap();
        assert_eq!(got.len(), 2);
        assert_eq!(got[0].name, "origin");
        assert_eq!(got[0].push_url.as_deref(), Some("/p"));
        assert_eq!(got[1].name, "up.stream");
        assert_eq!(got[1].fetch_url, "/x/y");
        assert_eq!(got[1].push_url.as_deref(), Some("ssh://z"));
        assert_eq!(parse_remotes(b"").unwrap().len(), 0);
        assert!(parse_remotes(b"remote.a.url\0").is_err());
    }

    #[test]
    fn push_porcelain_lines() {
        let raw = "To /tmp/remote.git\n \trefs/heads/main:refs/heads/main\tabc1234..def5678\n*\trefs/heads/new:refs/heads/new\t[new branch]\n!\trefs/heads/x:refs/heads/x\t[rejected] (fetch first)\n+\trefs/heads/f:refs/heads/f\ta...b (forced update)\n-\t:refs/heads/gone\t[deleted]\n=\trefs/heads/u:refs/heads/u\t[up to date]\nDone\n";
        let got = parse_push_porcelain(raw.as_bytes());
        assert_eq!(got.len(), 6);
        assert_eq!(got[0].flag, " ");
        assert_eq!(got[0].summary, "abc1234..def5678");
        assert_eq!(got[1].flag, "*");
        assert_eq!(got[2].flag, "!");
        assert_eq!(got[2].summary, "[rejected] (fetch first)");
        assert_eq!(got[3].flag, "+");
        assert_eq!(got[4].from, "");
        assert_eq!(got[4].to, "refs/heads/gone");
        assert_eq!(got[5].flag, "=");
    }
}
