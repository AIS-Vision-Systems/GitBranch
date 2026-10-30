# GitBranch

Lightweight Git desktop client (Tauri 2 + Rust + React/TS) for Windows and Linux. Commit graph first, GitHub-only
remote integration, worktrees. No link to GitKraken. Owner: Xavi (chat in Catalan; code, docs, commits in English).

## Read first, only what you need
- `docs/PLAN.md` — phases and checkboxes. The current task is the first unchecked item of the lowest unfinished phase.
- `docs/ARCHITECTURE.md` — layering, git runner, graph algorithm, IPC, credentials. Read the section you touch.
- `docs/DECISIONS.md` — ADRs. `open` ones are the only valid reason to ask the owner.
- `docs/HARNESS.md` — how work is routed to agents/skills to save tokens.

## Hard rules
- Git logic only in `crates/git-core`; Tauri commands in `src-tauri/src/commands` are thin; the UI never builds git argv.
- Spawn `git` with `Command` (no shell), machine-readable flags only (`-z`, `--porcelain=v2`, `--format` with `%x00`).
- No libgit2, no bundled git, no telemetry, no GitKraken packages, no Electron.
- Tokens only in the OS keyring; never log or echo them.
- Tests use real `git` on temp fixture repos (`crates/git-core/tests/fixtures.rs`). Every git-core op has a test.
- `git push --force` is forbidden; use `--force-with-lease`. Push after every commit (owner standing order, D-014).
  Since 1.0.0 every change lands through a pull request (D-040): open it with `gh pr create`, admin-merge it once
  CI is green (`gh pr merge <n> --merge --admin --delete-branch`), and never tag or release without the owner.

## Commands (once Phase 0 lands)
```
pnpm tauri dev                  # run app
cargo check -p git-core         # fastest feedback
cargo test -p git-core <name>   # one test
cargo clippy --workspace -- -D warnings
pnpm test                       # vitest
pnpm check                      # fmt + lint + typecheck, all layers
pnpm tauri build                # phase end only
```

## Working style (token discipline)
- Delegate per `docs/HARNESS.md` routing table: `scout` (find), `rust-dev` / `ui-dev` (implement), `verifier` (run),
  `reviewer` (diff review). Brief = goal, files, signatures, acceptance, what not to touch. Expect summaries back.
- Inline edits only when the location is known and the change is < ~20 lines.
- Grep then read a window; never read whole files > 200 lines without a reason. Pipe long outputs through `tail -40`.
- Check ladder: `cargo check` → single test → crate tests → clippy → `pnpm test` → full build (phase end).
- Decide routine things yourself and log them in `docs/DECISIONS.md`. Batch owner questions, each with a default.
- Commit after each PLAN item passes verification: `feat(graph): ...` / `fix(git-core): ...` style, English, one item per commit.
- Update the PLAN checkbox in the same commit as the code.
- Since 1.0.0 (D-040): one branch per change off `main` (`fix/<topic>`, `feat/<topic>`, or `phase/N` for a whole
  PLAN phase), every commit pushed right away (`git push -u origin <branch>` on the first one), and a pull request
  opened with `gh pr create` when the change is verified. When every CI check passes (`gh pr checks <n>`), merge it
  with `gh pr merge <n> --merge --admin --delete-branch` (D-040 amendment: the owner cannot approve their own PRs);
  never commit to `main` directly. The pre-1.0 phase flow (local `--no-ff` merge, `phase-N` tag,
  branch deletion) is history in D-014.
