# 参考运行时主链对齐进度日志

## 2026-04-20

### 已完成

- 基于本地参考运行时源码镜像 `/Users/coso/Documents/dev/js/claudecode` 与用户提供的 Claude Code runtime 架构图，重新按 `Query Loop / Tool Runtime / Memory / Remote / Task / State / Host Product Surface` 七组能力做了一次全局差距盘点，避免后续继续把“产品壳差异”和“运行时主链未对齐”混为一谈。
- 重新核对现有总计划与仓库 current 文档后，确认 `Query Loop / Tool Runtime / Memory / Task / State` 六条运行时主链的判断不需要回退：
  - [upstream-runtime-alignment-plan.md](./upstream-runtime-alignment-plan.md) 里已有的 `aligned` 结论仍然成立。
  - [task-agent-taxonomy.md](../aiprompts/task-agent-taxonomy.md) 与 [state-history-telemetry.md](../aiprompts/state-history-telemetry.md) 定义的 current 边界仍是正确事实源。
  - 这次差距盘点的重点应从“再补一套 runtime”转向“补宿主 surface 或明确不对齐的产品层选择”。
- 明确当前最值得继续推进的 `current gap`：
  - `ConfigTool` 仍缺少参考运行时那组宿主配置闭环：`classifierPermissionsEnabled / remoteControlAtStartup / taskCompleteNotifEnabled / inputNeededNotifEnabled / agentPushNotifEnabled` 当前仍是“已知上游 setting，但 Lime runtime 未实现”的状态；`permissions.defaultMode` 也尚未对齐参考运行时的 `plan / dontAsk` 口径。
  - `voiceEnabled` 已不再是完全缺失：`runtime_turn` 当前已经通过宿主 callback 回填 `ConfigTool` 读写链路，但它仍只覆盖语音开关本身，没有连带补齐参考运行时那组 remote-control / push-notification 宿主配置矩阵。
  - `SendMessage / ListPeers` 仍只覆盖 team 内 peers；参考运行时支持的 `uds:` / `bridge:` cross-session peer address 目前在 Lime 里仍是受控失败，说明 team runtime 的当前事实源虽然已收口，但跨会话协作 surface 还没补齐。
  - `hooks` 与 `skills` 仍是明显半成品：`MCP hook / Prompt hook / Agent hook` 还是占位实现，`SkillExecutionMode::Agent` 依旧未实现；这说明 Lime 已经有工具层 current surface，但还没补齐参考运行时图里那层可执行的 extension / hook orchestration。
  - 浏览器宿主工具面仍有明确缺口：`shortcuts_list` 还返回“当前后端尚未实现”，说明 browser / desktop host integration 仍未闭环。
- 明确本轮盘点中不应被误判成“运行时未对齐”的部分：
  - `OpenClaw / DevBridge / telegram_remote_cmd` 仍按 [remote-runtime.md](../aiprompts/remote-runtime.md) 的既有判断处理：它们属于 `compat / deprecated` 支撑面，不应再被拔高成需要追平参考运行时的 current remote control plane。
  - `channels_cmd.rs` 这组 AI / 通知渠道 CRUD 目前大多还是 `暂未实现` 空壳；由于仓库已明确“多渠道 current 主链已经迁到 gateway_channel_cmd.rs”，这组命令更像需要重新分类并收口的 legacy surface，而不是值得继续扩展的 current 功能。
  - `Buddy / Kairos / Ultraplan` 这类 feature-flagged 产品壳在参考运行时中属于宿主产品选择；Lime 当前源码里没有对应实现，这件事应先作为产品路线判断，而不是默认归入“主链未对齐”。

### 当前判断

- 这一步服务于运行时主链对齐的关系是：把“主链已对齐”与“宿主 surface 未补齐”明确拆开，避免后续继续在已完成的 `M1-M5` 主链上空转。
- 目前最值得继续推进的一刀固定为：
  - 先补 `ConfigTool + Remote Control / Push Notification` 这一组宿主配置 surface，再补 `SendMessage / ListPeers` 的 cross-session peer messaging。
  - 只有补完这两刀，参考运行时架构图里最关键的 `permissions/config/remote-control/team-runtime` 宿主面才会真正进入 Lime 的 `current` 主链，而不再停留在“工具存在、文档对齐、产品层仍缺口”的状态。
- 后续默认顺序：
  1. `ConfigTool` 宿主配置矩阵收口。
  2. `SendMessage / ListPeers` 的 `uds:` / `bridge:` peer transport 判断与实现。
  3. `hooks / skills` 从占位实现推进到至少一条可执行 current 主链。
  4. 再决定 `Buddy / Kairos / Ultraplan` 是否属于 Lime 产品路线，不默认把它们当作 runtime 对齐任务。

### 继续推进（ConfigTool / classifierPermissionsEnabled）

- 在 [config_tool.rs](../../src-tauri/crates/aster-rust/crates/aster/src/tools/config_tool.rs) 把 `classifierPermissionsEnabled` 从“已知上游 setting，但固定 unsupported”提升为真正可读写的 current setting：
  - `ConfigTool` 现在直接读写用户面 key `classifierPermissionsEnabled`
  - 默认读取值收口为 `false`
  - 读取时兼容旧内部 key `SECURITY_PROMPT_CLASSIFIER_ENABLED`
  - 写入 current key 后会清掉旧内部 key，避免继续停留在“一套工具面、一套内部键”的双轨状态
- 在 [security/mod.rs](../../src-tauri/crates/aster-rust/crates/aster/src/security/mod.rs) 把安全扫描 ML toggle 的事实源切到 current key，并把旧内部 key 降回 compat fallback：
  - 当前 runtime 先读 `classifierPermissionsEnabled`
  - 只有 current key 缺失时才回退 `SECURITY_PROMPT_CLASSIFIER_ENABLED`
  - 这样 `ConfigTool` 写入的值会真实影响 `SecurityManager::is_ml_scanning_enabled()`，不再出现“Config 改了但安全扫描不认”的断层
- 补定向回归：
  - `ConfigTool` 新增 default false、legacy fallback、rewrite current key 的测试
  - `security/mod.rs` 新增 default false、legacy fallback、current precedence 的测试
- 已执行校验：
  - `rustfmt --edition 2021 "src-tauri/crates/aster-rust/crates/aster/src/security/mod.rs" "src-tauri/crates/aster-rust/crates/aster/src/tools/config_tool.rs"` 通过
  - `env CARGO_TARGET_DIR="/tmp/lime-target-configtool-check" cargo check --manifest-path "src-tauri/crates/aster-rust/crates/aster/Cargo.toml" --lib` 通过
  - `env CARGO_TARGET_DIR="/tmp/lime-target-configtool" cargo test --manifest-path "src-tauri/crates/aster-rust/crates/aster/Cargo.toml" config_tool --lib` 未能完成：当前工作区存在与本轮无关的既有编译错误 [execution/manager.rs](../../src-tauri/crates/aster-rust/crates/aster/src/execution/manager.rs) `query_session` 未导入，导致 test target 在进入 `ConfigTool` 测试前就失败

### 当前判断补充

- `CCD-006` 已从“整组 setting 都停留在 unsupported”前进到“至少 `classifierPermissionsEnabled` 已进入 current 主链并接上真实宿主行为”。
- 这一步服务路线图主目标的关系是：先把确实已有宿主落点的配置面收回 current，避免继续把所有 host surface 缺口打成一个大包。
- 当前 `Config / Host Surface` 剩余最值得继续推进的缺口变为：
  - `remoteControlAtStartup`
  - `taskCompleteNotifEnabled / inputNeededNotifEnabled / agentPushNotifEnabled`
  - `permissions.defaultMode` 的 `plan / dontAsk` 语义
  这些项仍不能硬映射到 Lime 现有的 OS 自启动、桌面通知或现有 runtime mode；下一刀应继续按“先找真实宿主落点，再决定 current / compat / deprecated”推进。

### 继续推进（ConfigTool / host audit）

- 继续核对剩余 host settings 对应的真实宿主落点后，确认 `remoteControlAtStartup` 仍不能进入 `current`：
  - Lime 当前只有 [config_cmd.rs](../../src-tauri/src/commands/config_cmd.rs) 的 `get_auto_launch_status / set_auto_launch` 这条 OS 登录项 `current` 主链。
  - 它控制的是“开机自启动”，不是参考运行时 `remoteControlAtStartup` 那种“默认是否为所有 session 开启 Remote Control”的语义。
  - 因此这项 setting 继续明确维持为 `unsupported`；不能把 `remoteControlAtStartup` 硬映射到 `auto_launch`。
- 继续核对通知相关 surface 后，确认 `taskCompleteNotifEnabled / inputNeededNotifEnabled / agentPushNotifEnabled` 也还没有可接入的 `current` 宿主面：
  - Lime 当前确实有 [update_cmd.rs](../../src-tauri/src/commands/update_cmd.rs) / [update_window.rs](../../src-tauri/src/services/update_window.rs) 这条更新提醒通知面，但它只服务“版本更新提醒”，不是 remote-control / mobile push。
  - [channels_cmd.rs](../../src-tauri/src/commands/channels_cmd.rs) 这组通知渠道 CRUD 仍主要返回 `暂未实现`，更接近 `deprecated` 候选 stub，而不是可复用的 mobile push control plane。
  - 因此这三项 setting 继续明确维持为 `unsupported`；不能把它们误判成“只差 Config 映射”。
- 这次审计后，`CCD-006` 的事实源分类进一步收敛为：
  - `classifierPermissionsEnabled`：`current`
  - `voiceEnabled`：`current`（宿主 callback）
  - `remoteControlAtStartup`：`current gap`，当前无真实宿主面
  - `taskCompleteNotifEnabled / inputNeededNotifEnabled / agentPushNotifEnabled`：`current gap`，当前无 mobile push control plane
  - `get_auto_launch_status / set_auto_launch`：`current`，但仅属于 OS auto-launch，不属于 remote-control config
  - `channels_cmd.rs` 通知渠道 CRUD：`deprecated` 候选，不作为这组 setting 的事实源
- 这一步服务路线图主目标的关系是：继续把“宿主产品面缺口”和“还能在 current 主链补的 runtime 对齐项”拆开，避免后续再把现有 OS 自启动、更新提醒或 stub 渠道面误当成参考运行时的 remote-control / push-notification 对齐。
- 当前 `CCD-006` 的下一刀收敛为两类选择：
  - 真正新增 remote-control / mobile push 宿主面，再回头把这些 setting 接入 `current`
  - 或把这组差异明确沉淀为产品层不对齐，不再把它们当成“只差一层映射”的 runtime 缺口
- `permissions.defaultMode` 的 `plan / dontAsk` 仍单独保留：
  - 仓库内部虽然已有 prompt 侧 `PermissionMode::Plan / DontAsk` 文本能力
  - 但 runtime config、provider flag 与 permission inspector 还没有等价 `current` 语义，暂时不能直接在 `ConfigTool` 放行

### 继续推进（ConfigTool / permissions.defaultMode 审计）

- 继续沿 `permissions.defaultMode` 深挖后，确认 `plan / dontAsk` 仍不能进入 Lime `current`：
  - [plan_mode_tool.rs](../../src-tauri/crates/aster-rust/crates/aster/src/tools/plan_mode_tool.rs) 的 `plan` 当前是显式 `EnterPlanMode / ExitPlanMode` 工具流，不是持久化的全局默认权限模式。
  - [claude_code.rs](../../src-tauri/crates/aster-rust/crates/aster/src/providers/claude_code.rs) 与 [codex.rs](../../src-tauri/crates/aster-rust/crates/aster/src/providers/codex.rs) 的 provider flag 仍只围绕 `ASTER_MODE = Auto / SmartApprove / Approve / Chat` 做映射，没有 `plan / dontAsk` 的全局执行语义。
  - [permission_inspector.rs](../../src-tauri/crates/aster-rust/crates/aster/src/permission/permission_inspector.rs) 的工具审批主链也只分支 `Chat / Auto / Approve / SmartApprove` 四类，没有 `dontAsk` 对应的全局判断分支。
- 因此这次没有去“补 enum 让 ConfigTool 通过”，而是继续把边界收紧成真实语义：
  - `plan` 的失败提示现在明确说明：它当前是工具驱动的 plan flow，不是 persisted default mode。
  - `dontAsk` 的失败提示现在明确说明：它当前缺少 provider flag + `PermissionInspector` 的全局 runtime 支撑。
- 补定向回归：
  - `ConfigTool` 新增 `plan` 专项失败断言，锁住它必须继续指向 `EnterPlanMode / ExitPlanMode`
  - `ConfigTool` 新增 `dontAsk` 专项失败断言，锁住它必须继续暴露“缺少 provider / inspector runtime”
- 这一步服务路线图主目标的关系是：把 `permissions.defaultMode` 从“模糊地未实现”推进成“缺哪条 current 主链就明确说哪条”，避免后续 AI 或人工把 prompt 文本能力误判成已经具备可持久化的全局权限模式。

### 继续推进（CCD-009 / channels_cmd 治理守卫）

- 顺手继续推进 `CCD-009` 后，确认 [ImConfigPage.tsx](../../src/components/channels/ImConfigPage.tsx) 当前走的是 [channelsRuntime.ts](../../src/lib/api/channelsRuntime.ts) 暴露的 `gateway_channel_* / *_channel_probe / wechat_channel_*` current API，而不是 `channels_cmd.rs` 那组旧 CRUD 命令。
- 因此本轮没有去扩或修 [channels_cmd.rs](../../src-tauri/src/commands/channels_cmd.rs) 的 `暂未实现` stub，而是先把它纳入仓库治理守卫：
  - 在 [legacySurfaceCatalog.json](../../src/lib/governance/legacySurfaceCatalog.json) 新增 `channels-crud-stub-commands`
  - 把 `get_ai_channels / create_ai_channel / get_notification_channels / create_notification_channel` 等整组旧命令标成 `dead-candidate`
  - 允许引用路径保持为空，意味着任何前端 `safeInvoke/invoke` 若再接回这组命令，`governance:legacy-report` 都会直接报违规
- 补定向目录册测试：
  - [legacySurfaceCatalog.test.ts](../../src/lib/governance/legacySurfaceCatalog.test.ts) 新增 `channels_cmd` 命令组断言，锁住分类、命令集合与 `allowedPaths=[]`
- 这一步服务路线图主目标的关系是：先封住旧 remote / notification CRUD 命令回流，避免后续 AI 在 current remote 主链已固定到 `gateway_channel_*` 的情况下，又从 `channels_cmd.rs` 这层 stub surface 重新长功能。

### 继续推进（CCD-009 / channels_cmd 下线）

- 在确认 current 前端没有任何 `safeInvoke/invoke` 依赖这组命令后，本轮继续把 [channels_cmd.rs](../../src-tauri/src/commands/channels_cmd.rs) 从宿主命令面正式下线：
  - 从 [runner.rs](../../src-tauri/src/app/runner.rs) 的 `tauri::generate_handler!` 移除了整组 `get_ai_channels / create_ai_channel / get_notification_channels / create_notification_channel` 等旧 CRUD 注册
  - 从 [commands/mod.rs](../../src-tauri/src/commands/mod.rs) 移除了 `pub mod channels_cmd;`
  - 删除了 [channels_cmd.rs](../../src-tauri/src/commands/channels_cmd.rs) 文件本体，不再让这组 `暂未实现` stub 继续进入编译图
- 为了防止这条旧路再次回流，又补了 Rust 侧治理守卫：
  - 在 [legacySurfaceCatalog.json](../../src/lib/governance/legacySurfaceCatalog.json) 新增 `rust-channels-cmd-legacy-surfaces`
  - 明确禁止 `commands::channels_cmd::` 与 `pub mod channels_cmd;` 重新出现在 Rust 代码中
  - 在 [legacySurfaceCatalog.test.ts](../../src/lib/governance/legacySurfaceCatalog.test.ts) 补了对应断言
- 补了删除后的最小收尾验证：
  - `npx vitest run "src/lib/governance/legacySurfaceCatalog.test.ts"` 通过（`129 passed`）
  - `npm run governance:legacy-report` 通过；`rust-channels-cmd-legacy-surfaces` 命中为 `0`，整体 `边界违规=0`
  - `npm run test:contracts` 通过；命令契约、Harness 契约与 cleanup contract 全部通过
  - `env CARGO_TARGET_DIR="/tmp/lime-target-channels-governance-check" cargo check --manifest-path "src-tauri/Cargo.toml" -p lime --lib` 通过，确认 `runner.rs / commands/mod.rs` 删除 `channels_cmd` 后没有新增编译悬挂
- 当前分类已收口为：
  - `src/lib/api/channelsRuntime.ts + gateway_channel_* + browser connector / ChromeBridge`：`current`
  - `channels_cmd.rs` 旧 AI / 通知渠道 CRUD stub surface：`dead`
  - `legacySurfaceCatalog` 中的 `channels-crud-stub-commands` 与 `rust-channels-cmd-legacy-surfaces`：继续保留为防回流守卫
- 这一步服务路线图主目标的关系是：把 `channels_cmd.rs` 从“口头上判成 stub / deprecated 候选”推进成“宿主命令面已实际下线”，让 current remote 主链只剩 `gateway_channel_* + browser connector / ChromeBridge`。
- `CCD-009` 至此可以视为已完成；下一刀应回到 `CCD-007`，继续判断 `SendMessage / ListPeers` 的 `uds:` / `bridge:` cross-session peer transport 是否进入 Lime `current`。

### 继续推进（CCD-007 / peer transport 可行性审计）

- 继续对照参考运行时后，确认 `CCD-007` 当前缺的不是“把 `SendMessage` 放开到 `uds:` / `bridge:`”这一层，而是缺少 upstream 那套 cross-session peer transport 底座：
  - 参考运行时在 `UDS_INBOX` 打开时会启动本地 UDS messaging server，提供 `uds:` ingress。
  - 参考运行时还会持续写 PID/session registry，并回填 session name 与 `bridgeSessionId`，供 `ListPeers` 发现本机会话与 remote peer。
  - 参考运行时的 `SendMessage` 也不是只做字符串判断；它会把 `bridge:` 真正投递到 remote peer channel，把 `uds:` 真正投递到本地 socket。
- Lime 当前的 `current` 事实源还停留在 team runtime 内部：
  - [subagent_tools.rs](../../src-tauri/src/commands/aster_agent_cmd/tool_runtime/subagent_tools.rs) 里 `SendMessage` / `SendInput` callback 最终只会走 `agent_runtime_send_subagent_input_internal(...)`
  - [execution/manager.rs](../../src-tauri/crates/aster-rust/crates/aster/src/execution/manager.rs) 的 `send_input_with_runtime(...)` 只能把消息排进已存在的 session runtime queue，本质上还是“对现有 session_id 排队 turn”
  - [team_tools.rs](../../src-tauri/crates/aster-rust/crates/aster/src/tools/team_tools.rs) 的 `ListPeers` 只从 `TeamSessionState` 枚举 team 内成员，`send_to` 也只有 teammate name；没有 session registry、没有 socket 地址、没有 remote bridge peer id
  - [agent_control.rs](../../src-tauri/crates/aster-rust/crates/aster/src/tools/agent_control.rs) 对 `uds:` / `bridge:` 目前仍是正确的“受控失败”，它只是防止误投，不代表已经具备 transport
