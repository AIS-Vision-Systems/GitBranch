//! Tests for `ops::state::in_progress` against real operations.
#![allow(clippy::unwrap_used)] // tests: unwrap is fine

use git_core::GitErrorKind;
use git_core::fixtures::FixtureRepo;
use git_core::ops::merge::{MergeArgs, MergeMode, OpKind, abort, merge};
use git_core::ops::rebase::rebase;
use git_core::ops::state::{InProgressKind, in_progress};

fn conflicting() -> FixtureRepo {
    let r = FixtureRepo::linear(2);
    r.git(&["switch", "-c", "feat"]);
    r.commit_file("f1.txt", "feat side\n", "feat edit");
    r.git(&["switch", "main"]);
    r.commit_file("f1.txt", "main side\n", "main edit");
    r
}

#[tokio::test]
async fn idle_repo_has_no_operation() {
    let r = FixtureRepo::linear(2);
    let info = git_core::repo::discover(&r.runner(), r.path()).await.unwrap();
    assert_eq!(in_progress(&info), None);
}

#[tokio::test]
async fn reports_merge_then_clears_on_abort() {
    let r = conflicting();
    let runner = r.runner();
    let a = MergeArgs { source: "feat".into(), mode: MergeMode::Default, message: None };
    merge(&runner, r.path(), &a).await.unwrap_err();
    let info = git_core::repo::discover(&runner, r.path()).await.unwrap();
    assert_eq!(in_progress(&info).unwrap().kind, InProgressKind::Merge);
    abort(&runner, r.path(), OpKind::Merge).await.unwrap();
    assert_eq!(in_progress(&info), None);
}

#[tokio::test]
async fn reports_rebase_progress() {
    let r = conflicting();
    let runner = r.runner();
    r.git(&["switch", "feat"]);
    let err = rebase(&runner, r.path(), "main", None).await.unwrap_err();
    assert_eq!(err.kind, GitErrorKind::Conflict);
    let info = git_core::repo::discover(&runner, r.path()).await.unwrap();
    let p = in_progress(&info).unwrap();
    assert_eq!(p.kind, InProgressKind::Rebase);
    assert_eq!(p.head_name.as_deref(), Some("feat"));
    assert_eq!(p.onto, Some(r.rev_parse("main")));
    assert_eq!((p.done, p.total), (1, 1));
}
