## Lime v1.148.0

Simplified Chinese release notes are the primary version.

### New Features

- Continued Codex-aligned TUI input and keymaps: configurable editor and Vim modal actions, search, history, kill/yank registers, paginated lists, and model/reasoning pickers share one keymap snapshot.
- Thread resume can carry the same rich draft together with edited question notes, approval choices, and MCP forms, then clean them up precisely on disconnect, recovery, and terminal Thread notifications.
- Prompt history and App Server public identity now use the canonical Thread ID; TUI and CLI continue to share App Server JSON-RPC, RuntimeCore, and Thread/Turn/Item projections.

### Fixes

- Preserved `TextElement` placeholders, image detail, attachments, and Skill identity across UTF-8 editing, trimming, queue edits, history, retries, and external-editor flows.
- Unified input-length validation and structured errors for start, steer, queue add/update, and RuntimeCore while retaining the complete draft, attachments, mentions, cursor, and local history on rejection.
- Fixed state leakage across thread switching, reconnect, resolved/terminal interaction notifications, history search, and input buffering; foreign Thread requests no longer write into the active BottomPane.
- Improved diff, transcript, textarea, request-user-input, and MCP elicitation layout and module boundaries for narrow terminals, reflow, focus, and terminal recovery.

### Improvements and Refactoring

- Split TUI submission, thread input, message history, composer, textarea, Vim, model catalog, resume picker, and interaction views into focused owners while retaining the shared App Server chain.
- Added current fixtures and structure guards for canonical prompt history, typed input lowering, queue/turn projection, CLI stdio, and TUI PTY Gate B flows.
- Updated TUI keymap, App Server command contracts, architecture guidance, operations documentation, and Codex-alignment execution records.

### Testing and Quality

- Expanded regression coverage for App Server protocol/schema/client contracts, input limits, prompt history, TUI interactions, Vim, editor and history restoration, queue edits, stdio, and PTY Gate B.
- Release validation is based on `npm run verify:app-version`, `npm run typecheck`, affected Rust/protocol tests, and GUI smoke results; full Rust CI, cross-platform packaging, signing, notarization, and npm distribution remain verified by the release pipeline.

### Documentation

- Updated `docs/ops.md`, App Server architecture and command boundaries, the TUI/CLI Codex-alignment plan, and structure inventory.

### Other

- This release adds no parallel runtime, history store, or compatibility backend. Desktop and CLI/TUI continue to share the `Product Surface -> App Server JSON-RPC -> RuntimeCore -> Thread/Turn/Item` chain.

**Full changes**: `v1.147.0` -> `v1.148.0`
