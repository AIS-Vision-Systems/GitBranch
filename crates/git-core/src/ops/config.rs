//! Reading the user's configured editor.

use std::path::Path;

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

/// The user's editor as an argv: `core.editor`, else `$VISUAL`, else `$EDITOR`. `None` when none
/// is set (or the value is blank or malformed).
///
/// # Errors
/// [`GitError`] if reading the config fails for a reason other than "unset".
pub async fn editor_command(
    runner: &GitRunner,
    repo: &Path,
) -> Result<Option<Vec<String>>, GitError> {
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
