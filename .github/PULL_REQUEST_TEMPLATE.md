## Summary

<!-- What does this PR change, and why? Link the related issue if there is one. -->

## Checklist

- [ ] `pnpm check` passes (typecheck, lint, prettier, rustfmt, clippy)
- [ ] `pnpm test` and `cargo test --workspace` pass (new/changed git-core logic has a fixture test)
- [ ] Git logic lives in `crates/git-core`; no shell, no new git argv in the UI
- [ ] No token or credential is logged, echoed or written outside the OS keyring
- [ ] **I have read and accept the [Contributor License Agreement](../CLA.md)**
