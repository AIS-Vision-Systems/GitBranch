# GitBranch — Development Plan

Lightweight desktop Git client (Windows + Linux) with a first-class commit graph, GitHub-only remote
integration (private repos included) and git worktrees. Zero dependency on GitKraken or any third-party
Git GUI. Written in Rust (Tauri 2) + TypeScript (React).

Status legend: `[ ]` todo · `[~]` in progress · `[x]` done · `[?]` blocked on a user decision (see DECISIONS.md).

## Targets

| Metric | Target | Why |
|---|---|---|
| Installer size | < 25 MB (Win NSIS, Linux AppImage/.deb) | GitKraken is 1.3 GB on disk |
| Cold start to first graph paint (50k commits) | < 1.5 s | the graph is the product |
| Graph layout, 100k commits (Rust) | < 300 ms | keeps scrolling/refresh instant |
| Idle RAM | < 150 MB | WebView2 / WebKitGTK only, no Chromium bundle |
| External runtime deps | system `git` >= 2.31 (worktree + optional locks) | we never bundle git |

## Prerequisites (one-time, Phase 0 installs them)

- Rust stable (1.97) + `rustup component add rustfmt clippy` (done)
- Tauri CLI: `@tauri-apps/cli` devDependency, run as `pnpm tauri` (see D-010; done)
- Node 24 + pnpm (`npm install -g pnpm`, pinned by `packageManager`; done)
- Windows: WebView2 runtime (ships with Win 11), MSVC build tools (present, Rust works).
- Linux: `libwebkit2gtk-4.1-dev build-essential libssl-dev libayatana-appindicator3-dev librsvg2-dev` (CI only until a Linux box is available).
- A GitHub **OAuth App** registered by the owner with *Device Flow* enabled (needed from Phase 5). Only the public `client_id` is embedded. See DECISIONS.md D-004.

## Phases

Each phase ends with: all its acceptance checks green, `cargo clippy -- -D warnings`, `cargo test` and `pnpm test` green,
a tagged commit `phase-N`, PLAN.md checkboxes updated, and a short note in `docs/CHANGELOG.md`.

### Phase 0 — Skeleton and toolchain
Goal: an empty window that opens, builds on both OSes in CI, with the Rust/TS layering in place.

- [x] 0.1 Install toolchain (rustfmt, clippy, tauri-cli, pnpm). Record versions in `docs/CHANGELOG.md`.
- [x] 0.2 `pnpm create tauri-app` (React + TS + Vite, pnpm). App id `ai.rosepetal.gitbranch`, product name `GitBranch`.
- [x] 0.3 Cargo workspace: `src-tauri` (thin commands) + `crates/git-core` (no Tauri dependency) + `crates/github-api`.
- [x] 0.4 `git-core::runner`: spawn `git` with fixed env (`GIT_TERMINAL_PROMPT=0`, `LC_ALL=C`, `GIT_OPTIONAL_LOCKS=0`), timeout, stdout/stderr capture, typed `GitError`.
- [x] 0.5 Test fixture helper: build throwaway repos with `git` in a temp dir (linear, merge, octopus, orphan, tags, stash). Used by every later phase.
- [x] 0.6 Frontend scaffolding: Zustand store, typed `invoke` wrappers in `src/ipc/`, error toast, dark/light theme tokens.
- [x] 0.7 CI: GitHub Actions matrix (windows-latest, ubuntu-22.04): clippy, test, `tauri build`, upload artifacts.
- [x] 0.8 Lint/format: rustfmt.toml, clippy pedantic subset, prettier + eslint (flat config), `pnpm check` runs all.

Acceptance: `pnpm tauri dev` opens a window on Windows; CI green on both OSes; installer artifact < 25 MB.

### Phase 1 — Open repo and read-only commit graph (validates the core value first)
Goal: open a local repo, see the full graph with refs, select a commit, see its files.

- [ ] 1.1 Open/recent repos (native dialog, persisted list, detect worktree and open main repo).
- [ ] 1.2 `git-core::refs`: `for-each-ref` parser (local, remote, tags, HEAD, upstream + ahead/behind).
- [ ] 1.3 `git-core::log`: streaming `git log --all --date-order --format=<NUL-separated>` parser to `Commit {oid, parents, author, time, subject}`. Paginated (first 2k rows, then chunks).
- [ ] 1.4 `git-core::graph`: lane allocation (see ARCHITECTURE.md, Graph). Output per row: lane, color index, incoming/outgoing edge segments. Property tests with fixture repos; perf test with 100k synthetic commits.
- [ ] 1.5 Status: `git status --porcelain=v2 -z` parser (staged/unstaged/untracked/conflicted, renames). Shown as a virtual "WIP" row on top of the graph.
- [ ] 1.6 Graph UI: virtualized rows (`@tanstack/react-virtual`), SVG lane strip per row, ref chips, hover/selection, keyboard navigation. Stable colors per lane.
- [ ] 1.7 Commit details panel: metadata + changed files (`git show --name-status -z`).
- [ ] 1.8 Diff viewer: unified/side-by-side, light syntax coloring (no Monaco), from `git diff -p` parsed in Rust into hunks.
- [ ] 1.9 Auto-refresh: `notify` watcher on `.git/{HEAD,refs,index,packed-refs,logs}` + working tree (debounced), incremental reload.
- [ ] 1.10 Perf pass against a big repo (a clone of `git/git`, about 75k commits).

