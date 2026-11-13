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

Choose Cloud from the composer's execution menu, or open Settings → Cloud desktops, to purchase, bind, or connect your own persistent Linux computer. After a verified ECS purchase, setup selects that exact computer and observes its startup. You can then install the runtime or rebuild a connection to an existing or restored environment. An unknown purchase result stays attached to the original operation for inspection.

For a first purchase, choose a region and authorize Alibaba Cloud in your browser. Lime prepares the official CLI if needed. Without a purchase template, you can authorize Lime to compare available 2-core, 4 GiB Linux options and prepare a dedicated network, without entering image, instance type, VPC, switch, security group, or SSH key details. Network preparation does not purchase a computer; ordering requires a live quote and separate fee confirmation. Reopening setup inspects the original preparation instead of creating another one. The dedicated network is reusable and remains after instance release.

Before an ECS purchase, Lime downloads and caches the matching official runtime, verifies its size and SHA-256, then prepares temporary distribution in your own private OSS. No package URL, bucket name, or access key entry is needed. This preparation happens before purchasing the computer; temporary storage and traffic are billed to your cloud account. After the last installation finishes, Lime cleans up the package object and empty bucket.

Failed preparation blocks the order. Users bringing their own environment can explicitly choose to connect it or supply a trusted custom package. Restoring a saved system image reuses its installed environment without preparing a new runtime package. An expired quote, a closed page, or a changed purchase context prevents a late response from submitting an order.

First installation on ECS uses the official runtime matching your Lime version. After you approve system installation, Lime prepares desktop dependencies and shows actual stages, received package bytes, and elapsed time. If that release is unavailable, no cloud installation command is sent; retry explicitly or select a trusted package under advanced options. Keep Lime running after closing the installation panel. After restarting Lime, use Continue original operation to resume inspection.

The cloud computer downloads and verifies the runtime over HTTPS. Control requests use your Alibaba Cloud authorization and Session Manager; installation services listen only on the computer's loopback interface. After your installation or reconnection consent, Lime configures connection rules for your current public address on its dedicated network and removes old address rules. No IP or port entry is needed; custom networks remain under your control. A successful installation saves the task connection encrypted. Existing managed environments can rebuild connections without reinstalling. Installation success does not establish that model tasks, applications, or restored logins have been verified.

The remote desktop stays collapsed by default. Choose View desktop to open the read-only viewer; collapsing it closes the display connection while the task connection remains available. Computer Use actions require their own authorization.

The cloud window checks its own model catalog. If it has no visible chat model, choose Connect model to open that computer's model settings. Returning to the task checks the configuration again; existing configurations do not repeat this setup. A catalog check does not make an inference request or verify model connectivity.

Expand Reuse a local model connection in the local Task connection panel to select an existing connection and authorize copying its API key to that computer. The cloud computer stores it persistently for its window and independent CLI; model charges belong to the selected model service. Interrupted delivery resumes the original operation without automatically creating another connection. Both runtimes must include model connection delivery. Ordinary configuration exports exclude actual API keys.

In Backups, choose Restore a saved environment, authorize your account, and select a private system image. Lime prepares the purchase plan and prices that image before you confirm the cost and create a new instance. The instance can reuse the installed environment. Rebuilding its connection rotates task and desktop credentials; verify third-party logins separately. Selected files can also be stored as age ciphertext in private OSS and restored into a new directory on the new instance. The original recovery key stays local. See the [cold recovery sequence](internal/aiprompts/architecture.md#镜像冷恢复与选定文件恢复的组合) for the order and conditions.

Advanced installation also accepts a trusted `.tar.gz.json` descriptor with a signed private HTTPS download URL. Keep the bucket private and allow enough signature lifetime for dependency preparation and download. Lime does not renew the signature automatically; the computer receives download access to the runtime package, without your cloud management credentials.

For longer breaks, choose Save environment and release. After one explicit consent, Lime stops the computer, saves an encrypted snapshot and private system image, verifies the backup, then releases the original computer. No disk or image IDs are required. You can close the panel while keeping Lime running, or resume the original operation after exiting. Images include disk files and sign-in data; check remaining storage charges and verify apps and sign-ins after restoring.

A stopped pay-as-you-go ECS instance can schedule release after retaining a private system image. The interface shows an exact deadline at least 30 minutes ahead. Alibaba Cloud executes the schedule even after Lime exits. At the deadline, the instance and disks configured for deletion are removed; starting it from the cloud console does not cancel the schedule, and release protection does not block it. Cancel and confirm the cancellation before reuse. The image is checked when scheduling and must be retained through recovery. Images and snapshots can continue to incur charges. System images may contain third-party login data and must be treated as sensitive backups.

On native Linux x64, developers can run `node scripts/app-server/linux-guest-build.mjs --out <NEW_ABSOLUTE_DIRECTORY> --profile release` to build the release runtime, archive, and integrity digests. Omitting `--profile` selects dev mode. Building does not upload or publish artifacts. See the [command contract](internal/aiprompts/commands.md#byoc-云电脑管理), [architecture, flowcharts, and sequence diagrams](internal/aiprompts/architecture.md#云端入口与首次装配), [backup and release boundaries](internal/aiprompts/architecture.md#状态保留与释放), and [Cloud acceptance plan](internal/exec-plans/cloud-desktop-byoc-plan.md).

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
