//! Tests for `ops::clone` against a bare `origin` over the file transport (no network).
#![allow(clippy::unwrap_used)] // tests: unwrap is fine

use std::time::Duration;

use git_core::GitErrorKind;
use git_core::fixtures::{FixtureRepo, git_in};
use git_core::ops::clone::{CloneArgs, clone};
use git_core::ops::remote::OpCtx;
use tokio_util::sync::CancellationToken;

fn args(url: &std::path::Path, dest: &std::path::Path) -> CloneArgs {
    CloneArgs {
        url: url.to_string_lossy().into_owned(),
        dest: dest.to_string_lossy().into_owned(),
        branch: None,
        depth: None,
        recurse_submodules: false,
    }
}

#[tokio::test]
async fn clones_head() {
    let fx = FixtureRepo::with_remote();
    let tmp = tempfile::tempdir().unwrap();
    let dest = tmp.path().join("out");
    let path = clone(&fx.runner(), &args(fx.remote_path(), &dest), &OpCtx::noop()).await.unwrap();
    assert_eq!(path, dest);
    assert_eq!(git_in(&dest, &["rev-parse", "HEAD"]), fx.rev_parse("HEAD"));
}

#[tokio::test]
async fn clones_into_existing_empty_dir_but_not_a_full_one() {
    let fx = FixtureRepo::with_remote();
    let tmp = tempfile::tempdir().unwrap();
    let empty = tmp.path().join("empty");
    std::fs::create_dir(&empty).unwrap();
    clone(&fx.runner(), &args(fx.remote_path(), &empty), &OpCtx::noop()).await.unwrap();

    let full = tmp.path().join("full");
    std::fs::create_dir(&full).unwrap();
    std::fs::write(full.join("keep.txt"), "x").unwrap();
    let err = clone(&fx.runner(), &args(fx.remote_path(), &full), &OpCtx::noop()).await;
    assert!(err.is_err());
    assert!(full.join("keep.txt").exists(), "a pre-existing dir must not be removed");
}

#[tokio::test]
async fn branch_option_checks_out_that_branch() {
    let fx = FixtureRepo::with_remote();
    fx.git(&["checkout", "-q", "-b", "dev"]);
    fx.commit_file("dev.txt", "dev\n", "dev work");
    fx.git(&["push", "-q", "origin", "dev"]);
    let tmp = tempfile::tempdir().unwrap();
    let dest = tmp.path().join("out");
    let mut a = args(fx.remote_path(), &dest);
    a.branch = Some("dev".into());
    clone(&fx.runner(), &a, &OpCtx::noop()).await.unwrap();
    assert_eq!(git_in(&dest, &["symbolic-ref", "--short", "HEAD"]), "dev");
    assert!(dest.join("dev.txt").exists());
}

#[tokio::test]
async fn depth_one_is_shallow() {
    let fx = FixtureRepo::with_remote();
    let tmp = tempfile::tempdir().unwrap();
    let dest = tmp.path().join("out");
    let mut a = args(fx.remote_path(), &dest);
    a.depth = Some(1);
    // Local paths ignore --depth; the file:// transport honours it.
    let p = fx.remote_path().to_string_lossy().replace(std::path::MAIN_SEPARATOR, "/");
    a.url = format!("file://{}{p}", if p.starts_with('/') { "" } else { "/" });
    clone(&fx.runner(), &a, &OpCtx::noop()).await.unwrap();
    assert_eq!(git_in(&dest, &["rev-list", "--count", "HEAD"]), "1");
    assert!(dest.join(".git").join("shallow").exists());
}

#[tokio::test]
async fn failed_clone_leaves_no_dest() {
    let fx = FixtureRepo::linear(1);
    let tmp = tempfile::tempdir().unwrap();
    std::fs::create_dir(tmp.path().join("nested")).unwrap();
    let dest = tmp.path().join("nested").join("out");
    let missing = tmp.path().join("no-such-repo");
    let err = clone(&fx.runner(), &args(&missing, &dest), &OpCtx::noop()).await.unwrap_err();
    assert!(matches!(err.kind, GitErrorKind::ExitCode(_)), "{err:?}");
    assert!(!dest.exists());
}

