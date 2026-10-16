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
- `git push --force` is forbidden; use `--force-with-lease`. Push after every commit (owner standing order, D-014);
  never open PRs or release without the owner.

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
- One branch per phase: `phase/N` off `main`. All phase commits land there. At phase end merge to `main` with
  `--no-ff`, tag `phase-N`, delete the branch locally and on origin (D-014). Never commit directly to `main` while a
  phase is open. Every commit is pushed right away (`git push -u origin phase/N` on the first one).
