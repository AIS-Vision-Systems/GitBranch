# Contributing to GitBranch

Thanks for taking the time to contribute! This document explains how the project accepts changes.

## Contributor License Agreement

GitBranch is dual-licensed (noncommercial + commercial, see [`LICENSE.md`](LICENSE.md)). To keep both licensing paths viable, **all contributions require accepting the Contributor License Agreement in [`CLA.md`](CLA.md)**. By opening a pull request you confirm that you have read and accept the CLA; the pull request template includes an explicit checkbox for this. Pull requests whose authors do not accept the CLA cannot be merged.

## How changes land

- **Everything goes through a pull request** — the `main` branch does not accept direct pushes from contributors, CI must be green, and merging requires a review from a code owner.
- Open an issue first for anything non-trivial, so the approach can be discussed before you invest time in it.
- Keep pull requests focused: one feature or fix per PR.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/) in English, with the area in parentheses (`feat(graph):`, `fix(git-core):`, `refactor:`, `chore:`, `docs:`, `ci:`).

## Development setup

See the [README](README.md) for prerequisites and how to run the app (`pnpm tauri dev`).

## Quality bar

Before pushing:

```sh
pnpm check              # tsc + eslint + prettier + cargo fmt + cargo clippy (-D warnings) — must pass
pnpm test               # Vitest unit tests — must pass
cargo test --workspace  # Rust tests against real git on temporary fixture repos — must pass
```

Architecture and style rules (the full set lives in [`CLAUDE.md`](CLAUDE.md) and [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)):

- **Git logic only in `crates/git-core`.** Tauri commands in `src-tauri/src/commands` are thin wrappers; the UI never builds git argument lists.
- **`git` is spawned with `Command`, never through a shell**, and only with machine-readable flags (`-z`, `--porcelain=v2`, `--format` with `%x00`).
- **No libgit2, no bundled git, no telemetry, no Electron.** The app drives the `git` installed on the machine.
- **Tokens live only in the OS keyring** and are never logged or echoed.
- **Every git-core operation has a test** that runs real `git` on a temporary fixture repository (`crates/git-core/tests/fixtures.rs`).
- **`git push --force` is forbidden**; the only force push is `--force-with-lease`.
- Icons come from `lucide-react` through the single re-export file (named imports only); colours go through the theme CSS variables, never hardcoded.
- Non-trivial design choices are recorded as an ADR in [`docs/DECISIONS.md`](docs/DECISIONS.md) in the same PR.

## Out of scope

GitLab / Bitbucket / Azure DevOps integration, a bundled git, libgit2, a plugin system and telemetry of any kind are explicitly out of scope — PRs implementing them will be declined.

## Reporting bugs

Open a GitHub issue with steps to reproduce, the expected and the actual behavior, your OS (Windows/Linux) and `git --version`. For security vulnerabilities, see [`SECURITY.md`](SECURITY.md) — do **not** open a public issue.