- 因此 `CCD-007` 的下一刀不该再表述为“是否要支持两个地址前缀”，而应收敛成先选 transport 底座：
  - 若要补本机 cross-session peer messaging，至少需要一套 Lime 自己的 session discovery / reachability registry，并定义与 upstream `uds:` 的兼容映射
  - 若要补 remote peer messaging，至少需要一套独立于 `browser connector / ChromeBridge` 的 remote session identity + ingress 当前事实源；现有 browser bridge 不能直接冒充 `bridge:session_*`
  - 在这两套底座都不存在之前，继续保持 `uds:` / `bridge:` 受控失败是正确的 current 行为
- 这一步服务路线图主目标的关系是：把 `CCD-007` 从“看起来像一个小工具参数差异”重新校准为“缺 session registry / local ingress / remote ingress 三块底座”，避免后续继续在错误抽象层空转。
- 当前最值得继续推进的一刀变为：
  - 优先判断 Lime 是否真的需要“本机跨会话 peer messaging”这条产品能力；若需要，先设计 Lime 自己的 local session registry，再决定是否对外兼容 `uds:` 语义
  - `bridge:` remote peer messaging 暂不建议先做，因为 Lime 当前 remote `current` 主链仍是 browser connector / ChromeBridge，而不是参考仓库的 Remote Control peer session

### 继续推进（CCD-007 / local session peer 最小 current）

- 在不引入新 socket/remote transport 的前提下，先把 Lime 已有 `session_id + runtime queue` 收成一条最小本机 cross-session `current`：
  - [ListPeers](../../src-tauri/crates/aster-rust/crates/aster/src/tools/team_tools.rs) 不再只返回 team 成员；现在会继续保留活跃 team peers，并额外枚举同一 `working_dir` 下最近 `12` 个本机顶层 session（`User / Scheduled / Terminal`），其 `send_to` 固定为 synthetic `uds:<session-id>`
  - 这条 `uds:` 目前不是参考运行时那种真实 socket path，而是 Lime current 的兼容地址语义，用来把“本机会话 peer”稳定映射到现有 `session_id`
  - team peers 仍保持原状：`send_to=name`、`agent_id=name@team`；因此现有 team runtime surface 没有回退
- [SendMessage](../../src-tauri/crates/aster-rust/crates/aster/src/tools/agent_control.rs) 现在正式接住这条本地 peer surface：
  - `to="uds:<session-id>"` 会先校验目标 session 存在，随后复用现有 `send_input` callback，把消息排进目标 session 的 runtime queue
  - 这条本机 cross-session 路径只接受纯文本消息；结构化 `shutdown_request / shutdown_response / plan_approval_response` 仍明确拒绝，避免误把 team protocol 平移到跨会话 session
  - 为了保留 reply 语义，投递到目标 session 前会把正文包装成 `<cross-session-message from="uds:<source-session-id>">...</cross-session-message>`；接收侧至少能看见来源地址，而不会和普通用户输入完全混在一起
  - `bridge:` 仍保持受控失败，继续明确为“remote peer messaging 未进入 current”
- 这一步的边界结论也更清楚了：
  - `current`：team peer messaging、同一 `working_dir` 下的 synthetic `uds:<session-id>` local session peer messaging
  - `current gap`：真实 live session registry、真正的 UDS socket ingress、`bridge:` remote peer identity / ingress
  - `deprecated / dead`：无新增；本轮没有回流旧 remote surface
- 这一步服务路线图主目标的关系是：先把参考运行时图里“本机跨会话协作”压缩成一条 Lime 能真实交付的 current 路径，不再停留在“只会识别前缀但始终失败”的半成品状态；下一刀应继续判断是否需要把 synthetic local registry 提升成真正的 live registry，以及是否值得单独实现 `bridge:` remote peer transport。

### 继续推进（CCD-008 / SkillTool current）

- 继续对照参考运行时后，确认 Lime 在 `skills` 这一层的最大假对齐点其实不是 `WorkflowTool`，而是 [tool.rs](../../src-tauri/crates/aster-rust/crates/aster/src/skills/tool.rs) 里的 `SkillTool`：
  - 参考运行时里，skills 并不是只登记一次调用意图；它们会真正进入 prompt / workflow / agent 执行链。
  - Lime 之前的 `SkillTool` 只会返回 `Launching skill: ...`，本质上还是占位壳；即使 skill frontmatter 已声明 `execution-mode: workflow`，工具面也没有真实执行。
- 本轮先把这条最显眼的占位执行链收成最小 `current`：
  - [tool.rs](../../src-tauri/crates/aster-rust/crates/aster/src/skills/tool.rs) 现在改为持有显式 registry，不再把 `SkillTool` 绑定死在全局单例，后续也更适合定向测试和局部收口。
  - `SkillTool` 现在会像 [workflow_tool.rs](../../src-tauri/crates/aster-rust/crates/aster/src/tools/workflow_tool.rs) 一样解析当前 session provider；若 skill 自己绑定 provider，也会复用当前 provider 或按绑定名创建 provider，不再只回一句“已启动”。
  - `Prompt` 与 `Workflow` 两种 `execution_mode` 现在都会通过 `SkillExecutor` 真实执行，输出会回带 `success / output / error / stepsCompleted` 元数据；`Workflow` 不再只是“另有 WorkflowTool 可用”的旁路能力。
  - `SkillExecutionMode::Agent` 仍保持明确失败：当前 runtime 继续返回“尚未实现 SkillExecutionMode::Agent”，避免把多轮 agent orchestration 假装成已经 current。
- 这一步后的分类也更清楚了：
  - `current`：`SkillTool` 的 prompt/workflow 执行、`WorkflowTool` 的 workflow 执行、基于当前 session/provider 的 skill 执行解析
  - `current gap`：`SkillExecutionMode::Agent`、skill frontmatter hooks、skill 级 hook 注册与执行编排
  - `compat / deprecated / dead`：无新增；本轮没有再引入第二套 skill 执行壳
- 已执行校验：
  - `rustfmt --edition 2021 "src-tauri/crates/aster-rust/crates/aster/src/skills/tool.rs"` 通过
  - `env CARGO_INCREMENTAL=0 RUSTFLAGS="-Cdebuginfo=0" CARGO_TARGET_DIR="/Users/coso/Documents/dev/ai/aiclientproxy/lime/.codex-target" cargo test --manifest-path "src-tauri/crates/aster-rust/crates/aster/Cargo.toml" test_skill_tool_executes_prompt_skill_with_provider --lib --no-default-features -- --nocapture` 通过（`1 passed`）
  - `env CARGO_INCREMENTAL=0 RUSTFLAGS="-Cdebuginfo=0" CARGO_TARGET_DIR="/Users/coso/Documents/dev/ai/aiclientproxy/lime/.codex-target" cargo test --manifest-path "src-tauri/crates/aster-rust/crates/aster/Cargo.toml" test_skill_tool_executes_workflow_skill_with_provider --lib --no-default-features -- --nocapture` 通过（`1 passed`）
  - `env CARGO_INCREMENTAL=0 RUSTFLAGS="-Cdebuginfo=0" CARGO_TARGET_DIR="/Users/coso/Documents/dev/ai/aiclientproxy/lime/.codex-target" cargo test --manifest-path "src-tauri/crates/aster-rust/crates/aster/Cargo.toml" test_skill_tool_rejects_agent_mode_skill --lib --no-default-features -- --nocapture` 通过（`1 passed`）
  - `env CARGO_INCREMENTAL=0 RUSTFLAGS="-Cdebuginfo=0" CARGO_TARGET_DIR="/Users/coso/Documents/dev/ai/aiclientproxy/lime/.codex-target" cargo check --manifest-path "src-tauri/crates/aster-rust/crates/aster/Cargo.toml" --lib --tests --no-default-features` 已尝试执行；当前阻塞来自现有 `providers.rs` 集成测试在关闭 `provider-aws` feature 时仍引用 `bedrock / sagemaker_tgi`，不是本轮 `SkillTool` 改动引入
- 这一步服务路线图主目标的关系是：先把参考运行时图里“skills 真正可执行”这条主链从 placeholder 推进成 current，避免 `CCD-008` 长期停留在“工具名看起来对齐、实际没有执行”的假完成状态；下一刀应回到 hooks 的真实加载与执行链。

### 继续推进（CCD-008 / hooks-skills gap 审计）

- 继续对照 `/Users/coso/Documents/dev/js/claudecode` 后，`hooks / skills` 的剩余差距已经可以拆成 4 条具体链路，而不再只是笼统一句“hooks 半成品”：
  - 参考运行时在 [loadSkillsDir.ts](/Users/coso/Documents/dev/js/claudecode/src/skills/loadSkillsDir.ts) 与 [loadAgentsDir.ts](/Users/coso/Documents/dev/js/claudecode/src/tools/AgentTool/loadAgentsDir.ts) 会从 frontmatter 解析 `hooks`；Lime 当前 [types.rs](../../src-tauri/crates/aster-rust/crates/aster/src/skills/types.rs) 的 `SkillFrontmatter` 还没有 `hooks` 字段，[loader.rs](../../src-tauri/crates/aster-rust/crates/aster/src/skills/loader.rs) 也不会解析这层配置。
  - 参考运行时在 [hooks.ts](/Users/coso/Documents/dev/js/claudecode/src/utils/hooks.ts)、[execPromptHook.ts](/Users/coso/Documents/dev/js/claudecode/src/utils/hooks/execPromptHook.ts) 与 [execAgentHook.ts](/Users/coso/Documents/dev/js/claudecode/src/utils/hooks/execAgentHook.ts) 里会真实执行 `prompt / agent` hooks；Lime 当前 [executor.rs](../../src-tauri/crates/aster-rust/crates/aster/src/hooks/executor.rs) 只有 `command / url` 进入真实执行，`mcp / prompt / agent` 仍然是 `warn! + success(None)` 的占位实现。
  - 参考运行时不仅能加载 hooks，还会从 plugin / settings / frontmatter 合并并热更新；Lime 当前虽然有 [loader.rs](../../src-tauri/crates/aster-rust/crates/aster/src/hooks/loader.rs) 能读 `.claude/settings.json` 与 `.claude/hooks/*.json`，但仓库里还没有稳定 `current` bootstrap 在 session 启动时调用 `load_project_hooks(...)`，也没有 plugin hook load / hot reload 主链。
  - 参考运行时的 hook event 面更宽，包含 `Setup / CwdChanged / FileChanged / PermissionDenied / Elicitation / WorktreeCreate` 等；Lime 当前 [types.rs](../../src-tauri/crates/aster-rust/crates/aster/src/hooks/types.rs) 还缺这一整批 event，现有真实调用点基本只落在 [task_list_tools.rs](../../src-tauri/crates/aster-rust/crates/aster/src/tools/task_list_tools.rs) 的 `TaskCreated / TaskCompleted`。
- 因此 `CCD-008` 当前更准确的边界应该是：
  - `current`：`TaskCreated / TaskCompleted` hooks、`command / url` hook executor、`SkillTool` prompt/workflow execution
  - `current gap`：project hooks 加载入口、hook event 矩阵、`prompt / mcp / agent` hook executor、skill/agent frontmatter hooks、plugin hooks/hot reload、`SkillExecutionMode::Agent`
  - `compat / deprecated / dead`：暂无额外 legacy surface 需要回流；当前主要问题是执行链缺失，而不是旧链未删干净
- 这一步服务路线图主目标的关系是：把 `CCD-008` 从“好像哪里都缺一点”收敛成可下刀的 4 条执行链，避免后续又去补 schema、枚举或文案，却没有真的补到 hooks/skills 的 current 主路径。
- 当前最值得继续推进的一刀也更明确了：
  - 先把 `load_project_hooks(...) + 一个已存在 executor-backed event` 收成第一条真正的 hooks current 主链，优先考虑 `UserPromptSubmit` 或 `SessionStart`
  - 等加载入口与第一条 event 跑通后，再决定是补 `Prompt hook` 还是继续上探 `Agent hook / MCP hook`

### 继续推进（CCD-008 / UserPromptSubmit hooks current）

- 这一轮继续沿上一刀确定的主线，把 project hooks 的第一条真实运行时链路收成 `UserPromptSubmit current`，而不是继续停留在“loader 有了、executor 有了、runtime 没人调用”的半成品：
  - [loader.rs](../../src-tauri/crates/aster-rust/crates/aster/src/hooks/loader.rs) 新增 `load_project_hooks_to_registry(...)`，并让现有 `load_hooks_from_file(...) / load_project_hooks(...)` 都回收到底层 `*_to_registry` 路径，避免再维持“一套全局加载逻辑 + 一套局部加载逻辑”的双轨。
  - [executor.rs](../../src-tauri/crates/aster-rust/crates/aster/src/hooks/executor.rs) 新增 `run_hooks_with_registry(...)` 与 `run_user_prompt_submit_hooks_with_registry(...)`；现有全局 helper 现在只是委托到 registry-aware 执行器，不再把“只能跑全局注册表”当成 hooks 的隐式前提。
  - [runtime_turn.rs](../../src-tauri/src/commands/aster_agent_cmd/runtime_turn.rs) 现在会在 `prepare_runtime_turn_ingress_context(...)` 之后、`prepare_runtime_turn_submit_preparation(...)` 之前，为当前 `workspace_root` 创建临时 registry，加载 `.claude/settings.json` 与 `.claude/hooks/*.json`，然后对 `request.message` 执行 `UserPromptSubmit`；若 hook 返回 block，则在真正 submit 前直接短路返回错误。
- 这一步后的分类再次收紧为：
  - `current`：`TaskCreated / TaskCompleted` hooks、`command / url` hook executor、project-level `UserPromptSubmit` hooks、`SkillTool` prompt/workflow execution
  - `current gap`：`SessionStart` 等更多 event 的 runtime bootstrap、`prompt / mcp / agent` hook executor、skill/agent frontmatter hooks、plugin hooks/hot reload、`SkillExecutionMode::Agent`
  - `compat / deprecated / dead`：无新增；本轮没有为了接 runtime 而把 hooks 再接回全局共享状态
- 已执行校验：
  - `rustfmt --edition 2021 "src-tauri/crates/aster-rust/crates/aster/src/hooks/loader.rs" "src-tauri/crates/aster-rust/crates/aster/src/hooks/executor.rs" "src-tauri/crates/aster-rust/crates/aster/src/hooks/tests.rs" "src-tauri/src/commands/aster_agent_cmd/runtime_turn.rs"` 通过
  - `env CARGO_TARGET_DIR="/Users/coso/Documents/dev/ai/aiclientproxy/lime/.codex-target" cargo test --manifest-path "src-tauri/crates/aster-rust/crates/aster/Cargo.toml" test_run_user_prompt_submit_hooks_with_registry_blocks_project_hook --lib --no-default-features` 通过（`1 passed`）
  - `env CARGO_TARGET_DIR="/Users/coso/Documents/dev/ai/aiclientproxy/lime/.codex-target" cargo test --manifest-path "src-tauri/Cargo.toml" enforce_runtime_turn_user_prompt_submit_hooks_should_ --lib` 通过（`2 passed`）
- 这一步服务路线图主目标的关系是：把参考运行时图里“project hooks 真能拦截用户提交”这条最贴主链的 extension path 收成 Lime 的第一条 hooks `current`，避免 `CCD-008` 继续停在“只有 task hooks 真执行，用户输入主链仍完全绕过 hooks”。
- 下一刀应继续回到同一主线：
  - 优先把 `SessionStart` 接到这条新的 per-registry runtime bootstrap 上
  - 然后再决定是继续扩 event 矩阵，还是开始把 `Prompt hook` 从占位 executor 推进成真实执行

### 继续推进（CCD-008 / SessionStart hooks current）

- 这一轮继续沿同一条 per-registry hooks 主链，把 `SessionStart` 收到 Lime 的 runtime session 创建入口上，而不是把 hook 语义下沉到 `SessionManager::create_session(...)` 这种底层公共能力：
  - 新增 [runtime_project_hooks.rs](../../src-tauri/src/commands/aster_agent_cmd/runtime_project_hooks.rs)，把“按 `workspace_root` 创建临时 registry、加载 project hooks、执行指定 event”收成单一 helper；`runtime_turn` 的 `UserPromptSubmit` 现在也复用这层，不再自己拼 registry。
  - [executor.rs](../../src-tauri/crates/aster-rust/crates/aster/src/hooks/executor.rs) 新增 `run_session_start_hooks_with_registry(...)`，让 `SessionStart` 也能像 `UserPromptSubmit` 一样基于指定 registry 执行，而不是只能依赖全局注册表。
  - [session_runtime.rs](../../src-tauri/src/commands/aster_agent_cmd/session_runtime.rs) 的 `create_runtime_session_internal(...)` 现在会在创建 session 并持久化默认 access mode 后，对当前 workspace 运行 project-level `SessionStart`，其 `source` 固定落为 `startup`；hook 执行失败或返回 block 只记录 warning，不会反向阻断 session 创建。
- 这一步后的分类继续收紧为：
  - `current`：`TaskCreated / TaskCompleted` hooks、project-level `UserPromptSubmit` hooks、project-level `SessionStart` hooks、`command / url` hook executor、`SkillTool` prompt/workflow execution
  - `current gap`：`SessionStart` 的 `resume / clear / compact` 复用、更多 runtime event bootstrap、`prompt / mcp / agent` hook executor、skill/agent frontmatter hooks、plugin hooks/hot reload、`SkillExecutionMode::Agent`
  - `compat / deprecated / dead`：无新增；本轮没有把 hooks 再扩散到底层 `SessionManager` 或其它非主路径
- 已执行校验：
  - `rustfmt --edition 2021 "src-tauri/crates/aster-rust/crates/aster/src/hooks/executor.rs" "src-tauri/src/commands/aster_agent_cmd/runtime_project_hooks.rs" "src-tauri/src/commands/aster_agent_cmd/runtime_turn.rs" "src-tauri/src/commands/aster_agent_cmd/session_runtime.rs" "src-tauri/src/commands/aster_agent_cmd/mod.rs"` 通过
  - `env CARGO_TARGET_DIR="/Users/coso/Documents/dev/ai/aiclientproxy/lime/.codex-target" cargo test --manifest-path "src-tauri/Cargo.toml" create_runtime_session_internal_should_run_project_session_start_hooks --lib` 通过（`1 passed`）
  - `env CARGO_TARGET_DIR="/Users/coso/Documents/dev/ai/aiclientproxy/lime/.codex-target" cargo test --manifest-path "src-tauri/Cargo.toml" enforce_runtime_turn_user_prompt_submit_hooks_should_ --lib` 通过（`2 passed`）
- 这一步服务路线图主目标的关系是：把参考运行时图里“session start 也会经过 project hooks”这条 extension 主链补进 Lime 的 current，而不是继续停留在“只有用户提交会经过 hooks，创建新 session 仍完全绕过 hooks”的半成品状态。
- 下一刀应继续回到同一条主链：
  - 优先把 `SessionStart` 的 `resume / clear / compact` 也复用到这套 per-registry bootstrap
  - 或者开始把 `Prompt hook` 从占位 executor 推进成真实执行，但不建议两条线同时铺开

### 继续推进（CCD-008 / SessionStart compact hooks current）

