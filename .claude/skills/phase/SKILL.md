---
name: phase
description: Execute one phase of docs/PLAN.md autonomously for GitBranch (brief, delegate, verify, review, commit, tick checkbox, task by task), asking the owner only for open decisions. Use when asked to "do phase N", "continue the plan", or "next task".
---

# /phase [N]

Run phase N (default: the lowest phase with unchecked items) of `docs/PLAN.md`, task by task, end to end.

## Phase start
- `git switch -c phase/N main` if the branch does not exist yet; otherwise `git switch phase/N`. Never work on `main`.

## Per task loop
1. **Pick** the first unchecked item of the phase. Mark it `[~]` in PLAN.md.
2. **Gate**: if the item references an `open` decision in `docs/DECISIONS.md`, or needs an owner-only action
   (OAuth app, pushing, secrets), do everything that does not depend on it, then ask with `/decide` rules. Do not idle.
3. **Scout** only if you do not already know the touch points: ask `scout` for files + line ranges.
4. **Brief** the implementer (`rust-dev` for `crates/**`/`src-tauri/**`, `ui-dev` for `src/**`). A brief contains:
   goal (1–2 lines), files to create/modify, exact signatures/types, acceptance checks (copied from PLAN.md),
   constraints ("do not touch X"), and the test fixtures to use. Inline instead if < ~20 lines in a known place.
   Independent items (e.g. two parsers) go to parallel agents in one message.
5. **Verify** with `verifier`: the check ladder from `/dev-loop` for the crates/packages touched.
6. **Review** with `reviewer` when the diff touches git semantics, credentials, IPC surface, or > ~150 lines.
   Feed findings back to the implementer once; after that fix inline.
7. **Commit**: `git add -A` of the task's files, PLAN.md checkbox `[x]`, message `type(scope): item N.M — summary`.
   Then `git push` (first time: `git push -u origin phase/N`).
8. Append one line to `docs/CHANGELOG.md` if the item is user-visible.

## Phase end
- `cargo clippy --workspace -- -D warnings`, `cargo test --workspace`, `pnpm check`, `pnpm test`, then
  `pnpm tauri build` via `verifier` (report artifact sizes against the targets table).
- Write a 5-line demo note in `docs/CHANGELOG.md` (last commit on the branch).
- `git switch main && git merge --no-ff phase/N -m "Merge phase/N: <title>"`, tag `phase-N`,
  `git push origin main phase-N`, then `git branch -d phase/N && git push origin --delete phase/N`.
- Report to the owner: what works, measured numbers vs targets, open decisions pending, what Phase N+1 needs from them.
  The merge into `main` itself waits for the owner's go; commits on `phase/N` are pushed as they land.

## Token discipline inside the loop
- Never paste full files into briefs; name paths and signatures.
- Subagent replies are summaries; if one returns a dump, ask it to shorten before continuing.
- Keep the main thread free of build logs: builds and tests go through `verifier`.
- If a task fails twice with the same error, stop delegating, read the exact failing lines yourself, and fix inline.
