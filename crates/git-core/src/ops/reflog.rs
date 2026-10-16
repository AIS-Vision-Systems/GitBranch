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
    let [_, before] = &branch_log[..] else {
        return Ok(None);
    };
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

/// Undoes the last HEAD movement and returns what was done.
///
/// # Errors
/// [`ReflogError::Parse`] with "nothing to undo" when [`undo_preview`] is `None`;
/// [`ReflogError::Git`] when git refuses (for example `reset --keep` with conflicting local changes).
pub async fn undo_last(runner: &GitRunner, repo: &Path) -> Result<UndoInfo, ReflogError> {
    let info = undo_preview(runner, repo)
        .await?
        .ok_or_else(|| ReflogError::Parse(ParseError("nothing to undo".into())))?;
    match &info.action {
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
    Ok(info)
}
