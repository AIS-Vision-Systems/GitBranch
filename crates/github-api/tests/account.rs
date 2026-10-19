//! `complete_login` and `resolve_account` against the mock transport and an in-memory store.

use std::sync::atomic::{AtomicUsize, Ordering};

use github_api::Error;
use github_api::GitHub;
use github_api::auth::{DeviceCode, complete_login};
use github_api::http::mock::MockTransport;
use github_api::http::{Method, Response};
use github_api::token::{GITHUB_HOST, MemoryStore, Secret, TokenError, TokenStore};
use github_api::user::resolve_account;
use serde_json::json;
use tokio_util::sync::CancellationToken;

fn user_json() -> serde_json::Value {
    json!({"login": "octo", "name": null, "avatar_url": null, "html_url": "https://github.com/octo"})
}

fn code() -> DeviceCode {
    DeviceCode {
        user_code: "U".into(),
        verification_uri: "https://github.com/login/device".into(),
        expires_in: 900,
        interval: 5,
        device_code: "dev".into(),
    }
}

fn user_route(t: MockTransport, r: Response) -> MockTransport {
    t.route(Method::Get, "/user", vec![r])
}

#[tokio::test(start_paused = true)]
async fn complete_login_stores_login_and_token() {
    let t = MockTransport::new().route(
        Method::Post,
        "/login/oauth/access_token",
        vec![
            Response::json_body(502, &json!({})),
            Response::json_body(200, &json!({"error": "authorization_pending"})),
            Response::json_body(200, &json!({"access_token": "gho_new", "scope": "repo"})),
        ],
    );
    let gh = GitHub::new(user_route(t, Response::json_body(200, &user_json())));
    let store = MemoryStore::default();
    let acc = complete_login(&gh, &store, &code(), &CancellationToken::new()).await.expect("ok");
    assert_eq!(acc.user.login, "octo");
    let s = store.get(GITHUB_HOST).expect("get").expect("stored");
    assert_eq!((s.login.as_str(), s.token.as_str()), ("octo", "gho_new"));
    // 502, pending and success: three polls survived the transient server error.
    let polls = gh.transport().calls().iter().filter(|c| c.method == Method::Post).count();
    assert_eq!(polls, 3);
}

#[tokio::test(start_paused = true)]
async fn poll_survives_bodyless_503() {
    let t = MockTransport::new().route(
        Method::Post,
        "/login/oauth/access_token",
        vec![
            Response { status: 503, headers: vec![], body: vec![] },
            Response::json_body(200, &json!({"access_token": "t", "scope": ""})),
        ],
    );
    let gh = GitHub::new(user_route(t, Response::json_body(200, &user_json())));
    let store = MemoryStore::default();
    complete_login(&gh, &store, &code(), &CancellationToken::new()).await.expect("ok");
}

#[tokio::test]
async fn resolve_none_without_token() {
    let gh = GitHub::new(MockTransport::new());
    assert!(resolve_account(&gh, &MemoryStore::default()).await.expect("ok").is_none());
}

#[tokio::test]
async fn resolve_valid_token_returns_account() {
    let gh = GitHub::new(user_route(
        MockTransport::new(),
        Response::json_body(200, &user_json()).with_header("x-oauth-scopes", "repo"),
    ));
    let store = MemoryStore::with(GITHUB_HOST, "octo", "tok");
    let acc = resolve_account(&gh, &store).await.expect("ok").expect("some");
    assert!(!acc.offline);
    assert_eq!(acc.scopes, ["repo"]);
}

#[tokio::test]
async fn resolve_401_deletes_rejected_token() {
    let gh = GitHub::new(user_route(MockTransport::new(), Response::json_body(401, &json!({}))));
    let store = MemoryStore::with(GITHUB_HOST, "octo", "tok");
    assert!(resolve_account(&gh, &store).await.expect("ok").is_none());
    assert!(store.get(GITHUB_HOST).expect("get").is_none());
}

/// Returns the old secret on the first read and a new one afterwards, as if a sign-in finished
/// while the profile request was in flight.
struct Swapping {
    reads: AtomicUsize,
    deletes: AtomicUsize,
}

impl TokenStore for Swapping {
    fn get(&self, _host: &str) -> Result<Option<Secret>, TokenError> {
        let token = if self.reads.fetch_add(1, Ordering::SeqCst) == 0 { "old" } else { "new" };
        Ok(Some(Secret { login: "octo".into(), token: token.into() }))
    }
    fn set(&self, _: &str, _: &str, _: &str) -> Result<(), TokenError> {
        Ok(())
    }
    fn delete(&self, _: &str) -> Result<(), TokenError> {
        self.deletes.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }
}

#[tokio::test]
async fn resolve_401_keeps_a_token_that_changed_meanwhile() {
    let gh = GitHub::new(user_route(MockTransport::new(), Response::json_body(401, &json!({}))));
    let store = Swapping { reads: AtomicUsize::new(0), deletes: AtomicUsize::new(0) };
    assert!(resolve_account(&gh, &store).await.expect("ok").is_none());
    assert_eq!(store.deletes.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn resolve_network_error_gives_offline_account() {
    let gh = GitHub::new(MockTransport::new()); // no route => Network error
    let store = MemoryStore::with(GITHUB_HOST, "octo", "tok");
    let acc = resolve_account(&gh, &store).await.expect("ok").expect("some");
    assert!(acc.offline && acc.scopes.is_empty());
    assert_eq!(acc.user.login, "octo");
    assert_eq!(acc.user.html_url, "https://github.com/octo");
    assert!(store.get(GITHUB_HOST).expect("get").is_some());
}

#[tokio::test]
async fn resolve_other_errors_propagate() {
    let gh = GitHub::new(user_route(
        MockTransport::new(),
        Response::json_body(500, &json!({"message": "boom"})),
    ));
    let store = MemoryStore::with(GITHUB_HOST, "octo", "tok");
    let e = resolve_account(&gh, &store).await.expect_err("err");
    assert!(matches!(e, Error::Status { status: 500, .. }));
}
