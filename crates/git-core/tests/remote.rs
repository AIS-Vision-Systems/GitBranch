//! Tests for `ops::remote` against a bare `origin` over the file transport (no network).
#![allow(clippy::unwrap_used)] // tests: unwrap is fine

use git_core::GitErrorKind;
use git_core::fixtures::{FixtureRepo, commit_file_in, git_in};
use git_core::ops::remote::{
    FetchArgs, OpCtx, PullArgs, PullMode, PushArgs, add_remote, default_pull_mode, fetch,
    list_remotes, pull, push, ref_snapshot, remove_remote, rename_remote, set_remote_url,
};

fn pull_args(mode: PullMode) -> PullArgs {
    PullArgs { remote: None, branch: None, mode }
}

fn push_args(branch: Option<&str>) -> PushArgs {
    PushArgs {
        remote: "origin".into(),
        branch: branch.map(Into::into),
        remote_branch: None,
        set_upstream: false,
        tags: false,
        force_with_lease: false,
    }
}

fn fetch_args(remote: Option<&str>, prune: bool) -> FetchArgs {
    FetchArgs { remote: remote.map(Into::into), prune, tags: false, refspecs: vec![] }
}

/// Fixture plus a second clone that pushed one new commit to `origin/main`.
fn upstream_ahead(file: &str) -> (FixtureRepo, std::path::PathBuf) {
    let fx = FixtureRepo::with_remote();
    let other = fx.clone_of("other");
    commit_file_in(&other, file, "theirs\n", "theirs");
    git_in(&other, &["push", "-q", "origin", "main"]);
    (fx, other)
}

#[tokio::test]
async fn remote_config_roundtrip() {
    let fx = FixtureRepo::with_remote();
    let r = fx.runner();
    let list = list_remotes(&r, fx.path()).await.unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].name, "origin");
    assert_eq!(list[0].push_url, None);

    add_remote(&r, fx.path(), "backup", "https://example.invalid/b.git").await.unwrap();
    let names =
        |l: &[git_core::ops::remote::Remote]| l.iter().map(|x| x.name.clone()).collect::<Vec<_>>();
    let list = list_remotes(&r, fx.path()).await.unwrap();
    assert_eq!(names(&list), ["backup", "origin"]);
    assert_eq!(list[0].fetch_url, "https://example.invalid/b.git");
    assert!(add_remote(&r, fx.path(), "backup", "x").await.is_err());

    rename_remote(&r, fx.path(), "backup", "mirror").await.unwrap();
    assert_eq!(names(&list_remotes(&r, fx.path()).await.unwrap()), ["mirror", "origin"]);

    remove_remote(&r, fx.path(), "mirror").await.unwrap();
    remove_remote(&r, fx.path(), "origin").await.unwrap();
    assert_eq!(
        list_remotes(&r, fx.path()).await.unwrap(),
        [] as [git_core::ops::remote::Remote; 0]
    );
    assert!(remove_remote(&r, fx.path(), "origin").await.is_err());
}

#[tokio::test]
async fn set_remote_url_fetch_then_push() {
    let fx = FixtureRepo::with_remote();
    let r = fx.runner();
    let find =
        |l: Vec<git_core::ops::remote::Remote>| l.into_iter().find(|x| x.name == "origin").unwrap();

    set_remote_url(&r, fx.path(), "origin", "https://example.invalid/f.git", false).await.unwrap();
    let o = find(list_remotes(&r, fx.path()).await.unwrap());
    assert_eq!(o.fetch_url, "https://example.invalid/f.git");
    assert_eq!(o.push_url, None);

    set_remote_url(&r, fx.path(), "origin", "https://example.invalid/p.git", true).await.unwrap();
    let o = find(list_remotes(&r, fx.path()).await.unwrap());
    assert_eq!(o.fetch_url, "https://example.invalid/f.git");
    assert_eq!(o.push_url.as_deref(), Some("https://example.invalid/p.git"));

    assert!(
        set_remote_url(&r, fx.path(), "nope", "https://example.invalid/x.git", false)
            .await
            .is_err()
    );
}

