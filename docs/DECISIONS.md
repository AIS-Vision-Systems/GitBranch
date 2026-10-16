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

## D-004 · accepted · 2026-10-16 — GitHub OAuth App registration (owner action, done)
Context: GitHub integration uses the Device Flow of an OAuth App; the app only embeds the public client_id.
Needed from the owner, before Phase 5 starts:
1. Organization *AIS-Vision-Systems* → *Settings* → *Developer settings* → *OAuth Apps* → *New OAuth App*.
   Name `GitBranch`, Homepage URL `https://github.com/AIS-Vision-Systems/GitBranch`, no Redirect URI (optional field,
   unused by the Device Flow; the old form called it "callback URL" and required a dummy value).
2. Tick **Enable Device Flow**. Leave **Expire user access tokens** *unticked* for now: GitHub's docs are ambiguous on
   whether refreshing a device-flow token needs the client secret (which we never embed). Phase 5 verifies the refresh
   call without a secret on a test app; if it works, the option is switched on in the app settings and the client
   stores the refresh token in the keyring too (8 h access token, 6 months refresh).
3. Paste the **Client ID** into `crates/github-api/src/auth.rs` (`CLIENT_ID`). Do not generate or share a client secret.
Done 2026-10-16: app registered under AIS-Vision-Systems, Device Flow enabled, expiring tokens off, no secret.
Client ID `Ov23liz0pkJr73cVRaNX` is in `crates/github-api/src/auth.rs`.

## D-005 · accepted · 2026-10-15 — Scopes `repo read:org` by default; `workflow` optional
Context: private repos require `repo`; org repo listing requires `read:org`; pushing workflow files requires `workflow`.
Decision: request `repo read:org` at login; a settings toggle re-authorizes with `workflow` when the user needs it.

## D-006 · accepted · 2026-10-16 — Auto-update with `tauri-plugin-updater`, GitHub Releases as the channel
Context: options were (a) manual downloads from GitHub Releases or (b) `tauri-plugin-updater` with a signing key kept
by the owner. The owner chose (b): the app updates itself when it finds a new version.
Decision: `tauri-plugin-updater` + `tauri-plugin-process` (restart). Endpoint: a `latest.json` attached to each GitHub
Release (`https://github.com/<owner>/<repo>/releases/latest/download/latest.json`), produced by `tauri-action` in a
release workflow. Updates are signed with a minisign keypair generated once by the owner (`pnpm tauri signer generate`):
the **public** key goes in `tauri.conf.json` (`plugins.updater.pubkey`); the **private** key and its password live only
in the owner's password manager and in the GitHub Actions secrets `TAURI_SIGNING_PRIVATE_KEY` /
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Never in the repo.
UX: check on startup (after the first graph paint) and once a day; a non-blocking toast "GitBranch X.Y is available —
Update and restart / Later"; download with progress; a setting to turn checks off. No silent install.
Consequences: implemented in PLAN item 6.5; releases are owner-triggered (tag `vX.Y.Z` -> release workflow). Losing the
private key means a new keypair and users must reinstall once. Linux: the updater handles AppImage; `.deb` users
update through their package manager (we only notify).

## D-007 · accepted · 2026-10-15 — No telemetry, no crash reporting services
Decision: local rotating log file only (`tracing` + `tracing-appender`). Nothing leaves the machine except git/GitHub traffic the user triggers.

## D-008 · accepted · 2026-10-15 — Repo docs and code in English; chat with the owner in Catalan
Reason: cheaper tokens, consistent with the team convention (comments and commits in English).

## D-009 · accepted · 2026-10-15 — Graph rendering: SVG per virtualized row; canvas fallback only if measured > 4 ms/row
Reason: SVG keeps hit-testing and styling trivial; virtualization bounds the cost to visible rows.

## D-010 · accepted · 2026-10-15 — Toolchain installed per-user; Tauri CLI from npm, not `cargo install`
Context: `corepack enable` needs admin rights on this machine (writes to `C:\Program Files\nodejs`); compiling
`tauri-cli` with cargo takes minutes and is not pinned by any lockfile.
Decision: `pnpm` through corepack shims in a user directory: `corepack enable --install-directory %LOCALAPPDATA%\pnpm`
(already on PATH), version pinned via `packageManager` in `package.json`. The Tauri CLI is the `@tauri-apps/cli`
devDependency (prebuilt binary, pinned in `pnpm-lock.yaml`), invoked as `pnpm tauri`.
Consequences: CI installs the same versions from the lockfile; no `cargo install tauri-cli` anywhere. The
`npm install -g pnpm` shim was tried first and dropped: its `.cmd` wrapper breaks when a child shell (Tauri's
`beforeBuildCommand`, nested `pnpm` scripts) invokes it on Windows.

