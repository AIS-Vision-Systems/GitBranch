//! Integration tests for `parse::refs` on real fixture repositories.
#![allow(clippy::unwrap_used)] // tests may unwrap

use git_core::fixtures::FixtureRepo;
use git_core::parse::refs::{RefKind, list_refs, parse_for_each_ref};

#[test]
fn parses_sample() {
    let sample = "refs/heads/main\0aaa\0\0commit\0origin/main\0[ahead 2, behind 1]\0*\0\x1e\n\
refs/remotes/origin/main\0bbb\0\0commit\0\0\0 \0\x1e\n\
refs/remotes/origin/HEAD\0bbb\0\0commit\0\0\0 \0refs/remotes/origin/main\x1e\n\
refs/tags/light\0ccc\0\0commit\0\0\0 \0\x1e\n\
refs/tags/ann\0ddd\0eee\0tag\0\0\0 \0\x1e\n";
    let refs = parse_for_each_ref(sample.as_bytes()).unwrap();
    assert_eq!(refs.len(), 4);
    let m = &refs[0];
    assert_eq!((m.name.as_str(), m.full_name.as_str()), ("main", "refs/heads/main"));
    assert_eq!(m.kind, RefKind::LocalBranch);
    assert_eq!(m.target, "aaa");
    assert!(m.is_head);
    let u = m.upstream.as_ref().unwrap();
    assert_eq!((u.name.as_str(), u.ahead, u.behind, u.gone), ("origin/main", 2, 1, false));
    assert_eq!(refs[1].name, "origin/main");
    assert_eq!(refs[1].kind, RefKind::RemoteBranch { remote: "origin".into() });
    assert!(!refs[1].is_head && refs[1].upstream.is_none());
    assert_eq!(refs[2].kind, RefKind::Tag { annotated: false });
    assert_eq!(refs[2].target, "ccc");
    assert_eq!(refs[3].kind, RefKind::Tag { annotated: true });
    assert_eq!(refs[3].target, "eee");
    assert!(parse_for_each_ref(b"junk\0x\x1e").is_err());
}

#[tokio::test]
async fn linear_has_one_head_branch() {
    let repo = FixtureRepo::linear(3);
    let r = list_refs(&repo.runner(), repo.path()).await.unwrap();
    assert_eq!(r.refs.len(), 1);
    let b = &r.refs[0];
    assert_eq!(b.name, "main");
    assert!(b.is_head);
    assert_eq!(b.target, repo.rev_parse("HEAD"));
    assert_eq!(r.head.branch.as_deref(), Some("main"));
    assert_eq!(r.head.oid.as_deref(), Some(b.target.as_str()));
    assert!(!r.head.detached);
}

#[tokio::test]
async fn tags_lightweight_and_annotated() {
    let repo = FixtureRepo::tags();
    let r = list_refs(&repo.runner(), repo.path()).await.unwrap();
    let tags: Vec<_> = r.refs.iter().filter(|x| matches!(x.kind, RefKind::Tag { .. })).collect();
    assert_eq!(tags.len(), 2);
    for t in tags {
        let RefKind::Tag { annotated } = t.kind else { unreachable!() };
        assert_eq!(t.target, repo.rev_parse(&format!("{}^{{commit}}", t.full_name)));
        if annotated {
            assert_ne!(repo.rev_parse(&t.full_name), t.target, "annotated tag object differs");
        } else {
            assert_eq!(repo.rev_parse(&t.full_name), t.target);
        }
    }
    assert!(r.refs.iter().any(|x| x.kind == RefKind::Tag { annotated: true }));
    assert!(r.refs.iter().any(|x| x.kind == RefKind::Tag { annotated: false }));
}

#[tokio::test]
async fn detached_head() {
    let repo = FixtureRepo::merge();
    repo.git(&["checkout", "--detach", "HEAD~1"]);
    let r = list_refs(&repo.runner(), repo.path()).await.unwrap();
    assert!(r.head.detached);
    assert_eq!(r.head.branch, None);
    assert_eq!(r.head.oid, Some(repo.rev_parse("HEAD")));
    assert!(r.refs.iter().all(|x| !x.is_head));
}

#[tokio::test]
async fn upstream_ahead_and_gone() {
    let repo = FixtureRepo::merge();
    let path = repo.path().to_str().unwrap().to_string();
    repo.git(&["remote", "add", "origin", &path]);
    repo.git(&["fetch", "origin"]);
    repo.git(&["branch", "--set-upstream-to=origin/main", "main"]);
    repo.commit_file("extra.txt", "x", "extra");
    let runner = repo.runner();
    let r = list_refs(&runner, repo.path()).await.unwrap();
    let main = r.refs.iter().find(|x| x.full_name == "refs/heads/main").unwrap();
    let u = main.upstream.as_ref().unwrap();
    assert_eq!((u.name.as_str(), u.ahead, u.behind, u.gone), ("origin/main", 1, 0, false));
    let remote = r.refs.iter().find(|x| x.name == "origin/main").unwrap();
    assert_eq!(remote.kind, RefKind::RemoteBranch { remote: "origin".into() });
    assert!(r.refs.iter().all(|x| x.name != "origin/HEAD"));

    repo.git(&["update-ref", "-d", "refs/remotes/origin/main"]);
    let r = list_refs(&runner, repo.path()).await.unwrap();
    let main = r.refs.iter().find(|x| x.full_name == "refs/heads/main").unwrap();
    assert!(main.upstream.as_ref().unwrap().gone);
}

#[tokio::test]
async fn empty_repo_is_unborn() {
    let repo = FixtureRepo::empty();
    let r = list_refs(&repo.runner(), repo.path()).await.unwrap();
    assert!(r.refs.is_empty());
    assert_eq!(r.head.oid, None);
    assert!(!r.head.detached);
    assert!(r.head.branch.is_some());
}
