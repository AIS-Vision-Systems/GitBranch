# GitBranch — Architecture

## Stack

| Layer | Choice | Reason |
|---|---|---|
| Shell | Tauri 2 (Rust), WebView2 on Windows, WebKitGTK 4.1 on Linux | ~10–20 MB installer, no bundled browser |
| Frontend | React 19 + TypeScript + Vite, Zustand for state, `@tanstack/react-virtual` | small, boring, fast to iterate |
| Git backend | system `git` CLI spawned from Rust (`crates/git-core`) | only path that covers worktrees, stash, rebase, hooks, credential helpers exactly like the terminal |
| GitHub | REST v3 via `reqwest` (`crates/github-api`), OAuth App Device Flow, token in OS keyring | no secret in the app, works headless |
| Diffs | `git diff -p` parsed in Rust into hunks; custom React diff view | avoids Monaco (5 MB) |
| Styling | CSS modules + design tokens (`src/styles/tokens.css`), dark/light | no Tailwind runtime |

Not used on purpose: libgit2/git2-rs (worktree + credential gaps, duplicate behaviour), Electron, any GitKraken package.

## Repository layout

```
GitBranch/
  Cargo.toml                   # workspace root: src-tauri + crates/*, shared deps, release profile
  package.json  pnpm-lock.yaml  vite.config.ts  tsconfig.json
  src/                         # frontend
    main.tsx  App.tsx
    ipc/                       # ONE typed wrapper per Tauri command (invoke + zod-free TS types)
    state/                     # zustand stores: repos, graph, selection, ui, settings, updater, session, ...
    features/
      graph/                   # GraphView, GraphRow, LaneStrip (SVG), RefChip
      commit/                  # CommitDetails, FileList, file context menu (Blame / File history / difftool)
      diff/                    # DiffView, Hunk, line staging
      blame/                   # BlameView (virtualised rows), rows.ts
      sidebar/                 # Branches, Remotes, Tags, Stashes, Worktrees, PullRequests
      dialogs/                 # one folder per dialog (NewBranch, Clone, CreatePr, Settings, ...)
      github/                  # LoginDialog, AccountMenu (account panel, commit signature, avatar), RepoPicker, PR views
      shell/                   # RepoTabs, Ribbon, Popover, command palette, Markdown, UpdateCard/UpdateCheck
      welcome/  stash/
    lib/icons.ts               # the only module importing lucide-react (named re-exports)
    lib/markdown.ts            # markdown subset parser for the bundled user guide (no innerHTML)
    help/guide.en.md           # user guide shown in the About dialog
    assets/                    # app logo, AIS Vision Systems logos (blue/white)
    styles/tokens.css
  src-tauri/
    Cargo.toml                 # the Tauri binary crate (member of the root workspace)
    src/
      main.rs                  # entry; askpass mode (GITBRANCH_ASKPASS=1 + prompt arg)
      lib.rs                   # tauri::Builder, plugins, logging init
      launch.rs                # repo path from argv, single-instance forwarding
      settings.rs              # Settings struct, load/validate
      commands/                # #[tauri::command] fns, THIN: parse args -> git-core -> serialize
      terminal.rs              # external terminal argv candidates (settings override, then platform defaults)
      watcher.rs               # notify-based repo watcher -> emits "repo-changed" events
      state.rs                 # open repos registry, recent list, settings and session persistence
      error.rs                 # AppError
  crates/
    git-core/                  # pure Rust, no Tauri. Everything testable with real git in temp dirs
      src/runner.rs            # spawn, env, timeout, cancellation, GitError
      src/parse/{refs,log,status,diff,worktree,stash,blame,...}.rs
      src/graph/{layout,color}.rs
      src/ops/{branch,stash,merge,rebase,remote,worktree,...}.rs
      src/fixtures.rs          # FixtureRepo builders (feature `fixtures`, dev-dep enables it for tests)
      tests/{fixtures,runner}.rs
      examples/make_fixture.rs # cargo run -p git-core --features fixtures --example make_fixture -- <kind> <dir>
    github-api/
      src/{http,client,error,auth,token,askpass,user,repos,pulls,checks,avatar}.rs  # Transport trait + reqwest/mock
  docs/
  .claude/                     # Claude Code harness (see HARNESS.md)
```