#[tokio::test]
async fn fetch_one_and_all() {
    let (fx, other) = upstream_ahead("t1.txt");
    let r = fx.runner();
    let before = fx.rev_parse("origin/main");
    fetch(&r, fx.path(), &fetch_args(Some("origin"), false), &OpCtx::noop()).await.unwrap();
    let after = fx.rev_parse("origin/main");
    assert_ne!(before, after);
    assert_eq!(after, other_head(&other));

    commit_file_in(&other, "t2.txt", "more\n", "more");
    git_in(&other, &["push", "-q", "origin", "main"]);
    fetch(&r, fx.path(), &fetch_args(None, false), &OpCtx::noop()).await.unwrap();
    assert_eq!(fx.rev_parse("origin/main"), other_head(&other));
    assert!(fetch(&r, fx.path(), &fetch_args(Some("nope"), false), &OpCtx::noop()).await.is_err());
}

fn other_head(other: &std::path::Path) -> String {
    git_in(other, &["rev-parse", "HEAD"])
}

#[tokio::test]
async fn fetch_prune_removes_stale_tracking_branch() {
    let fx = FixtureRepo::with_remote();
    let r = fx.runner();
    let other = fx.clone_of("other");
    git_in(&other, &["push", "-q", "origin", "main:topic"]);
    fetch(&r, fx.path(), &fetch_args(Some("origin"), false), &OpCtx::noop()).await.unwrap();
    fx.rev_parse("origin/topic");

    git_in(&other, &["push", "-q", "origin", "--delete", "topic"]);
    fetch(&r, fx.path(), &fetch_args(Some("origin"), false), &OpCtx::noop()).await.unwrap();
    fx.rev_parse("origin/topic"); // still there without --prune
    fetch(&r, fx.path(), &fetch_args(Some("origin"), true), &OpCtx::noop()).await.unwrap();
    assert!(!fx.git(&["branch", "-r"]).contains("origin/topic"));
}

#[tokio::test]
async fn ref_snapshot_changes_only_when_a_fetch_moves_refs() {
    let fx = FixtureRepo::with_remote();
    let r = fx.runner();
    let other = fx.clone_of("other");
    let s0 = ref_snapshot(&r, fx.path()).await.unwrap();
    fetch(&r, fx.path(), &fetch_args(None, true), &OpCtx::noop()).await.unwrap();
    assert_eq!(ref_snapshot(&r, fx.path()).await.unwrap(), s0, "empty fetch");

    git_in(&other, &["push", "-q", "origin", "main:topic"]);
    fetch(&r, fx.path(), &fetch_args(None, true), &OpCtx::noop()).await.unwrap();
    let s1 = ref_snapshot(&r, fx.path()).await.unwrap();
    assert_ne!(s1, s0, "new remote branch");

    git_in(&other, &["push", "-q", "origin", "--delete", "topic"]);
    fetch(&r, fx.path(), &fetch_args(None, true), &OpCtx::noop()).await.unwrap();
    assert_eq!(ref_snapshot(&r, fx.path()).await.unwrap(), s0, "pruned remote branch");
}

#[tokio::test]
async fn pull_up_to_date_and_fast_forward() {
    let fx = FixtureRepo::with_remote();
    let r = fx.runner();
    let res = pull(&r, fx.path(), &pull_args(PullMode::FfOnly), &OpCtx::noop()).await.unwrap();
    assert!(!res.changed);

    let other = fx.clone_of("other");
    commit_file_in(&other, "t1.txt", "theirs\n", "theirs");
    git_in(&other, &["push", "-q", "origin", "main"]);
    let res = pull(&r, fx.path(), &pull_args(PullMode::FfOnly), &OpCtx::noop()).await.unwrap();
    assert!(res.changed);
    assert_eq!(fx.rev_parse("HEAD"), fx.rev_parse("origin/main"));
}

#[tokio::test]
async fn pull_ff_only_on_divergence_fails_without_conflict() {
    let (fx, _other) = upstream_ahead("t1.txt");
    commit_file_in(fx.path(), "mine.txt", "mine\n", "mine");
    let before = fx.rev_parse("HEAD");
    let err = pull(&fx.runner(), fx.path(), &pull_args(PullMode::FfOnly), &OpCtx::noop())
        .await
        .unwrap_err();
    assert!(matches!(err.kind, GitErrorKind::ExitCode(_)), "{err:?}");
    assert_eq!(fx.rev_parse("HEAD"), before);
}

