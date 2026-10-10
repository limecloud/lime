## Lime v1.154.0

Simplified Chinese release notes are the primary version; this English companion summarizes the same release.

### Features

- Add top-level `lime review` for uncommitted changes, a base branch, a specific commit, or custom instructions, using the shared `review/start` and terminal output.
- Give TUI questions and MCP forms shared text editing with per-question/field drafts, cursor positions, full paste content, revision, unanswered confirmation, and complete notes.
- Keep the TUI screen visible while an external editor waits, restore input/cursor/terminal modes on return, and allow successful edits to clear a draft.

### Fixes

- Preserve ASCII/IME input order and Enter/Tab in rapid question-note pastes, expand full text on submission, and save input before changing questions.
- Correct external editor parsing of empty arguments, quotes, and backslashes with platform parsers and errors in all five supported languages.
- Use the current thread directory for the external editor buffer after resuming a thread from a different launch directory.
- Dispatch standard MCP progress notifications with arbitrary-precision JSON; retain form ownership and call scope for explicit tool calls on thread-owned connections.
- Correct Windows Terminal Shift+Enter decoding and Console input-mode restoration. Platform-specific behavior still requires Windows machine validation.

### Improvements and Refactoring

- Improve terminal draw scheduling and enable layout caching without duplicate input wiring or a second persistent screen state.
- Unify question-note encoding, fallback options, and confirmation key bindings; `/` on an empty main Vim composer can open command completion.
- Consolidate external editor, MCP form, and question owners by replacing obsolete parsing/handoff paths while keeping the shared GUI/CLI/TUI backend.

### Tests and Quality

- Extend real CLI stdio, TUI PTY, MCP form, and external editor screen regressions for canonical identities, exactly-once responses, text/images, and terminal restoration.
- Snapshot locally built terminal gate binaries with runtime siblings to avoid shared-target rebuild interference, and correct combined MCP scenario routing.
- Run exact current App Server filesystem/timeout contracts in Windows CI and reject zero-test false positives.

### Documentation

- Update CLI/TUI operations, architecture, command boundaries, structure inventories, and execution plans; fix Docs/Pages generation and deployment configuration.

### Other

- Align the desktop app, CLI npm package, and Rust workspace at `1.154.0`.

**Full Changelog**: `v1.153.0` -> `v1.154.0`
