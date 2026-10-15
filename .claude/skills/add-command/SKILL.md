---
name: add-command
description: Recipe to add one git operation end-to-end in GitBranch (git-core op + test, Tauri command, TS IPC wrapper, store action, UI entry point). Use for any new branch/stash/remote/worktree/commit operation.
---

# /add-command <snake_name> "<git args>"

Produce every layer for a new operation, in this order, each layer in one brief when delegating.

1. **git-core op** — `crates/git-core/src/ops/<area>.rs`
   `pub async fn <name>(r: &GitRunner, repo: &Path, args: <NameArgs>) -> Result<<NameResult>, GitError>`
   - Build argv explicitly; `--` before user paths; machine-readable output; map stderr to `GitError::kind`.
   - If output needs parsing, put the parser in `src/parse/<area>.rs` as a pure fn with a unit test on a sample.
   - Integration test in `crates/git-core/tests/<area>.rs` using `FixtureRepo`.
2. **Tauri command** — `src-tauri/src/commands/<area>.rs`
   `#[tauri::command] async fn <name>(state: State<'_, AppState>, repo_id: RepoId, args: <NameArgs>) -> Result<<NameResult>, AppError>`
   Register in `commands/mod.rs` `generate_handler!`. Emit `repo-changed` with the right `what` if the op mutates.
3. **IPC wrapper** — `src/ipc/<area>.ts`: `export function <camelName>(repoId, args): Promise<Result>` + types.
4. **Store action** — `src/state/<area>.ts`: optimistic flag, call wrapper, surface `AppError` to the toast, rely on the
   `repo-changed` event (not on manual refetch) to refresh data.
5. **UI entry point** — context menu item / palette command / dialog under `src/features/...`. Destructive ops get a
   confirm dialog with the exact git command shown.
6. **Check**: `/dev-loop` ladder for git-core and the frontend; `reviewer` if destructive or credential-related.

Naming: Rust snake_case == command name; TS camelCase. One operation per commit.
