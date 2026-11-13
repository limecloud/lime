## Lime v1.176.0

> Simplified Chinese release notes are the primary version.

### New Features

- Add separate Cloud resource and connection authorization with recovery of original operations, sharing account and authorization state across Desktop, CLI, and TUI.
- Add pinned-release installation, enable/disable controls, pending-install cancellation, and acquisition reconciliation for the skills and MCP market, plus CLI market commands.
- Add Cloud desktop environment backup and release, restoration from private system images, and authorized delivery of local model connections to cloud computers.
- Add turn-completion and approval notifications, automatic archiving, history compaction, a terminal panel, and more editor and workspace preferences.
- Extend the TUI with plugin selection, Hooks, keymap editing, memory settings, process lists, change viewing, and session recaps.

### Fixes

- Improve complete runtime downloads, cache verification, temporary private OSS distribution and cleanup, and actual download progress reporting.
- Improve recovery of Cloud lifecycle, hibernation, reconnection, and authorization operations to reduce duplicate purchases, installations, and connection deliveries.
- Improve collapsed-by-default remote desktops, on-demand display connections, and cloud model setup guidance.
- Improve MCP OAuth, plugin dependency and installation recovery, and conversation tab, archive, and runtime state synchronization.

### Improvements and Refactoring

- Unify public App Server account, connection, and market protocols; synchronize schemas, generated clients, and Desktop and terminal consumers.
- Remove old remote plugin sharing and duplicate settings entry points in favor of current market, skills, and MCP owners.
- Update Simplified Chinese, Traditional Chinese, English, Japanese, and Korean resources, plus source-license presentation.

### Testing and Quality

- Add public JSON-RPC and component regression coverage for Cloud authorization, purchase preparation, lifecycle, model connections, and market installation and recovery.
- Extend CLI/TUI interaction, MCP OAuth, desktop notification, and workspace preference coverage.
- Live Cloud and cross-platform acceptance remains scoped by the relevant execution plans.

### Documentation

- Update both READMEs, Cloud instructions, architecture diagrams, command boundaries, and Hooks, MCP, and plugin contracts.

### Other

- Align app, CLI, and Rust workspace versions to 1.176.0.

**Full changes**: `v1.175.0` -> `v1.176.0`