Rule: `src-tauri/src/commands` contains no git logic. `crates/git-core` contains no Tauri types. The frontend
never builds git argv; it only calls typed commands.

## Git runner

```rust
pub struct GitRunner { git_path: PathBuf, askpass: Option<PathBuf> }
pub async fn run(&self, repo: &Path, args: &[&str], opts: RunOpts) -> Result<Output, GitError>
```

- Env on every spawn: `GIT_TERMINAL_PROMPT=0`, `LC_ALL=C`, `GIT_OPTIONAL_LOCKS=0`, `GIT_PAGER=cat`,
  `GIT_EDITOR=:`, `GIT_SEQUENCE_EDITOR=:`, `SSH_ASKPASS_REQUIRE=never`, `GIT_ASKPASS=<self exe>` +
  `GITBRANCH_ASKPASS=1` (set only on network calls, `RunOpts::network`, when askpass is configured), `-c core.quotepath=false`. Inherited `GIT_DIR`/`GIT_WORK_TREE`/`GIT_INDEX_FILE`/
  `GIT_CONFIG_*`/... are removed (`runner::SCRUB_ENV`) so launching GitBranch from a hook or worktree shell is safe.
- Timeouts are opt-in per call (`RunOpts::timeout`), used for network and read-only calls only (D-012); dropping the
  returned future kills the child (cancellation). stdin is fed concurrently with draining stdout/stderr.
- Machine-readable output only: `-z`, `--porcelain=v2`, `--format` with `%x00` separators. Never parse human output.
- Long-running ops (fetch/push/clone/rebase) stream stderr lines to the UI as progress events; cancellation kills the child.
- Windows: `CREATE_NO_WINDOW`; Linux: nothing special. Paths are always passed as-is (no shell).
- `GitError { kind: ExitCode(i32) | Timeout | NotARepo | Conflict | AuthRequired | NotFound | Spawn, stderr, args }`
  classified from `fatal:`/`error:` stderr lines (conflicts from stdout) so the UI can react (e.g. `AuthRequired`
  opens the login dialog). URL credentials are redacted (`runner::redact_credentials`) before anything is logged.

## Graph layout (the product)

Input: commits in `--date-order` (or `--topo-order` toggle), each with ordered parents. Output: one `Row` per commit.

```
Row { oid, lane: u16, color: u8, has_incoming: bool, edges: Vec<Edge> }   // Edge { from_lane, to_lane, kind: Straight|MergeIn|BranchOut, color }
```

Algorithm (standard "active lanes" sweep, as used by git-graph tools):

1. Keep `lanes: Vec<Option<Oid>>` = the commit each lane is waiting for.
2. For commit C: among the lanes waiting for C pick the node lane (the others are merge-in edges ending at it and
   are freed; none waiting = allocate the first free lane). The pick (D-041): the placeholder lane reserved for a
   stash base; else the *fresh* lane (opened by a branch-out and not yet at its target: the merged branch keeps its
   lane) unless another waiting lane's chain is an ancestor of the fresh lane's chain (upstream merged into
   downstream: upstream stays); else the leftmost. A chain starts at a tip or a branch-out and follows first
   parents; each lane records its chain id and ancestor chains.
3. Replace C's lane target with `parents[0]`. For each extra parent P: if some lane already waits for P, draw a
   branch-out edge to it; else allocate a free lane for P. A lane whose target is `None` is free.
4. Colors: assigned per lane *segment* (a lane keeps its color from allocation to being freed), palette of 12.
5. Edge convention: `Row.edges` are the segments from the top of row i to its bottom, so each row is drawn
   independently (needed for virtualization). `Straight` = passthrough on one lane (the node lane's goes to
   `parents[0]`); `MergeIn {from L, to node}` = a waiting lane enters from the top and ends at the node;
   `BranchOut {from node, to L}` = extra parent. A lane already waiting for an extra parent keeps its `Straight`
   as well (the two join at the bottom); only lanes newly allocated in this row have none.
   Node lane rule: draw top-to-center only if `has_incoming` (some lane was waiting for this commit; false for
   branch tips), draw center-to-bottom only if a `Straight`/`BranchOut` edge starts at the node (a root has none).

Complexity O(n · active_lanes). Done in Rust, returns a compact `Vec<Row>` to the frontend (binary via
`tauri::ipc::Response` if JSON proves slow, > 50k rows). The frontend only draws: for each visible row, an SVG
with one path per edge and one circle for the node. Refs are overlaid as chips on the row of their target oid.

