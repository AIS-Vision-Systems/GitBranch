#![allow(clippy::print_stdout, clippy::print_stderr)] // a CLI example: printing is its job

//! Developer utility: store or delete the GitHub token GitBranch uses for HTTPS remotes.
//!
//! Until the Device Flow login (Phase 5) exists, this is the only way to put a token in the
//! keyring. The token is read from stdin so it never appears in a shell history or argv.
//!
//! ```text
//! echo <token> | cargo run -p github-api --example store_token -- <github-login>
//! cargo run -p github-api --example store_token -- --delete
//! ```

use std::io::Read;

use github_api::token::{GITHUB_HOST, KeyringStore, TokenStore};

fn main() {
    let arg = std::env::args().nth(1);
    let store = KeyringStore;
    match arg.as_deref() {
        Some("--delete") => match store.delete(GITHUB_HOST) {
            Ok(()) => println!("token for {GITHUB_HOST} deleted"),
            Err(e) => {
                eprintln!("error: {e}");
                std::process::exit(1);
            }
        },
        Some(login) if !login.starts_with('-') => {
            let mut token = String::new();
            if std::io::stdin().read_to_string(&mut token).is_err() {
                eprintln!("error: could not read the token from stdin");
                std::process::exit(1);
            }
            let token = token.trim();
            if token.is_empty() {
                eprintln!("error: empty token on stdin");
                std::process::exit(1);
            }
            match store.set(GITHUB_HOST, login, token) {
                Ok(()) => println!("token for {login}@{GITHUB_HOST} stored in the OS keyring"),
                Err(e) => {
                    eprintln!("error: {e}");
                    std::process::exit(1);
                }
            }
        }
        _ => {
            eprintln!(
                "usage: store_token <github-login>   (token on stdin)\n       store_token --delete"
            );
            std::process::exit(2);
        }
    }
}
