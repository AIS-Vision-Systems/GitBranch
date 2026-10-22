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
- Node 24 + pnpm via `corepack enable --install-directory %LOCALAPPDATA%\pnpm` (pinned by `packageManager`; done)
- Windows: WebView2 runtime (ships with Win 11), MSVC build tools (present, Rust works).
- Linux: `libwebkit2gtk-4.1-dev build-essential libssl-dev libayatana-appindicator3-dev librsvg2-dev` (CI only until a Linux box is available).
- A GitHub **OAuth App** registered by the owner with *Device Flow* enabled (done 2026-10-16; `client_id` in `crates/github-api/src/auth.rs`). See DECISIONS.md D-004.

## Phases

Each phase is developed on a branch `phase/N` cut from `main` (D-014). It ends with: all its acceptance checks green,
`cargo clippy -- -D warnings`, `cargo test` and `pnpm test` green, PLAN.md checkboxes updated, a short note in
`docs/CHANGELOG.md`, a `--no-ff` merge into `main` tagged `phase-N`, and the branch deleted.

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

- [x] 1.1 Open/recent repos (native dialog, persisted list, detect worktree and open main repo).
- [x] 1.2 `git-core::refs`: `for-each-ref` parser (local, remote, tags, HEAD, upstream + ahead/behind).
- [x] 1.3 `git-core::log`: streaming `git log --all --date-order --format=<NUL-separated>` parser to `Commit {oid, parents, author, time, subject}`. Paginated (first 2k rows, then chunks).
- [x] 1.4 `git-core::graph`: lane allocation (see ARCHITECTURE.md, Graph). Output per row: lane, color index, incoming/outgoing edge segments. Property tests with fixture repos; perf test with 100k synthetic commits.
- [x] 1.5 Status: `git status --porcelain=v2 -z` parser (staged/unstaged/untracked/conflicted, renames). Shown as a virtual "WIP" row on top of the graph.
- [x] 1.6 Graph UI: virtualized rows (`@tanstack/react-virtual`), SVG lane strip per row, ref chips, hover/selection, keyboard navigation. Stable colors per lane.
- [x] 1.7 Commit details panel: metadata + changed files (`git show --name-status -z`).
- [x] 1.8 Diff viewer: unified/side-by-side, light syntax coloring (no Monaco), from `git diff -p` parsed in Rust into hunks.
- [x] 1.9 Auto-refresh: `notify` watcher on `.git/{HEAD,refs,index,packed-refs,logs}` + working tree (debounced), incremental reload.
- [x] 1.10 Perf pass against a big repo (a clone of `git/git`, about 75k commits).

Acceptance: targets table met on the big repo; graph topology matches `git log --graph --all` on all fixtures.

### Phase 2 — Local operations
- [x] 2.1 Stage/unstage/discard per file; per-hunk and per-line via generated patches and `git apply --cached [-R]`.
- [x] 2.2 Commit, amend, sign-off, message template. "Commit and push" disabled until Phase 3.
- [x] 2.3 Branches: create (from any commit), checkout, rename, delete (safe + force), set upstream.
- [x] 2.4 Stash: push (with message, include untracked), list, apply, pop, drop, show diff.
- [x] 2.5 Merge (ff/no-ff/squash), rebase onto, interactive-lite rebase (reorder/squash/drop via a `GIT_SEQUENCE_EDITOR` script), abort/continue.
- [x] 2.6 Reset (soft/mixed/hard with confirm), revert, cherry-pick, tags (lightweight + annotated).
- [x] 2.7 Conflict UI: list conflicted files, take ours/theirs, open in external editor, mark resolved.
- [x] 2.8 Graph context menus + drag-and-drop (branch onto branch opens a merge/rebase picker).
- [x] 2.9 Undo for destructive ops where git allows (reflog-based "undo last operation").
- [x] 2.10 Graph look and feel (GitKraken-style): three columns (BRANCH / TAG · GRAPH · COMMIT MESSAGE) with a column header, ref chips in their own column with local/remote/tag icons and a `+N` collapse, filled nodes with initials avatars, rounded lane curves, full-row hover/selection, dark theme as primary. Owner request 2026-10-16.

Acceptance: every op has a `git-core` test on fixtures; the UI never calls `git` directly, only typed commands.

