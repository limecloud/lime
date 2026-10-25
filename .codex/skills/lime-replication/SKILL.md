---
name: lime-replication
description: 以 Lime 品牌为边界复刻 Codex 与原生 Computer Use；支持整树取样和批量迁移，最终直接落到 Lime 现役 owner，并以 REA 证据、依赖闭包和 Windows/macOS/Desktop/CLI/TUI/Chrome/Office 验收收口。
---

# Lime 复刻工作流

这个 skill 用于“复刻现有实现”任务，尤其是 Agent、Computer Use、Desktop、CLI/TUI、Chrome 插件和 Office 加载项。它把源码、安装包和运行证据分开处理，防止把相似实现、猜测名称或单端 mock 当成完成。

先读取：

- [仓库规则](../../../AGENTS.md)
- [源码复制与迁移准则](../../../internal/aiprompts/codex-source-alignment.md)
- [全局架构](../../../internal/aiprompts/architecture.md)
- [质量事实源](../../../internal/aiprompts/quality-workflow.md)
- [品牌边界与清理清单](references/brand-boundary.md)

需要已发货行为或私有 Desktop/插件证据时，再调用 `reverse-engineer-anything`；普通公开源码分析不运行 REA。GUI 视觉改动再调用 `lime-design-language`，删除和唯一 owner 收口再调用 `lime-governance`。

## WHEN

满足以下任一条件时使用：

- 用户要求“完全复刻、整目录复制、按上游目录/文件/函数接入”。
- 任务跨越 App Server、RuntimeCore、Desktop、CLI/TUI、原生 helper、Chrome 或 Office。
- 结论依赖安装包、ASAR、Native Host、扩展运行时或其他已发货产物。
- 需要判断“复制了多少、哪些消费者已经迁移、哪些仍是旧实现”。

## WHAT

最终交付必须同时回答四个问题：

1. **源码**：来源 revision、整树复制收据、许可证和逐项哈希是否一致。
2. **消费**：Lime 的现役入口是否已经调用复制后的唯一 owner，依赖闭包是否编译。
3. **证据**：REA 的 Evidence ID、搜索边界、静态/运行证据和未知项是否可复核。
4. **验收**：macOS、Windows、Desktop、CLI/TUI、Chrome、Office 是否分别通过真实进程和失败路径门禁。

“文件数量相同”“有同名类型”“浏览器 fixture 通过”都不能单独证明复刻完成。

## HOW

### 1. 锁定范围与 Lime 品牌边界

先写执行计划，列出目标能力、产品入口、平台、保留的 Lime 差异和退出条件。建立唯一事实源：`Product Surface -> App Server JSON-RPC -> RuntimeCore -> Thread/Turn/Item projection`。

复刻分成四个不可跳过的状态：`frozen-source -> migrated-owner -> brand-clean -> upstream-removed`。整树复制只服务于第一、第二个状态；复制树不能成为产品层、长期依赖或文档入口。每次状态转换都在账本中记录负责人、写集、验证命令和未决项。

