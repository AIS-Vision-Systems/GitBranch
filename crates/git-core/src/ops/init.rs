//! `git init`: create a repository in a new or empty directory.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::ops::clone::dest_is_free;
use crate::ops::remote::valid_branch_arg;
use crate::{GitError, GitErrorKind, GitRunner, RunOpts};

/// Where to create the repository and how.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct InitArgs {
    /// Absolute directory; must not exist or be empty.
    pub dest: String,
    /// Name of the initial branch; `None` or blank uses git's own default.
    pub initial_branch: Option<String>,
    /// Create a `README.md` and an initial commit with it.
    pub readme: bool,
}

/// Outcome of [`init`].
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct InitResult {
    /// Work-tree path of the new repository.
    pub path: PathBuf,
    /// Set when the repository was created but the initial commit failed (for example no
    /// `user.name`/`user.email`); the repository is kept.
    pub commit_error: Option<String>,
}

fn err(code: i32, msg: String) -> GitError {
    GitError { kind: GitErrorKind::ExitCode(code), stderr: msg, args: Vec::new() }
}

/// Creates a repository at `args.dest` (`git init`), optionally with a README and first commit.
///
/// A directory this call created is removed again when `git init` fails.
///
/// # Errors
/// [`GitError`] on invalid arguments, a non-free destination, a missing parent, or a `git init`
/// failure. A failing initial commit is not an error: see [`InitResult::commit_error`].
pub async fn init(r: &GitRunner, args: &InitArgs) -> Result<InitResult, GitError> {
    let branch = args.initial_branch.as_deref().map(str::trim).filter(|b| !b.is_empty());
    if branch.is_some_and(|b| !valid_branch_arg(b)) {
        return Err(err(129, "invalid init argument: branch".into()));
    }
    let dest = PathBuf::from(&args.dest);
    if !dest.is_absolute() {
        return Err(err(129, "invalid init argument: destination".into()));
    }
    if !dest_is_free(&dest) {
        return Err(err(128, "destination already exists and is not empty".into()));
    }
    let Some(parent) = dest.parent() else {
        return Err(err(129, "invalid init argument: destination".into()));
    };
    if !parent.is_dir() {
        return Err(err(129, format!("parent directory {} does not exist", parent.display())));
    }
    // `create_dir` fails if `dest` appeared meanwhile, closing the check-then-act race.
    let created = if dest.exists() {
        false
    } else {
        std::fs::create_dir(&dest)
            .map_err(|e| err(128, format!("cannot create {}: {e}", dest.display())))?;
        true
    };

    let mut argv: Vec<String> = vec!["init".into(), "-q".into()];
    if let Some(b) = branch {
        argv.push(format!("--initial-branch={b}"));
    }
    argv.extend(["--".into(), dest.to_string_lossy().into_owned()]);
    if let Err(e) = r.run(parent, &argv, RunOpts::default()).await {
        if created {
            let _ = std::fs::remove_dir_all(&dest);
        }
        return Err(e);
    }

    let commit_error = if args.readme { initial_commit(r, &dest).await.err() } else { None };
    Ok(InitResult { path: dest, commit_error })
}

/// Writes `README.md` and commits it; the error text includes git's stderr.
async fn initial_commit(r: &GitRunner, repo: &Path) -> Result<(), String> {
    let name = repo.file_name().map_or_else(String::new, |n| n.to_string_lossy().into_owned());
    std::fs::write(repo.join("README.md"), format!("# {name}\n"))
        .map_err(|e| format!("cannot write README.md: {e}"))?;
    let fmt = |e: GitError| {
        let s = e.stderr.trim();
        if s.is_empty() { format!("{:?}", e.kind) } else { s.to_string() }
    };
    r.run(repo, &["add", "--", "README.md"], RunOpts::default()).await.map_err(fmt)?;
    r.run(repo, &["commit", "-q", "-m", "Initial commit"], RunOpts::default())
        .await
        .map_err(fmt)?;
    Ok(())
}
