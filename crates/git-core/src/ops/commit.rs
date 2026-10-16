//! Create and amend commits, and read the message template (Phase 2).

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::repo::RepoInfo;
use crate::{GitError, GitErrorKind, GitRunner, RunOpts};

/// Options for [`commit`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitArgs {
    /// Full commit message, used verbatim apart from whitespace cleanup (`#` lines are kept).
    pub message: String,
    /// Replace HEAD instead of adding a commit.
    pub amend: bool,
    /// Add a `Signed-off-by` trailer.
    pub signoff: bool,
    /// Allow a commit with no changes.
    pub allow_empty: bool,
    /// Skip pre-commit and commit-msg hooks.
    pub no_verify: bool,
}

/// Creates (or amends) a commit from the index and returns the new HEAD oid.
///
/// # Errors
/// [`GitError`] if git fails (nothing staged, hook rejected, ...).
pub async fn commit(
    runner: &GitRunner,
    repo: &Path,
    args: &CommitArgs,
) -> Result<String, GitError> {
    let mut argv = vec!["commit", "-q", "--cleanup=whitespace", "-F", "-"];
    for (on, flag) in [
        (args.amend, "--amend"),
        (args.signoff, "--signoff"),
        (args.allow_empty, "--allow-empty"),
        (args.no_verify, "--no-verify"),
    ] {
        if on {
            argv.push(flag);
        }
    }
    runner.run(repo, &argv, RunOpts::with_stdin(args.message.clone().into_bytes())).await?;
    let out = runner.run(repo, &["rev-parse", "HEAD"], RunOpts::default()).await?;
    Ok(out.stdout_str())
}

/// Where a [`CommitTemplate`] came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TemplateSource {
    /// `MERGE_MSG` in the git dir.
    MergeMsg,
    /// `SQUASH_MSG` in the git dir.
    SquashMsg,
    /// The file named by `commit.template`.
    ConfigTemplate,
}

/// A prefilled commit message.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitTemplate {
    /// Message text.
    pub message: String,
    /// Its origin.
    pub source: TemplateSource,
}

/// Prefilled message: `MERGE_MSG`, then `SQUASH_MSG`, then `commit.template`.
///
/// # Errors
/// [`GitError`] if reading the config fails for a reason other than "unset".
pub async fn commit_template(
    runner: &GitRunner,
    repo: &RepoInfo,
) -> Result<Option<CommitTemplate>, GitError> {
    for (name, source) in
        [("MERGE_MSG", TemplateSource::MergeMsg), ("SQUASH_MSG", TemplateSource::SquashMsg)]
    {
        if let Ok(message) = std::fs::read_to_string(repo.git_dir.join(name)) {
            return Ok(Some(CommitTemplate { message: strip_comments(&message), source }));
        }
    }
    let args = ["config", "--get", "commit.template"];
    let out = match runner.run(&repo.work_tree, &args, RunOpts::default()).await {
        Ok(o) => o,
        Err(e) if e.kind == GitErrorKind::ExitCode(1) => return Ok(None),
        Err(e) => return Err(e),
    };
    let configured = out.stdout_str();
    if configured.is_empty() {
        return Ok(None);
    }
    let path = if let Some(rest) = configured.strip_prefix("~/") {
        let home = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE"));
        match home {
            Some(h) => PathBuf::from(h).join(rest),
            None => return Ok(None),
        }
    } else {
        let p = PathBuf::from(&configured);
        if p.is_absolute() { p } else { repo.work_tree.join(p) }
    };
    Ok(std::fs::read_to_string(path).ok().map(|message| CommitTemplate {
        message: strip_comments(&message),
        source: TemplateSource::ConfigTemplate,
    }))
}

/// Drops comment lines (`#` at column 0) and trailing blank lines from template text, because
/// the commit itself is made with `--cleanup=whitespace`.
fn strip_comments(text: &str) -> String {
    let kept: Vec<&str> = text.lines().filter(|l| !l.starts_with('#')).collect();
    kept.join("\n").trim_end().to_string()
}

/// Full message of HEAD (trailing newlines trimmed); empty when there are no commits.
///
/// # Errors
/// [`GitError`] if git fails for a reason other than an unborn HEAD.
pub async fn head_message(runner: &GitRunner, repo: &Path) -> Result<String, GitError> {
    let verify = ["rev-parse", "--verify", "-q", "HEAD"];
    if runner.run(repo, &verify, RunOpts::default()).await.is_err() {
        return Ok(String::new());
    }
    let out = runner
        .run(repo, &["log", "-1", "--no-show-signature", "--format=%B"], RunOpts::default())
        .await?;
    Ok(String::from_utf8_lossy(&out.stdout).trim_end_matches(['\n', '\r']).to_string())
}
