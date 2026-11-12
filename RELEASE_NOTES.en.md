## Lime v1.175.0

> Simplified Chinese release notes are the primary version.

### New Features

- Add Cloud desktop purchase recommendations, network preparation, system image selection, and installation progress, with separate provider authorization and cost confirmation.
- Add desktop reconnection, archive transfers, recovery keys, and scheduled release controls, resuming installation and transfer state from the original operation.
- Add conversation history navigation, tabs, archived conversation management, and branching from a selected turn.
- Extend the TUI with configuration, Hooks, Skills, and keymap panels, plus reasoning effort and permission profile pickers.

### Fixes

- Improve Cloud Guest upload tunnels, startup readiness checks, window navigation, shutdown handling, reconnection, and failure recovery.
- Fix conversation copying, retries, unread and pinned state synchronization, and change-file viewing and deletion interactions.
- Isolate turn and side-panel rendering errors to keep local failures from disrupting conversation controls.
- Improve terminal notifications after permission approval and Windows restricted-execution permission planning.

### Improvements and Refactoring

- Move accounts, expert content, skills, and remote plugins to the current Cloud contracts; remove the old plugin-sharing protocol and its consumers.
- Improve local credential encryption and archive identity validation; synchronize App Server schemas, generated clients, and five-language resources.
- Allow Bing and Google search endpoints to be configured through the environment.

### Testing and Quality

- Add regression coverage for Cloud installation, transfers, recovery, remote plugins, and conversation interactions, plus TUI protocol and terminal scenarios.
- Package Cloud Guest from the same Linux runtime release and publish the Release after desktop and CLI assets build successfully.
- Full Cloud and cross-platform acceptance remains tracked in the relevant execution plans; partial tests do not establish complete acceptance.

### Documentation

- Update both READMEs, Lime brand visuals, Cloud instructions, and current architecture and command boundaries.

### Other

- Align app, CLI, and Rust workspace versions to 1.175.0.

**Full changes**: `v1.174.0` -> `v1.175.0`
