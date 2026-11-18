## Lime v1.180.0

> Simplified Chinese release notes are the primary version.

### New Features

- Add in-thread search, project-opening and side-chat shortcuts, and improve the empty conversation welcome screen.
- Add conversation title menu actions for opening a new window, moving to a project, and confirmed deletion.
- Add source summaries, expanded views, and a full sources page in the right panel.

### Fixes

- Clear accepted drafts after Enter submission while preserving failed submissions and edits made during sending.
- Fix invalid navigation arguments from model settings and missing thread instructions in the runtime.
- Prevent local projection and persistence work from incorrectly consuming the provider request deadline in long conversations.
- Anchor turn duration to its own timestamps and tighten session identity validation during history replay.
- Improve Windows plugin removal, cache lock handling, and terminal restoration tests.

### Improvements and Refactoring

- Persist incremental history without repeatedly writing full turns or cloning all events; validate and replay old logs one record at a time.
- Move cold history reads to background workers, avoid full hydration for empty queues, and optimize log encoding in development builds.
- Consolidate MCP configuration, server identity, catalog, and pagination within existing tool and permission boundaries.
- Consolidate model routing and chat services and remove unused duplicate crates while retaining Lime multi-model, multi-protocol, and service boundaries.
- Refine sidebar, composer, settings, scheduled task, and plugin layouts and interactions.

### Testing and Quality

- Complete a real basic DeepSWE session with 126/126 focused tests passing; native replay of the original tests scores reward=1.
- Extend regression coverage for draft settlement, instructions, history replay, turn timing, and real Electron recovery.
- The fixed amd64 grading image stalled under local QEMU; native grading does not establish a pass for that image.
- Platform installers, signing, and update artifacts are validated by this version's Release workflow.

### Documentation

- Update source alignment scope, MCP and model routing ownership, and session verification and release records.

### Other

- Align app, CLI, Rust workspace, and Cargo lockfile versions to 1.180.0.
- Official release platforms are macOS arm64/x64 and Windows x64.

**Full changes**: `v1.179.0` -> `v1.180.0`
