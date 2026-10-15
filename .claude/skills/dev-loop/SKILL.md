---
name: dev-loop
description: The cheapest-first check/test/build ladder and exact commands for GitBranch (cargo check, targeted tests, clippy, vitest, tauri build). Load before running any build or test so you run the right command at the right time.
---

# /dev-loop

Run the cheapest step that can fail first. Stop at the first failure, fix, re-run from that step.

| Step | Command | When |
|---|---|---|
| 1 | `cargo check -p git-core` (or the crate touched) | after every Rust edit |
| 2 | `cargo test -p <crate> <test_name> -- --nocapture` | the test you just wrote |
| 3 | `cargo test -p <crate>` | task end |
| 4 | `cargo clippy -p <crate> -- -D warnings` | task end |
| 5 | `pnpm typecheck && pnpm lint` | after every TS edit |
| 6 | `pnpm test -- <file>` then `pnpm test` | task end |
| 7 | `cargo test --workspace && pnpm check` | before commit when both layers changed |
| 8 | `pnpm tauri build` | phase end only (minutes, hundreds of MB of target/) |

Output hygiene: `cmd 2>&1 | tail -40` for cargo, `| grep -E "error|FAIL|✗" -A3 | head -40` for vitest/eslint.
Set `CARGO_TERM_COLOR=never` (already in settings env). Release perf tests: `cargo test -p git-core --release perf_ -- --ignored`.

Running the app for a manual check: `pnpm tauri dev` in the background (`run_in_background`), open a fixture repo
from `crates/git-core/tests/fixtures` or `C:\Data\RD\<some repo>`, then kill the process. Do not leave it running.

Fixture repos for ad-hoc checks: `cargo run -p git-core --example make_fixture -- <kind> <dir>` (added in Phase 0.5).
