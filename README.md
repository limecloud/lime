<div align="center">

<img src="./docs/images/lime-claw-readme.png" alt="Lime Logo" width="180" />

# Lime

### 青柠一下，灵感即来

**从一句想法，到成稿、成图、成片、成事**

本地优先的 AI Agent 创作工作台

</div>

---

## 界面预览

Lime 把创作工作台、任务会话与 Provider 管理整合在同一个本地优先桌面应用里，下面是三个核心界面的快速预览：

### 工作台首页

<img src="./docs/images/screenshot-20260319-114622.png" alt="Lime 工作台首页预览" />

在同一个 Workspace 中组织任务、技能、自动化、浏览器协助与对话输入，让一句想法继续推进为可执行结果。

### 任务与会话协作

<img src="./docs/images/screenshot-20260319-115011.png" alt="Lime 任务与会话协作预览" />

围绕单个任务持续补充上下文、追踪执行轨迹，并在同一界面中完成对话推进、模型切换与结果沉淀。

### Provider 与凭证管理

<img src="./docs/images/screenshot-20260319-114807.png" alt="Lime Provider 与凭证管理预览" />

统一管理 API Key、Connect、语音服务与 OAuth 凭证，并在同一处完成启用状态、模型配置与连接测试。

---

## 这是什么

Lime 是一个基于 Tauri 的桌面应用，面向创作者、内容团队与轻知识工作者。它把 Workspace、Agent、Skills、MCP、Claw 渠道和 Artifact 交付整合到同一个桌面环境里，让一句想法可以继续推进为成稿、成图、成片，并最终走向可执行、可协作、可沉淀的结果。

你可以在一个地方完成从想法到交付的整条链路：

- 成稿：生成和编辑文档、脚本、提纲、长文等内容产物
- 成图：产出图文方案、海报草稿与视觉素材
- 成片：围绕视频脚本、分镜、素材与创作流程持续协作
- 成事：通过 Workspace、MCP、Claw 和插件把结果继续执行、协作与交付
- 沉淀：让对话、版本、记忆、风格和项目资产可复用、可继续

---

## 产品核心

### 1. Workspace 是环境

- 项目、文件、会话、记忆、风格和人设围绕同一个工作区持续累积
- 支持主题化工作台，覆盖通用对话、社媒内容、办公文档、视频、小说等场景

### 2. Skills 是经验交互与流程编排

- Skills 封装 prompt、references、scripts、assets 和调用规则
- Skills 既定义如何交互，也定义任务如何推进
- 它们是 Lime 中经验复用、流程复用和领域方法沉淀的核心单元

### 3. MCP 是标准能力层

- 基于 MCP 接入 tools、resources、prompts 和工作边界
- 让浏览器、文件、终端和外部服务成为 Agent 的标准化能力网络
- 让 Lime 的能力扩展建立在开放标准之上

### 4. Claw 渠道是异步协作入口

- 支持通过飞书、Telegram、Discord 等渠道与 Agent 持续协作
- 支持远程触发、异步回流与渠道化交互
- 让 Agent 不只存在于桌面窗口中

### 5. Artifact 是交付物

- 持续产出文档、脚本、草稿、海报方案与版本结果
- 通过画布与工作流把过程沉淀到项目内，形成可复用的项目资产

### 6. Agent Runtime 负责执行与编排

- 基于 Aster Agent Runtime
- 支持会话、流式执行、技能调用、子任务接力与长期运行
- 底层保留多 Provider 接入、凭证池、路由与协议兼容能力

---

## 适合谁

- 内容创作者
- 品牌与运营团队
- 研究与知识整理型工作者
- 需要本地优先、结果可追溯的小团队

---

## 典型场景

### 场景 1：内容创作闭环

- 从选题、研究、写作、改稿到最终成稿
- Skills 驱动任务推进，对话、版本和风格资产持续沉淀在项目中

### 场景 2：研究整理

- 从网页资料、笔记、素材到提纲、报告和长文输出
- 通过 Skills 与 MCP 把零散信息整理成结构化交付物

### 场景 3：渠道化协作

- 通过飞书、Telegram、Discord 等 Claw 渠道接收结果、触发任务、继续协作
- 让 Agent 进入真实使用的消息入口，而不只停留在桌面端

### 场景 4：浏览器与标准能力执行

- 在同一个 Agent 会话里接入浏览器、文件、终端和外部服务
- 让 MCP 成为标准能力层，而不是零散工具调用

### 场景 5：批量与长期运行

- 针对多条素材、模板或重复流程批量执行
- 结合心跳、调度与渠道回流形成长期可运行的 Agent 流程

---

## 如何工作

Lime 的核心工作方式是：

1. 在 Workspace 内组织项目、素材、记忆和风格
2. 用 Skills 定义经验交互与流程推进
3. 通过 MCP 接入标准化外部能力
4. 通过 Claw 渠道把协作延伸到飞书、Telegram、Discord 等入口
5. 让结果沉淀为文档、脚本、版本和后续任务输入

---

## 快速开始

### 安装

#### macOS (Homebrew)

```bash
brew tap aiclientproxy/tap
brew install --cask lime
```

#### 手动下载

从 [Releases](https://github.com/aiclientproxy/lime/releases) 下载对应平台安装包。

- 当前仅提供 macOS 与 Windows 发布包，Linux 桌面端已暂停支持
- Windows 用户优先下载 `Lime_*_x64-offline-setup.exe`（NSIS 离线安装器，内置 WebView2，安装更完整）
- 如果只想下载更小的安装器，且当前网络可稳定访问微软下载源，再选择 `Lime_*_x64-online-setup.exe`
- 如被 SmartScreen 拦截，属于未签名或签名信誉不足的 Windows 常见提示，不代表安装包必然损坏

---

## 文档与开发

如果你是开发者，可查看以下文档：

- 项目文档：`docs/aiprompts/`
- 官网定位 PRD：`docs/PRD/website-positioning-prd.md`
- Agent 指南：`AGENTS.md`

开发命令：

```bash
npm install
npm run tauri:dev
npm run tauri build
```

说明：开发脚本默认使用仓库根绝对路径下的 `src-tauri/target` 作为 `CARGO_TARGET_DIR`，避免生成分散的 `target_*` 目录或误写到 `src-tauri/src-tauri/target`；如需并行跑 GUI 续测和 Rust 编译，也可以临时覆盖，例如 `CARGO_TARGET_DIR=/tmp/lime-headless-target npm run tauri:dev:headless`。
请务必在仓库根目录执行上述命令；若在 `src-tauri/` 子目录直接运行 Tauri 命令，容易误生成额外的 `target` 目录。

---

## 开源协议

[GNU General Public License v3 (GPLv3)](https://www.gnu.org/licenses/gpl-3.0)

## 免责声明

本项目仅供学习研究使用，用户需自行承担使用风险。  
本项目不直接提供 AI 模型服务，模型能力由第三方提供商提供。

---

<div align="center">

### 微信交流

<img src="./docs/images/coso.jpg" alt="Lime 微信交流群二维码" width="180" />

扫码加微信，备注 `Lime`，拉你进群讨论。

</div>
