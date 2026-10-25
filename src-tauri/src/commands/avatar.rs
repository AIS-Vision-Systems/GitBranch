//! GitHub avatars: downloaded by the backend (the webview never contacts the CDN), cached on disk
//! for a week and returned as `data:` URLs. Failures are never errors for the UI.
//!
//! Two lookups: by login (`https://github.com/<login>.png`) and by author email (D-038, the CDN's
//! `/u/e?email=` endpoint). The CDN answers unknown emails with one fixed default image, which is
//! recognised by comparing against the answer for a sentinel address that cannot belong to anyone.

use std::collections::HashMap;
use std::fmt::Write as _;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::{Duration, Instant, SystemTime};

use base64::Engine as _;
use github_api::avatar::{AvatarImage, email_avatar_url, fetch_avatar};
use github_api::client::GitHub;
use github_api::http::ReqwestTransport;
use github_api::token::{GITHUB_HOST, TokenStore};
use sha2::{Digest as _, Sha256};
use tauri::{AppHandle, Manager, State};

use super::github::GithubState;
use crate::AppError;

const SIZE: u32 = 64;
const TTL: Duration = Duration::from_secs(7 * 24 * 3600);
/// How long a failed download suppresses new attempts for the same login.
const FAILURE_TTL: Duration = Duration::from_secs(3600);
const EXTS: [(&str, &str); 4] =
    [("image/png", "png"), ("image/jpeg", "jpeg"), ("image/gif", "gif"), ("image/webp", "webp")];

/// Sentinel address for the email lookup: `.invalid` is reserved (RFC 2606), so the CDN answers with
/// its default image, the one to recognise for every unknown author.
const UNKNOWN_EMAIL: &str = "no-such-author@gitbranch.invalid";

/// Per-key download coordination: one download at a time per key, and a negative cache.
#[derive(Default)]
pub struct AvatarGuard {
    inflight: Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>,
    failures: Mutex<HashMap<String, Instant>>,
    /// Bytes of the CDN's default image, fetched once per process (retried while unknown).
    unknown: tokio::sync::Mutex<Option<Arc<[u8]>>>,
}

impl AvatarGuard {
    fn lock_for(&self, key: &str) -> Arc<tokio::sync::Mutex<()>> {
        let mut m = self.inflight.lock().unwrap_or_else(PoisonError::into_inner);
        Arc::clone(m.entry(key.to_string()).or_default())
    }

    /// Drops the entry for `key` when nobody else holds its lock.
    fn release(&self, key: &str, lock: &Arc<tokio::sync::Mutex<()>>) {
        let mut m = self.inflight.lock().unwrap_or_else(PoisonError::into_inner);
        // The map and `lock` are the only holders left.
        if Arc::strong_count(lock) == 2 {
            m.remove(key);
        }
    }

    fn recently_failed(&self, key: &str) -> bool {
        let mut f = self.failures.lock().unwrap_or_else(PoisonError::into_inner);
        match f.get(key) {
            Some(t) if t.elapsed() < FAILURE_TTL => true,
            Some(_) => {
                f.remove(key);
                false
            }
            None => false,
        }
    }

    fn mark_failed(&self, key: &str) {
        let mut f = self.failures.lock().unwrap_or_else(PoisonError::into_inner);
        f.insert(key.to_string(), Instant::now());
    }

    /// The CDN's default image, fetched (once, serialised) with `fetch`; `None` while unavailable.
    async fn unknown_image<F, Fut>(&self, fetch: F) -> Option<Arc<[u8]>>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = Option<AvatarImage>>,
    {
        let mut slot = self.unknown.lock().await;
        if let Some(bytes) = slot.as_ref() {
            return Some(Arc::clone(bytes));
        }
        let bytes: Arc<[u8]> = Arc::from(fetch().await?.bytes);
        *slot = Some(Arc::clone(&bytes));
        Some(bytes)
    }
}

/// `img` unless it is the CDN's default image (`unknown`); without a reference image nothing is
/// trusted, since the default would otherwise be shown as a photo.
fn known_image(img: AvatarImage, unknown: Option<&[u8]>) -> Option<AvatarImage> {
    match unknown {
        Some(u) if u != img.bytes.as_slice() => Some(img),
        _ => None,
    }
}

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

/// Cache key of a login: lowercase (logins are case-insensitive) with a `u-` prefix, which also
/// keeps names such as `con` or `nul` away from the Windows reserved device names.
fn login_key(login: &str) -> String {
    format!("u-{}", login.to_ascii_lowercase())
}

