## Lime v1.179.0

> Simplified Chinese release notes are the primary version.

### New Features

- Add quick capture, screen capture entry points and side chat, with improved global dictation and desktop navigation shortcuts.
- Show bundled plugin versions on catalog cards.

### Fixes

- Fix Windows plugin cache renames and mutation lock handling, and improve installation state and user directory isolation.
- Correct Windows CLI execution policy test stack sizes, platform dependencies and terminal paths.
- Improve patch application, remote file updates and execution permission boundaries with a shared patch implementation.

### Improvements and Refactoring

- Import and adapt upstream shell, sandbox, execution service, protocol, state and history modules within the existing App Server and tool boundaries.
- Consolidate file search, HTTP/TLS, path and utility modules, removing replaced patch, command parsing and sandbox implementations.
- Add the AccountProvider contract while retaining Lime account services and its multi-model, multi-protocol and multimodal provider boundaries.
- Update Rust to 1.100.0 and synchronize workspace dependencies and release build configuration.

### Testing and Quality

- Extend regression coverage for desktop shortcuts, quick capture, screen capture, side chat and plugin installation.
- Improve Windows packaged validation with isolated user data, build dependencies and platform-specific handling.
- Record validation scope and results in the release execution plan and Release workflow.

### Documentation

- Update source migration records, module ownership and capability gap tracking.

### Other

- Align app, CLI, Rust workspace, and Cargo lockfile versions to 1.179.0.
- Official release platforms are macOS arm64/x64 and Windows x64.

**Full changes**: `v1.178.0` -> `v1.179.0`
