//! Tests for `ops::rebase`.
#![allow(clippy::unwrap_used)] // tests: unwrap is fine

use git_core::GitErrorKind;
use git_core::fixtures::FixtureRepo;
use git_core::ops::merge::{OpKind, abort};
use git_core::ops::rebase::{
    TodoAction, TodoEntry, TodoItem, rebase, rebase_interactive, rebase_todo,
};
use git_core::ops::state::{InProgressKind, in_progress};

/// main: c1 c2; feat (checked out): c2 + a, b, c.
fn three_on_feat() -> (FixtureRepo, Vec<String>) {
    let r = FixtureRepo::linear(2);
    r.git(&["switch", "-c", "feat"]);
    let oids = vec![
        r.commit_file("a.txt", "a\n", "add a"),
        r.commit_file("b.txt", "b\n", "add b"),
        r.commit_file("c.txt", "c\n", "add c"),
    ];
    (r, oids)
}

fn subjects(r: &FixtureRepo, range: &str) -> Vec<String> {
    r.git(&["log", "--reverse", "--format=%s", range]).lines().map(String::from).collect()
}

fn item(action: TodoAction, oid: &str) -> TodoItem {
    TodoItem { action, oid: oid.into() }
}

#[tokio::test]
async fn rebases_onto_moved_main() {
    let (r, _) = three_on_feat();
    r.git(&["switch", "main"]);
    r.commit_file("m.txt", "m\n", "main moved");
    r.git(&["switch", "feat"]);
    rebase(&r.runner(), r.path(), "main", None).await.unwrap();
    assert_eq!(subjects(&r, "main..feat"), ["add a", "add b", "add c"]);
    assert_eq!(r.git(&["rev-list", "--merges", "--count", "feat"]), "0");
    assert_eq!(r.rev_parse("feat~3"), r.rev_parse("main"));
}

#[tokio::test]
async fn rebase_with_explicit_branch() {
    let (r, _) = three_on_feat();
    r.git(&["switch", "main"]);
    r.commit_file("m.txt", "m\n", "main moved");
    rebase(&r.runner(), r.path(), "main", Some("feat")).await.unwrap();
    assert_eq!(r.git(&["branch", "--show-current"]), "feat");
    assert_eq!(r.rev_parse("feat~3"), r.rev_parse("main"));
}

#[tokio::test]
async fn conflicting_rebase_reports_and_aborts() {
    let r = FixtureRepo::linear(2);
    r.git(&["switch", "-c", "feat"]);
    r.commit_file("f1.txt", "feat side\n", "feat edit");
    r.git(&["switch", "main"]);
    r.commit_file("f1.txt", "main side\n", "main edit");
    r.git(&["switch", "feat"]);
    let runner = r.runner();
    let feat = r.rev_parse("feat");
    let err = rebase(&runner, r.path(), "main", None).await.unwrap_err();
    assert_eq!(err.kind, GitErrorKind::Conflict);
    let info = git_core::repo::discover(&runner, r.path()).await.unwrap();
    let p = in_progress(&info).unwrap();
    assert_eq!(p.kind, InProgressKind::Rebase);
    assert_eq!(p.head_name.as_deref(), Some("feat"));
    abort(&runner, r.path(), OpKind::Rebase).await.unwrap();
    assert_eq!(in_progress(&info), None);
    assert_eq!(r.rev_parse("feat"), feat);
    assert_eq!(r.git(&["status", "--porcelain"]), "");
}

#[tokio::test]
async fn todo_lists_commits_oldest_first() {
    let (r, oids) = three_on_feat();
    let todo = rebase_todo(&r.runner(), r.path(), "main").await.unwrap();
    let want: Vec<TodoEntry> = oids
        .iter()
        .zip(["add a", "add b", "add c"])
        .map(|(o, s)| TodoEntry { oid: o.clone(), subject: s.into() })
        .collect();
    assert_eq!(todo, want);
}

#[tokio::test]
async fn interactive_reorder() {
    let (r, o) = three_on_feat();
    let tip_tree = r.rev_parse("HEAD^{tree}");
    let items = [
        item(TodoAction::Pick, &o[1]),
        item(TodoAction::Pick, &o[0]),
        item(TodoAction::Pick, &o[2]),
    ];
    rebase_interactive(&r.runner(), r.path(), "main", &items).await.unwrap();
    assert_eq!(subjects(&r, "main..HEAD"), ["add b", "add a", "add c"]);
    assert_eq!(r.rev_parse("HEAD^{tree}"), tip_tree);
    assert_eq!(r.git(&["branch", "--show-current"]), "feat");
}

#[tokio::test]
async fn interactive_squash_and_fixup() {
    let (r, o) = three_on_feat();
    let tip_tree = r.rev_parse("HEAD^{tree}");
    let items = [
        item(TodoAction::Pick, &o[0]),
        item(TodoAction::Squash, &o[1]),
        item(TodoAction::Pick, &o[2]),
    ];
    rebase_interactive(&r.runner(), r.path(), "main", &items).await.unwrap();
    assert_eq!(r.git(&["rev-list", "--count", "main..HEAD"]), "2");
    assert_eq!(r.rev_parse("HEAD^{tree}"), tip_tree);

    let (r, o) = three_on_feat();
    let tip_tree = r.rev_parse("HEAD^{tree}");
    let items = [
        item(TodoAction::Pick, &o[0]),
        item(TodoAction::Fixup, &o[1]),
        item(TodoAction::Fixup, &o[2]),
    ];
    rebase_interactive(&r.runner(), r.path(), "main", &items).await.unwrap();
    assert_eq!(subjects(&r, "main..HEAD"), ["add a"]);
    assert_eq!(r.rev_parse("HEAD^{tree}"), tip_tree);
}

#[tokio::test]
async fn interactive_drop() {
    let (r, o) = three_on_feat();
    let items = [
        item(TodoAction::Pick, &o[0]),
        item(TodoAction::Drop, &o[1]),
        item(TodoAction::Pick, &o[2]),
    ];
    rebase_interactive(&r.runner(), r.path(), "main", &items).await.unwrap();
    assert_eq!(subjects(&r, "main..HEAD"), ["add a", "add c"]);
    assert!(!r.path().join("b.txt").exists());
}

#[tokio::test]
async fn interactive_rejects_leading_squash_without_touching_git() {
    let (r, o) = three_on_feat();
    let head = r.rev_parse("HEAD");
    let items = [item(TodoAction::Squash, &o[0]), item(TodoAction::Pick, &o[1])];
    let err = rebase_interactive(&r.runner(), r.path(), "main", &items).await.unwrap_err();
    assert!(matches!(err, git_core::ops::rebase::RebaseError::Invalid(_)));
    assert_eq!(r.rev_parse("HEAD"), head);
}

#[tokio::test]
async fn interactive_rejects_items_missing_a_commit() {
    let (r, o) = three_on_feat();
    let head = r.rev_parse("HEAD");
    let items = [item(TodoAction::Pick, &o[0]), item(TodoAction::Pick, &o[2])];
    let err = rebase_interactive(&r.runner(), r.path(), "main", &items).await.unwrap_err();
    assert!(matches!(err, git_core::ops::rebase::RebaseError::Invalid(_)), "{err:?}");
    assert_eq!(r.rev_parse("HEAD"), head);
    assert_eq!(r.git(&["status", "--porcelain"]), "");
}
