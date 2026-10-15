//! Build a fixture repo on disk:
//! `cargo run -p git-core --features fixtures --example make_fixture -- <kind> <dir>`.

// A CLI example: printing is its job.
#![allow(clippy::print_stdout, clippy::print_stderr)]

use std::path::Path;
use std::process::exit;

use git_core::fixtures::{Kind, build_in};

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let [kind, dir] = args.as_slice() else {
        eprintln!("usage: make_fixture <empty|linear[:N]|merge|octopus|orphan|tags|stash> <dir>");
        exit(2);
    };
    let kind: Kind = kind.parse().unwrap_or_else(|e: String| {
        eprintln!("{e}");
        exit(2);
    });
    let dir = Path::new(dir);
    if let Err(e) = std::fs::create_dir_all(dir) {
        eprintln!("cannot create {}: {e}", dir.display());
        exit(2);
    }
    if dir.read_dir().is_ok_and(|mut d| d.next().is_some()) {
        eprintln!("{} must be empty", dir.display());
        exit(2);
    }
    build_in(kind, dir);
    println!("{}", dir.display());
}