- 这一轮继续沿同一条 per-registry hooks 主链，把 `SessionStart(compact)` 也接进 Lime 的 runtime `current`，并且仍然只落在宿主入口，不把 hooks 语义下沉到更底层公共能力：
  - [runtime_project_hooks.rs](../../src-tauri/src/commands/aster_agent_cmd/runtime_project_hooks.rs) 新增 `resolve_runtime_project_hook_workspace_root(...)` 与 `run_runtime_session_start_project_hooks_for_session(...)`，先按 `session_id -> runtime session detail -> workspace_id` 反查当前 workspace；若 workspace 已缺失，再显式回退 `working_dir`，避免 compact 阶段重新散落一套“自己猜 project root”的旁路。
  - [runtime_turn.rs](../../src-tauri/src/commands/aster_agent_cmd/runtime_turn.rs) 的 `compact_runtime_session_with_trigger(...)` 现在会在压缩成功、终态事件写回后，继续对当前 session 执行 project-level `SessionStart`，其 `source` 固定落为 `compact`；hook 执行失败或返回 block 仍只记 warning，不会反向破坏 compact 成功结果。
  - [runtime_project_hooks.rs](../../src-tauri/src/commands/aster_agent_cmd/runtime_project_hooks.rs) 也补了两组定向测试，分别覆盖：
    - 正常 `workspace_id -> workspace_root` 路径会收到 `source=compact`
    - workspace 缺失时会回退 `working_dir`，而不是直接让 compact hook 静默失效
- 这一步后的分类继续收紧为：
  - `current`：`TaskCreated / TaskCompleted` hooks、project-level `UserPromptSubmit` hooks、project-level `SessionStart(startup / compact)` hooks、`command / url` hook executor、`SkillTool` prompt/workflow execution
  - `current gap`：`SessionStart(resume)` 是否存在真实 current 入口仍待确认；`/clear` 当前只是前端本地状态清空，不应再伪造为后端 `SessionStart(clear)`。除此之外，更多 runtime event bootstrap、`prompt / mcp / agent` hook executor、skill/agent frontmatter hooks、plugin hooks/hot reload、`SkillExecutionMode::Agent` 仍缺席
  - `compat / deprecated / dead`：无新增；本轮没有把 hooks 回流到底层 `SessionManager`，也没有为了凑齐 event 枚举去伪造 `clear` 生命周期
- 已执行校验：
  - `rustfmt --edition 2021 "src-tauri/src/commands/aster_agent_cmd/runtime_project_hooks.rs" "src-tauri/src/commands/aster_agent_cmd/runtime_turn.rs"` 通过
  - `env CARGO_TARGET_DIR="/Users/coso/Documents/dev/ai/aiclientproxy/lime/.codex-target" cargo test --manifest-path "src-tauri/Cargo.toml" run_runtime_session_start_project_hooks_for_session_should_ --lib` 通过（`2 passed`）
  - `env CARGO_TARGET_DIR="/Users/coso/Documents/dev/ai/aiclientproxy/lime/.codex-target" cargo test --manifest-path "src-tauri/Cargo.toml" create_runtime_session_internal_should_run_project_session_start_hooks --lib` 通过（`1 passed`）
- 这一步服务路线图主目标的关系是：把参考运行时图里 `SessionStart(compact)` 这条 extension 主链真正补进 Lime 的宿主 `current`，不再停留在“新建 session 会走 hooks，但 compact 后的新上下文不会重新经过 project hooks”的半成品状态。
- 下一刀应继续回到同一条主链：
  - 优先判断 Lime 当前是否存在可被接受为 `SessionStart(resume)` 的真实 session 恢复入口；若没有，就不要硬映射
  - 或者开始把 `Prompt hook` 从占位 executor 推进成真实执行，但不建议与 `resume` 语义判定并行铺开

### 继续推进（CCD-008 / Prompt hook current）

- 这一轮继续沿 `hooks / skills` 主链往前推，但没有把 `agent_runtime_resume_thread` 硬映射成 `SessionStart(resume)`：
  - 重新核对 [command_api/runtime_api.rs](../../src-tauri/src/commands/aster_agent_cmd/command_api/runtime_api.rs) 后，确认 Lime 当前公开的是“恢复排队线程执行”，不是 Claude Code 那种明确的 session lifecycle resume；因此 `SessionStart(resume)` 继续保留为 `current gap`，不做假对齐。
  - [executor.rs](../../src-tauri/crates/aster-rust/crates/aster/src/hooks/executor.rs) 的 `Prompt hook` 已从 `warn! + success(None)` 占位实现推进成真实执行：
    - 新增 prompt 参数注入与 JSON 结果解析 helper，支持 `$ARGUMENTS` 替换；未显式使用占位符时会把 hook input JSON 追加到 prompt 尾部。
    - 新增按 `session_id -> query_session(...)` 解析当前 session `provider_name / model_config` 的 provider 选择逻辑；有 session 上下文时优先复用当前 session provider，没有 session 时才回退 `ASTER_PROVIDER / ASTER_MODEL`。
    - 新增最小 `output_schema` turn context，把 hook 输出约束到 `{"ok":true}` / `{"ok":false,"reason":"..."}` 两种 JSON 形态；解析失败会返回显式 failure，`ok=false` 时会产出真实的 blocked 结果。
- 这一步后的分类继续收紧为：
  - `current`：`TaskCreated / TaskCompleted` hooks、project-level `UserPromptSubmit` hooks、project-level `SessionStart(startup / compact)` hooks、`command / url / prompt` hook executor、`SkillTool` prompt/workflow execution
  - `current gap`：`SessionStart(resume)` 是否存在真实入口仍待确认；`MCP hook / Agent hook` 仍是占位实现；skill/agent frontmatter hooks、plugin hooks/hot reload、`SkillExecutionMode::Agent` 仍缺席
  - `compat / deprecated / dead`：无新增；本轮没有为了凑齐 prompt hook 去引入第二套 provider 选择壳，也没有把 queue resume 伪装成 session lifecycle
- 已执行校验：
  - `rustfmt --edition 2021 "src-tauri/crates/aster-rust/crates/aster/src/hooks/executor.rs"` 通过
  - `env CARGO_TARGET_DIR="/Users/coso/Documents/dev/ai/aiclientproxy/lime/.codex-target" cargo test --manifest-path "src-tauri/crates/aster-rust/crates/aster/Cargo.toml" execute_prompt_hook_with_provider_should_ --lib --no-default-features` 通过（`2 passed`）
  - `env CARGO_TARGET_DIR="/Users/coso/Documents/dev/ai/aiclientproxy/lime/.codex-target" cargo test --manifest-path "src-tauri/crates/aster-rust/crates/aster/Cargo.toml" replace_prompt_hook_arguments_should_append_json_when_no_placeholder --lib --no-default-features` 通过（`1 passed`）
  - `env CARGO_TARGET_DIR="/Users/coso/Documents/dev/ai/aiclientproxy/lime/.codex-target" cargo test --manifest-path "src-tauri/crates/aster-rust/crates/aster/Cargo.toml" parse_prompt_hook_response_should_accept_fenced_json --lib --no-default-features` 通过（`1 passed`）
  - `env CARGO_TARGET_DIR="/Users/coso/Documents/dev/ai/aiclientproxy/lime/.codex-target" cargo test --manifest-path "src-tauri/crates/aster-rust/crates/aster/Cargo.toml" test_run_user_prompt_submit_hooks_with_registry_blocks_project_hook --lib --no-default-features` 通过（`1 passed`）
- 这一步服务路线图主目标的关系是：把参考运行时图里 `Prompt hook` 这条扩展执行链从“类型存在、执行器空壳”推进到 Lime 的 current，不再停留在“只有 command/url hook 能真正做判断，prompt hook 永远只是占位”的半成品状态。
- 下一刀应继续回到同一条主链：
  - 优先判断 `Agent hook` 能否沿同样的 provider / JSON decision 边界推进成最小 current
  - 或继续核定 `SessionStart(resume)` 是否有真实宿主入口；若没有，就明确保留为 gap，不再反复犹豫

## 2026-04-16

### 已完成

- 在 [auto_memory_service.rs](../../src-tauri/src/services/auto_memory_service.rs) 把 `memdir` 从“无限追加日志”收成“有界目录”：
  - `feedback / project / user / reference` 的 typed topic note 现在按“同 topic 一条当前记忆”覆盖更新，不再持续追加时间戳段落
  - 新增 `cleanup_memdir(...)`，统一负责去重入口链接、裁剪 README 历史段落，并把旧 topic 日志收口为当前有效版本
  - `MEMORY.md` 入口的时间戳 note 现在会在写入时自动去重并保留有界窗口，避免入口长期劣化成无上限流水账
- 在 [memory_management_cmd.rs](../../src-tauri/src/commands/memory_management_cmd.rs)、[memory_runtime.rs](../../src-tauri/src/dev_bridge/dispatcher/memory_runtime.rs)、[runner.rs](../../src-tauri/src/app/runner.rs)、[memoryRuntime.ts](../../src/lib/api/memoryRuntime.ts)、[memoryRuntimeTypes.ts](../../src/lib/api/memoryRuntimeTypes.ts)、[core.ts](../../src/lib/tauri-mock/core.ts) 与 [mockPriorityCommands.ts](../../src/lib/dev-bridge/mockPriorityCommands.ts) 补齐 `memory_cleanup_memdir` 这条 current control-plane 命令，不再让 memdir 整理只停留在本地脚本或人工编辑
- 在 [memory_source_resolver_service.rs](../../src-tauri/src/services/memory_source_resolver_service.rs) 调整 memdir linked item 的 prompt 预取优先级：具体 topic note 会优先于类型 `README.md`，同层内优先看最近更新时间，减少索引文件长期压过真正当前记忆的噪音
- 在 [index.tsx](../../src/components/settings-v2/general/memory/index.tsx) 补上真实的 `整理 memdir` 入口，并把“同一 topic 会覆盖旧内容”的行为写回设置页说明；MemorySettings 不再只是能写、能初始化，还能直接治理已有脏记忆
- 补回归：
  - [auto_memory_service.rs](../../src-tauri/src/services/auto_memory_service.rs) 新增 typed topic overwrite 与 memdir cleanup 定向测试
  - [memory_source_resolver_service.rs](../../src-tauri/src/services/memory_source_resolver_service.rs) 新增“具体 topic 优先于 README”测试
  - [memoryRuntime.test.ts](../../src/lib/api/memoryRuntime.test.ts) 与 [index.test.tsx](../../src/components/settings-v2/general/memory/index.test.tsx) 新增 `memory_cleanup_memdir / 整理 memdir` 前端链路回归
- 已执行校验：
  - `npx prettier --write "src/lib/api/memoryRuntime.ts" "src/lib/api/memoryRuntimeTypes.ts" "src/lib/api/memoryRuntime.test.ts" "src/lib/tauri-mock/core.ts" "src/lib/dev-bridge/mockPriorityCommands.ts" "src/components/settings-v2/general/memory/index.tsx" "src/components/settings-v2/general/memory/index.test.tsx"` 通过
  - `rustfmt --edition 2021 "src-tauri/src/services/auto_memory_service.rs" "src-tauri/src/services/memory_source_resolver_service.rs" "src-tauri/src/commands/memory_management_cmd.rs" "src-tauri/src/dev_bridge/dispatcher/memory_runtime.rs" "src-tauri/src/app/runner.rs"` 通过
  - `npm exec vitest run "src/lib/api/memoryRuntime.test.ts" "src/components/settings-v2/general/memory/index.test.tsx" "src/lib/dev-bridge/mockPriorityCommands.test.ts"` 通过（`18 passed`）

- 在 [verify-gui-smoke.mjs](../../scripts/verify-gui-smoke.mjs) 收紧 `waitForBridgeHealth` 的启动判定：不再把 `tauri dev` 父进程退出直接等同为失败，而是继续观察 GUI smoke 进程组是否仍有活跃 `cargo/rustc/tauri` 链路；同时把“编译结束后的 boot grace”放宽到“父进程仍活着或进程组仍活着”两种场景，避免冷启动时因为父进程提前退场而误判 `headless Tauri 在 DevBridge 就绪前提前退出`
- 已重新执行 `npm run verify:gui-smoke -- --timeout-ms 1200000 --cargo-target-dir "/tmp/lime-gui-smoke-target-debug-parent-exit"` 并通过：`workspace-ready`、`browser-runtime`、`site-adapters`、`agent-service-skill-entry`、`agent-runtime-tool-surface`、`agent-runtime-tool-surface-page` 全链路冒烟通过，GUI smoke 主路径重新恢复到 Lime 可交付门槛
- 已再次核对 smoke Chrome profile 清理收口：GUI smoke 收尾后 `find "$HOME/Library/Application Support/lime/chrome_profiles" -maxdepth 1 -type d \( -name 'smoke-browser-runtime*' -o -name 'smoke-agent-runtime-tool-surface-page*' \) | sort` 结果为空；本轮预清理日志显示共回收 `78` 个历史 profile、结束 `264` 个残留进程，收尾阶段再清掉本轮新增的 `5` 个 profile 与 `2` 个残留进程
- 在 [webview_cmd.rs](../../src-tauri/src/commands/webview_cmd.rs)、[runner.rs](../../src-tauri/src/app/runner.rs)、[bridge.rs](../../src-tauri/src/dev_bridge/dispatcher/browser/bridge.rs) 与 [core.ts](../../src/lib/tauri-mock/core.ts) 补上 `cleanup_gui_smoke_chrome_profiles` 这条 DevBridge current 清理命令：它只识别 `smoke-browser-runtime*` 与 `smoke-agent-runtime-tool-surface-page*` 两类 GUI smoke 专用 Chrome profile，统一收口“关闭受管 session / 关闭 runtime session / 杀掉孤儿 Chrome 进程 / 清 singleton 锁 / 删除 profile 目录”，不再把历史遗留清理逻辑散落在脚本层自己拼 `ps/find/rm`
- 在 [verify-gui-smoke.mjs](../../scripts/verify-gui-smoke.mjs) 接上新的清理主链：health URL 现在会自动推导 `invoke` 地址，bridge 就绪后会先做一次历史 `smoke-*` Chrome profile 预清理，所有 smoke 结束后再做一次收尾清理，失败场景也会走兜底清理日志；后续 GUI smoke 不再只解决“本轮别再新增泄漏”，而是开始回收旧 profile 垃圾
- 在 [webview_cmd.rs](../../src-tauri/src/commands/webview_cmd.rs) 补定向回归：新增 `is_gui_smoke_chrome_profile_key_should_only_match_expected_prefixes` 与 `cleanup_gui_smoke_chrome_profiles_should_remove_only_smoke_dirs`，锁定只清 GUI smoke profile、不误删普通浏览器资料的边界
- 已执行校验：
  - `node --check "scripts/verify-gui-smoke.mjs"` 通过
  - `env CARGO_TARGET_DIR="/tmp/lime-target-gui-smoke-cleanup" cargo test --manifest-path "src-tauri/Cargo.toml" cleanup_gui_smoke_chrome_profiles_should_remove_only_smoke_dirs --lib -- --nocapture` 通过（`1 passed`）
  - `npm run test:contracts` 通过
  - `npm run verify:gui-smoke -- --timeout-ms 1200000 --cargo-target-dir "/tmp/lime-gui-smoke-target-debug-parent-exit"` 通过

### 当前观察

- `verify:gui-smoke` 这条质量门槛本轮已经恢复为绿色，不再阻塞 `memdir` / memory 主线继续推进
- 本次长冷启动通过时，现场另一个本地 `lime` 进程最终占住了 `127.0.0.1:3030`（当前可见 PID `32676`），因此我这条独立 headless binary 在真正启动后记录了 `Dev Bridge 启动失败: Address already in use (os error 48)`；也就是说，这次通过证明了脚本不会再因为冷启动等待而误判失败，但若后续要证明“本实例独占 3030 也能启动”，仍应在更干净的本地环境或独立端口策略下复验

### 继续推进（file checkpoint UI）

- 在 [AgentThreadFileCheckpointDialog.tsx](../../src/components/agent/chat/components/AgentThreadFileCheckpointDialog.tsx) 新增最小 file checkpoint dialog，直接消费 `agent_runtime_list_file_checkpoints / agent_runtime_get_file_checkpoint / agent_runtime_diff_file_checkpoint` 这条 current 主链；弹窗打开时拉 list，默认选中最近 checkpoint，并在切换条目时并行刷新 detail / diff，不再只停留在可靠性面板上的单条“最近文件快照”摘要
- 在 [AgentThreadReliabilityPanel.tsx](../../src/components/agent/chat/components/AgentThreadReliabilityPanel.tsx) 给“最近文件快照”卡片补上 `查看快照详情` 入口，并把弹窗状态维持在面板当前上下文内：只有存在 `diagnosticRuntimeContext.sessionId` 时才暴露入口，继续沿当前 thread/session 真相消费，不额外长第二套文件持久化读模型
- 在 [AgentThreadReliabilityPanel.test.tsx](../../src/components/agent/chat/components/AgentThreadReliabilityPanel.test.tsx) 补上 file checkpoint 交互回归，覆盖入口出现、打开弹窗后拉 list、默认选中最近 checkpoint 拉 detail/diff，以及切换到旧版本 checkpoint 后重新刷新 detail/diff 与关键字段渲染
- 在 [agent_sessions.rs](../../src-tauri/src/dev_bridge/dispatcher/agent_sessions.rs) 把 `agent_runtime_list_file_checkpoints / agent_runtime_get_file_checkpoint / agent_runtime_diff_file_checkpoint` 接回 browser DevBridge current 分发，不再让真实 GUI 在弹窗打开后掉回 `[DevBridge] 未知命令`
- 在 [dispatcher.rs](../../src-tauri/src/dev_bridge/dispatcher.rs) 补上 `agent_runtime_file_checkpoint_commands_are_bridged` 定向回归，锁定这 3 个命令至少已经进入 `agent_sessions` bridge 分支；即使测试态没有 `AppHandle`，也应报 `Dev Bridge 未持有 AppHandle`，而不是回退成 unknown command
- 为恢复本地真实 GUI 续测，又顺手收掉了当前工作区里会卡死 `tauri:dev:headless` 的一组 Rust 编译半状态：当前确认需要把 [api_key_provider_service.rs](../../src-tauri/crates/services/src/api_key_provider_service.rs) 中 `test_codex_responses_endpoint(...)` 的签名与 3 处调用点对齐到同一套 5 参链路，避免 `provider_type` 在调用侧 / 定义侧来回失配把整条 DevBridge 启动链卡死
- 已用真实 GUI 复测打通 file checkpoint 弹窗主链：本地 `npm run tauri:dev:headless` 已成功启动 `target/debug/lime`，`npm run bridge:health -- --timeout-ms 30000` 返回 `status=ok`；随后在历史会话 `Hello greeting`（`session=6e7f8e4b-129a-4f78-9ad0-41d8a7a801ec`）里进入 `任务中心 -> 切换历史 -> Hello greeting -> 展开工作台 -> 线程可靠性 -> 查看快照详情`，弹窗已真实显示 `共 1 个` checkpoint、默认选中 `v1`、标题 `你好！👋`、状态 `draft`、`live_path / snapshot_path / currentVersionId` 以及完整 `ArtifactDocument` JSON，说明 browser DevBridge 已经从“unknown command”前进到真实 `list / detail / diff` 数据面
- 已执行校验：
  - `npx vitest run "src/components/agent/chat/components/AgentThreadReliabilityPanel.test.tsx"` 通过（`15 passed`）
  - `npm run test:contracts` 通过
  - `npm run typecheck` 通过
  - `npm run tauri:dev:headless` 通过增量重编成功启动 `target/debug/lime`
  - `npm run bridge:health -- --timeout-ms 30000` 通过（`status=ok`）
  - `npm run verify:local` 已尝试执行，但当前仓库存在 `291` 个脏改，smart 模式被放大为全仓 workflow；本轮仅确认其已通过 `verify:app-version / lint / typecheck` 并进入 `vitest-smart` 多批次执行，随后为避免被无关改动长期占用而手动停止
  - `npm run verify:gui-smoke` 的这轮旧阻塞已在本节上方收口；当前 file checkpoint 弹窗链路也已补到真实 GUI 证据，不过现场仍可见与本轮主线无关的 browser DevBridge 缺口：`sceneapp_list_catalog`、`gateway_channel_status` 仍报 unknown command；其中历史会话里 `agent_runtime_update_session` 的 `full-access` / `full_access` 枚举别名 warning 已开始在 current DTO/agent runtime 边界收口，尚未单独做一次真实 GUI 复测

