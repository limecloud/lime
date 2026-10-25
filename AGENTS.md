# Lime 源码仓库指南

本仓库没有外部用户和历史兼容负担。发现重复实现、临时路径或已脱离构建图的代码，优先删除或直接替换，不保留双轨。

## 核心准则：优先复制源码，保留 Lime 产品边界

复刻范围内默认直接复制 `/Users/coso/Documents/dev/rust/codex` 的可复用源码，能整目录复制就整目录复制；在许可证、功能归属和依赖闭包满足要求后，直接接入 Lime 现役 owner。无品牌的目录名、路径层级、文件名、模块名、类型名和函数名沿用上游，不以逐文件重写、重新抽象或另起名称代替复制。复制后裁剪无消费者内容，迁移调用并清理被替代的实现；不得保留 `lime-rs/upstream/` 或第二套源码与 runtime。执行细则见 [源码复制与迁移准则](internal/aiprompts/codex-source-alignment.md)。

Lime 自有主题、品牌、多模型/多协议、Provider 控制面、服务端能力、配置与发布合同是必须保留的产品差异，由现役 owner 继续负责。批量复制前必须划出这些 owner 的保护写集；共享构建、配置、schema 注册和发布文件只做最小合并，不得整文件覆盖。Codex 的品牌、产品配置和云端服务不是复制目标；其登录、Cloud、账号、遥测、计费、发布和单模型服务控制面不得进入 Lime。这里排除的是上游产品服务，不包括实现共享主链所需的本地 App Server JSON-RPC、runtime、协议和工具代码；这些仍应优先复制，并接入 Lime 自有服务端与 Provider 边界。

复制时区分协议能力、本地工具执行与远端托管服务：不得把 Codex 产品服务或官方域名条件套到 Lime 自有 endpoint 的本地工具上。模型能力仍以现役 catalog 的显式声明与实际 wire 支持求交集，不按品牌、模型名或复制来源推断。

Lime 自有标识中的 `codex-rs`、`codex_`、`codex-`、`CODEX_` 等品牌名称必须适配，其他无品牌名称保持上游原名，新命名使用短的领域词。Codex 等第三方应用作为明确支持的集成目标时，目标选择值、官方配置目录和文件名（例如技能包目标 `codex`、`~/.codex/skills`、`~/AGENTS.md`）按外部应用契约保留；它们不得变成 Lime 自有产品命名或数据路径。法定署名、必要外部协议固定值及第三方集成契约必须登记来源、消费者与保留理由。

Computer Use 复刻覆盖 macOS/Windows、Desktop、CLI/TUI、Chrome Plugin 和 Office connector，共用同一 App Server、工具权限与 canonical 投影。CLI 必须在 Electron 完全退出后仍可使用共享能力；适配器合同、授权/撤销/租约与证据要求见 [源码复制与迁移准则](internal/aiprompts/codex-source-alignment.md) 和 [命令边界](internal/aiprompts/commands.md)。方案与实际进度放在 `internal/exec-plans/`，不把静态证据、规则更新或设计图记为产品验收通过。

## 事实源

