## Lime v1.153.0

Simplified Chinese release notes are the primary version.

### New Features

- CLI `exec` now supports resuming and forking sessions by ID, exact name, or most recent session, preserving shared history and lineage. It also supports image input, `--output-schema`, and saving the final successful message.
- CLI `exec review` supports uncommitted changes, branch comparisons, specific commits, and custom instructions through shared `review/start` and the same terminal-output contracts.
- Added a shared raw-reasoning preference. GUI and TUI show summaries by default and display raw content when explicitly enabled; CLI reasoning output can be hidden independently.
- Added reasoning-effort indicators, one-time animations, and status-line transitions to the TUI composer, with an option to disable animations.

### Fixes

- Fixed missing notifications after session forks and projection identity conflicts when forking restored sessions. Historical Turn/Item identities and source-session content are preserved.
- Removed duplicate reasoning Items from the desktop fixture. Live display, renderer reloads, and history restoration retain the same identities and complete content, with separate summary and raw-content policies.
- Fixed modified Enter, repeated key events, and control-key handling in completion popups to prevent unintended submission or interception of editor actions. Empty completion lists now accept and close correctly.
- Fixed empty-composer Left navigation to respect editor and Vim key rebinding or removal, with matching footer hints.
- Fixed fragmented multibyte decoding in terminal tests and made selection, ordering, and exit checks observe actual screen state.

### Improvements and Refactoring

- Moved non-interactive CLI execution into a dedicated exec owner and unified tool, plan, error, usage, and reasoning output. JSONL uses machine events with distinct stdout and stderr responsibilities.
- Resume, fork, stdin decoding, and final-message output share existing contracts. Failed or interrupted runs preserve existing output files, and file-write failures return an explicit error.
- Moved file and Skill completion popups to their domain directories and separated reasoning animations, projection, and fork hydration. Desktop, CLI, and TUI continue to share App Server and canonical Thread/Turn/Item facts.
- Carries forward the previous release's Windows gate fixes to execute real entrypoints and require essential release evidence uploads.

### Testing and Quality

- Expanded shared-config, reasoning-display, CLI machine-event and packaged-schema, session-fork, and TUI completion/animation regressions.
- Extended real stdio, PTY, npm-launcher, and Electron fixtures for identity, cold restoration, image bytes, structured-output contracts, and terminal restoration.
- Actual release-gate results and unverified platform scope are recorded in this version's release execution plan.

### Documentation

- Updated CLI/TUI operations, npm-package documentation, shared configuration, command boundaries, architecture diagrams, and Codex-alignment structure inventories.

### Other

- Unified the release version at `1.153.0`. Historical release notes remain available through Git history and GitHub Releases.

**Full changes**: `v1.152.0` -> `v1.153.0`
