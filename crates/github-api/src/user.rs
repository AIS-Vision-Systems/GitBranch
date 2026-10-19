//! The signed-in GitHub user.

use serde::{Deserialize, Serialize};

use crate::client::GitHub;
use crate::error::Error;
use crate::http::Transport;
use crate::token::{GITHUB_HOST, TokenStore};

/// A GitHub user.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct User {
    /// Login name.
    pub login: String,
    /// Display name.
    pub name: Option<String>,
    /// Avatar image URL.
    #[serde(alias = "avatar_url")]
    pub avatar_url: Option<String>,
    /// Profile page URL.
    #[serde(alias = "html_url")]
    pub html_url: String,
}

/// The signed-in account as the UI sees it.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    /// The user.
    pub user: User,
    /// OAuth scopes granted to the token.
    pub scopes: Vec<String>,
    /// True when the profile could not be fetched (offline mode).
    pub offline: bool,
}

/// `GET /user` with the token; scopes come from `X-OAuth-Scopes`.
pub async fn current_user<T: Transport>(gh: &GitHub<T>, token: &str) -> Result<Account, Error> {
    let res = gh.get(Some(token), "/user").await?;
    let user: User = res.json()?;
    let scopes = res
        .header("x-oauth-scopes")
        .map(|s| s.split(',').map(str::trim).filter(|s| !s.is_empty()).map(String::from).collect())
        .unwrap_or_default();
    Ok(Account { user, scopes, offline: false })
}

/// The stored account, validated against GitHub.
///
/// `None` when nothing is stored or the token was rejected (it is then deleted, unless it changed
/// meanwhile, e.g. a new sign-in finished). Network failures and rate limits yield an offline
/// account built from the stored login.
pub async fn resolve_account<T: Transport, S: TokenStore + Sync>(
    gh: &GitHub<T>,
    store: &S,
) -> Result<Option<Account>, Error> {
    let Some(secret) = store.get(GITHUB_HOST)? else { return Ok(None) };
    match current_user(gh, &secret.token).await {
        Ok(account) => Ok(Some(account)),
        Err(Error::Unauthorized) => {
            let unchanged = store.get(GITHUB_HOST)?.is_some_and(|s| s.token == secret.token);
            if unchanged {
                store.delete(GITHUB_HOST)?;
            }
            tracing::info!("stored GitHub token was rejected");
            Ok(None)
        }
        Err(Error::Network(_) | Error::RateLimited { .. }) => {
            let login = secret.login;
            Ok(Some(Account {
                user: User {
                    html_url: format!("https://github.com/{login}"),
                    login,
                    name: None,
                    avatar_url: None,
                },
                scopes: vec![],
                offline: true,
            }))
        }
        Err(e) => Err(e),
    }
}
