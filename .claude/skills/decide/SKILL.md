---
name: decide
description: Rubric for GitBranch on whether to decide autonomously or ask the owner, and how to record the decision in docs/DECISIONS.md. Load whenever a choice comes up that is not covered by the plan or architecture.
---

# /decide

## Decide yourself (and log it) when
- It is reversible in one commit (library choice inside a crate, file layout, naming, algorithm details, test strategy).
- `docs/ARCHITECTURE.md` or an accepted ADR already implies the answer.
- It is a UX detail with an obvious convention (shortcuts, dialog wording, ordering).
- The cost of being wrong is < the cost of a round-trip with the owner.

Log format, appended to `docs/DECISIONS.md`:
```
## D-nnn · accepted · YYYY-MM-DD — <title>
Context: <1–2 lines>  Decision: <1 line>  Consequences: <1 line>
```

## Ask the owner when (mark `open` in DECISIONS.md, continue with other work)
- Owner-only actions: GitHub OAuth App, signing keys, accounts, pushing/publishing, spending money.
- Scope changes: dropping or adding a PLAN item, changing targets, supporting a new platform/provider.
- Visible product direction with no convention: layout of the main window, default pull strategy, what "undo" means.
- Security posture: token scopes, what is stored on disk, capability widening in Tauri.
- Anything irreversible or that touches the owner's real repositories.

## How to ask
- Batch: collect open decisions until a natural stop (task end or phase end), then ask once.
- Each question: one line of context, the options, **a recommended default**, and what happens if unanswered
  ("default applies at Phase N start").
- Use `AskUserQuestion` with the recommended option first. Never block work that does not depend on the answer.
