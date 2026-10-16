//! Integration tests for `GitRunner` against real repositories.

use std::path::Path;
use std::time::Duration;

use git_core::fixtures::FixtureRepo;
use git_core::{GitErrorKind, GitRunner, RunOpts};
use tokio_util::sync::CancellationToken;

fn runner() -> GitRunner {
    GitRunner::from_env()
}

#[tokio::test]
async fn reports_a_supported_version() {
    let v = runner().check_version().await.expect("git available");
    assert!(v.major >= 2);
}

#[tokio::test]
async fn runs_rev_parse_on_a_fixture() {
    let repo = FixtureRepo::linear(3);
    let out = runner()
        .run(repo.path(), &["rev-parse", "HEAD"], RunOpts::default())
        .await
        .expect("rev-parse succeeds");
    let oid = out.stdout_str();
    assert_eq!(oid.len(), 40, "oid: {oid}");
    assert_eq!(oid, repo.rev_parse("HEAD"));
}

#[tokio::test]
async fn stdout_is_raw_bytes_with_nul_separators() {
    let repo = FixtureRepo::linear(2);
    let out = runner()
        .run(repo.path(), &["log", "--format=%H%x00%s%x00", "-n", "2"], RunOpts::default())
        .await
        .expect("log succeeds");
    assert_eq!(out.stdout.split(|b| *b == 0).count(), 5, "4 NUL separators");
}

#[tokio::test]
async fn feeds_stdin() {
    let repo = FixtureRepo::empty();
    let out = runner()
        .run(repo.path(), &["hash-object", "--stdin"], RunOpts::with_stdin("hello\n"))
        .await
        .expect("hash-object succeeds");
    // `git hash-object` of "hello\n" is a well-known blob id.
    assert_eq!(out.stdout_str(), "ce013625030ba8dba906f756967f9e9ca394464a");
}

#[tokio::test]
async fn classifies_not_a_repo() {
    let dir = tempfile::tempdir().expect("tempdir");
    let err = runner()
        .run(dir.path(), &["rev-parse", "HEAD"], RunOpts::default())
        .await
        .expect_err("not a repo");
    assert_eq!(err.kind, GitErrorKind::NotARepo);
    assert_eq!(err.code(), "git.not_a_repo");
}

#[tokio::test]
async fn classifies_unknown_revision() {
    let repo = FixtureRepo::linear(1);
    let err = runner()
        .run(repo.path(), &["rev-parse", "--verify", "nope^{commit}"], RunOpts::default())
        .await
        .expect_err("unknown revision");
    assert!(
        matches!(err.kind, GitErrorKind::NotFound | GitErrorKind::ExitCode(128)),
        "kind: {:?} stderr: {}",
        err.kind,
        err.stderr
    );
    assert!(!err.stderr.is_empty());
    assert_eq!(err.args[0], "rev-parse");
}

#[tokio::test]
async fn classifies_merge_conflict() {
    let repo = FixtureRepo::linear(1);
    repo.git(&["checkout", "-q", "-b", "other"]);
    repo.commit_file("f1.txt", "other\n", "other change");
    repo.git(&["checkout", "-q", "main"]);
    repo.commit_file("f1.txt", "main\n", "main change");
    let err = runner()
        .run(repo.path(), &["merge", "other"], RunOpts::default())
        .await
        .expect_err("conflict");
    assert_eq!(err.kind, GitErrorKind::Conflict, "stderr: {}", err.stderr);
}

#[tokio::test]
async fn spawn_failure_is_typed() {
    let err = GitRunner::new("definitely-not-a-git-binary-xyz")
        .run(Path::new("."), &["--version"], RunOpts::default())
        .await
        .expect_err("spawn fails");
    assert_eq!(err.kind, GitErrorKind::Spawn);
}

