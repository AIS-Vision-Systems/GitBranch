<p align="center">
  <img src="docs/assets/logo.svg" alt="GitBranch logo" width="128">
</p>

<h1 align="center">GitBranch</h1>

<p align="center">Lightweight Git desktop client for Windows and Linux. Commit graph first, GitHub integration, worktrees.</p>

GitBranch drives the `git` you already have installed and shows your repositories as a commit graph you can work on directly: check out, merge, rebase, cherry-pick, stash and push from the graph, with every destructive command shown before it runs and an Undo for the last move of HEAD. Built with Tauri 2, Rust and React/TypeScript by [AIS Vision Systems](https://github.com/AIS-Vision-Systems). No bundled git, no libgit2, no telemetry, no Electron.

## Features

- **Commit graph first** — every branch and tag in a three-column layout (refs, lanes, message), with the work in progress as the first row. Branch chips: double-click to check out, drag onto a commit to move a branch, right-click for merge, rebase, rename, delete, upstream and push. Commit menu: checkout, branch or tag here, cherry-pick, revert, reset (soft / mixed / hard), interactive rebase, add a worktree here.
- **Filter and history** — `Ctrl+F` filters by author, message or path; "File history" on any file fills the path filter.
- **Safe by design** — every destructive action shows the exact git command before it runs; **Undo** / **Redo** rewind and re-apply the last movement of HEAD; the only force push is `--force-with-lease`.
- **Working tree** — staged / unstaged files as a tree or flat list; stage or unstage per file, per hunk or per line from the diff; amend, sign-off and commit templates; "Commit and push".
- **Diffs and blame** — unified or split view, word wrap, a change ruler, blame per line, and "Open in difftool" for your external tool.
- **Conflicts** — a banner while a merge, rebase, cherry-pick or revert is paused: abort, continue or skip, take ours or theirs per file, open in your editor.
- **Branches, stashes, remotes** — sidebar with Local and Remote branches as folders, ahead/behind badges, stashes popover, remote management, fetch / pull (fast-forward, rebase, merge) / push / prune.
- **Worktrees** — each worktree opens as its own tab; add, remove, lock, unlock and prune from the sidebar.
- **GitHub** — sign in with the device flow (the token lives in the OS keyring and never leaves the machine except to GitHub); pull requests in the sidebar (open, closed, mine; checkout; create from the current branch); clone from your account; author photos on commits; HTTPS pushes to private repositories without prompts.
- **Tabs, palette, shortcuts** — one tab per repository or worktree with aliases, a command palette (`Ctrl+K`) listing every action and its shortcut, window and pane layout restored on the next start.
- **Windows 11 and Ubuntu** support, light and dark themes, and an in-app signed update check (startup + daily, opt-out in Settings).

The full user guide ships inside the app (help button) and lives in [`src/help/guide.en.md`](src/help/guide.en.md).

## Download

Grab the latest installer from the [Releases page](https://github.com/AIS-Vision-Systems/GitBranch/releases/latest):

- **Windows**: NSIS installer (`.exe`)
- **Ubuntu/Linux**: `.deb` package or `.AppImage`

GitBranch needs a `git` executable on the machine (2.31 or newer); the path is configurable in Settings. The app checks for new versions on startup and once a day, and offers "Update and restart" when one is available.

## License

GitBranch is dual-licensed:

- **Free for noncommercial use** under the [PolyForm Noncommercial License 1.0.0](LICENSE.md).
- **Commercial use** requires a [commercial license](LICENSE-COMMERCIAL.md) from AIS Vision Systems.

## Building from source

### Prerequisites — Windows 11

1. **Rust** (stable, MSVC toolchain):
   ```powershell
   winget install Rustlang.Rustup
   rustup default stable-x86_64-pc-windows-msvc
   ```
2. **Visual Studio C++ Build Tools** — install [Visual Studio](https://visualstudio.microsoft.com/) (Community is fine) with the _Desktop development with C++_ workload, or the standalone Build Tools.
3. **WebView2** — preinstalled on Windows 11.
4. **Node.js** ≥ 20 and **pnpm** (`corepack enable` picks the version pinned in `package.json`).
5. **Git** on `PATH` (the app and the test suite drive the real `git`).

### Prerequisites — Ubuntu

1. System packages:
   ```sh
   sudo apt update
   sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
     libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev git
   ```
2. **Rust** (stable):
   ```sh
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   ```
3. **Node.js** ≥ 20 and **pnpm** (`corepack enable`).

### Running

```sh
pnpm install
pnpm tauri dev
```

The first run compiles the Rust side and takes a few minutes; subsequent runs are fast.

### Building

```sh
pnpm tauri build
```

Produces a platform installer/bundle under `target/release/bundle/`.

## Development

```sh
cargo check -p git-core          # fastest feedback on the git layer
cargo test -p git-core <name>    # one test (real git on a temporary fixture repo)
cargo test --workspace           # all Rust tests
pnpm test                        # Vitest unit tests
pnpm check                       # fmt + lint + typecheck + clippy, all layers; must pass before any commit
```

- Plan and status: [`docs/PLAN.md`](docs/PLAN.md)
- Architecture: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- Decisions (ADRs): [`docs/DECISIONS.md`](docs/DECISIONS.md)
- Changelog: [`docs/CHANGELOG.md`](docs/CHANGELOG.md)

See [`CLAUDE.md`](CLAUDE.md) for architecture rules and workflow conventions, and [`CONTRIBUTING.md`](CONTRIBUTING.md) for how to contribute. Contributions require accepting the [Contributor License Agreement](CLA.md). Security issues: see [`SECURITY.md`](SECURITY.md).

## Publishing a release (maintainers)

1. Bump the version in `package.json`, `src-tauri/tauri.conf.json` and the `[workspace.package]` table of `Cargo.toml` (then refresh `Cargo.lock`), add the entry to `docs/CHANGELOG.md`, merge to `main`.
2. Tag it: `git tag vX.Y.Z && git push origin vX.Y.Z`. The `release` workflow refuses a tag that does not match all three versions.
3. The workflow builds the Windows (NSIS) and Linux (deb, AppImage) installers, signs the updater artifacts, and uploads them with `latest.json` to a **draft** release. Review the draft and publish it; the in-app update check only sees published releases.

## Credits

Original development by **Xavi Anguera**. A project of **AIS Vision Systems**.