#[tokio::test]
async fn pull_rebase_gives_linear_history() {
    let (fx, _other) = upstream_ahead("t1.txt");
    commit_file_in(fx.path(), "mine.txt", "mine\n", "mine");
    let res =
        pull(&fx.runner(), fx.path(), &pull_args(PullMode::Rebase), &OpCtx::noop()).await.unwrap();
    assert!(res.changed);
    assert_eq!(fx.git(&["rev-list", "--merges", "--count", "HEAD"]), "0");
    assert_eq!(fx.rev_parse("HEAD~1"), fx.rev_parse("origin/main"));
}

#[tokio::test]
async fn pull_merge_makes_merge_commit_and_conflicts_are_reported() {
    let (fx, _other) = upstream_ahead("t1.txt");
    commit_file_in(fx.path(), "mine.txt", "mine\n", "mine");
    let res =
        pull(&fx.runner(), fx.path(), &pull_args(PullMode::Merge), &OpCtx::noop()).await.unwrap();
    assert!(res.changed);
    assert_eq!(fx.git(&["rev-list", "--merges", "--count", "HEAD"]), "1");

    let (fx, _other) = upstream_ahead("f1.txt");
    commit_file_in(fx.path(), "f1.txt", "mine\n", "mine");
    let err = pull(&fx.runner(), fx.path(), &pull_args(PullMode::Merge), &OpCtx::noop())
        .await
        .unwrap_err();
    assert_eq!(err.kind, GitErrorKind::Conflict, "{err:?}");
}

#[tokio::test]
async fn push_new_commit_and_up_to_date() {
    let fx = FixtureRepo::with_remote();
    let r = fx.runner();
    let old = fx.rev_parse("HEAD");
    let new = commit_file_in(fx.path(), "n.txt", "n\n", "n");
    let res = push(&r, fx.path(), &push_args(Some("main")), &OpCtx::noop()).await.unwrap();
    assert_eq!(res.refs.len(), 1);
    assert_eq!(res.refs[0].flag, " ");
    assert_eq!(res.refs[0].to, "refs/heads/main");
    assert_eq!(res.refs[0].summary, format!("{}..{}", &old[..7], &new[..7]));
    assert_eq!(git_in(fx.remote_path(), &["rev-parse", "main"]), new);

    let res = push(&r, fx.path(), &push_args(Some("main")), &OpCtx::noop()).await.unwrap();
    assert_eq!(res.refs[0].flag, "=");
}

#[tokio::test]
async fn push_set_upstream_on_new_branch() {
    let fx = FixtureRepo::with_remote();
    fx.git(&["switch", "-q", "-c", "feat"]);
    commit_file_in(fx.path(), "feat.txt", "f\n", "feat");
    let mut args = push_args(Some("feat"));
    args.set_upstream = true;
    let res = push(&fx.runner(), fx.path(), &args, &OpCtx::noop()).await.unwrap();
    assert_eq!(res.refs[0].flag, "*");
    assert_eq!(fx.git(&["config", "branch.feat.remote"]), "origin");
    assert_eq!(fx.git(&["config", "branch.feat.merge"]), "refs/heads/feat");
}

#[tokio::test]
async fn push_tags() {
    let fx = FixtureRepo::with_remote();
    fx.git(&["tag", "v9"]);
    let mut args = push_args(None);
    args.tags = true;
    push(&fx.runner(), fx.path(), &args, &OpCtx::noop()).await.unwrap();
    assert!(git_in(fx.remote_path(), &["tag", "-l"]).contains("v9"));
}

#[tokio::test]
async fn push_non_fast_forward_is_rejected() {
    let (fx, _other) = upstream_ahead("t1.txt");
    commit_file_in(fx.path(), "mine.txt", "mine\n", "mine");
    let err =
        push(&fx.runner(), fx.path(), &push_args(Some("main")), &OpCtx::noop()).await.unwrap_err();
    assert_eq!(err.kind, GitErrorKind::Rejected, "{err:?}");
    assert_eq!(err.code(), "git.rejected");
    assert!(err.stderr.contains("rejected"), "{}", err.stderr);
}

