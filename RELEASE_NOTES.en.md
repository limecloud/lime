## Lime v1.149.0

Simplified Chinese release notes are the primary version.

### New Features

- Continued Codex-aligned TUI ChatWidget work: input and interaction state, transcript presentation, Agent Center, and model/agent/resume/export pickers now converge on one ChatWidget owner.
- Added a collapsible sidebar rail, expandable project conversation groups with incremental loading, and searchable navigation for plugins, skills, and installed catalogs.
- Added a stable localized placeholder card for unsupported transcript items, with diagnostic fields collapsed by default and expandable on demand.
- Redesigned scheduled tasks with a compact list and editor for immediate creation, editing, filtering, search, recurring schedules, and run previews.

### Fixes

- Fixed route parameters and page state getting out of sync when plugin catalog filters, search, and details changed within the sidebar.
- Fixed duplicate owner and state handoff issues across TUI thread switching, recovery, scrolling, search, focus changes, and transient picker lifecycles.
- Fixed rendering and interaction boundaries for narrow terminals, fullscreen Agent Center, reflow, reconnect, and terminal recovery.
- Fixed scheduled-task validation and form hydration for titles, times, time zones, weekdays, and enabled state with consistent five-locale copy.

### Improvements and Refactoring

- Removed the old App-level BottomPane, transcript, Agent Center, picker fields, and mapper names; ownership now moves directly to current ChatWidget/BottomPane owners without compatibility shells.
- Split sidebar, settings navigation, rail, plugin customization, and load-more components while standardizing Lime design tokens and accessible interactions.
- Extracted a shared scheduled-task editor owner so create/edit dialogs and list actions use one form source of truth.
- Extracted unsupported-item rendering, TUI structure inventory, PTY/stdio fixtures, and Vitest batching into focused owners while retaining the shared App Server JSON-RPC and canonical Thread/Turn/Item chain.

### Testing and Quality

- Expanded regression coverage for ChatWidget ownership, Agent Center, pickers, transcript presentation, PTY Gate B, CLI Gate B, sidebar, settings layout, plugin catalog, and unsupported items.
- Release validation runs `npm run verify:app-version`, `npm run typecheck`, `npm run test:contracts`, and `npm run verify:gui-smoke`; cross-platform packaging, signing, notarization, and npm optional packages remain verified by the release pipeline.

### Documentation

- Updated architecture guidance, the TUI/CLI Codex-alignment execution plan, structure inventory, and the v1.149.0 release execution plan.

### Other

- This release adds no parallel runtime, protocol backend, history store, or compatibility implementation. Desktop and CLI/TUI continue to share the `Product Surface -> App Server JSON-RPC -> RuntimeCore -> Thread/Turn/Item` chain.

**Full changes**: `v1.148.0` -> `v1.149.0`