Acceptance: targets table met on the big repo; graph topology matches `git log --graph --all` on all fixtures.

### Phase 2 — Local operations
- [ ] 2.1 Stage/unstage/discard per file; per-hunk and per-line via generated patches and `git apply --cached [-R]`.
- [ ] 2.2 Commit, amend, sign-off, message template. "Commit and push" disabled until Phase 3.
- [ ] 2.3 Branches: create (from any commit), checkout, rename, delete (safe + force), set upstream.
- [ ] 2.4 Stash: push (with message, include untracked), list, apply, pop, drop, show diff.
- [ ] 2.5 Merge (ff/no-ff/squash), rebase onto, interactive-lite rebase (reorder/squash/drop via a `GIT_SEQUENCE_EDITOR` script), abort/continue.
- [ ] 2.6 Reset (soft/mixed/hard with confirm), revert, cherry-pick, tags (lightweight + annotated).
- [ ] 2.7 Conflict UI: list conflicted files, take ours/theirs, open in external editor, mark resolved.
- [ ] 2.8 Graph context menus + drag-and-drop (branch onto branch opens a merge/rebase picker).
- [ ] 2.9 Undo for destructive ops where git allows (reflog-based "undo last operation").

Acceptance: every op has a `git-core` test on fixtures; the UI never calls `git` directly, only typed commands.

### Phase 3 — Remotes and credentials
- [ ] 3.1 Remote list/add/remove/rename; fetch (all/one, prune), pull (ff-only / rebase / merge per config), push (set-upstream, tags, `--force-with-lease` only).
- [ ] 3.2 Askpass bridge: the app binary run with `--askpass` returns the stored GitHub token for `https://github.com` prompts; `GIT_ASKPASS` + `GIT_TERMINAL_PROMPT=0` on every spawn. SSH remotes pass through to the system agent.
- [ ] 3.3 Progress reporting (`--progress` stderr parser) to a UI progress bar; cancel kills the child process group.
- [ ] 3.4 Clone dialog (URL, or GitHub picker from Phase 5), shallow/branch options.
- [ ] 3.5 Submodule awareness (status only; no management UI yet).

Acceptance: fetch/pull/push against a private GitHub repo over HTTPS using only the app's own token; SSH push works unchanged.

### Phase 4 — Worktrees
- [ ] 4.1 `git worktree list --porcelain` parser; sidebar section with branch, path, locked/prunable state.
- [ ] 4.2 Add worktree (new or existing branch, path picker with default `../<repo>.<branch>`), remove (safe/force), prune, lock/unlock.
- [ ] 4.3 Each worktree opens as its own tab sharing the object graph; WIP row and HEAD per tab.
- [ ] 4.4 Graph highlights which commits are checked out in which worktree.

Acceptance: create, commit in worktree, see it in the main tab graph without manual refresh, remove.

### Phase 5 — GitHub integration (OAuth App)
- [ ] 5.1 Device Flow login (`github-api::auth`): request code, show user code + open browser, poll, store token with `keyring` (Windows Credential Manager / Secret Service). Scopes: `repo`, `read:org`; `workflow` optional toggle.
- [ ] 5.2 Account panel: user, scopes, logout (delete local token; link to GitHub revoke page).
- [ ] 5.3 Repo picker: list user/org repos (private included), clone from picker.
- [ ] 5.4 Pull requests: list for current repo (open/closed/mine), detail (title, body, checks, reviews summary), checkout PR head (`refs/pull/N/head`), open in browser.
- [ ] 5.5 Create PR from current branch: base/head picker, title/body (prefilled from commits), draft flag; push first if needed.
- [ ] 5.6 Graph decorations: PR badge on branch tips, check-status dot.
- [ ] 5.7 Rate-limit + offline handling; ETag caching for lists.

Acceptance: login, clone private repo, branch, push, create PR, see it on the graph, all inside the app.

### Phase 6 — Polish and distribution
- [ ] 6.1 Multi-repo tabs, command palette (Ctrl+K), commit search/filter (author, message, path).
- [ ] 6.2 Blame view (`git blame --porcelain`), file history.
- [ ] 6.3 Settings: git path override, default pull strategy, diff options, theme, external editor/difftool.
- [ ] 6.4 Installer polish: NSIS (per-user), .deb + AppImage, icons.
- [ ] 6.5 Optional auto-update via `tauri-plugin-updater` signed with our own key (decision D-006).
- [ ] 6.6 Telemetry: **none**. Local log file only.

## Out of scope (explicitly)
GitLab/Bitbucket/Azure, integrated terminal, AI features, cloud workspaces, issue trackers, LFS management UI, GPG key management (signing uses the user's existing git config).

## Risks

| Risk | Mitigation |
|---|---|
| Graph layout correctness on exotic histories (octopus, orphans, replace refs) | fixture repos for each case from Phase 0; compare against `git log --graph` topology in tests |
| WebView rendering perf with 100k SVG rows | virtualization from day 1; fall back to canvas per row if SVG measures > 4 ms/row |
| Linux cannot be tested locally yet | CI builds + screenshots on the ubuntu runner; WSLg for manual checks |
| Device Flow disabled on the OAuth App | documented checklist in D-004; app shows a clear error with the fix |
| `git` version drift on the user machine | probe `git --version` at startup, degrade features with a notice |