### 继续推进（recent_access_mode alias cleanup）

- 在 [session_execution_runtime.rs](../../src-tauri/crates/agent/src/session_execution_runtime.rs) 把 `SessionExecutionRuntimeAccessMode` 的 serde 口径从只认 `snake_case` 收口为 `kebab-case` current 真相，并为历史 `read_only / full_access` 增加兼容 alias；后续 `recent_access_mode` 的序列化结果会稳定回到前端与运行时元数据已经在使用的 `read-only / current / full-access`
- 在 [tests.rs](../../src-tauri/src/commands/aster_agent_cmd/tests.rs) 补上 `agent_runtime_update_session` 的 `recentAccessMode` 反序列化回归，锁定 browser DevBridge / GUI 历史会话当前实际发送的 `full-access` 不会再因为 Rust DTO 只认 `full_access` 而掉 warning
- 已执行校验：
  - `rustfmt --edition 2021 "src-tauri/crates/agent/src/session_execution_runtime.rs" "src-tauri/src/commands/aster_agent_cmd/tests.rs"` 通过
  - `npx vitest run "src/components/agent/chat/components/AgentThreadReliabilityPanel.test.tsx"` 通过（复跑，`15 passed`）
  - `src-tauri/target/debug/deps/lime_lib-f738bc5b97ece89b --exact commands::aster_agent_cmd::tests::test_agent_runtime_update_session_request_deserializes_recent_access_mode_aliases --nocapture` 通过（`1 passed`）
  - 已做真实 GUI 续测：`npm run bridge:health -- --timeout-ms 15000` 返回 `status=ok` 后，复用 `http://127.0.0.1:1420/` 现有页签重载首页，再沿 `任务中心 -> 切换历史 -> Hello greeting -> 展开工作台 -> 查看快照详情` 复走 file checkpoint 弹窗链路；控制台只剩既有的 `gateway_channel_status` / `sceneapp_list_catalog` unknown command 与 `i18n` warning，未再出现 `agent_runtime_update_session` 或 `full-access / full_access` 相关 warning
  - `SessionExecutionRuntimeAccessMode` 自身的 agent crate 单测已补代码，但本地存在其他长期 `cargo run` 进程占用默认 Cargo cache；尝试绕开锁时会退化成重新下载整套 crates，因此本轮未继续等待 agent crate 独立测试跑完

## 2026-04-15

### 已完成

- 在 [runtime_file_checkpoint_service.rs](../../src-tauri/src/services/runtime_file_checkpoint_service.rs)、[dto.rs](../../src-tauri/src/commands/aster_agent_cmd/dto.rs) 与 [runtime_api.rs](../../src-tauri/src/commands/aster_agent_cmd/command_api/runtime_api.rs) 补上 runtime file checkpoint current 主链：继续以 `SessionDetail.items -> FileArtifact -> artifact_document_service sidecar` 为唯一事实源，新增 `thread_read.file_checkpoint_summary` 轻摘要，以及 `agent_runtime_list_file_checkpoints / agent_runtime_get_file_checkpoint / agent_runtime_diff_file_checkpoint` 三个 current 命令，不再引入第二套 transcript 文件真相
- 在 [runtime_evidence_pack_service.rs](../../src-tauri/src/services/runtime_evidence_pack_service.rs) 与 [runtime_replay_case_service.rs](../../src-tauri/src/services/runtime_replay_case_service.rs) 把 `fileCheckpoints / fileCheckpointCount` 正式接入 evidence / replay sidecar，analysis / review / replay 后续统一复用同一份 checkpoint 读模型，不再各自重新扫描 artifact 状态
- 在 [types.ts](../../src/lib/api/agentRuntime/types.ts)、[threadClient.ts](../../src/lib/api/agentRuntime/threadClient.ts)、[agentRuntimeCommandSchema.json](../../src/lib/governance/agentRuntimeCommandSchema.json)、[agentCommandCatalog.json](../../src/lib/governance/agentCommandCatalog.json)、[mockPriorityCommands.ts](../../src/lib/dev-bridge/mockPriorityCommands.ts) 与 [core.ts](../../src/lib/tauri-mock/core.ts) 同步命令边界五侧，生成清单 [commandManifest.generated.ts](../../src/lib/api/agentRuntime/commandManifest.generated.ts) 也已刷新，新的 file checkpoint 命令继续落在 `agent_runtime_*` current gateway，而不是 compat/legacy 旁路
- 在 [AgentThreadReliabilityPanel.tsx](../../src/components/agent/chat/components/AgentThreadReliabilityPanel.tsx) 新增“最近文件快照”摘要块，并在 [AgentThreadReliabilityPanel.test.tsx](../../src/components/agent/chat/components/AgentThreadReliabilityPanel.test.tsx) 补稳定断言；同时建立持久化 current 文档 [persistence-map.md](../aiprompts/persistence-map.md)，并回挂到 [docs/README.md](../README.md)、[docs/aiprompts/README.md](../aiprompts/README.md) 与 [AGENTS.md](../../AGENTS.md)
- 在 [runtime_evidence_pack_service.rs](../../src-tauri/src/services/runtime_evidence_pack_service.rs) 与 [runtime_replay_case_service.rs](../../src-tauri/src/services/runtime_replay_case_service.rs) 的现有测试里补上 `fileCheckpointCount / fileCheckpoints / checkpoint_id / path` 断言，确保 evidence / replay 已真实消费新的 checkpoint 读模型，而不是只在实现侧悄悄接线
- 已执行校验：
  - `node scripts/generate-agent-runtime-clients.mjs` 通过
  - `npx vitest run "src/components/agent/chat/components/AgentThreadReliabilityPanel.test.tsx" "src/lib/dev-bridge/mockPriorityCommands.test.ts"` 通过（`17 passed`）
  - `npm run test:contracts` 通过
  - `npm run typecheck` 通过
  - `npx vitest run "src/components/provider-pool/api-key/ProviderConfigForm.ui.test.tsx" "src/components/settings-v2/general/memory/index.test.tsx"` 通过（`19 passed`）
  - `env CARGO_TARGET_DIR="/Users/coso/Documents/dev/ai/aiclientproxy/lime/.codex-target" cargo check --manifest-path "src-tauri/Cargo.toml" --lib` 通过
  - `env CARGO_TARGET_DIR="/Users/coso/Documents/dev/ai/aiclientproxy/lime/.codex-target" cargo test --manifest-path "src-tauri/Cargo.toml" runtime_file_checkpoint_service::tests:: --lib -- --nocapture` 通过（`3 passed`）
  - `env CARGO_TARGET_DIR="/Users/coso/Documents/dev/ai/aiclientproxy/lime/.codex-target" cargo test --manifest-path "src-tauri/Cargo.toml" should_export_runtime_ --lib -- --nocapture` 通过（`6 passed`）
  - `npm run verify:gui-smoke` 通过（复用现有 headless 环境，`workspace-ready / browser-runtime / site-adapters / agent-service-skill-entry / agent-runtime-tool-surface / agent-runtime-tool-surface-page` 全部通过）
  - `npm run verify:local` 通过
- 当前更高层验证状态：
  - 之前记录里的 `should_export_runtime_` / `SceneAppRunSummary` 阻塞已不再复现；当前仓库中的 `sceneapp` 初始化点已补齐新字段，本轮实际阻塞改为 [claude_custom.rs](../../src-tauri/crates/providers/src/providers/claude_custom.rs) 的 `Default` 实现缺口，现已修复并复测通过
  - 之前记录里的 `verify:local` TypeScript 阻塞也已修复；[ProviderConfigForm.ui.test.tsx](../../src/components/provider-pool/api-key/ProviderConfigForm.ui.test.tsx) 与 [index.tsx](../../src/components/settings-v2/general/memory/index.tsx) 的类型问题不再复现，本轮已重新从统一入口跑通 `npm run verify:local`

- 在 [auto_memory_service.rs](../../src-tauri/src/services/auto_memory_service.rs) 将自动记忆入口收口为 `memdir` 主链：新增 `user / feedback / project / reference` 四类目录脚手架、最小 provider seam、topic 文件递归索引与 `memory_type / provider / updated_at` 元数据；`feedback / project` 写入现在强制要求 `Why:` 与 `How to apply:` 结构，`project` 同时拒绝 `今天 / tomorrow / next week` 这类相对时间词，避免记忆过期后继续误导执行
- 在 [memory_source_resolver_service.rs](../../src-tauri/src/services/memory_source_resolver_service.rs) 为来源链读模型补齐 `source_bucket / provider / memory_type / updated_at`，并让 `auto_memory_item` 真正进入 runtime 解析与 prompt 来源链；同时把 `memory_type` 约束到 memdir 来源，不再误打到普通项目规则或其它非 memdir 文件
- 在 [memoryRuntimeTypes.ts](../../src/lib/api/memoryRuntimeTypes.ts)、[index.tsx](../../src/components/settings-v2/general/memory/index.tsx) 与 [MemoryPage.tsx](../../src/components/memory/MemoryPage.tsx) 同步前端主链：设置页可以直接初始化 `memdir`、按类型写入真实 note，并在前端先做结构化/绝对日期拦截；Memory 页面与设置页当前都按 `memdir` 分类、provider、最近更新时间展示真实来源，不再沿用旧的外部工具记忆心智文案
- 将这轮 `memdir` 约束与元数据回写到 [memory-compaction.md](../aiprompts/memory-compaction.md)，明确 `MEMORY.md -> user|feedback|project|reference` 是 current 组织方式，topic 文件必须继续挂在同一条索引主链下
- 在 [browser-runtime-smoke.mjs](../../scripts/browser-runtime-smoke.mjs) 与 [agent-runtime-tool-surface-page-smoke.mjs](../../scripts/agent-runtime-tool-surface-page-smoke.mjs) 补上固定 smoke profile key 与 `close_chrome_profile_session` 前后清理，避免每次 GUI smoke 都遗留新的 headless Chrome profile 进程，连带拖慢后续 `browser_execute_action` 页面 smoke
- 已执行校验：
  - `npm exec vitest run "src/lib/api/memoryRuntime.test.ts" "src/components/settings-v2/general/memory/index.test.tsx" "src/components/memory/MemoryPage.test.tsx"` 通过（`26 passed`）
  - `npm run test:contracts` 通过
  - `npm run verify:gui-smoke -- --cargo-target-dir "/tmp/lime-gui-smoke-target-memdir-codex"` 通过（`workspace-ready / browser-runtime / site-adapters / agent-service-skill-entry / agent-runtime-tool-surface / agent-runtime-tool-surface-page` 全部通过）

- 在 [tests.rs](../../src-tauri/src/commands/aster_agent_cmd/tests.rs) 新增基础 Prompt 主链源码守卫，固定 `runtime_turn` 的 current 组装顺序：入口段必须保持 `RuntimeAgents -> ExplicitLocalPathFocus -> FullRuntime/FastChat 分流`，`build_full_runtime_system_prompt(...)` 必须保持 `Memory -> ... -> AutoContinue` 的既定 augmentation 顺序，`ServiceSkillLaunchPreload` 只能在 FullRuntime 下作为尾部追加阶段
- 同步把 `service_skill_launch_preload` 相关重复测试 fixture 收口为共享 helper，减少同一预执行样例在多条测试里重复内联，避免后续调整站点技能预执行 contract 时只改一半测试
- 补最贴边界的定向校验：
  - `env CARGO_TARGET_DIR="/Users/coso/Documents/dev/ai/aiclientproxy/lime/.codex-target" cargo test --manifest-path "src-tauri/Cargo.toml" runtime_turn_source_keeps --lib -- --nocapture` 通过（`3 passed`）
  - `env CARGO_TARGET_DIR="/Users/coso/Documents/dev/ai/aiclientproxy/lime/.codex-target" cargo test --manifest-path "src-tauri/Cargo.toml" service_skill_launch_preload --lib -- --nocapture` 通过（`3 passed`）

### 继续推进（browser DevBridge sceneapp / channels current 收口）

- 在 [sceneapp.rs](../../src-tauri/src/dev_bridge/dispatcher/sceneapp.rs)、[channels.rs](../../src-tauri/src/dev_bridge/dispatcher/channels.rs) 与 [dispatcher.rs](../../src-tauri/src/dev_bridge/dispatcher.rs) 把 `sceneapp_list_catalog`、`gateway_channel_status`、`wechat_channel_list_accounts` 继续接回 browser DevBridge current 分发；[dispatcher.rs](../../src-tauri/src/dev_bridge/dispatcher.rs) 也新增 `sceneapp_list_catalog_is_bridged`、`gateway_channel_status_is_bridged`、`wechat_channel_list_accounts_is_bridged` 定向守卫，锁定这些命令已进入对应 bridge 分支，不再回退成 `[DevBridge] 未知命令`
- 在 [agentCommandCatalog.json](../../src/lib/governance/agentCommandCatalog.json)、[mockPriorityCommands.ts](../../src/lib/dev-bridge/mockPriorityCommands.ts)、[mockPriorityCommands.test.ts](../../src/lib/dev-bridge/mockPriorityCommands.test.ts) 与 [core.ts](../../src/lib/tauri-mock/core.ts) 同步命令边界四侧：
  - `gateway_channel_status` 与 `wechat_channel_list_accounts` 现在都被视为 browser 模式下必须走 bridge 真相的 current runtime gateway 命令
  - `wechat_channel_list_accounts` 同步补进默认 mock，避免非 browser 模式的开发回路缺少返回形态
- 在 [wechat_channel_cmd.rs](../../src-tauri/src/commands/wechat_channel_cmd.rs) 抽出纯 helper `list_wechat_configured_accounts(...)`，让 Tauri 命令与 browser DevBridge 共享同一段“列微信账号”逻辑；不再把 `tauri::State` 包装态直接透传进 bridge 分支，避免 bridge 场景里额外引入命令包装态阻塞
- 已执行校验：
  - `npm test -- src/lib/dev-bridge/mockPriorityCommands.test.ts` 通过（`3 passed`）
  - `npm run test:bridge` 通过（`22 passed`）
  - `npm run test:contracts` 通过
  - `env CARGO_TARGET_DIR="/tmp/lime-devbridge-current-tests" cargo test --manifest-path "src-tauri/Cargo.toml" sceneapp_list_catalog_is_bridged --lib -- --nocapture` 通过（`1 passed`）
  - `env CARGO_TARGET_DIR="/tmp/lime-devbridge-current-tests" cargo test --manifest-path "src-tauri/Cargo.toml" gateway_channel_status_is_bridged --lib -- --nocapture` 通过（`1 passed`）
  - `env CARGO_TARGET_DIR="/tmp/lime-devbridge-current-tests" cargo test --manifest-path "src-tauri/Cargo.toml" wechat_channel_list_accounts_is_bridged --lib -- --nocapture` 通过（`1 passed`）
- 已补现场证据：
  - 活跃在 `127.0.0.1:3030` 的旧 bridge 一度是 Codex 自己遗留的 [lime](/Users/coso/Documents/dev/ai/aiclientproxy/lime/src-tauri/target/debug/lime) 实例；该旧进程对 `sceneapp_list_catalog`、`gateway_channel_status` 的 `curl /invoke` 已能返回 `200`，但 `wechat_channel_list_accounts` 仍返回 `[DevBridge] 未知命令`，说明真实 GUI 当时看到的是“上一刀已生效、这一刀尚未热更新”的混合现场
  - 在清掉这条 Codex 遗留 bridge 后，`127.0.0.1:3030` 一度空闲，随后又被另一条 Codex 派生的 [lime](/Users/coso/Documents/dev/ai/aiclientproxy/lime/src-tauri/target/debug/lime) 实例接管；`/health` 与 `gateway_channel_status` 已恢复 `200`
  - 当前活跃 bridge 上，`curl /invoke` 已能真实返回 `wechat_channel_list_accounts` 的账号目录，例如 `774304b339c6@im.bot` 这条已启用账号会返回 `baseUrl=https://ilinkai.weixin.qq.com`、`cdnBaseUrl=https://novac2c.cdn.weixin.qq.com/c2c`、`hasToken=true` 与 `scannerUserId`
  - 真实 GUI 续测到的错误类型已经从 `[DevBridge] 未知命令` 前移为 bridge 级超时：在 `消息渠道 -> 高级排障 -> 微信` 页，控制台已出现 `wechat_channel_list_accounts` / `gateway_channel_status` 的调用与 `timeout after 1800ms`，不再是 `unknown command`
- 在 [http-client.ts](../../src/lib/dev-bridge/http-client.ts) 收紧 browser DevBridge HTTP client 的时序策略：
  - `sceneapp_list_catalog`、`gateway_channel_status`、`wechat_channel_list_accounts` 等“必须以 bridge 为真相”的命令现在统一使用 `5000ms` 请求超时，不再沿用默认 `1800ms`
  - `fetch_provider_models_auto`、`test_api_key_provider_connection`、`test_api_key_provider_chat` 三条 provider 探测命令继续使用 `30000ms` 长超时，避免模型目录探测在浏览器模式下过早被前端判死
  - `ensureBridgeReachable()` 对“首个 health probe timeout”不再直接写入 cooldown；只有硬连接失败才进入 `bridge cooldown active`，避免首页第一次慢探测把后续数秒都拖进假性不可用
- 在 [http-client.test.ts](../../src/lib/dev-bridge/http-client.test.ts) 补齐回归护栏：
  - 区分“硬连接失败会进入 cooldown”和“timeout 只会触发重试，不会立刻 cooldown”
  - 锁定 bridge 真相命令的 `5000ms` 超时窗口与 provider 探测命令的 `30000ms` 超时窗口
  - 锁定事件流监听只会在硬连接失败后的短退避窗口里阻止新 `EventSource` 建连
- 本轮追加校验：
  - `npm test -- src/lib/dev-bridge/http-client.test.ts` 通过（`10 passed`）
  - `npm test -- src/lib/dev-bridge/mockPriorityCommands.test.ts` 通过（`3 passed`）
  - `npm run test:bridge` 通过（`22 passed`）
  - `npm run test:contracts` 通过
- 本轮追加 live 证据：
  - `curl -sS -m 5 "http://127.0.0.1:3030/health"` 返回 `{"service":"DevBridge","status":"ok","version":"1.0.0"}`
  - `curl -sS -m 10 -X POST "http://127.0.0.1:3030/invoke" -d '{"cmd":"sceneapp_list_catalog"}'` 返回 scene app catalog
  - `curl -sS -m 10 -X POST "http://127.0.0.1:3030/invoke" -d '{"cmd":"gateway_channel_status","args":{"request":{"channel":"wechat"}}}'` 返回 `{"channel":"wechat","status":{"accounts":[],"runningAccounts":0}}`
  - `curl -sS -m 10 -X POST "http://127.0.0.1:3030/invoke" -d '{"cmd":"wechat_channel_list_accounts"}'` 返回真实微信账号目录，当前可见 `774304b339c6@im.bot`

