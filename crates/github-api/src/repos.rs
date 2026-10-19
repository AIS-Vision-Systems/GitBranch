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