## D-011 · accepted · 2026-10-15 — Cargo workspace root at the repo root; edition 2024; React 19
Context: ARCHITECTURE.md placed the workspace root in `src-tauri/Cargo.toml`, but `crates/` lives next to `src-tauri/`
and `cargo check -p git-core` must work from the repo root. `create-tauri-app` generates edition 2024 and React 19.
Decision: `Cargo.toml` (workspace, shared `[workspace.package]` and `[workspace.dependencies]`, release profile) at the
repo root; members `src-tauri`, `crates/git-core`, `crates/github-api`. Edition 2024, MSRV 1.85. React 19.
Consequences: `.claude/rules/rust.md` and ARCHITECTURE.md updated accordingly; `pnpm tauri` detects the workspace itself.

## D-012 · accepted · 2026-10-15 — Git runner: no default timeout; timeouts only for network/read calls
Context: killing `git` in the middle of a local write (commit, merge, rebase) leaves `.git/index.lock` behind and
kills only the direct child (hooks, `git-remote-https`, `ssh` survive on both OSes).
Decision: `RunOpts::timeout` defaults to `None`. Fetch/push/clone and read-only queries set explicit timeouts;
local writes are cancelled only by the user (dropping the future kills the child). `GIT_EDITOR`/`GIT_SEQUENCE_EDITOR`
default to `:` so git never opens an editor; callers override per call. Credentials in URLs are redacted from
`GitError.args`/`stderr` before logging or reaching the UI.
Consequences: a hung hook blocks the operation until the user cancels. Process-tree kill (Job Object / process
group) and `index.lock` cleanup are deferred to Phase 2 (2.9 undo/recovery); logged as a known limitation.

## D-013 · accepted · 2026-10-15 — Lint baseline: clippy pedantic (allow-listed) via workspace lints; eslint type-checked
Decision: `[workspace.lints]` in the root `Cargo.toml` with `clippy::pedantic` at warn plus `unwrap_used`,
`dbg_macro`, `print_stdout/stderr`; allow-list: `module_name_repetitions`, `must_use_candidate`, `missing_errors_doc`,
`missing_panics_doc`, `struct_excessive_bools`, `too_many_lines`, `doc_markdown`, `similar_names`, `naive_bytecount`.
Frontend: `typescript-eslint` `recommendedTypeChecked` + `stylisticTypeChecked`, react-hooks, and a
`no-restricted-imports` rule that confines `@tauri-apps/api/core` to `src/ipc/core.ts`. Prettier 100 cols, code only
(markdown and `.claude/` are hand-formatted and ignored). `pnpm check` runs typecheck, eslint, prettier, rustfmt and
clippy without nested `pnpm` calls (the npm-installed pnpm shim breaks when scripts call `pnpm` on Windows).

## D-014 · accepted · 2026-10-16 — One branch per phase, merged `--no-ff` into `main` and deleted
Decision: every phase of `docs/PLAN.md` is developed on `phase/N` cut from `main`; per-item commits land there.
When the owner declares the phase finished, merge into `main` with `--no-ff` (the merge commit marks the phase
boundary), tag `phase-N` on `main`, and delete `phase/N`. `main` only moves by phase merges and small doc/branding
commits between phases. Branch name uses a slash so it never collides with the `phase-N` tag. Every commit is pushed
to `origin` immediately (standing owner authorization; the old "never push without the owner" rule is superseded for
ordinary commits — PRs and releases still need the owner). Requested by the owner.

## D-016 · accepted · 2026-10-16 — Machine-readable separators and per-module error enums in `git-core::parse`
Decision: `git log -z --format=...%x1f...` (NUL between records, 0x1f between fields); `for-each-ref` and
`status --porcelain=v2 -z` likewise NUL-terminated. Each parse module exposes a pure `parse_*(&[u8])` returning
`ParseError` plus an async runner call returning a module error enum (`LogError`, `RefsError`, `StatusError`) that
wraps `GitError | ParseError` transparently; `AppError` maps both so the UI sees `git.*` / `parse.*` codes.