### 当前观察

- `sceneapp_list_catalog`、`gateway_channel_status`、`wechat_channel_list_accounts` 三条 current bridge 命令现在都已经具备代码、契约、Rust 定向测试与 live `/invoke` 证据；消息渠道页的真实 blocker 已经从 `unknown command` 前移到 bridge 性能/时序层，而不再是命令缺口
- 由于现场存在多条长期 `tauri dev` / `lime` 进程，本轮继续保留“用隔离 `CARGO_TARGET_DIR` 串行验证 bridge 改动”的做法，避免再次和默认 Cargo target 抢锁；后续若继续做消息渠道页的 GUI 续测，应优先复用当前已经接管 `3030` 的新版 bridge，而不是再让 Codex 遗留实例占住端口
- 本轮尝试继续做 GUI 复测时，`Playwright MCP` 仍直接报 `Target page/context/browser has been closed`，`chrome_devtools` 也出现 page/transport 提前断开；因此当前已经拿到“bridge live 可用 + 前端定向状态机回归通过”的证据，但“消息渠道页控制台里 `1800ms timeout` 是否已显著减少”还需要在更稳定的 MCP 浏览器会话下补一次真实 GUI 复测

## 2026-04-14

### 已完成

- 建立基础 Prompt current 文档 [prompt-foundation.md](../aiprompts/prompt-foundation.md)，把 `runtime_turn -> prompt_context / prompt services -> TurnInputEnvelope -> aster PromptManager / embedded prompts` 固定为唯一基础 Prompt 事实源；同时明确 `query-loop.md` 负责提交主循环、本文负责 Prompt 主链，功能样板与历史工作台文档不再反向定义 system prompt 顺序
- 将 [content-creator.md](../aiprompts/content-creator.md) 明确回挂到 [prompt-foundation.md](../aiprompts/prompt-foundation.md)，把“首条消息注入 systemPrompt”的旧工作台叙事降回归档背景说明，不再误导成当前基础 Prompt 入口
- 将 [docs/aiprompts/README.md](../aiprompts/README.md) 与 [docs/README.md](../README.md) 同步回挂到 [prompt-foundation.md](../aiprompts/prompt-foundation.md)，后续改 `system prompt / subagent prompt / plan prompt / prompt_context / augmentation` 时有单一入口
- 补文档新鲜度校验：`npm run harness:doc-freshness` 已通过（`doc freshness: clean`），确认新增的基础 Prompt 文档、入口回挂与路径引用没有漂移
- 在 [MessageList.tsx](../../src/components/agent/chat/components/MessageList.tsx) 将运行状态线从输入区底栏迁到最后一条 assistant 消息尾部，统一承载 `处理中 / 已完成`、耗时、工具批次、输入输出 token 与 Prompt Cache 摘要，不再让状态提示霸占输入区主视觉；本轮继续补齐“完成态保留最后一批工具统计”，真实 GUI 已确认可见 `已完成 · 00:20 · 工具 读 2 / 列 2 · 输入 11.4K / 输出 309`
- 在 [MessageList.test.tsx](../../src/components/agent/chat/components/MessageList.test.tsx) 补上“复杂任务完成后状态线应跟随最后一条 assistant 消息尾部”的稳定断言，并通过真实 GUI 复测确认运行态 footer 位于消息流内、显著高于输入框，不再回落到底部输入栏
- 建立总计划 [upstream-runtime-alignment-plan.md](./upstream-runtime-alignment-plan.md)，固定六条主链作为唯一排期事实源
- 建立 Query Loop current 文档 [query-loop.md](../aiprompts/query-loop.md)，把提交入口、turn 组包、queue、tool runtime、流式执行、压缩与 evidence 消费收口成单一主链
- 在 [turn_input_envelope.rs](../../src-tauri/crates/agent/src/turn_input_envelope.rs) 与 [runtime_turn.rs](../../src-tauri/src/commands/aster_agent_cmd/runtime_turn.rs) 收口一条 Query Loop current 旁路：`TurnInputEnvelope` 现会记录最终 turn output schema 与 workspace-derived turn context metadata，`SessionConfig` 改为直接消费 envelope 提前固化的 turn context，不再在执行前再次拼装 `artifact output schema / auto_compact` 这一层真实输入
- 在 [action_runtime.rs](../../src-tauri/src/commands/aster_agent_cmd/action_runtime.rs) 继续收口 Query Loop 辅助恢复链：`agent_runtime_respond_action` 的 elicitation / ask 恢复路径现复用 `runtime_turn` 的 turn context snapshot helper，不再只单独注入 `auto_compact`，artifact output schema 与 request metadata 也会走同一条 current turn context 边界
- 在 [runtime_turn.rs](../../src-tauri/src/commands/aster_agent_cmd/runtime_turn.rs) 把 `compact_session` 控制回合的最小 `SessionConfig` 边界编码为专用 helper，并补测试守卫：压缩控制回合只保留 `thread_id / turn_id`，真正的 conversation 替换与 summary cache 更新仍复用共享 `perform_context_compaction(...)` core；[memory-compaction.md](../aiprompts/memory-compaction.md) 也已同步修正文档，避免继续误写成 `agent.compact_session()` 旁路
- 在 [aster_agent.rs](../../src-tauri/src/agent/aster_agent.rs)、[persona_cmd.rs](../../src-tauri/src/commands/persona_cmd.rs) 与 [theme_context_cmd.rs](../../src-tauri/src/commands/theme_context_cmd.rs) 完成剩余 `SessionConfigBuilder` 生产落点分类：`generate_persona` 与 `aster_agent_theme_context_search` 现在统一复用“专用一次性会话” helper，显式声明它们不参与 Query Loop 的 submit turn / runtime queue / turn context snapshot 真相；零入口的旧 `AsterAgentWrapper::send_message` 聊天壳已删除，避免继续伪装成 current 主链
- 在 [tests.rs](../../src-tauri/src/commands/aster_agent_cmd/tests.rs) 补上命令层 raw execution 源码扫描守卫：当前只允许 `action_runtime.rs`、`persona_cmd.rs`、`theme_context_cmd.rs` 三处保留原始 `agent.reply(...)` / `stream_reply_with_policy(...)`，一旦 Tauri 命令层再长出第四条未分类旁路，测试会直接失败
- 在 [query-loop.md](../aiprompts/query-loop.md) 与 [src-tauri/src/agent/README.md](../../src-tauri/src/agent/README.md) 回写命令层边界说明：`agent_runtime_respond_action` 明确属于 current 恢复链；`generate_persona` 与 `aster_agent_theme_context_search` 明确属于受控 compat 一次性命令；README 的底层 `agent.reply(...)` 示例也已补充“不要在 Tauri 命令层继续新增 raw 执行旁路”的提醒
- 建立 Task / Agent current 文档 [task-agent-taxonomy.md](../aiprompts/task-agent-taxonomy.md)，把 `agent turn / subagent turn / automation job / scheduler tick / execution run` 收口成单一 taxonomy
- 建立 Remote runtime current 文档 [remote-runtime.md](../aiprompts/remote-runtime.md)，把 `消息渠道 runtime / 浏览器连接器 / ChromeBridge / DevBridge / OpenClaw / telegram_remote` 收口成单一 remote taxonomy
- 建立 Memory / Compaction current 文档 [memory-compaction.md](../aiprompts/memory-compaction.md)，把 `来源链 / working memory / durable memory / Team Memory / 会话压缩 / project memory sidecar` 收口成单一 memory taxonomy
- 将 `ExecutionTracker / subagent runtime / automation service / scheduler trigger` 明确分类为 `current / compat / deprecated / dead`，其中 `SchedulerService` 退回 compat 触发壳，`automation_jobs.payload.browser_session` 明确为 dead
- 将 `gateway_channel_* + browser connector / ChromeBridge` 明确归到 remote current 主链，把 `DevBridge / OpenClaw` 降回 compat、`telegram_remote_cmd` 降回 deprecated
- 将 `memory_runtime_* + unified_memory_* + agent_runtime_compact_session` 明确归到 memory current 主链，把 `project_memory_get` 相关项目资料链降回 compat 附属层、`memory_feedback_cmd` 降回 deprecated、`memory_search_cmd.rs.bak` 标记为 dead
- 将新 taxonomy 入口同步回 [docs/README.md](../README.md)、[docs/aiprompts/README.md](../aiprompts/README.md)、[docs/aiprompts/overview.md](../aiprompts/overview.md) 与 [AGENTS.md](../../AGENTS.md)，仓库导航不再继续把旧 `heartbeat_service` 叙事当成 current
- 将 remote 入口同步回 [docs/README.md](../README.md)、[docs/aiprompts/README.md](../aiprompts/README.md)、[docs/aiprompts/overview.md](../aiprompts/overview.md) 与 [AGENTS.md](../../AGENTS.md)，仓库导航不再继续把 debug 桥或单通道 Telegram 入口误当成 remote 主线
- 将 memory 入口同步回 [docs/README.md](../README.md)、[docs/aiprompts/README.md](../aiprompts/README.md)、[docs/aiprompts/overview.md](../aiprompts/overview.md) 与 [AGENTS.md](../../AGENTS.md)，仓库导航不再继续把项目资料聚合或旧 feedback 侧链误当成记忆 / 压缩主线
- 在 [runtime_turn.rs](../../src-tauri/src/commands/aster_agent_cmd/runtime_turn.rs) 完成第二刀代码收口：把 `run_start_metadata`、`runtime_status_session_config`、`build_session_config` 的重复拼装下沉为 helper，继续缩短 Query Loop 主循环
- 在 [runtime_turn.rs](../../src-tauri/src/commands/aster_agent_cmd/runtime_turn.rs) 完成第三刀代码收口：把流式执行成功后的 Artifact 自动落盘与记忆沉淀收口为统一 helper，消除主成功分支与降级成功分支的重复收尾逻辑
- 在 [runtime_turn.rs](../../src-tauri/src/commands/aster_agent_cmd/runtime_turn.rs) 完成第四刀代码收口：把两处 `stream_reply_once` 的事件记录闭包收口为统一 helper，主分支与降级分支共享同一条事件记录路径
- 在 [runtime_turn.rs](../../src-tauri/src/commands/aster_agent_cmd/runtime_turn.rs) 完成第五刀代码收口：把 `RunFinishDecision` 组装与 terminal result 收尾收口为统一 helper，主循环不再内联 success/error 两套终态处理
- 在 [runtime_turn.rs](../../src-tauri/src/commands/aster_agent_cmd/runtime_turn.rs) 完成第六刀代码收口：把主执行分支与降级到 ReAct 的分支统一为“单次流式尝试” helper，消除 `build_runtime_user_message(...)`、`build_session_config()`、`stream_reply_once(...)` 与成功收尾逻辑的重复展开
- 在 [runtime_turn.rs](../../src-tauri/src/commands/aster_agent_cmd/runtime_turn.rs) 完成第七刀代码收口：把 `CodeOrchestrated` 的扩展启用、失败降级与扩展清理统一为策略 helper，让 `with_run_custom(...)` 内只保留一次 Query Loop 执行入口
- 在 [runtime_turn.rs](../../src-tauri/src/commands/aster_agent_cmd/runtime_turn.rs) 完成第八刀代码收口：把 runtime turn 初始化、status 投射与 service preload 事件收口为统一前奏 helper，主循环的前置准备阶段已压成单一语义块
- 在 [runtime_turn.rs](../../src-tauri/src/commands/aster_agent_cmd/runtime_turn.rs) 完成第九刀代码收口：把 `run_start_metadata`、`timeline_recorder`、`runtime_status_session_config` 与流式 `session_config` 构建状态统一为 execution context，主循环不再散落拼装这组前置状态
- 在 [runtime_turn.rs](../../src-tauri/src/commands/aster_agent_cmd/runtime_turn.rs) 完成第十刀代码收口：把 `run_observation`、`run_finish decision` 与 terminal finalize 链路回收到 execution context，主循环不再手工拼接 tracked execution 与终态收尾
- 在 [runtime_turn.rs](../../src-tauri/src/commands/aster_agent_cmd/runtime_turn.rs) 完成第十一刀代码收口：把 `skill_tool_session_access` 与 `cancel_token` 收口为统一 session scope，异常路径与正常路径共享同一套会话级清理边界
- 在 [runtime_turn.rs](../../src-tauri/src/commands/aster_agent_cmd/runtime_turn.rs) 完成第十二刀代码收口：把 `runtime_snapshot -> runtime_projection_snapshot -> turn_state -> turn_input_envelope` 统一收口为 `build_runtime_turn_artifacts(...)` helper，主循环不再散落读取 snapshot、派生 thread/turn 和构建 turn 输入诊断
- 在 [runtime_turn.rs](../../src-tauri/src/commands/aster_agent_cmd/runtime_turn.rs) 完成第十三刀代码收口：把 `service_skill_preload -> prepared execution -> prelude/execute handoff` 统一收口为 `prepare_runtime_turn_execution(...)` 与 `RuntimeTurnPreparedExecution`，submit 主路径已进一步压成 `prepare -> execute` 两个清晰阶段
- 在 [runtime_turn.rs](../../src-tauri/src/commands/aster_agent_cmd/runtime_turn.rs) 完成第十四刀代码收口：把 `provider_continuation -> workspace sandbox apply -> tracker/session scope bootstrap` 统一收口为 `prepare_runtime_turn_submit_bootstrap(...)`，submit 主路径不再内联铺开这组前置副作用和运行期参数拼装
- 在 [runtime_turn.rs](../../src-tauri/src/commands/aster_agent_cmd/runtime_turn.rs) 完成第十五刀代码收口：把 `request.provider_config -> configure_provider/configure_provider_from_pool -> persist_session_provider_routing` 统一收口为 `apply_runtime_turn_provider_config(...)`，submit 主路径不再内联铺开 provider apply 分支
- 在 [runtime_turn.rs](../../src-tauri/src/commands/aster_agent_cmd/runtime_turn.rs) 完成第十六刀代码收口：把 `resolved_prompt -> prompt augmentation -> requested/effective strategy persist` 统一收口为 `prepare_runtime_turn_prompt_strategy(...)`，submit 主路径不再内联铺开 prompt/strategy 组装与持久化
- 在 [runtime_turn.rs](../../src-tauri/src/commands/aster_agent_cmd/runtime_turn.rs) 完成第十七刀代码收口：把 `tool surface metadata -> MCP warmup -> skill launch metadata normalize -> turn_input_builder seed` 统一收口为 `prepare_runtime_turn_request(...)`，submit 主路径不再内联铺开 request prepare 分支
- 在 [runtime_turn.rs](../../src-tauri/src/commands/aster_agent_cmd/runtime_turn.rs) 完成第十八刀代码收口：把 `runtime_chat_mode -> web_search/request_tool_policy -> execution_profile` 统一收口为 `prepare_runtime_turn_policy(...)`，submit 主路径不再内联铺开 policy resolve 逻辑
- 在 [runtime_turn.rs](../../src-tauri/src/commands/aster_agent_cmd/runtime_turn.rs) 完成第十九刀代码收口：把 `auto_continue -> workspace repair warning -> session_state_snapshot/working_dir update -> session_recent_runtime_context` 统一收口为 `prepare_runtime_turn_session(...)`，submit 主路径的 session 级前置准备已压成单一 helper，并顺手移除新增的 `runtime_chat_mode` 未使用 warning
- 在 [runtime_turn.rs](../../src-tauri/src/commands/aster_agent_cmd/runtime_turn.rs) 完成第二十刀代码收口：把 `session/policy/request/prompt_strategy -> provider apply/bootstrap` 统一收口为 `prepare_runtime_turn_submit_preparation(...)`，submit 主路径已从多段 helper 串联提升为单一 preflight 准备块
- 在 [runtime_turn.rs](../../src-tauri/src/commands/aster_agent_cmd/runtime_turn.rs) 完成第二十一刀代码收口：把 `sync_browser_assist_runtime_hint -> prepare_runtime_turn_execution -> agent guard -> emit_prelude_and_execute` 统一收口为 `execute_runtime_turn_submit(...)`，submit 主路径当前已压成 `prepare -> scoped execute` 两段主骨架
- 在 [runtime_turn.rs](../../src-tauri/src/commands/aster_agent_cmd/runtime_turn.rs) 完成第二十二刀代码收口：把 `provider_config resolve -> harness metadata normalize -> workspace resolve/turn id/runtime_config` 统一收口为 `prepare_runtime_turn_ingress_context(...)`，入口上下文边界不再散落在主路径中
- 在 [runtime_turn.rs](../../src-tauri/src/commands/aster_agent_cmd/runtime_turn.rs) 完成第二十三刀代码收口：把 `agent init/session_store check -> support tools register` 统一收口为 `prepare_runtime_turn_entry(...)`，主路径的运行时入口准备已形成独立阶段
- 在 [runtime_turn.rs](../../src-tauri/src/commands/aster_agent_cmd/runtime_turn.rs) 完成第二十四刀代码收口：把 `model_skill_tool_access derive -> with_runtime_turn_session_scope -> execute_runtime_turn_submit` 统一收口为 `execute_runtime_turn_with_session_scope(...)`，主路径不再拆包又重组 `submit_preparation`
- 在 [runtime_turn.rs](../../src-tauri/src/commands/aster_agent_cmd/runtime_turn.rs) 完成第二十五刀代码收口：把 `execute_aster_chat_request(...)` 的 `entry -> ingress -> submit_preparation -> session_scope_execute` 外层编排统一收口为 `execute_runtime_turn_pipeline(...)`，`M1` 主路径现在只保留日志入口与单次 pipeline 调用
- 为解除 `runtime_turn` 定向测试的编译阻塞，在 [task_list_tools.rs](../../src-tauri/crates/aster-rust/crates/aster/src/tools/task_list_tools.rs) 把两处 `TeamSessionState / TeamMembershipState` 的团队状态恢复改为复用现有 `from_session(...)` 包装，避免当前工作区里 trait 静态方法解析差异继续卡住主线校验
- 完成最小 Rust 定向校验：`cargo test --manifest-path "src-tauri/Cargo.toml" -p lime --lib commands::aster_agent_cmd::runtime_turn::tests:: -- --nocapture`，结果为 `35 passed`
- 在工作区存在其他 Cargo 并行任务时，补充使用独立 `CARGO_TARGET_DIR=.codex-target-runtime-turn` 重跑同一条 `runtime_turn` 定向测试，结果仍为 `35 passed`
- 在完成第十六到第十九刀后，补充使用独立 `CARGO_TARGET_DIR=.codex-target-runtime-turn-2` 重跑同一条 `runtime_turn` 定向测试，结果更新为 `37 passed`；当前仅剩 [workspace_tools.rs](../../src-tauri/src/commands/aster_agent_cmd/tool_runtime/workspace_tools.rs) 的既有 `format_output` dead_code warning
- 在完成第二十到第二十一刀后，再次使用独立 `CARGO_TARGET_DIR=.codex-target-runtime-turn-2` 重跑同一条 `runtime_turn` 定向测试，结果保持 `37 passed`；第 20-21 刀未引入新的 runtime_turn warning
- 在完成第二十二到第二十四刀后，再次使用独立 `CARGO_TARGET_DIR=.codex-target-runtime-turn-2` 重跑同一条 `runtime_turn` 定向测试，结果仍为 `37 passed`；新增的 `session_id` 未使用 warning 已收掉，当前只剩 [workspace_tools.rs](../../src-tauri/src/commands/aster_agent_cmd/tool_runtime/workspace_tools.rs) 的既有 `format_output` dead_code warning
- 在完成第二十五刀后，再次使用独立 `CARGO_TARGET_DIR=.codex-target-runtime-turn-2` 重跑同一条 `runtime_turn` 定向测试，结果仍为 `37 passed`；新增的 `unused_mut` warning 已收掉，当前只剩 [workspace_tools.rs](../../src-tauri/src/commands/aster_agent_cmd/tool_runtime/workspace_tools.rs) 的既有 `format_output` dead_code warning
- 完成文档新鲜度校验：`npm run harness:doc-freshness`，结果为 `clean`
- 将新入口回挂到 `docs/README.md`、`docs/aiprompts/README.md`、`docs/exec-plans/README.md`
- 将 Query Loop 差距从“口头判断”改为可追踪状态，并更新技术债与总计划进度
- 继续对齐参考运行时 `src/tools` current surface：
  - [plan_mode_tool.rs](../../src-tauri/crates/aster-rust/crates/aster/src/tools/plan_mode_tool.rs) 的 `ExitPlanMode` 现已在 team teammate 场景通过 `send_input` 回调真实向 team lead 投递 `plan_approval_request`，输出补齐 `awaitingLeaderApproval / requestId`
  - [task_list_tools.rs](../../src-tauri/crates/aster-rust/crates/aster/src/tools/task_list_tools.rs) 的 `TaskList` 现已对齐参考语义，自动从 `blockedBy` 里过滤已 `completed` 的 blocker，避免后续任务误判仍被阻塞
  - [mod.rs](../../src-tauri/crates/aster-rust/crates/aster/src/tools/mod.rs) 已把 agent control 的 `send_input` 回调注入 `ExitPlanMode` 注册路径，保持默认注册与 team tools 注册条件不回退
  - [task_output_tool.rs](../../src-tauri/crates/aster-rust/crates/aster/src/tools/task_output_tool.rs) 已继续向参考 `TaskOutputTool` 收口：`task_type` 改为 `local_bash`，移除 payload 中额外的 `outputFile` 字段，补齐 `block=false -> not_ready` 与 `block=true + timeout -> timeout` 的回归测试，并去掉空输出占位文案
  - [task_stop_tool.rs](../../src-tauri/crates/aster-rust/crates/aster/src/tools/task_stop_tool.rs) 已改成参考 `TaskStopTool` 的结构化输出：成功返回 `message / task_id / task_type / command` JSON，`task_type` 改为 `local_bash`，`shell_id` 仅作为兼容别名保留，非运行中任务改成与参考一致的错误语义
  - [agent_control.rs](../../src-tauri/crates/aster-rust/crates/aster/src/tools/agent_control.rs) 的 `SendMessage` 已补 `plan_approval_response` 权限守卫：只有 team lead 可以发送 approve / reject，并补 teammate 被拒绝、lead 可发送的定向测试
  - [task_list_tools.rs](../../src-tauri/crates/aster-rust/crates/aster/src/tools/task_list_tools.rs) 已把 `TaskCreate / TaskGet / TaskUpdate` 的 Rust 反序列化层与 schema 一起收紧到 `deny_unknown_fields / additionalProperties: false`，避免多余字段在 current surface 下静默穿透
  - [task_list_tools.rs](../../src-tauri/crates/aster-rust/crates/aster/src/tools/task_list_tools.rs) 已把 team task board 的读写边界收口到 lead session：同一 team 下的 `TaskCreate / TaskList / TaskGet / TaskUpdate` 现在统一从 lead session 的 `task_list.v1` 快照读取并回写，跨不同 tool registry / 不同 teammate session 也能看到同一份共享任务板，不再依赖单个 agent 进程内的内存缓存
  - [task_list_tools.rs](../../src-tauri/crates/aster-rust/crates/aster/src/tools/task_list_tools.rs) 已把 `TaskUpdate` 的 `verificationNudgeNeeded` 再向参考语义收紧：subagent / teammate 完成最后一个任务时不再误触发“主线程收尾验证提醒”，只保留在非 `SubAgent` session 的完成收尾场景下评估该提示
  - [hooks/types.rs](../../src-tauri/crates/aster-rust/crates/aster/src/hooks/types.rs)、[hooks/loader.rs](../../src-tauri/crates/aster-rust/crates/aster/src/hooks/loader.rs) 与 [task_list_tools.rs](../../src-tauri/crates/aster-rust/crates/aster/src/tools/task_list_tools.rs) 已把 `TaskCreated / TaskCompleted` 正式接入当前 hooks 体系：hook 载荷补齐 `task_id / task_subject / task_description / teammate_name / team_name`，`TaskCreate` 现在会在持久化后执行 `TaskCreated` hook 并在阻塞时回滚任务，`TaskUpdate(status=completed)` 会在真正完成前执行 `TaskCompleted` hook，并按参考语义返回 `success=false`
  - [task_list_tools.rs](../../src-tauri/crates/aster-rust/crates/aster/src/tools/task_list_tools.rs) 已把 `TaskUpdate.owner` 变更继续向参考 `TaskUpdateTool` 收口：当 owner 变更为当前 team 中可解析的成员时，会通过现有 `UserMessageManager` 给目标 session 追加一条 agent-only 的 `task_assignment` JSON 消息，替代参考仓库的 file-mailbox 路径，同时保持“同 owner 重复写入不重复通知”的语义
  - [team_tools.rs](../../src-tauri/crates/aster-rust/crates/aster/src/tools/team_tools.rs) 已把 `TeamCreate / TeamDelete / ListPeers` 的输入反序列化层统一收紧为 `deny_unknown_fields`，保持 team surface 与参考的严格对象语义一致
  - [team_tools.rs](../../src-tauri/crates/aster-rust/crates/aster/src/tools/team_tools.rs) 已继续向参考 `TeamDeleteTool` / `ListPeers` 收口：`TeamDelete` 改为只拦截“仍可达且仍活跃”的 non-lead 成员，idle teammate 不再误阻塞删除，并在成功清理 team 时同步清掉 reachable idle teammate 的 `TeamMembershipState`；`ListPeers` 现会过滤缺失有效 membership 的 stale member，只暴露当前仍可直接通信的 peer
  - [agent_control.rs](../../src-tauri/crates/aster-rust/crates/aster/src/tools/agent_control.rs) 的 `SendMessage` 现已继续向参考 `SendMessageTool` 收口：纯字符串消息缺少 `summary` 时会在 dispatch 前直接报 `summary is required when message is a string`，并补齐命名子 agent 路由场景的回归测试；`shutdown_response` 的 target / reject-reason 参数错误文案也已对齐参考英文语义
  - [team_tools.rs](../../src-tauri/crates/aster-rust/crates/aster/src/tools/team_tools.rs) 的 `TeamCreate` 现已补齐参考默认值语义：未显式传 `agent_type` 时，team lead 成员默认记录为 `team-lead`，避免 `ListPeers` / team 状态里出现空 lead role
  - [team_tools.rs](../../src-tauri/crates/aster-rust/crates/aster/src/tools/team_tools.rs) 的 `TeamCreate / ListPeers` 输出面已继续向参考收口：对外返回的 `lead_agent_id` 与 `peers[].agent_id` 改为稳定的 `name@team` display id，内部 team session / membership 仍保持当前 runtime 所需的真实 session id 路由，`sendTo` 继续作为消息发送主入口
  - [team_tools.rs](../../src-tauri/crates/aster-rust/crates/aster/src/tools/team_tools.rs) 的 `TeamCreate` 已继续向参考 `TeamCreateTool` 收口：`team_file_path` 现改为稳定的 `<config>/teams/<sanitize(team_name)>/config.json` 形态，不再返回 `session://...` 伪路径
  - [team_tools.rs](../../src-tauri/crates/aster-rust/crates/aster/src/tools/team_tools.rs) 的 `TeamCreate` 重名策略已从 `name-2/name-3` 递增后缀改成随机三段式 slug，行为更接近参考仓库的 `generateWordSlug()`
  - [agent_control.rs](../../src-tauri/crates/aster-rust/crates/aster/src/tools/agent_control.rs) 的 `SendMessage` 已补齐当前 team display id 路由：当 `to` 传入 `ListPeers` 暴露的 `name@team` 标识时，会先规范化成当前 team 成员名再进入既有路由与权限校验，因此 `team-lead@alpha` 这类目标现在可用于普通消息和 `shutdown_response`
  - [agent_control.rs](../../src-tauri/crates/aster-rust/crates/aster/src/tools/agent_control.rs) 的 `Agent / SendMessage` 已继续把 strict schema 收口到 Rust 反序列化层：`AgentToolInput` 与 `SendMessageToolInput` 现已补上 `deny_unknown_fields`，多余字段会在 dispatch 前直接被拒绝，不再绕过 JSON schema 静默穿透
  - [remote_trigger_tool.rs](../../src-tauri/crates/aster-rust/crates/aster/src/tools/remote_trigger_tool.rs) 的 `RemoteTrigger` 也已补上 `deny_unknown_fields`，让 `additionalProperties: false` 与实际解析行为保持一致，并补齐未知字段回归测试
  - [send_user_message_tool.rs](../../src-tauri/crates/aster-rust/crates/aster/src/tools/send_user_message_tool.rs) 已继续向参考 `BriefTool` 的附件校验语义收口：输入反序列化改为 `deny_unknown_fields`，附件路径现支持 `~` 展开，缺失文件、权限拒绝和非 regular file 会分别返回与参考一致的细粒度错误文案，同时保留前端当前依赖的 `"Message delivered to user."` 摘要输出不回退
  - [workflow_tool.rs](../../src-tauri/crates/aster-rust/crates/aster/src/tools/workflow_tool.rs)、[config_tool.rs](../../src-tauri/crates/aster-rust/crates/aster/src/tools/config_tool.rs)、[powershell_tool.rs](../../src-tauri/crates/aster-rust/crates/aster/src/tools/powershell_tool.rs)、[worktree_tools.rs](../../src-tauri/crates/aster-rust/crates/aster/src/tools/worktree_tools.rs)、[cron_tools.rs](../../src-tauri/crates/aster-rust/crates/aster/src/tools/cron_tools.rs) 与 [sleep_tool.rs](../../src-tauri/crates/aster-rust/crates/aster/src/tools/sleep_tool.rs) 已完成同一批 strict-schema 收口：这些工具凡是 schema 已声明 `additionalProperties: false` 的 current surface，现已统一在 Rust 输入结构上补齐 `deny_unknown_fields`，避免多余字段继续从反序列化层静默穿透
  - [config_tool.rs](../../src-tauri/crates/aster-rust/crates/aster/src/tools/config_tool.rs) 已继续向参考 `ConfigTool` / `supportedSettings.ts` 收口：工具面从仅支持 `model` 与 `permissions.defaultMode` 扩到当前参考仓库的全部非 feature-gated setting（`theme / editorMode / verbose / preferredNotifChannel / autoCompactEnabled / autoMemoryEnabled / autoDreamEnabled / fileCheckpointingEnabled / showTurnDuration / terminalProgressBarEnabled / taskTrackingEnabled / alwaysThinkingEnabled / language / teammateMode`），同时把布尔值字符串写入、枚举项校验和动态 description 统一收口到受控 setting 表
  - [config_tool.rs](../../src-tauri/crates/aster-rust/crates/aster/src/tools/config_tool.rs) 的 `permissions.defaultMode` 已补齐当前 Lime runtime 别名语义：除参考当前可映射的 `default / acceptEdits / auto` 外，现也显式支持 `approve / chat` 两个 Lime 运行时模式，并对参考里的 `plan / dontAsk` 返回“当前 runtime 尚未实现”的结构化失败，避免继续把不等价模式静默映射错位
  - [plan_mode_tool.rs](../../src-tauri/crates/aster-rust/crates/aster/src/tools/plan_mode_tool.rs) 已重新确认 current 边界：`ExitPlanMode` 顶层输入仍刻意保持 `additionalProperties: true`，因此这轮不再把顶层反序列化收紧；只保留 `allowedPrompts` item 级 strict object，不让计划模式工具偏离当前 surface
  - [ask.rs](../../src-tauri/crates/aster-rust/crates/aster/src/tools/ask.rs) 已把 `AskUserQuestion` 继续向参考 strict object surface 收口：顶层 `questions`、question item、option item 的 schema 全部显式补齐 `additionalProperties: false`，Rust 输入结构同步补上 `deny_unknown_fields`；同时把 `AskOptionInput` 改成手写反序列化，避免 `untagged enum` 吞掉 option 子项的未知字段错误，当前 `extra` 这类脏字段会稳定返回 `unknown field` 失败而不再被泛化成匹配失败
  - [worktree_tools.rs](../../src-tauri/crates/aster-rust/crates/aster/src/tools/worktree_tools.rs) 已把 `EnterWorktree / ExitWorktree` 的输出面继续向参考收口：`EnterWorktree` 成功消息补齐“退出 session 也会提示处理 worktree”的语义；`ExitWorktree` 的成功输出去掉当前 runtime 实际不会返回的 `noop` 字段，避免继续暴露参考 current surface 外的冗余字段
  - [tool_search_tool.rs](../../src-tauri/crates/aster-rust/crates/aster/src/tools/tool_search_tool.rs) 已把 `ToolSearch` 的输入面继续向参考收口：Rust 输入结构补上 `deny_unknown_fields`，schema 顶层补齐 `additionalProperties: false`；同时在“无命中结果”时补回参考 `pending_mcp_servers` 输出字段，并保留当前 Lime UI 仍在消费的 `notes` 字段不回退
  - [extension_manager.rs](../../src-tauri/crates/aster-rust/crates/aster/src/agents/extension_manager.rs) 已补最小 pending 扩展状态：`ExtensionManager` 现在会在 `add_extension(...)` 连接期间维护一个排序后的 `pending_extensions` 集合，供 `ToolSearch` 在扩展尚未连上时暴露 `pending_mcp_servers`，同时对并发重复启用同名扩展做去重，避免重复连接
  - [toolSearchResultSummary.ts](../../src/components/agent/chat/utils/toolSearchResultSummary.ts) 与 [ToolSearchSummaryPanel.tsx](../../src/components/agent/chat/components/ToolSearchSummaryPanel.tsx) 已完成 `pending_mcp_servers` 的最小前端兼容：summary parser 会识别后端新增字段，面板会在无命中但 MCP 仍在连接时显示“以下 MCP 服务仍在连接中”，避免这次 `ToolSearch` 对齐只停留在后端埋字段
  - [agent.rs](../../src-tauri/crates/aster-rust/crates/aster/src/agents/agent.rs) 已把两个测试 helper 的 `CallToolRequestParam.name` 显式改成 `Cow::Owned(...)`，用于消除 lib test 编译时的 `'static` 推断歧义，避免它继续阻塞 tools 定向校验

