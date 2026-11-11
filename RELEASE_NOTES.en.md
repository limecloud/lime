## Lime v1.174.0

Simplified Chinese release notes are the primary version.

### Features

- Add BYOC desktop entry points for Alibaba Cloud ECS/Wuying lifecycle management, existing desktop connections, and isolated remote task windows.
- Add Linux guest installation packages, authenticated WebSocket connections, and encrypted archive, restore, and object storage transfers.

### Fixes

- Hide Lime Hub from conversation model selectors while signed out and restore available models after sign-in.
- Fix overlapping permission labels while a reply disables the access mode control.
- Default Provider credentials to files protected by access permissions, with explicit system keyring selection. Unreadable credentials prompt users to save their API key again.
- Align model capability provenance, MCP form validation, OAuth persistence, model list expectations, and Windows update checks.
- Select the Windows update baseline from published stable releases with a complete installer, avoiding draft releases without assets.
- Fix frontend quality checks by separating the cloud desktop data helper from component exports.
- Batch skill watcher path updates and stop the native watcher once at shutdown, preventing repeated macOS watcher rebuilds from blocking session startup or exit.

### Improvements and Refactoring

- Align the home screen, contextual sidebar, scheduled tasks, Skills, and plugin catalog layouts, with copy updates in five languages.
- Consolidate file search, permissions, and path handling. Remove obsolete session DAOs, duplicate repositories, and unused embedding code.
- Update Rust HTTP/TLS, async runtime, archive, MCP, and terminal dependencies and include the required license materials.
- Resolve SQLite, OpenSSL, and MCP SDK security advisories and adapt MCP types and SQLite backup calls.

### Tests and Quality

- Complete a live hello conversation through Electron, with a completed canonical Turn and persisted user and assistant Items.
- Add Electron regression checks for disabled permission labels, native content and renderer viewport agreement, and main content filling the window.
- Full Cloud product acceptance remains incomplete, including remote model tasks, third-party sign-in, and cross-environment recovery. Local checks do not establish Windows, Intel Mac, or packaged-app acceptance.

### Documentation

- Update credential storage guidance, the cloud desktop plan, architecture boundaries, protocol documentation, and source provenance records.

### Other

- Align app, CLI, and Rust workspace versions to 1.174.0.

**Full changes**: `v1.173.0` -> `v1.174.0`
