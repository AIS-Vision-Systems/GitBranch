//! Tests for `ops::init` with real git in temp directories.
#![allow(clippy::unwrap_used)] // tests: unwrap is fine

use std::path::Path;

use git_core::GitRunner;
use git_core::fixtures::git_in;
use git_core::ops::init::{InitArgs, init};

fn args(dest: &Path, branch: Option<&str>, readme: bool) -> InitArgs {
    InitArgs {
        dest: dest.to_string_lossy().into_owned(),
        initial_branch: branch.map(Into::into),
        readme,
    }
}

fn runner(tmp: &Path, identity: bool) -> GitRunner {
    let missing = tmp.join("gitbranch-no-such-config").to_string_lossy().into_owned();
    let mut v: Vec<(String, String)> = vec![
        ("GIT_CONFIG_GLOBAL".into(), missing.clone()),
        ("GIT_CONFIG_SYSTEM".into(), missing),
        ("GIT_CONFIG_NOSYSTEM".into(), "1".into()),
    ];
    let extra: [(&str, &str); 4] = if identity {
        [
            ("GIT_AUTHOR_NAME", "T"),
            ("GIT_AUTHOR_EMAIL", "t@gitbranch.invalid"),
            ("GIT_COMMITTER_NAME", "T"),
            ("GIT_COMMITTER_EMAIL", "t@gitbranch.invalid"),
        ]
    } else {
        // No identity anywhere and no guessing from the host name: commit must fail.
        [
            ("GIT_CONFIG_COUNT", "1"),
            ("GIT_CONFIG_KEY_0", "user.useConfigOnly"),
            ("GIT_CONFIG_VALUE_0", "true"),
            ("GIT_TERMINAL_PROMPT", "0"),
        ]
    };
    v.extend(extra.iter().map(|(k, val)| ((*k).to_string(), (*val).to_string())));
    GitRunner::from_env().with_env(v)
}

#[tokio::test]
async fn creates_repo_with_readme_commit_on_branch() {
    let tmp = tempfile::tempdir().unwrap();
    let dest = tmp.path().join("proj");
    let res = init(&runner(tmp.path(), true), &args(&dest, Some(" trunk "), true)).await.unwrap();
    assert_eq!(res.path, dest);
    assert!(res.commit_error.is_none());
    assert_eq!(git_in(&dest, &["symbolic-ref", "HEAD"]), "refs/heads/trunk");
    assert_eq!(git_in(&dest, &["rev-list", "--count", "HEAD"]), "1");
    assert_eq!(std::fs::read_to_string(dest.join("README.md")).unwrap(), "# proj\n");
}

#[tokio::test]
async fn without_readme_head_is_unborn_on_requested_branch() {
    let tmp = tempfile::tempdir().unwrap();
    let dest = tmp.path().join("p");
    let res = init(&runner(tmp.path(), true), &args(&dest, Some("dev"), false)).await.unwrap();
    assert!(res.commit_error.is_none());
    assert_eq!(git_in(&dest, &["symbolic-ref", "HEAD"]), "refs/heads/dev");
    assert_eq!(git_in(&dest, &["rev-list", "--all", "--count"]), "0");
    assert!(!dest.join("README.md").exists());
}

#[tokio::test]
async fn blank_branch_uses_git_default() {
    let tmp = tempfile::tempdir().unwrap();
    let dest = tmp.path().join("p");
    init(&runner(tmp.path(), true), &args(&dest, Some("  "), false)).await.unwrap();
    assert!(dest.join(".git").exists());
}

#[tokio::test]
async fn accepts_existing_empty_dir_rejects_full_one() {
    let tmp = tempfile::tempdir().unwrap();
    let r = runner(tmp.path(), true);
    let empty = tmp.path().join("empty");
    std::fs::create_dir(&empty).unwrap();
    init(&r, &args(&empty, None, false)).await.unwrap();
    assert!(empty.join(".git").exists());

    let full = tmp.path().join("full");
    std::fs::create_dir(&full).unwrap();
    std::fs::write(full.join("a.txt"), "x").unwrap();
    init(&r, &args(&full, None, true)).await.unwrap_err();
    assert!(!full.join(".git").exists());
    assert!(!full.join("README.md").exists());
    assert_eq!(std::fs::read_dir(&full).unwrap().count(), 1);
}

#[tokio::test]
async fn rejects_relative_path_and_missing_parent() {
    let tmp = tempfile::tempdir().unwrap();
    let r = runner(tmp.path(), true);
    init(&r, &args(Path::new("rel/dir"), None, false)).await.unwrap_err();
    let dest = tmp.path().join("nope").join("p");
    init(&r, &args(&dest, None, false)).await.unwrap_err();
    assert!(!tmp.path().join("nope").exists());
}

#[tokio::test]
async fn invalid_branch_rejected_and_no_dir_left() {
    let tmp = tempfile::tempdir().unwrap();
    let r = runner(tmp.path(), true);
    for bad in ["-x", "a..b", "+x", "a b"] {
        let dest = tmp.path().join("p");
        let e = init(&r, &args(&dest, Some(bad), true)).await.unwrap_err();
        assert!(e.stderr.contains("invalid init argument"), "{bad}: {}", e.stderr);
        assert!(!dest.exists(), "{bad}");
    }
}

#[tokio::test]
async fn commit_failure_keeps_repo_and_reports_error() {
    let tmp = tempfile::tempdir().unwrap();
    let dest = tmp.path().join("p");
    let res = init(&runner(tmp.path(), false), &args(&dest, Some("main"), true)).await.unwrap();
    let msg = res.commit_error.expect("commit must fail without identity");
    assert_ne!(msg, "");
    assert!(dest.join(".git").exists());
    assert_eq!(git_in(&dest, &["symbolic-ref", "HEAD"]), "refs/heads/main");
}
