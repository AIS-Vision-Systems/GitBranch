//! Keyring-backed storage of the GitHub token (D-024).
//!
//! One keyring entry per host: `(SERVICE, host)` holds the token and `(SERVICE, "<host>#login")`
//! the GitHub login, so the askpass bridge never needs the API. Tokens are never part of any
//! `Debug` or `Display` output.

use std::collections::HashMap;
use std::fmt;
use std::sync::Mutex;

/// Keyring service name.
pub const SERVICE: &str = "GitBranch";
/// The only host with stored credentials for now.
pub const GITHUB_HOST: &str = "github.com";

/// A stored credential.
#[derive(Clone, PartialEq, Eq)]
pub struct Secret {
    /// GitHub login the token belongs to.
    pub login: String,
    /// The OAuth access token.
    pub token: String,
}

impl fmt::Debug for Secret {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Secret").field("login", &self.login).field("token", &"***").finish()
    }
}

/// Why the credential store failed. Never contains the token.
#[derive(Debug, thiserror::Error)]
pub enum TokenError {
    /// The OS keyring refused or failed the operation.
    #[error("credential store error: {0}")]
    Keyring(String),
}

impl From<keyring::Error> for TokenError {
    fn from(e: keyring::Error) -> Self {
        Self::Keyring(e.to_string())
    }
}

/// Access to stored tokens, per host.
pub trait TokenStore {
    /// The credential for `host`, or `None` when nothing is stored.
    fn get(&self, host: &str) -> Result<Option<Secret>, TokenError>;
    /// Stores (replaces) the credential for `host`.
    fn set(&self, host: &str, login: &str, token: &str) -> Result<(), TokenError>;
    /// Removes the credential for `host`; absent is not an error.
    fn delete(&self, host: &str) -> Result<(), TokenError>;
}

/// The OS keyring (Windows Credential Manager, Secret Service).
#[derive(Debug, Default, Clone, Copy)]
pub struct KeyringStore;

fn entry(account: &str) -> Result<keyring::Entry, TokenError> {
    Ok(keyring::Entry::new(SERVICE, account)?)
}

fn read(account: &str) -> Result<Option<String>, TokenError> {
    match entry(account)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

fn remove(account: &str) -> Result<(), TokenError> {
    match entry(account)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.into()),
    }
}

impl TokenStore for KeyringStore {
    fn get(&self, host: &str) -> Result<Option<Secret>, TokenError> {
        let Some(token) = read(host)? else { return Ok(None) };
        let login = read(&format!("{host}#login")).ok().flatten().unwrap_or_default();
        Ok(Some(Secret { login, token }))
    }

    fn set(&self, host: &str, login: &str, token: &str) -> Result<(), TokenError> {
        entry(&format!("{host}#login"))?.set_password(login)?;
        entry(host)?.set_password(token)?;
        Ok(())
    }

    fn delete(&self, host: &str) -> Result<(), TokenError> {
        remove(host)?;
        remove(&format!("{host}#login"))
    }
}

/// In-memory store, for tests.
#[derive(Debug, Default)]
pub struct MemoryStore {
    map: Mutex<HashMap<String, (String, String)>>,
}

impl MemoryStore {
    /// A store holding one credential.
    pub fn with(host: &str, login: &str, token: &str) -> Self {
        let s = Self::default();
        s.set(host, login, token).expect("memory store never fails");
        s
    }
}

impl TokenStore for MemoryStore {
    fn get(&self, host: &str) -> Result<Option<Secret>, TokenError> {
        let map = self.map.lock().expect("lock poisoned");
        Ok(map
            .get(host)
            .map(|(login, token)| Secret { login: login.clone(), token: token.clone() }))
    }

    fn set(&self, host: &str, login: &str, token: &str) -> Result<(), TokenError> {
        self.map
            .lock()
            .expect("lock poisoned")
            .insert(host.to_string(), (login.to_string(), token.to_string()));
        Ok(())
    }

    fn delete(&self, host: &str) -> Result<(), TokenError> {
        self.map.lock().expect("lock poisoned").remove(host);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn debug_redacts_token() {
        let s = Secret { login: "octo".into(), token: "ghp_secret".into() };
        let text = format!("{s:?}");
        assert!(text.contains("octo") && !text.contains("ghp_secret"));
    }

    #[test]
    fn memory_store_roundtrip() {
        let s = MemoryStore::default();
        assert_eq!(s.get(GITHUB_HOST).expect("get"), None);
        s.set(GITHUB_HOST, "octo", "tok").expect("set");
        let got = s.get(GITHUB_HOST).expect("get").expect("some");
        assert_eq!((got.login.as_str(), got.token.as_str()), ("octo", "tok"));
        s.delete(GITHUB_HOST).expect("delete");
        assert_eq!(s.get(GITHUB_HOST).expect("get"), None);
    }
}