#[tokio::test]
async fn times_out_and_kills_the_child() {
    // A pre-commit hook that sleeps makes `git commit` hang in a portable way (sh exists on
    // Linux and inside Git for Windows).
    let repo = FixtureRepo::linear(1);
    let hooks = repo.path().join(".git").join("hooks");
    std::fs::create_dir_all(&hooks).expect("hooks dir");
    let hook = hooks.join("pre-commit");
    std::fs::write(&hook, "#!/bin/sh\nsleep 5\n").expect("write hook");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&hook, std::fs::Permissions::from_mode(0o755)).expect("chmod");
    }
    let started = std::time::Instant::now();
    let err = runner()
        .run(
            repo.path(),
            &["commit", "--allow-empty", "-m", "hang"],
            RunOpts::with_timeout(Duration::from_millis(700)),
        )
        .await
        .expect_err("times out");
    assert_eq!(err.kind, GitErrorKind::Timeout);
    assert!(started.elapsed() < Duration::from_secs(4), "child was not killed promptly");
    // The commit never happened.
    assert_eq!(repo.git(&["rev-list", "--count", "HEAD"]), "1");
}

#[tokio::test]
async fn per_call_env_overrides_the_fixed_env() {
    let repo = FixtureRepo::linear(1);
    let other = FixtureRepo::linear(2);
    let opts = RunOpts {
        env: vec![("GIT_DIR".into(), other.path().join(".git").to_string_lossy().into_owned())],
        ..RunOpts::default()
    };
    let out = runner().run(repo.path(), &["rev-list", "--count", "HEAD"], opts).await.expect("ok");
    assert_eq!(out.stdout_str(), "2");
}

#[tokio::test]
async fn large_stdin_and_stdout_do_not_deadlock() {
    // 2 MB in, 2 MB out: both far beyond the pipe buffers.
    let repo = FixtureRepo::empty();
    let payload = vec![b'x'; 2 * 1024 * 1024];
    let out = runner()
        .run(repo.path(), &["stripspace"], RunOpts::with_stdin(payload.clone()))
        .await
        .expect("stripspace succeeds");
    assert_eq!(out.stdout.len(), payload.len() + 1);
}

#[tokio::test]
async fn never_opens_an_editor() {
    let repo = FixtureRepo::linear(1);
    // Without `-m`, git would open $GIT_EDITOR; with `:` it commits the template as-is... which
    // is empty, so git refuses. Either way it must return promptly instead of hanging.
    let err = runner()
        .run(
            repo.path(),
            &["commit", "--allow-empty"],
            RunOpts::with_timeout(Duration::from_secs(20)),
        )
        .await
        .expect_err("empty message is rejected");
    assert_ne!(err.kind, GitErrorKind::Timeout, "stderr: {}", err.stderr);
}

#[tokio::test]
async fn fixture_oids_are_deterministic() {
    let a = FixtureRepo::linear(3);
    let b = FixtureRepo::linear(3);
    assert_eq!(a.rev_parse("HEAD"), b.rev_parse("HEAD"));
}

#[tokio::test]
async fn streaming_delivers_progress_lines() {
    let src = FixtureRepo::linear(30);
    let dest = tempfile::tempdir().expect("tempdir");
    let target = dest.path().join("clone");
    let url = src.path().to_string_lossy().into_owned();
    let mut lines: Vec<String> = Vec::new();
    let mut sink = |l: &str| lines.push(l.to_string());
    let out = src
        .runner()
        .run_streaming(
            dest.path(),
            &["clone", "--progress", "--no-local", &url, target.to_str().expect("utf8")],
            RunOpts::default(),
            &mut sink,
            &CancellationToken::new(),
        )
        .await
        .expect("clone succeeds");
    assert!(!lines.is_empty(), "no stderr lines");
    assert!(lines.iter().all(|l| !l.is_empty() && l.trim() == l));
    assert!(
        lines.iter().any(|l| git_core::parse::progress::parse_progress_line(l).is_some()),
        "no progress line in {lines:?}"
    );
    // The full stderr is still returned.
    assert!(out.stderr_str().contains("objects"));
}

#[tokio::test]
async fn streaming_classifies_failures_like_run() {
    let dir = tempfile::tempdir().expect("tempdir");
    let mut sink = |_: &str| {};
    let err = runner()
        .run_streaming(
            dir.path(),
            &["rev-parse", "HEAD"],
            RunOpts::default(),
            &mut sink,
            &CancellationToken::new(),
        )
        .await
        .expect_err("not a repo");
    assert_eq!(err.kind, GitErrorKind::NotARepo);
}

