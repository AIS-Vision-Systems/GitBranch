---
paths:
  - "src/**"
---

# Frontend conventions (GitBranch)

- TypeScript strict, no `any`, no default exports except route/entry files. Function components + hooks only.
- State in Zustand stores under `src/state/`; components read slices with selectors, never the whole store.
- IPC wrappers in `src/ipc/<area>.ts`: `export async function listBranches(repoId: RepoId): Promise<Branch[]>`
  calling `invoke("list_branches", { repoId })`. Types mirror the Rust structs (camelCase). Components never import
  `@tauri-apps/api/core` directly.
- Styling: CSS modules + tokens from `src/styles/tokens.css` (`var(--color-...)`, `var(--space-...)`). No inline
  colors, no Tailwind, no CSS-in-JS runtime.
- Graph rows: pure, memoized, keyed by oid; they draw from `Row` only. Row height is a fixed token (`--graph-row-h`).
- Keyboard first: every action reachable from the command palette and a shortcut; dialogs trap focus.
- Tests: vitest + testing-library for logic and stores; snapshot tests only for the lane SVG path strings.
- Prettier formats (hook); eslint flat config, `pnpm lint` must be clean.
