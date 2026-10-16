//! Tests for `ops::merge` (merge, abort, continue, skip).
#![allow(clippy::unwrap_used)] // tests: unwrap is fine

use git_core::GitErrorKind;
use git_core::fixtures::FixtureRepo;
use git_core::ops::conflict::{Side, conflicted_files, take_side};
use git_core::ops::merge::{
    MergeArgs, MergeMode, MergeOutcome, OpKind, abort, continue_op, merge, skip,
};
use git_core::ops::state::{InProgressKind, in_progress};

fn args(source: &str, mode: MergeMode) -> MergeArgs {
    MergeArgs { source: source.into(), mode, message: None }
}

/// `feat` has one commit on top of `main`'s c2 (main has not moved).
fn ahead() -> FixtureRepo {
    let r = FixtureRepo::linear(2);
    r.git(&["switch", "-c", "feat"]);
    r.commit_file("feat1.txt", "feat\n", "feat1");
    r.git(&["switch", "main"]);
    r
}

/// `feat` and `main` both added a commit.
fn divergent() -> FixtureRepo {
    let r = ahead();
    r.commit_file("main1.txt", "main\n", "main1");
    r
}

/// `feat` and `main` both changed f1.txt.
fn conflicting() -> FixtureRepo {
    let r = FixtureRepo::linear(2);
    r.git(&["switch", "-c", "feat"]);
    r.commit_file("f1.txt", "feat side\n", "feat edit");
    r.git(&["switch", "main"]);
    r.commit_file("f1.txt", "main side\n", "main edit");
    r
}

#[tokio::test]
async fn fast_forward() {
    let r = ahead();
    let out = merge(&r.runner(), r.path(), &args("feat", MergeMode::Default)).await.unwrap();
    assert_eq!(out, MergeOutcome::FastForward);
    assert_eq!(r.rev_parse("HEAD"), r.rev_parse("feat"));
}

#[tokio::test]
async fn no_fast_forward_makes_a_merge_commit() {
    let r = ahead();
    let a = MergeArgs {
        source: "feat".into(),
        mode: MergeMode::NoFastForward,
        message: Some("join feat".into()),
    };
    assert_eq!(merge(&r.runner(), r.path(), &a).await.unwrap(), MergeOutcome::Merged);
    assert_eq!(r.git(&["rev-list", "--parents", "-n1", "HEAD"]).split(' ').count(), 3);
    assert_eq!(r.git(&["log", "-1", "--format=%s"]), "join feat");
}

#[tokio::test]
async fn default_on_divergent_merges() {
    let r = divergent();
    let out = merge(&r.runner(), r.path(), &args("feat", MergeMode::Default)).await.unwrap();
    assert_eq!(out, MergeOutcome::Merged);
}

#[tokio::test]
async fn ff_only_on_divergent_fails() {
    let r = divergent();
    let head = r.rev_parse("HEAD");
    let err =
        merge(&r.runner(), r.path(), &args("feat", MergeMode::FastForwardOnly)).await.unwrap_err();
    assert!(matches!(err.kind, GitErrorKind::ExitCode(_)), "{err:?}");
    assert_eq!(r.rev_parse("HEAD"), head);
}

#[tokio::test]
async fn squash_stages_without_committing() {
    let r = ahead();
    let head = r.rev_parse("HEAD");
    let out = merge(&r.runner(), r.path(), &args("feat", MergeMode::Squash)).await.unwrap();
    assert_eq!(out, MergeOutcome::Squashed);
    assert_eq!(r.rev_parse("HEAD"), head);
    assert!(r.git(&["status", "--porcelain"]).contains("feat1.txt"));
}

#[tokio::test]
async fn already_up_to_date() {
    let r = ahead();
    r.git(&["merge", "-q", "feat"]);
    let out = merge(&r.runner(), r.path(), &args("feat", MergeMode::Default)).await.unwrap();
    assert_eq!(out, MergeOutcome::AlreadyUpToDate);
}

#[tokio::test]
async fn conflict_resolve_with_theirs_and_continue() {
    let r = conflicting();
    let runner = r.runner();
    let err = merge(&runner, r.path(), &args("feat", MergeMode::Default)).await.unwrap_err();
    assert_eq!(err.kind, GitErrorKind::Conflict);

    let info = git_core::repo::discover(&runner, r.path()).await.unwrap();
    assert_eq!(in_progress(&info).unwrap().kind, InProgressKind::Merge);
    assert_eq!(conflicted_files(&runner, r.path()).await.unwrap(), vec!["f1.txt".to_string()]);

    take_side(&runner, r.path(), &["f1.txt".to_string()], Side::Theirs).await.unwrap();
    assert!(conflicted_files(&runner, r.path()).await.unwrap().is_empty());
    continue_op(&runner, r.path(), OpKind::Merge).await.unwrap();

    assert_eq!(in_progress(&info), None);
    assert_eq!(std::fs::read_to_string(r.path().join("f1.txt")).unwrap(), "feat side\n");
    assert_eq!(r.git(&["rev-list", "--parents", "-n1", "HEAD"]).split(' ').count(), 3);
}

#[tokio::test]
async fn abort_restores_a_clean_tree() {
    let r = conflicting();
    let runner = r.runner();
    let head = r.rev_parse("HEAD");
    merge(&runner, r.path(), &args("feat", MergeMode::Default)).await.unwrap_err();
    abort(&runner, r.path(), OpKind::Merge).await.unwrap();
    assert_eq!(r.rev_parse("HEAD"), head);
    assert_eq!(r.git(&["status", "--porcelain"]), "");
}

#[tokio::test]
async fn skip_on_merge_is_an_error() {
    let r = FixtureRepo::linear(1);
    let err = skip(&r.runner(), r.path(), OpKind::Merge).await.unwrap_err();
    assert_eq!(err.kind, GitErrorKind::ExitCode(2));
    assert!(err.stderr.contains("nothing to skip"));
}
