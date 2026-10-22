## Lime v1.167.0

Simplified Chinese release notes are the primary version.

### Features

- Share workspace tabs across browser pages, Files, and Changes, with URL entry, page search, device viewport controls, and native menus.
- Add webpage annotations and screenshot context for sending selected page content and feedback to a conversation.
- Add browser history management and preferences for browsing, downloads, and Agent site permissions.

### Fixes

- Open original disk or session-storage files directly, including empty files, matching names in different directories, and asynchronous navigation.
- Improve annotation reopening, location restoration, draft retention, and target paths for tool file buttons and change review.
- Strengthen staged approval for browsing and sensitive page actions, rejecting stale control, repeated tokens, and requests from other scopes.

### Improvements and Refactoring

- Consolidate file preview, directory state, and resizing in Files; remove duplicate Canvas previews and unused file-opening paths.
- Separate browser Host responsibilities for pages, history, permissions, annotations, and overlays; synchronize Electron IPC, typed gateways, and command catalogs.
- Cover browser and file interactions in Simplified Chinese, Traditional Chinese, English, Japanese, and Korean.

### Tests and Quality

- Extend browser permission, history, tab identity, file path, annotation, and editing lifecycle regressions and real Electron scenarios.
- Complete native passwords, Autofill, profile import, extensions, and full Codex GUI alignment remain subject to their dedicated acceptance plans.

### Documentation

- Update browser, Files, and shared-runtime architecture, implementation boundaries, and verification records.

### Other

- Align app, CLI, and Rust workspace versions to 1.167.0.

**Full changes**: `v1.166.0` -> `v1.167.0`
