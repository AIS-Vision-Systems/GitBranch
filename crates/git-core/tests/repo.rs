#![allow(missing_docs, clippy::unwrap_used)]

use git_core::fixtures::FixtureRepo;
use git_core::{GitErrorKind, repo::discover};

fn same(a: &std::path::Path, b: &std::path::Path) -> bool {
    std::fs::canonicalize(a).unwrap() == std::fs::canonicalize(b).unwrap()
}

#[tokio::test]
async fn discover_plain_repo() {
    let f = FixtureRepo::linear(2);
    let info = discover(&f.runner(), f.path()).await.unwrap();
    assert!(same(&info.work_tree, f.path()));
    assert!(!info.is_worktree && !info.is_bare);
    assert!(info.git_dir.ends_with(".git"));
    assert!(info.main_work_tree.is_none());
}

#[tokio::test]
async fn discover_from_subdirectory() {
    let f = FixtureRepo::linear(2);
    let sub = f.path().join("sub");
    std::fs::create_dir(&sub).unwrap();
    let info = discover(&f.runner(), &sub).await.unwrap();
    assert!(same(&info.work_tree, f.path()));
}

#[tokio::test]
async fn discover_linked_worktree() {
    let f = FixtureRepo::linear(2);
    let tmp = tempfile::tempdir().unwrap();
    let wt = tmp.path().join("wt");
    f.git(&["worktree", "add", "-b", "wt", wt.to_str().unwrap()]);
    let info = discover(&f.runner(), &wt).await.unwrap();
    assert!(info.is_worktree);
    assert!(same(&info.work_tree, &wt));
    assert!(same(info.main_work_tree.as_deref().unwrap(), f.path()));
    assert!(same(&info.common_dir, &f.path().join(".git")));
}

#[tokio::test]
async fn discover_not_a_repo() {
    let tmp = tempfile::tempdir().unwrap();
    let err =
        discover(&git_core::fixtures::isolated_runner(tmp.path()), tmp.path()).await.unwrap_err();
    assert_eq!(err.kind, GitErrorKind::NotARepo);
}

#[tokio::test]
async fn discover_bare_clone() {
    let f = FixtureRepo::linear(2);
    let tmp = tempfile::tempdir().unwrap();
    let bare = tmp.path().join("b.git");
    f.git(&["clone", "--bare", f.path().to_str().unwrap(), bare.to_str().unwrap()]);
    let info = discover(&f.runner(), &bare).await.unwrap();
    assert!(info.is_bare);
    assert!(!info.is_worktree);
}
