# Changelog

## Unreleased

- 2026-10-24: Phase 10 (owner feedback): tabs shrink instead of scrolling, with a searchable "OPEN TABS" dropdown,
  a right-click menu (close / close others / close to the right / alias), persisted repository aliases and drag
  to reorder; a quiet fetch of all remotes whenever a repo is opened or shown; the first row is selected when
  nothing is; double-click on `origin/x` with a local `x` checks it out and pulls; remote menu gains "Open on
  GitHub" and "Copy URL"; 28 px graph rows, thinner message bar, flush chip connectors, ellipsised long chip names,
  PR badge as its own pill; new colour scheme (centre pane and message box `#1c1e23`, ribbon `#202b3b`, side
  panels / headers / tab row `#182130`).
- 2026-10-23: Graph polish: branch chips read check, name, laptop, then one logo per remote holding the branch
  (GitHub owner avatar), left-aligned with a line joining the chip to its commit node; commit nodes show the
  author's GitHub photo when the author is known, now including commits made with the repo's own git
  identity email (D-036).
- 2026-10-23: Sidebar polish from the Phase 9 review: branches and folders sorted together alphabetically, a
  branch / folder icon on every row, the GitHub owner avatar on remote rows, and a remote context menu
  (Edit remote dialog with name, pull and push URLs; copy link; remove). Right-click no longer shows the
  webview menu; the commit file tree starts collapsed and remembers what you expand per commit.
- 2026-10-23: **Phase 9 demo.** (1) Sidebar with LOCAL 4 / REMOTE 3 / WORKTREES 1 on a fixture repo: `feature/`
  folder, check on HEAD, `^1` badge on main; typing `two` in the filter narrows both trees and auto-expands
  `feature` under `origin`. (2) Enter on `hotfix` checks it out (`git branch --show-current` = hotfix); the
  collapse chevron leaves a 36 px rail with counts, the Remote icon reopens the sidebar on that section, and
  dragging the edge persists the width (260 -> 353). (3) Selecting the co-authored commit shows the fixed
  header: short id + Copy, parent at the right, bordered message without the trailer lines, 40 px avatar,
  "authored 2026-10-23 11:13", chips "Ann Example" (initials) and "Octo Cat" (real GitHub photo via the noreply
  email). Installer 3.03 MiB, exe 8.43 MiB; 429 cargo + 656 vitest tests.
- 2026-10-23: Sidebar resize and collapse (item 9.6): drag the sidebar edge (width persisted, shared Splitter),
  collapse chevron in its top bar, collapsed state is a 36 px icon rail with a count per section; clicking a
  rail icon expands the sidebar and scrolls to that section.
- 2026-10-23: Sidebar (items 9.4-9.5): filter box; collapsible LOCAL / REMOTE (one tree per remote, "Add remote..."
  action) / WORKTREES / PULL REQUESTS sections with icon, uppercase title and count; branches as folders by `/`
  with a check on HEAD and ahead/behind badges; click selects the commit, hover highlights it, double-click or
  Enter checks out, right-click or Shift+F10 opens the ref menu; arrow keys walk the tree.
- 2026-10-22: Commit details (items 9.1-9.3): fixed header (short id + Copy, parents at the right, message in a
  bordered box with its own scroll capped at 40 % of the pane, 40 px avatar, "authored <date>", summary + Path/Tree
  + Expand all) above a file list that scrolls on its own (22 px rows, 10 px indent). `Co-authored-by:` trailers
  become avatar chips and leave the body. Known GitHub authors (noreply emails, the signed-in account) get their
  GitHub photo, cached by the backend; everyone else keeps initials.