Virtual "WIP" row: when the working tree is dirty, a synthetic row is prepended on HEAD's lane with a dashed edge.
Stash rows: the Tauri cache inserts one synthetic `Commit { stash: true, parents: [base] }` per stash entry right
above its base (`graph::with_stashes`, filtered logs excepted). The layout reserves a placeholder lane for the base
when nothing waits for it, so the stash sits beside the base and joins it from the side; its lane is `dashed`
(`Edge.dashed`), drawn dotted, and the node is a square. The WIP connector passes through stash rows above HEAD.
Rows are 28 px (`ROW_H` = `--graph-row-h`); chips clip long names at 180 px (`.chipText`, full name in the title)
and the chip-to-node connector runs flush from the last chip to the node edge. `checkout(<remote>/<branch>)`
with an existing local branch switches and then pulls that branch (D-037).

Tests: for every fixture repo, assert (a) each commit's parents appear strictly below it, (b) the set of
(child, parent) edges drawn equals the real parent relation, (c) no two active lanes share an index on one row.
Perf test: 100k synthetic commits with random merges < 300 ms (release).

## Credentials and GitHub

- OAuth **App** (not GitHub App) owned by the project owner, Device Flow enabled. `client_id` is a compile-time
  constant (public by design). No client secret anywhere.
- Flow: `POST https://github.com/login/device/code` (scope `repo read:org`) → show `user_code`, open
  `verification_uri` → poll `POST /login/oauth/access_token` with `grant_type=urn:ietf:params:oauth:grant-type:device_code`
  honouring `interval` / `slow_down` → store token via `keyring` (service `GitBranch`, account `github.com`; the login in account `github.com#login`, D-024).
- The same token feeds `git` over HTTPS through the askpass bridge (the app exe as `GIT_ASKPASS`, selected by `GITBRANCH_ASKPASS=1` + a prompt-shaped argument, D-024): when git asks "Username for https://github.com"
  answer `x-access-token`, for "Password" answer the token. Any other host: fail fast (exit 1); git asks credential helpers
  *before* askpass, and with `GIT_TERMINAL_PROMPT=0` an exit 1 ends in `AuthRequired`, which the UI reports.
- SSH remotes are untouched (system `ssh`, agent, keys). ssh's `Permission denied (publickey)` becomes
  `git.ssh_auth`; the UI explains the agent/passphrase cause and, for a github.com remote while signed in, offers to
  switch the remote to HTTPS (D-044).
- API client (D-027): `github-api::http::Transport` is the only seam (`ReqwestTransport` with rustls in the app,
  `MockTransport` in tests); one `GitHub<T>::send()` path adds `Authorization: Bearer`, `Accept`, the API version,
  `If-None-Match` from a bounded ETag cache (304 serves the cached body), reads `x-ratelimit-*` into a status the
  UI can show, short-circuits while rate limited, and flips an `online` flag on transport errors. Check summaries
  are cached per commit (`checks::ChecksCache`). The UI never retries on its own: offline / rate-limit / signed-out
  are sticky notices with a Retry or Sign in button.
- Pull requests (D-028): the repo slug comes from the remote URL; checkout of a PR is one git-core op
  (`ops::pull_request::checkout_pr`): tracking branch for same-repo PRs, local `pr/N` from `refs/pull/<remote>/N`
  for forks.
- Avatars (D-034): the webview never fetches from GitHub. `github_avatar(login?)` downloads
  `https://github.com/<login>.png?size=64` through `github-api::avatar::fetch_avatar` (host allow-list, 2 MiB cap,
  `image/*` only, **no** `Authorization` header, no API quota) and caches it as `<cache_dir>/avatars/u-<login>.<ext>`
  for seven days (tmp + rename, one download per login in flight, 1 h negative cache, stale entry served offline).
  The command returns a `data:` URL or `null`; the UI keeps the initials fallback.
- Avatars by email (D-038): `github_avatar_email(email)` asks the CDN's
  `https://avatars.githubusercontent.com/u/e?email=<email>&s=64` (same `fetch_avatar` path, no token, no quota).
  The CDN answers unknown addresses with one fixed default image; the backend fetches it once per process for a
  sentinel `.invalid` address and returns `null` whenever the bytes match (and when the sentinel is unavailable).
  Disk cache key `e-<32 hex of sha256(email)>` (the cache holds digests, not addresses; nothing is logged).
  `resolve_avatar` distinguishes a photo, "no avatar" (cache entry removed, remembered 1 h) and a transient
  failure (stale entry served, remembered 1 h); at most four downloads run at once.
