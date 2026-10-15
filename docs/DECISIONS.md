# Decision log

Format: `D-nnn · status · date` then context / decision / consequences. Status: **accepted**, **open** (needs the
owner), **superseded**. Claude records routine decisions here on its own; **open** ones are the only reason to
interrupt the owner (see `.claude/skills/decide`).

## D-001 · accepted · 2026-10-15 — Tauri 2 + React/TS over Electron or .NET/Avalonia
Context: GitKraken is Electron + bundled git (1.3 GB). The owner wants a much lighter client for Windows and Linux.
Decision: Tauri 2 with a Rust core and a React/TypeScript frontend.
Consequences: installer in the 10–25 MB range; Linux build needs WebKitGTK; team conventions for C# do not apply here.

## D-002 · accepted · 2026-10-15 — System `git` CLI as the only backend (no libgit2)
Context: worktrees, stash, rebase, hooks, credential helpers and config semantics must match the terminal exactly.
Decision: spawn the user's `git` with machine-readable flags; no libgit2 / git2-rs; never bundle git.
Consequences: requires git >= 2.31 on the machine; parsers live in `crates/git-core` and are tested against real git.

## D-003 · accepted · 2026-10-15 — Targets: Windows + Linux. macOS not targeted.
Consequences: CI matrix windows-latest + ubuntu-22.04; no code-signing for macOS; keyring backends: Credential Manager + Secret Service.

## D-004 · open — GitHub OAuth App registration (owner action)
Context: GitHub integration uses the Device Flow of an OAuth App; the app only embeds the public client_id.
Needed from the owner, before Phase 5 starts:
1. https://github.com/settings/developers → *OAuth Apps* → *New OAuth App*.
   Name `GitBranch`, Homepage URL = the repo URL, Authorization callback URL = `http://127.0.0.1/unused` (required field, not used by Device Flow).
2. In the app settings tick **Enable Device Flow**.
3. Paste the **Client ID** into `crates/github-api/src/auth.rs` (`CLIENT_ID`). Do not generate or share a client secret.
Decision pending: owner confirms the app is created and provides the client_id.

## D-005 · accepted · 2026-10-15 — Scopes `repo read:org` by default; `workflow` optional
Context: private repos require `repo`; org repo listing requires `read:org`; pushing workflow files requires `workflow`.
Decision: request `repo read:org` at login; a settings toggle re-authorizes with `workflow` when the user needs it.

## D-006 · open — Auto-update channel
Options: (a) none, user downloads installers from GitHub Releases; (b) `tauri-plugin-updater` with a signing key kept by the owner.
Default if no answer by Phase 6: (a).

## D-007 · accepted · 2026-10-15 — No telemetry, no crash reporting services
Decision: local rotating log file only (`tracing` + `tracing-appender`). Nothing leaves the machine except git/GitHub traffic the user triggers.

## D-008 · accepted · 2026-10-15 — Repo docs and code in English; chat with the owner in Catalan
Reason: cheaper tokens, consistent with the team convention (comments and commits in English).

## D-009 · accepted · 2026-10-15 — Graph rendering: SVG per virtualized row; canvas fallback only if measured > 4 ms/row
Reason: SVG keeps hit-testing and styling trivial; virtualization bounds the cost to visible rows.

## D-010 · accepted · 2026-10-15 — Toolchain installed per-user; Tauri CLI from npm, not `cargo install`
Context: `corepack enable` needs admin rights on this machine (writes to `C:\Program Files\nodejs`); compiling
`tauri-cli` with cargo takes minutes and is not pinned by any lockfile.
Decision: `pnpm` installed with `npm install -g pnpm` (user profile) and pinned via `packageManager` in `package.json`;
the Tauri CLI is the `@tauri-apps/cli` devDependency (prebuilt binary, pinned in `pnpm-lock.yaml`), invoked as `pnpm tauri`.
Consequences: CI installs the same versions from the lockfile; no `cargo install tauri-cli` anywhere.

## D-011 · accepted · 2026-10-15 — Cargo workspace root at the repo root; edition 2024; React 19
Context: ARCHITECTURE.md placed the workspace root in `src-tauri/Cargo.toml`, but `crates/` lives next to `src-tauri/`
and `cargo check -p git-core` must work from the repo root. `create-tauri-app` generates edition 2024 and React 19.
Decision: `Cargo.toml` (workspace, shared `[workspace.package]` and `[workspace.dependencies]`, release profile) at the
repo root; members `src-tauri`, `crates/git-core`, `crates/github-api`. Edition 2024, MSRV 1.85. React 19.
Consequences: `.claude/rules/rust.md` and ARCHITECTURE.md updated accordingly; `pnpm tauri` detects the workspace itself.

## D-012 � accepted � 2026-10-15 � Git runner: no default timeout; timeouts only for network/read calls
Context: killing `git` in the middle of a local write (commit, merge, rebase) leaves `.git/index.lock` behind and
kills only the direct child (hooks, `git-remote-https`, `ssh` survive on both OSes).
Decision: `RunOpts::timeout` defaults to `None`. Fetch/push/clone and read-only queries set explicit timeouts;
local writes are cancelled only by the user (dropping the future kills the child). `GIT_EDITOR`/`GIT_SEQUENCE_EDITOR`
default to `:` so git never opens an editor; callers override per call. Credentials in URLs are redacted from
`GitError.args`/`stderr` before logging or reaching the UI.
Consequences: a hung hook blocks the operation until the user cancels. Process-tree kill (Job Object / process
group) and `index.lock` cleanup are deferred to Phase 2 (2.9 undo/recovery); logged as a known limitation.

## D-013 � accepted � 2026-10-15 � Lint baseline: clippy pedantic (allow-listed) via workspace lints; eslint type-checked
Decision: `[workspace.lints]` in the root `Cargo.toml` with `clippy::pedantic` at warn plus `unwrap_used`,
`dbg_macro`, `print_stdout/stderr`; allow-list: `module_name_repetitions`, `must_use_candidate`, `missing_errors_doc`,
`missing_panics_doc`, `struct_excessive_bools`, `too_many_lines`, `doc_markdown`, `similar_names`, `naive_bytecount`.
Frontend: `typescript-eslint` `recommendedTypeChecked` + `stylisticTypeChecked`, react-hooks, and a
`no-restricted-imports` rule that confines `@tauri-apps/api/core` to `src/ipc/core.ts`. Prettier 100 cols, code only
(markdown and `.claude/` are hand-formatted and ignored). `pnpm check` runs typecheck, eslint, prettier, rustfmt and
clippy without nested `pnpm` calls (the npm-installed pnpm shim breaks when scripts call `pnpm` on Windows).
