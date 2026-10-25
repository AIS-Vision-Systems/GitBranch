//! Parsers for submodule status: gitlinks in the index, `git submodule status`, `.gitmodules` URLs.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use super::ParseError;

/// State of a submodule relative to the superproject.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SubmoduleState {
    /// Checked out at the commit recorded in the index.
    Clean,
    /// Checked out at a different commit than recorded (`+`).
    Modified,
    /// Not initialised (`-`).
    Uninitialized,
    /// Merge conflicts (`U`).
    Conflict,
}

/// One submodule of the superproject.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Submodule {
    /// Path relative to the work tree.
    pub path: String,
    /// Commit id git reports for the submodule.
    pub head_oid: Option<String>,
    /// State relative to the superproject.
    pub state: SubmoduleState,
    /// `git describe` of the checked-out commit, when git printed one.
    pub describe: Option<String>,
    /// URL from `.gitmodules`.
    pub url: Option<String>,
}

/// Gitlink paths (mode `160000`) from `git ls-files --stage -z`, sorted and deduplicated.
pub fn parse_gitlinks(bytes: &[u8]) -> Vec<String> {
    let mut paths: Vec<String> = bytes
        .split(|&b| b == 0)
        .filter_map(|rec| {
            let tab = rec.iter().position(|&b| b == b'\t')?;
            if !rec[..tab].starts_with(b"160000 ") {
                return None;
            }
            Some(String::from_utf8_lossy(&rec[tab + 1..]).into_owned())
        })
        .collect();
    paths.sort();
    paths.dedup();
    paths
}

/// Gitlinks as `(oid, path)` from `git ls-files --stage -z`, sorted by path, first stage wins.
pub fn parse_gitlink_entries(bytes: &[u8]) -> Vec<(String, String)> {
    let mut out: Vec<(String, String)> = bytes
        .split(|&b| b == 0)
        .filter_map(|rec| {
            let tab = rec.iter().position(|&b| b == b'\t')?;
            let head = String::from_utf8_lossy(&rec[..tab]);
            let mut it = head.split(' ');
            if it.next()? != "160000" {
                return None;
            }
            let oid = it.next()?.to_string();
            Some((oid, String::from_utf8_lossy(&rec[tab + 1..]).into_owned()))
        })
        .collect();
    out.sort_by(|a, b| a.1.cmp(&b.1));
    out.dedup_by(|a, b| a.1 == b.1);
    out
}

/// Parses `git submodule status` lines (`<flag><oid> <path>[ (<describe>)]`).
///
/// `known_paths` (the gitlinks) resolves the ambiguity of paths that contain ` (`.
///
/// # Errors
/// [`ParseError`] on a line that does not match the format.
pub fn parse_submodule_status(
    bytes: &[u8],
    known_paths: &[String],
) -> Result<Vec<Submodule>, ParseError> {
    let text = String::from_utf8_lossy(bytes);
    let mut out = Vec::new();
    for line in text.lines().filter(|l| !l.is_empty()) {
        let bad = || ParseError(format!("submodule status line: {line:?}"));
        let state = match line.as_bytes().first() {
            Some(b' ') => SubmoduleState::Clean,
            Some(b'+') => SubmoduleState::Modified,
            Some(b'-') => SubmoduleState::Uninitialized,
            Some(b'U') => SubmoduleState::Conflict,
            _ => return Err(bad()),
        };
        let (oid, rest) = line[1..].split_once(' ').ok_or_else(bad)?;
        if oid.is_empty() || !oid.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err(bad());
        }
        let (path, describe) = split_path(rest, known_paths).ok_or_else(bad)?;
        // A conflicted entry prints the all-zero oid: there is no single commit.
        let head_oid = (!oid.bytes().all(|b| b == b'0')).then(|| oid.to_string());
        out.push(Submodule { path, head_oid, state, describe, url: None });
    }
    Ok(out)
}

fn split_path(rest: &str, known: &[String]) -> Option<(String, Option<String>)> {
    if known.iter().any(|p| p == rest) {
        return Some((rest.to_string(), None));
    }
    let best = known
        .iter()
        .filter(|p| rest.strip_prefix(p.as_str()).is_some_and(|t| t.starts_with(" (")))
        .max_by_key(|p| p.len());
    if let Some(p) = best {
        let tail = &rest[p.len() + 2..];
        return Some((p.clone(), Some(tail.strip_suffix(')').unwrap_or(tail).to_string())));
    }
    // Unknown path: split at the last ` (` of a trailing parenthesised describe.
    if rest.ends_with(')') {
        if let Some(i) = rest.rfind(" (") {
            return Some((rest[..i].to_string(), Some(rest[i + 2..rest.len() - 1].to_string())));
        }
    }
    (!rest.is_empty()).then(|| (rest.to_string(), None))
}

