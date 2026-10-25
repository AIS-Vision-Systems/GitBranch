//! Integration tests for the fixture helper itself.

use git_core::fixtures::{FixtureRepo, Kind, git_command};

#[test]
fn empty_is_work_tree() {
    let r = FixtureRepo::empty();
    assert_eq!(r.git(&["rev-parse", "--is-inside-work-tree"]), "true");
}

#[test]
fn linear_has_five_commits() {
    let r = FixtureRepo::linear(5);
    assert_eq!(r.git(&["rev-list", "--count", "HEAD"]), "5");
}

#[test]
fn merge_has_two_parents() {
    let r = FixtureRepo::merge();
    assert_eq!(r.git(&["rev-list", "--parents", "-n1", "HEAD"]).split(' ').count(), 3);
    r.git(&["rev-parse", "--verify", "feature"]);
}

#[test]
fn octopus_has_four_parents() {
    let r = FixtureRepo::octopus();
    assert_eq!(r.git(&["rev-list", "--parents", "-n1", "HEAD"]).split(' ').count(), 5);
}

#[test]
fn orphan_is_unrelated() {
    let r = FixtureRepo::orphan();
    assert_eq!(r.git(&["rev-list", "--count", "docs"]), "1");
    let st = git_command(r.path())
        .args(["merge-base", "main", "docs"])
        .output()
        .expect("spawn git")
        .status;
    assert!(!st.success());
}

#[test]
fn tags_kinds() {
    let r = FixtureRepo::tags();
    assert_eq!(r.git(&["cat-file", "-t", "v1.0"]), "tag");
    assert_eq!(r.git(&["cat-file", "-t", "v0.1"]), "commit");
}

#[test]
fn stash_one_entry_clean_tree() {
    let r = FixtureRepo::with_stash();
    assert_eq!(r.git(&["stash", "list"]).lines().count(), 1);
    assert_eq!(r.git(&["status", "--porcelain"]), "");
}

#[test]
fn dates_strictly_increase() {
    let r = FixtureRepo::linear(3);
    let out = r.git(&["log", "--format=%ct"]);
    let mut v: Vec<u64> = out.lines().map(|l| l.parse().expect("timestamp")).collect();
    v.reverse();
    assert!(v.windows(2).all(|w| w[0] < w[1]), "{v:?}");
}

#[test]
fn kind_parsing() {
    assert_eq!("linear".parse(), Ok(Kind::Linear(5)));
    assert_eq!("linear:7".parse(), Ok(Kind::Linear(7)));
    assert!("bogus".parse::<Kind>().is_err());
}
