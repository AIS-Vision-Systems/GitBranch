//! Tests for `ops::stash` and `parse::stash`.
#![allow(clippy::unwrap_used)] // tests: unwrap is fine

use git_core::GitErrorKind;
use git_core::fixtures::FixtureRepo;
use git_core::ops::stash::{StashPushArgs, stash_apply, stash_drop, stash_pop, stash_push};
use git_core::parse::show::commit_details;
use git_core::parse::stash::stash_list;

fn args(msg: Option<&str>, untracked: bool, paths: &[&str]) -> StashPushArgs {
    StashPushArgs {
        message: msg.map(str::to_string),
        include_untracked: untracked,
        keep_index: false,
        paths: paths.iter().map(|s| (*s).to_string()).collect(),
    }
}

fn top(fx: &FixtureRepo) -> String {
    fx.rev_parse("refs/stash")
}

#[tokio::test]
async fn list_and_show_fixture_stash() {
    let fx = FixtureRepo::with_stash();
    let r = fx.runner();
    let list = stash_list(&r, fx.path()).await.unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].index, 0);
    assert_eq!(list[0].branch.as_deref(), Some("main"));
    assert!(list[0].message.contains("wip"));
    let details = commit_details(&r, fx.path(), &list[0].oid).await.unwrap();
    assert!(details.files.iter().any(|f| f.path == "f1.txt"), "{:?}", details.files);
}

#[tokio::test]
async fn push_message_untracked_and_paths() {
    let fx = FixtureRepo::linear(2);
    let r = fx.runner();
    let p = fx.path();
    std::fs::write(p.join("f1.txt"), "m1\n").unwrap();
    std::fs::write(p.join("f2.txt"), "m2\n").unwrap();
    std::fs::write(p.join("new.txt"), "n\n").unwrap();

    stash_push(&r, p, &args(Some("only f1"), false, &["f1.txt"])).await.unwrap();
    assert_eq!(std::fs::read_to_string(p.join("f1.txt")).unwrap(), "line 1\n");
    assert_eq!(std::fs::read_to_string(p.join("f2.txt")).unwrap(), "m2\n");

    stash_push(&r, p, &args(None, true, &[])).await.unwrap();
    assert!(!p.join("new.txt").exists());

    let list = stash_list(&r, p).await.unwrap();
    assert_eq!(list.len(), 2);
    assert_eq!(list[0].index, 0);
    assert!(list[0].message.starts_with("WIP on main"));
    assert_eq!(list[1].message, "On main: only f1");
    assert_eq!(list[1].branch.as_deref(), Some("main"));
}

#[tokio::test]
async fn apply_keeps_pop_and_drop_remove() {
    let fx = FixtureRepo::with_stash();
    let r = fx.runner();
    let p = fx.path();
    stash_apply(&r, p, 0, &top(&fx), false).await.unwrap();
    assert_eq!(std::fs::read_to_string(p.join("f1.txt")).unwrap(), "modified\n");
    assert_eq!(stash_list(&r, p).await.unwrap().len(), 1);

    fx.git(&["checkout", "-q", "--", "f1.txt"]);
    std::fs::remove_file(p.join("untracked.txt")).unwrap();
    stash_pop(&r, p, 0, &top(&fx), false).await.unwrap();
    assert!(stash_list(&r, p).await.unwrap().is_empty());
    assert!(p.join("untracked.txt").exists());

    std::fs::write(p.join("f1.txt"), "again\n").unwrap();
    stash_push(&r, p, &args(None, false, &[])).await.unwrap();
    stash_drop(&r, p, 0, &top(&fx)).await.unwrap();
    assert!(stash_list(&r, p).await.unwrap().is_empty());
    assert!(stash_drop(&r, p, 0, &fx.rev_parse("HEAD")).await.is_err());
}

#[tokio::test]
async fn pop_conflict_is_reported_and_keeps_entry() {
    let fx = FixtureRepo::linear(2);
    let r = fx.runner();
    let p = fx.path();
    std::fs::write(p.join("f1.txt"), "stashed\n").unwrap();
    stash_push(&r, p, &args(None, false, &[])).await.unwrap();
    fx.commit_file("f1.txt", "committed\n", "diverge");
    let err = stash_pop(&r, p, 0, &top(&fx), false).await.unwrap_err();
    assert_eq!(err.kind, GitErrorKind::Conflict, "{err:?}");
    assert_eq!(stash_list(&r, p).await.unwrap().len(), 1);
}

#[tokio::test]
async fn wrong_oid_is_refused_and_keeps_entry() {
    let fx = FixtureRepo::with_stash();
    let r = fx.runner();
    let p = fx.path();
    let good = top(&fx);
    let bad = fx.rev_parse("HEAD");
    for err in [
        stash_pop(&r, p, 0, &bad, false).await.unwrap_err(),
        stash_apply(&r, p, 0, &bad, false).await.unwrap_err(),
        stash_drop(&r, p, 0, &bad).await.unwrap_err(),
        stash_drop(&r, p, 5, &good).await.unwrap_err(),
    ] {
        assert_eq!(err.kind, GitErrorKind::NotFound);
        assert_eq!(err.stderr, "stash list changed");
    }
    assert_eq!(stash_list(&r, p).await.unwrap().len(), 1);
    assert!(!fx.git(&["status", "--porcelain"]).contains("f1.txt"));
    stash_pop(&r, p, 0, &good, false).await.unwrap();
    assert!(stash_list(&r, p).await.unwrap().is_empty());
}

#[tokio::test]
async fn push_paths_are_literal() {
    let fx = FixtureRepo::linear(2);
    let r = fx.runner();
    let p = fx.path();
    std::fs::write(p.join("f1.txt"), "m1\n").unwrap();
    std::fs::write(p.join("f2.txt"), "m2\n").unwrap();
    // A glob must not match anything: no such literal file.
    let _ = stash_push(&r, p, &args(None, false, &["f*.txt"])).await;
    assert!(stash_list(&r, p).await.unwrap().is_empty());
    assert_eq!(std::fs::read_to_string(p.join("f1.txt")).unwrap(), "m1\n");
}
