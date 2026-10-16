//! Detects an operation stopped half-way (merge, rebase, cherry-pick, revert).

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::repo::RepoInfo;

/// Which operation is in progress.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum InProgressKind {
    /// A merge with conflicts or awaiting `--continue`.
    Merge,
    /// A rebase.
    Rebase,
    /// A cherry-pick.
    CherryPick,
    /// A revert.
    Revert,
}

/// An operation in progress and how far along it is.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InProgress {
    /// Operation kind.
    pub kind: InProgressKind,
    /// Branch being rebased (rebase only, `None` when detached).
    pub head_name: Option<String>,
    /// Commit being rebased onto (rebase only).
    pub onto: Option<String>,
    /// Steps already done (0 when unknown).
    pub done: u32,
    /// Total steps (0 when unknown).
    pub total: u32,
}

fn read(dir: &Path, name: &str) -> Option<String> {
    let s = std::fs::read_to_string(dir.join(name)).ok()?;
    let s = s.trim();
    (!s.is_empty()).then(|| s.to_string())
}

fn num(dir: &Path, name: &str) -> u32 {
    read(dir, name).and_then(|s| s.parse().ok()).unwrap_or(0)
}

fn rebase(dir: &Path, done: &str, total: &str) -> InProgress {
    let head_name = read(dir, "head-name")
        .filter(|n| n != "detached HEAD")
        .map(|n| n.strip_prefix("refs/heads/").map_or(n.clone(), str::to_string));
    InProgress {
        kind: InProgressKind::Rebase,
        head_name,
        onto: read(dir, "onto"),
        done: num(dir, done),
        total: num(dir, total),
    }
}

fn plain(kind: InProgressKind) -> InProgress {
    InProgress { kind, head_name: None, onto: None, done: 0, total: 0 }
}

/// The operation in progress in this checkout's git dir, if any. Precedence: rebase, merge,
/// cherry-pick, revert.
pub fn in_progress(info: &RepoInfo) -> Option<InProgress> {
    let g = &info.git_dir;
    let merge_dir = g.join("rebase-merge");
    if merge_dir.is_dir() {
        return Some(rebase(&merge_dir, "msgnum", "end"));
    }
    let apply_dir = g.join("rebase-apply");
    // `git am` also uses rebase-apply; it marks itself with `applying`.
    if apply_dir.is_dir() && !apply_dir.join("applying").exists() {
        return Some(rebase(&apply_dir, "next", "last"));
    }
    [
        ("MERGE_HEAD", InProgressKind::Merge),
        ("CHERRY_PICK_HEAD", InProgressKind::CherryPick),
        ("REVERT_HEAD", InProgressKind::Revert),
    ]
    .into_iter()
    .find(|(f, _)| g.join(f).exists())
    .map(|(_, k)| plain(k))
    .or_else(|| sequencer_kind(g).map(plain))
}

/// A multi-commit cherry-pick/revert stopped between commits has `sequencer/todo` but no
/// `CHERRY_PICK_HEAD`/`REVERT_HEAD`; the first non-comment line names the operation.
fn sequencer_kind(git_dir: &Path) -> Option<InProgressKind> {
    let todo = std::fs::read_to_string(git_dir.join("sequencer").join("todo")).ok()?;
    let line = todo.lines().map(str::trim).find(|l| !l.is_empty() && !l.starts_with('#'))?;
    match line.split_whitespace().next()? {
        "pick" | "p" => Some(InProgressKind::CherryPick),
        "revert" | "r" => Some(InProgressKind::Revert),
        _ => None,
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)] // tests: unwrap is fine
mod tests {
    use super::*;

    fn info(dir: &Path) -> RepoInfo {
        RepoInfo {
            work_tree: dir.to_path_buf(),
            git_dir: dir.to_path_buf(),
            common_dir: dir.to_path_buf(),
            is_worktree: false,
            main_work_tree: None,
            is_bare: false,
        }
    }

    #[test]
    fn detects_each_kind_with_precedence() {
        let t = tempfile::tempdir().unwrap();
        let d = t.path();
        assert_eq!(in_progress(&info(d)), None);
        std::fs::write(d.join("REVERT_HEAD"), "abc\n").unwrap();
        assert_eq!(in_progress(&info(d)).unwrap().kind, InProgressKind::Revert);
        std::fs::write(d.join("CHERRY_PICK_HEAD"), "abc\n").unwrap();
        assert_eq!(in_progress(&info(d)).unwrap().kind, InProgressKind::CherryPick);
        std::fs::write(d.join("MERGE_HEAD"), "abc\n").unwrap();
        assert_eq!(in_progress(&info(d)).unwrap().kind, InProgressKind::Merge);
        let rb = d.join("rebase-merge");
        std::fs::create_dir(&rb).unwrap();
        std::fs::write(rb.join("head-name"), "refs/heads/feat/x\n").unwrap();
        std::fs::write(rb.join("onto"), "deadbeef\n").unwrap();
        std::fs::write(rb.join("msgnum"), "2\n").unwrap();
        std::fs::write(rb.join("end"), "5\n").unwrap();
        assert_eq!(
            in_progress(&info(d)),
            Some(InProgress {
                kind: InProgressKind::Rebase,
                head_name: Some("feat/x".into()),
                onto: Some("deadbeef".into()),
                done: 2,
                total: 5
            })
        );
    }

    #[test]
    fn rebase_apply_and_am() {
        let t = tempfile::tempdir().unwrap();
        let d = t.path();
        let ra = d.join("rebase-apply");
        std::fs::create_dir(&ra).unwrap();
        std::fs::write(ra.join("next"), "1").unwrap();
        std::fs::write(ra.join("last"), "3").unwrap();
        std::fs::write(ra.join("head-name"), "detached HEAD").unwrap();
        let p = in_progress(&info(d)).unwrap();
        assert_eq!((p.kind, p.head_name, p.done, p.total), (InProgressKind::Rebase, None, 1, 3));
        std::fs::write(ra.join("applying"), "").unwrap();
        assert_eq!(in_progress(&info(d)), None);
    }

    #[test]
    fn sequencer_todo_without_head_files() {
        let t = tempfile::tempdir().unwrap();
        let d = t.path();
        let seq = d.join("sequencer");
        std::fs::create_dir(&seq).unwrap();
        std::fs::write(seq.join("todo"), "# comment\n\npick abc subject\npick def two\n").unwrap();
        assert_eq!(in_progress(&info(d)).unwrap().kind, InProgressKind::CherryPick);
        std::fs::write(seq.join("todo"), "revert abc subject\n").unwrap();
        assert_eq!(in_progress(&info(d)).unwrap().kind, InProgressKind::Revert);
        std::fs::write(seq.join("todo"), "# only comments\n").unwrap();
        assert_eq!(in_progress(&info(d)), None);
    }
}