### Phase 3 — Remotes and credentials
- [x] 3.1 Remote list/add/remove/rename; fetch (all/one, prune), pull (ff-only / rebase / merge per config), push (set-upstream, tags, `--force-with-lease` only).
- [x] 3.2 Askpass bridge: the app binary, invoked by git as `GIT_ASKPASS` (selected by the `GITBRANCH_ASKPASS` env flag), returns the stored GitHub token for `https://github.com` prompts; `GIT_ASKPASS` + `GIT_TERMINAL_PROMPT=0` on every spawn. SSH remotes pass through to the system agent.
- [x] 3.3 Progress reporting (`--progress` stderr parser) to a UI progress bar; cancel kills the child process group.
- [x] 3.4 Clone dialog (URL, or GitHub picker from Phase 5), shallow/branch options.
- [x] 3.5 Submodule awareness (status only; no management UI yet).

Acceptance: fetch/pull/push against a private GitHub repo over HTTPS using only the app's own token; SSH push works unchanged.

### Phase 4 — Worktrees
- [x] 4.1 `git worktree list --porcelain` parser; sidebar section with branch, path, locked/prunable state.
- [x] 4.2 Add worktree (new or existing branch, path picker with default `../<repo>.<branch>`), remove (safe/force), prune, lock/unlock.
- [x] 4.3 Each worktree opens as its own tab sharing the object graph; WIP row and HEAD per tab.
- [x] 4.4 Graph highlights which commits are checked out in which worktree.

Acceptance: create, commit in worktree, see it in the main tab graph without manual refresh, remove.

### Phase 5 — GitHub integration (OAuth App)
- [x] 5.1 Device Flow login (`github-api::auth`): request code, show user code + open browser, poll, store token with `keyring` (Windows Credential Manager / Secret Service). Scopes: `repo`, `read:org`; `workflow` optional toggle.
- [x] 5.2 Account panel: user, scopes, logout (delete local token; link to GitHub revoke page).
- [x] 5.3 Repo picker: list user/org repos (private included), clone from picker.
- [x] 5.4 Pull requests: list for current repo (open/closed/mine), detail (title, body, checks, reviews summary), checkout PR head (`refs/pull/N/head`), open in browser.
- [x] 5.5 Create PR from current branch: base/head picker, title/body (prefilled from commits), draft flag; push first if needed.
- [x] 5.6 Graph decorations: PR badge on branch tips, check-status dot.
- [x] 5.7 Rate-limit + offline handling; ETag caching for lists.
- [x] 5.8 GitKraken parity from the owner's Phase 5 test: (a) WIP panel with Staged above Unstaged, each as a
  directory tree; (b) clicking a file shows its diff in the center pane, toggled off by Esc or clicking the same file
  again; (c) double-click on a branch chip checks it out.
- [x] 5.9 GitKraken parity, round 2: (a) split diff with a fixed divider, independent scrollbars per side
  (vertical scroll kept in sync) and a change-overview ruler at the right edge; (b) commit file list in tree mode
  with per-folder modified/added/deleted counts, Expand/Collapse all, header summary ("N modified + M added").
- [x] 5.10 GitKraken parity, round 3: (a) change ruler twice as thick, clearer viewport indicator, visible Wrap
  toggle; (b) session restore: window state (maximized/size/position via tauri-plugin-window-state), right-pane
  width, open repository tabs and the selected one (session.json next to recent.json); (c) a "+" tab at the right
  of the repo tabs opens the welcome screen (Open / Clone / Clone from GitHub / recent).

Acceptance: login, clone private repo, branch, push, create PR, see it on the graph, all inside the app.

### Phase 6 — Polish and distribution
- [x] 6.1 Multi-repo tabs, command palette (Ctrl+K), commit search/filter (author, message, path).
- [x] 6.2 Blame view (`git blame --porcelain`), file history.
- [x] 6.3 Settings: git path override, default pull strategy, diff options, theme, external editor/difftool.
- [x] 6.4 Installer polish: NSIS (per-user), .deb + AppImage, icons.
- [x] 6.5 Auto-update via `tauri-plugin-updater` + `tauri-plugin-process`: startup + daily check, toast with "Update and restart", progress, opt-out setting; release workflow publishes signed bundles + `latest.json` (D-006). Needs the owner's keypair (see D-006).
- [x] 6.6 Telemetry: **none**. Local log file only.
- [x] 6.7 Single instance (`tauri-plugin-single-instance`): a second launch focuses the running window and opens
  the repo passed on its command line as a new tab.