- 2026-10-22: **Phase 8 demo.** (1) The top row is only tabs (repo/worktree icons, close on hover, `+`) plus Help,
  Settings and the account avatar. (2) The ribbon under it: repository › branch dropdowns, Undo / Redo (checkout
  `feat` → Undo → `main` → Redo → `feat`, verified with git), Fetch caret menu, Push, Branch, Stash, Pop, Terminal
  (Windows Terminal opened at the smoke repo's work tree), More and Search. (3) Help opens the About dialog with
  version, credits, license, Check for updates, AIS branding and the scrollable guide. (4) The account panel shows
  the real avatar, the commit signature (edit → `git config --show-scope` reports the new local value, global
  untouched), account details and the four account actions. Installer 3.02 MiB, 421 cargo + 567 vitest tests.
- 2026-10-22: Account panel (item 8.4): the account button shows the real GitHub avatar (downloaded by the backend
  without the token, cached on disk for a week). The panel shows the **commit signature** (effective `user.name` /
  `user.email` for the current repository with their scope) editable for this repository or globally, the account
  (name, email, scopes, API rate limit) and Manage account, Re-authorize, Sign out, Revoke on GitHub.
- 2026-10-22: Ribbon under the tab row replaces the toolbar (item 8.3): repository › branch dropdowns (ahead/behind,
  checkout), Undo / **Redo** (Ctrl+Y, re-applies the HEAD recorded before the last Undo until HEAD moves), Fetch
  with a caret menu (fetch all, pull fast-forward / rebase / merge, prune), Push, Branch, Stash, Pop, **Terminal**
  (opens Windows Terminal or cmd.exe, `$TERMINAL` / gnome-terminal / konsole / xterm on Linux, at the work tree;
  Settings → Terminal overrides it), an Actions overflow (Clone, Remotes, Stashes, Toggle sidebar, Settings) and
  Search. Fetch all no longer prunes; Prune is its own menu item.
- 2026-10-22: About dialog (help button, palette "About GitBranch", item 8.2): logo, version, credits, license line,
  Check for updates, AIS Vision Systems branding and the bundled English user guide.
- 2026-10-22: Tab row (item 8.1): 44 px tabs with repository / worktree icons, close on hover, `+` tab; the right side
  holds only Help, Settings and the account button. The Theme button moved to Settings; the sidebar toggles with
  Ctrl+B, from the palette or the ribbon overflow.
- 2026-10-22: License is now dual (item 8.0): free for noncommercial use under PolyForm Noncommercial 1.0.0,
  commercial license from AIS Vision Systems (`LICENSE.md`, `LICENSE-COMMERCIAL.md`). Icons come from
  `lucide-react`.
- 2026-10-22: **Phase 7 demo.** (1) Settings → difftool `meld` and editor `code` now work as typed: `$LOCAL`/`$REMOTE` are appended and `code` resolves to `code.cmd` on Windows (no console flash). (2) Right-click a file → File history with the filter bar already open: the Path field fills in. (3) Ctrl+F inside a text field types instead of opening the filter bar. (4) Check for updates with the network off: the card stays with the error and Retry. (5) Filtered graph "load more" is served from the cache; a 10k-line blame scrolls with only the visible rows rendered. Installer 2.9 MiB, 534 vitest + 398 cargo tests green.
- 2026-10-22: **Phase 7 review fixes.** Difftool settings work with a bare program (`meld`): `$LOCAL`/`$REMOTE` are appended when absent and `code` resolves to `code.cmd` on Windows for both the editor and the difftool; the empty-tree base is computed with `git hash-object` (SHA-256 safe). "File history" fills the Path field of an open filter bar; Ctrl+F stays out of text fields. A failed manual update check keeps the card with Retry, the first check waits for settings to load, and a failed install is not hidden by the hourly check. Filtered graph paging reuses the log cache; the blame view virtualises its rows. Release and CI workflow actions are pinned to commit SHAs.
- 2026-10-22: **Phase 6 demo.** (1) Ctrl+K opens the command palette; Ctrl+F filters the graph by author, message or path. (2) Right-click a file → Blame / File history / Open in difftool. (3) Settings (gear, Ctrl+,): git path, pull strategy, diff options, editor, difftool, update opt-out. (4) A second launch focuses the running window and opens its repo as a tab; logs live in a daily file, no telemetry. (5) Clone lists remote branches; per-user NSIS installer is 2.9 MiB; tag `vX.Y.Z` builds a signed draft release with `latest.json`.
- 2026-10-22: Clone dialog lists the remote branches (default first) via `git ls-remote --symref` on the URL typed
  in the dialog, so it works for any URL git can reach with the configured credentials (private GitHub repositories
  through the askpass bridge; never prompts); falls back to a text field when the lookup fails.
- 2026-10-22: single instance (a second launch focuses the window and opens the repo path as a tab); local daily log file (`gitbranch.log`, 7 days, no telemetry) with Settings → Open log folder.
- 2026-10-22: auto-update: startup + daily check, "Update and restart" card with progress, opt-out in Settings, palette "Check for updates"; tag `vX.Y.Z` triggers a draft release with signed bundles + latest.json.
- 2026-10-22: installers: per-user NSIS (2.9 MiB, measured at the Phase 7 build), .deb depends on git, publisher/category/description metadata.
- 2026-10-22: Settings dialog (gear, Ctrl+,): theme, git path (applies after restart), default pull strategy, diff context lines / ignore whitespace, external editor and difftool; "Open in difftool" in the file menu.
- 2026-10-22: blame view (right-click a file → Blame, or the Blame button in the diff header) and file history (right-click → File history filters the graph by path; no `--follow`, so renames are not
  followed).
- 2026-10-22: command palette (Ctrl+K) and commit filter bar (Ctrl+F: author, message, path) on the graph.
- 2026-10-21: GitKraken parity, round 3 (item 5.10): thicker change ruler with a clearer viewport indicator and
  an explicit Wrap button; the app restores its window (size, position, maximized), the right-pane width, the open
  repository tabs and the selected one on the next start (`session.json`); a "+" tab (Ctrl+T) opens the welcome
  screen to open or clone another repository while the current tabs stay open.
- 2026-10-21: GitKraken parity, round 2 (item 5.9): the split diff is two panes with a fixed divider, their own
  scrollbars kept in sync both ways, a Wrap toggle, and a change ruler at the right edge (red marks on the left
  half for deletions, green on the right for additions; click to jump). File lists of a commit and of the working
  tree are directory trees with per-folder modified/added/deleted counts, Expand/Collapse all and a summary line.
- 2026-10-21: GitKraken parity (item 5.8, owner feedback): the working-tree panel always shows Staged files above
  Unstaged files (untracked included) as a directory tree with a Tree/Flat toggle; clicking a file opens its diff in
  the center pane (Esc, the x button or a second click on the file returns to the graph); double-clicking a local or
  remote branch chip checks it out.
- 2026-10-19: GitHub resilience (item 5.7): list calls use ETag caching (304 answers do not count against the
  rate limit); the account menu shows the remaining API budget and a warning dot when offline or rate limited; the
  Pull requests section, repo picker and Create PR dialog show a clear offline / rate-limit / signed-out notice with
  Retry instead of retrying on their own.
- 2026-10-19: Graph decorations (item 5.6): branch chips with an open pull request show a `#N` badge and a
  check-status dot (green/red/yellow); clicking the badge opens the PR. The sidebar list shows the same dot.
  Check runs are fetched in batches and cached for two minutes (20 s while pending).
- 2026-10-19: Create pull request (item 5.5): from the Pull requests header or the current branch menu; base picker
  (default branch preselected), title and description prefilled from the commits, draft flag; the branch is pushed
  first (with upstream) when needed, and the new PR is selected in the sidebar.
- 2026-10-19: Pull requests (item 5.4, D-028): a "Pull requests" sidebar section for GitHub repositories (Open /
  Closed / Mine, draft and merged badges); selecting one shows the detail in the right pane (description, base and
  head, +/- counts, check runs with status dots and links, review summary), with Checkout (same-repo PRs become a
  tracking branch named after the head, fork PRs a local `pr/N` branch) and Open in browser.
- 2026-10-19: GitHub repo picker (item 5.3): "Clone from GitHub..." on the welcome screen and "Pick from GitHub..." in
  the Clone dialog list your own, collaborator and organization repositories (private included) with search,
  owner filter, archived toggle and badges; choosing one prefills the Clone dialog.
- 2026-10-19: GitHub sign-in (Phase 5, items 5.1-5.2, D-027): "Sign in to GitHub" in the header starts the OAuth Device
  Flow (one-time code, Copy, Open github.com, countdown, optional `workflow` scope); the token goes to the OS keyring
  and feeds git over HTTPS through the askpass bridge. The account menu shows name, login, granted scopes, an
  offline marker when GitHub is unreachable, Sign out (removes the local token), Re-authorize and a link to the
  GitHub revoke page.
- 2026-10-19: Worktrees (Phase 4, items 4.1-4.4, D-025/D-026): a collapsible left sidebar with a Worktrees section
  (branch or detached commit, path, main/current/locked/prunable badges), Add worktree dialog (new/existing branch
  or detached, default path `../<repo>.<branch>`, folder picker, force; Ctrl+Shift+W or "Add worktree here..." from
  the commit and branch menus), Remove (confirmed; forced retry for dirty trees; locked ones must be unlocked
  first), Lock with reason / Unlock, Prune. Each worktree opens as its own tab in the header (Ctrl+PageUp/PageDown,
  Ctrl+W) with its own WIP row and HEAD; the graph shows a worktree chip on the commit each other worktree has
  checked out, and a commit made in a linked worktree appears in the main tab without a manual refresh.
- 2026-10-16: Progress and cancel (item 3.3): fetch/pull/push/clone stream git's `--progress` lines to a slim
  progress bar (phase, percentage, last line, elapsed) with Cancel (Esc) that kills the whole git process tree;
  network timeouts are now inactivity-based. Clone dialog (item 3.4): URL, parent folder picker, name, branch,
  shallow depth, submodules; Ctrl+Shift+C from the Welcome screen or the toolbar. Submodule status (item 3.5):
  a Submodules section in the WIP pane (path, state, commit, describe) and a tag on gitlink status entries.
- 2026-10-16: Askpass bridge (item 3.2, D-024): git over HTTPS gets the app's GitHub token from the OS keyring
  through the GitBranch binary itself (`GIT_ASKPASS`, network calls only); strict prompt parsing (https, exact
  `github.com`); SSH remotes keep using the system agent. The token itself is stored by the Phase 5 login.
- 2026-10-16: Remotes (item 3.1): Remotes dialog (list/add/remove/rename), Fetch (all, prune) / Pull (ff-only,
  rebase, merge or the repository default) / Push (set upstream, tags, force-with-lease only) from the toolbar,
  branch chips and shortcuts (Ctrl+Shift+F/L/P); "Commit and push" enabled. Rejected pushes and missing
  credentials get their own toasts; embedded credentials in remote URLs are refused and redacted.
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

### Phase 5 demo (2026-10-19, branch `phase/5`)
- "Sign in to GitHub" in the header runs the OAuth Device Flow of the registered app (D-004): the dialog shows the
  one-time code with Copy / Open github.com and a 15-minute countdown; the token lands in the OS keyring and feeds
  git over HTTPS through the Phase 3 askpass bridge. The account menu shows login, scopes, API budget, Sign out,
  Re-authorize and the revoke page; "Clone from GitHub…" lists your and your organizations' repositories.
- For a GitHub repository the sidebar lists pull requests (Open / Closed / Mine); the detail pane shows
  description, checks and reviews with Checkout (tracking branch, or `pr/N` for forks, D-028) and Open in browser;
  "New pull request" pushes the branch first if needed and prefills title/body from the commits. Branch chips carry
  a `#N` badge and a check dot; offline / rate-limit states are sticky notices with Retry (ETag-cached lists).
- Smoke test on the real app: Sign in → Continue returned a live device code from GitHub for the registered
  client id and the countdown ran; Cancel returned to the signed-out header with no backend error. The browser
  authorization, a private clone and a real PR round-trip are left for the owner (own account).
- 351 Rust tests (67 in `github-api` on a mock transport with paused time: device flow, ETag/304, rate-limit
  window, checks cache; 9 new git-core fixture tests for PR checkout and commit ranges), 426 vitest tests;
  `pnpm check` green. Release build 5.5 min: `gitbranch.exe` 7.6 MB (+2.3 MB for reqwest/rustls), NSIS installer
  2.6 MB (target < 25 MB).
- Transport seam, two-command login and offline account are D-027; slug parsing and PR checkout semantics are D-028.

### Phase 4 demo (2026-10-19, branch `phase/4`)
- The left sidebar (toggle in the header) lists the worktrees: branch or `detached @ <oid>`, path, main / current /
  locked / prunable badges. Add… (Ctrl+Shift+W, or "Add worktree here…" on a commit or branch) creates one on a new
  branch, an existing branch or detached, at `../<repo>.<branch>` by default; Lock (with reason) / Unlock, Remove
  (confirmed; a dirty tree asks for a forced retry, a locked one must be unlocked first) and Prune act in place.
- Smoke test on the real app: Add → `git worktree list` shows it; a commit made with the CLI inside the worktree
  appears in the main tab's graph about 2 s later with a `⧉ smoke.feat-wt` chip, no manual refresh; opening the
  worktree gives it its own tab (own WIP row and HEAD, the main checkout gets its chip in turn); Remove from the
  main tab deletes the folder and closes the other tab; a deleted folder shows `prunable` and Prune clears it.
- 281 Rust tests on real git (11 new on worktree fixtures, including from inside a linked worktree and a bare
  main), 369 vitest tests; `pnpm check` green. Release build 3 min: `gitbranch.exe` 5.3 MB, NSIS installer
  1.8 MB (target < 25 MB).
- Sidebar, tabs and chips follow D-026; `git worktree list --porcelain` without `-z` (git 2.31 floor) is D-025.

### Phase 3 demo (2026-10-16, branch `phase/3`)
- Open a repo with a remote: the toolbar shows Fetch / Pull… / Push… (with the ahead count) / Clone… / Remotes…;
  fetch updates the graph in place, Pull offers ff-only / rebase / merge / repository default, Push shows the exact
  target (`main → origin/main`), set-upstream, tags and force-with-lease (never plain force; `--force-if-includes`
  refuses to overwrite a remote tip you have not integrated). Rejected pushes and missing credentials get their own
  toasts; "Commit and push" works.
- Every network operation streams git's progress to a slim bar with phase, percentage and the last line, and Cancel
  (Esc) kills the whole git process tree; Clone… (Ctrl+Shift+C, also from the Welcome screen) takes a URL, parent
  folder, name, branch, shallow depth and submodules, and opens the clone when done.
- HTTPS to github.com uses the app's own token through the binary itself as `GIT_ASKPASS` (keyring, strict prompt
  parsing, network calls only); SSH stays with the system agent. The token is stored by the Phase 5 login, or now with
  `echo <token> | cargo run -p github-api --example store_token -- <login>`.
- Submodules show up in the WIP pane with their state (clean / modified / not initialised / conflict) and commit.
- 262 Rust tests on real git fixtures (+76, including file:// remotes, a hanging TCP server for cancel/timeout and
  crafted askpass prompts), 322 vitest tests (+54); `pnpm check` green; release build 3 min 34 s; installer 1.7 MB,
  `gitbranch.exe` 5.0 MB (target < 25 MB). Verified by hand in the app on a file:// fixture: fetch, pull, push,
  rejected push, force-with-lease, remotes add/remove, clone, submodule badge. HTTPS against a private GitHub repo
  still needs a token in the keyring (owner action, see the report).

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
