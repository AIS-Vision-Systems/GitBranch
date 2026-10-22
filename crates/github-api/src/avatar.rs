//! Avatar download. Avatars are public, so the token is never attached.

use crate::client::GitHub;
use crate::error::Error;
use crate::http::{Method, Request, Transport};

/// Largest avatar accepted.
pub const MAX_AVATAR_BYTES: usize = 2 * 1024 * 1024;

/// A downloaded avatar.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AvatarImage {
    /// MIME type, always starting with `image/`.
    pub content_type: String,
    /// Image bytes (at most [`MAX_AVATAR_BYTES`]).
    pub bytes: Vec<u8>,
}

/// Whether `url` is an `https` URL on a GitHub avatar host (no userinfo, no port).
pub fn allowed_host(url: &str) -> bool {
    let Some(rest) = url.strip_prefix("https://") else { return false };
    let host = rest.split(['/', '?', '#']).next().unwrap_or_default();
    matches!(host, "avatars.githubusercontent.com" | "github.com")
}

/// `avatar_url` with `s=<size>` appended to its query.
fn sized_url(avatar_url: &str, size: u32) -> String {
    let base = avatar_url.split('#').next().unwrap_or(avatar_url);
    let sep = if base.contains('?') { '&' } else { '?' };
    format!("{base}{sep}s={size}")
}

/// Downloads an avatar at `size` px. Only `avatars.githubusercontent.com` and `github.com` are
/// contacted (redirects included, at most 3 hops), and the request carries no `Authorization`
/// header.
///
/// # Errors
/// [`Error::BadUrl`] for another host or scheme, [`Error::Status`] for a non-2xx answer,
/// [`Error::Decode`] when the body is not an image or exceeds 2 MiB (checked before buffering it), [`Error::Network`] offline.
pub async fn fetch_avatar<T: Transport>(
    gh: &GitHub<T>,
    avatar_url: &str,
    size: u32,
) -> Result<AvatarImage, Error> {
    if !allowed_host(avatar_url) {
        return Err(Error::BadUrl("avatar host is not allowed".into()));
    }
    let req = Request {
        method: Method::Get,
        url: sized_url(avatar_url, size),
        headers: vec![("Accept".into(), "image/*".into())],
        body: None,
    };
    let res = gh.transport().send_limited(req, MAX_AVATAR_BYTES, allowed_host).await?;
    if !(200..300).contains(&res.status) {
        return Err(Error::Status { status: res.status, message: "avatar download failed".into() });
    }
    let content_type =
        res.header("content-type").map(|c| c.split(';').next().unwrap_or("").trim().to_lowercase());
    let Some(content_type) = content_type.filter(|c| c.starts_with("image/")) else {
        return Err(Error::Decode("avatar is not an image".into()));
    };
    if res.body.len() > MAX_AVATAR_BYTES {
        return Err(Error::Decode("avatar is too large".into()));
    }
    Ok(AvatarImage { content_type, bytes: res.body })
}

#[cfg(test)]
#[allow(clippy::unwrap_used)] // tests
mod tests {
    use super::*;
    use crate::http::Response;
    use crate::http::mock::MockTransport;

    fn img(ct: &str, body: Vec<u8>) -> Response {
        Response { status: 200, headers: vec![("Content-Type".into(), ct.into())], body }
    }

    #[tokio::test]
    async fn downloads_without_token_and_appends_size() {
        let t = MockTransport::new().route(
            Method::Get,
            "/u/1?v=4&s=64",
            vec![img("image/png; charset=x", vec![1, 2, 3])],
        );
        let gh = GitHub::new(t);
        let url = "https://avatars.githubusercontent.com/u/1?v=4";
        let a = fetch_avatar(&gh, url, 64).await.unwrap();
        assert_eq!(a, AvatarImage { content_type: "image/png".into(), bytes: vec![1, 2, 3] });
        let calls = gh.transport().calls();
        assert_eq!(calls.len(), 1);
        assert!(calls[0].headers.iter().all(|(k, _)| !k.eq_ignore_ascii_case("authorization")));
    }

    #[tokio::test]
    async fn plain_url_gets_a_query() {
        let t = MockTransport::new().route(
            Method::Get,
            "/octocat.png?s=32",
            vec![img("image/jpeg", vec![9])],
        );
        let gh = GitHub::new(t);
        assert!(fetch_avatar(&gh, "https://github.com/octocat.png", 32).await.is_ok());
    }

    #[tokio::test]
    async fn rejects_other_hosts_and_schemes() {
        let gh = GitHub::new(MockTransport::new());
        for u in [
            "https://evil.example/a.png",
            "http://github.com/a.png",
            "https://github.com.evil.example/a.png",
            "https://github.com@evil.example/a.png",
            "https://github.com:8443/a.png",
        ] {
            let e = fetch_avatar(&gh, u, 64).await.unwrap_err();
            assert!(matches!(e, Error::BadUrl(_)), "{u}");
        }
        assert!(gh.transport().calls().is_empty());
    }

    #[tokio::test]
    async fn rejects_non_images_oversize_and_errors() {
        let url = "https://avatars.githubusercontent.com/u/2";
        let t = MockTransport::new().route(Method::Get, "s=64", vec![img("text/html", vec![1])]);
        assert!(matches!(fetch_avatar(&GitHub::new(t), url, 64).await, Err(Error::Decode(_))));
        let big = img("image/png", vec![0; MAX_AVATAR_BYTES + 1]);
        let t = MockTransport::new().route(Method::Get, "s=64", vec![big]);
        assert!(matches!(fetch_avatar(&GitHub::new(t), url, 64).await, Err(Error::Decode(_))));
        let nf = Response { status: 404, headers: vec![], body: vec![] };
        let t = MockTransport::new().route(Method::Get, "s=64", vec![nf]);
        let e = fetch_avatar(&GitHub::new(t), url, 64).await.unwrap_err();
        assert!(matches!(e, Error::Status { status: 404, .. }));
    }
}