- [x] 6.8 Clone dialog: when coming from the GitHub picker, offer the default branch and a branch list
  (`git ls-remote --heads`) instead of a free-text field.

### Phase 7 — Phase 6 review fixes
Goal: close the findings of the 2026-10-22 read-only review of `phase-5..phase-6` (all checks were green, two
real bugs). Owner decisions for Phases 7–9 are in D-030.

- [x] 7.1 Difftool/editor commands: append `"$LOCAL" "$REMOTE"` to the difftool setting when absent and fix the
  Settings placeholder; new pure `resolve_program()` in `git-core::ops::config` (Windows `PATHEXT` lookup) so
  `code` resolves to `code.cmd` in `open_in_editor` and the difftool path.
- [x] 7.2 Filter bar resync: an open `FilterBar` follows store changes, so "File history" from the file menu fills
  the Path field instead of being wiped by the next keystroke.
- [x] 7.3 `isEditableTarget()` in `src/lib/keys.ts` (dedupe the copies in `App.tsx`/`Toolbar.tsx`); Ctrl+F no
  longer fires inside text fields.
- [x] 7.4 Updater: a failed manual check keeps the card (error + Retry); the scheduler waits for settings `loaded`
  instead of a 5 s guess; a failed install is not overwritten by the hourly check.
- [x] 7.5 Filtered graph paging: cache filtered pages like the unfiltered log (key = order/all/author/message/path)
  instead of re-running `git log` from commit 0 on every "load more".
- [x] 7.6 Difftool empty-tree fallback via `git hash-object -t tree --stdin` (SHA-256 safe); no `rev-parse` when
  `staged`.
- [x] 7.7 Virtualise `BlameView` rows (`@tanstack/react-virtual`, same pattern as the graph).
- [x] 7.8 Docs drift: ARCHITECTURE sections for settings, updater, log file, single instance, blame; CHANGELOG
  installer size; 6.8 wording ("any URL"); note that file history has no `--follow`.
- [x] 7.9 Pin `.github/workflows/release.yml` actions to commit SHAs.

Acceptance: check ladder green; `code` as editor opens a conflicted file on Windows; `meld` as difftool receives
both files; "File history" with the bar already open shows the path.

### Phase 8 — Window chrome: tab row, ribbon, account, about (GitKraken parity, round 4a)
Goal: the top of the window matches the owner's reference: a tab row with only tabs + help + settings + account,
an action ribbon under it, a GitKraken-style account panel and a Quasidian-style help/credits window.

- [x] 8.0 `lucide-react` (named imports only, eslint rule against deep imports, one re-export file); dual license
  (PolyForm Noncommercial 1.0.0 + commercial, `LICENSE.md` / `LICENSE-COMMERCIAL.md`, metadata in package.json,
  Cargo.toml, tauri.conf.json, README).
- [ ] 8.1 Tab row: 44 px, 15 px font, repo/worktree lucide icon per tab, 1 px vertical separators, close × only
  on hover/active, "+" tab; right side = help, settings gear, account. Theme button removed (selector already in
  Settings); Sidebar button removed, state in `useUiStore` (Ctrl+B, palette, ribbon overflow, sidebar chevron).
- [ ] 8.2 About dialog (help button, palette): logo, name, version, "Idea and original development: Xavi Anguera",
  license line (opens LICENSE), "Check for updates" (shared `UpdateCheck` with Settings), AIS Vision Systems logo
  (white/blue per theme) + "An app by AIS Vision Systems", scrollable user guide from `src/help/guide.en.md`
  rendered by a small in-house markdown subset renderer (`src/lib/markdown.ts`, no innerHTML).
- [ ] 8.3 Ribbon (replaces the toolbar): left = repository dropdown › branch dropdown (ahead/behind, checkout);
  centre = Undo, Redo, Fetch (caret: fetch all / pull ff / pull rebase / pull merge / prune), Push, Branch, Stash,
  Pop, Terminal; right = Actions overflow (Clone, Remotes, Stashes popover, Toggle sidebar, Settings) and Search.
  Redo = re-apply the HEAD recorded before the last Undo (git-core `apply_action`, cleared when HEAD moves).
  Terminal = `open_terminal` command spawning an external terminal at the work tree (settings override, then
  `wt.exe` / `cmd.exe` on Windows, `$TERMINAL` / `x-terminal-emulator` / gnome-terminal / konsole / xterm on
  Linux), argv only, modelled on `open_in_editor`.
