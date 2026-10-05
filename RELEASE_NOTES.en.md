## Lime v1.150.0

Simplified Chinese release notes are the primary version.

### New Features

- Continued ChatWidget session convergence for runtime keymap, clipboard and right-click paste, queued submissions, per-thread draft snapshots, turn lifecycle, and startup warning presentation.
- Changed history pagination, resume preview, and transcript loading to an asynchronous completion/event flow with thread and cursor ownership checks while keyboard, redraw, and App Server notifications remain responsive.
- Added ChatWidget ownership for approval details, transcript wheel and selection drag handling, resume/Agent/model/export pickers, and external editor lifecycle.

### Fixes

- Fixed state handoff, duplicate requests, and incorrect loading resets during history pagination, resume preview, scrolling, search, reconnect, and terminal recovery.
- Fixed interaction boundaries for disabled input, draft restoration, queue editing, clipboard races, modal/pager selection, and picker cancellation.
- Fixed rendering and lifecycle issues in narrow terminals, focus transitions, approval details, and asynchronous external-editor returns.

### Improvements and Refactoring

- Removed remaining App-level ChatWidget fields, getters/setters, and legacy `thread_settings`, command popup, and status indicator entry points in favor of current ChatWidget/BottomPane owners.
- Split ChatWidget into focused input, interaction, settings, transcript, and footer modules; App remains responsible for host lifecycle, transport/session, Thread routing, and canonical projection.
- Kept the single `Product Surface -> App Server JSON-RPC -> RuntimeCore -> Thread/Turn/Item projection` chain without a local history/queue backend, parallel runtime, or compatibility shell.

### Testing and Quality

- Expanded TUI ChatWidget, history pagination, picker, queue, input, recovery, PTY, and structure-guard coverage, and refreshed Codex-alignment and structure inventories.
- Added CLI/TUI Gate B coverage while continuing to reuse the App Server JSON-RPC and canonical Thread/Turn/Item facts.
- Fixed the Windows N-1 upgrade gate to open the real Settings → About entry when the previous version has not started checking, while retaining download, restart installation, and version checks.
- Release validation runs `npm run verify:app-version`, `npm run typecheck`, `npm run test:contracts`, focused Rust TUI tests, and `npm run verify:gui-smoke`; any failed gate is recorded in the release plan.

### Documentation

- Updated architecture confirmation, the TUI/CLI Codex-alignment execution plan, TUI structure inventories, and the release execution plan.

### Other

- Desktop and CLI/TUI continue to share the same App Server/runtime/canonical projection; retired runtimes and production mock fallbacks remain absent.

**Full changes**: `v1.149.0` -> `v1.150.0`