1. 代码仓库是唯一记录系统。影响实现的决策、计划和验证结果必须落在仓库内。
2. 根文件只保留仓库级约束和导航；领域规则放在 `internal/aiprompts/`，执行进度放在 `internal/exec-plans/`。
3. 每种能力只能有一个继续演进的 owner。`current` 可扩展；`compat` 只能委托；`deprecated` 只能迁出；`dead` 应删除并补回流守卫。
4. Agent runtime 的唯一业务主链是 `Product Surface -> App Server JSON-RPC -> RuntimeCore -> Thread/Turn/Item projection`。当前 Product Surface 包括 `Electron Desktop Host -> GUI` 与 `CLI/TUI Host -> tui`；Computer Use 的 native、Chrome、Office 适配器也必须挂在同一 App Server 边界。所有 surface 共享协议、runtime、持久化与工具 owner，不建立第二套业务后端。未来 Cloud 只能通过认证 transport 接入同一 App Server 边界，不预建平行 runtime。
5. Codex 是唯一主对标：Agent loop、状态机、Thread/Turn/Item、工具生命周期、MCP、Skills、Multi-Agent 和历史恢复直接读 `/Users/coso/Documents/dev/rust/codex` 源码；Desktop 行为使用 REA 安装包证据。Lime 的主题、品牌、多模型、多协议和服务端能力优先保持现役 owner；catalog、默认选择、model switch、provider capability/readiness、retry/circuit breaker 与多模态 sampling 仅参考 `/Users/coso/Documents/dev/rust/grok-build` 的适用机制，不能替代 Codex 的 runtime、harness 或产品语义。provider wire、canonical content 与媒体 lowering 可辅助参考 `/Users/coso/Documents/dev/js/opencode`。
6. Rust 后端只能落在 `lime-rs/crates/**` 的现有领域 owner。禁止增加 `lime-rs/upstream/` 或其他整仓镜像目录；源码按真实消费者依赖闭包筛选，直接迁入对应 Lime owner。迁移期间不覆盖未知并行改动、不启动第二业务后端；消费者切换后清除重复实现，不长期维护两套同义 owner。
7. Provider 网络边界归 `model-provider`；工具定义、权限和执行归 `tool-runtime`；会话/回合编排归 `agent-runtime` 与 App Server；投影和持久化归 App Server、`thread-store` 与对应 repository。
8. Lime 是唯一产品品牌。Lime 自有产品代码、crate、模块、符号、命令、协议方法、环境变量、配置目录、界面和发布产物不得带 `codex` 品牌前缀或 Codex 产品标识；内部 `codex_`、`codex-`、`CODEX_` 等 Lime 自有命名迁为 Lime 名称。明确支持的第三方应用集成边界保留对方所需的目标标识和官方路径，例如 `codex` 技能包目标与 `~/.codex/skills`，不能因去 Lime 自有品牌而误删。治理/审计文档可以在明确的上游来源、证据或迁移记录中引用 Codex 名称，但不得成为产品入口或运行时身份。许可证署名、无法改变的外部协议值和已证明的第三方集成契约必须记录消费者及证据，不得借此把 Lime 自有产品继续命名为 Codex。
9. 已退役 runtime 的 vendor、workspace crate、迁移目录与专用 skill 均为 `dead / deleted / forbidden-to-restore`。能力缺口只能参考 Codex 在 current owner 重建；不得恢复依赖、catalog、文档入口、fallback 或 compat 包装。

## 工程约束

1. 全程使用中文；代码注释遵循所在文件既有语言。
2. 先读后写，保持改动集中；不主动提交、推送、重置或创建分支。
3. 工作树存在未知改动时，遵循 `internal/aiprompts/parallel-agent-collaboration.md`：声明窄写集、避让脏热区，不覆盖他人改动。
4. 重大架构变更必须在同一变更集中更新 `internal/aiprompts/architecture.md`，并由责任开发者在执行计划和 PR 描述填写架构图确认。未确认不得标记完成或进入 release evidence。
5. 非生成文件接近 `800` 行时优先拆分；超过 `1000` 行不得继续堆叠业务逻辑，除非执行计划记录退出条件。
6. 用户数据、日志、缓存和凭证必须走平台 API 或统一封装；新增行为默认同时考虑 macOS 与 Windows。
7. `scripts/` 根目录与一级领域目录受冻结基线保护。新增脚本优先进入既有 `scripts/<domain>/`、`scripts/lib/` 或所属 package。
8. 生产路径不得回退 mock。mock 只允许测试夹具明确使用；renderer、Electron、App Server、GUI smoke 和业务 E2E 都必须走真实 current bridge。
9. 用户可见文案必须覆盖 `zh-CN`、`zh-TW`、`en-US`、`ja-JP`、`ko-KR`，并补稳定回归。
10. 配置、协议和依赖改动必须同步 schema、消费者、文档、锁文件与测试。
11. 产品代码必须直接修改原始仓库中的现役文件。`.lime/verification/**`、`candidate/` 及其他临时副本仅用于保存冻结快照和验证证据，不得作为产品开发目录或以事后回写代替原目录修改；并行冲突必须在原始仓库内协调窄写集。
12. Codex 对齐先核对 `/Users/coso/Documents/dev/rust/codex` 对应源码，按本页核心准则优先整目录复制到现役 owner，并沿用无品牌的目录、文件、类型、函数与调用结构。改动限于已登记的品牌、Lime 保留差异、依赖和平台接线；不得以风格偏好重新实现。不能直接复用的部分记录原因，公开源码缺失的 Desktop 行为使用 REA 安装包证据，不将自研实现、压缩符号或猜测名称标成 Codex 原名。逐项记录 revision、源路径、许可证、目标路径、必要适配、消费者、删除项和验证。Computer Use 方案必须包含 PRD、架构图、时序图、流程图、适配器边界和平台验收矩阵。

