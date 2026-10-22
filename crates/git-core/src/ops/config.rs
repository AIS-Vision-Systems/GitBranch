//! Reading the user's configured editor.

use std::ffi::OsStr;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::parse::ParseError;
use crate::{GitError, GitErrorKind, GitRunner, RunOpts};

/// Splits `s` into words like a POSIX shell would: whitespace separates words, single quotes keep
/// everything literally, double quotes allow `\"` and `\\` escapes, and a backslash outside quotes
/// escapes the next character. Returns `None` for an unterminated quote.
pub fn split_words(s: &str) -> Option<Vec<String>> {
    let mut words = Vec::new();
    let mut cur = String::new();
    let mut in_word = false;
    let mut chars = s.chars();
    while let Some(c) = chars.next() {
        match c {
            '\'' => {
                in_word = true;
                loop {
                    match chars.next()? {
                        '\'' => break,
                        c => cur.push(c),
                    }
                }
            }
            '"' => {
                in_word = true;
                loop {
                    match chars.next()? {
                        '"' => break,
                        '\\' => match chars.next()? {
                            c @ ('"' | '\\') => cur.push(c),
                            c => {
                                cur.push('\\');
                                cur.push(c);
                            }
                        },
                        c => cur.push(c),
                    }
                }
            }
            '\\' => {
                in_word = true;
                cur.push(chars.next()?);
            }
            c if c.is_whitespace() => {
                if in_word {
                    words.push(std::mem::take(&mut cur));
                    in_word = false;
                }
            }
            c => {
                in_word = true;
                cur.push(c);
            }
        }
    }
    if in_word {
        words.push(cur);
    }
    Some(words)
}

/// Whether `p` may be run: on Unix the executable bit must be set; elsewhere any file qualifies.
fn is_executable(p: &Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::metadata(p).is_ok_and(|m| m.permissions().mode() & 0o111 != 0)
    }
    #[cfg(not(unix))]
    {
        let _ = p;
        true
    }
}

/// Candidate files for `base` under the given PATHEXT semantics (Windows when `pathext` is `Some`).
fn program_candidates(base: &Path, pathext: Option<&OsStr>) -> Option<PathBuf> {
    let is_file = |p: &PathBuf| p.is_file();
    let Some(pathext) = pathext else {
        return Some(base.to_path_buf()).filter(is_file).filter(|p| is_executable(p));
    };
    let exts = pathext.to_string_lossy();
    for ext in exts.split(';').map(str::trim).filter(|e| !e.is_empty()) {
        let ext = ext.trim_start_matches('.');
        for variant in [ext.to_string(), ext.to_lowercase()] {
            let mut name = base.as_os_str().to_os_string();
            name.push(".");
            name.push(&variant);
            let p = PathBuf::from(name);
            if p.is_file() {
                return Some(p);
            }
        }
    }
    // An exact match counts only for a name that already has an extension (`tool.cmd`).
    if base.extension().is_some() {
        return Some(base.to_path_buf()).filter(is_file);
    }
    None
}

/// Resolve a program name the way a shell would. A name containing a path separator (or `.`/`..` prefix)
/// is returned as-is when it exists (on Windows also trying the PATHEXT extensions when it has no
/// extension). A bare name is searched in each `path` entry; on Windows each PATHEXT extension is tried
/// in order (so `code` -> `code.cmd`). `None` when nothing matches.
///
/// `pathext` `Some` selects Windows semantics, `None` Unix semantics (a regular file).
pub fn resolve_program_in(program: &str, path: &OsStr, pathext: Option<&OsStr>) -> Option<PathBuf> {
    if program.is_empty() {
        return None;
    }
    if program.starts_with('.') || program.chars().any(std::path::is_separator) {
        return program_candidates(Path::new(program), pathext);
    }
    std::env::split_paths(path)
        .filter(|d| !d.as_os_str().is_empty())
        .find_map(|d| program_candidates(&d.join(program), pathext))
}

/// [`resolve_program_in`] with the process `PATH` and (Windows only) `PATHEXT`.
pub fn resolve_program(program: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    let pathext = if cfg!(windows) {
        Some(std::env::var_os("PATHEXT").unwrap_or_else(|| ".COM;.EXE;.BAT;.CMD".into()))
    } else {
        None
    };
    resolve_program_in(program, &path, pathext.as_deref())
}

/// Split a command string into program + args (first whitespace-delimited token is the program; the rest is kept
/// as-is). Returns None for an empty/whitespace string.
pub fn split_program(cmd: &str) -> Option<(&str, &str)> {
    let cmd = cmd.trim();
    if cmd.is_empty() {
        return None;
    }
    Some(match cmd.find(char::is_whitespace) {
        Some(i) => (&cmd[..i], cmd[i..].trim_start()),
        None => (cmd, ""),
    })
}

