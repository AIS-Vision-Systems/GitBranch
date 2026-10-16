//! Repository discovery: resolve any path inside a repo or worktree to its layout.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::{GitError, GitErrorKind, GitRunner, RunOpts};

/// Where a repository lives on disk.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoInfo {
    /// Top level of the working tree (the git dir itself for bare repositories).
    pub work_tree: PathBuf,
    /// The git dir of this checkout (`.git`, or `.git/worktrees/<name>` for a linked worktree).
    pub git_dir: PathBuf,
    /// The common git dir shared by all worktrees.
    pub common_dir: PathBuf,
    /// True for a linked worktree (`git_dir != common_dir`).
    pub is_worktree: bool,
    /// For a linked worktree, the main checkout, when it has a work tree.
    pub main_work_tree: Option<PathBuf>,
    /// True for a bare repository.
    pub is_bare: bool,
}

fn resolve(base: &Path, printed: &str) -> PathBuf {
    let p = PathBuf::from(printed);
    let joined = if p.is_absolute() { p } else { base.join(p) };
    std::path::absolute(&joined).unwrap_or(joined)
}

fn unexpected(args: &[&str], what: &str) -> GitError {
    GitError {
        kind: GitErrorKind::ExitCode(0),
        stderr: format!("unexpected rev-parse output: {what}"),
        args: args.iter().map(ToString::to_string).collect(),
    }
}

/// Resolves `path` (a directory or a file inside a repository) to a [`RepoInfo`].
///
/// A `NotARepo` error from git is passed through unchanged.
pub async fn discover(runner: &GitRunner, path: &Path) -> Result<RepoInfo, GitError> {
    let abs = std::path::absolute(path).unwrap_or_else(|_| path.to_path_buf());
    let cwd = if abs.is_file() { abs.parent().map_or(abs.clone(), Path::to_path_buf) } else { abs };

    let args = [
        "rev-parse",
        "--path-format=absolute",
        "--is-bare-repository",
        "--git-dir",
        "--git-common-dir",
    ];
    let out = runner.run(&cwd, &args, RunOpts::default()).await?;
    let text = out.stdout_str();
    let lines: Vec<&str> = text.lines().map(str::trim_end).collect();
    let [bare, git_dir, common_dir] = lines[..] else {
        return Err(unexpected(&args, "expected 3 lines"));
    };
    let is_bare = bare == "true";
    let git_dir = resolve(&cwd, git_dir);
    let common_dir = resolve(&cwd, common_dir);

    let work_tree = if is_bare {
        git_dir.clone()
    } else {
        let args = ["rev-parse", "--path-format=absolute", "--show-toplevel"];
        let out = runner.run(&cwd, &args, RunOpts::default()).await?;
        let text = out.stdout_str();
        let top = text.lines().next().unwrap_or("").trim_end();
        if top.is_empty() {
            return Err(unexpected(&args, "empty toplevel"));
        }
        resolve(&cwd, top)
    };

    let is_worktree = !is_bare && git_dir != common_dir;
    // Only a `.git` directory has a checkout next to it; a worktree of a bare repo has no main work tree.
    let main_work_tree = if is_worktree && common_dir.file_name().is_some_and(|n| n == ".git") {
        common_dir.parent().filter(|p| p.is_dir()).map(Path::to_path_buf)
    } else {
        None
    };
    Ok(RepoInfo { work_tree, git_dir, common_dir, is_worktree, main_work_tree, is_bare })
}
