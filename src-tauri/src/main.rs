//! GitBranch desktop entry point.

// Prevents an additional console window on Windows in release. Do not remove.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Askpass mode (D-024): git runs this exe as `GIT_ASKPASS`; answer and exit before any init.
    let args: Vec<String> =
        std::env::args_os().skip(1).map(|a| a.to_string_lossy().into_owned()).collect();
    let flag = std::env::var("GITBRANCH_ASKPASS").ok();
    if gitbranch_lib::is_askpass_invocation(flag.as_deref(), &args) {
        std::process::exit(gitbranch_lib::askpass_main(&args));
    }
    gitbranch_lib::run();
}