### 本轮补充校验

- `npx vitest run "src/components/agent/chat/components/MessageList.test.tsx" "src/components/agent/chat/components/AgentThreadTimeline.test.tsx"`
- `cargo fmt --manifest-path "src-tauri/Cargo.toml" --all`
- `env CARGO_TARGET_DIR="/Users/coso/Documents/dev/ai/aiclientproxy/lime/.codex-target-runtime-turn" cargo test --manifest-path "src-tauri/Cargo.toml" -p lime --lib commands::aster_agent_cmd::runtime_turn::tests:: -- --nocapture`
- `env CARGO_TARGET_DIR="/Users/coso/Documents/dev/ai/aiclientproxy/lime/.codex-target-runtime-turn-2" cargo test --manifest-path "src-tauri/Cargo.toml" -p lime --lib commands::aster_agent_cmd::runtime_turn::tests:: -- --nocapture`
- `npm run harness:doc-freshness`
- `env CARGO_TARGET_DIR="/Users/coso/Documents/dev/ai/aiclientproxy/lime/.codex-target" cargo test --manifest-path "src-tauri/crates/aster-rust/crates/aster/Cargo.toml" plan_mode_tool::tests:: --lib -- --nocapture`
- `env CARGO_TARGET_DIR="/Users/coso/Documents/dev/ai/aiclientproxy/lime/.codex-target" cargo test --manifest-path "src-tauri/crates/aster-rust/crates/aster/Cargo.toml" task_list_tools::tests:: --lib -- --nocapture`
- `env CARGO_TARGET_DIR="/Users/coso/Documents/dev/ai/aiclientproxy/lime/.codex-target" cargo test --manifest-path "src-tauri/crates/aster-rust/crates/aster/Cargo.toml" tools::tests::test_register --lib -- --nocapture`
- `env CARGO_TARGET_DIR="/Users/coso/Documents/dev/ai/aiclientproxy/lime/.codex-target" cargo test --manifest-path "src-tauri/crates/aster-rust/crates/aster/Cargo.toml" task_output_tool::tests:: --lib -- --nocapture`
- `env CARGO_TARGET_DIR="/Users/coso/Documents/dev/ai/aiclientproxy/lime/.codex-target" cargo test --manifest-path "src-tauri/crates/aster-rust/crates/aster/Cargo.toml" task_stop_tool::tests:: --lib -- --nocapture`
- `env CARGO_TARGET_DIR="/Users/coso/Documents/dev/ai/aiclientproxy/lime/.codex-target" cargo test --manifest-path "src-tauri/crates/aster-rust/crates/aster/Cargo.toml" agent_control::tests:: --lib -- --nocapture`
- `env CARGO_TARGET_DIR="/Users/coso/Documents/dev/ai/aiclientproxy/lime/.codex-target" cargo test --manifest-path "src-tauri/crates/aster-rust/crates/aster/Cargo.toml" remote_trigger_tool::tests:: --lib -- --nocapture`
- `env CARGO_TARGET_DIR="/Users/coso/Documents/dev/ai/aiclientproxy/lime/.codex-target" cargo test --manifest-path "src-tauri/crates/aster-rust/crates/aster/Cargo.toml" team_tools::tests:: --lib -- --nocapture`
- `env CARGO_TARGET_DIR="/Users/coso/Documents/dev/ai/aiclientproxy/lime/.codex-target" cargo test --manifest-path "src-tauri/crates/aster-rust/crates/aster/Cargo.toml" send_user_message_tool::tests:: --lib -- --nocapture`
- `env CARGO_TARGET_DIR="/Users/coso/Documents/dev/ai/aiclientproxy/lime/.codex-target" cargo test --manifest-path "src-tauri/crates/aster-rust/crates/aster/Cargo.toml" config_tool::tests:: --lib -- --nocapture`
- `env CARGO_TARGET_DIR="/Users/coso/Documents/dev/ai/aiclientproxy/lime/.codex-target" cargo test --manifest-path "src-tauri/crates/aster-rust/crates/aster/Cargo.toml" ask::tests:: --lib -- --nocapture`
- `env CARGO_TARGET_DIR="/Users/coso/Documents/dev/ai/aiclientproxy/lime/.codex-target" cargo test --manifest-path "src-tauri/crates/aster-rust/crates/aster/Cargo.toml" tool_search_tool::tests:: --lib -- --nocapture`
- `env CARGO_TARGET_DIR="/Users/coso/Documents/dev/ai/aiclientproxy/lime/.codex-target" cargo test --manifest-path "src-tauri/crates/aster-rust/crates/aster/Cargo.toml" extension_manager::tests:: --lib -- --nocapture`
- `npx vitest run "src/components/agent/chat/utils/toolSearchResultSummary.test.ts" "src/components/agent/chat/components/ToolSearchSummaryPanel.test.tsx"`
- `env CARGO_TARGET_DIR="/Users/coso/Documents/dev/ai/aiclientproxy/lime/.codex-target" cargo test --manifest-path "src-tauri/crates/aster-rust/crates/aster/Cargo.toml" worktree_tools::tests:: --lib -- --nocapture`
- `env CARGO_TARGET_DIR="/Users/coso/Documents/dev/ai/aiclientproxy/lime/.codex-target" cargo test --manifest-path "src-tauri/crates/aster-rust/crates/aster/Cargo.toml" cron_tools::tests:: --lib -- --nocapture`
- `env CARGO_TARGET_DIR="/Users/coso/Documents/dev/ai/aiclientproxy/lime/.codex-target" cargo test --manifest-path "src-tauri/crates/aster-rust/crates/aster/Cargo.toml" sleep_tool::tests:: --lib -- --nocapture`
- `env CARGO_TARGET_DIR="/Users/coso/Documents/dev/ai/aiclientproxy/lime/.codex-target" cargo test --manifest-path "src-tauri/crates/aster-rust/crates/aster/Cargo.toml" powershell_tool::tests:: --lib -- --nocapture`
- `env CARGO_TARGET_DIR="/Users/coso/Documents/dev/ai/aiclientproxy/lime/.codex-target" cargo test --manifest-path "src-tauri/crates/aster-rust/crates/aster/Cargo.toml" workflow_tool::tests:: --lib -- --nocapture`
- `env CARGO_TARGET_DIR="/Users/coso/Documents/dev/ai/aiclientproxy/lime/.codex-target" cargo test --manifest-path "src-tauri/crates/aster-rust/crates/aster/Cargo.toml" hooks::tests:: --lib -- --nocapture`
- 建立 State / History / Telemetry current 文档 [state-history-telemetry.md](../aiprompts/state-history-telemetry.md)，把 `session / thread / turn / request / evidence / history` 收口成单一状态地图
- 将 `agent_sessions / agent_messages -> SessionDetail -> AgentRuntimeThreadReadModel -> RequestLog 关联键 -> handoff/evidence/replay/analysis/review -> history-record/trend/cleanup/dashboard -> HarnessStatusPanel / AgentThreadReliabilityPanel` 明确归到 state/history/telemetry current 主链
- 将原 `state-model` 历史子专题、`docs/roadmap/reliability/*` 与 [telemetry_cmd.rs](../../src-tauri/src/commands/telemetry_cmd.rs) 明确归到 compat，并把 cleanup 报表里残留的 `requestTelemetry:unlinked` 旧语义标记为 deprecated
- 将 state/history/telemetry 入口同步回 [docs/README.md](../README.md)、[docs/aiprompts/README.md](../aiprompts/README.md)、[docs/aiprompts/overview.md](../aiprompts/overview.md) 与 [AGENTS.md](../../AGENTS.md)，仓库导航不再继续把旧状态模型方案或 reliability 计划当成 current 主线
- 再次执行 `npm run harness:doc-freshness` 并通过（`clean`）
- 新增 [docs/roadmap/reliability/README.md](../roadmap/reliability/README.md)，把 reliability 目录补成明确的 compat 入口，不再让分阶段计划文件继续承担 current 导航职责
- 在 [generated-slop-report-core.mjs](../../scripts/lib/generated-slop-report-core.mjs) 将旧 `requestTelemetry:unlinked` 语义折叠为 `known_gap` 兼容别名，并补定向测试守卫，避免 cleanup/dashboard 继续把旧历史样本当成现役 observability 状态
- 在 `docs/roadmap/reliability/*.md` 全部补上 compat 提示，正文开头统一先回挂 [state-history-telemetry.md](../aiprompts/state-history-telemetry.md)，避免专项正文继续被误读成 current 主入口
- 在 `docs/roadmap/reliability/*.md` 进一步压缩顶部导航：把重复的上位文档长列表统一收口为 `README + current 主链 + PR 对应映射`，减少专项正文重复解释
- 将整组 `docs/roadmap/reliability/*` 进一步压缩为 compat 历史摘要档案：只保留落地结果、current 映射与延后增强项，重复的目标/问题/范围/实施清单正文统一回退到仓库历史
- 将原状态模型历史子专题进一步压缩并最终并入 [lime-aster-codex-alignment-roadmap.md](../roadmap/lime-aster-codex-alignment-roadmap.md)：只保留状态边界判断、current 映射与延后增强项，不再保留独立顶层路线图
- 在 [lime-aster-codex-alignment-roadmap.md](../roadmap/lime-aster-codex-alignment-roadmap.md) 收紧顶部导航：当前入口统一回挂到 [query-loop.md](../aiprompts/query-loop.md)、[state-history-telemetry.md](../aiprompts/state-history-telemetry.md) 与 [upstream-runtime-alignment-plan.md](./upstream-runtime-alignment-plan.md)
- 将 [lime-aster-codex-alignment-roadmap.md](../roadmap/lime-aster-codex-alignment-roadmap.md) 进一步压缩为 compat 历史摘要档案：只保留阶段映射、历史判断与 current 回看入口，不再继续承载长篇阶段任务与验证流水
- 将原对话执行效率历史子专题进一步压缩并并入 [lime-aster-codex-alignment-roadmap.md](../roadmap/lime-aster-codex-alignment-roadmap.md)：只保留历史主题、current 映射与延后方向，不再保留独立顶层路线图
- 将 `docs/roadmap/artifacts/*` 中仍把旧执行效率路线图当 current 运行时依据的说明，统一改回 `query-loop / task-agent-taxonomy / state-history-telemetry / upstream-runtime-alignment-plan`
- 在 [telemetry_cmd.rs](../../src-tauri/src/commands/telemetry_cmd.rs) 收紧命令注释：这些命令只暴露原始 `RequestLog` 与聚合统计，不负责定义 session/thread current 状态真相
- 继续对齐 team / task tool surface：
  - 在 [task_output_tool.rs](../../src-tauri/crates/aster-rust/crates/aster/src/tools/task_output_tool.rs) 为 `block` 补齐参考仓库 `semanticBoolean` 兼容，允许模型把布尔值误写成字符串 `"true"` / `"false"` 时仍能按当前 `TaskOutput` 主链执行
  - 在 [tool_search_tool.rs](../../src-tauri/crates/aster-rust/crates/aster/src/tools/tool_search_tool.rs) 为 `TaskCreate / TaskGet / TaskList / TaskUpdate / TaskOutput / TaskStop / TeamCreate / TeamDelete / ListPeers` 补齐参考仓库常见别名与意图词，减少 `kill shell`、`agent output`、`ListPeersTool`、`swarm peers` 这类上游表述在 Lime 中搜不到当前工具的漂移
  - 在 [catalog.rs](../../src-tauri/src/agent_tools/catalog.rs) 补齐 `KillShell -> TaskStop` 与 `ListPeersTool -> ListPeers` 的 reference alias 规范化，避免参考仓库工具名在 Lime 运行时目录册中掉映射
  - 在 [agent_control.rs](../../src-tauri/crates/aster-rust/crates/aster/src/tools/agent_control.rs) 与 [team_tools.rs](../../src-tauri/crates/aster-rust/crates/aster/src/tools/team_tools.rs) 显式收口 peer surface 差异：`SendMessage` 现会识别参考仓库 `uds:` / `bridge:` peer address，并返回“当前 Lime runtime 未实现 cross-session peer messaging”的结构化失败，不再误把这类 target 当作普通 `agent_id` 投递；`ListPeers` 描述同步明确当前只枚举 team 内可达 peers
  - 在 [base.rs](../../src-tauri/crates/aster-rust/crates/aster/src/tools/base.rs)、[registry.rs](../../src-tauri/crates/aster-rust/crates/aster/src/tools/registry.rs)、[task_list_tools.rs](../../src-tauri/crates/aster-rust/crates/aster/src/tools/task_list_tools.rs)、[task_output_tool.rs](../../src-tauri/crates/aster-rust/crates/aster/src/tools/task_output_tool.rs)、[task_stop_tool.rs](../../src-tauri/crates/aster-rust/crates/aster/src/tools/task_stop_tool.rs)、[team_tools.rs](../../src-tauri/crates/aster-rust/crates/aster/src/tools/team_tools.rs) 与 [agent_control.rs](../../src-tauri/crates/aster-rust/crates/aster/src/tools/agent_control.rs) 补齐执行层 alias 兼容：`ToolRegistry` 现在会把 `BashTool / ConfigTool / FileReadTool / FileWriteTool / FileEditTool / EnterPlanModeTool / ExitPlanModeTool / EnterWorktreeTool / ExitWorktreeTool / GlobTool / GrepTool / LSPTool / NotebookEditTool / PowerShellTool / BriefTool / SkillTool / SleepTool / WebFetchTool / WebSearchTool`，以及 `TaskCreateTool / TaskListTool / TaskGetTool / TaskUpdateTool / TaskOutputTool / AgentOutputTool / BashOutputTool / TaskStopTool / KillShell / SendMessageTool / SendInput / TeamCreateTool / TeamDeleteTool / ListPeersTool` 真实解析到 current native tools，不再停留在“目录能搜到、运行时却找不到”的半对齐状态