#[tokio::test]
async fn rejects_bad_arguments() {
    let fx = FixtureRepo::linear(1);
    let tmp = tempfile::tempdir().unwrap();
    let dest = tmp.path().join("out");
    let ctx = OpCtx::noop();
    for url in [
        "",
        "--upload-pack=x",
        "https://u:pw@example.invalid/r.git",
        "https://ghp_x@github.com/o/r.git",
    ] {
        let mut a = args(fx.path(), &dest);
        a.url = url.into();
        assert!(clone(&fx.runner(), &a, &ctx).await.is_err(), "{url}");
    }
    let mut a = args(fx.path(), &dest);
    a.branch = Some("+main".into());
    assert!(clone(&fx.runner(), &a, &ctx).await.is_err());
    let mut a = args(fx.path(), &dest);
    a.dest = "relative/out".into();
    assert!(clone(&fx.runner(), &a, &ctx).await.is_err());
    assert!(!dest.exists());
}

#[tokio::test]
async fn cancelled_clone_leaves_no_dest() {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind");
    let port = listener.local_addr().expect("addr").port();
    let held = std::thread::spawn(move || {
        let mut conns = Vec::new();
        while let Ok((s, _)) = listener.accept() {
            conns.push(s);
            if conns.len() >= 4 {
                break;
            }
        }
        std::thread::sleep(Duration::from_secs(8));
    });
    let fx = FixtureRepo::linear(1);
    let tmp = tempfile::tempdir().unwrap();
    let dest = tmp.path().join("out");
    let mut a = args(fx.path(), &dest);
    a.url = format!("http://127.0.0.1:{port}/x.git");
    let cancel = CancellationToken::new();
    let trigger = cancel.clone();
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(500)).await;
        trigger.cancel();
    });
    let ctx = OpCtx { cancel, ..OpCtx::noop() };
    let err = clone(&fx.runner(), &a, &ctx).await.unwrap_err();
    assert_eq!(err.kind, GitErrorKind::Cancelled);
    assert!(!dest.exists());
    drop(held);
}

#[tokio::test]
async fn missing_parent_is_rejected_and_ssh_userinfo_passes_the_check() {
    let fx = FixtureRepo::linear(1);
    let tmp = tempfile::tempdir().unwrap();
    let dest = tmp.path().join("nope").join("out");
    let err = clone(&fx.runner(), &args(fx.path(), &dest), &OpCtx::noop()).await.unwrap_err();
    assert_eq!(err.kind, GitErrorKind::ExitCode(129));
    assert!(!tmp.path().join("nope").exists());
    // The credential check rejects with a specific message only for http(s) userinfo.
    let dest = tmp.path().join("out");
    for (url, rejected) in [
        ("https://ghp_x@github.com/o/r.git", true),
        ("ssh://git@127.0.0.1:1/o/r.git", false),
        ("git@127.0.0.1:o/r.git", false),
    ] {
        let mut a = args(fx.path(), &dest);
        a.url = url.into();
        let err = clone(&fx.runner(), &a, &OpCtx::noop()).await.unwrap_err();
        assert_eq!(err.stderr.contains("credentials in URL"), rejected, "{url}: {err:?}");
    }
}

#[tokio::test]
async fn failed_clone_into_existing_empty_dir_keeps_the_dir() {
    let fx = FixtureRepo::linear(1);
    let tmp = tempfile::tempdir().unwrap();
    let dest = tmp.path().join("out");
    std::fs::create_dir(&dest).unwrap();
    let missing = tmp.path().join("no-such-repo");
    clone(&fx.runner(), &args(&missing, &dest), &OpCtx::noop()).await.unwrap_err();
    assert!(dest.is_dir());
    assert_eq!(std::fs::read_dir(&dest).unwrap().count(), 0);
}

