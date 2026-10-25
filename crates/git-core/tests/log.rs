#![allow(missing_docs, clippy::unwrap_used)]

use git_core::fixtures::FixtureRepo;
use git_core::parse::log::{LogFilter, LogPage, LogQuery, log_page, parse_log};

fn q(limit: usize, skip: usize, all: bool) -> LogQuery {
    LogQuery { limit, skip, all, ..LogQuery::default() }
}

#[test]
fn parse_hand_written() {
    let a = "a".repeat(40);
    let b = "b".repeat(40);
    let c = "c".repeat(40);
    let raw = format!(
        "{a}\x1f{b} {c}\x1fAnn\x1fann@x.io\x1f100\x1f200\x1fMerge it\0{b}\x1f\x1fBob\x1fb@x.io\x1f1\x1f2\x1froot\0"
    );
    let v = parse_log(raw.as_bytes()).unwrap();
    assert_eq!(v.len(), 2);
    assert_eq!(v[0].oid, a);
    assert_eq!(v[0].parents, vec![b, c]);
    assert_eq!(v[0].author_name, "Ann");
    assert_eq!(v[0].author_email, "ann@x.io");
    assert_eq!((v[0].author_time, v[0].committer_time), (100, 200));
    assert_eq!(v[0].subject, "Merge it");
    assert_eq!(v[1].parents, [] as [String; 0]);
    assert_eq!(v[1].subject, "root");
    assert!(parse_log(b"abc\x1fdef\0").is_err());
}

async fn page(r: &FixtureRepo, query: &LogQuery) -> LogPage {
    log_page(&r.runner(), r.path(), query).await.unwrap()
}

#[tokio::test]
async fn linear_matches_rev_list() {
    let r = FixtureRepo::linear(5);
    let p = page(&r, &LogQuery::default()).await;
    assert!(!p.has_more);
    let rl = r.git(&["rev-list", "--parents", "HEAD"]);
    let expect: Vec<Vec<&str>> = rl.lines().map(|l| l.split(' ').collect()).collect();
    assert_eq!(p.commits.len(), 5);
    for (c, e) in p.commits.iter().zip(&expect) {
        assert_eq!(c.oid, e[0]);
        assert_eq!(c.parents, e[1..]);
    }
}

#[tokio::test]
async fn pagination() {
    let r = FixtureRepo::linear(7);
    let p0 = page(&r, &q(3, 0, true)).await;
    let p1 = page(&r, &q(3, 3, true)).await;
    let p2 = page(&r, &q(3, 6, true)).await;
    assert_eq!((p0.commits.len(), p0.has_more), (3, true));
    assert_eq!((p1.commits.len(), p1.has_more), (3, true));
    assert_eq!((p2.commits.len(), p2.has_more), (1, false));
    let all: Vec<String> =
        [p0, p1, p2].into_iter().flat_map(|p| p.commits).map(|c| c.oid).collect();
    let rl = r.git(&["rev-list", "HEAD"]);
    assert_eq!(all, rl.lines().collect::<Vec<_>>());
}

#[tokio::test]
async fn merge_and_octopus_parents() {
    let r = FixtureRepo::merge();
    let p = page(&r, &LogQuery::default()).await;
    let rl = r.git(&["rev-list", "--parents", "-1", "HEAD"]);
    let expect: Vec<&str> = rl.split_whitespace().collect();
    assert_eq!(p.commits[0].oid, expect[0]);
    assert_eq!(p.commits[0].parents.len(), 2);
    assert_eq!(p.commits[0].parents, expect[1..]);
    let r = FixtureRepo::octopus();
    let p = page(&r, &LogQuery::default()).await;
    assert_eq!(p.commits[0].parents.len(), 4);
}

#[tokio::test]
async fn orphan_all_vs_head() {
    let r = FixtureRepo::orphan();
    let all = page(&r, &q(100, 0, true)).await;
    assert_eq!(all.commits.iter().filter(|c| c.parents.is_empty()).count(), 2);
    let head = page(&r, &q(100, 0, false)).await;
    assert!(head.commits.len() < all.commits.len());
    let rl = r.git(&["rev-list", "HEAD"]);
    assert_eq!(head.commits.len(), rl.lines().count());
}

