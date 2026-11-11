<div align="center"><a name="readme-top"></a>

<img src="./docs/images/readme-hero-en.png" alt="Lime README hero banner: An agent that can actually finish the work" width="100%" />

# Lime

### An agent that can actually finish the work

**Open-source full-stack AI agent for Desktop and CLI/TUI**

Full-stack AI agent for coding, files, terminals, tools, research, content, multimodal work, and multi-agent workflows worldwide.

[简体中文](./README.zh-CN.md) · **English** · [Feature Map](./FEATURE-MAP.md) · [Docs](./docs/README.md) · [Release Notes](./RELEASE_NOTES.en.md) · [Issues](https://github.com/limecloud/lime/issues)

<p>
  <a href="https://github.com/limecloud/lime/releases"><img src="https://img.shields.io/github/v/release/limecloud/lime?label=release" alt="Lime GitHub Release" /></a>
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-246B45" alt="Lime supports macOS, Windows, and Linux across Desktop and CLI" />
  <img src="https://img.shields.io/badge/surfaces-Desktop%20%7C%20CLI%2FTUI-24C8DB" alt="Lime provides Desktop and CLI/TUI product surfaces" />
  <img src="https://img.shields.io/badge/license-GPLv3-2F4F4F" alt="Lime GPLv3 license" />
</p>

Lime is more than a chat box: it understands context, calls tools, edits files, runs commands, organizes material, creates deliverables, and keeps moving a task forward from one desktop or terminal workspace.

</div>

---

<details>
<summary><kbd>Table of Contents</kbd></summary>

- [What is Lime?](#what-is-lime)
- [What the full-stack agent can do](#what-the-full-stack-agent-can-do)
- [How a task moves forward](#how-a-task-moves-forward)
- [Core capabilities](#core-capabilities)
- [Who Lime is for](#who-lime-is-for)
- [Product positioning](#product-positioning)
- [Choose a product surface](#choose-a-product-surface)
- [Quick Start](#quick-start)
- [Tech Stack and Platforms](#tech-stack-and-platforms)
- [FAQ](#faq)
- [License](#license)
- [Disclaimer](#disclaimer)

</details>

---

## What is Lime?

Lime is an open-source full-stack AI agent for users and teams worldwide, available as an Electron Desktop app and a CLI/TUI. It brings the Agent loop, filesystem, terminal processes, code changes, tool calls, MCP, Skills, multimodal input and output, model routing, and multi-agent collaboration into one traceable task chain.

It belongs to the same category of hands-on agents as Claude Code, WorkBuddy, and Codex, while emphasizing a desktop GUI, visual workspace, configurable providers, and mixed engineering, research, and content workflows for global users and teams.

Lime works by:

- Understanding the goal, repository, files, history, and constraints before proposing an executable plan.
- Reading and writing files, searching, applying patches, running terminal commands, testing, and calling tools within granted permissions.
- Projecting work as Thread, Turn, Item, and reusable artifacts so tasks can be paused, reviewed, restored, and continued.
- Letting you choose providers and models without losing the surrounding task context.

Use Lime as an engineering partner, research assistant, content collaborator, or automation executor: you provide the goal and boundaries, and it turns them into inspectable actions and results.

---

## What the full-stack agent can do

- **Code understanding and changes**: inspect repositories, locate bugs, implement cross-file features, refactor, add tests, produce patches, and explain diffs.
- **Terminal and process operations**: run scripts, builds, tests, dependency commands, long-running processes, and inspect their output within controlled permissions.
- **Files and workspaces**: read and write text or structured files, organize directories, and create documents, reports, web drafts, and other artifacts.
- **Tools, MCP, and Skills**: discover capabilities, call external tools or local Skills, and turn repeatable procedures into reusable execution units.
- **Multimodal understanding and generation**: work with text, code, images, screenshots, audio, video, PDFs, tables, and structured data in one task, then create images, audio, video, documents, charts, and other artifacts.
- **Research and content delivery**: work with web pages, references, screenshots, images, audio, video, and multi-turn context from analysis through publish-ready output.
- **Multi-agent and long-running work**: split subtasks, make progress in parallel, preserve state, and resume complex work in the same Thread.
- **Provider and model control**: choose models per task and manage capability catalogs, credentials, routing, retries, and failure boundaries.

---

## How a task moves forward

### 1. Fix a real bug

Give Lime a repository and an error. The Agent reads the relevant files and configuration, traces the call path, states its assumptions, changes the implementation, runs focused tests, and shows the diff.

Continue in the same Thread with questions such as "why this change?" or "what are the edge cases?" Every step remains visible and reviewable.

### 2. Ship a full-stack feature

Lime can split a requirement across the frontend, App Server, Rust runtime, protocol, and tests, then execute in dependency order. Approve risky actions, pause, revise the plan, or inspect uncommitted changes at any point.

### 3. Turn material into a deliverable

Add web pages, notes, screenshots, meeting records, and prior results. The Agent can structure them, identify gaps, produce a report, script, plan, or launch draft, and keep context for review.

### 4. Turn a repeated procedure into a Skill

Encode a recurring check, release step, research method, or team rule as a Skill. The Agent can discover and run it through MCP or controlled capabilities instead of repeating every instruction in every prompt.

### 5. Coordinate multiple agents

Delegate research, implementation, testing, and documentation to different agents. The main Thread keeps shared context, permissions, and review boundaries while it collects the results.

---

## Core capabilities

### Start from one goal

<img src="./docs/images/readme-feature-start-en.png" alt="Lime start from one task feature image" />

Enter a goal, repository, directory, or set of materials. The Agent establishes context first, then proposes a plan and the boundaries that need your approval.

### Execute and review in one workspace

<img src="./docs/images/readme-feature-workspace-en.png" alt="Lime refine in one workspace feature image" />

Conversation, plans, file changes, command output, tool results, and artifacts stay around the same Thread. Approve, reject, retry, continue, or restore work step by step.

### Connect your models and tools

<img src="./docs/images/readme-feature-provider-en.png" alt="Lime use your own AI services feature image" />

Lime does not lock you to one model service. Configure providers, models, and credentials, then extend the Agent through MCP, Skills, and controlled tools.

---

## Who Lime is for

- Developers who need to read code, change code, run tests, and ship features.
- Full-stack teams handling product, design, data, documentation, and automation together.
- Researchers and creators who need local material, terminal tools, and long-running reasoning.
- Teams that want to encode rules, checks, and tools as reusable Skills.
- Users who want a desktop GUI with the working style of Claude Code, WorkBuddy, or Codex.

---

## Product positioning

Lime belongs to the full-stack AI agent, coding agent, desktop AI agent, and terminal agent category for users and teams worldwide. It handles code tasks as well as research, writing, material organization, automation, and multimodal delivery; the goal is a set of verifiable actions, not just a generated paragraph.

Multimodality is a core Agent workflow, not a separate attachment feature. One Thread can combine a written brief, a codebase, images and screenshots, voice or video material, PDFs, and spreadsheets so the Agent can cross-understand them, call tools, and produce delivery-ready results.

## Choose a product surface

Lime is distributed through two product surfaces. Choose the one that matches your workflow; both surfaces use the same App Server JSON-RPC, RuntimeCore, and canonical Thread / Turn / Item data model.

| Surface | Best for | Installation | Includes |
| --- | --- | --- | --- |
| **Desktop (Electron)** | Visual workspaces, file browsing, artifacts, and long-running tasks | Download the macOS or Windows installer from [Releases](https://github.com/limecloud/lime/releases), or use Homebrew on macOS | Electron GUI, workspace and preview surfaces, permissions, updater, and the local App Server sidecar |
| **CLI/TUI** | SSH sessions, servers, scripts, CI, and keyboard-first work | `npm install -g @limecloud/lime` (Node.js ≥18) | `lime` / `lime tui` interactive TUI, `lime exec` non-interactive runs, history and thread commands |

The CLI/TUI package is not a second runtime and does not include the Electron GUI. Its platform package carries the `lime`, `app-server`, and `code-mode-host` binaries needed for the same local product chain, so you do not install a separate App Server.

---

## Quick Start

### Desktop (Electron)

Download the installer for your platform from [Releases](https://github.com/limecloud/lime/releases).

- macOS users can download the `.dmg` package or install with Homebrew.
- Windows users can download `Lime_*_x64-setup.exe`.
- Lime currently publishes macOS and Windows builds only. Linux desktop builds are paused.
- If Windows SmartScreen appears, it usually means the installer is unsigned or has not built enough signing reputation. It does not necessarily mean the installer is broken.

macOS users who use Homebrew can run:

```bash
brew tap aiclientproxy/tap
brew install --cask lime
```

### CLI/TUI

Requirements: Node.js 18 or newer. Install the published launcher and its platform payload with npm:

```bash
npm install -g @limecloud/lime
lime --version
```

Start the interactive terminal UI or run a single non-interactive task:

```bash
lime                         # same as `lime tui`
lime exec "review this diff"
lime exec --json "review this diff"
```

The launcher selects the payload for macOS arm64/x64, Windows x64, or Linux x64 GNU. Local commands start the sibling `app-server` automatically. To use another local binary, set `LIME_APP_SERVER_BIN` or pass `--app-server <PATH>`; to connect to a remote App Server, use a secure WebSocket and read the token from an environment variable:

```bash
lime exec \
  --remote wss://cloud.example/rpc \
  --remote-auth-token-env LIME_REMOTE_TOKEN \
  "review this diff"
```

To build the Linux cloud guest from source on a native Linux x64 host, run `node scripts/app-server/linux-guest-build.mjs --out <new-absolute-directory>`. The output includes an archive and integrity digests. Select a trusted package under Cloud computers → Install runtime to save the task connection with platform encryption after installation. The target requires prepared desktop dependencies, a public IPv4, and temporary upload port 8787 accessible only from your outbound IP; Lime does not change security groups. See the [Cloud execution plan](internal/exec-plans/cloud-desktop-byoc-plan.md) for installation arguments and verification boundaries.

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

### First run (Desktop or CLI/TUI)

1. Open the Desktop app, or run `lime` for CLI/TUI; configure a Provider and test a model connection.
2. Choose a workspace or project directory and confirm file and terminal permissions.
3. Create an Agent Thread with a goal, constraints, and acceptance criteria.
4. Ask for a plan first, then approve file changes, commands, or external tool calls as needed.
5. Inspect the diff, test results, and artifacts; continue the task or close it.

---

## Tech Stack and Platforms

- Desktop framework: Electron, Rust App Server, App Server JSON-RPC.
- Agent runtime: Thread / Turn / Item projection, tool lifecycle, Skills, MCP, multi-agent work, and history restoration.
- Frontend: React, TypeScript, Vite.
- Local capabilities: filesystem, processes, workspaces, artifacts, and persisted state.
- Desktop platforms: macOS and Windows (Linux Desktop builds are paused).
- CLI/TUI platforms: macOS arm64/x64, Windows x64, and Linux x64 GNU.
- CLI runtime requirement: Node.js 18 or newer.
- License: GPLv3.

---

## FAQ

### Does Lime provide AI models?

No. Lime is an Agent host and workspace, not a model vendor. Configure an available Provider, model, and credential.

Provider credentials default to files restricted to the current user, without Keychain password prompts. See [credential storage](docs/content/03.providers/2.credential-storage.md) for paths and explicit keyring configuration.

### Can the Agent edit code and run commands?

Yes. Within the permissions you grant, the Agent can read and edit files, run terminal commands, run tests, and call tools. Review or approve high-risk actions.

### Will all my materials be uploaded?

Project materials, conversation history, and configuration are kept locally by default. Inputs needed for model or external-tool calls are sent to the Provider or target service you configured; follow the relevant service policy for sensitive material.

### How is Lime different from a normal chat tool?

Normal chat mainly returns text. Lime understands workspace context, operates files, processes, and tools, retains execution state and results, and lets you keep moving in the same task.

### Do I need advanced prompt-writing skills?

No. Describe the goal, constraints, context, and acceptance criteria. Reusable procedures can become Skills, and complex tasks can start with an Agent-generated plan.

---

Build from source and contribute: [CONTRIBUTING.md](CONTRIBUTING.md). Report vulnerabilities: [SECURITY.md](SECURITY.md).

## License

[GPL-3.0-only](LICENSE). Component licenses and distribution scope: [LICENSES.md](LICENSES.md).

## Disclaimer

Lime is provided as is, without warranty, under its applicable licenses. Users are responsible for their configuration and use.

Lime does not directly provide AI model services. Model capabilities are provided by third-party AI service providers configured by the user.