- Commit signature (D-034): `git-core::ops::config::identity` reads `user.name` / `user.email` with
  `git config --show-scope -z --get` (value + the scope git reports); `set_identity(scope: local | global, ..)`
  writes both keys after validation. The account panel edits them per repository or globally.

## Window shell

- Tab row (44 px, `--tabrow-h`): one tab per open repository or worktree (`FolderGit2` / `GitFork` icon, close `×`
  on hover/active, 1 px separators, `+` tab = welcome screen); right side only help (About), settings gear and the
  account button. Tabs shrink (`flex: 1 1 220px`, min 56 px, ellipsised label) instead of scrolling; the chevron
  after `+` opens `TabSearchMenu` (filter box, "OPEN TABS" list with per-row close, arrows/Enter/Escape). Right-click
  → Close tab / Close other tabs / Close tabs to the right / Alias repository; the alias is edited in `TabAliasBar`
  (replaces the row: input, Save / Clear / Cancel) and stored in `useReposStore.aliases` keyed by repository path,
  persisted in `session.json` (`aliases`, D-037) and shown by `tabName()` in the tabs, the dropdown and the ribbon
  repository button. Tabs are draggable (`application/x-gitbranch-tab`); `moveTab` reorders the `open` array,
  `orderTabs` still keeps a worktree next to its main checkout (a group moves as one). `dragDropEnabled: false` in
  tauri.conf.json keeps WebView2 from eating HTML5 drag events (D-037). The shown repo only is kept fresh by
  `state/autoFetch.ts`: `ops.fetchQuiet` on show, every `autoFetchSeconds` (setting, default 10, 0 = off) and on window focus, never
  while hidden (all remotes, prune; silent: no progress bar, no toasts; skipped within half an interval of the
  last one, when busy or without remotes). The
  `fetch` command emits `repo-changed` only when a `for-each-ref` snapshot differs, so an empty fetch reloads
  nothing (D-042). The bottom `StatusBar` hosts the progress of user network operations and the app version; when nothing is selected after a load, `GraphView` selects the WIP row or the first commit
  (`lib/firstRow.ts`) unless a pull request is being viewed. Theme lives in Settings; the sidebar state lives in `useUiStore` (`Ctrl+B`, palette, ribbon
  overflow), persisted under `gitbranch.sidebar`.
- Ribbon (`features/shell/Ribbon.tsx`, replaces the toolbar): left = repository dropdown › branch dropdown
  (ahead/behind, filterable checkout list); centre = Undo, Redo, Fetch (caret: fetch all / pull ff / pull rebase /
  pull merge / prune), Push, Branch, Stash, Pop, Terminal; right = Actions overflow (Clone, Remotes, Stashes
  popover, Toggle sidebar, Settings) and Search (filter bar). Every button is also a palette command with the same
  shortcut; the ribbon hotkeys (`Ctrl+Z`/`Ctrl+Y`, `Ctrl+Shift+F/L/P`) are registered by the ribbon.
- Undo / Redo (D-021, D-033): Undo is reflog-based (`undo_last` → `UndoOutcome { info, redo, head, branch }`); the
  ops store keeps one redo per repository and a graph-store subscription drops it when HEAD's oid **or** branch
  differs from the recorded pair. Redo calls `apply_action(repo_id, action)`, whose targets are validated in
  git-core (full oid for resets and detached checkouts, plain branch name otherwise).
- Terminal: `open_terminal(repo_id)` spawns the first program found on `PATH` from `terminal::terminal_candidates`
  (settings `terminal` override split into argv; Windows `wt.exe -d .` then `cmd.exe` with `CREATE_NEW_CONSOLE` and
  inherited stdio; Linux `$TERMINAL`, `x-terminal-emulator`, `gnome-terminal --working-directory=<wt>`,
  `konsole --workdir <wt>`, `xterm` with detached stdio) with cwd = work tree, never a shell string, reaped in a
  thread. Error code `terminal.open_failed` names the programs tried.
