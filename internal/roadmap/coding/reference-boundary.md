# Coding 参考边界

> 状态：active
> 更新时间：2026-06-13

## 目标

本文件定义 Lime 借鉴外部编程 agent 项目时的边界：能复制什么、必须重写什么、哪些内容不能进入 Lime。

核心原则：

```text
参考实现可以提供算法、状态机、测试夹具和执行经验；
Lime 只能保留 Lime 的 owner、命名、协议、Provider、UI 和治理分类。
```

## 命名规则

新文档、crate、package、type、command、method、UI 文案中禁止保留外部产品品牌和品牌前缀。

推荐命名：

| 语义 | 推荐 |
| --- | --- |
| 编程剖面 | `coding profile` / `CodingProfile` |
| 执行器 | `ExecutionBackend` / `coding backend` |
| 外部 CLI 兼容 | `external_harness` |
| 补丁工具 | `patch tool` / `PatchView` |
| 命令工具 | `command tool` / `CommandOutputView` |
| 事件适配 | `runtime event adapter` |
| 多模型槽位 | `model slot` |

避免命名：

- 外部产品名。
- 外部 CLI command 名作为 Lime current API。
- `lime_` / `lime-` 品牌前缀，除非历史兼容或对外发布要求。

## 代码复制规则

| 来源类型 | 允许动作 |
| --- | --- |
| Apache-2.0 或兼容许可证 | 可复制小范围实现，但必须保留许可证要求、重命名、适配 Lime owner，并补测试。 |
| AGPL 或强 copyleft 来源 | 不复制代码，只参考设计和行为。 |
| 未明确许可证代码 | 不复制。 |
| 生成 schema / OpenAPI models | 不复制为 Lime 协议事实源，只可参考字段设计。 |
| 文档/README 思路 | 可转成 Lime 自有设计，但不得保留品牌、营销语或不适用架构。 |

复制前必须先回答：

1. 这个能力的 Lime owner 是谁？
2. 是否会形成第二套事实源？
3. 是否绕过 Provider Store、RuntimeCore、Artifact 或 Evidence owner？
4. 是否有许可证义务？
5. 是否能用 Lime 当前验证入口证明？

复制后的最小要求：

| 要求 | 说明 |
| --- | --- |
| owner 改名 | 类型、模块、错误名、命令名、UI 文案都改为 Lime 语义或中性领域名。 |
| 协议改形 | 参考协议对象不能直接成为 App Server JSON-RPC schema。 |
| 测试迁移 | 参考 fixture 需要改成 Lime RuntimeEvent / ReadModel / projection fixture。 |
| 许可证记录 | 执行计划或迁入 PR 记录来源、许可证和文件映射。 |
| secret 审查 | 日志、raw payload、output ref 先过 redaction。 |
| 平台审查 | 文件系统、process、sandbox、network 说明 macOS / Windows / Linux 行为差异。 |

不能为了“能 copy 就 copy”绕过 owner；能复制的是算法结构和测试场景，不是产品身份、协议事实源或运行入口。

## 可复制/重写的内容

优先级从高到低：

1. 状态机：thread/turn/item、active turn、input queue。
2. 工具生命周期：start/progress/result/failure pairing。
3. 文件与补丁：patch apply、diff、checkpoint metadata。
4. 命令执行：PTY/process、stdout/stderr streaming、exit status。
5. 权限策略：approval、sandbox、command policy。
6. 事件投影：headless event、fixture replay、sequence verifier。
7. 上下文组装：project rules、workspace roots、instruction discovery。
8. 输出治理：truncation、spill refs、redaction。

复制后必须改成：

- Lime event family。
- Lime error category。
- Lime Provider slot。
- Lime artifact/evidence refs。
- Lime i18n presentation copy。

## 只能参考的内容

- 终端型产品的信息架构。
- 多 harness selection 的产品概念。
- 外部 CLI agent 的 session notification 协议。
- skill provider discovery 的目录优先级思想。
- 云端任务环境、worker、remote execution 的产品分层。
- UI 视觉和布局节奏。

这些内容进入 Lime 时必须重新设计，不能复制框架、组件、品牌、协议或服务端假设。

## 禁止进入 Lime 的内容

- 第二套 app-server 或 runtime owner。
- 第二套 Provider key 存储。
- 原 CLI/TUI 作为生产主入口。
- 以外部 home/config/data root 为 Lime 数据根。
- 产品页读取 local key、环境变量或外部 CLI 凭证作为生产 fallback。
- UI 组件直接调用 Provider SDK。
- mock backend 生产自动 fallback。
- secret-bearing raw payload 进入 projection state。
- 恢复 `lime-rs/src/**` 或旧 command wrapper。

## 多模型边界

Lime 的 coding 能力必须保持多模型。

