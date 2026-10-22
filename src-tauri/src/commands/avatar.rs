//! GitHub avatars: downloaded by the backend (the webview never contacts the CDN), cached on disk
//! for a week and returned as `data:` URLs. Failures are never errors for the UI.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, SystemTime};

use base64::Engine as _;
use github_api::avatar::fetch_avatar;
use github_api::user::{User, resolve_account};
use tauri::async_runtime::spawn_blocking;
use tauri::{AppHandle, Manager, State};

use super::github::GithubState;
use crate::AppError;

const SIZE: u32 = 64;
const TTL: Duration = Duration::from_secs(7 * 24 * 3600);
const EXTS: [(&str, &str); 4] =
    [("image/png", "png"), ("image/jpeg", "jpeg"), ("image/gif", "gif"), ("image/webp", "webp")];

fn ext_for(content_type: &str) -> Option<&'static str> {
    EXTS.iter().find(|(c, _)| *c == content_type).map(|(_, e)| *e)
}

fn data_url(content_type: &str, bytes: &[u8]) -> String {
    format!(
        "data:{content_type};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    )
}

/// GitHub logins are alphanumerics and hyphens; anything else never reaches the filesystem.
fn valid_login(login: &str) -> bool {
    !login.is_empty()
        && login.len() <= 39
        && login.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
}

/// A cached avatar younger than `ttl` (by mtime), as a data URL.
fn read_cache(dir: &Path, login: &str, ttl: Duration) -> Option<String> {
    for (mime, ext) in EXTS {
        let path = dir.join(format!("{login}.{ext}"));
        let Ok(meta) = std::fs::metadata(&path) else { continue };
        let fresh = meta
            .modified()
            .ok()
            .and_then(|m| SystemTime::now().duration_since(m).ok())
            .is_some_and(|age| age < ttl);
        if fresh && let Ok(bytes) = std::fs::read(&path) {
            return Some(data_url(mime, &bytes));
        }
    }
    None
}

fn write_cache(dir: &Path, login: &str, content_type: &str, bytes: &[u8]) {
    let Some(ext) = ext_for(content_type) else { return };
    // A changed image type must not leave a stale sibling behind.
    for (_, other) in EXTS {
        let _ = std::fs::remove_file(dir.join(format!("{login}.{other}")));
    }
    if std::fs::create_dir_all(dir).is_ok()
        && let Err(e) = std::fs::write(dir.join(format!("{login}.{ext}")), bytes)
    {
        tracing::debug!("avatar cache write failed: {e}");
    }
}

/// Login and avatar URL of the signed-in user (the login is known even offline).
async fn signed_in(state: &GithubState) -> Option<(String, Option<String>)> {
    let gh = Arc::clone(&state.client);
    let store = state.store;
    // Keyring access blocks.
    let account = spawn_blocking(move || {
        tauri::async_runtime::block_on(async move { resolve_account(&gh, &store).await })
    })
    .await
    .ok()?
    .ok()??;
    Some((account.user.login, account.user.avatar_url))
}

/// `GET /users/{login}` (unauthenticated: the profile is public).
async fn avatar_url_of(state: &GithubState, login: &str) -> Option<String> {
    let res = state.client.get(None, &format!("/users/{login}")).await.ok()?;
    res.json::<User>().ok()?.avatar_url
}

/// The avatar of `login` (the signed-in user when `None`) as a `data:` URL, or `None` when it
/// is unavailable (signed out, offline, rate limited, not an image).
#[tauri::command]
pub async fn github_avatar(
    app: AppHandle,
    state: State<'_, GithubState>,
    login: Option<String>,
) -> Result<Option<String>, AppError> {
    let cache_dir: Option<PathBuf> = app.path().app_cache_dir().ok().map(|d| d.join("avatars"));
    let (login, known_url) = match login {
        Some(l) => (l, None),
        None => match signed_in(&state).await {
            Some((l, url)) => (l, url),
            None => return Ok(None),
        },
    };
    if !valid_login(&login) {
        return Ok(None);
    }
    if let Some(hit) = cache_dir.as_deref().and_then(|d| read_cache(d, &login, TTL)) {
        return Ok(Some(hit));
    }
    let url = match known_url {
        Some(u) => Some(u),
        None => avatar_url_of(&state, &login).await,
    };
    let Some(url) = url else { return Ok(None) };
    match fetch_avatar(&state.client, &url, SIZE).await {
        // Only raster types we can cache (and safely embed) are returned.
        Ok(img) if ext_for(&img.content_type).is_some() => {
            if let Some(d) = &cache_dir {
                write_cache(d, &login, &img.content_type, &img.bytes);
            }
            Ok(Some(data_url(&img.content_type, &img.bytes)))
        }
        Ok(img) => {
            tracing::debug!("avatar has unsupported type {}", img.content_type);
            Ok(None)
        }
        Err(e) => {
            tracing::debug!("avatar fetch failed: {e}");
            Ok(None)
        }
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)] // tests
mod tests {
    use super::*;

    #[test]
    fn login_validation() {
        assert!(valid_login("octo-cat1"));
        for bad in ["", "a/b", "..", "a.b", "a b", &"x".repeat(40)] {
            assert!(!valid_login(bad), "{bad}");
        }
    }

    #[test]
    fn cache_roundtrip_and_ttl() {
        let d = tempfile::tempdir().unwrap();
        assert_eq!(read_cache(d.path(), "ada", TTL), None);
        write_cache(d.path(), "ada", "image/png", &[1, 2, 3]);
        assert_eq!(read_cache(d.path(), "ada", TTL).as_deref(), Some("data:image/png;base64,AQID"));
        assert_eq!(read_cache(d.path(), "ada", Duration::ZERO), None);
        // A new type replaces the old file.
        write_cache(d.path(), "ada", "image/jpeg", &[1]);
        assert!(!d.path().join("ada.png").exists());
        assert!(read_cache(d.path(), "ada", TTL).unwrap().starts_with("data:image/jpeg;base64,"));
        // Unknown types are not cached.
        write_cache(d.path(), "bob", "image/svg+xml", &[1]);
        assert_eq!(read_cache(d.path(), "bob", TTL), None);
    }
}
