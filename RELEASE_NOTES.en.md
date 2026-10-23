## Lime v1.168.0

Model presets and bundled metadata now reflect current official OpenAI, Claude, Gemini, Kimi, GLM, Qwen, DeepSeek, Grok, and MiMo offerings, including image capabilities and context windows.

Simplified Chinese release notes are the primary version.

### Features

- Extend browser annotations with element, region, and text selection, attached images, marker visibility, original-page viewing, and CSS/text design previews submitted through conversations.
- Add download management with search, pagination, progress, file actions, and recovery; let Agents query browser history under the configured history access policy.
- Add storage usage reporting and category cleanup for local caches and historical data.
- Add Git and worktree preferences, managed worktree inventory and cleanup, and customizable keyboard shortcuts.
- Add dictation dictionaries, history, and audio playback, with focused microphone, model, and processing preferences.
- Default MiniMax M Plan to M3.1 Flash, refresh official subscription links and model choices, and recognize image input for Flash/M3.

### Fixes

- Check configuration versions and previous field values when saving browser permissions, preventing stale views from overwriting newer policies while retaining drafts on failure.
- Strengthen annotation page/editor identity, navigation invalidation, input focus, and draft revision checks to reject stale actions.
- Honor conversation source preferences during memory extraction and consolidate global instruction reading and editing.

### Improvements and Refactoring

- Organize settings into Personal, Integrations, and Coding, unify page controls and search navigation, and remove duplicate memory and Soul settings.
- Separate annotation, design preview, approval, and download responsibilities within the existing Electron, App Server, and RuntimeCore chain.
- Synchronize protocols, generated clients, and Simplified Chinese, Traditional Chinese, English, Japanese, and Korean resources.
- Remove 85 entries absent from the current canonical source, retired OAuth defaults, and duplicated model lists. Use account discovery or explicit configuration for SenseNova and Submodel.

### Tests and Quality

- Extend annotation, design preview, download recovery, permission conflict, dictation, worktree, and settings navigation regressions and real-process fixtures.
- This release ships implemented increments; complete native browser capabilities and full Codex GUI alignment remain subject to dedicated acceptance plans.

### Documentation

- Update architecture, command boundaries, browser implementation records, and the release verification plan.

### Other

- Align app, CLI, and Rust workspace versions to 1.168.0.

**Full changes**: `v1.167.0` -> `v1.168.0`
