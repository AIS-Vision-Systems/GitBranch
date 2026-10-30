# User guide

## Repositories and tabs

GitBranch works on repositories that already exist on disk and drives the `git` you have installed. The welcome screen opens a folder (`Ctrl+O`), reopens a recent one, or clones a repository (`Ctrl+Shift+C`, also from your GitHub account).

- Every open repository is a **tab** in the top row. `Ctrl+T` or the `+` tab opens the welcome screen without closing the others; `Ctrl+W` closes the current tab; `Ctrl+PageUp` / `Ctrl+PageDown` switch tabs.
- A **worktree** opens as its own tab, with its own working tree and HEAD.
- The window, the open tabs and the pane widths are restored on the next start.

## The ribbon

The row under the tabs holds the everyday actions. Left: the current repository and branch (open the branch list to check out another one; the counters show how far ahead or behind its upstream it is). Centre: **Undo** (`Ctrl+Z`) and **Redo** (`Ctrl+Y`), **Fetch** (fetches every remote and prunes branches deleted there; the caret offers fetch all and pull fast-forward / rebase / merge), **Push**, **Branch**, **Stash**, **Pop** and **Terminal** (opens a terminal at the working tree). Right: the **Actions** menu (Clone, Remotes, Stashes, Toggle sidebar, Settings) and **Search**.

The status bar at the bottom shows the progress of a running fetch, pull, push or clone (with **Cancel**, or `Esc`) and the GitBranch version on the right. The repository you are looking at refreshes by itself: local changes show up at once, and a silent fetch every 10 seconds (and when the window regains focus) brings new and deleted remote branches. Change the interval, or set it to 0 to turn it off, under **Settings › Git › Auto-fetch interval**.

Every action is also in the **command palette** (`Ctrl+K`), which lists its shortcut.

## Commit graph

The graph shows every branch and tag with the GitKraken three-column layout: refs, lanes, message. The first row is your **work in progress**.

- Click a commit to see its details and changed files on the right; `Up` / `Down` move the selection.
- **Branch chips**: double-click to check out; drag a chip onto a commit to move the branch; right-click for merge, rebase, rename, delete, upstream and push.
- **Commit menu** (right-click): checkout, create branch or tag here, cherry-pick, revert, reset (soft / mixed / hard), interactive rebase from here, add a worktree here.
- `Ctrl+F` opens the **filter bar** (author, message, path). "File history" on a file fills the path filter.
- Every destructive action shows the exact git command before it runs. **Undo** rewinds the last movement of HEAD; **Redo** re-applies it until HEAD moves somewhere else.

## Working tree and commits

The work-in-progress panel lists **Staged** files above **Unstaged** ones, as a tree or flat (toggle in the header). Click a file to open its diff in the centre pane; stage or unstage per file, per hunk or per line from the diff. Discard asks first.

The commit box supports amend, sign-off and the repository's commit template. **Commit and push** pushes right after committing.

## Diffs and blame

Unified or split view, a **Wrap** toggle, and a change ruler at the right edge (click a mark to jump). The **Whole file** toggle (on by default) shows the entire file with the unchanged lines between and around the hunks; the diff opens scrolled to the first change, and the toggle off returns to hunks only. **Blame** (right-click a file, or the button in the diff header) shows who last touched each line. "Open in difftool" sends both sides to the external tool from Settings.

## Branches, stashes, remotes

- **Branch** creates a branch at HEAD and checks it out.
- **Stash** saves the working tree; **Pop** restores the most recent one. The Stashes popover lists, applies and drops them.
- **Remotes** adds, renames and removes remotes. Fetch, pull and push have shortcuts (`Ctrl+Shift+F` / `Ctrl+Shift+L` / `Ctrl+Shift+P`). Push uses `--force-with-lease` only; a plain force push does not exist in GitBranch.
- Git over HTTPS gets the GitHub token from the app, so private repositories work without prompts once you are signed in. SSH remotes use your system agent: if a push or fetch is refused with `Permission denied (publickey)`, the error offers **Fix SSH…** (also in the command palette), a dialog that checks the agent and your keys, loads a key after asking its passphrase, tests the connection, and can switch a github.com remote to HTTPS while you are signed in.

## Conflicts

A banner appears while a merge, rebase, cherry-pick or revert is paused on conflicts: abort, continue or skip, take ours or theirs per file, mark as resolved, or open the file in your editor.

## Worktrees and GitHub

The sidebar (`Ctrl+B`) has four collapsible sections with a filter box on top: **Local** and **Remote** branches as folders (a check marks the current branch, the arrows show ahead/behind; click selects the commit, double-click or `Enter` checks out, right-click opens the branch menu, "+" on Remote adds a remote), **worktrees** (add with `Ctrl+Shift+W`, remove, lock, unlock, prune) and, for GitHub repositories, **pull requests** (open, closed, mine; checkout; open in browser; create from the current branch). Drag its edge to resize it; the chevron in its top bar collapses it to an icon rail, and clicking a rail icon jumps back to that section.

**Sign in** from the account button: GitHub shows a one-time code, the token goes to the operating-system keyring and never leaves the machine except to GitHub. The account panel shows the signature used for your commits (name and email, editable globally or for the current repository), the granted scopes and the API budget. Sign out removes the local token; Revoke opens the GitHub page that invalidates it.

## Settings and updates

The gear (`Ctrl+,`) opens Settings: theme, path of the git executable (applies after a restart; when empty GitBranch uses the `git` on `PATH`, or on Windows a standard Git for Windows install; GitBranch does not ship git), default pull strategy, auto-fetch interval, diff context and whitespace, external editor, difftool, terminal, and the automatic update check. The log folder holds a daily `gitbranch.log` for seven days; GitBranch sends no telemetry.

Updates are checked at startup and once a day; the card offers "Update and restart". "Check for updates" is also in this window and in the palette.

## Shortcuts

| Action | Shortcut |
| --- | --- |
| Command palette | `Ctrl+K` |
| Open repository | `Ctrl+O` |
| New tab / Close tab | `Ctrl+T` / `Ctrl+W` |
| Filter commits | `Ctrl+F` |
| Toggle sidebar | `Ctrl+B` |
| Undo / Redo | `Ctrl+Z` / `Ctrl+Y` |
| Fetch / Pull / Push | `Ctrl+Shift+F` / `Ctrl+Shift+L` / `Ctrl+Shift+P` |
| Clone | `Ctrl+Shift+C` |
| Add worktree | `Ctrl+Shift+W` |
| Settings | `Ctrl+,` |
| Cancel a running operation | `Esc` |