Lime 的产品边界先于上游相似度：Lime 主题、品牌、多模型/多协议、服务端能力、Provider catalog、配置与发布合同都是 current owner，迁移不能覆盖、降级或拆出第二套实现。复制前核对 [Lime 保留边界](../../../internal/aiprompts/codex-source-alignment.md#复刻注意项lime-保留边界)，把各项 owner、消费者、保护写集和必要适配记入账本；消费者切换前验证仍由原 owner 提供。Codex 登录、Cloud、账号、遥测、订阅、发布、服务控制面、产品 bundle 和品牌入口均排除，不因整树复制而进入 Lime。服务依赖检查覆盖默认 endpoint、认证与凭证读取、远端开关、遥测和升级入口，避免仅改显示品牌后仍调用上游产品服务。本地 App Server JSON-RPC、runtime、协议、持久化和工具代码仍是复制目标，不得把它们误判为被排除的 Codex 云端产品服务。

品牌规则是硬约束：

- 产品名、应用 bundle/package、安装包、对外命令、扩展/加载项显示名和公开 API 入口使用 Lime 品牌。
- 不新增 `codex-rs`、`codex_*`、`codex-...` 作为 Lime 的现役目录、crate、package、命令、函数或发布标识。
- 无品牌的上游路径层级、目录、文件、模块、类型和函数名默认原样保留，不给所有领域名称增加 `lime` 前缀，也不因命名偏好重新实现。
- 不保留 `lime-rs/upstream/`、`vendor-upstream/`、`candidate/` 或其他整树镜像作为产品源码层。若并行流程已经建立临时复制树，必须在迁移完成后删除该目录，并在仓库扫描中证明没有 Cargo、脚本、文档或构建产物继续引用它。
- 技术实现中确需保留的带品牌协议固定值、第三方许可证和明确的第三方应用集成契约，必须在审计账本中标注“外部来源”，不能作为 Lime 产品品牌；一般的无品牌路径和符号按上游复制，不属于品牌例外。
- 不把 Codex 服务端、认证、Cloud、遥测、账号、计费、发布或单模型控制面接入 Lime；Lime 的服务端协议、Provider 边界、主题和多模型能力继续由现役 owner 负责。发现上游依赖这些能力时，优先裁剪依赖闭包并记录排除理由。
- 按[源码迁移准则](../../../internal/aiprompts/codex-source-alignment.md#复刻注意项lime-保留边界)分别检查协议能力、本地工具与远端托管服务；本地 custom tool 不沿用官方域名限制，仍要求模型显式能力与 wire 支持，不连带启用 hosted 服务。
- 不做全局字符串替换来伪造品牌迁移；先确定 public boundary，再逐项改入口、产物和展示文案。

### 2. 整树复制，不逐文件重写；复制后直接迁入现役 owner

对公开源码先冻结 source path、revision、工作树状态和排除规则；默认使用 `rsync -a` 或等价目录复制，把必要的 manifest、`src/**`、`tests/**`、`build.rs`、schema/fixture、许可证和递归依赖闭包一起迁入。能整目录复制就整目录复制，不先手写 Lime 版本再把原树留作参考。已有的共享 workspace manifest、锁文件、配置、schema 注册表和 Provider catalog 只做最小接线，锁文件与生成物走 Lime 现役生成流程，不用上游整文件覆盖 Lime 配置或并行改动。

复制目标必须是 Lime 现役目录（例如 `lime-rs/crates/<domain>` 或已确认的现役 owner），不是永久的 `upstream/`、`candidate/` 或 `.lime/verification/`。当需要保持源树相对路径时，先在内存/临时目录完成整树取样，再一次性复制到现役 owner；不要把临时目录加入 workspace。若上游 crate 名称暴露 Codex 品牌，保留其实现结构但在 Lime public boundary 做一次明确的品牌适配，并记录原名→Lime 名称映射；不要留下双轨 crate。

复制后立即运行本 skill 的校验脚本，生成机器收据。账本每一项至少包含：

`source_path, destination_path, source_revision, source_sha256, destination_sha256, copy_status, owner, consumers, brand_action, validation, unknowns`。

状态只能使用 `copied`、`migrated-consumer`、`deleted-conflict`、`source-unavailable` 或 `blocked`。不要把“已复制”写成“已接入”。

### 3. 以编译闭包决定迁移顺序

从真实入口运行 `cargo metadata`、`cargo tree`、定向 `cargo check/test`，按失败的 path dependency、feature、生成物和测试 fixture 递归补齐闭包。先迁公共协议和配置，再迁 runtime/tool owner，最后迁 CLI/TUI、Desktop bridge、原生 helper、Chrome 和 Office。

每次切换消费者都检查：

- App Server JSON-RPC、schema、TS client、catalog、fixture 是否同步。
- 同一 Thread/Turn/Item 是否贯穿 Desktop、CLI、TUI 和工具结果。
- 权限、取消、lease、target identity 是否仍由唯一 owner 管理。
- 旧实现是否还被旁路读取（设置、日志、记忆、搜索、统计、回放、脚本）。
- Lime 自有主题、多模型路由、Provider readiness/retry/circuit breaker、服务端配置和发布标识是否仍由原 owner 提供；任何被复制代码直接覆盖这些边界的改动都必须阻断并重新切分写集。

消费者切换后立即执行一次品牌和路径回流检查：产品源码、workspace member、package/bin、配置根、bundle/package 标识、扩展 manifest、Native Messaging 注册和用户文案不得出现 Codex 产品品牌；协议固定值、许可证署名和审计报告中的外部来源按 [品牌边界清单](references/brand-boundary.md) 单独登记。检查失败时停在 `brand-clean` 之前，不得进入平台验收。

消费者切换并通过验证后，才删除冲突实现、旧入口和失效测试，并补回流守卫；没有用户确认或执行计划退出条件，不做批量删除。

### 4. REA 证据工作流

按目标类型路由：ASAR/JavaScript 用 `analyze_javascript_application`，原生/归档用 `open_binary`，浏览器交互用 `capture_browser_scenario`，Electron 用 `list_electron_targets` 与目标工具。先取 summary，再针对具体 module/node/function 做小范围追踪；不要重复同一分析。

每条结论分为：

- **观察**：直接来自 Evidence 的字段、符号、路径或运行步骤。
- **推断**：由多个观察推导的行为，写出推导链。
- **未知**：工具未覆盖、源码不可得、平台未运行或证据不完整的部分。

报告必须引用 Evidence ID、目标摘要/哈希、分析边界和限制。静态 JavaScript、字符串或符号不能证明运行成功；fixture、浏览器投影或 `/health` 不能升级为 Desktop/CLI Gate B。

### 5. 四端与插件验收

至少分别取得以下证据：

- **macOS**：真实签名 helper、TCC/AX、窗口/坐标/截图、输入、停止/撤销、锁屏和多显示器。
- **Windows**：真实 UIA、焦点/DPI、输入、UIPI/secure desktop/锁屏、签名和 per-user 注册。
- **Desktop**：Electron → preload/IPC → `app_server_handle_json_lines` → JSON-RPC → RuntimeCore → canonical projection。
- **CLI/TUI**：真实 `lime exec`/stdio/PTY，Electron 完全退出时仍能调用同一协议、权限和 Thread/Turn/Item。
- **Chrome**：MV3 → Native Messaging host → shared broker/App Server；验证 profile/tab/navigation identity、权限拆分和 Electron 关闭后的 CLI。
- **Office**：加载项 session discovery → 动态 schema → execute；验证未保存工作簿、readback、失败后的 `outcome_unknown`、取消和多工作簿隔离。

公开源码缺失时，复制来源记 `source-unavailable`；平台未实现或未运行时，验收项记具体缺口及 `blocked` 原因。来源可得性与产品验收分别记账，不能用设计图替代验收。

### 6. 收尾与报告

按 `current / compat / deprecated / dead` 分类报告；最终源码树不得含产品级 `upstream/` 中转层、未授权 Codex 品牌入口或第二套业务后端。报告列出：实际替换、保留的 Lime 差异、已删除冲突、命令与测试结果、证据等级、未验证原因和下一刀。

收尾门禁至少包括：`rg` 路径/引用扫描、workspace/package/bin 清单、依赖图、生成 schema/fixture、安装产物名称和四端 Gate B 结果。`lime-rs/upstream/` 的删除由负责该写集的流程完成；本 skill 只接受删除后的仓库状态，不把“另一个进程正在删除”记为完成。

## REFERENCE

- 复制账本模板：[source-copy-ledger.md](references/source-copy-ledger.md)
- REA 证据模板：[rea-evidence.md](references/rea-evidence.md)
- 平台门禁矩阵：[platform-gates.md](references/platform-gates.md)
- 整树校验脚本：[verify-source-copy.mjs](scripts/verify-source-copy.mjs)

一个合格的迁移条目示例：

```json
{
  "source_path": "codex-rs/app-server-protocol/src/protocol/v2/computer_use_config.rs",
  "destination_path": "lime-rs/crates/app-server-protocol/src/protocol/v2/computer_use_config.rs",
  "source_revision": "<40-char-revision>",
  "copy_status": "migrated-consumer",
  "owner": "app-server-protocol",
  "brand_action": "generic upstream names retained; Lime schema generation adapted",
  "consumers": ["app-server", "cli", "tui"],
  "validation": ["cargo check -p app-server-protocol", "cargo test -p app-server-protocol"],
  "unknowns": []
}
```

## LIMITS

- 不把 REA 反编译结果、压缩变量名、截图或相似 UI 当成公开源码复制。
- 不把永久 `upstream/`、候选副本、mock backend 或 Electron 回调当成 CLI 生产能力。
- 不为了让测试变绿而改依赖版本、伪造工具结果、放宽权限或恢复旧 WebSocket/URL key fallback。
- 不在没有 source path、revision、证据 ID 或 owner 的情况下声称“完全复刻”。
- 不主动提交、推送、重置或修改系统权限/证书；涉及删除和批量迁移时按仓库确认规则执行。
