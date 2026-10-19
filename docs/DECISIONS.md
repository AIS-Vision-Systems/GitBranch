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
Amendment (3.3): in `run_streaming` the timeout is an inactivity limit, reset on every stdout/stderr chunk; `run` keeps total time.
Consequences: a hung hook blocks the operation until the user cancels. Process-tree kill (Job Object / process
group) and `index.lock` cleanup are deferred to Phase 2 (2.9 undo/recovery); logged as a known limitation.
Resolved 2026-10-16 by 3.3: network ops run in their own process group (Unix) and are killed with `taskkill /T /F` (Windows) / `kill -TERM -- -pid` on cancel or timeout (`kill_tree`); `index.lock` cleanup remains with 2.9.

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

## D-015 · accepted · 2026-10-16 — Repo identity and persistence for item 1.1
Decision: `RepoId` is a short FNV-1a hash of the normalized work-tree path (stable across restarts, no uuid dep).
The recent-repos list is a plain JSON file at `<app_config_dir>/recent.json` (max 20, atomic write) — no
`tauri-plugin-store`. The folder picker runs in Rust via `tauri-plugin-dialog` so the UI keeps calling only typed
commands. Opening a linked worktree asks "main repository (default) / this worktree" instead of silently redirecting.

## D-016 · accepted · 2026-10-16 — Machine-readable separators and per-module error enums in `git-core::parse`
Decision: `git log -z --format=...%x1f...` (NUL between records, 0x1f between fields); `for-each-ref` and
`status --porcelain=v2 -z` likewise NUL-terminated. Each parse module exposes a pure `parse_*(&[u8])` returning
`ParseError` plus an async runner call returning a module error enum (`LogError`, `RefsError`, `StatusError`) that
wraps `GitError | ParseError` transparently; `AppError` maps both so the UI sees `git.*` / `parse.*` codes.

## D-017 · accepted · 2026-10-16 — Write the commit-graph file in the background when missing
Why: on git/git (85k commits) the first-page `git log` drops from 640 ms to 124 ms with a commit-graph file.
It is the same file `git gc` writes, so it is harmless to the user's repository.
`open_repo` spawns `git commit-graph write --reachable` when absent (errors only logged); an opt-out can come later via settings.

## D-018 · accepted · 2026-10-16 — Mutating commands emit `repo-changed` themselves
Decision: every Tauri command that writes to the repository emits `repo-changed { repoId, what }` right after git
succeeds (helper `commands::emit_changed`), in addition to whatever the debounced watcher reports. The UI refresh is
therefore immediate and deterministic (tests can assert it), and the watcher stays the safety net for external
changes. A double refresh within the debounce window is cheap (status + refs + first log page).

## D-019 · accepted · 2026-10-16 — Hunk/line staging: the backend rebuilds the patch, the UI only names the selection
Decision: the UI sends `{ target, hunkIndex, hunkHeader, lines? }`; `git-core::ops::patch` re-runs the file diff,
checks that the hunk header still matches (else `stage.stale`), builds a minimal unified patch in Rust (unselected
`+` lines dropped, unselected `-` lines turned into context, counts recomputed) and applies it with
`git apply --cached [-R] --recount` (stage/unstage) or `git apply -R --recount` (discard in the work tree). No patch
text crosses IPC, so the patch builder is unit-tested in Rust and the UI never shapes git input. Whole-file
stage/unstage/discard use `add`/`restore --staged`/`restore` + `clean -f` for untracked files.

