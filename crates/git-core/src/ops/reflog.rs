//! Reflog-based undo of the last HEAD movement.

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::parse::ParseError;
use crate::parse::reflog::{ReflogError, head_reflog, ref_reflog};
use crate::{GitRunner, RunOpts};

/// What undoing the last HEAD movement does.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum UndoAction {
    /// `git reset --keep <target>` (merge, rebase, reset, cherry-pick, revert).
    ResetKeep {
        /// Commit to move the current branch back to.
        target: String,
    },
    /// `git reset --soft <target>`: undoing a commit keeps its changes staged.
    ResetSoft {
        /// Commit to move the current branch back to.
        target: String,
    },
    /// `git switch [--detach] <target>`.
    Checkout {
        /// Branch (or commit when `detach`) to return to.
        target: String,
        /// Whether `target` is a commit that must be checked out detached.
        detach: bool,
    },
}

/// A preview of the undo, for the UI label.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UndoInfo {
    /// The reflog subject of the movement that would be undone.
    pub label: String,
    /// How it would be undone.
    pub action: UndoAction,
}

const CHECKOUT_PREFIX: &str = "checkout: moving from ";
const REBASE_FINISH: &str = "rebase (finish)";

fn is_full_oid(s: &str) -> bool {
    (s.len() == 40 || s.len() == 64) && s.bytes().all(|b| b.is_ascii_hexdigit())
}

/// What [`undo_last`] would do, or `None` when there is nothing to undo.
///
/// A detached HEAD can only be undone when the last movement was a checkout.
pub async fn undo_preview(
    runner: &GitRunner,
    repo: &Path,
) -> Result<Option<UndoInfo>, ReflogError> {
    let entries = head_reflog(runner, repo, 2).await?;
    let [last, _] = &entries[..] else {
        return Ok(None);
    };
    let label = last.subject.clone();
    if let Some(rest) = last.subject.strip_prefix(CHECKOUT_PREFIX) {
        // "<from> to <to>"; ref names cannot contain spaces, so the first " to " splits.
        let Some((from, _)) = rest.split_once(" to ") else {
            return Ok(None);
        };
        let detach = is_full_oid(from);
        return Ok(Some(UndoInfo {
            label,
            action: UndoAction::Checkout { target: from.to_string(), detach },
        }));
    }
    let sym = ["symbolic-ref", "--short", "-q", "HEAD"];
    let Ok(branch) = runner.run(repo, &sym, RunOpts::default()).await else {
        return Ok(None);
    };
    // HEAD@{1} after a rebase is the last replayed commit, so the target comes from the branch's
    // own reflog: entry {1} is the tip before the movement that just happened.
    let refname = format!("refs/heads/{}", branch.stdout_str());
    let branch_log = ref_reflog(runner, repo, &refname, 2).await?;
    let [latest, before] = &branch_log[..] else {
        return Ok(None);
    };
    // The branch entry must describe the same movement as HEAD@{0}; otherwise HEAD moved
    // without the branch (e.g. `git stash` writes "reset: moving to HEAD") and there is
    // nothing to undo on the branch. git writes the same subject to both reflogs, except
    // for a finished rebase ("returning to refs/heads/x" vs "refs/heads/x onto <oid>").
    let same_subject = latest.subject == last.subject
        || (latest.subject.starts_with(REBASE_FINISH) && last.subject.starts_with(REBASE_FINISH));
    if latest.oid != last.oid || !same_subject {
        return Ok(None);
    }
    let head = runner.run(repo, &["rev-parse", "HEAD"], RunOpts::default()).await?;
    if before.oid == head.stdout_str() {
        return Ok(None);
    }
    let target = before.oid.clone();
    let action = if is_plain_commit(&last.subject) {
        UndoAction::ResetSoft { target }
    } else {
        UndoAction::ResetKeep { target }
    };
    Ok(Some(UndoInfo { label, action }))
}

/// `commit:`, `commit (amend):` and `commit (initial):` entries; `commit (merge):` is a merge.
fn is_plain_commit(subject: &str) -> bool {
    ["commit:", "commit (amend):", "commit (initial):"].iter().any(|p| subject.starts_with(p))
}

