# Changelog

## Unreleased

### Phase 0 demo (2026-10-15, tag `phase-0`)
- `pnpm tauri dev` / the release exe open a 1280x800 window titled "GitBranch" showing the app, git-core and github-api versions through the first IPC call (`app_info`).
- Windows NSIS installer: 1.2 MB (target < 25 MB); `gitbranch.exe`: 3.2 MB. Release build 3 min cold.
- 27 Rust tests against real git (runner + fixtures), 8 vitest tests; `pnpm check` (typecheck, eslint, prettier, rustfmt, clippy pedantic subset) green.
- Idle RAM not yet measured reliably: the app process is 24 MB; WebView2 helper processes must be attributed by parent PID (Phase 1 perf pass).
- CI workflow written (windows-latest + ubuntu-22.04) but not yet run: nothing has been pushed.

- 2026-10-15: Phase 0 toolchain: rustc/cargo 1.97.1, rustfmt 1.9.0, clippy 0.1.97, node 24.18.0, pnpm 12.11.2, @tauri-apps/cli 2.12.2 (tauri 2.12.4), git 2.39.1.windows.1.
- 2026-10-15: `git-core::runner` (`GitRunner`, `RunOpts`, typed `GitError` classified from git output, credential redaction) and `git-core::fixtures` (`FixtureRepo`: empty/linear/merge/octopus/orphan/tags/stash, deterministic oids; `make_fixture` example).
- 2026-10-15: frontend scaffolding: Zustand `useUiStore` (theme, toasts), typed IPC wrappers in `src/ipc/`, error toasts, light/dark design tokens; vitest + testing-library.
- 2026-10-15: GitHub Actions CI (windows-latest, ubuntu-22.04): fmt, clippy, tests, `tauri build`, installer artifacts + size summary. Lint baseline: clippy pedantic subset, eslint (type-checked) + prettier, `pnpm check`.
- 2026-10-15: Tauri 2 + React 19 + Vite 8 scaffold (`ai.rosepetal.gitbranch`, product name GitBranch); Cargo workspace with `git-core` and `github-api` crates; `app_info` IPC command.
- 2026-10-15: project plan, architecture, decision log and Claude Code harness written. No application code yet.