13. 产品减负以 Codex 为唯一功能基线，保留 Lime 多模型/多协议、视觉主题、品牌、自有服务端与 Provider 边界，以及用户明确保留的专家广场、消息渠道。这些差异不因 Codex 缺少对应能力而删除或被上游实现覆盖。除此之外，Codex 没有的产品能力应删除入口、实现、配置、协议、数据消费、专用依赖、文案和测试，不以隐藏菜单代替删除。首页 Banner、创作场景和旧平台功能不享有额外保留例外。共享底层能力先核对现役消费者与 Codex 证据，禁止误删聊天、工具和恢复主链。

## 协议与质量

1. 改 Electron/App Server 命令时，同步 Desktop Host/preload、JSON-RPC protocol/client、前端 gateway、catalog 与测试 fixture，并执行 `npm run test:contracts`。
2. 普通改动优先运行受影响的定向测试；Rust 变更先用 `npm run test:rust:related -- <paths...>` 或对应 crate 测试，再按风险扩大。
3. GUI、Bridge、Workspace 或 Desktop Agent 主路径改动至少运行 `npm run verify:gui-smoke`；Agent chat current fixture 改动先运行 `npm run smoke:agent-runtime-current-fixture`。CLI/TUI 改动先运行对应 Rust crate 测试，再补真实 stdio App Server fixture。
4. 真实交互证据分级：浏览器投影是 Gate A；Desktop Gate B 必须证明真实 Electron、preload/IPC、`app_server_handle_json_lines`、App Server JSON-RPC、runtime/read model 和用户可见状态；CLI Gate B 必须证明真实 `lime exec`、stdio transport、App Server JSON-RPC 与同一 canonical Thread/Turn/Item 投影；TUI Gate B 还必须经过真实 PTY、alternate screen、键盘输入和终端恢复。Computer Use Gate B 还要分别证明 native helper 的 macOS TCC/AX 与 Windows UIA/输入失败路径、Chrome MV3/Native Messaging/受信 proxy 与同一 turn 绑定、Office task pane/session/schema/command 与 stale session 拒绝；Electron 退出后仍需通过 CLI 复验共享链路。
5. 默认本地门禁为 `npm run verify:local`。全量前端测试优先用 `npm run test:resume` 续跑，避免无差别重跑。
6. 更新版本、Forge、Electron 或 workspace manifest 时执行 `npm run verify:app-version`。

## 执行方式

1. 长任务必须更新 `internal/exec-plans/`，记录目标、写集、退出条件、验证和阻塞。
2. 路线图任务先说明主目标、当前阶段和下一刀；治理删除必须直接服务主链交付。
3. 用户明确无兼容需求时，直接迁移调用并删除旧入口，不新增包装层。
4. 收尾报告当前/兼容/废弃/已删除分类、验证结果、未验证原因和完成度百分比。

## 导航

- 文档入口：`docs/README.md`
- 工程入口：`internal/aiprompts/README.md`
- 全局架构：`internal/aiprompts/architecture.md`
- 架构与边界：`internal/aiprompts/overview.md`、`internal/aiprompts/commands.md`
- 源码复刻与 Lime 保留边界：`internal/aiprompts/codex-source-alignment.md`、`.codex/skills/lime-replication/SKILL.md`
- 治理：`internal/aiprompts/governance.md`
- 质量与 GUI：`internal/aiprompts/quality-workflow.md`、`internal/aiprompts/playwright-e2e.md`
- 执行计划：`internal/exec-plans/README.md`
- Computer Use 方案：[PRD](internal/exec-plans/native-computer-use-prd-20261025.md)、[架构与图表](internal/exec-plans/native-computer-use-architecture-20261025.md)、[交付与验收](internal/exec-plans/native-computer-use-delivery-20261025.md)

## 高频命令

```bash
npm run verify:local
npm run test:contracts
npm run verify:gui-smoke
npm run smoke:agent-runtime-current-fixture
npm run smoke:claw-chat-current-fixture
npm run governance:legacy-report
npm run governance:scripts
npm run electron:dev
npm run bridge:health -- --timeout-ms 120000
npm run test:rust:related -- <paths...>
cargo test --manifest-path "lime-rs/Cargo.toml"
```
