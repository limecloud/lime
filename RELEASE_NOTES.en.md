## Lime v1.169.0

Simplified Chinese release notes are the primary version.

### Features

- Add browser device presets, custom viewport dimensions and zoom controls; improve page search, new-tab address drafts, and page focus handoff.
- Add grouped browser visits, search and bulk deletion, with settings for download directories, site permissions, and Agent browser admission.
- Add user and project configuration layers, managed sources and requirements, and version-checked writes to editable configuration.
- Add reasoning effort defaults and enabled effort choices for new chats, respecting model capabilities and configuration scope.
- Add bulk cleanup of archived chats and diagnostic, installation, and cancellation interfaces for Node/Python tool runtimes.

### Fixes

- Capture the modified page on the first save or send of a design annotation, preserving screenshot and draft identity and editor event ordering while rejecting stale results.
- Validate page, origin, tab, and control identity for native site permission requests; revoke pending grants on navigation or control changes.
- Serialize configuration writes while preserving user and project version conflict checks to prevent stale views from overwriting newer settings.
- Unify disabled, cached, and live web search access policies and enforce network and sandbox constraints before tool execution.

### Improvements and Refactoring

- Remove the standalone knowledge and resource management surfaces, retired statistics and developer settings, and the creative context injection chain; keep image outputs on the existing workspace preview path.
- Reuse current configuration, App Server, and tool owners for browser admission, requirements, and tool runtimes; synchronize protocols, generated clients, and five-language resources.

### Tests and Quality

- Extend targeted regressions and real-process fixtures for browser devices, annotation captures, visits, native permissions, configuration layers, reasoning defaults, and tool runtimes.
- This release ships implemented increments; complete native browser capabilities, visual parity, and packaged validation on both platforms remain subject to dedicated acceptance plans.

### Documentation

- Update architecture diagrams, command boundaries, the browser implementation plan, and release execution records.

### Other

- Align app, CLI, and Rust workspace versions to 1.169.0.

**Full changes**: `v1.168.0` -> `v1.169.0`
