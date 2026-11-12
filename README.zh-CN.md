<div align="center">

<img src="./docs/images/brand/lime-agent-hero.webp" alt="Lime 原创 3D 青柠伙伴，与项目文件和工具一起工作" width="960" />

# Lime

### 能把事情做完的 AI 智能体

开源的全栈 AI 智能体，提供 **桌面应用与 CLI/TUI**。
写代码、查资料、做内容、处理文件，把任务推进到可检查、可修改、可继续的结果。

[官网](https://limeai.run) · [下载桌面端](https://limeai.run/download/) · [使用文档](https://limeai.run/docs/) · [English](./README.md)

[![Release](https://img.shields.io/github/v/release/limecloud/lime?label=release&color=527a43)](https://github.com/limecloud/lime/releases) [![License](https://img.shields.io/badge/license-GPL--3.0--only-527a43)](./LICENSE)

</div>

## 从一个真实任务开始

带上一个仓库、一组资料、一个报错或一份简报，告诉 Lime 目标和边界。它可以读取上下文、调用已连接的工具、修改文件，把结果留给你检查，再从现有进度继续。

| 任务 | 可以交付什么 |
| --- | --- |
| 修复问题、实现功能 | 可审阅的代码差异、修改说明和实际测试结果 |
| 研究一个问题 | 带来源和未决问题的可编辑报告 |
| 处理文件与数据 | 整理后的文件、计算结果或可核对的业务简报 |
| 制作文案与视觉素材 | 围绕同一份简报生成的文案、配图草稿和交付清单 |
| 重复执行一套流程 | 写清输入、步骤和检查方式的 Skill |

模型与媒体能力取决于所配置的服务和工具。当前能力归属与验证范围见[功能地图](./FEATURE-MAP.md)，具体步骤见[使用场景](https://limeai.run/use-cases/)。

## 从理解目标，到检查结果

| 读懂上下文 | 调用工具执行 | 检查并继续 |
| :---: | :---: | :---: |
| <img src="./docs/images/brand/lime-agent-context.webp" alt="青柠伙伴整理项目文件和参考资料" width="280" /> | <img src="./docs/images/brand/lime-agent-work.webp" alt="青柠伙伴使用工具推进任务" width="280" /> | <img src="./docs/images/brand/lime-agent-review.webp" alt="青柠伙伴核对产出与完成标准" width="280" /> |
| 带上文件、资料和约束，先确认要解决的问题。 | 读写文件、运行命令，按任务使用已连接的工具。 | 查看差异、核对结果，再从同一个任务接着做。 |

以上为品牌插画。实际操作入口与工作方式见[使用文档](https://limeai.run/docs/)。

## 快速开始

### 桌面应用

从 [Releases](https://github.com/limecloud/lime/releases) 或[下载页](https://limeai.run/download/)获取 macOS、Windows 安装包。

macOS 也可以使用 Homebrew：

```bash
brew tap aiclientproxy/tap
brew install --cask lime
```

### CLI/TUI

需要 **Node.js 18 或更高版本**。启动器按平台安装 macOS arm64/x64、Windows x64 或 Linux x64 GNU 载荷，包含本地 App Server，无需运行 Electron。

```bash
npm install -g @limecloud/lime
lime --version
lime
```

执行一次任务，或请求结构化输出：

```bash
lime exec "review this diff"
lime exec --json "review this diff"
```

### 第一次运行

1. 配置 Provider、模型和凭证，确认连接可用。
2. 选择项目目录，设置本次所需的文件、终端和工具权限。
3. 说明目标、参考材料、约束与完成标准。
4. 必要时先讨论计划，再检查文件改动、命令结果和产出。
5. 提出具体修改要求，或继续下一步工作。

## 模型、工具和执行边界

Lime 提供智能体工作空间，本身不提供模型服务。你可以选择模型服务与模型，按需连接 MCP 工具，将重复步骤整理成 Skills。能力是否可用，取决于服务、工具连接与当前执行环境。

项目文件、历史和配置默认保存在本地。调用远程模型或外部工具时，所需内容会发送到你选择的服务。按本次任务授予权限，并审阅会修改文件或外部状态的操作。

Provider 凭证默认使用仅当前用户可访问的文件，不弹出 Keychain 密码框。路径与显式 keyring 设置见[凭证存储](./docs/content/03.providers/2.credential-storage.md)。

### 网页搜索 API 地址

在启动 Lime 或其 App Server 的进程环境中设置以下可选变量。它们用于本地 `bing_search_api` 和 `google_custom_search` 工具；模型 Provider 地址另行配置。未设置或空白时使用供应商地址，自定义地址只接受 HTTP 或 HTTPS，并须返回对应的 Bing v7 或 Google Custom Search JSON 格式。

| 环境变量 | 用途 | 默认值 / 要求 |
| --- | --- | --- |
| `BING_SEARCH_ENDPOINT` | 完整的 Bing 兼容搜索 URL | `https://api.bing.microsoft.com/v7.0/search` |
| `BING_SEARCH_API_KEY` | Bing 兼容 API 凭据 | 使用该提供商时必填 |
| `GOOGLE_SEARCH_ENDPOINT` | 完整的 Google 兼容搜索 URL | `https://www.googleapis.com/customsearch/v1` |
| `GOOGLE_SEARCH_API_KEY` | Google 兼容 API 凭据 | 使用该提供商时必填 |
| `GOOGLE_SEARCH_ENGINE_ID` | Google 搜索引擎标识 | 使用该提供商时必填 |

搜索词和对应凭据会发送到所配置的地址，请使用可信服务。地址非法时该提供商返回错误，继续现有搜索回退链；自定义地址不会改变请求参数或响应格式要求。


## 云电脑

<details>
<summary>接入自己的 Linux 电脑、安装运行环境，以及备份与释放的边界</summary>

从输入框的执行位置菜单选择云端，或进入设置 → 云电脑，可购买、绑定或连接用户自己的持久 Linux 电脑。云端引导在 ECS 购买核验成功后直接选中新电脑并观察启动状态；开机后可选择首次安装，或为镜像恢复及已有环境重建任务连接。采购结果未知时保留原操作供查询。

首次购买选择地域并完成阿里云浏览器授权，缺少官方 CLI 时由 Lime 准备。没有购买模板时，可授权 Lime 比较可用的 2 核 4 GiB Linux 配置并准备专用网络，无需填写镜像、实例类型、VPC、交换机、安全组或 SSH 密钥。准备网络不会购买电脑；查看实时报价并单独确认费用后才下单。关闭后重开会查询原准备操作，不重复创建。专用网络可复用，不随实例释放。

ECS 确认购买时先检查当前版本官方运行包的描述、可访问性和长度，不预下载大包。检查失败会阻止下单并说明原因；自备环境的用户可明确选择购买后接入已有环境或使用自定义可信包。检查期间报价过期、关闭页面或切换购买上下文，均不会沿迟到响应下单。

ECS 首次安装默认获取与当前 Lime 版本匹配的官方运行包；确认系统安装后，Lime 准备桌面依赖并显示实际安装阶段和已用时间。该版本产物不可用时不下发云端安装命令，可明确重试，或在高级入口选择自己信任的安装包。关闭安装面板后需保持 Lime 运行；重启后通过“继续原操作”恢复查询。

云机通过 HTTPS 获取并校验运行包，控制请求使用用户自有阿里云授权和 Session Manager，服务只绑定云机回环地址。供应商仍检查安全组规则，Lime 不自动修改安全组。安装成功后加密保存任务连接；已有受管环境可重建连接，无需重新安装运行包。安装成功不代表真实模型、应用或登录状态已完成验收。

从私有系统镜像购买的新机可复用原安装环境，重建连接会轮换任务和桌面凭据，第三方应用登录需单独验证。选定文件可另以 age 密文保存到私有 OSS，再恢复到新机的新目录；原恢复私钥留在本机。两条路径的顺序与条件见[冷恢复时序图](internal/aiprompts/architecture.md#镜像冷恢复与选定文件恢复的组合)。

高级安装也接受可信的 `.tar.gz.json` 下载描述，其中可使用私有 HTTPS 签名地址。无需公开桶，签名有效期应覆盖依赖准备与下载；Lime 不自动续期。云机只获得运行包下载权限，云管理凭据留在本机。

已停机的按量 ECS 可在保留私有系统镜像后设置定时释放。界面显示至少 30 分钟后的确切时间，计划由阿里云执行，退出 Lime 后仍有效。到期会删除实例及随实例删除的磁盘，即使从云控制台启动也不会取消，释放保护不会阻止；再次使用前应先撤销并查询确认。镜像只在设定时核验，须保留至恢复完成；镜像、快照等保留资源继续计费。整盘镜像可能包含第三方登录资料，应作为敏感备份保管。

开发者可在原生 Linux x64 主机运行 `node scripts/app-server/linux-guest-build.mjs --out <新的绝对目录> --profile release`，生成 release 运行包、归档和完整性摘要；省略 `--profile` 使用 dev 模式。构建不会上传或发布产物。安装与发布参数见[命令合同](internal/aiprompts/commands.md#byoc-云电脑管理)，职责与安装流程见[架构图、流程图和时序图](internal/aiprompts/architecture.md#云端入口与首次装配)，敏感备份与回收条件见[状态保留与释放](internal/aiprompts/architecture.md#状态保留与释放)，实机验收范围见[Cloud 执行计划](internal/exec-plans/cloud-desktop-byoc-plan.md)。

</details>

## 文档与协作

| 你想了解什么 | 从这里开始 |
| --- | --- |
| 使用方法与设置 | [在线文档](https://limeai.run/docs/) · [仓库文档](./docs/README.md) |
| 当前能力与验证范围 | [功能地图](./FEATURE-MAP.md) |
| 从源码运行和参与贡献 | [贡献指南](./CONTRIBUTING.md) |
| 发布变化 | [发布记录](./RELEASE_NOTES.md) |
| 问题反馈 | [Issues](https://github.com/limecloud/lime/issues) |
| 漏洞报告 | [安全策略](./SECURITY.md) |

## 平台与开源协议

| 入口 | 支持平台 |
| --- | --- |
| 桌面应用 | macOS、Windows |
| CLI/TUI | macOS arm64/x64、Windows x64、Linux x64 GNU |

Lime 使用 [GPL-3.0-only](./LICENSE)，组件许可与分发范围见 [LICENSES.md](./LICENSES.md)。软件按适用许可证以现状提供，不附带担保。

### 微信交流

<img src="./docs/images/coso.jpg" alt="Lime 微信交流群二维码" width="180" />

扫码加微信，备注 `Lime`，拉你进群讨论。

源码启动与贡献见 [CONTRIBUTING.md](CONTRIBUTING.md)，安全问题见 [SECURITY.md](SECURITY.md)。
