# Changelog

## Unreleased

- 2026-10-16: Graph look and feel (item 2.10, D-023): GitKraken-style three-column graph (BRANCH / TAG · GRAPH ·
  COMMIT MESSAGE) with a column header, ref chips with local/remote/tag icons, local+upstream folded into one chip with
  `↑n ↓n`, `+N` pill for crowded commits, initials avatars ringed in the lane colour, rounded lane curves, full-row
  hover/selection, dark theme by default (persisted).
- 2026-10-16: Phase 2 — local operations. Stage/unstage/discard per file, hunk and line (patches built in Rust,
  `git apply --cached`); commit with template/amend/sign-off; branches (create, checkout, rename, safe/force delete,
  upstream); stash push/list/apply/pop/drop with a stash panel; merge (ff/no-ff/squash), rebase onto and
  interactive-lite rebase (reorder/squash/fixup/drop); reset/revert/cherry-pick/tags; conflict banner with
  abort/continue/skip and ours/theirs/mark-resolved; graph context menus and branch drag-and-drop; reflog-based
  Undo (Ctrl+Z). Every destructive action confirms with the exact git command. Decisions D-018–D-022.
- 2026-10-16: Phase 1 — open a repository (native picker, recent list, worktree detection, `gitbranch <path>`),
  commit graph for all refs with lanes/colors, ref chips, WIP row, keyboard navigation; commit details with changed
  files; unified/split diff viewer with light syntax coloring; live refresh from a debounced file watcher;
  perf pass on git/git (85.6k commits): first page 124 ms, full history 1.2 s, layout of 100k commits 73 ms.
  Decisions D-014–D-017.

### Phase 2 demo (2026-10-16, branch `phase/2`)
- Open a dirty repo: the WIP pane lists Staged/Unstaged/Untracked with per-file Stage/Unstage/Discard; click a file,
  press "Stage hunk" or select lines in the gutter and stage just those; type a message, Ctrl+Enter: "Committed abc1234".
- Right-click a commit or a branch chip (or drag a branch onto another): create branch/tag here, checkout, merge
  (ff/no-ff/squash), rebase onto, interactive rebase (reorder/squash/fixup/drop), cherry-pick, revert, reset
  (soft/mixed/hard), delete; every destructive step shows the exact git command before running.
- Merge a conflicting branch: a banner shows "Merge in progress · 1 conflicted file" with Abort/Continue; the WIP pane
  offers Ours/Theirs/Open/Mark resolved; Continue finishes the merge. Toolbar: Branch…, Stash (push with untracked),
  Stashes list (apply/pop/drop/show) and Undo (Ctrl+Z, reflog-based, disabled while an operation is in progress).
- GitKraken-style graph (2.10): BRANCH / TAG column with icon chips and `+N`, initials avatars on the nodes, rounded
  lanes, full-row selection, dark theme by default.
- 186 Rust tests on real git fixtures (+95), 268 vitest tests (+175); `pnpm check` green; release build 2 min 03 s
  (warm); `gitbranch.exe` 4.8 MB, NSIS installer 1.6 MB (target < 25 MB).
- Verified by hand on a fixture repo through the OS accessibility tree (stage hunk, commit, branch, undo, conflicting
  merge with take-theirs + continue, stash push/pop, interactive rebase dialog); four issues found and fixed in 8334be7.

### Phase 1 demo (2026-10-16, branch `phase/1`)
- `gitbranch C:/Data/RD/_perf/git` (git/git, 85.6k commits, 1,021 refs) paints the first 2,000 rows 197 ms after the
  first IPC call (release, cold); the remaining 83.6k rows arrive in one background fetch (~1 s) served in 10k slices.
- Click a merge commit: subject/body, author, parents, first-parent changed files; click a file: unified or split diff
  with hunk headers and syntax tokens. Touch a file in the work tree: the WIP row updates within ~200 ms.
- Windows NSIS installer 1.5 MB, `gitbranch.exe` 4.4 MB (target < 25 MB); release build 3 min.
- 91 Rust tests on real git fixtures, 93 vitest tests; `pnpm check` green. Idle RAM still not attributed per
  WebView2 helper (app process 32 MB); carried to Phase 6 polish.

### Phase 0 demo (2026-10-15, tag `phase-0`)
- `pnpm tauri dev` / the release exe open a 1280x800 window titled "GitBranch" showing the app, git-core and github-api versions through the first IPC call (`app_info`).
- Windows NSIS installer: 1.2 MB (target < 25 MB); `gitbranch.exe`: 3.2 MB. Release build 3 min cold.
- 27 Rust tests against real git (runner + fixtures), 8 vitest tests; `pnpm check` (typecheck, eslint, prettier, rustfmt, clippy pedantic subset) green.
- Idle RAM not yet measured reliably: the app process is 24 MB; WebView2 helper processes must be attributed by parent PID (Phase 1 perf pass).
- CI workflow written (windows-latest + ubuntu-22.04) but not yet run: nothing has been pushed.

- 2026-10-16: app logo redrawn as a vector (`docs/assets/logo.svg`, rendered to `logo.png` with resvg): diamond fills the canvas, crisp edges; same colors (#15275B, #00AAED). Applied: window/installer icons regenerated with `pnpm tauri icon`, favicon, README.
- 2026-10-15: Phase 0 toolchain: rustc/cargo 1.97.1, rustfmt 1.9.0, clippy 0.1.97, node 24.18.0, pnpm 12.11.2, @tauri-apps/cli 2.12.2 (tauri 2.12.4), git 2.39.1.windows.1.
- 2026-10-15: `git-core::runner` (`GitRunner`, `RunOpts`, typed `GitError` classified from git output, credential redaction) and `git-core::fixtures` (`FixtureRepo`: empty/linear/merge/octopus/orphan/tags/stash, deterministic oids; `make_fixture` example).
- 2026-10-15: frontend scaffolding: Zustand `useUiStore` (theme, toasts), typed IPC wrappers in `src/ipc/`, error toasts, light/dark design tokens; vitest + testing-library.
- 2026-10-15: GitHub Actions CI (windows-latest, ubuntu-22.04): fmt, clippy, tests, `tauri build`, installer artifacts + size summary. Lint baseline: clippy pedantic subset, eslint (type-checked) + prettier, `pnpm check`.
- 2026-10-15: Tauri 2 + React 19 + Vite 8 scaffold (`ai.rosepetal.gitbranch`, product name GitBranch); Cargo workspace with `git-core` and `github-api` crates; `app_info` IPC command.
- 2026-10-15: project plan, architecture, decision log and Claude Code harness written. No application code yet.
