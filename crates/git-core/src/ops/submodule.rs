//! Submodule status (read only).

use std::path::Path;

use crate::parse::ParseError;
pub use crate::parse::submodule::{Submodule, SubmoduleState};
use crate::parse::submodule::{
    parse_gitlink_entries, parse_gitmodules_urls, parse_submodule_status,
};
use crate::{GitError, GitErrorKind, GitRunner, RunOpts};

/// Failure of [`list_submodules`].
#[derive(Debug, thiserror::Error)]
pub enum SubmoduleError {
    /// A git invocation failed.
    #[error(transparent)]
    Git(#[from] GitError),
    /// Output of git could not be parsed.
    #[error(transparent)]
    Parse(#[from] ParseError),
}

/// Lists the submodules of the repository at `repo` with their state and `.gitmodules` URL.
///
/// # Errors
/// [`SubmoduleError`] if git fails or its output is malformed.
pub async fn list_submodules(
    runner: &GitRunner,
    repo: &Path,
) -> Result<Vec<Submodule>, SubmoduleError> {
    let staged = runner.run(repo, &["ls-files", "--stage", "-z"], RunOpts::default()).await?;
    let entries = parse_gitlink_entries(&staged.stdout);
    if entries.is_empty() {
        return Ok(Vec::new());
    }
    let cfg = ["config", "-z", "-f", ".gitmodules", "--get-regexp", r"^submodule\..*\.(path|url)$"];
    let urls = match runner.run(repo, &cfg, RunOpts::default()).await {
        Ok(out) => parse_gitmodules_urls(&out.stdout),
        // Exit 1: no matches; 128: no `.gitmodules` file. Both mean "no urls".
        Err(e) if matches!(e.kind, GitErrorKind::ExitCode(1 | 128)) => {
            std::collections::HashMap::default()
        }
        Err(e) => return Err(e.into()),
    };
    // `git submodule status` fails on gitlinks without a `.gitmodules` mapping (an embedded
    // repository added with plain `git add`): ask only about the mapped ones.
    let mapped: Vec<String> =
        entries.iter().map(|e| e.1.clone()).filter(|p| urls.contains_key(p)).collect();
    let known: Vec<String> = entries.iter().map(|e| e.1.clone()).collect();
    let mut subs = if mapped.is_empty() {
        Vec::new()
    } else {
        let mut argv = vec!["submodule", "status", "--"];
        argv.extend(mapped.iter().map(String::as_str));
        let status = runner.run(repo, &argv, RunOpts::default()).await?;
        parse_submodule_status(&status.stdout, &known)?
    };
    for s in &mut subs {
        s.url = urls.get(&s.path).cloned();
    }
    for (oid, path) in &entries {
        if !urls.contains_key(path) {
            subs.push(Submodule {
                path: path.clone(),
                head_oid: Some(oid.clone()),
                state: SubmoduleState::Uninitialized,
                describe: None,
                url: None,
            });
        }
    }
    subs.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(subs)
}
