//! Linked worktrees: list, add, remove, prune, lock, unlock.

use std::ffi::OsString;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::parse::ParseError;
pub use crate::parse::worktree::Worktree;
use crate::parse::worktree::parse_worktree_list;
use crate::{GitError, GitErrorKind, GitRunner, RunOpts};

/// Failure of [`list_worktrees`].
#[derive(Debug, thiserror::Error)]
pub enum WorktreeError {
    /// A git invocation failed.
    #[error(transparent)]
    Git(#[from] GitError),
    /// Output of git could not be parsed.
    #[error(transparent)]
    Parse(#[from] ParseError),
}

/// What a new worktree checks out.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum WorktreeCheckout {
    /// An existing branch (must not be checked out elsewhere unless forced).
    Existing {
        /// Branch name.
        branch: String,
    },
    /// A new branch created at `start_point`.
    #[serde(rename_all = "camelCase")]
    New {
        /// Name of the branch to create.
        branch: String,
        /// Revision the branch starts at.
        start_point: String,
    },
    /// A detached HEAD at `revision`.
    Detached {
        /// Revision to check out.
        revision: String,
    },
}

async fn run(runner: &GitRunner, repo: &Path, args: Vec<OsString>) -> Result<(), GitError> {
    runner.run(repo, &args, RunOpts::default()).await.map(|_| ())
}

fn argv(parts: &[&str]) -> Vec<OsString> {
    parts.iter().map(OsString::from).collect()
}

/// Lists all worktrees; the first entry is the main checkout.
///
/// # Errors
/// [`WorktreeError`] if git fails or its output is malformed.
pub async fn list_worktrees(
    runner: &GitRunner,
    repo: &Path,
) -> Result<Vec<Worktree>, WorktreeError> {
    let out = runner.run(repo, &["worktree", "list", "--porcelain"], RunOpts::default()).await?;
    Ok(parse_worktree_list(&out.stdout)?)
}

/// Adds a worktree at `path`; `force` passes `--force` (e.g. branch checked out elsewhere).
///
/// # Errors
/// [`GitError`] if git refuses.
pub async fn add_worktree(
    runner: &GitRunner,
    repo: &Path,
    path: &Path,
    checkout: &WorktreeCheckout,
    force: bool,
) -> Result<(), GitError> {
    if let WorktreeCheckout::Existing { branch } = checkout {
        let full = format!("refs/heads/{branch}");
        let probe = argv(&["rev-parse", "--verify", "--quiet", &full]);
        if let Err(e) = runner.run(repo, &probe, RunOpts::default()).await {
            return Err(if e.kind == GitErrorKind::ExitCode(1) {
                GitError {
                    kind: GitErrorKind::ExitCode(1),
                    stderr: format!("branch '{branch}' does not exist"),
                    args: e.args,
                }
            } else {
                e
            });
        }
    }
    let mut a = argv(&["worktree", "add"]);
    if force {
        a.push("--force".into());
    }
    let (tail, rev) = match checkout {
        WorktreeCheckout::Existing { branch } => (Vec::new(), branch),
        WorktreeCheckout::New { branch, start_point } => (argv(&["-b", branch]), start_point),
        WorktreeCheckout::Detached { revision } => (argv(&["--detach"]), revision),
    };
    a.extend(tail);
    a.push("--".into());
    a.push(path.as_os_str().into());
    a.push(rev.into());
    run(runner, repo, a).await
}

/// Removes a worktree. `force` removes it even when dirty (`--force`); a locked worktree is
/// never removed (git fails; unlock it first).
///
/// # Errors
/// [`GitError`] if git refuses.
pub async fn remove_worktree(
    runner: &GitRunner,
    repo: &Path,
    path: &Path,
    force: bool,
) -> Result<(), GitError> {
    let mut a = argv(&["worktree", "remove"]);
    if force {
        a.push("--force".into());
    }
    a.push("--".into());
    a.push(path.as_os_str().into());
    run(runner, repo, a).await
}

/// Prunes administrative data of worktrees whose directory is gone.
///
/// # Errors
/// [`GitError`] if git fails.
pub async fn prune_worktrees(runner: &GitRunner, repo: &Path) -> Result<(), GitError> {
    run(runner, repo, argv(&["worktree", "prune"])).await
}

/// Locks a worktree, optionally recording a reason.
///
/// # Errors
/// [`GitError`] if git refuses (e.g. already locked).
pub async fn lock_worktree(
    runner: &GitRunner,
    repo: &Path,
    path: &Path,
    reason: Option<&str>,
) -> Result<(), GitError> {
    let mut a = argv(&["worktree", "lock"]);
    if let Some(r) = reason {
        a.extend(argv(&["--reason", r]));
    }
    a.push("--".into());
    a.push(path.as_os_str().into());
    run(runner, repo, a).await
}

/// Unlocks a worktree.
///
/// # Errors
/// [`GitError`] if git refuses.
pub async fn unlock_worktree(runner: &GitRunner, repo: &Path, path: &Path) -> Result<(), GitError> {
    let mut a = argv(&["worktree", "unlock", "--"]);
    a.push(path.as_os_str().into());
    run(runner, repo, a).await
}

/// Path components: `\\?\` and `\\?\UNC\` prefixes and separators normalised, `.` dropped,
/// lowercased on Windows. (Small duplicate of the watcher's splitter, kept so git-core stands alone.)
fn components(p: &Path) -> Vec<String> {
    let s = p.to_string_lossy();
    let s = match s.strip_prefix(r"\\?\UNC\") {
        Some(r) => format!(r"\\{r}"),
        None => s.strip_prefix(r"\\?\").unwrap_or(&s).to_string(),
    };
    s.split(['/', '\\'])
        .filter(|c| !c.is_empty() && *c != ".")
        .map(|c| if cfg!(windows) { c.to_lowercase() } else { c.to_string() })
        .collect()
}

/// Whether two paths name the same location (textually: separators, prefixes, case on Windows).
pub fn same_path(a: &Path, b: &Path) -> bool {
    components(a) == components(b)
}

/// The listed non-main worktree whose path equals `path`: textually first, then by the resolved
/// paths when both exist (8.3 short names such as `RUNNER~1` on Windows, symlinked temp dirs).
pub fn find_linked<'a>(list: &'a [Worktree], path: &Path) -> Option<&'a Worktree> {
    let linked = || list.iter().filter(|w| !w.is_main);
    if let Some(w) = linked().find(|w| same_path(Path::new(&w.path), path)) {
        return Some(w);
    }
    let want = std::fs::canonicalize(path).ok()?;
    linked().find(|w| std::fs::canonicalize(&w.path).is_ok_and(|p| same_path(&p, &want)))
}

