//! Reading the user's configured editor.

use std::ffi::OsStr;
use std::path::{Path, PathBuf};

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

#[cfg(test)]
#[allow(clippy::unwrap_used)] // tests
mod tests {
    use super::*;

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