#[tokio::test]
async fn push_force_with_lease() {
    let fx = FixtureRepo::with_remote();
    let r = fx.runner();
    fx.git(&["reset", "-q", "--hard", "HEAD~1"]);
    let new = commit_file_in(fx.path(), "other.txt", "x\n", "rewritten");
    // Plain push is refused, the lease push after the (already current) tracking ref succeeds.
    let err = push(&r, fx.path(), &push_args(Some("main")), &OpCtx::noop()).await.unwrap_err();
    assert_eq!(err.kind, GitErrorKind::Rejected);
    let mut args = push_args(Some("main"));
    args.force_with_lease = true;
    let res = push(&r, fx.path(), &args, &OpCtx::noop()).await.unwrap();
    assert_eq!(res.refs[0].flag, "+");
    assert_eq!(git_in(fx.remote_path(), &["rev-parse", "main"]), new);
}

#[tokio::test]
async fn push_force_with_lease_refuses_stale_lease() {
    let (fx, _other) = upstream_ahead("t1.txt");
    fx.git(&["reset", "-q", "--hard", "HEAD~1"]);
    commit_file_in(fx.path(), "mine.txt", "mine\n", "mine");
    let mut args = push_args(Some("main"));
    args.force_with_lease = true;
    let err = push(&fx.runner(), fx.path(), &args, &OpCtx::noop()).await.unwrap_err();
    assert_eq!(err.kind, GitErrorKind::Rejected, "{err:?}");
}

#[tokio::test]
async fn default_pull_mode_from_config() {
    let fx = FixtureRepo::with_remote();
    let r = fx.runner();
    assert_eq!(default_pull_mode(&r, fx.path()).await.unwrap(), PullMode::Merge);
    fx.git(&["config", "pull.ff", "only"]);
    assert_eq!(default_pull_mode(&r, fx.path()).await.unwrap(), PullMode::FfOnly);
    fx.git(&["config", "pull.rebase", "true"]);
    assert_eq!(default_pull_mode(&r, fx.path()).await.unwrap(), PullMode::Rebase);
    for v in ["merges", "interactive"] {
        fx.git(&["config", "pull.rebase", v]);
        assert_eq!(default_pull_mode(&r, fx.path()).await.unwrap(), PullMode::Rebase);
    }
    fx.git(&["config", "pull.rebase", "false"]);
    assert_eq!(default_pull_mode(&r, fx.path()).await.unwrap(), PullMode::FfOnly);
}

#[tokio::test]
async fn default_pull_mode_branch_overrides_and_empty_means_true() {
    let fx = FixtureRepo::with_remote();
    let r = fx.runner();
    // Branch-level setting wins over pull.rebase in both directions.
    fx.git(&["config", "pull.rebase", "true"]);
    fx.git(&["config", "branch.main.rebase", "false"]);
    assert_eq!(default_pull_mode(&r, fx.path()).await.unwrap(), PullMode::Merge);
    fx.git(&["config", "pull.rebase", "false"]);
    fx.git(&["config", "branch.main.rebase", "true"]);
    assert_eq!(default_pull_mode(&r, fx.path()).await.unwrap(), PullMode::Rebase);

    // Detached HEAD ignores the branch key.
    fx.git(&["checkout", "-q", "--detach"]);
    assert_eq!(default_pull_mode(&r, fx.path()).await.unwrap(), PullMode::Merge);

    // `[pull] rebase` without `=` is true.
    fx.git(&["config", "--unset", "branch.main.rebase"]);
    fx.git(&["config", "--unset", "pull.rebase"]);
    let cfg = fx.path().join(".git").join("config");
    let mut text = std::fs::read_to_string(&cfg).unwrap();
    text.push_str("[pull]\n\trebase\n");
    std::fs::write(&cfg, text).unwrap();
    assert_eq!(default_pull_mode(&r, fx.path()).await.unwrap(), PullMode::Rebase);
}

#[tokio::test]
async fn remote_name_with_slash_roundtrips() {
    let fx = FixtureRepo::with_remote();
    let r = fx.runner();
    assert!(git_core::refname::is_valid_remote_name("foo/bar"));
    assert!(!git_core::refname::is_valid_remote_name("foo//bar"));
    assert!(!git_core::refname::is_valid_remote_name("/foo"));
    add_remote(&r, fx.path(), "foo/bar", "https://example.invalid/b.git").await.unwrap();
    let list = list_remotes(&r, fx.path()).await.unwrap();
    assert!(list.iter().any(|x| x.name == "foo/bar"), "{list:?}");
    rename_remote(&r, fx.path(), "foo/bar", "baz/qux").await.unwrap();
    remove_remote(&r, fx.path(), "baz/qux").await.unwrap();
    assert_eq!(list_remotes(&r, fx.path()).await.unwrap().len(), 1);
}