/// A server that accepts connections and never answers. Each accepted socket is watched: the
/// channel receives `true` when the peer closes it (read returns 0) within 10 s.
fn hanging_server() -> (u16, std::sync::mpsc::Receiver<bool>) {
    use std::io::Read;
    let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind");
    let port = listener.local_addr().expect("addr").port();
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        while let Ok((mut s, _)) = listener.accept() {
            let tx = tx.clone();
            std::thread::spawn(move || {
                s.set_read_timeout(Some(Duration::from_secs(10))).ok();
                let mut buf = [0u8; 1024];
                let closed = loop {
                    match s.read(&mut buf) {
                        Ok(0) => break true,
                        Ok(_) => {}
                        Err(e) if e.kind() == std::io::ErrorKind::ConnectionReset => break true,
                        Err(_) => break false,
                    }
                };
                let _ = tx.send(closed);
            });
        }
    });
    (port, rx)
}

fn no_proxy() -> Vec<(String, String)> {
    let mut env: Vec<(String, String)> = Vec::new();
    for k in ["NO_PROXY", "no_proxy"] {
        env.push((k.into(), "*".into()));
    }
    for k in ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy", "ALL_PROXY", "all_proxy"] {
        env.push((k.into(), String::new()));
    }
    env
}

fn hang_opts(timeout: Duration) -> RunOpts {
    RunOpts { timeout: Some(timeout), env: no_proxy(), ..RunOpts::default() }
}

#[tokio::test]
async fn cancel_kills_a_hanging_fetch() {
    let (port, closed) = hanging_server();
    let repo = FixtureRepo::linear(1);
    let url = format!("http://127.0.0.1:{port}/x.git");
    repo.git(&["remote", "add", "hang", &url]);

    let cancel = CancellationToken::new();
    let trigger = cancel.clone();
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_secs(1)).await;
        trigger.cancel();
    });
    let started = std::time::Instant::now();
    let mut sink = |_: &str| {};
    let err = repo
        .runner()
        .run_streaming(
            repo.path(),
            &["fetch", "--progress", "hang"],
            hang_opts(Duration::from_secs(60)),
            &mut sink,
            &cancel,
        )
        .await
        .expect_err("cancelled");
    assert_eq!(err.kind, GitErrorKind::Cancelled);
    assert_eq!(err.code(), "git.cancelled");
    assert!(started.elapsed() < Duration::from_secs(5), "took {:?}", started.elapsed());
    // The connection is held by git-remote-http; EOF proves the whole tree died.
    let eof = closed.recv_timeout(Duration::from_secs(5)).expect("server saw a connection");
    assert!(eof, "socket not closed after cancel: git-remote-http survived");
}

#[tokio::test]
async fn streaming_inactivity_timeout_fires_without_cancel() {
    let (port, _closed) = hanging_server();
    let repo = FixtureRepo::linear(1);
    repo.git(&["remote", "add", "hang", &format!("http://127.0.0.1:{port}/x.git")]);
    let mut sink = |_: &str| {};
    let err = repo
        .runner()
        .run_streaming(
            repo.path(),
            &["fetch", "hang"],
            hang_opts(Duration::from_secs(2)),
            &mut sink,
            &CancellationToken::new(),
        )
        .await
        .expect_err("timeout");
    assert_eq!(err.kind, GitErrorKind::Timeout);
}

#[tokio::test]
async fn cancel_after_completion_does_not_turn_success_into_cancelled() {
    let repo = FixtureRepo::linear(1);
    let cancel = CancellationToken::new();
    let mut sink = |_: &str| {};
    let out = repo
        .runner()
        .run_streaming(repo.path(), &["--version"], RunOpts::default(), &mut sink, &cancel)
        .await
        .expect("completes");
    cancel.cancel();
    assert!(out.stdout_str().starts_with("git version"));
}

#[tokio::test]
async fn streaming_rejects_stdin() {
    let repo = FixtureRepo::linear(1);
    let mut sink = |_: &str| {};
    let err = repo
        .runner()
        .run_streaming(
            repo.path(),
            &["--version"],
            RunOpts::with_stdin("x"),
            &mut sink,
            &CancellationToken::new(),
        )
        .await
        .expect_err("stdin rejected");
    assert_eq!(err.kind, GitErrorKind::Spawn);
    assert_eq!(err.stderr, "stdin is not supported in streaming mode");
}
