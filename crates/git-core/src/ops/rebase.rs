//! Rebase, and the interactive-lite rebase (reorder, squash, fixup, drop) driven by a todo list.

use std::io::Write as _;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::parse::ParseError;
use crate::{GitError, GitRunner, RunOpts};

/// One commit that a rebase onto some base would replay.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TodoEntry {
    /// Full commit id.
    pub oid: String,
    /// Commit subject.
    pub subject: String,
}

/// What to do with a commit in the interactive todo.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TodoAction {
    /// Keep the commit.
    Pick,
    /// Meld into the previous commit, combining messages.
    Squash,
    /// Meld into the previous commit, discarding this message.
    Fixup,
    /// Remove the commit.
    Drop,
}

/// One line of the interactive todo.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TodoItem {
    /// Action for the commit.
    pub action: TodoAction,
    /// Commit id (4..=64 hex).
    pub oid: String,
}

/// Failure of the todo-driven rebase helpers.
#[derive(Debug, thiserror::Error)]
pub enum RebaseError {
    /// A git invocation failed.
    #[error(transparent)]
    Git(#[from] GitError),
    /// Output of git could not be parsed.
    #[error(transparent)]
    Parse(#[from] ParseError),
    /// The todo list is not acceptable.
    #[error("invalid todo: {0}")]
    Invalid(String),
    /// The temporary todo file could not be written.
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

/// `git rebase <onto> [<branch>]`.
///
/// # Errors
/// [`GitError`]; stopping on conflicts is `GitErrorKind::Conflict` (the rebase stays in progress).
pub async fn rebase(
    runner: &GitRunner,
    repo: &Path,
    onto: &str,
    branch: Option<&str>,
) -> Result<(), GitError> {
    let mut argv = vec!["rebase", onto];
    argv.extend(branch);
    runner.run(repo, &argv, RunOpts::default()).await.map(|_| ())
}

/// Parses `git log --reverse --no-merges -z --format=%H%x1f%s` output.
pub fn parse_todo(stdout: &[u8]) -> Result<Vec<TodoEntry>, ParseError> {
    let mut out = Vec::new();
    for rec in stdout.split(|b| *b == 0) {
        let rec = String::from_utf8_lossy(rec);
        let rec = rec.trim_matches('\n');
        if rec.is_empty() {
            continue;
        }
        let Some((oid, subject)) = rec.split_once('\x1f') else {
            return Err(ParseError(format!("todo record without separator: {rec:?}")));
        };
        out.push(TodoEntry { oid: oid.to_string(), subject: subject.to_string() });
    }
    Ok(out)
}

/// The commits `onto..HEAD` that a rebase would replay, oldest first, merges excluded.
pub async fn rebase_todo(
    runner: &GitRunner,
    repo: &Path,
    onto: &str,
) -> Result<Vec<TodoEntry>, RebaseError> {
    let range = format!("{onto}..HEAD");
    let argv = [
        "log",
        "--no-show-signature",
        "--reverse",
        "--no-merges",
        "-z",
        "--format=%H%x1f%s",
        &range,
    ];
    let out = runner.run(repo, &argv, RunOpts::default()).await?;
    Ok(parse_todo(&out.stdout)?)
}

/// Renders the todo file text.
///
/// # Errors
/// [`RebaseError::Invalid`] when empty, when an oid is not 4..=64 hex, or when the first
/// non-dropped item is a squash or fixup (nothing to meld into).
pub fn render_todo(items: &[TodoItem]) -> Result<String, RebaseError> {
    if items.is_empty() {
        return Err(RebaseError::Invalid("the todo list is empty".into()));
    }
    let first = items.iter().find(|i| i.action != TodoAction::Drop);
    if matches!(first, Some(i) if matches!(i.action, TodoAction::Squash | TodoAction::Fixup)) {
        return Err(RebaseError::Invalid("the first commit cannot be squashed or fixed up".into()));
    }
    let mut text = String::new();
    for item in items {
        let ok =
            (4..=64).contains(&item.oid.len()) && item.oid.bytes().all(|b| b.is_ascii_hexdigit());
        if !ok {
            return Err(RebaseError::Invalid(format!("bad commit id {:?}", item.oid)));
        }
        let verb = match item.action {
            TodoAction::Pick => "pick",
            TodoAction::Squash => "squash",
            TodoAction::Fixup => "fixup",
            TodoAction::Drop => "drop",
        };
        text.push_str(verb);
        text.push(' ');
        text.push_str(&item.oid);
        text.push('\n');
    }
    Ok(text)
}

/// The `GIT_SEQUENCE_EDITOR` value that overwrites git's todo with `todo`.
///
/// git runs it through its own `sh` (appending the todo path), so the path uses forward slashes
/// (`C:/Users/...` on Windows) and is single-quoted.
///
/// # Errors
/// [`RebaseError::Invalid`] when the path contains a single quote.
pub fn sequence_editor(todo: &Path) -> Result<String, RebaseError> {
    let p = todo.to_string_lossy().replace('\\', "/");
    if p.contains('\'') {
        return Err(RebaseError::Invalid(format!("todo path contains a quote: {p}")));
    }
    Ok(format!("cp '{p}'"))
}

/// Requires every commit of `todo` to appear exactly once in `items` (ids may be abbreviated)
/// and nothing else, so a stale list can never silently drop or invent commits.
///
/// # Errors
/// [`RebaseError::Invalid`] "todo list is out of date".
pub fn check_against_todo(items: &[TodoItem], todo: &[TodoEntry]) -> Result<(), RebaseError> {
    let stale = || RebaseError::Invalid("todo list is out of date".into());
    if items.len() != todo.len() {
        return Err(stale());
    }
    let mut used = vec![false; todo.len()];
    for item in items {
        let want = item.oid.to_ascii_lowercase();
        let mut hits = todo.iter().enumerate().filter(|(_, e)| e.oid.starts_with(&want));
        match (hits.next(), hits.next()) {
            (Some((i, _)), None) if !used[i] => used[i] = true,
            _ => return Err(stale()),
        }
    }
    Ok(())
}

/// `git rebase -i <onto>` with the todo replaced by `items` (non-interactive for the user).
///
/// # Errors
/// [`RebaseError::Invalid`] for a bad todo, [`RebaseError::Io`] when the temp file cannot be
/// written, [`RebaseError::Git`] from git (conflicts are `GitErrorKind::Conflict`).
pub async fn rebase_interactive(
    runner: &GitRunner,
    repo: &Path,
    onto: &str,
    items: &[TodoItem],
) -> Result<(), RebaseError> {
    let text = render_todo(items)?;
    let todo = rebase_todo(runner, repo, onto).await?;
    check_against_todo(items, &todo)?;
    let mut file = tempfile::NamedTempFile::new()?;
    file.write_all(text.as_bytes())?;
    file.flush()?;
    let editor = sequence_editor(file.path())?;
    let opts = RunOpts { env: vec![("GIT_SEQUENCE_EDITOR".into(), editor)], ..RunOpts::default() };
    let argv = ["-c", "rebase.missingCommitsCheck=error", "rebase", "-i", onto];
    // `file` is deleted on drop, after git has read it.
    runner.run(repo, &argv, opts).await.map(|_| ()).map_err(RebaseError::from)
}

#[cfg(test)]
#[allow(clippy::unwrap_used)] // tests: unwrap is fine
mod tests {
    use super::*;

    fn item(action: TodoAction, oid: &str) -> TodoItem {
        TodoItem { action, oid: oid.into() }
    }

    #[test]
    fn renders_in_order_with_drop() {
        let t = render_todo(&[
            item(TodoAction::Pick, "aaaa"),
            item(TodoAction::Drop, "bbbb"),
            item(TodoAction::Squash, "cccc"),
            item(TodoAction::Fixup, "dddd"),
        ])
        .unwrap();
        assert_eq!(t, "pick aaaa\ndrop bbbb\nsquash cccc\nfixup dddd\n");
    }

    #[test]
    fn rejects_bad_todos() {
        assert!(render_todo(&[]).is_err());
        assert!(
            render_todo(&[item(TodoAction::Squash, "aaaa"), item(TodoAction::Pick, "bbbb")])
                .is_err()
        );
        assert!(
            render_todo(&[item(TodoAction::Drop, "aaaa"), item(TodoAction::Fixup, "bbbb")])
                .is_err()
        );
        assert!(render_todo(&[item(TodoAction::Pick, "xyz1")]).is_err());
        assert!(render_todo(&[item(TodoAction::Pick, "abc")]).is_err());
        assert!(
            render_todo(&[item(TodoAction::Drop, "aaaa"), item(TodoAction::Pick, "bbbb")]).is_ok()
        );
    }

    #[test]
    fn editor_quotes_and_slashes() {
        let s = sequence_editor(Path::new(r"C:\Users\me\AppData\Local\Temp\todo.txt")).unwrap();
        assert_eq!(s, "cp 'C:/Users/me/AppData/Local/Temp/todo.txt'");
        assert_eq!(sequence_editor(Path::new("/tmp/a b/todo")).unwrap(), "cp '/tmp/a b/todo'");
        assert!(sequence_editor(Path::new("/tmp/it's/todo")).is_err());
    }

    #[test]
    fn parses_todo_sample() {
        let s = "aaa\x1ffirst\0bbb\x1fsecond: with colon\0";
        let v = parse_todo(s.as_bytes()).unwrap();
        assert_eq!(v.len(), 2);
        assert_eq!(v[0], TodoEntry { oid: "aaa".into(), subject: "first".into() });
        assert_eq!(v[1].subject, "second: with colon");
        assert!(parse_todo(b"nosep\0").is_err());
    }

    #[test]
    fn checks_items_against_todo() {
        let todo = vec![
            TodoEntry { oid: "aaaa1111".into(), subject: "a".into() },
            TodoEntry { oid: "bbbb2222".into(), subject: "b".into() },
        ];
        let ok = [item(TodoAction::Drop, "bbbb"), item(TodoAction::Pick, "aaaa1111")];
        assert!(check_against_todo(&ok, &todo).is_ok());
        let missing = [item(TodoAction::Pick, "aaaa")];
        assert!(check_against_todo(&missing, &todo).is_err());
        let dup = [item(TodoAction::Pick, "aaaa"), item(TodoAction::Pick, "aaaa")];
        assert!(check_against_todo(&dup, &todo).is_err());
        let foreign = [item(TodoAction::Pick, "aaaa"), item(TodoAction::Pick, "cccc")];
        assert!(check_against_todo(&foreign, &todo).is_err());
    }
}
