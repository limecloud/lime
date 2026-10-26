## Lime v1.172.0

Simplified Chinese release notes are the primary version.

### Features

- Add desktop permission setup with status checks, system settings shortcuts, and rechecks; reopen setup from settings, with all five interface languages covered.
- Support policy-controlled persistent Computer Use approvals for native apps and WPS, with target validation across sessions and turns.

### Fixes

- Fix lost browser navigation state, repeated mounts overwriting the current page, and native image display.
- Keep image generation tools open until the actual task result is available, propagate cancellation and timeouts, and share media projection between live messages and history recovery.
- Improve MCP tool display and message grouping, preserving server identity and separate tool entries while reducing repeated protocol content.
- Improve native input, cursor presentation, and user intervention handling on macOS and Windows.

### Improvements and Refactoring

- Consolidate native, Chrome, and Office Computer Use execution boundaries; remove the retired Chrome Bridge service and duplicate command entries.
- Package Electron JavaScript bundles and explicit native resources, validating the runtime dependency closure before packaging.

### Tests and Quality

- Add regression coverage for browser navigation recovery, desktop permissions, media projection, persistent approvals, and native hosts.
- Remove obsolete chat fixtures, synthetic scenario backends, and related logic; share lean infrastructure across current recovery, draft, and browser tests.
- Update Electron, CLI, Computer Use, and image generation fixtures and packaged resource guards.

### Documentation

- Update architecture documentation for desktop permissions, browser recovery, media projection, and package inputs.
- Update Chrome extension documentation, privacy policy, and submission guidance.

### Other

- Align app, CLI, and Rust workspace versions to 1.172.0.

**Full changes**: `v1.171.0` -> `v1.172.0`
