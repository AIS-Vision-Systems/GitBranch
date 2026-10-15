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
- Tests: fixtures via `git_core::fixtures::FixtureRepo` (`::linear(n)`, `::merge()`, `::octopus()`, `::orphan()`,
  `::tags()`, `::with_stash()`; `repo.git(&[..])`, `repo.commit_file(..)`, `repo.rev_parse(..)`). Feature `fixtures`
  is enabled for tests by the self dev-dependency. Fixture git runs with global/system config disabled and fixed
  identity/dates, so oids are deterministic.
- Format with rustfmt (hook), lint with `clippy -D warnings`; allow lints only with a one-line reason.
