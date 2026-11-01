<div align="center"><a name="readme-top"></a>

<img src="./docs/images/readme-hero.png" alt="Lime README 主视觉：青柠一下，灵感即来" width="100%" />

# Lime

### 一个真正能把事情推进下去的 Agent

**面向全球用户的开源全栈 AI Agent（Desktop + CLI/TUI）**

代码、文件、终端、工具、研究、内容、多模态和多 Agent 协作，都在同一个可恢复的任务空间里完成。

[English](./README.md) · **简体中文** · [功能地图](./FEATURE-MAP.md) · [文档](./docs/README.md) · [发布记录](./RELEASE_NOTES.md) · [问题反馈](https://github.com/limecloud/lime/issues)

<p>
  <a href="https://github.com/limecloud/lime/releases"><img src="https://img.shields.io/github/v/release/limecloud/lime?label=release" alt="Lime GitHub Release" /></a>
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-246B45" alt="Lime supports macOS, Windows, and Linux across Desktop and CLI" />
  <img src="https://img.shields.io/badge/surfaces-Desktop%20%7C%20CLI%2FTUI-24C8DB" alt="Lime provides Desktop and CLI/TUI product surfaces" />
  <img src="https://img.shields.io/badge/license-GPLv3-2F4F4F" alt="Lime GPLv3 license" />
</p>

</div>

---

## Lime 是什么

Lime 是一个同时提供 Electron Desktop 和 CLI/TUI 的全栈 AI Agent。它能理解目标和工作区，读取和修改文件，运行终端命令，调用工具、MCP 和 Skills，处理多模态输入，生成可交付 artifact，并把整个过程保留在 Thread / Turn / Item 中。

它和 Claude Code、WorkBuddy、Codex 属于同一类“能动手完成任务”的 Agent 产品，同时提供桌面 GUI、可视化工作区、Provider 选择和跨工程/研究/内容的统一工作流。

## 能力一览

| 能力 | 可以完成的工作 |
| --- | --- |
| 代码与工程 | 理解仓库、定位问题、跨文件修改、运行测试、解释 diff |
| 文件与终端 | 读写文件、搜索目录、启动进程、查看输出、管理长任务 |
| 工具与扩展 | 使用 MCP、Skills、浏览器和受控工具扩展执行范围 |
| 多模态 | 理解文本、代码、图片、截图、音频、视频、PDF、表格和结构化数据 |
| 生成与交付 | 生成文档、图片、音频、视频、图表、网页草稿和结构化 artifact |
| 协作与恢复 | 多 Agent 分工、权限审批、取消/重试、历史恢复和持续执行 |

## 一次任务如何工作

1. 写下目标、约束和验收标准，选择工作区或项目目录。
2. Agent 读取必要上下文，先给出计划和需要确认的边界。
3. 在授权范围内修改文件、运行命令、调用工具和生成结果。
4. 检查 diff、命令输出、测试结果和 artifact，继续追问或结束任务。

## 选择版本：Desktop 还是 CLI/TUI

Lime 提供两个产品入口。按你的工作方式选择即可；两者共用同一套 App Server JSON-RPC、RuntimeCore 和 canonical Thread / Turn / Item 数据模型。

| 版本 | 适用场景 | 安装方式 | 包含能力 |
| --- | --- | --- | --- |
| **Desktop（Electron）** | 可视化工作区、文件浏览、artifact 预览和长任务 | 从 [Releases](https://github.com/limecloud/lime/releases) 下载 macOS 或 Windows 安装包；macOS 也可使用 Homebrew | Electron GUI、工作区与预览、权限管理、更新器和本地 App Server sidecar |
| **CLI/TUI** | SSH、服务器、脚本、CI 和键盘优先的终端工作流 | 安装 npm 包：`npm install -g @limecloud/lime`（Node.js ≥18） | `lime` / `lime tui` 交互式 TUI、`lime exec` 非交互执行、历史和 Thread 命令 |

CLI/TUI 不是另一套 runtime，也不包含 Electron GUI。平台包会原子携带 `lime`、`app-server` 和 `code-mode-host`，因此本地使用时无需另外安装 App Server。

## 核心工作区

### 从一个目标开始

<img src="./docs/images/readme-feature-start.png" alt="Lime 从一个任务开始功能图" />

从一句话、一个仓库、一组资料或一张截图开始，Agent 会先建立上下文，而不是直接猜答案。

### 执行与审阅在同一个 Thread

<img src="./docs/images/readme-feature-workspace.png" alt="Lime 同一空间持续打磨功能图" />

对话、计划、文件变更、终端输出、工具结果和生成物都可回看。高风险动作可以逐项批准、拒绝、重试或暂停。

### 连接自己的模型与工具

<img src="./docs/images/readme-feature-provider.png" alt="Lime 使用自己的 AI 服务功能图" />

Lime 不绑定单一模型服务。配置 Provider、模型和凭证后，可以按任务切换能力，并通过 MCP 与 Skills 扩展 Agent。

## 快速开始

### Desktop（Electron）

从 [Releases](https://github.com/limecloud/lime/releases) 下载 macOS 或 Windows 安装包。

- macOS 可下载 `.dmg`，也可以使用 Homebrew。
- Windows 下载 `Lime_*_x64-setup.exe`。
- 当前 Desktop 发布 macOS 和 Windows；Linux Desktop 暂停发布。

macOS 使用 Homebrew：

```bash
brew tap aiclientproxy/tap
brew install --cask lime
```

### CLI/TUI

要求 Node.js 18 或更高版本。使用 npm 安装 CLI 启动器和当前平台载荷：

```bash
npm install -g @limecloud/lime
lime --version
```

安装后可以启动交互式终端界面，或执行一次非交互任务：

```bash
lime                         # 等同于 `lime tui`
lime exec "review this diff"
lime exec --json "review this diff"
```

启动器会自动选择 macOS arm64/x64、Windows x64 或 Linux x64 GNU 的平台包。本地命令会自动启动同目录或 `PATH` 中的 `app-server`；如需指定其他本地二进制，可设置 `LIME_APP_SERVER_BIN` 或传入 `--app-server <PATH>`。连接远端 App Server 时使用安全 WebSocket，并从环境变量读取 token：

```bash
lime exec \
  --remote wss://cloud.example/rpc \
  --remote-auth-token-env LIME_REMOTE_TOKEN \
  "review this diff"
```

### 第一次运行（Desktop 或 CLI/TUI）

1. Desktop 打开 Lime，CLI/TUI 执行 `lime`；然后配置 Provider 并测试模型连接。
2. 选择工作区，确认文件和终端权限。
3. 新建 Agent Thread，写下目标和验收标准。
4. 让 Agent 先规划，再批准需要执行的动作。

## 数据与权限

项目资料、会话历史和配置默认保存在本机。调用模型或外部工具时，相关输入会发送到你配置的 Provider 或目标服务。文件修改、终端命令和外部工具调用遵循权限与审批边界。

## 文档与社区

- [文档](./docs/README.md)
- [发布记录](./RELEASE_NOTES.md)
- [GitHub Issues](https://github.com/limecloud/lime/issues)

## 开源协议

[GPL-3.0-only](LICENSE)，组件授权与分发范围见 [LICENSES.md](LICENSES.md)。

本项目按适用许可证以“现状”提供，不提供担保；用户对自己的配置和使用负责。模型能力由用户配置的第三方服务提供。

---

<div align="center">

### 微信交流

<img src="./docs/images/coso.jpg" alt="Lime 微信交流群二维码" width="180" />

扫码加微信，备注 `Lime`，拉你进群讨论。

</div>

源码启动与贡献见 [CONTRIBUTING.md](CONTRIBUTING.md)，安全问题见 [SECURITY.md](SECURITY.md)。
