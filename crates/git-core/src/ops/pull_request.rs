//! Checkout of a GitHub pull request as a local branch (D-028).

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::ops::branch::checkout;
use crate::ops::remote::{FetchArgs, OpCtx, fetch};
use crate::refname::{is_valid_branch_name, is_valid_remote_name};
use crate::{GitError, GitErrorKind, GitRunner, RunOpts};

/// Which pull request to check out and where it lives.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckoutPr {
    /// Remote of the base repository (usually `origin`).
    pub remote: String,
    /// PR number.
    pub number: u64,
    /// Head branch name.
    pub head_ref: String,
    /// The head branch lives in the base repository (not a fork).
    pub same_repo: bool,
}

fn invalid(what: &str) -> GitError {
    GitError {
        kind: GitErrorKind::ExitCode(129),
        stderr: format!("invalid {what}"),
        args: Vec::new(),
    }
}

async fn local_branch_exists(
    runner: &GitRunner,
    repo: &Path,
    name: &str,
) -> Result<bool, GitError> {
    let full = format!("refs/heads/{name}");
    match runner.run(repo, &["rev-parse", "--verify", "--quiet", &full], RunOpts::default()).await {
        Ok(_) => Ok(true),
        Err(e) if e.kind == GitErrorKind::ExitCode(1) => Ok(false),
        Err(e) => Err(e),
    }
}

/// Fetches the PR head and checks out a local branch for it; returns the branch name.
///
/// Same-repository PR: fetches `+refs/heads/<head>:refs/remotes/<remote>/<head>`, then switches to
/// local `<head>` if it exists (not reset), else creates it tracking `<remote>/<head>`. Fork PR:
/// fetches `+refs/pull/<n>/head:refs/pull/<remote>/<n>`, then local `pr/<n>` is created at
/// it (no upstream) or, if present, fast-forwarded after checking it can be (fails before
/// switching if the PR head was rewritten). The fork ref lives in `refs/pull/<remote>/<n>`, outside
/// the remotes namespace, so `fetch --prune` cannot delete it.
///
/// # Errors
/// [`GitError`] on invalid names, network failures, a missing ref, local changes that block the
/// switch, or a non-fast-forwardable existing `pr/<n>`.
pub async fn checkout_pr(
    runner: &GitRunner,
    repo: &Path,
    args: &CheckoutPr,
    ctx: &OpCtx,
) -> Result<String, GitError> {
    if !is_valid_remote_name(&args.remote) {
        return Err(invalid("remote name"));
    }
    if !is_valid_branch_name(&args.head_ref) {
        return Err(invalid("branch name"));
    }
    let remote = &args.remote;
    let (branch, tracking, refspec) = if args.same_repo {
        let head = &args.head_ref;
        (
            head.clone(),
            format!("refs/remotes/{remote}/{head}"),
            format!("+refs/heads/{head}:refs/remotes/{remote}/{head}"),
        )
    } else {
        let n = args.number;
        (
            format!("pr/{n}"),
            format!("refs/pull/{remote}/{n}"),
            format!("+refs/pull/{n}/head:refs/pull/{remote}/{n}"),
        )
    };
    let fetch_args = FetchArgs {
        remote: Some(remote.clone()),
        prune: false,
        tags: false,
        refspecs: vec![refspec],
    };
    fetch(runner, repo, &fetch_args, ctx).await?;

    let exists = local_branch_exists(runner, repo, &branch).await?;
    if exists && !args.same_repo {
        // Refuse before touching HEAD when the PR head was rewritten.
        let argv = ["merge-base", "--is-ancestor", &branch, &tracking];
        match runner.run(repo, &argv, RunOpts::default()).await {
            Ok(_) => {}
            Err(e) if e.kind == GitErrorKind::ExitCode(1) => {
                return Err(GitError {
                    kind: GitErrorKind::ExitCode(1),
                    stderr: format!(
                        "pull request head was rewritten; delete branch {branch} to re-checkout"
                    ),
                    args: Vec::new(),
                });
            }
            Err(e) => return Err(e),
        }
    }
    if exists {
        checkout(runner, repo, &branch, false).await?;
        if !args.same_repo {
            let argv = ["merge", "--ff-only", "--no-edit", &tracking];
            runner.run(repo, &argv, RunOpts::default()).await?;
        }
    } else {
        let track = if args.same_repo { "--track" } else { "--no-track" };
        let argv = ["switch", track, "-c", &branch, &tracking];
        runner.run(repo, &argv, RunOpts::default()).await?;
    }
    Ok(branch)
}
