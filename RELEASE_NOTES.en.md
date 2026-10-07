## Lime v1.151.0

Simplified Chinese release notes are the primary version.

### New Features

- Added `/statusline` configuration with search, multiple selection, ordering, and previews of current thread facts. Confirmed preferences take effect immediately and persist in shared configuration, with options to disable the status line or its colors.
- Added `/title` configuration with live terminal-title previews, cancellation restoration, ordering, and restart persistence. Available facts include activity, required actions, thread, directory, model, and reasoning effort.
- Status lines and titles can show completed/total task counts from the App Server's structured plan. Progress is omitted when structured facts are unavailable.
- Unified export filename input with the multiline editor, including Vim, paste handling, dynamic height, and line breaks. Focus and Vim mode now determine the terminal cursor shape.

### Fixes

- Approval, user-input, MCP forms, and pickers now consistently honor configured shortcuts, chords, and unbound actions, with matching visible hints.
- Fixed truncated chords, duplicated footer-width deductions, and unrelated global hints in interactive overlays on narrow terminals.
- Fixed configuration conflict and cancellation boundaries for status lines and titles. GUI saves of other settings preserve ordered TUI preferences, explicit disabling, and custom keymaps.
- Terminal titles filter control characters and limit display length. Titles managed by the current process are cleared on exit or external-editor handoff and reapplied on return.

### Improvements and Refactoring

- Status-line and title setup share selection layout, canonical fact projection, and versioned configuration writes, replacing duplicate implementations.
- Moved export interaction into ChatWidget and kept terminal-title output and lifecycle management in the TUI host.
- Desktop and CLI/TUI retain the shared App Server, runtime, and canonical Thread/Turn/Item chain without private configuration storage or a parallel backend.

### Testing and Quality

- Expanded regressions for localized shortcuts in five languages, narrow layouts, export input, cursor styles, status lines, titles, and shared configuration.
- Expanded real PTY and stdio scenarios for preview, save, cancel, reopen, configuration conflicts, title output, and terminal restoration.
- Removed unused sidebar and scheduled-task translations consistently across five languages to resolve a local quality-gate blocker.
- Release-gate results and unverified platform scope are recorded in this version's release execution plan.

### Documentation

- Updated TUI operations, command boundaries, architecture diagrams, the Codex-alignment plan, and structure inventories.

### Other

- Unified the release version at `1.151.0`. Historical release notes remain available through Git history and GitHub Releases.

**Full changes**: `v1.150.0` -> `v1.151.0`
