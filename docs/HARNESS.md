# Claude Code harness for GitBranch

Goal: autonomous development with the lowest token spend that still produces correct code, interrupting the owner
only for decisions that are genuinely theirs. Everything lives under `.claude/` and is committed.

## Principles

1. **Route by task type, not by habit.** The main thread (Fable) plans, briefs, reviews and decides. Mechanical work
   goes to cheaper, isolated agents whose context is only the brief plus the files they need.
2. **Context is the cost.** Subagents return summaries, never file dumps. Nobody reads a whole file when a grep and a
   50-line window will do. Bash output is capped in settings; long outputs are piped through `tail`/`grep` first.
3. **Fast feedback before expensive feedback.** `cargo check` and a single test before `cargo test`; `cargo test` before
   `tauri build`; `tauri build` only at phase end.
4. **Decide, log, continue.** Routine choices are made and recorded in `docs/DECISIONS.md`. Only `open` decisions
   reach the owner, batched, with a recommended default.
5. **Formatting is a hook, not a review comment.** rustfmt/prettier run automatically after every edit.

## Routing table

| Task type | Who | Model | Effort | Input it gets | Output it returns |
|---|---|---|---|---|---|
| Find where something is / how it is done | `scout` | haiku | low | question + hints | paths + line ranges + 3-line answer |
| Implement a `git-core` feature + tests | `rust-dev` | sonnet | medium | brief with files, signatures, acceptance | diff summary + test results |
| Implement a UI component / store | `ui-dev` | sonnet | medium | brief + IPC types + design tokens | diff summary + screenshot path if any |
| Run checks/tests/build and report | `verifier` | haiku | low | the exact commands | pass/fail + first failing error, 20 lines max |
| Review a diff before commit | `reviewer` | opus | high | the diff (read-only) | ranked findings, or "LGTM" |
| Architecture, briefs, phase planning, ADRs, owner questions | main thread | fable | default | — | — |

Rules of thumb: anything under ~20 lines with a known location is done inline by the main thread (a subagent
round-trip costs more than the edit). Anything that needs reading more than 3 files is delegated.

## Skills (`.claude/skills/`)

| Skill | Use |
|---|---|
| `/phase N` | Run a whole phase from `docs/PLAN.md` autonomously: brief → delegate → verify → review → commit, task by task, updating checkboxes. |
| `/add-command <name>` | Recipe for a new git operation end-to-end (git-core op → tauri command → TS wrapper → UI hook → test). |
| `/dev-loop` | The cheap check/test/build ladder and the exact commands for this repo. Loaded by implementers. |
| `/decide` | Rubric for "decide myself vs ask the owner", and how to log an ADR. |

## Path-scoped rules (`.claude/rules/`)

`rust.md` applies to `crates/**` and `src-tauri/**`; `frontend.md` to `src/**`. They hold conventions that only
matter when editing those files, so they do not sit in `CLAUDE.md` for every turn.

## Hooks (`.claude/settings.json`)

- `PostToolUse` on `Edit|Write`: `.claude/hooks/format.mjs` runs rustfmt or prettier on the edited file if the tool
  is installed; silent otherwise. Removes a whole class of review churn.
- Nothing else. Hooks that run tests on every edit waste tokens on half-written code; tests are run deliberately
  by the `verifier` at the end of a task.

## Permissions

Allowed without prompting: `cargo`, `pnpm`, `node`, `npx`, `rustup`, `git` (local), `gh` read commands, `rustfmt`.
Always ask: `git push`, `gh pr create|merge`, `gh release`, anything deleting outside the repo.
Denied: `git push --force` (use `--force-with-lease`), `rm -rf /`, editing `~/.gitconfig`.

## Token budget guidance per phase (rough, for planning)

| Phase | Expected shape |
|---|---|
| 0 | mostly scaffolding; prefer generators (`create tauri-app`) over hand-written boilerplate |
| 1 | the graph algorithm is the one place where main-thread (Fable) effort pays off; UI rows → ui-dev |
| 2–4 | highly repetitive: one `/add-command` per operation, delegated in batches of 3–5 to `rust-dev` |
| 5 | github-api crate: delegate; device flow UI: delegate; security review: `reviewer` at high effort |
| 6 | polish; many small inline edits; CI runs replace local `tauri build` |

## When the owner is interrupted

Only for `open` decisions in `docs/DECISIONS.md`, phase-end demos, and anything irreversible or outward-facing
(push, PR, release, deleting data). Questions are batched and come with a recommended default so a one-word
answer unblocks the work.
