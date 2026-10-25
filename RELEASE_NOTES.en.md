## Lime v1.171.0

Simplified Chinese release notes are the primary version.

### Features

- Add Computer Use settings, adapter installation and grant management; extend Chrome and Excel/Office integration through the shared App Server and package CLI resources.
- Add the macOS Computer Use cursor and Windows cursor assets, plus Chrome extension sessions, tab groups, and interface resources in five languages.

### Fixes

- Persist and restore the selected browser tab and page URL for conversations; improve navigation and site permission handling.
- Fix Chinese Markdown link detection and refine MCP tool activity and message timeline rendering.
- Improve application shutdown cleanup, tool output conversion, model catalog metadata, and baseline chat protocol capabilities.

### Improvements and Refactoring

- Keep light, dark, and system appearance modes; remove custom themes, skins, random switching, and home decorations.
- Remove legacy personal style configuration, profile pages, and duplicate Skills entry points; synchronize protocols, generated clients, settings search, and five-language copy.
- Refine the conversation sidebar, composer, and local conversation page while preserving Lime branding, multiple models, expert marketplace, and messaging channels.

### Tests and Quality

- Update targeted regression coverage and fixtures for browser restoration, tool output, Computer Use, Chrome/Office, and interface behavior.
- Prioritize commit, tag, and push as requested. See the release execution record for checks and outstanding GUI, Rust, and packaged platform validation; these notes do not claim complete platform acceptance.

### Documentation

- Update architecture, command boundaries, source alignment rules, and related execution plans.

### Other

- Align app, CLI, and Rust workspace versions to 1.171.0.

**Full changes**: `v1.170.0` -> `v1.171.0`
