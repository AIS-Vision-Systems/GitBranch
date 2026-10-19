//! OAuth App Device Flow (see `docs/ARCHITECTURE.md`, Credentials).

use std::fmt;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio::time::Instant;
use tokio_util::sync::CancellationToken;

use crate::client::GitHub;
use crate::error::Error;
use crate::http::Transport;
use crate::token::{GITHUB_HOST, TokenStore};
use crate::user::{Account, current_user};

/// Client ID of the `GitBranch` OAuth App registered under the AIS-Vision-Systems organization.
///
/// Public by design: the Device Flow never uses a client secret (D-004).
pub const CLIENT_ID: &str = "Ov23liz0pkJr73cVRaNX";

/// Scopes requested at login (D-005). `workflow` is added on demand from the settings.
pub const DEFAULT_SCOPES: &str = "repo read:org";

/// Extra scope to push workflow files.
pub const WORKFLOW_SCOPE: &str = "workflow";

/// The scope string to request.
pub fn scopes(workflow: bool) -> String {
    if workflow { format!("{DEFAULT_SCOPES} {WORKFLOW_SCOPE}") } else { DEFAULT_SCOPES.to_string() }
}

/// Response of the device code request. `device_code` never reaches the UI.
#[derive(Clone, Serialize, Deserialize)]
pub struct DeviceCode {
    /// Code the user types on GitHub.
    #[serde(rename = "userCode", alias = "user_code")]
    pub user_code: String,
    /// Page where the code is entered.
    #[serde(rename = "verificationUri", alias = "verification_uri")]
    pub verification_uri: String,
    /// Seconds until the code expires.
    #[serde(rename = "expiresIn", alias = "expires_in")]
    pub expires_in: u64,
    /// Minimum polling interval in seconds.
    pub interval: u64,
    /// Secret code used for polling.
    #[serde(skip_serializing)]
    pub device_code: String,
}

impl fmt::Debug for DeviceCode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("DeviceCode")
            .field("user_code", &self.user_code)
            .field("verification_uri", &self.verification_uri)
            .field("expires_in", &self.expires_in)
            .field("interval", &self.interval)
            .field("device_code", &"***")
            .finish()
    }
}

/// A granted token.
#[derive(Clone)]
pub struct AccessToken {
    /// The token. Never log it.
    pub token: String,
    /// Granted scopes as returned by GitHub.
    pub scope: String,
}

impl fmt::Debug for AccessToken {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("AccessToken").field("token", &"***").field("scope", &self.scope).finish()
    }
}

#[derive(Deserialize)]
struct ErrorBody {
    error: Option<String>,
    error_description: Option<String>,
    interval: Option<u64>,
}

/// Starts the flow: `POST /login/device/code`.
pub async fn request_device_code<T: Transport>(
    gh: &GitHub<T>,
    scopes: &str,
) -> Result<DeviceCode, Error> {
    let res = gh
        .post_form_web("/login/device/code", &[("client_id", CLIENT_ID), ("scope", scopes)])
        .await?;
    if res.status == 404 {
        return Err(Error::DeviceFlowDisabled);
    }
    if let Ok(b) = res.json::<ErrorBody>() {
        match b.error.as_deref() {
            Some("unauthorized_client" | "device_flow_disabled") => {
                return Err(Error::DeviceFlowDisabled);
            }
            Some(other) => {
                let message = b.error_description.unwrap_or_else(|| other.to_string());
                return Err(Error::Status { status: res.status, message });
            }
            None => {}
        }
    }
    if !(200..300).contains(&res.status) {
        return Err(Error::Status {
            status: res.status,
            message: "device code request failed".into(),
        });
    }
    res.json()
}

/// Polls until the user authorizes, denies, the code expires or `cancel` fires.
pub async fn poll_access_token<T: Transport>(
    gh: &GitHub<T>,
    code: &DeviceCode,
    cancel: &CancellationToken,
) -> Result<AccessToken, Error> {
    let started = Instant::now();
    let lifetime = Duration::from_secs(code.expires_in);
    let mut interval = code.interval.max(1);
    loop {
        tokio::select! {
            () = cancel.cancelled() => return Err(Error::Cancelled),
            () = tokio::time::sleep(Duration::from_secs(interval)) => {}
        }
        if started.elapsed() >= lifetime {
            return Err(Error::Expired);
        }
        let form = [
            ("client_id", CLIENT_ID),
            ("device_code", code.device_code.as_str()),
            ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
        ];
        let res = tokio::select! {
            () = cancel.cancelled() => return Err(Error::Cancelled),
            r = gh.post_form_web("/login/oauth/access_token", &form) => r,
        };
        let res = match res {
            Ok(r) if r.status >= 500 => {
                tracing::debug!(status = r.status, "device flow poll got a server error, retrying");
                continue;
            }
            Ok(r) => r,
            Err(Error::Network(e)) => {
                tracing::debug!(error = %e, "device flow poll failed, retrying");
                continue;
            }
            Err(e) => return Err(e),
        };
        let value: serde_json::Value = res.json()?;
        if let Some(token) = value.get("access_token").and_then(|v| v.as_str()) {
            let scope = value.get("scope").and_then(|v| v.as_str()).unwrap_or_default();
            return Ok(AccessToken { token: token.to_string(), scope: scope.to_string() });
        }
        let body: ErrorBody =
            serde_json::from_value(value).map_err(|e| Error::Decode(e.to_string()))?;
        match body.error.as_deref() {
            Some("authorization_pending") => {}
            Some("slow_down") => interval = body.interval.unwrap_or(interval + 5),
            Some("expired_token") => return Err(Error::Expired),
            Some("access_denied") => return Err(Error::AccessDenied),
            Some("device_flow_disabled" | "unauthorized_client") => {
                return Err(Error::DeviceFlowDisabled);
            }
            Some(other) => {
                let message = body.error_description.unwrap_or_else(|| other.to_string());
                return Err(Error::Status { status: res.status, message });
            }
            None => return Err(Error::Decode("missing access_token".into())),
        }
    }
}

/// Runs the whole sign-in: poll for the token, fetch the user, store login and token.
///
/// Storage access is a short synchronous keyring call.
pub async fn complete_login<T: Transport, S: TokenStore + Sync>(
    gh: &GitHub<T>,
    store: &S,
    code: &DeviceCode,
    cancel: &CancellationToken,
) -> Result<Account, Error> {
    let token = poll_access_token(gh, code, cancel).await?;
    let account = current_user(gh, &token.token).await?;
    store.set(GITHUB_HOST, &account.user.login, &token.token)?;
    gh.clear_cache(); // responses cached under the previous token
    tracing::info!(login = %account.user.login, "signed in to GitHub");
    Ok(account)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scopes_with_and_without_workflow() {
        assert_eq!(scopes(false), "repo read:org");
        assert_eq!(scopes(true), "repo read:org workflow");
    }

    #[test]
    fn debug_redacts_secrets() {
        let c = DeviceCode {
            user_code: "ABCD-1234".into(),
            verification_uri: "https://github.com/login/device".into(),
            expires_in: 900,
            interval: 5,
            device_code: "dev_secret".into(),
        };
        let t = AccessToken { token: "gho_secret".into(), scope: "repo".into() };
        let text = format!("{c:?} {t:?}");
        assert!(!text.contains("dev_secret") && !text.contains("gho_secret"));
        assert!(!serde_json::to_string(&c).expect("json").contains("dev_secret"));
    }
}