/// Suggested location for a worktree of `branch`: a sibling `<repo dir>.<branch>` of the main checkout.
pub fn default_worktree_path(main_work_tree: &Path, branch: &str) -> PathBuf {
    let name =
        main_work_tree.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let safe = branch.replace(['/', '\\'], "-");
    let leaf = format!("{name}.{safe}");
    main_work_tree.parent().map_or_else(|| PathBuf::from(&leaf), |p| p.join(&leaf))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_path() {
        assert_eq!(
            default_worktree_path(Path::new("/x/repo"), "feat/a"),
            Path::new("/x/repo.feat-a")
        );
        assert_eq!(default_worktree_path(Path::new("/x/repo"), r"a\b"), Path::new("/x/repo.a-b"));
    }

    #[test]
    fn same_path_rules() {
        assert!(same_path(Path::new("/a/b/"), Path::new("/a/./b")));
        assert!(!same_path(Path::new("/a/b"), Path::new("/a/c")));
        assert!(same_path(Path::new(r"\\?\C:\x"), Path::new(r"C:\x")));
        assert!(same_path(Path::new("C:\\x\\"), Path::new("C:/x")));
        assert!(same_path(Path::new(r"\\?\UNC\srv\sh\x"), Path::new(r"\\srv\sh\x")));
        assert!(!same_path(Path::new(r"\\?\UNC\srv\sh"), Path::new(r"C:\srv\sh")));
        if cfg!(windows) {
            assert!(same_path(Path::new("C:/Wt/A"), Path::new(r"c:\wt\a")));
        }
    }
}
