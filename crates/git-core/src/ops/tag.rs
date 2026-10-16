//! Tag operations.

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::{GitError, GitRunner, RunOpts};

/// Options for creating a tag.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TagArgs {
    /// Tag name.
    pub name: String,
    /// Commit-ish to tag.
    pub target: String,
    /// `Some` creates an annotated tag with this message; `None` a lightweight tag.
    pub message: Option<String>,
    /// Replace an existing tag (`-f`).
    pub force: bool,
}

/// Creates a lightweight or annotated tag.
///
/// # Errors
/// [`GitError`] if the name is invalid/taken (without `force`) or the target is unknown.
pub async fn create_tag(runner: &GitRunner, repo: &Path, args: &TagArgs) -> Result<(), GitError> {
    let mut argv: Vec<&str> = vec!["tag"];
    let opts = match &args.message {
        Some(msg) => {
            argv.extend(["-a", "-F", "-"]);
            RunOpts::with_stdin(msg.as_bytes().to_vec())
        }
        None => RunOpts::default(),
    };
    if args.force {
        argv.push("-f");
    }
    argv.extend([args.name.as_str(), args.target.as_str()]);
    runner.run(repo, &argv, opts).await?;
    Ok(())
}

/// Deletes the local tag `name`.
///
/// # Errors
/// [`GitError`] if the tag does not exist.
pub async fn delete_tag(runner: &GitRunner, repo: &Path, name: &str) -> Result<(), GitError> {
    runner.run(repo, &["tag", "-d", name], RunOpts::default()).await?;
    Ok(())
}