#[tokio::test]
async fn empty_repo() {
    let r = FixtureRepo::empty();
    for all in [true, false] {
        let p = page(&r, &q(10, 0, all)).await;
        assert!(p.commits.is_empty() && !p.has_more);
    }
}

#[tokio::test]
async fn utf8_subject() {
    let r = FixtureRepo::linear(1);
    r.commit_file("f", "x", "Año ✓");
    let p = page(&r, &LogQuery::default()).await;
    assert_eq!(p.commits[0].subject, "Año ✓");
}

#[tokio::test]
async fn all_excludes_stash_commits() {
    let r = FixtureRepo::with_stash();
    let stash = r.rev_parse("refs/stash");
    let p = page(&r, &q(100, 0, true)).await;
    assert!(!p.commits.iter().any(|c| c.oid == stash), "stash commit listed in --all");
    assert_ne!(p.commits, [] as [git_core::parse::log::Commit; 0]);
}

fn filtered(f: LogFilter) -> LogQuery {
    LogQuery { filter: f, ..LogQuery::default() }
}

fn subjects(p: &LogPage) -> Vec<&str> {
    p.commits.iter().map(|c| c.subject.as_str()).collect()
}

#[tokio::test]
async fn filters_author_message_path() {
    let r = FixtureRepo::empty();
    r.commit_file("a.txt", "1", "first Thing");
    std::fs::write(r.path().join("dir.txt"), "x").unwrap();
    r.git(&["add", "dir.txt"]);
    r.git(&["commit", "-m", "uses a.b regex", "--author=Zed Other <zed@x.io>"]);
    r.commit_file("c.txt", "3", "axb third");

    let all = page(&r, &LogQuery::default()).await;
    assert_eq!(all.commits.len(), 3);

    let by_author =
        page(&r, &filtered(LogFilter { author: Some("zed".into()), ..Default::default() })).await;
    assert_eq!(subjects(&by_author), vec!["uses a.b regex"]);

    // Case-insensitive and literal: `a.b` must not match "axb".
    let by_msg =
        page(&r, &filtered(LogFilter { message: Some("A.B".into()), ..Default::default() })).await;
    assert_eq!(subjects(&by_msg), vec!["uses a.b regex"]);
    let by_msg2 = page(
        &r,
        &filtered(LogFilter { message: Some("FIRST thing".into()), ..Default::default() }),
    )
    .await;
    assert_eq!(subjects(&by_msg2), vec!["first Thing"]);

    let by_path =
        page(&r, &filtered(LogFilter { path: Some("c.txt".into()), ..Default::default() })).await;
    assert_eq!(subjects(&by_path), vec!["axb third"]);

    let combined = page(
        &r,
        &filtered(LogFilter {
            author: Some("zed".into()),
            message: Some("regex".into()),
            path: Some("dir.txt".into()),
        }),
    )
    .await;
    assert_eq!(subjects(&combined), vec!["uses a.b regex"]);
    let none = page(
        &r,
        &filtered(LogFilter {
            author: Some("zed".into()),
            path: Some("c.txt".into()),
            ..Default::default()
        }),
    )
    .await;
    assert_eq!(none.commits, [] as [git_core::parse::log::Commit; 0]);

    // Pathspec magic characters are literal.
    let star =
        page(&r, &filtered(LogFilter { path: Some("*.txt".into()), ..Default::default() })).await;
    assert_eq!(star.commits, [] as [git_core::parse::log::Commit; 0]);

    // Values are trimmed before use.
    let trimmed =
        page(&r, &filtered(LogFilter { author: Some("  zed ".into()), ..Default::default() }))
            .await;
    assert_eq!(subjects(&trimmed), vec!["uses a.b regex"]);

    // Blank filters are ignored.
    let blank = page(
        &r,
        &filtered(LogFilter {
            author: Some("  ".into()),
            message: Some(String::new()),
            path: Some(" ".into()),
        }),
    )
    .await;
    assert_eq!(blank.commits.len(), 3);
}
