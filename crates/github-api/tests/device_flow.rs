//! Device flow against the mock transport. Paused time makes sleeps instant.

use std::time::Duration;

use github_api::Error;
use github_api::GitHub;
use github_api::auth::{DeviceCode, poll_access_token, request_device_code};
use github_api::http::mock::MockTransport;
use github_api::http::{Method, Response};
use serde_json::json;
use tokio::time::Instant;
use tokio_util::sync::CancellationToken;

fn code() -> DeviceCode {
    DeviceCode {
        user_code: "ABCD-1234".into(),
        verification_uri: "https://github.com/login/device".into(),
        expires_in: 900,
        interval: 5,
        device_code: "dev123".into(),
    }
}

#[allow(clippy::needless_pass_by_value)] // call sites pass json!() temporaries
fn ok(v: serde_json::Value) -> Response {
    Response::json_body(200, &v)
}

fn body_of(req: &github_api::http::Request) -> String {
    String::from_utf8(req.body.clone().expect("body")).expect("utf8")
}

#[tokio::test(start_paused = true)]
async fn device_code_request_sends_client_id_and_scope() {
    let t = MockTransport::new().route(
        Method::Post,
        "/login/device/code",
        vec![ok(json!({
            "device_code": "d", "user_code": "U-1",
            "verification_uri": "https://github.com/login/device",
            "expires_in": 900, "interval": 5
        }))],
    );
    let gh = GitHub::new(t);
    let c = request_device_code(&gh, "repo read:org").await.expect("code");
    assert_eq!((c.user_code.as_str(), c.interval, c.device_code.as_str()), ("U-1", 5, "d"));
    let calls = gh.transport().calls();
    let body = body_of(&calls[0]);
    assert!(body.contains("client_id=Ov23liz0pkJr73cVRaNX"), "{body}");
    assert!(body.contains("scope=repo%20read%3Aorg"), "{body}");
    assert_eq!(calls[0].url, "https://github.com/login/device/code");
    let ui = serde_json::to_value(&c).expect("json");
    assert!(ui.get("deviceCode").is_none() && ui.get("device_code").is_none());
    assert_eq!(ui["userCode"], "U-1");
}

#[tokio::test(start_paused = true)]
async fn device_code_404_means_flow_disabled() {
    let t = MockTransport::new().route(
        Method::Post,
        "/login/device/code",
        vec![Response::json_body(404, &json!({"error": "not found"}))],
    );
    let err = request_device_code(&GitHub::new(t), "repo").await.expect_err("err");
    assert!(matches!(err, Error::DeviceFlowDisabled), "{err:?}");
}

#[tokio::test(start_paused = true)]
async fn device_code_unauthorized_client_means_flow_disabled() {
    let t = MockTransport::new().route(
        Method::Post,
        "/login/device/code",
        vec![ok(json!({"error": "unauthorized_client"}))],
    );
    let err = request_device_code(&GitHub::new(t), "repo").await.expect_err("err");
    assert!(matches!(err, Error::DeviceFlowDisabled), "{err:?}");
}

#[tokio::test(start_paused = true)]
async fn poll_pending_then_slow_down_then_success() {
    let t = MockTransport::new().route(
        Method::Post,
        "/login/oauth/access_token",
        vec![
            ok(json!({"error": "authorization_pending"})),
            ok(json!({"error": "slow_down", "interval": 10})),
            ok(json!({"access_token": "gho_x", "scope": "repo,read:org", "token_type": "bearer"})),
        ],
    );
    let gh = GitHub::new(t);
    let start = Instant::now();
    let tok = poll_access_token(&gh, &code(), &CancellationToken::new()).await.expect("token");
    assert_eq!((tok.token.as_str(), tok.scope.as_str()), ("gho_x", "repo,read:org"));
    // 5s (pending) + 5s (slow_down reply) + 10s (new interval) = 20s.
    assert_eq!(start.elapsed(), Duration::from_secs(20));
    let calls = gh.transport().calls();
    assert_eq!(calls.len(), 3);
    let body = body_of(&calls[0]);
    assert!(body.contains("device_code=dev123"));
    assert!(body.contains("grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Adevice_code"));
}

#[tokio::test(start_paused = true)]
async fn slow_down_without_interval_adds_five() {
    let t = MockTransport::new().route(
        Method::Post,
        "/login/oauth/access_token",
        vec![ok(json!({"error": "slow_down"})), ok(json!({"access_token": "t", "scope": ""}))],
    );
    let start = Instant::now();
    poll_access_token(&GitHub::new(t), &code(), &CancellationToken::new()).await.expect("token");
    assert_eq!(start.elapsed(), Duration::from_secs(5 + 10));
}

#[tokio::test(start_paused = true)]
async fn poll_expired_and_denied() {
    for (body, want) in [("expired_token", "github.expired"), ("access_denied", "github.denied")] {
        let t = MockTransport::new().route(
            Method::Post,
            "/login/oauth/access_token",
            vec![ok(json!({ "error": body }))],
        );
        let err = poll_access_token(&GitHub::new(t), &code(), &CancellationToken::new())
            .await
            .expect_err("err");
        assert_eq!(err.code(), want);
    }
}

#[tokio::test(start_paused = true)]
async fn poll_stops_when_code_lifetime_elapsed() {
    let t = MockTransport::new().route(
        Method::Post,
        "/login/oauth/access_token",
        vec![ok(json!({"error": "authorization_pending"}))],
    );
    let mut c = code();
    c.expires_in = 12;
    let err =
        poll_access_token(&GitHub::new(t), &c, &CancellationToken::new()).await.expect_err("err");
    assert!(matches!(err, Error::Expired), "{err:?}");
}

#[tokio::test(start_paused = true)]
async fn cancel_aborts_polling() {
    let t = MockTransport::new().route(
        Method::Post,
        "/login/oauth/access_token",
        vec![ok(json!({"error": "authorization_pending"}))],
    );
    let gh = GitHub::new(t);
    let cancel = CancellationToken::new();
    let c2 = cancel.clone();
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_secs(7)).await;
        c2.cancel();
    });
    let err = poll_access_token(&gh, &code(), &cancel).await.expect_err("err");
    assert!(matches!(err, Error::Cancelled), "{err:?}");
}
