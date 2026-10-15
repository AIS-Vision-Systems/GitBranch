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
    state/                     # zustand stores: repos, graph, selection, ui
    features/
      graph/                   # GraphView, GraphRow, LaneStrip (SVG), RefChip
      commit/                  # CommitDetails, FileList
      diff/                    # DiffView, Hunk, line staging
      sidebar/                 # Branches, Remotes, Tags, Stashes, Worktrees, PullRequests
      dialogs/                 # one folder per dialog (NewBranch, Clone, CreatePr, ...)
      github/                  # Login (device flow UI), Account, RepoPicker
    styles/tokens.css
  src-tauri/
    Cargo.toml                 # the Tauri binary crate (member of the root workspace)
    src/
      main.rs                  # tauri::Builder, --askpass entry point
      commands/                # #[tauri::command] fns, THIN: parse args -> git-core -> serialize
      watcher.rs               # notify-based repo watcher -> emits "repo-changed" events
      state.rs                 # open repos registry
  crates/
    git-core/                  # pure Rust, no Tauri. Everything testable with real git in temp dirs
      src/runner.rs            # spawn, env, timeout, cancellation, GitError
      src/parse/{refs,log,status,diff,worktree,stash}.rs
      src/graph/{layout,color}.rs
      src/ops/{branch,stash,merge,rebase,remote,worktree,...}.rs
      src/fixtures.rs          # FixtureRepo builders (feature `fixtures`, dev-dep enables it for tests)
      tests/{fixtures,runner}.rs
      examples/make_fixture.rs # cargo run -p git-core --features fixtures --example make_fixture -- <kind> <dir>
    github-api/
      src/{auth,client,models,prs,repos}.rs
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
  `GIT_EDITOR=:`, `GIT_SEQUENCE_EDITOR=:`, `SSH_ASKPASS_REQUIRE=never`, `GIT_ASKPASS=<self exe> --askpass` (only when
  an HTTPS GitHub token exists), `-c core.quotepath=false`. Inherited `GIT_DIR`/`GIT_WORK_TREE`/`GIT_INDEX_FILE`/
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
Row { oid, lane: u16, color: u8, edges: Vec<Edge> }   // Edge { from_lane, to_lane, kind: Straight|MergeIn|BranchOut, color }
```

Algorithm (standard "active lanes" sweep, as used by git-graph tools):

1. Keep `lanes: Vec<Option<Oid>>` = the commit each lane is waiting for.
2. For commit C: find the first lane waiting for C; that is C's lane (if none, allocate the first free lane). All other
   lanes waiting for C are merge-in edges ending at C's lane and are freed.
3. Replace C's lane target with `parents[0]`. For each extra parent P: if some lane already waits for P, draw a
   branch-out edge to it; else allocate a free lane for P. A lane whose target is `None` is free.
4. Colors: assigned per lane *segment* (a lane keeps its color from allocation to being freed), palette of 12.
5. Emit edges for the segment between row i and i+1 so each row can be drawn independently (needed for virtualization).

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
  honouring `interval` / `slow_down` → store token via `keyring` (service `GitBranch`, account = GitHub login).
- The same token feeds `git` over HTTPS through the askpass bridge: when git asks "Username for https://github.com"
  answer `x-access-token`, for "Password" answer the token. Any other host: fail fast (exit 1) so git falls back to
  the user's own credential helper.
- SSH remotes are untouched (system `ssh`, agent, keys).
- API client: `reqwest` + `serde`, `Authorization: Bearer`, `If-None-Match` caching for list endpoints, backoff on
  403 rate limit, explicit offline mode.

## IPC contract

- One Rust command = one TypeScript wrapper in `src/ipc/<area>.ts` with identical names and a shared type file
  generated by hand (keep it small; revisit `specta` if it drifts).
- Commands are `async`, take `repo_id: RepoId` (not a path) and plain-data args; return `Result<T, AppError>` where
  `AppError { code: string, message: string, detail?: string }` is what the UI shows.
- Events from Rust → UI: `repo-changed { repo_id, what: Refs|Index|WorkingTree|Head }`, `op-progress { op_id, pct, msg }`.

## Performance rules

- Never load the whole log for UIs that need the tip only (sidebar uses `for-each-ref`).
- Log is paged: 2,000 rows first paint, then 10k chunks in the background; graph layout is incremental-safe because
  lanes state is carried across chunks.
- Diffs are computed per selected file, never for the whole commit up front.
- Watcher debounces 150 ms, coalesces by category, and refetches only the affected slice (refs vs status vs log).

## Security

- No shell: `Command::new(git_path).args(...)`. Arguments that start with `-` and come from user input are passed
  after `--`.
- Token only in the OS keyring; never logged; redacted from error strings.
- Tauri capabilities limited to: dialog (open folder), shell-open (URLs only), fs read of the chosen repo paths.
- CSP strict, no remote content in the webview.
