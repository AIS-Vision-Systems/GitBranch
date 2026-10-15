---
paths:
  - "crates/**"
  - "src-tauri/**"
---

# Rust conventions (GitBranch)

- Edition 2024 (MSRV 1.85), `#![deny(unsafe_code)]` in git-core and github-api. `anyhow` only in binaries; crates expose typed errors
  (`thiserror`).
- Spawn git with `std::process::Command` / `tokio::process::Command`; never `sh -c`. Pass `--` before user-supplied paths.
- Parse only machine-readable git output. Parsers are pure functions `fn parse_x(bytes: &[u8]) -> Result<T, ParseError>`
  with unit tests on captured samples, plus one integration test on a fixture repo.
- Public types that cross IPC derive `Serialize, Deserialize, Clone, Debug` and use `#[serde(rename_all = "camelCase")]`.
- No `unwrap()` outside tests. `expect()` only with an invariant message.
- Keep tauri commands thin: argument parsing, call into git-core, map errors to `AppError`.
- Logging via `tracing`; never log tokens, full argv of askpass, or file contents.
- Windows: use `std::os::windows::process::CommandExt::creation_flags(CREATE_NO_WINDOW)` behind `#[cfg(windows)]`.
- Tests: fixtures via `crates/git-core/tests/fixtures.rs` (`FixtureRepo::linear(n)`, `::merge()`, `::octopus()`,
  `::with_stash()`...). Set `GIT_CONFIG_GLOBAL=/dev/null`-equivalent and explicit `user.name/email` so tests ignore
  the developer's global config.
- Format with rustfmt (hook), lint with `clippy -D warnings`; allow lints only with a one-line reason.
