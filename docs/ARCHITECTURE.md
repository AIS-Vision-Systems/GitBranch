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
      github/                  # LoginDialog, AccountMenu, RepoPickerDialog, PullDetailView, CreatePullDialog, PrBadge
      shell/                   # Toolbar, tabs, command palette, UpdateCard
      welcome/  stash/
    styles/tokens.css
  src-tauri/
    Cargo.toml                 # the Tauri binary crate (member of the root workspace)
    src/
      main.rs                  # entry; askpass mode (GITBRANCH_ASKPASS=1 + prompt arg)
      lib.rs                   # tauri::Builder, plugins, logging init
      launch.rs                # repo path from argv, single-instance forwarding
      settings.rs              # Settings struct, load/validate
      commands/                # #[tauri::command] fns, THIN: parse args -> git-core -> serialize
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
      src/{http,client,error,auth,token,askpass,user,repos,pulls,checks}.rs  # Transport trait + reqwest/mock
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
2. For commit C: find the first lane waiting for C; that is C's lane (if none, allocate the first free lane). All other
   lanes waiting for C are merge-in edges ending at C's lane and are freed.
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
- SSH remotes are untouched (system `ssh`, agent, keys).
- API client (D-027): `github-api::http::Transport` is the only seam (`ReqwestTransport` with rustls in the app,
  `MockTransport` in tests); one `GitHub<T>::send()` path adds `Authorization: Bearer`, `Accept`, the API version,
  `If-None-Match` from a bounded ETag cache (304 serves the cached body), reads `x-ratelimit-*` into a status the
  UI can show, short-circuits while rate limited, and flips an `online` flag on transport errors. Check summaries
  are cached per commit (`checks::ChecksCache`). The UI never retries on its own: offline / rate-limit / signed-out
  are sticky notices with a Retry or Sign in button.
- Pull requests (D-028): the repo slug comes from the remote URL; checkout of a PR is one git-core op
  (`ops::pull_request::checkout_pr`): tracking branch for same-repo PRs, local `pr/N` from `refs/pull/<remote>/N`
  for forks.

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
  `autoUpdateCheck` (default true). Missing fields take their defaults; a corrupt file is copied to
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