/// The result of [`undo_last`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UndoOutcome {
    /// What was undone.
    pub info: UndoInfo,
    /// The action that redoes it.
    pub redo: UndoAction,
    /// Oid of HEAD after the undo; a redo is only valid while HEAD is still here.
    pub head: String,
    /// Branch HEAD is on after the undo (`None` when detached); a redo is also void once this changes,
    /// because another branch may point at the same `head`.
    pub branch: Option<String>,
}

/// Rejects targets that git could read as an option or that are not what the action kind expects.
fn check_target(action: &UndoAction) -> Result<(), ReflogError> {
    let bad = |why: &str| ReflogError::Parse(ParseError(format!("invalid redo target: {why}")));
    match action {
        UndoAction::ResetKeep { target }
        | UndoAction::ResetSoft { target }
        | UndoAction::Checkout { target, detach: true } => {
            if !is_full_oid(target) {
                return Err(bad("expected a full commit id"));
            }
        }
        UndoAction::Checkout { target, detach: false } => {
            if target.is_empty() || target.starts_with('-') || target.contains(char::is_whitespace)
            {
                return Err(bad("expected a branch name"));
            }
        }
    }
    Ok(())
}

/// Performs an [`UndoAction`]. The action may come from the UI (redo), so targets are validated first.
///
/// # Errors
/// [`ReflogError::Parse`] for a target that is not a full oid / plain branch name;
/// [`ReflogError::Git`] when git refuses (for example `reset --keep` with conflicting local changes).
pub async fn apply_action(
    runner: &GitRunner,
    repo: &Path,
    action: &UndoAction,
) -> Result<(), ReflogError> {
    check_target(action)?;
    match action {
        UndoAction::ResetKeep { target } => {
            runner.run(repo, &["reset", "-q", "--keep", target], RunOpts::default()).await?;
        }
        UndoAction::ResetSoft { target } => {
            runner.run(repo, &["reset", "-q", "--soft", target], RunOpts::default()).await?;
        }
        UndoAction::Checkout { target, detach } => {
            let mut argv = vec!["switch"];
            if *detach {
                argv.push("--detach");
            }
            argv.push(target);
            runner.run(repo, &argv, RunOpts::default()).await?;
        }
    }
    Ok(())
}

async fn head_oid(runner: &GitRunner, repo: &Path) -> Result<String, ReflogError> {
    Ok(runner.run(repo, &["rev-parse", "HEAD"], RunOpts::default()).await?.stdout_str().clone())
}

/// Short name of the branch HEAD is on, `None` when detached.
async fn head_branch(runner: &GitRunner, repo: &Path) -> Option<String> {
    let sym = ["symbolic-ref", "-q", "--short", "HEAD"];
    runner.run(repo, &sym, RunOpts::default()).await.ok().map(|o| o.stdout_str().clone())
}

/// Undoes the last HEAD movement and returns what was done and how to redo it.
///
/// # Errors
/// [`ReflogError::Parse`] with "nothing to undo" when [`undo_preview`] is `None`;
/// [`ReflogError::Git`] when git refuses (for example `reset --keep` with conflicting local changes).
pub async fn undo_last(runner: &GitRunner, repo: &Path) -> Result<UndoOutcome, ReflogError> {
    let info = undo_preview(runner, repo)
        .await?
        .ok_or_else(|| ReflogError::Parse(ParseError("nothing to undo".into())))?;
    let before = head_oid(runner, repo).await?;
    let redo = match &info.action {
        UndoAction::Checkout { .. } => match head_branch(runner, repo).await {
            Some(b) => UndoAction::Checkout { target: b, detach: false },
            None => UndoAction::Checkout { target: before, detach: true },
        },
        UndoAction::ResetSoft { .. } => UndoAction::ResetSoft { target: before },
        UndoAction::ResetKeep { .. } => UndoAction::ResetKeep { target: before },
    };
    apply_action(runner, repo, &info.action).await?;
    let head = head_oid(runner, repo).await?;
    let branch = head_branch(runner, repo).await;
    Ok(UndoOutcome { info, redo, head, branch })
}