/// Cache key of an author email: `e-` and the first 32 hex digits of the SHA-256 of the trimmed,
/// lowercased address, so the address itself never reaches the filesystem.
fn email_key(email: &str) -> String {
    let digest = Sha256::digest(email.trim().to_lowercase().as_bytes());
    let hex = digest.iter().take(16).fold(String::with_capacity(32), |mut s, b| {
        let _ = write!(s, "{b:02x}");
        s
    });
    format!("e-{hex}")
}

/// A plausible address: trimmed, non-empty, at most 254 bytes, one `@` with something on both
/// sides, no whitespace or control characters.
fn valid_email(email: &str) -> bool {
    let e = email.trim();
    !e.is_empty()
        && e.len() <= 254
        && e.chars().all(|c| !c.is_whitespace() && !c.is_control())
        && e.split('@').count() == 2
        && !e.starts_with('@')
        && !e.ends_with('@')
}

fn cache_name(key: &str, ext: &str) -> String {
    format!("{key}.{ext}")
}

/// A cached avatar younger than `ttl` (by mtime), as a data URL.
fn read_cache(dir: &Path, key: &str, ttl: Duration) -> Option<String> {
    for (mime, ext) in EXTS {
        let path = dir.join(cache_name(key, ext));
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

/// Writes through a temporary file and a rename, so readers never see a partial image.
fn write_cache(dir: &Path, key: &str, content_type: &str, bytes: &[u8]) {
    let Some(ext) = ext_for(content_type) else { return };
    if std::fs::create_dir_all(dir).is_err() {
        return;
    }
    let target = dir.join(cache_name(key, ext));
    let tmp = dir.join(format!("{}.tmp", cache_name(key, ext)));
    let written = std::fs::write(&tmp, bytes).and_then(|()| std::fs::rename(&tmp, &target));
    if let Err(e) = written {
        tracing::debug!("avatar cache write failed: {e}");
        let _ = std::fs::remove_file(&tmp);
        return;
    }
    // A changed image type must not leave a stale sibling behind.
    for (_, other) in EXTS.iter().filter(|(_, o)| *o != ext) {
        let _ = std::fs::remove_file(dir.join(cache_name(key, other)));
    }
}

async fn cached(dir: Option<PathBuf>, key: String, ttl: Duration) -> Option<String> {
    let dir = dir?;
    tokio::task::spawn_blocking(move || read_cache(&dir, &key, ttl)).await.ok()?
}

/// Cache, then (one download at a time per key) `fetch`; on failure the stale cache entry, if
/// any, is returned and further attempts are suppressed for an hour.
async fn resolve_avatar<F, Fut>(
    guard: &AvatarGuard,
    dir: Option<&Path>,
    key: &str,
    fetch: F,
) -> Option<String>
where
    F: FnOnce() -> Fut,
    Fut: Future<Output = Option<AvatarImage>>,
{
    let dir = dir.map(Path::to_path_buf);
    let key = key.to_string();
    if let Some(hit) = cached(dir.clone(), key.clone(), TTL).await {
        return Some(hit);
    }
    let lock = guard.lock_for(&key);
    let result = {
        let _held = lock.lock().await;
        // Another call may have finished the download while this one waited.
        if let Some(hit) = cached(dir.clone(), key.clone(), TTL).await {
            Some(hit)
        } else if guard.recently_failed(&key) {
            cached(dir.clone(), key.clone(), Duration::MAX).await
        } else if let Some(img) = fetch().await {
            let url = data_url(&img.content_type, &img.bytes);
            if let Some(dir) = dir.clone() {
                let k = key.clone();
                let _ = tokio::task::spawn_blocking(move || {
                    write_cache(&dir, &k, &img.content_type, &img.bytes);
                })
                .await;
            }
            Some(url)
        } else {
            guard.mark_failed(&key);
            cached(dir, key.clone(), Duration::MAX).await
        }
    };
    guard.release(&key, &lock);
    result
}

/// The stored login of the signed-in user. No network: it is kept next to the token.
async fn signed_in_login(state: &GithubState) -> Option<String> {
    let store = state.store;
    // Keyring access blocks.
    let secret = tokio::task::spawn_blocking(move || store.get(GITHUB_HOST)).await.ok()?.ok()??;
    Some(secret.login)
}

/// The avatar of `login` (the signed-in user when `None`) as a `data:` URL, or `None` when it
/// is unavailable (signed out, offline, not an image). Avatars come from
/// `https://github.com/<login>.png`, which does not use the API quota.
#[tauri::command]
pub async fn github_avatar(
    app: AppHandle,
    state: State<'_, GithubState>,
    login: Option<String>,
) -> Result<Option<String>, AppError> {
    let cache_dir: Option<PathBuf> = app.path().app_cache_dir().ok().map(|d| d.join("avatars"));
    let login = match login {
        Some(l) => l,
        None => match signed_in_login(&state).await {
            Some(l) => l,
            None => return Ok(None),
        },
    };
    if !valid_login(&login) {
        return Ok(None);
    }
    // `size=` is what github.com/<login>.png honours; `fetch_avatar` adds the CDN form `s=` as well.
    let url = format!("https://github.com/{login}.png?size={SIZE}");
    let client = Arc::clone(&state.client);
    let got =
        resolve_avatar(&state.avatars, cache_dir.as_deref(), &login_key(&login), || async move {
            fetch_image(&client, &url).await
        })
        .await;
    Ok(got)
}

/// `fetch_avatar` at `SIZE`, keeping only raster types we can cache (and safely embed). The URL is
/// not logged: it may carry an author email.
async fn fetch_image(client: &GitHub<ReqwestTransport>, url: &str) -> Option<AvatarImage> {
    match fetch_avatar(client, url, SIZE).await {
        Ok(img) if ext_for(&img.content_type).is_some() => Some(img),
        Ok(img) => {
            tracing::debug!("avatar has unsupported type {}", img.content_type);
            None
        }
        Err(e) => {
            let kind = match &e {
                github_api::Error::Network(_) => "network".to_string(),
                other => other.to_string(),
            };
            tracing::debug!("avatar fetch failed: {kind}");
            None
        }
    }
}

/// The GitHub photo of the account that owns `email` as a `data:` URL, or `None` when no account
/// does (the CDN's default image, recognised via a sentinel address), when the address is
/// implausible, or when the network fails. No token and no API quota; the email is only ever sent
/// to GitHub's avatar CDN and is hashed for the disk cache (D-038).
#[tauri::command]
pub async fn github_avatar_email(
    app: AppHandle,
    state: State<'_, GithubState>,
    email: String,
) -> Result<Option<String>, AppError> {
    if !valid_email(&email) {
        return Ok(None);
    }
    let cache_dir: Option<PathBuf> = app.path().app_cache_dir().ok().map(|d| d.join("avatars"));
    let client = Arc::clone(&state.client);
    let guard = &state.avatars;
    let got = resolve_avatar(guard, cache_dir.as_deref(), &email_key(&email), || async move {
        let img = fetch_image(&client, &email_avatar_url(&email)).await?;
        let unknown = guard
            .unknown_image(|| async {
                fetch_image(&client, &email_avatar_url(UNKNOWN_EMAIL)).await
            })
            .await;
        known_image(img, unknown.as_deref())
    })
    .await;
    Ok(got)
}

#[cfg(test)]
#[allow(clippy::unwrap_used)] // tests
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn png(b: &[u8]) -> AvatarImage {
        AvatarImage { content_type: "image/png".into(), bytes: b.to_vec() }
    }

    #[test]
    fn login_validation() {
        assert!(valid_login("octo-cat1"));
        for bad in ["", "a/b", "..", "a.b", "a b", &"x".repeat(40)] {
            assert!(!valid_login(bad), "{bad}");
        }
    }

    #[test]
    fn email_validation_and_key() {
        for ok in ["a@b.c", " Ada@Example.com ", "1+x@users.noreply.github.com"] {
            assert!(valid_email(ok), "{ok}");
        }
        let long = format!("{}@c", "x".repeat(260));
        for bad in ["", "ada", "@b", "a@", "a@b@c", "a b@c", "a\n@c", long.as_str()] {
            assert!(!valid_email(bad), "{bad:?}");
        }
        let k = email_key(" Ada@Example.com ");
        assert_eq!(k, email_key("ada@example.com"));
        assert_ne!(k, email_key("bob@example.com"));
        assert_eq!(k.len(), 2 + 32);
        assert!(k.starts_with("e-") && k[2..].bytes().all(|b| b.is_ascii_hexdigit()));
        assert_eq!(login_key("Ada"), "u-ada");
    }

    #[test]
    fn default_image_is_not_a_photo() {
        assert!(known_image(png(&[1, 2]), Some(&[1, 2])).is_none());
        assert!(known_image(png(&[1, 2]), None).is_none(), "no reference: nothing is trusted");
        assert_eq!(known_image(png(&[1, 2]), Some(&[9])).map(|i| i.bytes), Some(vec![1, 2]));
    }

    #[tokio::test]
    async fn unknown_image_is_fetched_once_and_retried_after_failure() {
        let g = AvatarGuard::default();
        let n = AtomicUsize::new(0);
        let fail = || async {
            n.fetch_add(1, Ordering::SeqCst);
            None
        };
        assert!(g.unknown_image(fail).await.is_none());
        let ok = || async {
            n.fetch_add(1, Ordering::SeqCst);
            Some(png(&[7]))
        };
        assert_eq!(g.unknown_image(ok).await.as_deref(), Some(&[7][..]));
        assert_eq!(g.unknown_image(ok).await.as_deref(), Some(&[7][..]));
        assert_eq!(n.load(Ordering::SeqCst), 2, "cached after the first success");
    }

    #[test]
    fn cache_roundtrip_and_ttl() {
        let d = tempfile::tempdir().unwrap();
        assert_eq!(read_cache(d.path(), "u-ada", TTL), None);
        write_cache(d.path(), "u-ada", "image/png", &[1, 2, 3]);
        assert!(d.path().join("u-ada.png").exists());
        assert!(!d.path().join("u-ada.png.tmp").exists());
        assert_eq!(
            read_cache(d.path(), "u-ada", TTL).as_deref(),
            Some("data:image/png;base64,AQID")
        );
        assert_eq!(read_cache(d.path(), "u-ada", Duration::ZERO), None);
        // A new type replaces the old file.
        write_cache(d.path(), "u-ada", "image/jpeg", &[1]);
        assert!(!d.path().join("u-ada.png").exists());
        assert!(read_cache(d.path(), "u-ada", TTL).unwrap().starts_with("data:image/jpeg;base64,"));
        // Unknown types are not cached; reserved names are harmless.
        write_cache(d.path(), "u-bob", "image/svg+xml", &[1]);
        assert_eq!(read_cache(d.path(), "u-bob", TTL), None);
        write_cache(d.path(), "u-nul", "image/png", &[1]);
        assert!(d.path().join("u-nul.png").exists());
    }

    #[tokio::test]
    async fn concurrent_calls_share_one_download() {
        let d = tempfile::tempdir().unwrap();
        let g = AvatarGuard::default();
        let n = AtomicUsize::new(0);
        let one = || async {
            resolve_avatar(&g, Some(d.path()), "u-ada", || async {
                n.fetch_add(1, Ordering::SeqCst);
                tokio::time::sleep(Duration::from_millis(50)).await;
                Some(png(&[1, 2, 3]))
            })
            .await
        };
        let (r1, r2, r3) = tokio::join!(one(), one(), one());
        assert_eq!(n.load(Ordering::SeqCst), 1);
        assert!(r1.is_some() && r1 == r2 && r2 == r3);
        assert!(g.inflight.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn failures_are_cached_and_stale_entries_served() {
        let d = tempfile::tempdir().unwrap();
        let g = AvatarGuard::default();
        let n = AtomicUsize::new(0);
        let fail = || async {
            n.fetch_add(1, Ordering::SeqCst);
            None
        };
        assert_eq!(resolve_avatar(&g, Some(d.path()), "u-ada", fail).await, None);
        assert_eq!(resolve_avatar(&g, Some(d.path()), "u-ada", fail).await, None);
        assert_eq!(n.load(Ordering::SeqCst), 1, "second call hits the negative cache");
        // A stale file is returned instead of None when the network fails.
        write_cache(d.path(), "u-bob", "image/png", &[1, 2, 3]);
        let old = SystemTime::now() - 2 * TTL;
        let f = std::fs::File::options().write(true).open(d.path().join("u-bob.png")).unwrap();
        f.set_modified(old).unwrap();
        drop(f);
        assert_eq!(read_cache(d.path(), "u-bob", TTL), None);
        let got = resolve_avatar(&g, Some(d.path()), "u-bob", fail).await;
        assert_eq!(got.as_deref(), Some("data:image/png;base64,AQID"));
    }
}