#[tokio::test]
async fn recurse_submodules_checks_out_the_submodule() {
    let fx = FixtureRepo::with_submodule();
    let tmp = tempfile::tempdir().unwrap();
    let missing = tmp.path().join("gitbranch-no-such-config").to_string_lossy().into_owned();
    // Test-only: the file transport is blocked for submodules by default.
    let runner = git_core::GitRunner::from_env().with_env(
        [
            ("GIT_CONFIG_GLOBAL", missing.as_str()),
            ("GIT_CONFIG_SYSTEM", missing.as_str()),
            ("GIT_CONFIG_NOSYSTEM", "1"),
            ("GIT_CONFIG_COUNT", "1"),
            ("GIT_CONFIG_KEY_0", "protocol.file.allow"),
            ("GIT_CONFIG_VALUE_0", "always"),
        ]
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .to_vec(),
    );
    let dest = tmp.path().join("out");
    let mut a = args(fx.path(), &dest);
    a.recurse_submodules = true;
    clone(&runner, &a, &OpCtx::noop()).await.unwrap();
    let lib = dest.join("vendor").join("lib");
    let has_file = std::fs::read_dir(&lib).unwrap().any(|e| e.unwrap().file_name() != ".git");
    assert!(has_file, "submodule not checked out");
}

fn path_str(p: &std::path::Path) -> String {
    p.to_string_lossy().into_owned()
}

#[tokio::test]
async fn lists_remote_heads_default_first() {
    use git_core::ops::clone::list_remote_heads;
    let fx = FixtureRepo::with_remote();
    let cur = fx.git(&["branch", "--show-current"]);
    fx.git(&["push", "origin", "HEAD:refs/heads/zeta", "HEAD:refs/heads/alpha"]);
    fx.git(&["push", "origin", "HEAD:refs/heads/feature/x"]);
    git_in(fx.remote_path(), &["symbolic-ref", "HEAD", &format!("refs/heads/{}", cur.trim())]);
    let url = path_str(fx.remote_path());
    let heads = list_remote_heads(&fx.runner(), &url, &CancellationToken::new()).await.unwrap();
    assert_eq!(heads.default_branch.as_deref(), Some(cur.trim()));
    assert_eq!(heads.branches.first().map(String::as_str), Some(cur.trim()));
    for b in ["alpha", "zeta", "feature/x"] {
        assert!(heads.branches.iter().any(|x| x == b), "missing {b}");
    }
}

#[tokio::test]
async fn list_remote_heads_empty_and_detached() {
    use git_core::ops::clone::list_remote_heads;
    let fx = FixtureRepo::with_remote();
    let tmp = tempfile::tempdir().unwrap();
    let empty = tmp.path().join("empty.git");
    std::fs::create_dir(&empty).unwrap();
    git_in(&empty, &["init", "--bare", "-q"]);
    let heads = list_remote_heads(&fx.runner(), &path_str(&empty), &CancellationToken::new())
        .await
        .unwrap();
    assert_eq!(heads.default_branch, None);
    assert!(heads.branches.is_empty());

    let oid = fx.rev_parse("HEAD");
    fx.git(&["push", "origin", "HEAD:refs/heads/side"]);
    git_in(fx.remote_path(), &["update-ref", "--no-deref", "HEAD", &oid]);
    let url = path_str(fx.remote_path());
    let heads = list_remote_heads(&fx.runner(), &url, &CancellationToken::new()).await.unwrap();
    assert_eq!(heads.default_branch, None);
    assert!(heads.branches.iter().any(|b| b == "side"));
}

#[tokio::test]
async fn list_remote_heads_errors() {
    use git_core::ops::clone::list_remote_heads;
    let fx = FixtureRepo::with_remote();
    let tok = CancellationToken::new();
    let tmp = tempfile::tempdir().unwrap();
    let missing = path_str(&tmp.path().join("nope"));
    assert!(list_remote_heads(&fx.runner(), &missing, &tok).await.is_err());
    for bad in ["--upload-pack=x", "origin", "relative/path", "", "C:foo"] {
        let e = list_remote_heads(&fx.runner(), bad, &tok).await.unwrap_err();
        assert!(e.stderr.contains("invalid clone argument"), "{bad}: {}", e.stderr);
    }
    let e = list_remote_heads(&fx.runner(), "ext::sh -c id", &tok).await.unwrap_err();
    assert!(e.stderr.contains("not allowed"), "{}", e.stderr);
}

#[tokio::test]
async fn list_remote_heads_cancelled() {
    use git_core::ops::clone::list_remote_heads;
    let fx = FixtureRepo::with_remote();
    let tok = CancellationToken::new();
    tok.cancel();
    let url = path_str(fx.remote_path());
    let e = list_remote_heads(&fx.runner(), &url, &tok).await.unwrap_err();
    assert_eq!(e.kind, GitErrorKind::Cancelled);
}
