//! `current_user` and the client's status mapping, against the mock transport.

use github_api::Error;
use github_api::GitHub;
use github_api::http::mock::MockTransport;
use github_api::http::{Method, Response};
use github_api::user::current_user;
use serde_json::json;

fn gh(r: Response) -> GitHub<MockTransport> {
    GitHub::new(MockTransport::new().route(Method::Get, "/user", vec![r]))
}

#[tokio::test]
async fn current_user_parses_user_and_scopes() {
    let res = Response::json_body(
        200,
        &json!({
            "login": "octo", "name": "Octo Cat",
            "avatar_url": "https://a/x.png", "html_url": "https://github.com/octo"
        }),
    )
    .with_header("X-OAuth-Scopes", "repo, read:org");
    let g = gh(res);
    let acc = current_user(&g, "tok").await.expect("account");
    assert_eq!(acc.user.login, "octo");
    assert_eq!(acc.user.avatar_url.as_deref(), Some("https://a/x.png"));
    assert_eq!(acc.scopes, ["repo", "read:org"]);
    assert!(!acc.offline);
    let calls = g.transport().calls();
    assert_eq!(calls[0].url, "https://api.github.com/user");
    let auth = calls[0].headers.iter().find(|(k, _)| k == "Authorization").expect("auth");
    assert_eq!(auth.1, "Bearer tok");
    assert!(!format!("{:?}", calls[0]).contains("Bearer"), "Debug must not show headers");
}

async fn err_of(r: Response) -> Error {
    current_user(&gh(r), "tok").await.expect_err("error")
}

#[tokio::test]
async fn maps_401_404_ratelimit_500() {
    assert!(matches!(err_of(Response::json_body(401, &json!({}))).await, Error::Unauthorized));
    assert!(matches!(err_of(Response::json_body(404, &json!({}))).await, Error::NotFound));
    let rl = Response::json_body(403, &json!({"message": "API rate limit exceeded"}))
        .with_header("x-ratelimit-remaining", "0")
        .with_header("x-ratelimit-reset", "1700000000");
    assert!(matches!(err_of(rl).await, Error::RateLimited { reset: Some(1_700_000_000) }));
    let retry = Response::json_body(429, &json!({})).with_header("retry-after", "30");
    assert!(matches!(err_of(retry).await, Error::RateLimited { reset: None }));
    match err_of(Response::json_body(500, &json!({"message": "boom"}))).await {
        Error::Status { status: 500, message } => assert_eq!(message, "boom"),
        e => panic!("unexpected {e:?}"),
    }
    // Plain 403 without rate-limit headers is an ordinary API error.
    let e = err_of(Response::json_body(403, &json!({"message": "nope"}))).await;
    assert_eq!(e.code(), "github.api");
}

#[tokio::test]
async fn missing_route_is_network_error() {
    let g = GitHub::new(MockTransport::new());
    let e = current_user(&g, "t").await.expect_err("err");
    assert_eq!(e.code(), "github.network");
}