## D-020 · accepted · 2026-10-16 — Interactive-lite rebase through a prepared todo file
Decision: `rebase_interactive` writes the todo list (pick/reword/squash/fixup/drop + reorder) that the UI chose to a
temp file and runs `git rebase -i <onto>` with `GIT_SEQUENCE_EDITOR="cp '<todo as forward-slash path>'"` (git appends
the todo path; `cp` exists in git's own `sh` on Windows and in coreutils on Linux). Paths containing `'` are rejected
with `arg.invalid`. `reword` is not offered (it needs `GIT_EDITOR`); users amend after the rebase instead. Conflicts
surface as `GitErrorKind::Conflict` and the normal abort/continue flow takes over.

## D-021 · accepted · 2026-10-16 — Undo = reflog step back with `reset --keep`
Decision: "Undo last operation" reads `git reflog show HEAD -n 2` (NUL/0x1f format), shows the subject of `HEAD@{0}`
and, when confirmed, runs `git reset --keep HEAD@{1}` on a branch (`--soft` when the entry is a plain `commit:` /
`commit (amend):`, so the undone commit's changes stay staged), or `git switch <from>` when the last entry is a
`checkout: moving from A to B`. `--keep` refuses to clobber local changes, so undo is never destructive. The reset target is the current branch's own
reflog entry {1}, taken only when the branch's latest entry is the same movement as `HEAD@{0}` (same oid and subject,
or both `rebase (finish)`), so `git stash` (which only writes `reset: moving to HEAD` on HEAD) leaves nothing to undo. Detached HEAD
or a reflog with one entry disables the action. Branch deletion is undone separately by the delete dialog, which
reports the deleted tip oid for `branch -c`.

## D-022 · accepted · 2026-10-16 — In-progress operation state read from the git dir, external editor via config
Decision: `ops::state::in_progress(info)` inspects `git_dir` for `MERGE_HEAD`, `CHERRY_PICK_HEAD`, `REVERT_HEAD`,
`rebase-merge/`, `rebase-apply/` (no git spawn) and reports `{ kind, headName?, onto?, done, total }`; the UI polls it
with `repo_status` on `head`/`index` changes and shows a conflict banner with abort/continue. "Open in external
editor" spawns `core.editor` / `$VISUAL` / `$EDITOR` (shell-word split, no shell) with the file inside the work tree, and
falls back to revealing the file in the file manager (never the OS default handler, which could run a tracked script)
until settings (6.3) add an editor path.

## D-023 · accepted · 2026-10-16 — Graph visual language follows GitKraken's three-column layout; avatars are offline
Context: the owner wants the GitKraken look (refs column, graph with avatars, message column, dark theme).
Decision: item 2.10 restyles the graph only in the frontend: a `BRANCH / TAG` column (fixed width token
`--graph-refs-w`), the lane strip, and the message column, each row 36 px (`--graph-row-h`). Avatars are initials on a
colour derived from the author email hash, drawn in the SVG (no network): Gravatar stays a future opt-in setting because
fetching avatars leaks author emails to a third party by default. The grey "description" text GitKraken shows after the
subject is not added yet: it needs the commit body in the log format and would grow the 100k-commit payload; revisit
with the first page only. Dark becomes the default theme; light stays available.

## D-024 · accepted · 2026-10-16 — Askpass bridge: one keyring entry per host, the app binary answers git itself
Context: item 3.2 needs `git` over HTTPS to use the token the app stores (5.1) without the user's own credential
helper, and without a second binary in the bundle.
Decision: `github-api::token` owns the keyring access (service `GitBranch`, account `github.com`; the GitHub login
is stored next to it as account `github.com#login`, so the askpass answer does not need the API). The Tauri binary
started by git as its `GIT_ASKPASS` program runs no UI: it answers `x-access-token` to `Username for 'https://github.com'`
and the keyring token to the matching `Password for` prompt, and exits 1 for any other host or when no token is stored;
with `GIT_TERMINAL_PROMPT=0` that ends in `AuthRequired`, which the UI reports. `GIT_ASKPASS` points at the current executable on network calls (the runner already
sets `GIT_TERMINAL_PROMPT=0` and `SSH_ASKPASS_REQUIRE=never`, so SSH stays with the system agent). git consults
`credential.helper` before the askpass program; a user with Git Credential Manager already holding a github.com
credential keeps using it, which is acceptable until settings (6.3) add a "prefer the app token" switch.
Consequences: `keyring` 3 with `windows-native` and `sync-secret-service` (needs `libdbus-1-dev` on the Ubuntu CI
runner); the prompt parser is a pure function with unit tests; the token never appears in logs or `GitError`; askpass env only on network calls so hooks run by commit/merge/rebase cannot query it.

Amendment 2026-10-16 (D-024): git passes the prompt as the only argument, so the askpass mode is selected by the `GITBRANCH_ASKPASS=1` env var the runner sets plus a prompt-shaped argument, not by a `--askpass` flag.

## D-025 · accepted · 2026-10-19 — Worktree listing uses `git worktree list --porcelain` without `-z`
Context: `-z` for `worktree list` needs git 2.36; `MIN_GIT_VERSION` is 2.31 and Ubuntu 22.04 ships 2.34.
Decision: parse the line-oriented `--porcelain` output (records separated by a blank line). Lock/prune reasons
with unusual characters arrive C-quoted (core.quotePath style) and are unquoted by the parser; paths are not quoted
by git in this mode, so a path containing a newline is the one unsupported case. Unknown attribute keywords are
ignored so newer git versions do not break the list.
Consequences: a pure parser with unit tests on captured samples; revisit `-z` when the floor rises to 2.36.

## D-026 · accepted · 2026-10-19 — Worktrees: left sidebar, header tabs, chip on the checked-out commit
Context: Phase 4 asks for a sidebar section, one tab per worktree and graph highlighting; the app so far has no
sidebar (branches are graph chips, remotes a dialog, submodules a WIP-pane section) and no tab bar, while the repo
store already keeps several open repositories with one current id.
Decision: (1) a collapsible left sidebar (`src/features/sidebar/`) whose first section is Worktrees; other
sections (branches, remotes, tags, stashes) may move there in Phase 6. (2) The header shows one tab per open
repository; opening a worktree from the sidebar opens it as its own tab without the D-015 main/worktree prompt
(the user chose the worktree explicitly). Each tab is a separately opened repository (own watcher, own WIP row
and HEAD); "sharing the object graph" means the same object store on disk, not a shared in-memory log. (3) The
graph shows a worktree chip on the commit each linked worktree has checked out; a branch chip checked out in
another worktree is not restyled. (4) The watcher emits a new `worktrees` change for `.git/worktrees/*` of other
checkouts; a commit made in a linked worktree reaches the main tab through the shared `refs` directory already.
Consequences: `Change::Worktrees` on both sides of the IPC; the worktree list is reloaded on `worktrees` and
`head` changes; `remove` without force fails on dirty or locked worktrees and the UI offers the forced retry.

## D-027 · accepted · 2026-10-19 — GitHub client: transport trait over `reqwest` (rustls), two-command login
Context: item 5.1 adds the first network code outside git. The crate must be testable offline (no OAuth app in CI),
must not pull OpenSSL on Linux, and the UI needs a simple way to drive the Device Flow (show code, wait, cancel).
Decision: (1) `github-api::http::Transport` is the only seam: `ReqwestTransport` in the app (reqwest 0.13 with the
`rustls` default TLS, already in the lock file through tauri) and `MockTransport` (feature `mock`) in tests, with
tokio paused time for the polling loop. (2) One `GitHub<T>` client with a single private `request()` where 401/404/
rate-limit mapping and, later, ETag caching (5.7) live. (3) The login is two commands: `github_login_start` returns
the user code and spawns the poll task; `github_login_wait` awaits it; `github_login_cancel` aborts. No events.
(4) `github_account` with a stored token but no network returns the keyring login with `offline: true`; a 401
deletes the stored token (revoked or expired) and reports "signed out". (5) The revoke page URL is built in the UI
from a mirrored client id constant; the id is public (D-004).
Consequences: the `device_code` is never serialized or logged; the token only crosses the keyring and the
`Authorization` header; `workflow` scope is a checkbox at login (D-005), re-authorizing replaces the token.

## D-028 · accepted · 2026-10-19 — Pull requests: repo slug from the remote URL, checkout like `gh pr checkout`
Context: items 5.4–5.6 need to know which GitHub repository a local repo maps to, and how "checkout PR" behaves for
same-repo and fork PRs.
Decision: (1) The slug (owner/name) is parsed in `github-api` from the remote URL (https, ssh and scp-like forms of
github.com); `origin` wins, else the first github.com remote; no match means the PR features stay hidden. (2)
Checkout of a same-repository PR fetches the remote and checks out a local branch named after the head ref, tracking
`<remote>/<head>` (an existing local branch of that name is reused, not reset). A fork PR fetches
`+refs/pull/N/head:refs/remotes/<remote>/pr/N` and checks out a local branch `pr/N` at it without upstream. The
sequence is one git-core op (`ops::pull_request::checkout_pr`) tested on a fixture pair of repositories. (3) PR
lists are read-only summaries (open/closed/all from the API; "mine" filtered in the UI by the signed-in login);
detail fetches the PR, its reviews, and the head commit's check runs + combined status, in that order. (4) PR body
is shown as plain text in Phase 5; markdown rendering is a Phase 6 polish item.
Consequences: `FetchArgs` gains `refspecs`; `github_repo_slug`, `github_pulls`, `github_pull`, `github_checkout_pull`
Tauri commands; the checks summary type is shared with the graph decorations of 5.6.

Amendment 2026-10-19: the fork PR head is fetched to `refs/pull/<remote>/N` (not `refs/remotes/<remote>/pr/N`), so
`fetch --prune` cannot delete it and a real remote branch `pr/N` cannot collide; local `pr/N` is created from it.
Checkout never relies on `branch.autoSetupMerge`: same-repo uses `switch --track`, forks `switch --no-track`.