- [ ] 8.4 Account panel: real GitHub avatar (fetched by the backend to a data URL, cached), login; "Commit
  signature" = effective `user.name`/`user.email` for the current repo, editable globally or per repo
  (`git-core::ops::config::{identity,set_identity}`); "Account" = name, email, scopes, rate limit; Manage account,
  Re-authorize, Sign out, Revoke.
- [ ] 8.5 Docs: ARCHITECTURE (shell layout, ribbon, about, terminal, avatar cache), CHANGELOG demo note.

Acceptance: the top row shows only tabs + help + gear + account; every former toolbar action is reachable from
the ribbon or its overflow; Terminal opens at the work tree on Windows; installer still < 25 MB.

### Phase 9 — Side panels: sidebar and commit details (GitKraken parity, round 4b)
Goal: a GitKraken-style left sidebar (LOCAL / REMOTE / WORKTREES / PULL REQUESTS) and a details pane whose
header stays put while the file tree scrolls.

- [ ] 9.1 Co-authors in git-core: `Co-authored-by:` trailers parsed from `git show` (`%(trailers:...)`), exposed
  as `coAuthors` on the commit details, stripped from the displayed body. Needs git >= 2.22 (version probe note).
- [ ] 9.2 Author avatars (amends D-023): GitHub photo for known authors only (the signed-in user's commits and
  `@users.noreply.github.com` emails → login → `github.com/<login>.png`, backend fetch + disk cache, negative
  cache); initials for everyone else; graph nodes stay initials.
- [ ] 9.3 Details pane layout: fixed header (oid + Copy; message in a bordered box with its own scroll, max 40 %
  of the pane; 40 px avatar, name, "authored <date>", parents at the right; "Co-authors:" avatar chips; summary +
  Path/Tree toggle + Expand all); the file tree below scrolls independently, rows ~22 px, 10 px indent per level.
- [ ] 9.4 Branch tree model (pure TS): folders by `/`, folders first, case-insensitive filter with auto-expand;
  remotes grouped per remote.
- [ ] 9.5 Sidebar UI: filter box; collapsible sections with lucide icon, uppercase title and count: LOCAL, REMOTE
  (one sub-tree per remote, "Add remote…" header action), WORKTREES, PULL REQUESTS; branch rows with a check on
  HEAD and ↑↓ badges; click selects the commit, hover highlights it, double-click checks out, right-click opens the
  existing ref context menu.
- [ ] 9.6 Sidebar resize and collapse: draggable width (shared `Splitter`, persisted with the session); collapse
  chevron in the panel's own top bar; collapsed state is a 36 px icon rail with one icon + count per section,
  clicking an icon expands and scrolls to that section.
- [ ] 9.7 Docs: ARCHITECTURE (sidebar, details layout, co-authors, avatar source), CHANGELOG demo note.

Acceptance: four sections with counts and a working filter; drag to resize and collapse to the rail from the
panel; double-click checks out; the details header never scrolls away while the file list does; a commit with
`Co-authored-by:` trailers shows chips and a body without the trailer lines.

## Out of scope (explicitly)
GitLab/Bitbucket/Azure, integrated terminal (an external terminal launcher is Phase 8), AI features, cloud workspaces, issue trackers, LFS management UI, GPG key management (signing uses the user's existing git config).

## Risks

| Risk | Mitigation |
|---|---|
| Graph layout correctness on exotic histories (octopus, orphans, replace refs) | fixture repos for each case from Phase 0; compare against `git log --graph` topology in tests |
| WebView rendering perf with 100k SVG rows | virtualization from day 1; fall back to canvas per row if SVG measures > 4 ms/row |
| Linux cannot be tested locally yet | CI builds + screenshots on the ubuntu runner; WSLg for manual checks |
| Device Flow disabled on the OAuth App | documented checklist in D-004; app shows a clear error with the fix |
| `git` version drift on the user machine | probe `git --version` at startup, degrade features with a notice |
