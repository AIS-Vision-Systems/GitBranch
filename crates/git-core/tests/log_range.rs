//! `ops::log_range::commits_between` on a fixture repo.
#![allow(clippy::unwrap_used)] // tests: unwrap is fine

use git_core::fixtures::FixtureRepo;
use git_core::ops::log_range::commits_between;

#[tokio::test]
async fn range_lists_new_commits() {
    let r = FixtureRepo::linear(5);
    let base = r.git(&["branch", "--show-current"]);
    r.git(&["switch", "-c", "feature"]);
    r.commit_file("a.txt", "a\n", "add a\n\nlonger body\nsecond line");
    r.commit_file("b.txt", "b\n", "add b");
    let run = r.runner();
    let v = commits_between(&run, r.path(), &base, "feature", 50).await.unwrap();
    assert_eq!(v.len(), 2);
    assert_eq!(v[0].oid, r.rev_parse("feature"));
    assert_eq!(v[0].subject, "add b");
    assert_eq!(v[0].body, "");
    assert_eq!(v[1].subject, "add a");
    assert_eq!(v[1].body, "longer body\nsecond line");
    let one = commits_between(&run, r.path(), &base, "feature", 1).await.unwrap();
    assert_eq!(one.len(), 1);
    assert_eq!(one[0].subject, "add b");
    assert_eq!(
        commits_between(&run, r.path(), "feature", "feature", 5).await.unwrap(),
        [] as [git_core::ops::log_range::RangeCommit; 0]
    );
    assert!(commits_between(&run, r.path(), "--all", "feature", 5).await.is_err());
    assert!(commits_between(&run, r.path(), &base, "", 5).await.is_err());
    assert!(commits_between(&run, r.path(), &base, "-x", 5).await.is_err());
    assert!(commits_between(&run, r.path(), &base, "no-such-rev", 5).await.is_err());
}