/// Maps submodule path to URL from `git config -z -f .gitmodules --get-regexp ...` output
/// (`key\nvalue\0` records).
pub fn parse_gitmodules_urls(bytes: &[u8]) -> HashMap<String, String> {
    let mut paths: HashMap<String, String> = HashMap::new();
    let mut urls: HashMap<String, String> = HashMap::new();
    for rec in bytes.split(|&b| b == 0).filter(|r| !r.is_empty()) {
        let rec = String::from_utf8_lossy(rec);
        let (key, value) = rec.split_once('\n').unwrap_or((&rec, ""));
        let Some(inner) = key.strip_prefix("submodule.") else { continue };
        if let Some(name) = inner.strip_suffix(".path") {
            paths.insert(name.to_string(), value.to_string());
        } else if let Some(name) = inner.strip_suffix(".url") {
            urls.insert(name.to_string(), value.to_string());
        }
    }
    paths
        .into_iter()
        .filter_map(|(name, path)| urls.get(&name).map(|u| (path, u.clone())))
        .collect()
}

#[cfg(test)]
#[allow(clippy::unwrap_used)] // tests: unwrap is fine
mod tests {
    use super::*;

    const OID: &str = "0123456789abcdef0123456789abcdef01234567";

    #[test]
    fn gitlinks_only_mode_160000() {
        let bytes = format!(
            "100644 {OID} 0\ta.txt\0160000 {OID} 0\tvendor/lib\0160000 {OID} 2\tmy lib (v2)\0160000 {OID} 3\tmy lib (v2)\0"
        );
        assert_eq!(parse_gitlinks(bytes.as_bytes()), ["my lib (v2)", "vendor/lib"]);
        assert_eq!(parse_gitlinks(b"").len(), 0);
    }

    #[test]
    fn status_flags_and_describe() {
        let text =
            format!(" {OID} vendor/lib (v1.0-2-gabc)\n+{OID} b (heads/main)\n-{OID} c\nU{OID} d\n");
        let known = ["vendor/lib", "b", "c", "d"].map(String::from);
        let v = parse_submodule_status(text.as_bytes(), &known).unwrap();
        let states: Vec<_> = v.iter().map(|s| s.state).collect();
        assert_eq!(
            states,
            [
                SubmoduleState::Clean,
                SubmoduleState::Modified,
                SubmoduleState::Uninitialized,
                SubmoduleState::Conflict
            ]
        );
        assert_eq!(v[0].path, "vendor/lib");
        assert_eq!(v[0].describe.as_deref(), Some("v1.0-2-gabc"));
        assert_eq!(v[2].describe, None);
        assert_eq!(v[2].head_oid.as_deref(), Some(OID));
    }

    #[test]
    fn conflict_zero_oid_is_none() {
        let zero = "0".repeat(40);
        let text = format!(
            "U{zero} d
"
        );
        let v = parse_submodule_status(text.as_bytes(), &["d".to_string()]).unwrap();
        assert_eq!(v[0].state, SubmoduleState::Conflict);
        assert_eq!(v[0].head_oid, None);
    }

    #[test]
    fn path_with_spaces_and_parentheses() {
        let known = ["my lib (v2)".to_string(), "my lib".to_string()];
        let text =
            format!(" {OID} my lib (v2) (heads/main)\n-{OID} my lib (v2)\n {OID} my lib (x)\n");
        let v = parse_submodule_status(text.as_bytes(), &known).unwrap();
        let got: Vec<_> = v.iter().map(|s| (s.path.as_str(), s.describe.as_deref())).collect();
        assert_eq!(
            got,
            [("my lib (v2)", Some("heads/main")), ("my lib (v2)", None), ("my lib", Some("x"))]
        );
    }

    #[test]
    fn malformed_status_is_an_error() {
        assert!(parse_submodule_status(b"?zz path\n", &[]).is_err());
        assert!(parse_submodule_status(b" nothex path\n", &[]).is_err());
    }

    #[test]
    fn gitmodules_urls_by_path() {
        let bytes = b"submodule.a.b.path\nvendor/lib\0submodule.a.b.url\nhttps://x.invalid/l.git\0submodule.c.path\nonly-path\0";
        let m = parse_gitmodules_urls(bytes);
        assert_eq!(m.get("vendor/lib").map(String::as_str), Some("https://x.invalid/l.git"));
        assert!(!m.contains_key("only-path"));
    }
}