- 继续对齐 Config current surface：
  - 在 [config_tool.rs](../../src-tauri/crates/aster-rust/crates/aster/src/tools/config_tool.rs) 把 `classifierPermissionsEnabled / voiceEnabled / remoteControlAtStartup / taskCompleteNotifEnabled / inputNeededNotifEnabled / agentPushNotifEnabled` 纳入 `ConfigTool` 已知 setting 集合，不再继续落到 `Unknown setting`
  - 同时将上述 6 个 setting 明确收口为“已知上游表面，但当前 Lime runtime 未实现”的结构化失败，避免把分散存在的语音 / 通知 / autostart / remote 能力误绑定到错误配置键
  - 进一步收紧 [config_tool.rs](../../src-tauri/crates/aster-rust/crates/aster/src/tools/config_tool.rs) 的 `voiceEnabled / remoteControlAtStartup` unsupported 文案：前者明确卡在“缺少宿主 callback 同步全局语音快捷键副作用”，后者明确 Lime 当前只有 OS auto-launch，并不等同于上游 remote-control-at-startup 语义
  - 在 [config_tool.rs](../../src-tauri/crates/aster-rust/crates/aster/src/tools/config_tool.rs) 与 [runtime_turn.rs](../../src-tauri/src/commands/aster_agent_cmd/runtime_turn.rs) 接上 `voiceEnabled` 宿主回调：当前 runtime turn 入口会用 Tauri 宿主的 `get_voice_input_config / save_voice_input_config` 回填 `ConfigTool`，因此 `voiceEnabled` 现在会真实读取/更新 `experimental.voice_input.enabled`，并同步触发全局语音快捷键注册/注销副作用；`remoteControlAtStartup` 仍保持 unsupported
- 补执行边界校验：
  - `npx vitest run "scripts/lib/generated-slop-report-core.test.ts"` 通过（`8 passed`）
  - `npm run harness:cleanup-report:check` 通过（`ok`）
  - `npm run harness:doc-freshness` 通过（`clean`，含历史摘要压缩后的再次确认）
  - `env CARGO_TARGET_DIR="/Users/coso/Documents/dev/ai/aiclientproxy/lime/.codex-target" cargo test --manifest-path "src-tauri/crates/aster-rust/crates/aster/Cargo.toml" task_output_tool::tests:: --lib -- --nocapture` 通过（`11 passed`）
  - `env CARGO_TARGET_DIR="/Users/coso/Documents/dev/ai/aiclientproxy/lime/.codex-target" cargo test --manifest-path "src-tauri/crates/aster-rust/crates/aster/Cargo.toml" tool_search_tool::tests:: --lib -- --nocapture` 通过（`25 passed`）
  - `env CARGO_TARGET_DIR="/Users/coso/Documents/dev/ai/aiclientproxy/lime/.codex-target" cargo test --manifest-path "src-tauri/Cargo.toml" test_tool_catalog_entry_normalizes_reference_js_tool_names_to_current_surface --lib -- --nocapture` 通过（`1 passed`）
  - `env CARGO_TARGET_DIR="/Users/coso/Documents/dev/ai/aiclientproxy/lime/.codex-target" cargo test --manifest-path "src-tauri/crates/aster-rust/crates/aster/Cargo.toml" config_tool::tests:: --lib -- --nocapture` 通过（`14 passed`）
  - `env CARGO_TARGET_DIR="/Users/coso/Documents/dev/ai/aiclientproxy/lime/.codex-target" cargo test --manifest-path "src-tauri/crates/aster-rust/crates/aster/Cargo.toml" test_registry_resolves_native_aliases_during_lookup_and_execution --lib -- --nocapture` 通过（`1 passed`）
  - `env CARGO_TARGET_DIR="/Users/coso/Documents/dev/ai/aiclientproxy/lime/.codex-target" cargo test --manifest-path "src-tauri/crates/aster-rust/crates/aster/Cargo.toml" test_registry_unregister_clears_native_aliases --lib -- --nocapture` 通过（`1 passed`）
  - `env CARGO_TARGET_DIR="/Users/coso/Documents/dev/ai/aiclientproxy/lime/.codex-target" cargo test --manifest-path "src-tauri/crates/aster-rust/crates/aster/Cargo.toml" test_register_default_tools --lib -- --nocapture` 通过（`1 passed`）
  - `env CARGO_TARGET_DIR="/Users/coso/Documents/dev/ai/aiclientproxy/lime/.codex-target" cargo test --manifest-path "src-tauri/crates/aster-rust/crates/aster/Cargo.toml" test_registers_team_tools_when_spawn_and_send_callbacks_exist --lib -- --nocapture` 通过（`1 passed`）
  - `env CARGO_TARGET_DIR="/Users/coso/Documents/dev/ai/aiclientproxy/lime/.codex-target" cargo test --manifest-path "src-tauri/Cargo.toml" test_normalize_workspace_tool_permission_behavior_auto_mode_allows_warning --lib -- --nocapture` 通过（`1 passed`，确认主 crate 的 `runtime_turn` 编译链已带起）
  - `env CARGO_TARGET_DIR="/Users/coso/Documents/dev/ai/aiclientproxy/lime/.codex-target" cargo test --manifest-path "src-tauri/crates/aster-rust/crates/aster/Cargo.toml" agent_control::tests:: --lib -- --nocapture` 已启动重跑，但本轮未等到 `aster` test binary 重编译完成；后续需补跑以确认 `uds:` / `bridge:` 受控失败分支未回退现有 `team` / `named child` 路由

### 本轮继续补齐

- 继续推进“应用层优先消费统一 runtime tool surface”：
  - 在 [inventory.rs](../../src-tauri/src/agent_tools/inventory.rs)、[runtime_api.rs](../../src-tauri/src/commands/aster_agent_cmd/command_api/runtime_api.rs)、[types.ts](../../src/lib/api/agentRuntime/types.ts)、[core.ts](../../src/lib/tauri-mock/core.ts) 与 [HarnessStatusPanel.tsx](../../src/components/agent/chat/components/HarnessStatusPanel.tsx) 已补统一 `runtime_tools` 视图后，本轮继续把前端 usage 从“只在工具库存面板里看四张表”往“主界面直接消费实际 runtime tool surface”推进
  - [useWorkspaceHarnessInventoryRuntime.ts](../../src/components/agent/chat/workspace/useWorkspaceHarnessInventoryRuntime.ts) 现在会在主界面启用时预取工具库存，不再等 Harness 面板展开后才第一次拉取
  - 新增 [runtimeToolAvailability.ts](../../src/components/agent/chat/utils/runtimeToolAvailability.ts)，把 `runtime_tools` 优先、`registry_tools` 兜底的真实 current surface 收口为 `webSearch / subagent(team) / task` 三组 capability 派生
  - [useWorkspaceInputbarSceneRuntime.tsx](../../src/components/agent/chat/workspace/useWorkspaceInputbarSceneRuntime.tsx)、[AgentRuntimeStrip.tsx](../../src/components/agent/chat/components/AgentRuntimeStrip.tsx)、[WorkspaceConversationScene.tsx](../../src/components/agent/chat/workspace/WorkspaceConversationScene.tsx)、[EmptyState.tsx](../../src/components/agent/chat/components/EmptyState.tsx) 与 [EmptyStateComposerPanel.tsx](../../src/components/agent/chat/components/EmptyStateComposerPanel.tsx) 已开始直接消费这份派生结果：Runtime strip 会显示实际 runtime tool surface 规模与 team/task gap，首页主输入区也会在用户开启 `联网搜索 / 任务拆分` 偏好但 runtime current tools 尚未接通时给出明确提示，不再把静态偏好误显示成“真实可用能力”；此前误导性的两条页级黄提示已从主路径移除，只在工作台诊断位保留真实缺口摘要
  - 本轮继续补齐测试与 smoke：
    - 新增 [runtimeToolAvailability.test.ts](../../src/components/agent/chat/utils/runtimeToolAvailability.test.ts)，覆盖 `runtime_tools` current surface 派生与开发态 override
    - 新增 [AgentRuntimeStrip.test.tsx](../../src/components/agent/chat/components/AgentRuntimeStrip.test.tsx) 与 [EmptyState.test.tsx](../../src/components/agent/chat/components/EmptyState.test.tsx) 的 `runtime tool surface` 页级断言，验证 runtime strip 的 team/task gap 与首页空态告警都能真实透传
    - 在 [HarnessStatusPanel.tsx](../../src/components/agent/chat/components/HarnessStatusPanel.tsx) 新增 `Runtime 能力摘要`，让工具库存面板也直接消费 `deriveRuntimeToolAvailability(...)`，显式展示 `WebSearch / 子任务核心 tools / Team current tools / Task current tools` 的已接通状态或缺口，不再只显示 raw runtime tool list
    - 在 [HarnessStatusPanel.test.tsx](../../src/components/agent/chat/components/HarnessStatusPanel.test.tsx) 新增 `runtime tool surface` 断言，覆盖 team/task gap 暴露与 current surface 完整接通两种情况
    - 新增 [agent-runtime-tool-surface-smoke.mjs](../../scripts/agent-runtime-tool-surface-smoke.mjs)，并接入 [verify-gui-smoke.mjs](../../scripts/verify-gui-smoke.mjs) 与 [package.json](../../package.json) 的 `smoke:agent-runtime-tool-surface` current smoke 入口，避免这条主线只停留在局部单测
    - 新增 [agent-runtime-tool-surface-page-smoke.mjs](../../scripts/agent-runtime-tool-surface-page-smoke.mjs)，通过真实页面执行 `onboarding -> 最小发送 -> 工作台` 链路，断言 `Runtime 能力摘要` 中的 `WebSearch / 子任务核心 tools / Team current tools / Task current tools` 缺口文案，同时确认旧页级黄提示不再回到页面主路径；脚本固定使用 `stream_mode=events`，避开真实页面在 `cdp_direct + frames/both` 下会把 `Runtime.evaluate` 挤到超时的已知运行时特性
  - 本轮已执行校验：
    - `npm run smoke:agent-runtime-tool-surface` 通过
    - `npm run smoke:agent-runtime-tool-surface-page` 通过
    - `npm run verify:gui-smoke` 已接入新的 `smoke:agent-runtime-tool-surface-page`
    - 真实页面自动 smoke 已验证：开发态 override 下可稳定进入工作台 `Runtime 能力摘要`，并且旧页级黄提示不会重新出现

