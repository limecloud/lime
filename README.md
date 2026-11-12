<div align="center">

<img src="./docs/images/brand/lime-agent-hero.webp" alt="Lime's original three-dimensional lime companion, with project files and tools" width="960" />

# Lime

### An agent that finishes the work

An open-source full-stack AI agent for **Desktop and CLI/TUI**.
Code, research, create, and work with files — with tools and results you can review.

[Website](https://limeai.run) · [Get Desktop](https://limeai.run/download/) · [Documentation](https://limeai.run/docs/) · [简体中文](./README.zh-CN.md)

[![Release](https://img.shields.io/github/v/release/limecloud/lime?label=release&color=527a43)](https://github.com/limecloud/lime/releases) [![License](https://img.shields.io/badge/license-GPL--3.0--only-527a43)](./LICENSE)

</div>

## Start with a real task

Bring a repository, a folder of references, an error, or a brief. Give Lime a goal and boundaries. It can read context, use the tools you enable, make changes, and leave an output you can inspect and continue.

| Task | Work toward |
| --- | --- |
| Fix a bug or build a feature | A focused diff, an explanation, and actual test results |
| Research a question | An editable report with sources and open questions |
| Work with files and data | Organized files, calculations, or a checkable brief |
| Create content and visual assets | Copy, image drafts, and a delivery list from one brief |
| Repeat a workflow | A Skill with clear inputs, steps, and review criteria |

Model and media capabilities depend on the configured provider and tools. See the [feature map](./FEATURE-MAP.md) for current ownership and verification scope, and [task guides](https://limeai.run/use-cases/) for concrete examples.

## A workflow you can review

| Understand the context | Move the work forward | Review and continue |
| :---: | :---: | :---: |
| <img src="./docs/images/brand/lime-agent-context.webp" alt="The lime companion organizing project files and reference material" width="280" /> | <img src="./docs/images/brand/lime-agent-work.webp" alt="The lime companion using tools to complete a task" width="280" /> | <img src="./docs/images/brand/lime-agent-review.webp" alt="The lime companion reviewing outputs and completion checks" width="280" /> |
| Bring files, references, and constraints. | Read and edit files, run commands, and use connected tools. | Inspect changes, check results, and continue in the same task. |

These are brand illustrations. The [documentation](https://limeai.run/docs/) describes the product's actual controls and workflows.

## Quick start

### Desktop

Download the macOS or Windows installer from [Releases](https://github.com/limecloud/lime/releases) or the [download page](https://limeai.run/download/).

On macOS, you can also use Homebrew:

```bash
brew tap aiclientproxy/tap
brew install --cask lime
```

### CLI/TUI

Requires **Node.js 18 or newer**. The launcher installs the payload for macOS arm64/x64, Windows x64, or Linux x64 GNU. It includes the local App Server; Electron is not required.

```bash
npm install -g @limecloud/lime
lime --version
lime
```

Run a single task or request structured output:

```bash
lime exec "review this diff"
lime exec --json "review this diff"
```

### Your first task

1. Configure a provider, model, and credential; check that the connection works.
2. Choose a project directory and the required file, terminal, and tool permissions.
3. Describe the goal, relevant materials, constraints, and completion criteria.
4. Start with a plan when useful, then inspect file changes, command results, and outputs.
5. Request a focused revision or continue with the next step.

## Models, tools, and control

Lime hosts the agent workspace; it does not supply AI models. Choose your provider and model, connect MCP tools as needed, and use Skills for repeatable procedures. Available capabilities depend on the provider, tool connection, and execution environment.

Project files, history, and configuration are local by default. Content needed for remote model or external-tool requests is sent to the service you select. Grant permissions for the current task and review actions that change files or external state.

Provider credentials default to user-restricted files without Keychain password prompts. See [credential storage](./docs/content/03.providers/2.credential-storage.md) for paths and explicit keyring settings.

### Web search API endpoints

Set these optional variables in the environment that starts Lime or its App Server. They affect the local `bing_search_api` and `google_custom_search` tools; model Provider endpoints are configured separately. Unset or blank values use the vendor addresses. Overrides must use HTTP or HTTPS and return the corresponding Bing v7 or Google Custom Search JSON format.

| Variable | Purpose | Default / requirement |
| --- | --- | --- |
| `BING_SEARCH_ENDPOINT` | Full Bing-compatible search URL | `https://api.bing.microsoft.com/v7.0/search` |
| `BING_SEARCH_API_KEY` | Bing-compatible API credential | Required when using this provider |
| `GOOGLE_SEARCH_ENDPOINT` | Full Google-compatible search URL | `https://www.googleapis.com/customsearch/v1` |
| `GOOGLE_SEARCH_API_KEY` | Google-compatible API credential | Required when using this provider |
| `GOOGLE_SEARCH_ENGINE_ID` | Google search engine identifier | Required when using this provider |

Choose an endpoint you trust to receive the search query and the provider credential. Invalid endpoint values fail that provider and continue through the existing search fallback chain; an endpoint override does not change the required request or response format.


## Cloud computers

<details>
<summary>Connect your own Linux computer, install the runtime, and understand backup and release boundaries</summary>

To build the Linux cloud guest from source on a native Linux x64 host, run `node scripts/app-server/linux-guest-build.mjs --out <new-absolute-directory>`. The output includes an archive and integrity digests. Select a trusted package under Cloud computers → Install runtime to save the task connection with platform encryption after installation. The target requires prepared desktop dependencies, a public IPv4, and temporary upload port 8787 accessible only from your outbound IP; Lime does not change security groups. See the [Cloud execution plan](internal/exec-plans/cloud-desktop-byoc-plan.md) for installation arguments and verification boundaries.

</details>

## Documentation and contributing

| Looking for | Start here |
| --- | --- |
| Product guides and settings | [Online docs](https://limeai.run/docs/) · [Repository docs](./docs/README.md) |
| Current capabilities and verification boundaries | [Feature map](./FEATURE-MAP.md) |
| Build from source and contribute | [Contributing](./CONTRIBUTING.md) |
| Changes in releases | [Release notes](./RELEASE_NOTES.en.md) |
| Bugs and reproducible reports | [Issues](https://github.com/limecloud/lime/issues) |
| Vulnerability reporting | [Security policy](./SECURITY.md) |

## Platforms and license

| Surface | Platforms |
| --- | --- |
| Desktop | macOS and Windows |
| CLI/TUI | macOS arm64/x64, Windows x64, Linux x64 GNU |

Lime is licensed under [GPL-3.0-only](./LICENSE). Component licenses and distribution scope are documented in [LICENSES.md](./LICENSES.md). The software is provided as is, without warranty, under its applicable licenses.
