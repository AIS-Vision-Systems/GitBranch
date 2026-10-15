//! Integration tests for `GitRunner` against real repositories.

use std::path::Path;
use std::time::Duration;

use git_core::fixtures::FixtureRepo;
use git_core::{GitErrorKind, GitRunner, RunOpts};

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