#[tokio::test]
async fn rename_rejects_option_like_and_invalid_names() {
    let fx = FixtureRepo::linear(1);
    let r = fx.runner();
    add_remote(&r, fx.path(), "origin", "https://example.invalid/o.git").await.unwrap();
    let before = list_remotes(&r, fx.path()).await.unwrap();
    for (old, new) in [("origin", "-x"), ("-x", "origin"), ("origin", ""), ("origin", "a b")] {
        let err = rename_remote(&r, fx.path(), old, new).await.unwrap_err();
        assert_eq!(err.kind, GitErrorKind::ExitCode(129), "{old:?} -> {new:?}: {err:?}");
    }
    assert_eq!(
        remove_remote(&r, fx.path(), "-x").await.unwrap_err().kind,
        GitErrorKind::ExitCode(129)
    );
    assert_eq!(list_remotes(&r, fx.path()).await.unwrap(), before);
}

#[tokio::test]
async fn push_and_pull_reject_refspec_branches_without_spawning_git() {
    let (fx, _other) = upstream_ahead("t1.txt");
    let r = fx.runner();
    let remote_main = git_in(fx.remote_path(), &["rev-parse", "main"]);
    let head = fx.rev_parse("HEAD");
    for bad in ["+main", ":main", "main:other", "+main:main"] {
        let err = push(&r, fx.path(), &push_args(Some(bad)), &OpCtx::noop()).await.unwrap_err();
        assert_eq!(err.kind, GitErrorKind::ExitCode(129), "{bad}");
        assert_eq!(err.stderr, "invalid branch argument");
        assert!(err.args.is_empty(), "no git was spawned");
        let args = PullArgs {
            remote: Some("origin".into()),
            branch: Some(bad.into()),
            mode: PullMode::Merge,
        };
        let err = pull(&r, fx.path(), &args, &OpCtx::noop()).await.unwrap_err();
        assert_eq!(err.kind, GitErrorKind::ExitCode(129), "{bad}");
    }
    assert_eq!(git_in(fx.remote_path(), &["rev-parse", "main"]), remote_main);
    assert_eq!(fx.rev_parse("HEAD"), head);
    assert!(!git_in(fx.remote_path(), &["branch", "--list", "other"]).contains("other"));
}

#[tokio::test]
async fn credentials_in_remote_urls_do_not_leak_through_errors() {
    let fx = FixtureRepo::with_remote();
    let r = fx.runner();
    add_remote(&r, fx.path(), "leak", "https://u:tok@127.0.0.1:1/x").await.unwrap();
    let list = list_remotes(&r, fx.path()).await.unwrap();
    let leak = list.iter().find(|x| x.name == "leak").unwrap();
    assert!(!git_core::runner::redact_credentials(&leak.fetch_url).contains("tok"));

    let err =
        fetch(&r, fx.path(), &fetch_args(Some("leak"), false), &OpCtx::noop()).await.unwrap_err();
    assert!(!err.stderr.contains("tok"), "{}", err.stderr);
    assert!(!err.args.iter().any(|a| a.contains("tok")), "{:?}", err.args);
}

#[tokio::test]
async fn pull_with_explicit_remote_and_branch() {
    let (fx, other) = upstream_ahead("t1.txt");
    let args = PullArgs {
        remote: Some("origin".into()),
        branch: Some("main".into()),
        mode: PullMode::FfOnly,
    };
    let res = pull(&fx.runner(), fx.path(), &args, &OpCtx::noop()).await.unwrap();
    assert!(res.changed);
    assert_eq!(fx.rev_parse("HEAD"), other_head(&other));
}

#[tokio::test]
async fn pull_config_mode_follows_pull_rebase() {
    let (fx, _other) = upstream_ahead("t1.txt");
    fx.git(&["config", "pull.rebase", "true"]);
    commit_file_in(fx.path(), "mine.txt", "mine\n", "mine");
    let res =
        pull(&fx.runner(), fx.path(), &pull_args(PullMode::Config), &OpCtx::noop()).await.unwrap();
    assert!(res.changed);
    assert_eq!(fx.git(&["rev-list", "--merges", "--count", "HEAD"]), "0");
    assert_eq!(fx.rev_parse("HEAD~1"), fx.rev_parse("origin/main"));
}