| 问题 | 决策 |
| --- | --- |
| 是否绑定单一模型服务 | 否。coding 使用 Provider Store + model slots。 |
| 是否允许自定义兼容端点 | 允许，但作为 Provider Store entry。 |
| 是否允许不同槽位用不同模型 | 允许，base/coding/review/fast/local 分离。 |
| 是否允许外部 CLI 自己选模型 | 只在 compat adapter 内记录 diagnostics，不成为 Lime routing truth。 |
| 是否允许模型不可用时 mock | 生产不允许，必须 needs-setup / blocked。 |

模型 slot 不能只停留在文档：

- RuntimeEvent 或 diagnostics 必须能说明本轮实际使用哪个 slot。
- fallback 必须有 reason，不允许静默换模型。
- UI 只展示 readiness 和配置入口，不保存 key。
- Evidence Pack 记录 routing decision refs，但不记录 secret。

## 前端边界

Coding Workbench 的 UI 只消费 projection：

```text
AgentUiProjectionState
  -> coding selectors
  -> Coding Workbench surfaces
```

禁止：

- 页面组件订阅 raw runtime stream 后自建状态。
- 页面组件直接调用 shell / file / Provider API。
- 页面组件从正文解析工具结果。
- 页面组件把审批结果只存 React state。

允许：

- 保存 selected tab、collapse、focus、scroll anchor、draft input。
- 通过 runtime client 提交 `turn/start`、`turn/cancel`、`action/respond`。
- 打开 artifact/evidence owner surface。

迁移期 adapter 规则：

- 旧 thread item 可以 adapter 成 RuntimeEvent，但 adapter 本身不能继续长新业务状态。
- adapter 输出必须经过 `CodingWorkbenchView` selector，不允许直接构造 React props。
- 当 App Server 已直接输出同类 event 后，adapter 对应分支必须进入 deprecated 或删除。
- adapter 测试只证明历史 hydrate，不作为新 turn current 可交付证据。

## 许可证与证据

后续任何代码迁入都必须在对应 PR 或执行计划中记录：

- 来源路径。
- 许可证。
- 迁入文件。
- 重命名和 owner 映射。
- 定向测试。
- 是否触及生产 Provider、文件系统、命令执行或权限。

如果来源许可证不清楚，默认只参考，不复制。

### 2026-06-13 迁入记录

| 能力 | 来源许可 | Lime owner | 迁入文件 | 验证 |
| --- | --- | --- | --- | --- |
| patch grammar / lenient parser / streaming parser / fuzzy seek | Apache-2.0 | `lime-rs/crates/apply-patch` + App Server `runtime_backend/coding_events/patch.rs` | `lime-rs/crates/apply-patch/src/{parser,streaming_parser,seek_sequence}.rs`、`lime-rs/crates/app-server/src/runtime_backend/coding_events/patch.rs` | `cargo test --manifest-path "lime-rs/Cargo.toml" -p apply-patch`；`cargo test --manifest-path "lime-rs/Cargo.toml" -p app-server runtime_backend::coding_events -- --nocapture` |
| patch apply replacement engine / workdir path guard / agent tool entry | Apache-2.0 | `lime-rs/crates/apply-patch` + `lime-rs/crates/agent/src/tools/apply_patch_tool.rs` | `lime-rs/crates/apply-patch/src/apply.rs`、`lime-rs/crates/apply-patch/src/lib.rs`、`lime-rs/crates/agent/src/tools/apply_patch_tool.rs`、`lime-rs/crates/agent/src/agent_tools/{catalog,execution}.rs` | `cargo test --manifest-path "lime-rs/Cargo.toml" -p apply-patch`；`cargo test --manifest-path "lime-rs/Cargo.toml" -p lime-agent tools::apply_patch_tool -- --nocapture`；`cargo test --manifest-path "lime-rs/Cargo.toml" -p lime-agent agent_tools::catalog -- --nocapture` |

## 路线图文档措辞约束

`internal/roadmap/coding/` 是 Lime current 计划，不是外部竞品研究笔记。文档里允许出现：

- 中性能力名：`apply-patch`、`execpolicy`、`file-search`、`external_harness`。
- 中性来源描述：本地 Rust 执行型参考仓库、终端型多 harness 参考仓库。
- Lime owner：App Server、RuntimeCore、ExecutionBackend、Provider Store、AgentUI projection。

文档里不应出现：

- 外部品牌名作为章节标题、owner、API、crate、package、命令或 UI 文案。
- 外部 CLI 命令名作为 Lime current 方法。
- 外部 App Server / protocol 作为 Lime 协议事实源。

如需记录具体来源路径，放到执行计划的迁入记录或代码注释中的许可证说明，不放到用户主路线图叙述中。

## 文档措辞

内部 roadmap 可使用能力描述：

- “执行型 Rust runtime”
- “终端型多 harness 客户端”
- “外部 CLI harness”
- “云端 orchestration layer”
- “多模型 Provider registry”

不要使用外部产品品牌来命名 Lime current 能力。历史分析可以留在聊天、研究笔记或具体迁入记录中，但进入 `internal/roadmap/coding/` 的路线图必须使用 Lime 语义。
