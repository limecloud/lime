## Lime v1.178.0

> Simplified Chinese release notes are the primary version.

### New Features

- Add workspace Git commits, branch creation, line attribution, and Pull Request creation, opening, status checks, and merging.
- Add a global command menu, file search, spotlight entry points, and dictation interactions, with improved desktop shortcuts.
- Import Chrome extensions, browsing history, and cookies into the embedded browser, with an extension toolbar and browser shortcuts.
- Add notification settings and dedicated extension management, and support multiple contact autofill emails, phone numbers, and addresses.

### Fixes

- Improve session path resolution, unread state, workspace file panels, and review-state synchronization.
- Correct realtime voice capability and model-connection handling, with public JSON-RPC regressions.
- Fix desktop build input tracking and renderer artifact handling, and improve workspace Git failure feedback.

### Improvements and Refactoring

- Synchronize Git workflows across App Server protocols, JSON schemas, generated clients, and desktop consumers.
- Update patch application, command parsing, safety checks, and execution policies, and harden CLI and App Server processes.
- Simplify desktop navigation and settings, removing the expert plaza, messaging channels, and legacy browser autofill implementation.
- Update Simplified Chinese, Traditional Chinese, English, Japanese, and Korean interface resources.

### Testing and Quality

- Add regressions for Git workflows, command menus, file search, Chrome imports, and notification settings.
- Record release verification, platform packaging, signing, notarization, and update results in the execution plan and Release workflow.

### Documentation

- Update product boundaries to remove expert plaza and messaging channel retention exceptions, and record release scope and validation.

### Other

- Align app, CLI, Rust workspace, and Cargo lockfile versions to 1.178.0.
- Official release platforms are macOS arm64/x64 and Windows x64.

**Full changes**: `v1.177.2` -> `v1.178.0`
