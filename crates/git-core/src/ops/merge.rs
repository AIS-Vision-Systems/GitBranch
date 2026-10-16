//! Merge, and abort/continue/skip of any in-progress sequencer operation.

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::{GitError, GitErrorKind, GitRunner, RunOpts};

/// How `git merge` should treat fast-forwards.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MergeMode {
    /// git's default (fast-forward when possible, else a merge commit).
    Default,
    /// `--ff-only`: fail unless a fast-forward is possible.
    FastForwardOnly,
    /// `--no-ff`: always create a merge commit.
    NoFastForward,
    /// `--squash`: stage the result without committing.
    Squash,
}

/// Arguments of [`merge`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeArgs {
    /// Branch, tag or commit to merge into HEAD.
    pub source: String,
    /// Fast-forward policy.
    pub mode: MergeMode,
    /// Merge commit message (`-m`).
    pub message: Option<String>,
}

/// What a successful [`merge`] did.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MergeOutcome {
    /// Nothing to merge.
    AlreadyUpToDate,
    /// HEAD moved to the source tip without a new commit.
    FastForward,
    /// A merge commit was created.
    Merged,
    /// The result is staged, HEAD is unchanged.
    Squashed,
}

/// The sequencer operation `abort`/`continue_op`/`skip` act on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum OpKind {
    /// `git merge`.
    Merge,
    /// `git rebase`.
    Rebase,
    /// `git cherry-pick`.
    CherryPick,
    /// `git revert`.
    Revert,
}

impl OpKind {
    fn command(self) -> &'static str {
        match self {
            OpKind::Merge => "merge",
            OpKind::Rebase => "rebase",
            OpKind::CherryPick => "cherry-pick",
            OpKind::Revert => "revert",
        }
    }
}

async fn head_oid(runner: &GitRunner, repo: &Path) -> Option<String> {
    let out = runner.run(repo, &["rev-parse", "-q", "--verify", "HEAD"], RunOpts::default()).await;
    out.ok().map(|o| o.stdout_str())
}

/// Merges `args.source` into HEAD.
///
/// # Errors
/// [`GitError`]; stopping on conflicts is [`GitErrorKind::Conflict`] (the merge stays in progress).
pub async fn merge(
    runner: &GitRunner,
    repo: &Path,
    args: &MergeArgs,
) -> Result<MergeOutcome, GitError> {
    let before = head_oid(runner, repo).await;
    let mut argv: Vec<&str> = vec!["merge", "-q"];
    match args.mode {
        MergeMode::Default => {}
        MergeMode::FastForwardOnly => argv.push("--ff-only"),
        MergeMode::NoFastForward => argv.push("--no-ff"),
        MergeMode::Squash => argv.push("--squash"),
    }
    if let Some(m) = &args.message {
        argv.push("-m");
        argv.push(m);
    }
    argv.push(&args.source);
    runner.run(repo, &argv, RunOpts::default()).await?;

    if args.mode == MergeMode::Squash {
        return Ok(MergeOutcome::Squashed);
    }
    let after = head_oid(runner, repo).await;
    if before == after {
        return Ok(MergeOutcome::AlreadyUpToDate);
    }
    let spec = format!("{}^{{commit}}", args.source);
    let source = runner
        .run(repo, &["rev-parse", "--verify", &spec], RunOpts::default())
        .await
        .map(|o| o.stdout_str())?;
    if Some(source) == after { Ok(MergeOutcome::FastForward) } else { Ok(MergeOutcome::Merged) }
}

/// `git <op> --abort`.
///
/// # Errors
/// [`GitError`] when nothing is in progress or git fails.
pub async fn abort(runner: &GitRunner, repo: &Path, kind: OpKind) -> Result<(), GitError> {
    runner.run(repo, &[kind.command(), "--abort"], RunOpts::default()).await.map(|_| ())
}

/// `git <op> --continue` (no editor opens: the runner sets `GIT_EDITOR=:`).
///
/// # Errors
/// [`GitError`]; a further conflict is [`GitErrorKind::Conflict`].
pub async fn continue_op(runner: &GitRunner, repo: &Path, kind: OpKind) -> Result<(), GitError> {
    runner.run(repo, &[kind.command(), "--continue"], RunOpts::default()).await.map(|_| ())
}

/// `git <op> --skip` for rebase, cherry-pick and revert; a merge has nothing to skip.
///
/// # Errors
/// [`GitError`]; always `ExitCode(2)` for [`OpKind::Merge`].
pub async fn skip(runner: &GitRunner, repo: &Path, kind: OpKind) -> Result<(), GitError> {
    if kind == OpKind::Merge {
        return Err(GitError {
            kind: GitErrorKind::ExitCode(2),
            stderr: "merge has nothing to skip".into(),
            args: vec!["merge".into(), "--skip".into()],
        });
    }
    runner.run(repo, &[kind.command(), "--skip"], RunOpts::default()).await.map(|_| ())
}