- About dialog (`features/dialogs/AboutDialog.tsx`, help button, palette "About GitBranch"): logo, name, version
  from `app_info`, creator credit, license line (opens `LICENSE.md` on GitHub), the shared `UpdateCheck` (same
  component as Settings), AIS Vision Systems logo switched by `html[data-theme]`, and the user guide
  (`src/help/guide.en.md`, imported `?raw`) rendered by `lib/markdown.ts` → `shell/Markdown.tsx`: headings,
  paragraphs, lists, fenced code, GFM tables, bold/italic/code/links (`http(s)` only), React elements, no
  `innerHTML`. English only (D-030).
- Icons: `lucide-react`, named re-exports from `lib/icons.ts` only; deep imports are an eslint error (D-032).

## Side panels

- Sidebar (`features/sidebar/`): `Sidebar` = top bar (filter `<input type=search>`, collapse chevron) + a
  scrolling body of four `SidebarSection`s (lucide icon, uppercase title, count, header actions; open state in
  `useUiStore.sidebarSections`, persisted under `gitbranch.sidebarSections`, root `data-section=<id>`). LOCAL and
  REMOTE render `BranchTree` (`BranchTreeView.tsx`) from the pure model in `branchTree.ts` (`buildTree`: folders
  by `/`, folders first, case-insensitive; `groupByRemote` strips `<remote>/`; `filterTree` returns the pruned
  nodes plus the folder paths to auto-expand). REMOTE is one `role=tree` whose level-1 rows are the remotes
  (`remotesOf` adds empty ones), with "Add remote…" opening the Remotes dialog. Remote rows' menu: Edit, Open on GitHub
  (`lib/remoteUrl.ts` turns https/ssh/scp-style fetch URLs into the web URL, label "Open in browser" off GitHub,
  hidden when unparsable), Copy URL, Remove. Rows: HEAD check, `↑n ↓n` /
  `gone` badges from `upstream`; click `select(target)`, hover `setHover` (cleared on unmount), double-click or
  Enter = the ref menu's own Checkout item (`refActions.ts`), right-click / Shift+F10 = `refMenu`; roving
  tabindex with arrow keys. The filter also narrows WORKTREES (branch, path) and PULL REQUESTS (`#n title`); the
  counts come from `counts.ts` hooks shared with the rail.
- Sidebar width and rail: `shell/paneWidth.ts` (`createWidthStore`) backs both `detailsWidth.ts` (480 / 320 /
  70 %, `gitbranch.detailsWidth`) and `sidebar/sidebarWidth.ts` (260 / 180 / 45 %, `gitbranch.sidebarWidth`); the
  shared `Splitter` takes `side: "left" | "right"`. When `sidebarOpen` is false `Sidebar` renders `SidebarRail`
  (36 px, expand chevron, one icon + count per section); clicking an icon opens the sidebar and that section and
  sets `pendingSidebarScroll`, which `Sidebar` consumes with `scrollIntoView` after render. `Ctrl+B` toggles.
- Details pane (`features/commit/CommitDetails.tsx`): a flex column whose header never scrolls — short id + Copy
  with the parent buttons at the right, the message in a bordered box with its own scroll (`max-height: 40cqh`,
  the pane's `.top` is a size container for the commit view only), a 40 px author avatar with "authored <date>"
  (and "committed by …" when the committer differs), "Co-authors:" chips, then summary + Path/Tree + Expand all.
  Only `div.files` below scrolls; rows are 22 px with a 10 px indent per level, shared with the working-tree pane.
- Co-authors (D-035): `commit_details` asks `git show` for `%(trailers:key=Co-authored-by,valueonly,unfold)` as
  a separate `%x1f` field (body stays last) and `strip_co_author_lines` removes at most that many matching lines
  from the last paragraph of the body, following git's trailer rules (no indented keys, optional space before
  `:`, folded continuations dropped, CRLF kept). `CommitDetails.coAuthors: CoAuthor[]` crosses IPC unchanged.
