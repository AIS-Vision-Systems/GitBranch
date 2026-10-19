//! The signed-in user's repositories.

use serde::{Deserialize, Serialize};

use crate::client::GitHub;
use crate::error::Error;
use crate::http::Transport;

/// Upper bound on pages fetched (100 repositories per page).
const MAX_PAGES: usize = 20;

const REPOS_PATH: &str = "/user/repos?affiliation=owner,collaborator,organization_member\
&sort=pushed&direction=desc&per_page=100";

/// A GitHub repository as the UI sees it. Deserializes from GitHub's JSON, serializes camelCase.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", from = "RawRepo")]
pub struct Repo {
    /// Numeric id.
    pub id: u64,
    /// Short name.
    pub name: String,
    /// `owner/name`.
    pub full_name: String,
    /// Owner login.
    pub owner: String,
    /// Private repository.
    pub private: bool,
    /// Is a fork.
    pub fork: bool,
    /// Archived (read-only).
    pub archived: bool,
    /// Description.
    pub description: Option<String>,
    /// Web page URL.
    pub html_url: String,
    /// HTTPS clone URL.
    pub clone_url: String,
    /// SSH clone URL.
    pub ssh_url: String,
    /// Default branch name.
    pub default_branch: String,
    /// Last push, ISO 8601.
    pub pushed_at: Option<String>,
    /// Main language.
    pub language: Option<String>,
}

#[derive(Deserialize)]
struct RawOwner {
    login: String,
}

#[derive(Deserialize)]
struct RawRepo {
    id: u64,
    name: String,
    full_name: String,
    owner: RawOwner,
    private: bool,
    #[serde(default)]
    fork: bool,
    #[serde(default)]
    archived: bool,
    description: Option<String>,
    html_url: String,
    clone_url: String,
    ssh_url: String,
    default_branch: String,
    pushed_at: Option<String>,
    language: Option<String>,
}

impl From<RawRepo> for Repo {
    fn from(r: RawRepo) -> Self {
        Self {
            id: r.id,
            name: r.name,
            full_name: r.full_name,
            owner: r.owner.login,
            private: r.private,
            fork: r.fork,
            archived: r.archived,
            description: r.description,
            html_url: r.html_url,
            clone_url: r.clone_url,
            ssh_url: r.ssh_url,
            default_branch: r.default_branch,
            pushed_at: r.pushed_at,
            language: r.language,
        }
    }
}

/// Lists the repositories the token can see (own, collaborator, organization member; private
/// included), most recently pushed first, up to 2000.
pub async fn list_repos<T: Transport>(gh: &GitHub<T>, token: &str) -> Result<Vec<Repo>, Error> {
    gh.get_all(Some(token), REPOS_PATH, MAX_PAGES).await
}

/// `owner/name` of a GitHub repository.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoSlug {
    /// Owner login (user or organization).
    pub owner: String,
    /// Repository name without `.git`.
    pub name: String,
}

impl RepoSlug {
    /// `owner/name`.
    pub fn full_name(&self) -> String {
        format!("{}/{}", self.owner, self.name)
    }
}

/// Parses a github.com remote URL (https, ssh, scp-like, scheme-less) into its slug.
///
/// Other hosts (including `gist.github.com`) and bare paths give `None`. Case is preserved; a
/// trailing `.git` and `/` are stripped.
pub fn parse_github_remote(url: &str) -> Option<RepoSlug> {
    let url = url.trim();
    let (host_part, path) = if let Some((_, rest)) = url.split_once("://") {
        rest.split_once('/')?
    } else if let Some((h, p)) = url.split_once(':').filter(|(h, _)| !h.contains('/')) {
        (h, p)
    } else {
        url.split_once('/')?
    };
    let host = host_part.rsplit_once('@').map_or(host_part, |(_, h)| h);
    if !host.eq_ignore_ascii_case("github.com") {
        return None;
    }
    let path = path.trim_matches('/');
    let path = path.strip_suffix(".git").unwrap_or(path);
    let (owner, name) = path.split_once('/')?;
    let ok = |s: &str| {
        !matches!(s, "" | "." | "..")
            && s.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
    };
    if !ok(owner) || !ok(name) {
        return None;
    }
    Some(RepoSlug { owner: owner.to_string(), name: name.to_string() })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn slug(o: &str, n: &str) -> RepoSlug {
        RepoSlug { owner: o.into(), name: n.into() }
    }

    #[test]
    fn github_forms() {
        for u in [
            "https://github.com/o/r",
            "https://github.com/o/r.git",
            "https://user@github.com/o/r/",
            "https://user:pw@github.com/o/r.git",
            "git@github.com:o/r.git",
            "ssh://git@github.com/o/r.git",
            "github.com/o/r",
            "http://GitHub.com/o/r",
        ] {
            assert_eq!(parse_github_remote(u), Some(slug("o", "r")), "{u}");
        }
        assert_eq!(
            parse_github_remote("git@github.com:Octo/My.Repo.git"),
            Some(slug("Octo", "My.Repo"))
        );
        assert_eq!(slug("o", "r").full_name(), "o/r");
    }

    #[test]
    fn rejects_others() {
        for u in [
            "https://gitlab.com/o/r.git",
            "https://gist.github.com/o/abc",
            "git@gist.github.com:abc.git",
            "git@gitlab.com:o/r.git",
            "o/r",
            "/home/me/r",
            r"C:\repos\r",
            "github.com/o/r?x=1",
            "o/r#f",
            "https://github.com/o/r#f",
            "https://github.com/../r",
            "https://github.com/o",
            "https://github.com/",
            "https://github.com/o/r/tree/x",
            "",
        ] {
            assert_eq!(parse_github_remote(u), None, "{u}");
        }
    }
}
