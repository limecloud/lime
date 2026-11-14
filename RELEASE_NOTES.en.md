## Lime v1.177.2

> Simplified Chinese release notes are the primary version.

### New Features

- Add default-microphone dictation in the TUI and periodically refresh the parent conversation while a side conversation is open.
- Show realtime voice availability and explicit blockers for the current model connection in voice settings.
- Connect temporary realtime voice credentials and WebRTC sessions, with model and voice selection and connection feedback.
- Add browser password manager selection and improve extension, site-permission, and model-connection feedback.
- Add desktop menu entries for new tabs, windows, and chats, and improve app snapshot and workspace review shortcuts.

### Fixes

- Fix packaged macOS validation getting blocked by a delayed first-run permission guide; continue through the normal “Set up later” action.
- Fix Windows workbench reload failures caused by starting macOS-only app snapshot listeners.
- Check Input Monitoring permission before starting macOS app snapshot shortcuts to avoid unauthorized monitoring calls on first launch.
- Improve attachment handling, pending app snapshot recovery, settings search, and voice and connection state synchronization.
- Export the realtime voice Provider snapshot in Rust and update app snapshot shortcut preference regressions.
- Fix a missing runtime TOML dependency in Electron packages, overflowing protocol test timestamps, and overly broad version-script matching.
- Upgrade the TOML dependency to a patched version to address a high-severity denial-of-service vulnerability in malformed documents.

### Improvements and Refactoring

- Limit release artifacts to macOS arm64/x64 and Windows x64, removing Linux distribution targets and upload steps.
- Synchronize realtime voice capabilities across public protocols, JSON schemas, generated clients, and frontend consumers; explicitly report unavailable transports.
- Simplify redundant App Server conversions and test code while retaining current runtime, projection, and Provider ownership.
- Update Simplified Chinese, Traditional Chinese, English, Japanese, and Korean settings resources.
- Improve appearance fonts, sizes, code styling, and light/dark settings, together with Markdown and diff review rendering.
- Remove the custom browser password store and SSH settings entry, retaining contact autofill.

### Testing and Quality

- Cover delayed permission guides, completed preferences, invalid responses, and failure handling.
- Extend public realtime voice JSON-RPC, password manager preferences, site settings, connection, app snapshot, and attachment regressions.
- Cross-platform packaging, notarization, installation, update, and publication results are recorded by the current Release workflow and execution plan.

### Documentation

- Record the release recovery cause, candidate scope, validation, and same-version publication results.

### Other

- Align app, CLI, Rust workspace, and Cargo lockfile versions to 1.177.2.

**Full changes**: `v1.176.0` -> `v1.177.2`