- Author avatars (D-023, D-034, D-035): `features/github/authorLogin.ts` maps an email to a login without any
  lookup (noreply addresses, the signed-in account's email); `useAuthorAvatar(email)` → `useAvatar(login)` →
  `github_avatar(login)` (backend download, disk cache, one-hour negative cache). `features/github/Avatar.tsx`
  renders the photo or the initials badge (`graph/avatar.ts` colours). The repo's effective `user.email`
  (`state/identity.ts`, one `git_identity` call per repo) also maps to the signed-in login (D-036), and graph
  nodes show the photo when it resolves (`LaneStrip` clip-path image), initials otherwise. Remote chips and
  sidebar remote rows show the remote owner's avatar (`github/remoteAvatar.ts`: `githubOwner(url)` → `useAvatar`).
  When the login path yields nothing and the repo has a GitHub remote (`remotes` store, `githubOwner`), the email
  itself is resolved with `useEmailAvatar(email)` → `github_avatar_email` (D-038); repos without a GitHub remote
  keep sending nothing.

## IPC contract

- One Rust command = one TypeScript wrapper in `src/ipc/<area>.ts` with identical names and a shared type file
  generated by hand (keep it small; revisit `specta` if it drifts).
- Commands are `async`, take `repo_id: RepoId` (not a path) and plain-data args; return `Result<T, AppError>` where
  `AppError { code: string, message: string, detail?: string }` is what the UI shows.
- Events from Rust → UI: `repo-changed { repo_id, what: Refs|Index|WorkingTree|Head }`, `op-progress { op_id, pct, msg }`.

## Blame

- `ops::blame::blame(runner, repo, path, rev)` runs `git blame --porcelain [<rev>] -- <path>`; `rev = None` blames
  the working tree (uncommitted lines carry the author "Not Committed Yet"). A revision that is empty, starts with
  `-` or contains whitespace/control characters is refused before spawning (`BlameError::InvalidRevision`).
- `parse::blame::parse_blame` folds consecutive lines of one commit into `BlameHunk { oid, author, author_time,
  summary, start_line, line_count, boundary, path }` (`path` is the name in that commit, so a rename shows through)
  and returns `Blame { hunks, lines }`: the file content travels with the hunks, so the UI never re-reads the file.
- IPC: `blame(repo_id, path, rev?)` (`src-tauri/src/commands/blame.rs` ↔ `src/ipc/blame.ts`).
- `src/features/blame/BlameView.tsx` replaces the graph in the center pane. It flattens the hunks into one
  `BlameRow` per line (`first` marks the first row of a hunk and is precomputed, so hunk grouping survives
  windowing) and renders them through `@tanstack/react-virtual` (`useVirtualizer`, 19 px estimate + `measureElement`,
  overscan 20) — the same pattern as the graph, so a large file costs only its visible rows. The short-oid button
  of a hunk selects that commit in the graph store.
- File history is not blame: "File history" sets the graph path filter (`LogFilter.path` → `git log
  --literal-pathspecs ... -- <path>`), without `--follow`, so renames are not followed.

## Performance rules

- Never load the whole log for UIs that need the tip only (sidebar uses `for-each-ref`).
- Log is paged: 2,000 rows first paint, then the whole remainder in ONE `git log` call (a `--skip` walk re-reads
  history every page: 10k chunks cost ~680 ms each on git/git vs ~880 ms for all 83k at once) served to the UI in 10k
  slices from the Rust cache; graph layout is incremental-safe because
  lanes state is carried across chunks. Filtered logs (author/message/path) use the same single-slot per-repo cache,
  keyed by `(order, all, filter)`; a filtered batch prunes parents that are not in the batch, so a filter matching
  more than the first page shows one lane break at the page boundary (D-031).
- Diffs are computed per selected file, never for the whole commit up front.
- Watcher debounces 150 ms, coalesces by category, and refetches only the affected slice (refs vs status vs log).

## Settings

- `settings.json` in the Tauri app config dir, next to `recent.json` and `session.json`; pretty JSON, camelCase
  (`src-tauri/src/settings.rs`). Fields: `gitPath` (absolute path or null = `GITBRANCH_GIT` / `git` on PATH),
  `pullStrategy` (`config` | `merge` | `rebase` | `ffOnly`), `diffContextLines` (0..=100), `diffIgnoreWhitespace`,
  `editor` (overrides `core.editor` / `$VISUAL` / `$EDITOR`), `difftool` (command with `$LOCAL` / `$REMOTE`),
  `terminal` (command for the ribbon's Terminal button, null = platform default), `autoUpdateCheck` (default true). Missing fields take their defaults; a corrupt file is copied to
  `settings.json.bad` and the defaults are used.
- `gitPath` is read once at startup to build the `GitRunner`, so a change applies after a restart; a configured path
  that no longer exists falls back to the default git with a warning.
- Commands `get_settings` / `set_settings`: `set_settings` validates (`Settings::validated`: blanks become null, context
  lines are clamped, the git path must be an existing absolute file), writes atomically (`.json.tmp` + rename, under
  the settings write lock), installs the copy in `AppState` and returns the normalised settings.
- UI: `useSettingsStore` (`src/state/settings.ts`) starts from `DEFAULT_SETTINGS` with `loaded = false`; `App` calls
  `load()` once on mount, which flips `loaded`; `save(partial)` merges and persists. Anything that must not act on
  the defaults (the update scheduler) waits for `loaded`.

## Updater

- `tauri-plugin-updater`; endpoint `https://github.com/AIS-Vision-Systems/GitBranch/releases/latest/download/latest.json`
  and the minisign public key in `src-tauri/tauri.conf.json` (`plugins.updater`). The private key and its password
  exist only as the repository secrets `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
- Release (`.github/workflows/release.yml`): pushing a `v*` tag runs windows-latest and ubuntu-22.04 one at a time;
  the tag must equal the version in `tauri.conf.json`, `package.json` and `Cargo.toml`; `tauri-action` builds with
  `bundle.createUpdaterArtifacts` and creates a DRAFT release with the installers, their `.sig` files and
  `latest.json`. The owner publishes it; actions are pinned to commit SHAs.
- UI (`src/state/updater.ts` over `src/ipc/updater.ts`, which wraps `@tauri-apps/plugin-updater` `check()` and
  `@tauri-apps/plugin-process` `relaunch()`): the scheduler starts once settings are `loaded` (not after a fixed
  delay), checks at once and then on an hourly timer; an automatic check actually runs only when `autoUpdateCheck`
  is on and the last check (`localStorage` key `gitbranch.updateLastCheck`) is older than 24 h. The palette's
  "Check for updates" bypasses both. Status: `idle → checking → available → downloading → ready` (then relaunch),
  or `error`.
- Failures: an automatic check that fails goes back to `idle` silently (`console.debug`); a manual check that fails
  keeps the card with the error and a Retry button. A failed install keeps its error and the pending update until a
  manual retry — the hourly check never overwrites it. `can_self_update` is false for `.deb` installs (the package
  manager owns the files): the card only notifies.

## Log file

- `tracing` with two layers (`src-tauri/src/lib.rs::init_logging`, installed in `setup` because the log dir needs
  the app handle): stderr, and a daily-rolling file `gitbranch.YYYY-MM-DD.log` (`tracing_appender`, 7 files kept) in
  the Tauri app log dir (`app_log_dir()`; Settings → Open log folder calls `open_log_dir`). The file writer is
  non-blocking; its guard is dropped on `RunEvent::Exit` so the last lines flush.
- Level from `GITBRANCH_LOG` (`EnvFilter`, e.g. `debug` or `git=debug,gitbranch=info`), default `info`.
- An unusable log dir only warns on stderr; logging never blocks startup.
- Local only, never uploaded (D-007). Tokens, the askpass argv and file contents are never logged; URL credentials
  go through `runner::redact_credentials` before a git error reaches a log line.

## Single instance

- `tauri-plugin-single-instance`, registered before every other plugin (desktop only). A second launch gets no
  window: the plugin hands its argv and cwd to the running process (`launch::on_second_instance`), which
  unminimises, shows and focuses the main window.
- The repository path is the first argument after `argv[0]` that is an existing directory (relative ones resolve
  against the second process's cwd, `-flags` are skipped), resolved on a blocking thread because `is_dir` on a dead
  UNC share can hang. It is stored in `LaunchPath` and emitted as `open-repo-request { path }`; the UI also drains
  `LaunchPath` through `take_launch_path` on start-up in case the listener was not ready. Opening an already-open
  repository just activates its tab, so seeing the same path on both routes is harmless.
- The first instance's own `gitbranch <path>` argument goes through the same `LaunchPath`.

## Security

- No shell: `Command::new(git_path).args(...)`. Arguments that start with `-` and come from user input are passed
  after `--`.
- Token only in the OS keyring; never logged; redacted from error strings.
- Tauri capabilities limited to: dialog (open folder), shell-open (URLs only), fs read of the chosen repo paths.
- CSP strict, no remote content in the webview.
