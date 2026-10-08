## Lime v1.152.0

Simplified Chinese release notes are the primary version.

### New Features

- Added observed token usage and context percentages to TUI status lines, terminal titles, and `/status`. The regular composer footer can show remaining context, with Vim and narrow-terminal layouts.
- Press Esc twice in an empty composer to browse, revert, and edit earlier input while preserving text markers, images, and Skill/Mention references. Reverting keeps the thread, does not roll back workspace files, and does not submit the restored input automatically.

### Fixes

- Fixed duplicated reasoning summaries after completion and history restoration. Delta whitespace is preserved so streamed text matches persisted content.
- Restoring an active turn retains its trailing reasoning summary and accepts later deltas without a start event. Reconnection and older pages preserve current progress, and late events cannot reopen finished turns.
- The TUI displays reasoning summaries by default. Raw reasoning no longer substitutes for missing summaries, changes activity status, or enters history exports. Details preserve paragraphs, links, and narrow-screen indentation without repeating activity titles or empty placeholders.
- Failed history reads retain the reading position and draft with retry support. Failed refreshes after reverting block submission to prevent stale context.
- Usage displays distinguish unknown data from observed zero values and reject notifications from earlier turns. Status-line and title preferences save deduplicated canonical names.

### Improvements and Refactoring

- Unified resume, reconnect, session previews, and exports around paginated App Server history and turn facts, replacing duplicate read paths. Legacy sessions remain readable and explicitly report that reverting is unsupported.
- Separated reasoning projection, notification handling, history browsing, and footer layout, sharing structured input restoration and usage formatting. Desktop, CLI, and TUI retain the same App Server and canonical Thread/Turn/Item chain.
- Updated updater distribution to use multipart uploads with object-size and digest verification. Upload failures block publication, and update feeds are uploaded only after all payloads pass.

### Testing and Quality

- Expanded localized usage, history-revert, pagination, reasoning-summary, and status-line regressions, plus real PTY and stdio scenarios.
- The desktop reasoning fixture verifies that summaries appear before the final answer, appear once after expansion, and hide raw reasoning while retaining the complete read model. Skills and expert fixtures now use current visible sidebar navigation.
- Release-gate results and unverified platform scope are recorded in this version's release execution plan.

### Documentation

- Updated TUI operations, command boundaries, architecture diagrams, the Codex-alignment execution plan, and structure inventories.

### Other

- Unified the release version at `1.152.0`. Historical release notes remain available through Git history and GitHub Releases.

**Full changes**: `v1.151.0` -> `v1.152.0`