### 当前判断

- `M0` 统一排期事实源：已完成
- `M1` Query Loop 收口：已完成第二十五刀实现，并继续收口 `TurnInputEnvelope -> SessionConfig` 的 turn context snapshot 分叉、`action_runtime` 辅助恢复链的 turn context 旁路，以及 `compact_session` 控制回合的最小上下文边界；当前主路径已压成 `execute_aster_chat_request -> execute_runtime_turn_pipeline -> entry/ingress/submit_preparation/session_scope_execute`，turn context 的 output schema / auto_compact / request metadata 也已进一步收紧到共享 snapshot helper
- `M2` Task / Agent taxonomy 收口：已完成 current taxonomy 文档、索引回挂与分类判断；当前长时执行入口统一按 `agent turn / subagent turn / automation job` 解释，`ExecutionTracker` 只作为统一执行摘要层，`SchedulerService` 只作为 compat 触发壳
- `M3` Remote runtime 收口：已完成 current remote 文档、索引回挂与分类判断；当前远程入口统一按 `消息渠道 runtime + 浏览器连接器 / ChromeBridge` 解释，`DevBridge` 与 `OpenClaw` 只作为 compat 支撑，`telegram_remote_cmd` 只作为 deprecated 单通道入口
- `M5` State / History / Telemetry 收口：已完成 current 状态地图、索引回挂与分类判断；当前状态链统一按 `SessionDetail -> AgentRuntimeThreadReadModel -> RequestLog 关联键 -> export/history` 解释，旧状态模型方案、reliability 计划、Aster/Codex 联合路线图与原始 request log 浏览面只作为 compat 附属层，其中 `docs/roadmap/reliability/*` 与 [lime-aster-codex-alignment-roadmap.md](../roadmap/lime-aster-codex-alignment-roadmap.md) 已进一步压成 umbrella 历史摘要档案
- `M1` 退出判断：已满足“不再需要横跳多份文档才能解释 Lime 主循环”的出口条件，后续默认不再继续微切 `runtime_turn.rs`
- `M2` 退出判断：已满足“所有长时执行入口都能归到唯一 taxonomy”的出口条件，后续不再继续把 execution tracker、scheduler、subagent、automation 当作多条平级主线分别排期
- `M3` 退出判断：已满足“remote 不再是多个并列产品旁路”的出口条件，后续只允许在 `gateway_channel_*` 与 `browser connector / ChromeBridge` current ingress 上继续长能力
- `M4` 退出判断：已满足“`memory_runtime_*` 与 `compact_session` 不再被当成分散能力点看待”的出口条件；后续只允许在 `memory_runtime_*`、`unified_memory_*` 与 `agent_runtime_compact_session` current 边界继续长记忆 / 压缩能力
- `M5` 退出判断：已满足“session / thread / turn / request / evidence / history 的读模型叙事收口”的出口条件；后续只允许在 `SessionDetail`、`AgentRuntimeThreadReadModel`、`RequestLog` 关联键与 `agent_runtime_export_*` current 边界继续长能力

### 下一刀

- `docs/roadmap/reliability/*` 与 [lime-aster-codex-alignment-roadmap.md](../roadmap/lime-aster-codex-alignment-roadmap.md) 的 compat 历史档案化已完成；其中原 `state-model` 与 `conversation-execution-efficiency` 子专题已经并入 `alignment-roadmap`。当前又收口了 `TurnInputEnvelope -> SessionConfig` 的 turn context 分叉、`action_runtime` 辅助恢复链旁路，并显式化了 `compact_session` 控制回合的最小上下文边界；剩余散落在 `persona_cmd` / `theme_context_cmd` 的一次性临时会话配置也已收回专用 helper，零入口旧发送壳已删除，Tauri 命令层 raw execution 也已经固定为 3 处并补了源码扫描守卫。下一刀转向继续盘点 `src-tauri/src` 非命令层与 README/示例面是否还残留会误导实现者的原始执行旁路叙事
- 后续若出现 `runtime_turn` 行为回退，再回到 `M1` current 主路径做定点修复，而不是继续常态化微切

### 继续推进（CCD-008 / Agent hook current）

- 继续沿 `hooks / skills` 主线推进后，`Agent hook` 已从占位实现推进成真实 current 执行，不再只是 `warn! + success(None)`：
  - [types.rs](../../src-tauri/crates/aster-rust/crates/aster/src/hooks/types.rs) 里的 `AgentHookConfig` 已补 direct `prompt / model` 字段，作为 current 事实源；原有 `agent_type / agent_config` 继续保留为 compat，其中 `agent_config.prompt / model / max_turns` 仍可回退解析，避免直接打断旧草案配置。
  - [executor.rs](../../src-tauri/crates/aster-rust/crates/aster/src/hooks/executor.rs) 里的 `Agent hook` 现在会复用与 `Prompt hook` 相同的 provider 解析优先级：先按 `session_id -> query_session(...) -> provider_name / model_config`，命不中当前 session 上下文时才回退 `ASTER_PROVIDER / ASTER_MODEL`。
  - `Agent hook` 的实际执行不再另造 query loop，而是接入现有 [agent.rs](../../src-tauri/crates/aster-rust/crates/aster/src/agents/agent.rs) `Agent.reply(...)` 主链：运行时会为 hook 创建隔离的临时 subagent session store，复用现有 tool surface、StructuredOutput/output schema 与 turn runtime，而不把一次 hook 验证写进正式 session 存储。
  - 为了避免 non-interactive hook verifier 卡死在审批流，本轮新增 `Agent::set_permission_mode(...)`，并在 hook agent 上显式切到 `AsterMode::Auto`；这样 hook verifier 会保持 headless current 行为，不会因为 `AskUserQuestion / confirmation_rx` 进入等待。
  - `Agent hook` 现同样使用最小 JSON decision contract：最终通过 `StructuredOutput` 返回 `{"ok":true}` 或 `{"ok":false,"reason":"..."}`；`ok=false` 会真实映射到 `HookResult::blocked(...)`。
- 这一步后的 `CCD-008` 边界进一步收紧为：
  - `current`：`TaskCreated / TaskCompleted` hooks、project-level `UserPromptSubmit`、`SessionStart(startup / compact)`、`command / url / prompt / agent` hook executor、`SkillTool` prompt/workflow execution。
  - `current gap`：`MCP hook`、`SessionStart(resume)`、skill frontmatter hooks、plugin hook load/hot reload、更多 event bootstrap、`SkillExecutionMode::Agent`。
  - `compat`：`agent_type / agent_config` 继续保留，但不再主导 `Agent hook` current 行为。
- 这一步服务路线图主目标的关系是：把 `CCD-008` 从“prompt hook 已 current、agent hook 仍是假实现”的断层，推进成“扩展体系至少已有两条真实 LLM hook current 主链”；这样后续剩余差距就集中到 `MCP hook + 更多 event bootstrap + skill frontmatter/plugin hooks`，不再混着一个明显的执行空洞。
- 已执行定向校验：
  - `rustfmt --edition 2021 "src-tauri/crates/aster-rust/crates/aster/src/hooks/executor.rs" "src-tauri/crates/aster-rust/crates/aster/src/hooks/types.rs" "src-tauri/crates/aster-rust/crates/aster/src/hooks/registry.rs" "src-tauri/crates/aster-rust/crates/aster/src/hooks/tests.rs" "src-tauri/crates/aster-rust/crates/aster/src/agents/agent.rs"` 通过
  - `env CARGO_INCREMENTAL=0 RUSTFLAGS="-Cdebuginfo=0" CARGO_TARGET_DIR="/Users/coso/Documents/dev/ai/aiclientproxy/lime/.codex-target" cargo test --manifest-path "src-tauri/crates/aster-rust/crates/aster/Cargo.toml" execute_agent_hook_with_provider_should_ --lib --no-default-features` 通过（`3 passed`）
  - `env CARGO_INCREMENTAL=0 RUSTFLAGS="-Cdebuginfo=0" CARGO_TARGET_DIR="/Users/coso/Documents/dev/ai/aiclientproxy/lime/.codex-target" cargo test --manifest-path "src-tauri/crates/aster-rust/crates/aster/Cargo.toml" test_agent_hook_config_ --lib --no-default-features` 通过（`2 passed`）
  - `env CARGO_INCREMENTAL=0 RUSTFLAGS="-Cdebuginfo=0" CARGO_TARGET_DIR="/Users/coso/Documents/dev/ai/aiclientproxy/lime/.codex-target" cargo test --manifest-path "src-tauri/crates/aster-rust/crates/aster/Cargo.toml" execute_prompt_hook_with_provider_should_ --lib --no-default-features` 通过（`2 passed`）
  - `env CARGO_INCREMENTAL=0 RUSTFLAGS="-Cdebuginfo=0" CARGO_TARGET_DIR="/Users/coso/Documents/dev/ai/aiclientproxy/lime/.codex-target" cargo test --manifest-path "src-tauri/crates/aster-rust/crates/aster/Cargo.toml" parse_prompt_hook_response_should_accept_fenced_json --lib --no-default-features` 通过（`1 passed`）
  - `env CARGO_INCREMENTAL=0 RUSTFLAGS="-Cdebuginfo=0" CARGO_TARGET_DIR="/Users/coso/Documents/dev/ai/aiclientproxy/lime/.codex-target" cargo test --manifest-path "src-tauri/crates/aster-rust/crates/aster/Cargo.toml" replace_prompt_hook_arguments_should_append_json_when_no_placeholder --lib --no-default-features` 通过（`1 passed`）
  - 运行时仍会看到工作区既有 `unused import` warning：`task_list_tools.rs`、`worktree_tools.rs`；与本轮 `Agent hook` 改动无关，继续不顺手扩大范围清理。
- 当前最值得继续推进的一刀也已变化：
  - `SessionStart(resume)` 继续明确保留为 gap，不再回头把 queue resume 或前端 `/clear` 硬映射成 session lifecycle resume。
  - 下一刀优先转向 `MCP hook current`，这样 `CCD-008` 剩余 executor placeholder 就只剩一类，而不是继续卡在 `command/url/prompt/agent` 四种里只差一个。

### 继续推进（CCD-008 / MCP hook current）

- 继续沿 `hooks / skills` 主线推进后，`MCP hook` 已从占位实现推进成真实 current 执行，不再只是 `warn! + success(None)`：
  - [types.rs](../../src-tauri/crates/aster-rust/crates/aster/src/hooks/types.rs) 新增 `HookRuntimeContext` 与 `McpHookExecutor`，让 `aster hooks` 可以显式接收宿主 runtime 提供的 MCP dispatcher，而不是在 `aster` crate 里直接耦合 Tauri 层状态。
  - [executor.rs](../../src-tauri/crates/aster-rust/crates/aster/src/hooks/executor.rs) 的 `MCP hook` 现在会真正执行 runtime dispatcher，并在 hook 边界统一处理 timeout / missing-dispatcher；`run_hooks_with_registry(...)`、`UserPromptSubmit` 与 `SessionStart` 也都补了 `*_with_registry_and_context(...)` 入口，避免再把“只能跑无上下文 hook”当成默认前提。
  - [runtime_project_hooks.rs](../../src-tauri/src/commands/aster_agent_cmd/runtime_project_hooks.rs) 新增 Lime current runtime 注入层：执行 `MCP hook` 前会先确保 `Agent` 已初始化，再按现有主链做 `ensure_lime_mcp_servers_running(...) + inject_mcp_extensions(...)`，随后复用当前 [extension_manager.rs](../../src-tauri/crates/aster-rust/crates/aster/src/agents/extension_manager.rs) `dispatch_tool_call(...)` 分发真实 `mcp__<server>__<tool>` 调用，而不是绕到底层另造一套 MCP lifecycle。
  - 同一层还补了 `CallToolResult -> HookResult` 收口：若 MCP 返回 `structured_content` 或文本 JSON 中带 `{"blocked":true,"message":"..."}`，现在会真实映射到 `HookResult::blocked(...)`；普通文本/structured payload 则回传为 hook output。
  - [runtime_turn.rs](../../src-tauri/src/commands/aster_agent_cmd/runtime_turn.rs) 的 `UserPromptSubmit`，以及 [session_runtime.rs](../../src-tauri/src/commands/aster_agent_cmd/session_runtime.rs) / compact `SessionStart` 入口，现在都会带着 runtime context 跑 project hooks，确保 Lime 当前宿主主路径上的 `MCP hook` 真能命中 current MCP bridge。
- 这一步后的 `CCD-008` 边界进一步收紧为：
  - `current`：`TaskCreated / TaskCompleted` hooks、project-level `UserPromptSubmit`、`SessionStart(startup / compact)`、`command / url / prompt / agent / mcp` hook executor、`SkillTool` prompt/workflow execution。
  - `current gap`：`SessionStart(resume)`、skill frontmatter hooks、plugin hook load/hot reload、更多 event bootstrap、`SkillExecutionMode::Agent`。
  - `compat`：`agent_type / agent_config` 继续只作为 `Agent hook` fallback；没有新增兼容 MCP 路径。
- 这一步服务路线图主目标的关系是：把 `CCD-008` 剩余最后一类明显的 executor placeholder 推成 Lime current，避免扩展体系继续停留在“command/url/prompt/agent 都能真执行，唯独 MCP hook 还是空壳”的断层状态。
- 已执行定向校验：
  - `rustfmt --edition 2021 "src-tauri/crates/aster-rust/crates/aster/src/hooks/types.rs" "src-tauri/crates/aster-rust/crates/aster/src/hooks/executor.rs" "src-tauri/src/commands/aster_agent_cmd/runtime_project_hooks.rs" "src-tauri/src/commands/aster_agent_cmd/runtime_turn.rs" "src-tauri/src/commands/aster_agent_cmd/session_runtime.rs" "src-tauri/src/commands/aster_agent_cmd/command_api/session_api.rs" "src-tauri/src/commands/aster_agent_cmd/command_api.rs" "src-tauri/src/dev_bridge/dispatcher/agent_sessions.rs"` 通过
  - `env CARGO_TARGET_DIR="/Users/coso/Documents/dev/ai/aiclientproxy/lime/.codex-target" cargo test --manifest-path "src-tauri/crates/aster-rust/crates/aster/Cargo.toml" execute_mcp_hook_should_ --lib --no-default-features` 通过（`4 passed`）
  - `env CARGO_TARGET_DIR="/Users/coso/Documents/dev/ai/aiclientproxy/lime/.codex-target" cargo test --manifest-path "src-tauri/Cargo.toml" convert_runtime_mcp_call_result_should_ --lib` 通过（`2 passed`）
  - `env CARGO_TARGET_DIR="/Users/coso/Documents/dev/ai/aiclientproxy/lime/.codex-target" cargo test --manifest-path "src-tauri/Cargo.toml" create_runtime_session_internal_should_run_project_session_start_hooks --lib` 通过（`1 passed`）
- 当前最值得继续推进的一刀也已变化：
  - `SessionStart(resume)` 继续明确保留为 gap，不再回头把 queue resume 或前端 `/clear` 硬映射成 session lifecycle resume。
  - 下一刀优先转向 `SkillExecutionMode::Agent` 或 skill frontmatter hooks，这样 `CCD-008` 剩余差距会进一步集中到 skill/plugin/event bootstrap，而不再混着 executor 空洞。

### 继续推进（CCD-008 / SkillExecutionMode::Agent current）

- 继续对照本地参考运行时 `"/Users/coso/Documents/dev/js/claudecode/src/tools/SkillTool/SkillTool.ts"` 与 `"/Users/coso/Documents/dev/js/claudecode/src/utils/forkedAgent.ts"` 后，确认 `SkillExecutionMode::Agent` 不该再往 `SkillExecutor` 里补一套平行 runtime：
  - upstream 的 forked skill 本质是“先构造 skill content，再起隔离子 agent，上到既有 agent query loop”；
  - 因此 Lime 本轮把 `Agent` skill 的 current 事实源固定到 [`skills/tool.rs`](../../src-tauri/crates/aster-rust/crates/aster/src/skills/tool.rs) + [`agent.rs`](../../src-tauri/crates/aster-rust/crates/aster/src/agents/agent.rs) `Agent.reply(...)` 主链，而不是继续扩 `SkillExecutor`。
- [`skills/tool.rs`](../../src-tauri/crates/aster-rust/crates/aster/src/skills/tool.rs) 现已完成这条收口：
  - `SkillTool.execute_skill(...)` 遇到 `SkillExecutionMode::Agent` 时不再直接报“未实现”，而是进入新的 `execute_agent_skill(...)`。
  - skill prompt 构造已向 upstream 靠拢：会注入 `Base directory for this skill: ...` 头部，并替换 `${CLAUDE_SKILL_DIR}` / `${CLAUDE_SESSION_ID}`；参数仍保持当前最小行为，继续追加 `**ARGUMENTS:** ...`，没有为了统一接口再倒腾一套假命令插值层。
  - provider 解析收回到单一 `resolve_skill_provider(...)`：优先复用当前 session provider；skill 自带 provider 时按绑定名创建或复用同名 provider；`Prompt / Workflow` 继续包进 `SessionLlmProvider`，`Agent` 直接消费真实 `Arc<dyn Provider>`。
  - agent skill 会创建隔离的 `SkillAgentSessionStore` 与临时 `SubAgent` session，并显式把权限模式切到 `AsterMode::Auto`，然后直接复用 `Agent.reply(...)` 执行；这样 skill agent 不会污染正式 session 存储，也不会卡在交互式审批流。
  - `Prompt / Workflow` 继续保持在 `SkillExecutor` current 边界，没有为了“看起来统一”把 agent path 再塞回 executor。
- 这一步后的 `CCD-008` 边界继续收紧为：
  - `current`：`TaskCreated / TaskCompleted` hooks、project-level `UserPromptSubmit`、`SessionStart(startup / compact)`、`command / url / prompt / agent / mcp` hook executor、`SkillTool` prompt/workflow/agent execution。
  - `current gap`：`SessionStart(resume)`、skill frontmatter hooks、plugin hook load/hot reload、更多 event bootstrap，以及 agent skill 的 `allowed_tools` 真实权限收紧目前仍未接入 runtime permission context。
  - `compat / deprecated / dead`：无新增；本轮没有为了“兼容旧 executor”再引入第二套 skill runtime。
- 这一步服务路线图主目标的关系是：把 `CCD-008` 最后一个明显的 skill executor 空洞补到 current，让 Lime 不再停在“hooks 都能真执行，但 agent skill 仍是假实现”的断层状态；下一刀应优先回到 skill/plugin/event bootstrap 缺口，而不是再回头发明 compat 包装层。
- 已执行定向校验：
  - `rustfmt --edition 2021 "src-tauri/crates/aster-rust/crates/aster/src/skills/tool.rs"` 通过
  - `env CARGO_INCREMENTAL=0 RUSTFLAGS="-Cdebuginfo=0" CARGO_TARGET_DIR="/Users/coso/Documents/dev/ai/aiclientproxy/lime/.codex-target" cargo test --manifest-path "src-tauri/crates/aster-rust/crates/aster/Cargo.toml" test_skill_tool_ --lib --no-default-features` 通过（`9 passed`）
  - 运行时仍会看到工作区既有 `unused import` warning：`task_list_tools.rs`、`worktree_tools.rs`；与本轮 `SkillExecutionMode::Agent` 收口无关，继续不顺手扩大范围清理。