/// Difftool command ready for `difftool.<tool>.cmd`: the program is resolved with [`resolve_program`] (quoted,
/// forward slashes, only when it resolved to something different from the bare name), and ` "$LOCAL" "$REMOTE"`
/// is appended when the command mentions neither `$LOCAL` nor `$REMOTE`.
pub fn difftool_cmd(setting: &str) -> String {
    difftool_cmd_with(setting, resolve_program)
}

/// [`difftool_cmd`] with an injectable resolver.
pub fn difftool_cmd_with(setting: &str, resolver: impl Fn(&str) -> Option<PathBuf>) -> String {
    let Some((program, rest)) = split_program(setting) else {
        return setting.to_string();
    };
    let mut out = if program.starts_with(['"', '\'']) {
        setting.trim().to_string()
    } else {
        let resolved = resolver(program).filter(|p| p.as_os_str() != program);
        // A backslash in an unquoted program would be eaten by sh, so rewrite it even when resolved to itself.
        let target = resolved.or_else(|| program.contains('\\').then(|| PathBuf::from(program)));
        match target {
            Some(p) => {
                let mut p = p.to_string_lossy().into_owned();
                if cfg!(windows) {
                    p = p.replace('\\', "/");
                }
                let q = format!("'{}'", p.replace('\'', r"'\''"));
                if rest.is_empty() { q } else { format!("{q} {rest}") }
            }
            None => setting.trim().to_string(),
        }
    };
    let has = |n: &str| out.contains(&format!("${n}")) || out.contains(&format!("${{{n}}}"));
    if !has("LOCAL") && !has("REMOTE") && !has("MERGED") {
        out.push_str(" \"$LOCAL\" \"$REMOTE\"");
    }
    out
}

/// The user's editor as an argv: `override_cmd` (the app setting) when non-blank, else
/// `core.editor`, else `$VISUAL`, else `$EDITOR`. `None` when none is set (or the value is blank
/// or malformed).
///
/// # Errors
/// [`GitError`] if reading the config fails for a reason other than "unset".
pub async fn editor_command(
    runner: &GitRunner,
    repo: &Path,
    override_cmd: Option<&str>,
) -> Result<Option<Vec<String>>, GitError> {
    if let Some(words) = override_cmd.and_then(split_words).filter(|w| !w.is_empty()) {
        return Ok(Some(words));
    }
    let configured =
        match runner.run(repo, &["config", "--get", "core.editor"], RunOpts::default()).await {
            Ok(o) => Some(o.stdout_str()),
            Err(e) if e.kind == GitErrorKind::ExitCode(1) => None,
            Err(e) => return Err(e),
        };
    let value = configured.filter(|v| !v.trim().is_empty()).or_else(|| {
        ["VISUAL", "EDITOR"]
            .iter()
            .filter_map(|k| std::env::var(k).ok())
            .find(|v| !v.trim().is_empty())
    });
    Ok(value.and_then(|v| split_words(&v)).filter(|w| !w.is_empty()))
}

/// Where an identity is written.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ConfigScope {
    /// The repository's `.git/config`.
    Local,
    /// The user's global config.
    Global,
}

/// A config value and the scope it comes from.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdentityValue {
    /// The value.
    pub value: String,
    /// Scope as git prints it: `local`, `global`, `system`, `worktree` or `command`.
    pub scope: String,
}

/// The effective `user.name` / `user.email` for a repository.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Identity {
    /// `user.name`, if set anywhere.
    pub name: Option<IdentityValue>,
    /// `user.email`, if set anywhere.
    pub email: Option<IdentityValue>,
}