#[tokio::test]
async fn pull_rebase_conflict_is_reported() {
    let (fx, _other) = upstream_ahead("f1.txt");
    commit_file_in(fx.path(), "f1.txt", "mine\n", "mine");
    let err = pull(&fx.runner(), fx.path(), &pull_args(PullMode::Rebase), &OpCtx::noop())
        .await
        .unwrap_err();
    assert_eq!(err.kind, GitErrorKind::Conflict, "{err:?}");
}

#[tokio::test]
async fn fetch_tags_brings_tag_only_present_on_remote() {
    let fx = FixtureRepo::with_remote();
    let other = fx.clone_of("other");
    commit_file_in(&other, "tagged.txt", "t\n", "tagged");
    git_in(&other, &["tag", "only-remote"]);
    git_in(&other, &["push", "-q", "origin", "only-remote"]);
    let r = fx.runner();
    fetch(&r, fx.path(), &fetch_args(Some("origin"), false), &OpCtx::noop()).await.unwrap();
    assert!(!fx.git(&["tag", "-l"]).contains("only-remote"));
    let args =
        FetchArgs { remote: Some("origin".into()), prune: false, tags: true, refspecs: vec![] };
    fetch(&r, fx.path(), &args, &OpCtx::noop()).await.unwrap();
    assert!(fx.git(&["tag", "-l"]).contains("only-remote"));
}

#[tokio::test]
async fn partly_rejected_push_still_delivers_the_tag() {
    let (fx, _other) = upstream_ahead("t1.txt");
    commit_file_in(fx.path(), "mine.txt", "mine\n", "mine");
    fx.git(&["tag", "v9"]);
    let mut args = push_args(Some("main"));
    args.tags = true;
    let err = push(&fx.runner(), fx.path(), &args, &OpCtx::noop()).await.unwrap_err();
    assert_eq!(err.kind, GitErrorKind::Rejected, "{err:?}");
    assert!(err.stderr.contains("refs/heads/main"), "{}", err.stderr);
    assert!(git_in(fx.remote_path(), &["tag", "-l"]).contains("v9"));
}

#[tokio::test]
async fn push_to_a_differently_named_remote_branch() {
    let repo = FixtureRepo::with_remote();
    let runner = repo.runner();
    repo.git(&["switch", "-c", "feat"]);
    repo.commit_file("feat.txt", "x", "feat work");
    let args = PushArgs { remote_branch: Some("feature-x".into()), ..push_args(Some("feat")) };
    let res = push(&runner, repo.path(), &args, &OpCtx::noop()).await.expect("push");
    assert_eq!(res.refs.len(), 1);
    assert_eq!(res.refs[0].to, "refs/heads/feature-x");
    let tip = repo.rev_parse("feat");
    assert_eq!(repo.rev_parse("origin/feature-x"), tip);
    let bad = PushArgs { remote_branch: Some("x:y".into()), ..push_args(Some("feat")) };
    let err = push(&runner, repo.path(), &bad, &OpCtx::noop()).await.expect_err("refspec rejected");
    assert_eq!(err.kind, GitErrorKind::ExitCode(129));
}

#[tokio::test]
async fn fetch_reports_progress_through_the_ctx() {
    // Over a local path git may skip the object transfer progress; a `file://` URL forces the
    // pack protocol, so the receiving side prints `Receiving objects`.
    let fx = FixtureRepo::with_remote();
    let other = fx.clone_of("other");
    for i in 0..5 {
        commit_file_in(&other, &format!("p{i}.txt"), "x\n", "p");
    }
    git_in(&other, &["push", "-q", "origin", "main"]);
    let url = format!(
        "file://{}",
        fx.remote_path().to_string_lossy().replace(std::path::MAIN_SEPARATOR, "/")
    );
    git_in(fx.path(), &["remote", "set-url", "origin", &url]);

    let seen = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
    let sink = seen.clone();
    let ctx = OpCtx {
        cancel: tokio_util::sync::CancellationToken::new(),
        progress: std::sync::Arc::new(move |p| sink.lock().unwrap().push(p)),
    };
    fetch(&fx.runner(), fx.path(), &fetch_args(Some("origin"), false), &ctx).await.unwrap();
    let seen = seen.lock().unwrap();
    assert!(!seen.is_empty(), "no progress reported");
    assert!(seen.iter().any(|p| p.phase == "Counting objects" && p.pct.is_some()));
}