/// Failure of an identity operation.
#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    /// git failed.
    #[error(transparent)]
    Git(#[from] GitError),
    /// Unexpected git output.
    #[error(transparent)]
    Parse(#[from] ParseError),
    /// The name or email is empty or contains a newline or NUL.
    #[error("invalid {0}")]
    Invalid(&'static str),
}

/// Parses `git config --show-scope -z --get` output: `<scope>\0<value>\0` (git separates scope
/// and value with NUL, verified against real git). Empty output is `None`.
///
/// # Errors
/// [`ParseError`] when the scope or the value is not NUL-terminated.
pub fn parse_scoped_value(bytes: &[u8]) -> Result<Option<IdentityValue>, ParseError> {
    if bytes.is_empty() {
        return Ok(None);
    }
    let mut parts = bytes.splitn(3, |b| *b == 0);
    let (Some(scope), Some(value), Some(_rest)) = (parts.next(), parts.next(), parts.next()) else {
        return Err(ParseError("config output is not NUL-terminated".into()));
    };
    Ok(Some(IdentityValue {
        value: String::from_utf8_lossy(value).into_owned(),
        scope: String::from_utf8_lossy(scope).into_owned(),
    }))
}

async fn scoped_get(
    runner: &GitRunner,
    repo: &Path,
    key: &str,
) -> Result<Option<IdentityValue>, ConfigError> {
    match runner
        .run(repo, &["config", "--show-scope", "-z", "--get", key], RunOpts::default())
        .await
    {
        Ok(o) => Ok(parse_scoped_value(&o.stdout)?),
        Err(e) if e.kind == GitErrorKind::ExitCode(1) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

/// The effective committer identity (`user.name`, `user.email`) with the scope each comes from.
///
/// # Errors
/// [`ConfigError`] if git fails for a reason other than "unset".
pub async fn identity(runner: &GitRunner, repo: &Path) -> Result<Identity, ConfigError> {
    Ok(Identity {
        name: scoped_get(runner, repo, "user.name").await?,
        email: scoped_get(runner, repo, "user.email").await?,
    })
}

fn clean<'a>(what: &'static str, v: &'a str) -> Result<&'a str, ConfigError> {
    let v = v.trim();
    if v.is_empty() || v.contains(['\n', '\r', '\0']) {
        Err(ConfigError::Invalid(what))
    } else {
        Ok(v)
    }
}

/// Writes `user.name` and `user.email` at `scope`.
///
/// The two keys are written by two separate git commands. If the email write fails after the name
/// was written, the previous name at that scope is restored (best effort: unset when there was none).
///
/// # Errors
/// [`ConfigError::Invalid`] for an empty value or one containing a line break or NUL;
/// [`ConfigError::Git`] if git fails.
pub async fn set_identity(
    runner: &GitRunner,
    repo: &Path,
    scope: ConfigScope,
    name: &str,
    email: &str,
) -> Result<(), ConfigError> {
    let name = clean("name", name)?;
    let email = clean("email", email)?;
    let flag = match scope {
        ConfigScope::Local => "--local",
        ConfigScope::Global => "--global",
    };
    let previous =
        match runner.run(repo, &["config", flag, "--get", "user.name"], RunOpts::default()).await {
            Ok(o) => Some(o.stdout_str().trim_end_matches(['\n', '\r']).to_string()),
            Err(_) => None,
        };
    // The value is positional after the key, so a leading `-` is not an option.
    runner.run(repo, &["config", flag, "user.name", name], RunOpts::default()).await?;
    if let Err(e) =
        runner.run(repo, &["config", flag, "user.email", email], RunOpts::default()).await
    {
        let _ = match previous {
            Some(p) => {
                runner.run(repo, &["config", flag, "user.name", &p], RunOpts::default()).await
            }
            None => {
                runner
                    .run(repo, &["config", flag, "--unset", "user.name"], RunOpts::default())
                    .await
            }
        };
        return Err(e.into());
    }
    Ok(())
}

#[cfg(test)]
#[allow(clippy::unwrap_used)] // tests
mod tests {
    use super::*;

    #[test]
    fn parses_scoped_value() {
        let v = parse_scoped_value(b"global\0Ada Lovelace\0").unwrap().unwrap();
        assert_eq!(v, IdentityValue { value: "Ada Lovelace".into(), scope: "global".into() });
        let v = parse_scoped_value(b"local\0a\tb\nc\0").unwrap().unwrap();
        assert_eq!(v.value, "a\tb\nc");
        assert_eq!(parse_scoped_value(b"").unwrap(), None);
        assert!(parse_scoped_value(b"nonsense\0").is_err());
        assert!(parse_scoped_value(b"local\0unterminated").is_err());
    }

    #[test]
    fn clean_rejects_bad_values() {
        assert_eq!(clean("name", "  Ada ").unwrap(), "Ada");
        assert!(clean("name", " ").is_err());
        assert!(clean("name", "a\nb").is_err());
        assert!(clean("email", "a\0b").is_err());
    }

    fn w(s: &str) -> Vec<String> {
        split_words(s).unwrap()
    }

    #[test]
    fn splits_like_a_shell() {
        assert_eq!(w("code --wait"), ["code", "--wait"]);
        assert_eq!(w("'C:/Program Files/X/x.exe' --wait"), ["C:/Program Files/X/x.exe", "--wait"]);
        assert_eq!(w("\"notepad++\" -multiInst"), ["notepad++", "-multiInst"]);
        assert_eq!(w("  vim  "), ["vim"]);
        assert_eq!(w("a\\ b c"), ["a b", "c"]);
        assert_eq!(w("\"a \\\"q\\\" b\""), ["a \"q\" b"]);
        assert_eq!(w("''"), [""]);
        assert!(w("").is_empty());
    }

    #[test]
    fn rejects_unterminated_quotes() {
        assert_eq!(split_words("'abc"), None);
        assert_eq!(split_words("\"abc"), None);
        assert_eq!(split_words("abc\\"), None);
    }
}
