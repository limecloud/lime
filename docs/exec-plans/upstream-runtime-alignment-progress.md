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

### 继续推进（CCD-007 / live-aware local peer registry 收口）

- 在不新增 socket / remote ingress 的前提下，继续把 synthetic local peer surface 从“只有 recent fallback”收成“live-aware current”：
  - [runtime_queue.rs](../../src-tauri/crates/aster-rust/crates/aster/src/session/runtime_queue.rs) 现在新增 `list_live_session_ids()`，会把 runtime queue 的 active session 与 queued session 合并成一份最小 live session 视图，避免 `ListPeers` 再逐个 session 猜测 reachability。
  - [team_tools.rs](../../src-tauri/crates/aster-rust/crates/aster/src/tools/team_tools.rs) 现在会优先返回同一 `working_dir` 下 live 的本机顶层 session；只有 live peers 不足时，才按 `updated_at` 回退到最近 session。因此当前 `ListPeers` 不再只是“历史记录列表”，而是“live-first + recent fallback”的 synthetic local registry。
- 对照本地参考仓库 [`peerAddress.ts`](../../../../js/claudecode/src/utils/peerAddress.ts)、[`SendMessageTool.ts`](../../../../js/claudecode/src/tools/SendMessageTool/SendMessageTool.ts) 与 [`prompt.ts`](../../../../js/claudecode/src/tools/SendMessageTool/prompt.ts) 后，又把 local peer address 语义重新收口了一次：
  - [agent_control.rs](../../src-tauri/crates/aster-rust/crates/aster/src/tools/agent_control.rs) 现在只把显式 `to="uds:<session-id>"` 视为 synthetic local peer address，并仅在这条路径上省略 `summary`、追加 `<cross-session-message from="uds:...">` 包装；不再把 bare local `session_id` 当成 cross-session peer address fallback。
  - [team_tools.rs](../../src-tauri/crates/aster-rust/crates/aster/src/tools/team_tools.rs) 也同步把工具描述钉回“本机会话请使用 `send_to` 里的 `uds:<session-id>` 地址发送，不要把 `agent_id` 当作 peer address”，避免模型继续沿错误 surface 学习。
- 这一步后的边界收紧为：
  - `current`：team peers、live-first 的 synthetic local session peers、显式 `uds:<session-id>` cross-session local dispatch
  - `current gap`：显式 session registry 持久化、真实 UDS ingress、bare local `session_id` peer address fallback、remote `bridge:` peer identity / ingress
  - `compat / deprecated / dead`：无新增；本轮没有引入第二套 local peer 路由
- 这一步服务路线图主目标的关系是：把 `CCD-007` 的最小 local current 从“勉强可用的 recent session fallback”继续收成“live-first 且显式地址面受控”的 current，避免 Lime 在参考运行时明确不存在的 bare session-id 地址面上继续漂移；下一刀若继续推进，应优先判断是否值得把这份 synthetic live registry 升格成显式 session registry / local ingress，而不是直接跨到 `bridge:`。
- `CCD-007` 至此可以视为已完成：当前 misleading peer surface 已全部收掉，Lime 的 `current` 已明确固定为“team peers + live-first synthetic local peers + 显式 `uds:<session-id>` 地址面”；剩余 `session registry / local ingress / remote bridge ingress` 差距若未来需要推进，应另开 transport / host 专题，而不是继续在 `SendMessage / ListPeers` 当前 surface 上做假对齐。

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
  - `npx vitest run "src/components/api-key-provider/ProviderConfigForm.ui.test.tsx" "src/components/settings-v2/general/memory/index.test.tsx"` 通过（`19 passed`）
  - `env CARGO_TARGET_DIR="/Users/coso/Documents/dev/ai/aiclientproxy/lime/.codex-target" cargo check --manifest-path "src-tauri/Cargo.toml" --lib` 通过
  - `env CARGO_TARGET_DIR="/Users/coso/Documents/dev/ai/aiclientproxy/lime/.codex-target" cargo test --manifest-path "src-tauri/Cargo.toml" runtime_file_checkpoint_service::tests:: --lib -- --nocapture` 通过（`3 passed`）
  - `env CARGO_TARGET_DIR="/Users/coso/Documents/dev/ai/aiclientproxy/lime/.codex-target" cargo test --manifest-path "src-tauri/Cargo.toml" should_export_runtime_ --lib -- --nocapture` 通过（`6 passed`）
  - `npm run verify:gui-smoke` 通过（复用现有 headless 环境，`workspace-ready / browser-runtime / site-adapters / agent-service-skill-entry / agent-runtime-tool-surface / agent-runtime-tool-surface-page` 全部通过）
  - `npm run verify:local` 通过
- 当前更高层验证状态：
  - 之前记录里的 `should_export_runtime_` / `SceneAppRunSummary` 阻塞已不再复现；当前仓库中的 `sceneapp` 初始化点已补齐新字段，本轮实际阻塞改为 [claude_custom.rs](../../src-tauri/crates/providers/src/providers/claude_custom.rs) 的 `Default` 实现缺口，现已修复并复测通过
  - 之前记录里的 `verify:local` TypeScript 阻塞也已修复；[ProviderConfigForm.ui.test.tsx](../../src/components/api-key-provider/ProviderConfigForm.ui.test.tsx) 与 [index.tsx](../../src/components/settings-v2/general/memory/index.tsx) 的类型问题不再复现，本轮已重新从统一入口跑通 `npm run verify:local`

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

### 继续推进（CCD-008 / Skill frontmatter hooks current）

- 继续对照本地参考运行时：
  - `"/Users/coso/Documents/dev/js/claudecode/src/skills/loadSkillsDir.ts"`
  - `"/Users/coso/Documents/dev/js/claudecode/src/utils/processUserInput/processSlashCommand.tsx"`
  - `"/Users/coso/Documents/dev/js/claudecode/src/utils/hooks/registerSkillHooks.ts"`
  - `"/Users/coso/Documents/dev/js/claudecode/src/utils/hooks/sessionHooks.ts"`
  后确认 `skill frontmatter hooks` 也不该再额外造一套 skill-specific hook executor；upstream 的事实源本质是“skill 加载出 hooks，slash command 执行时注册到 session-scoped hook store，真正执行仍走统一 hooks runtime”。因此 Lime 本轮继续把事实源收口到现有 `HookConfig + run_hooks_with_registry_and_context(...)` 主链，而不是给 skill hooks 再补平行 runtime。
- [`hooks/types.rs`](../../src-tauri/crates/aster-rust/crates/aster/src/hooks/types.rs) 与 [`skills/types.rs`](../../src-tauri/crates/aster-rust/crates/aster/src/skills/types.rs) 现已补齐 current 类型面：
  - `SkillFrontmatter` / `SkillDefinition` 新增 `hooks`
  - `FrontmatterHooks = event -> matcher[] -> hooks[]`
  - `command / prompt / agent / http(url alias)` 会在注册阶段转换成 Lime 当前 `HookConfig`
  - `timeout` 按 upstream 秒制收口到当前毫秒制
  - `once` 进入注册语义，而不是留在前端假字段
- 为了避免假兼容，当前没有真实 runtime 语义的字段继续显式拒绝，而不是静默吞掉：
  - `hook.if`
  - `command.asyncRewake`
  - `command.shell != bash`
  - `http.allowedEnvVars`
  这些字段现在会在注册阶段返回明确错误，并通过 `SkillTool` warning 暴露，不会伪装成“已支持”。
- [`hooks/registry.rs`](../../src-tauri/crates/aster-rust/crates/aster/src/hooks/registry.rs) 新增 `SessionHookStore`，把 skill frontmatter hooks 收口到 session-scoped current store：
  - 每条注册项都有唯一 `entry.id`
  - `once` hook 成功后按 entry 级别删除，避免重复注册后一删全删
  - `clear_hooks()` 与 `run_session_end_hooks(...)` 都会清掉当前 session hooks
- [`hooks/executor.rs`](../../src-tauri/crates/aster-rust/crates/aster/src/hooks/executor.rs) 现已在统一 hooks runtime 中合并 session hooks：
  - 先跑 registry hooks，再按 `input.session_id` 合并 session hooks
  - `once` 仅在 hook 成功后移除
  - 没有为了接 skill hooks 把执行逻辑分叉成第二条路径
- [`skills/loader.rs`](../../src-tauri/crates/aster-rust/crates/aster/src/skills/loader.rs) 与 [`skills/tool.rs`](../../src-tauri/crates/aster-rust/crates/aster/src/skills/tool.rs) 现已把这条链真正接到 Skill current 主入口：
  - loader 会把 `SKILL.md` frontmatter 里的 `hooks` 读进 `SkillDefinition`
  - `SkillTool.execute_skill(...)` 会在 skill 真正执行前，把 frontmatter hooks 注册到当前 session
  - 若当前调用缺少 `session_id`，只会 warning 并跳过注册；不会为了“看起来兼容”偷偷落回全局共享 registry
- 宿主主路径也已补了回归证明这条链真的接进 Lime runtime，而不只是 crate 内部自测：
  - [`runtime_project_hooks.rs`](../../src-tauri/src/commands/aster_agent_cmd/runtime_project_hooks.rs) 新增定向测试，证明 `run_runtime_session_start_project_hooks_for_session(...)` 执行 `SessionStart(compact)` 时，会同时命中当前 session 的 skill hooks
- 这一步后的 `CCD-008` 边界继续收紧为：
  - `current`：`TaskCreated / TaskCompleted` hooks、project-level `UserPromptSubmit`、`SessionStart(startup / compact)`、`command / url / prompt / agent / mcp` hook executor、`SkillTool` prompt/workflow/agent execution、skill frontmatter hooks
  - `current gap`：agent frontmatter hooks 及其 `Stop -> SubagentStop` 事件改写、`SessionStart(resume)`、plugin hook load/hot reload、更多 event bootstrap、agent skill 的 `allowed_tools` 真实权限收紧
  - `explicitly unsupported gap`：`hook.if`、`asyncRewake`、非 `bash` shell、`allowedEnvVars`
  - `compat / deprecated / dead`：无新增；本轮没有为了接 skill hooks 再造 compat executor 或回退到全局共享状态
- 这一步服务路线图主目标的关系是：把 `CCD-008` 里“skill frontmatter hooks 只是 schema 存在、runtime 仍空着”这一块推进到 Lime current，避免扩展体系继续停在“project hooks 能执行、agent skill 能执行，但 skill 自己声明的 hooks 仍完全不生效”的断层状态。
- 已执行定向校验：
  - `rustfmt --edition 2021 "src-tauri/crates/aster-rust/crates/aster/src/hooks/types.rs" "src-tauri/crates/aster-rust/crates/aster/src/hooks/registry.rs" "src-tauri/crates/aster-rust/crates/aster/src/hooks/executor.rs" "src-tauri/crates/aster-rust/crates/aster/src/skills/loader.rs" "src-tauri/crates/aster-rust/crates/aster/src/skills/tool.rs" "src-tauri/crates/aster-rust/crates/aster/src/hooks/tests.rs" "src-tauri/src/commands/aster_agent_cmd/runtime_project_hooks.rs"` 通过
  - `env CARGO_TARGET_DIR="/Users/coso/Documents/dev/ai/aiclientproxy/lime/.codex-target-2" cargo test --manifest-path "src-tauri/crates/aster-rust/crates/aster/Cargo.toml" frontmatter --lib --no-default-features` 通过（`26 passed`）
  - `env CARGO_TARGET_DIR="/Users/coso/Documents/dev/ai/aiclientproxy/lime/.codex-target-2" cargo test --manifest-path "src-tauri/Cargo.toml" run_runtime_session_start_project_hooks_for_session_should_merge_session_skill_hooks --lib` 通过（`1 passed`）
- 下一刀最值得继续推进的是：
  - 先补 agent frontmatter hooks，并按 upstream 明确把 `Stop` 重写为 `SubagentStop`
  - 然后再处理 agent skill `allowed_tools` 的真实权限上下文
  - `plugin hooks / hot reload` 继续留在下一梯队，不建议与前两刀同轮并摊

### 继续推进（CCD-008 / Agent skill allowed_tools current）

- 继续对照本地参考运行时：
  - `"/Users/coso/Documents/dev/js/claudecode/src/tools/AgentTool/runAgent.ts"`
  - `"/Users/coso/Documents/dev/js/claudecode/src/tools/AgentTool/loadAgentsDir.ts"`
  - `"/Users/coso/Documents/dev/js/claudecode/src/utils/hooks/registerFrontmatterHooks.ts"`
  后确认 agent skill 的 `allowed_tools / disallowed_tools` 也不该再额外造一套 agent-specific permission 容器；upstream 的事实源本质是“agent surface 接收 tool scope，再把它下沉到当前 session 权限规则”。因此 Lime 本轮继续把事实源收口到现有 `ToolPermissionManager + PermissionScope::Session` 主链，而不是为了迁就旧实现再补一层 compat 包装。
- [`dto.rs`](../../src-tauri/src/commands/aster_agent_cmd/dto.rs)、[`types.ts`](../../src/lib/api/agentRuntime/types.ts)、[`tool_runtime/subagent_tools.rs`](../../src-tauri/src/commands/aster_agent_cmd/tool_runtime/subagent_tools.rs) 与 [`agent_control.rs`](../../src-tauri/crates/aster-rust/crates/aster/src/tools/agent_control.rs) 现已补齐 current 输入面：
  - `AgentRuntimeSpawnSubagentRequest` 新增 `allowed_tools / disallowed_tools`
  - `SpawnAgentRequest` 同步承载同名字段
  - callback-backed `Agent` current surface 也会把这两组字段带入 runtime，而不是只在 prompt 或 metadata 里做展示
- [`subagent_profiles.rs`](../../src-tauri/crates/agent/src/subagent_profiles.rs)、[`session_store.rs`](../../src-tauri/crates/agent/src/session_store.rs) 与 [`subagent_runtime.rs`](../../src-tauri/src/commands/aster_agent_cmd/subagent_runtime.rs) 现已把这组 tool scope 收进 subagent current 持久化主链：
  - `SubagentCustomizationState` 新增 `allowed_tools / disallowed_tools`
  - `build_subagent_customization_state(...)` 会做去空、去重、归一化
  - subagent system prompt 会显式渲染 `Allowed Tools` 与 `Disallowed Tools`
  - spawn / send_input 进入子会话时，这两组字段都会写入 `request.metadata.subagent`
- [`tool_runtime.rs`](../../src-tauri/src/commands/aster_agent_cmd/tool_runtime.rs) 现已把 metadata 里的 tool scope 真正转成 session-scoped runtime 权限，而不是停留在“前端传了、后端知道、执行时没用”的假支持：
  - 新增 `append_subagent_tool_scope_session_permissions(...)`
  - 若存在 `allowed_tools`，先写一条 `tool="*"` 的 session-scoped deny，优先级 `1298`
  - 再为每个 allow 工具写入 session-scoped allow，优先级 `1299`
  - 最后为每个 disallow 工具写入 session-scoped deny，优先级 `1300`
  - 这样保持“白名单默认收紧，黑名单高于白名单，并且只作用于当前 child session”
- [`agent.rs`](../../src-tauri/crates/aster-rust/crates/aster/src/agents/agent.rs) 与 [`subagent_tool.rs`](../../src-tauri/crates/aster-rust/crates/aster/src/agents/subagent_tool.rs) 继续把 current/非 current 边界收紧：
  - current callback-backed `Agent` surface 只要携带 `allowed_tools / disallowed_tools`，就强制走 callback-backed runtime，不再悄悄退回旧的 foreground native subagent path
  - 非 callback-backed runtime 若传这两项，会显式报错 `allowed_tools is only supported in callback-backed runtimes` / `disallowed_tools is only supported in callback-backed runtimes`
  - 也就是说，本轮没有为了“看起来兼容”把不生效的字段继续吞掉
- 这一步后的 `CCD-008` 边界继续收紧为：
  - `current`：`TaskCreated / TaskCompleted` hooks、project-level `UserPromptSubmit`、`SessionStart(startup / compact)`、`command / url / prompt / agent / mcp` hook executor、`SkillTool` prompt/workflow/agent execution、skill frontmatter hooks、agent skill `allowed_tools / disallowed_tools` session permission 收口
  - `current gap`：agent frontmatter hooks 及其 `Stop -> SubagentStop` 事件改写、`SessionStart(resume)`、plugin hook load/hot reload、更多 event bootstrap
  - `explicitly unsupported gap`：`hook.if`、`asyncRewake`、非 `bash` shell、`allowedEnvVars`
  - `compat / deprecated / dead`：无新增；本轮没有为了 agent tool scope 再引入第二套 subagent 权限容器，也没有把旧 foreground path 包装成“看起来支持”
- 这一步服务路线图主目标的关系是：把 `CCD-008` 里“agent skill 看起来能声明工具白名单，但 runtime 实际不会收紧权限”的最后一段假对齐推进到 Lime current，避免扩展体系继续停在“schema 有字段、system prompt 有文案、真实执行权限仍没变”的断层状态。
- 已执行定向校验：
  - `rustfmt --edition 2021 "src-tauri/crates/aster-rust/crates/aster/src/agents/subagent_tool.rs"` 通过
  - `env CARGO_TARGET_DIR="/Users/coso/Documents/dev/ai/aiclientproxy/lime/.codex-target-subagent-runtime" cargo test --manifest-path "src-tauri/Cargo.toml" test_append_subagent_tool_scope_session_permissions_enforces_child_session_scope --lib` 通过（`1 passed`）
  - `env CARGO_TARGET_DIR="/Users/coso/Documents/dev/ai/aiclientproxy/lime/.codex-target-aster-subagent" cargo test --manifest-path "src-tauri/crates/aster-rust/crates/aster/Cargo.toml" test_agent_tool_routes_tool_scope_through_callbacks --lib --no-default-features` 通过（`1 passed`）
  - `env CARGO_TARGET_DIR="/Users/coso/Documents/dev/ai/aiclientproxy/lime/.codex-target-lime-agent" cargo test --manifest-path "src-tauri/crates/agent/Cargo.toml" build_child_subagent_session_summary_should_merge_customization_state --lib` 通过（`1 passed`）
  - `env CARGO_TARGET_DIR="/Users/coso/Documents/dev/ai/aiclientproxy/lime/.codex-target-subagent-runtime" cargo test --manifest-path "src-tauri/Cargo.toml" spawn_subagent_request_should_parse_current_fields --lib` 通过（`1 passed`）
  - `env CARGO_TARGET_DIR="/Users/coso/Documents/dev/ai/aiclientproxy/lime/.codex-target-subagent-runtime" cargo test --manifest-path "src-tauri/Cargo.toml" test_build_subagent_customization_system_prompt_renders_builtin_configuration --lib` 通过（`1 passed`）
- 下一刀最值得继续推进的是：
  - 先补 agent frontmatter hooks，并按 upstream 明确把 `Stop` 重写为 `SubagentStop`
  - 再决定 `SessionStart(resume)` 是否存在真实 current 入口；若没有，就不要硬映射
  - `plugin hooks / hot reload` 继续留在下一梯队，不建议与前两刀同轮并摊

### 继续推进（CCD-008 / Agent frontmatter hooks current）

- 继续对照本地参考运行时：
  - `"/Users/coso/Documents/dev/js/claudecode/src/tools/AgentTool/runAgent.ts"`
  - `"/Users/coso/Documents/dev/js/claudecode/src/utils/hooks/registerFrontmatterHooks.ts"`
  后确认 agent frontmatter hooks 也不该再额外造一套 agent-specific hook runtime；upstream 的事实源本质是“agent spawn 请求携带 hooks，child session 创建完成后注册到 session-scoped hook store，并在 agent 场景把 `Stop` 改写为 `SubagentStop`”。因此 Lime 本轮继续把事实源收口到现有 `SpawnAgentRequest -> SessionHookStore -> unified hooks executor` 主链，而不是为了迁就旧实现去扩 `.claude/agents`、`loadAgentsDir` 或第二套 hook 容器。
- [`hooks/types.rs`](../../src-tauri/crates/aster-rust/crates/aster/src/hooks/types.rs) 与 [`hooks/registry.rs`](../../src-tauri/crates/aster-rust/crates/aster/src/hooks/registry.rs) 现已补齐 agent frontmatter hooks 的 current 注册能力：
  - frontmatter hook 相关类型补了 `PartialEq / Eq`，确保 `SpawnAgentRequest` 与 `SubagentCustomizationState` 继续能作为 current 状态值稳定比较
  - 新增 `register_agent_session_frontmatter_hooks(...)`
  - `Stop -> SubagentStop` 只在 frontmatter 注册层做事件改写，不把分支散到执行器里
  - 空 matcher / 空 hooks 会在注册前被收掉，不会为了“看起来兼容”留下空壳配置
- [`agent_control.rs`](../../src-tauri/crates/aster-rust/crates/aster/src/tools/agent_control.rs)、[`dto.rs`](../../src-tauri/src/commands/aster_agent_cmd/dto.rs) 与 [`types.ts`](../../src/lib/api/agentRuntime/types.ts) 现已补齐 current 输入面：
  - `SpawnAgentRequest` 新增 `hooks`
  - `AgentRuntimeSpawnSubagentRequest` 新增 `hooks`
  - 前端 runtime 类型同步暴露 `AgentRuntimeFrontmatterHooks`
  - `SpawnAgentTool` 继续显式传 `hooks: None`，没有把这组字段扩成模型自由生成的新工具协议
- [`subagent_profiles.rs`](../../src-tauri/crates/agent/src/subagent_profiles.rs)、[`subagent_runtime.rs`](../../src-tauri/src/commands/aster_agent_cmd/subagent_runtime.rs) 与 [`tool_runtime/subagent_tools.rs`](../../src-tauri/src/commands/aster_agent_cmd/tool_runtime/subagent_tools.rs) 现已把 callback-backed runtime 的 agent hooks 收进 child session current 主链：
  - `SubagentCustomizationState` 新增 `hooks`
  - `build_subagent_customization_state(...)` 会保留并归一化 `request.hooks`
  - callback-backed runtime 转发 spawn request 时会继续透传 `hooks`
  - `create_runtime_subagent_session(...)` 在 child session 初始化完成后调用 `register_runtime_subagent_frontmatter_hooks(...)`
- [`execution/manager.rs`](../../src-tauri/crates/aster-rust/crates/aster/src/execution/manager.rs) 则把 aster 原生 spawn path 一并收口：
  - 新增 `register_spawned_agent_frontmatter_hooks(...)`
  - `spawn_agent_with_runtime(...)` 在 child session 完整创建后注册 hooks
  - 这样 Lime 当前两条真实 child session 创建点都已接上 agent frontmatter hooks，而不是只补 callback-backed 一半
- 这一步后的 `CCD-008` 边界继续收紧为：
  - `current`：`TaskCreated / TaskCompleted` hooks、project-level `UserPromptSubmit`、`SessionStart(startup / compact)`、`command / url / prompt / agent / mcp` hook executor、`SkillTool` prompt/workflow/agent execution、skill frontmatter hooks、agent skill `allowed_tools / disallowed_tools` session permission 收口、agent frontmatter hooks 与 `Stop -> SubagentStop` 注册改写
  - `current gap`：`SessionStart(resume)`、plugin hook load/hot reload、更多 event bootstrap
  - `explicitly unsupported gap`：`hook.if`、`asyncRewake`、非 `bash` shell、`allowedEnvVars`
  - `compat / deprecated / dead`：无新增；本轮没有为了 agent hooks 再发明第二套 agent definition / hook runtime
- 这一步服务路线图主目标的关系是：把 `CCD-008` 里“skill hooks 已 current，但 agent 自己声明的 frontmatter hooks 仍完全不生效”的最后一段 frontmatter 断层推进到 Lime current，避免扩展体系继续停在“project/skill 都会注册 hooks，唯独 subagent surface 仍绕开 hooks”的假对齐状态。
- 已执行定向校验：
  - `env CARGO_TARGET_DIR="/Users/coso/Documents/dev/ai/aiclientproxy/lime/.codex-target-aster-subagent" cargo test --manifest-path "src-tauri/crates/aster-rust/crates/aster/Cargo.toml" test_agent_frontmatter_hooks_rewrite_stop_to_subagent_stop --lib --no-default-features` 通过（`1 passed`）
  - `env CARGO_TARGET_DIR="/Users/coso/Documents/dev/ai/aiclientproxy/lime/.codex-target-aster-subagent" cargo test --manifest-path "src-tauri/crates/aster-rust/crates/aster/Cargo.toml" test_spawned_named_agent_registers_name_route_for_parent_session --lib --no-default-features` 通过（`1 passed`）
  - `env CARGO_TARGET_DIR="/Users/coso/Documents/dev/ai/aiclientproxy/lime/.codex-target-subagent-runtime" cargo test --manifest-path "src-tauri/Cargo.toml" spawn_subagent_request_should_parse_current_fields --lib` 通过（`1 passed`）
  - `env CARGO_TARGET_DIR="/Users/coso/Documents/dev/ai/aiclientproxy/lime/.codex-target-subagent-runtime" cargo test --manifest-path "src-tauri/Cargo.toml" test_build_subagent_customization_state_keeps_frontmatter_hooks --lib` 通过（`1 passed`）
  - `env CARGO_TARGET_DIR="/Users/coso/Documents/dev/ai/aiclientproxy/lime/.codex-target-subagent-runtime" cargo test --manifest-path "src-tauri/Cargo.toml" test_register_runtime_subagent_frontmatter_hooks_rewrites_stop_event --lib` 通过（`1 passed`）
  - `env CARGO_TARGET_DIR="/Users/coso/Documents/dev/ai/aiclientproxy/lime/.codex-target-lime-agent" cargo test --manifest-path "src-tauri/crates/agent/Cargo.toml" build_child_subagent_session_summary_should_merge_customization_state --lib` 通过（`1 passed`）
  - `npm run test:contracts` 通过
- 下一刀最值得继续推进的是：
  - 先判断 `SessionStart(resume)` 是否存在真实 current 宿主入口；若没有，就明确留作 gap，不再反复犹豫
  - 然后转向 `plugin hooks / hot reload`
  - 更多 event bootstrap 继续按真实宿主入口逐条推进，不建议为了“枚举对齐”先补假调用点

### 继续推进（CCD-008 / Plugin hooks current）

- 继续对照本地参考运行时：
  - `"/Users/coso/Documents/dev/js/claudecode/src/utils/plugins/loadPluginHooks.ts"`
  - `"/Users/coso/Documents/dev/js/claudecode/src/utils/sessionStart.ts"`
  后确认 Lime 这一刀不该把旧 `PluginInstaller / plugin_cmd.rs` 再抬成 runtime hook 事实源；upstream 的真实主链是“enabled plugin settings + plugin cache -> hooks merge -> SessionStart/UserPromptSubmit bootstrap”。因此本轮继续把事实源收口到 `runtime_project_hooks.rs -> HookRegistry` 当前主链，而不是为了迁就旧实现再补第二套 plugin hook executor。
- [`runtime_project_hooks.rs`](../../src-tauri/src/commands/aster_agent_cmd/runtime_project_hooks.rs) 现已把 plugin hooks 接进当前 runtime registry：
  - `load_runtime_project_hook_registry(...)` 现会在装载 project hooks 后继续合并 enabled plugin cache hooks
  - enabled plugin 读取链先按 `~/.claude/settings.json -> ~/.claude/settings.local.json -> <workspace>/.claude/settings.json -> <workspace>/.claude/settings.local.json` 覆盖收口
  - 插件目录只认 `~/.claude/plugins/cache/<marketplace>/<plugin>/<best-version>/` current cache，不再把 Lime 自己的 installer 目录包装成“看起来也能跑”的 compat 主链
  - hook 装载支持标准 `hooks/hooks.json` 与 `.claude-plugin/plugin.json` 里的 `manifest.hooks`，包括 path / inline / array 三种 upstream 当前形态
  - runtime registry 每次 `SessionStart` / `UserPromptSubmit` 入口都会重新构建，因此已支持的 plugin hook 变更会在下一次 runtime 入口自然生效，不再额外发明 watcher 或第二层缓存失效协议
- 这一步同时把 `SessionStart(resume)` 的结论显式钉住：
  - Lime 当前公开的 [`agent_runtime_resume_thread`](../../src-tauri/src/commands/aster_agent_cmd/command_api/runtime_api.rs) 仍只是恢复排队线程执行，不是 Claude Code 那种明确的 session lifecycle resume
  - 因此 `SessionStart(resume)` 继续保留为 `current gap`，本轮没有把 queue resume 或前端本地清空动作硬包装成假宿主入口
- 新增定向测试已经把两条 plugin hook current 路径锚住：
  - 标准 `hooks/hooks.json` 插件 hook 会进入 `SessionStart` current registry，并真实执行
  - `.claude-plugin/plugin.json` 里的 inline `manifest.hooks` 会进入 `UserPromptSubmit` current registry，并能真实阻止提交
- 这一步后的 `CCD-008` 边界继续收紧为：
  - `current`：`TaskCreated / TaskCompleted` hooks、project-level `UserPromptSubmit`、`SessionStart(startup / compact)`、`command / url / prompt / agent / mcp` hook executor、`SkillTool` prompt/workflow/agent execution、skill frontmatter hooks、agent frontmatter hooks、plugin hooks（runtime `SessionStart / UserPromptSubmit` current surfaces）
  - `current gap`：`SessionStart(resume)`、更多 runtime event bootstrap、plugin hook 与 upstream managed policy / builtin plugin 加载链的完全同构仍未补齐
  - `explicitly unsupported gap`：`hook.if`、`asyncRewake`、非 `bash` shell、`allowedEnvVars`
  - `compat / deprecated / dead`：无新增；本轮没有为了 plugin hooks 再接 `PluginInstaller` 目录、也没有发明第二套 plugin hook runtime
- 这一步服务路线图主目标的关系是：把 `CCD-008` 里“project/skill/agent hooks 都已 current，但 plugin 自带 hooks 仍完全绕过 runtime”的最后一段 plugin 断层推进到 Lime current，避免扩展体系继续停在“插件只会带技能，不会真正带 runtime hooks”的假对齐状态。
- 已执行定向校验：
  - `cargo fmt --manifest-path "src-tauri/Cargo.toml" --all`
  - `cargo check --manifest-path "src-tauri/Cargo.toml" -p lime --tests` 通过
  - `cargo test --manifest-path "src-tauri/Cargo.toml" -p lime --lib load_runtime_project_hook_registry_should_include_` 通过（`2 passed`）
  - `cargo test --manifest-path "src-tauri/Cargo.toml" -p lime --lib runtime_project_hooks::tests::` 通过（`7 passed`）
- 下一刀最值得继续推进的是：
  - 继续保持 `SessionStart(resume)` 为显式 gap，不再来回犹豫
  - 然后按真实宿主入口继续补更多 runtime event bootstrap，而不是为了枚举对齐先补假调用点
  - 如果要追平 plugin loader 语义，再单独评估 managed policy / builtin plugin hooks 是否也要并入当前 Rust runtime，而不是把旧 installer 重新接回来

### 继续推进（CCD-008 / PreCompact hooks current）

- 继续对照本地参考运行时：
  - `"/Users/coso/Documents/dev/js/claudecode/src/services/compact/compact.ts"`
  - `"/Users/coso/Documents/dev/js/claudecode/src/utils/hooks.ts"`
  后确认这一步最适合继续补的是 `PreCompact`，而不是为了追枚举先去硬造 `Stop / SessionEnd / PermissionRequest` 宿主入口。Lime 当前唯一干净、单一的压缩宿主入口就是 [`compact_runtime_session_with_trigger(...)`](../../src-tauri/src/commands/aster_agent_cmd/runtime_turn.rs)，因此本轮继续把事实源收口到 `runtime_turn -> runtime_project_hooks -> HookRegistry` 当前主链，不去扩第二套 lifecycle runtime。
- [`executor.rs`](../../src-tauri/crates/aster-rust/crates/aster/src/hooks/executor.rs) 现已补齐 `PreCompact` 的 registry-aware current 执行入口：
  - 新增 `run_pre_compact_hooks_with_registry(...)`
  - 新增 `run_pre_compact_hooks_with_registry_and_context(...)`
  - 现有 `run_pre_compact_hooks(...)` 只负责委托到 registry-aware helper，不再把 `PreCompact` 隐式绑死在全局注册表上
- [`runtime_project_hooks.rs`](../../src-tauri/src/commands/aster_agent_cmd/runtime_project_hooks.rs) 现已补齐 `PreCompact` 的 per-workspace runtime helper：
  - 新增 `enforce_runtime_pre_compact_project_hooks_with_runtime(...)`
  - 新增 `enforce_runtime_pre_compact_project_hooks_for_session_with_runtime(...)`
  - helper 会继续复用现有 `resolve_runtime_project_hook_workspace_root(...)`，因此 `workspace_id -> workspace_root` 与 `working_dir fallback` 仍保持单一事实源，不会为了压缩前 hooks 再散出一套 project root 猜测逻辑
  - hook 结果继续经过 `log_runtime_project_hook_results(...)`；失败型 hooks 只记 warning，真正 `blocked` 才会中断压缩
- [`runtime_turn.rs`](../../src-tauri/src/commands/aster_agent_cmd/runtime_turn.rs) 现已把 `PreCompact` 真正接到 runtime 宿主入口：
  - `compact_runtime_session_with_trigger(...)` 会在读取到可压缩 conversation 之后、真正创建 compaction turn 之前，先运行 project/plugin/session 的 `PreCompact`
  - `manual / auto` 两种压缩统一映射到 `CompactTrigger::Manual / Auto`，不再只有手动 `/compact` 才经过 hooks
  - `current_tokens` 会优先使用 session 上的 `total_tokens`，缺失时再回退 `TokenEstimator::estimate_total_tokens(conversation.messages())`，避免把 `PreCompact` 输入继续留成空壳
  - 若 `PreCompact` 返回 `blocked`，手动压缩会直接失败；自动压缩则继续复用现有降级策略，由 `maybe_auto_compact_runtime_session_before_turn(...)` 把失败转成 warning 并继续当前 turn
- 这一步同时也把“当前不该补什么”钉得更清楚：
  - `SessionStart(resume)` 仍然继续保留为 gap，本轮没有回头把 queue resume 伪装成 session lifecycle
  - `Stop / SessionEnd / PermissionRequest` 仍待先确认 Lime 是否存在单一、可接受的 current 宿主入口；本轮没有为了枚举对齐先补假调用点
- 新增定向测试已经把 `PreCompact` current 路径锚住：
  - `PreCompact` hook 会收到真实 `event / trigger / current_tokens / session_id`
  - 阻塞型 `PreCompact` hook 会真实中断压缩，而不是只打日志继续往下执行
- 这一步后的 `CCD-008` 边界继续收紧为：
  - `current`：`TaskCreated / TaskCompleted` hooks、project-level `UserPromptSubmit`、`SessionStart(startup / compact)`、`PreCompact`、`command / url / prompt / agent / mcp` hook executor、`SkillTool` prompt/workflow/agent execution、skill frontmatter hooks、agent frontmatter hooks、plugin hooks（runtime `SessionStart / UserPromptSubmit / PreCompact` current surfaces）
  - `current gap`：`SessionStart(resume)`、`Stop / SessionEnd / PermissionRequest` 等更多 runtime event bootstrap、plugin hook 与 upstream managed policy / builtin plugin 加载链的完全同构仍未补齐
  - `explicitly unsupported gap`：`hook.if`、`asyncRewake`、非 `bash` shell、`allowedEnvVars`
  - `compat / deprecated / dead`：无新增；本轮没有为了 `PreCompact` 再发明第二套 compaction lifecycle runtime
- 这一步服务路线图主目标的关系是：把参考运行时图里“压缩前也会经过 hooks”这条 extension 主链补进 Lime current，避免扩展体系继续停在“SessionStart / UserPromptSubmit 已 current，但 compaction 仍完全绕过 hooks”的断层状态。
- 已执行定向校验：
  - `rustfmt --edition 2021 "src-tauri/crates/aster-rust/crates/aster/src/hooks/executor.rs" "src-tauri/src/commands/aster_agent_cmd/runtime_project_hooks.rs" "src-tauri/src/commands/aster_agent_cmd/runtime_turn.rs"` 通过
  - `cargo test --manifest-path "src-tauri/Cargo.toml" -p lime --lib enforce_runtime_pre_compact_project_hooks_for_session_should_` 通过（`2 passed`）
  - `cargo test --manifest-path "src-tauri/Cargo.toml" -p lime --lib runtime_project_hooks::tests::` 通过（`9 passed`）
  - `cargo check --manifest-path "src-tauri/Cargo.toml" -p lime --tests` 通过（仅剩工作区既有 warning：`crates/services/src/api_key_provider_service.rs` 的 `selected_key` 未使用）
- 下一刀最值得继续推进的是：
  - 继续保持 `SessionStart(resume)` 为显式 gap，不再来回犹豫
  - 优先核定 `Stop / SessionEnd / PermissionRequest` 哪一条在 Lime 里已有单一 current 宿主入口，再补下一类 event bootstrap
  - 如果要追平 plugin loader 语义，再单独评估 managed policy / builtin plugin hooks 是否也要并入当前 Rust runtime，而不是把旧 installer 重新接回来

### 继续推进（CCD-008 / PermissionRequest hooks current）

- 继续对照本地参考运行时：
  - `"/Users/coso/Documents/dev/js/claudecode/src/utils/hooks.ts"`
  - `"/Users/coso/Documents/dev/js/claudecode/src/utils/permissions/permissions.ts"`
  - `"/Users/coso/Documents/dev/js/claudecode/src/hooks/toolPermission/PermissionContext.ts"`
  - `"/Users/coso/Documents/dev/js/claudecode/src/cli/structuredIO.ts"`
  后确认这一步最需要补的不是再去给 `ToolRegistry` 造一层 callback 兼容壳，而是把 `PermissionRequest` 直接接到 Lime 当前真实 approval host：[`handle_approval_tool_requests(...)`](../../src-tauri/crates/aster-rust/crates/aster/src/agents/tool_execution.rs)。因此本轮继续把事实源收口到 `runtime_turn -> agent permission_request_hook_handler -> tool_execution approval host -> runtime_project_hooks -> HookRegistry` 当前主链，不去扩第二套 permission runtime。
- [`types.rs`](../../src-tauri/crates/aster-rust/crates/aster/src/agents/types.rs)、[`mod.rs`](../../src-tauri/crates/aster-rust/crates/aster/src/agents/mod.rs) 与 [`agent.rs`](../../src-tauri/crates/aster-rust/crates/aster/src/agents/agent.rs) 现已补齐 `PermissionRequest` 当前宿主注入面：
  - 新增 `PermissionRequestHookContext / PermissionRequestHookDecision / PermissionRequestHookHandler`
  - `Agent` 新增 `permission_request_hook_handler` 字段与 `set_permission_request_hook_handler(...)`
  - handler 默认仍为 `None`，避免把 hooks 语义硬塞进所有 runtime；只有 Lime current 宿主入口会显式安装它
- [`tool_execution.rs`](../../src-tauri/crates/aster-rust/crates/aster/src/agents/tool_execution.rs) 现已把 `PermissionRequest` 接进真实 approval host：
  - `handle_approval_tool_requests(...)` 会在发出 `action_required` 之前，先执行 `run_permission_request_hook_handler(...)`
  - hook 返回 `Allow` 时会直接 `dispatch_tool_call(...)`，不再继续发人工审批
  - hook 返回 `Deny { message }` 时会直接把错误 `CallToolResult` 写回 response message，不再继续发人工审批
  - hook 执行失败时只记 warning，并显式回退到现有人工审批链，不会因为 hook 出错把当前 permission path 打断
  - `permission_mode` 当前只做保守映射：`Approve / SmartApprove -> default`、`Auto -> bypassPermissions`、`Chat -> None`；本轮没有为了追平文本枚举去硬塞 `plan / dontAsk`
- [`runtime_turn.rs`](../../src-tauri/src/commands/aster_agent_cmd/runtime_turn.rs) 与 [`runtime_project_hooks.rs`](../../src-tauri/src/commands/aster_agent_cmd/runtime_project_hooks.rs) 现已补齐 `PermissionRequest` 的 current 宿主对接：
  - `prepare_runtime_turn_entry(...)` 会安装 `PermissionRequestHookHandler`
  - handler closure 继续只捕获当前 single-source runtime 依赖：`db + AsterAgentState + McpManagerState`
  - `decide_runtime_permission_request_project_hooks_for_session_with_runtime(...)` 继续复用 `resolve_runtime_project_hook_workspace_root(...)` 与同一条 project/plugin/session hook registry 主链，不为 `PermissionRequest` 再散一套 project root / plugin loader 旁路
  - 当前 hook JSON 决策只支持：
    - `{"decision":"allow"}`
    - `{"decision":"deny","message":"..."}`
- [`hooks/types.rs`](../../src-tauri/crates/aster-rust/crates/aster/src/hooks/types.rs) 与 [`hooks/executor.rs`](../../src-tauri/crates/aster-rust/crates/aster/src/hooks/executor.rs) 现已把 `permission_mode` 接进现有 hook 输入与执行环境：
  - `HookInput` 新增 `permission_mode`
  - command hook 环境变量新增 `CLAUDE_HOOK_PERMISSION_MODE`
  - command 占位符新增 `$PERMISSION_MODE`
  - url hook payload 也会继续透传 `permissionMode`
- 这一步同时也把“当前不该假装完成什么”钉得更清楚：
  - `SessionStart(resume)` 仍然继续保留为 gap，本轮没有回头把 queue resume 伪装成 session lifecycle
  - `Stop / SessionEnd` 仍待先确认 Lime 是否存在单一、可接受的 current 宿主入口；本轮没有为了补齐 event 名字先补假调用点
  - upstream `PermissionRequestResult` 里的 `updatedInput / updatedPermissions / interrupt` 仍未实现；本轮只先补最小 current allow/deny 决策，不为迁就旧逻辑去拼半套兼容协议
  - plugin hook 与 upstream managed policy / builtin plugin 加载链的完全同构仍未补齐
- 新增定向测试已经把 `PermissionRequest` current 路径锚住：
  - project hook 会收到真实 `event / permission_mode / tool_use_id / session_id`
  - `allow / deny(message)` 两条 decision path 都已落到 runtime helper 定向测试
  - approval host 侧已补 `auto-allow / auto-deny` 两条 end-to-end 单测，防止之后又回流成 `action_required`
- 这一步后的 `CCD-008` 边界继续收紧为：
  - `current`：`TaskCreated / TaskCompleted` hooks、project-level `UserPromptSubmit`、`SessionStart(startup / compact)`、`PreCompact`、`PermissionRequest`、`command / url / prompt / agent / mcp` hook executor、`SkillTool` prompt/workflow/agent execution、skill frontmatter hooks、agent frontmatter hooks、plugin hooks（runtime `SessionStart / UserPromptSubmit / PreCompact / PermissionRequest` current surfaces）
  - `current gap`：`SessionStart(resume)`、`Stop / SessionEnd` 等更多 runtime event bootstrap、`PermissionRequest` richer decision surface（`updatedInput / updatedPermissions / interrupt`）、plugin hook 与 upstream managed policy / builtin plugin 加载链的完全同构仍未补齐
  - `explicitly unsupported gap`：`hook.if`、`asyncRewake`、非 `bash` shell、`allowedEnvVars`
  - `compat / deprecated / dead`：无新增；本轮没有为了 `PermissionRequest` 再发明第二套 approval runtime，也没有把旧 callback 边界重新接回主链
- 这一步服务路线图主目标的关系是：把参考运行时图里“工具审批前也会经过 project/plugin/session PermissionRequest hooks”这条 extension 主链补进 Lime current，避免扩展体系继续停在“PreCompact 已 current，但权限审批仍完全绕过 hooks”的断层状态。
- 已执行定向校验：
  - `cargo test --manifest-path "src-tauri/Cargo.toml" -p lime --lib decide_runtime_permission_request_project_hooks_for_session_should_` 通过（`2 passed`）
  - `cargo test --manifest-path "src-tauri/crates/aster-rust/crates/aster/Cargo.toml" handle_approval_tool_requests_should_auto_ --lib` 通过（`2 passed`；仅剩工作区既有 warning：`task_list_tools.rs / worktree_tools.rs` 的 `SessionManager` 未使用）
  - `cargo check --manifest-path "src-tauri/Cargo.toml" -p lime --tests` 通过（增量复查已确认本轮新增 warning 已收干净）
- 下一刀最值得继续推进的是：
  - 继续保持 `SessionStart(resume)` 为显式 gap，不再来回犹豫
  - 优先核定 `Stop / SessionEnd` 哪一条在 Lime 里已有单一 current 宿主入口，再补下一类 lifecycle event bootstrap
  - 如果要继续追平 `PermissionRequest` 语义，再单独补 `updatedInput / updatedPermissions / interrupt`，不要把这三种 richer decision 混进现有最小 current allow/deny 路径里硬拼
  - 如果要追平 plugin loader 语义，再单独评估 managed policy / builtin plugin hooks 是否也要并入当前 Rust runtime，而不是把旧 installer 重新接回来

### 继续推进（CCD-008 / Stop hooks current）

- 继续对照本地参考运行时：
  - `"/Users/coso/Documents/dev/js/claudecode/src/query.ts"`
  - `"/Users/coso/Documents/dev/js/claudecode/src/query/stopHooks.ts"`
  - `"/Users/coso/Documents/dev/js/claudecode/src/entrypoints/sdk/coreSchemas.ts"`
  后确认这一步最该补的是 `Stop`，而且只能接在 Lime 当前真正的 turn 正常收尾宿主上；因此本轮明确把事实源收口到 [`runtime_turn.rs`](../../src-tauri/src/commands/aster_agent_cmd/runtime_turn.rs) 的 `finalize_runtime_turn_result(...) -> runtime_project_hooks -> HookRegistry` 当前主链，没有把 `agent_runtime_interrupt_turn(...)`、session delete、queue resume 或前端 clear 动作硬包装成假 `Stop / SessionEnd` 入口。
- [`hooks/types.rs`](../../src-tauri/crates/aster-rust/crates/aster/src/hooks/types.rs) 现已把上游 `Stop` 最小输入面补回当前 `HookInput`：
  - 新增 `stop_hook_active`
  - 新增 `last_assistant_message`
  - 这两个字段会继续沿现有 command stdin / url payload JSON 透传，不再要求 hook 自己回读 transcript 才能拿到最后一条 assistant 文本
- [`runtime_project_hooks.rs`](../../src-tauri/src/commands/aster_agent_cmd/runtime_project_hooks.rs) 现已补齐 `Stop` 的 per-workspace runtime helper：
  - 新增 `run_runtime_stop_project_hooks_with_runtime(...)`
  - 新增 `run_runtime_stop_project_hooks_for_session_with_runtime(...)`
  - 测试侧补了 `run_runtime_stop_project_hooks(...) / ...for_session(...)`，继续复用 `resolve_runtime_project_hook_workspace_root(...)` 这条唯一 `workspace_id -> workspace_root / working_dir fallback` 事实源，不为 `Stop` 再散一套项目根目录猜测逻辑
  - hook 结果继续统一走 `log_runtime_project_hook_results("Stop", ...)`，本轮只先收通 current 宿主执行，不把 `preventContinuation` 假装映射成 turn 失败或中断
- [`runtime_turn.rs`](../../src-tauri/src/commands/aster_agent_cmd/runtime_turn.rs) 现已把 `Stop` 真正接到 turn 正常结束宿主：
  - `execute_runtime_stream_attempt(...)` 现在会把最终 `assistant_output` 返回给收尾阶段
  - `finalize_runtime_turn_result(...)` 在成功分支里、发出 `FinalDone` 之前，先运行 project/plugin/session 的 `Stop`
  - 失败分支仍只发 `Error`，不会把 provider error / interrupt / timeout 误记成 `Stop`
  - `stop_hook_active` 当前固定传 `false`；`last_assistant_message` 直接取本回合真实 `assistant_output`
- 这一步同时把“当前不该假装完成什么”钉得更清楚：
  - upstream `Stop` 不是用户手工停止，也不是 `SessionEnd`
  - `SessionStart(resume)` 仍继续保留为 gap，本轮没有回头把 queue resume 伪装成 lifecycle resume
  - `SessionEnd` 仍未接；`clear / shutdown / delete session` 也没有被硬并到 `Stop`
  - upstream `Stop` richer 行为里的 `preventContinuation / stopReason` 当前仍未映射到 Lime runtime turn policy；本轮只先补 current 执行宿主与真实输入面，不做假兼容
- 新增定向测试已经把 `Stop` current 路径锚住：
  - `Stop` hook 会收到真实 `event / session_id / stop_hook_active / last_assistant_message`
  - `runtime_turn` 原有 `UserPromptSubmit` 定向测试继续通过，证明这次签名改动没有把既有 turn hook 主链带坏
- 这一步后的 `CCD-008` 边界继续收紧为：
  - `current`：`TaskCreated / TaskCompleted` hooks、project-level `UserPromptSubmit`、`SessionStart(startup / compact)`、`PreCompact`、`PermissionRequest`、`Stop`、`command / url / prompt / agent / mcp` hook executor、`SkillTool` prompt/workflow/agent execution、skill frontmatter hooks、agent frontmatter hooks、plugin hooks（runtime `SessionStart / UserPromptSubmit / PreCompact / PermissionRequest / Stop` current surfaces）
  - `current gap`：`SessionStart(resume)`、`SessionEnd`、`Stop` richer continuation policy、`PermissionRequest` richer decision surface（`updatedInput / updatedPermissions / interrupt`）、plugin hook 与 upstream managed policy / builtin plugin 加载链的完全同构仍未补齐
  - `explicitly unsupported gap`：`hook.if`、`asyncRewake`、非 `bash` shell、`allowedEnvVars`
  - `compat / deprecated / dead`：无新增；本轮没有为了 `Stop` 再发明第二套 turn-end lifecycle runtime，也没有把 interrupt/delete path 接回 current
- 这一步服务路线图主目标的关系是：把参考运行时图里“每个 query turn 正常结束后会经过 Stop hooks”这条 lifecycle extension 主链补进 Lime current，避免扩展体系继续停在“PermissionRequest 已 current，但 turn 正常收尾仍完全绕过 Stop hooks”的断层状态。
- 已执行定向校验：
  - `rustfmt --edition 2021 "src-tauri/crates/aster-rust/crates/aster/src/hooks/types.rs" "src-tauri/src/commands/aster_agent_cmd/runtime_project_hooks.rs" "src-tauri/src/commands/aster_agent_cmd/runtime_turn.rs"` 通过
  - `cargo test --manifest-path "src-tauri/Cargo.toml" -p lime --lib run_runtime_stop_project_hooks_for_session_should_pass_last_assistant_message_and_flag -- --nocapture` 通过（`1 passed`）
  - `cargo test --manifest-path "src-tauri/Cargo.toml" -p lime --lib enforce_runtime_turn_user_prompt_submit_hooks_should_ -- --nocapture` 通过（`2 passed`）
  - `cargo check --manifest-path "src-tauri/Cargo.toml" -p lime --tests` 通过
- 下一刀最值得继续推进的是：
  - 继续保持 `SessionStart(resume)` 为显式 gap，不再来回犹豫
  - 优先核定 `SessionEnd` 在 Lime 里是否存在单一 current 宿主入口，再继续补 lifecycle event bootstrap
  - 如果要继续追平 `Stop` 语义，再单独设计 `preventContinuation / stopReason` 应该如何落到 Lime 的 auto-continue / turn policy，而不是把它硬塞成通用错误返回

### 继续推进（resume current surface / runtime root 收口）

- 把 Agent Chat 主工作台的 Claude Code 风格 resume 入口接回 current 对话主链：
  - `ChatSidebar` 顶部入口当前已改成“继续最近会话”，并显式提示“上下文已保留”。
  - `EmptyState` 当前也已补出最近会话恢复入口，恢复动作继续复用现有 `handleResumeSidebarTask(...)`，没有再扩第二套 resume 执行路径。
  - `AgentChatWorkspace / WorkspaceConversationScene / useWorkspaceConversationSceneRuntime` 当前已贯通最近会话 topic 的透传与展示，避免 resume 入口只停留在静态文案层。
- 继续把 runtime 主链收回单一事实源，修掉全量 Rust 校验里最后一组 `Aster path root` 初始化分叉：
  - `lime_agent` 的 [aster_runtime_support.rs](../../src-tauri/crates/agent/src/aster_runtime_support.rs) 现在会优先认领上游 `aster` 已初始化的 shared runtime root，再决定是否回退到 Lime 自己的 app path。
  - `aster` 的 [config/paths.rs](../../src-tauri/crates/aster-rust/crates/aster/src/config/paths.rs) 当前补了 `initialized_path_root()` 只读访问器，避免 Lime wrapper 在上游已经锁定 root 后又尝试走默认目录，导致 `OnceLock + PATH_ROOT_OVERRIDE` 分叉。
  - 这一步之后，之前只在全量 `cargo test` 下暴露的 `test_list_current_surface_tool_definitions_includes_agent_tool` / `test_tool_search_bridge_includes_current_surface_agent_tool` 已恢复通过，`ToolSearch current surface` 也不再因为 runtime root 初始化顺序而假失败。
- 本轮校验结果：
  - 前端 resume 定向回归已通过：`agentChatShared / ChatSidebar / EmptyState`
  - `cargo test --manifest-path "src-tauri/Cargo.toml"` 已全绿
  - `npm run verify:local` 已通过，包含 smart Vitest、全量 Rust 与 `verify:gui-smoke`
- 这一步服务主线目标的关系是：
  - 产品层把“继续最近会话”真正放回 current 对话入口，而不是继续依赖旧侧栏语义；
  - 运行时层把 Lime wrapper 与上游 shared runtime root 收回到同一事实源，避免 queue / resume / tool surface 校验继续被初始化顺序噪声干扰。

## 2026-04-21

### 继续推进（CCD-008 / SessionEnd hooks current）

- 继续对照本地参考运行时：
  - `"/Users/coso/Documents/dev/js/claudecode/src/utils/hooks.ts"`
  - `"/Users/coso/Documents/dev/js/claudecode/src/commands/clear/conversation.ts"`
  - `"/Users/coso/Documents/dev/js/claudecode/src/screens/REPL.tsx"`
  - `"/Users/coso/Documents/dev/js/claudecode/src/utils/gracefulShutdown.ts"`
  - `"/Users/coso/Documents/dev/js/claudecode/src/entrypoints/sdk/coreSchemas.ts"`
  后确认这一步最该补的是 `SessionEnd` 的真实 session lifecycle 宿主，而且只能接在 Lime 当前唯一诚实的 session 结束入口上；因此本轮明确把事实源收口到 [`action_runtime.rs`](../../src-tauri/src/commands/aster_agent_cmd/action_runtime.rs) 的 `agent_runtime_delete_session(...) -> runtime_project_hooks -> HookRegistry -> session_runtime` 当前主链，没有把 `agent_runtime_resume_thread(...)`、`agent_runtime_interrupt_turn(...)`、compact 或前端 `/clear` 动作硬包装成假 `SessionEnd` 入口。
- [`executor.rs`](../../src-tauri/crates/aster-rust/crates/aster/src/hooks/executor.rs) 现已补齐 `SessionEnd` 的 registry-aware current 执行入口：
  - 新增 `run_session_end_hooks_with_registry(...)`
  - 新增 `run_session_end_hooks_with_registry_and_context(...)`
  - `SessionEnd` 执行完成后会继续 `clear_session_hooks(session_id)`，避免 session 级 hook 注册在生命周期结束后残留成脏状态
- [`runtime_project_hooks.rs`](../../src-tauri/src/commands/aster_agent_cmd/runtime_project_hooks.rs) 现已补齐 `SessionEnd` 的 per-workspace runtime helper：
  - 新增 `run_runtime_session_end_project_hooks(...)`
  - 新增 `run_runtime_session_end_project_hooks_with_runtime(...)`
  - 新增 `run_runtime_session_end_project_hooks_for_session(...)`
  - 新增 `run_runtime_session_end_project_hooks_for_session_with_runtime(...)`
  - helper 继续复用 `resolve_runtime_project_hook_workspace_root(...)` 这条唯一 `workspace_id -> workspace_root / working_dir fallback` 事实源，不为 `SessionEnd` 再散一套项目根目录猜测逻辑
- [`action_runtime.rs`](../../src-tauri/src/commands/aster_agent_cmd/action_runtime.rs) 与 [`session_runtime.rs`](../../src-tauri/src/commands/aster_agent_cmd/session_runtime.rs) 现已把 `SessionEnd` 真正接到 Lime 当前 session 删除宿主：
  - `agent_runtime_delete_session(...)` 会先 `cancel session`
  - 再 `clear runtime queue`
  - 然后运行 project/plugin/session 的 `SessionEnd`
  - 最后才真正删除 session
  - `SessionEndReason` 当前固定落为 `other`；本轮没有把删除会话伪装成 upstream 的 `clear / prompt_input_exit / logout`
  - 原先零引用的 `delete_runtime_session_internal(...)` 已删除，只保留 `delete_runtime_session_internal_with_runtime(...)` 当前主路径，避免继续保留无 runtime hook 的旧 delete 旁路
- 这一步同时也把“当前不该假装完成什么”钉得更清楚：
  - `SessionStart(resume)` 仍继续保留为 gap，本轮没有回头把 queue resume 伪装成 lifecycle resume
  - `SessionEnd` 当前只接住 `agent_runtime_delete_session -> SessionEnd(other)`；`clear / prompt_input_exit / logout` 仍没有 Lime 当前真实宿主
  - `agent_runtime_interrupt_turn(...)` 仍不是 `Stop`，也不是 `SessionEnd`
  - compact 仍只属于 `SessionStart(compact)` / `PreCompact`，本轮没有把它并进 session 结束语义
- 新增定向测试已经把 `SessionEnd` current 路径锚住：
  - `SessionEnd` hook 会收到真实 `event / session_id / reason=other`
  - session hook 会在 `SessionEnd` 后被真实清掉，不会残留到后续 session 生命周期
- 这一步后的 `CCD-008` 边界继续收紧为：
  - `current`：`TaskCreated / TaskCompleted` hooks、project-level `UserPromptSubmit`、`SessionStart(startup / compact)`、`PreCompact`、`PermissionRequest`、`Stop`、`SessionEnd(other via delete_session)`、`command / url / prompt / agent / mcp` hook executor、`SkillTool` prompt/workflow/agent execution、skill frontmatter hooks、agent frontmatter hooks、plugin hooks（runtime `SessionStart / UserPromptSubmit / PreCompact / PermissionRequest / Stop / SessionEnd` current surfaces）
  - `current gap`：`SessionStart(resume)`、`SessionEnd(clear / prompt_input_exit / logout)`、`Stop` richer continuation policy、`PermissionRequest` richer decision surface（`updatedInput / updatedPermissions / interrupt`）、plugin hook 与 upstream managed policy / builtin plugin 加载链的完全同构仍未补齐
  - `explicitly unsupported gap`：`hook.if`、`asyncRewake`、非 `bash` shell、`allowedEnvVars`
  - `compat / deprecated / dead`：无新增；本轮没有为了 `SessionEnd` 再发明第二套 session lifecycle runtime，也没有把 interrupt / resume / clear path 接回 current
- 这一步服务路线图主目标的关系是：把参考运行时图里“session 生命周期结束时也会经过 hooks”这条 extension 主链补进 Lime current，避免扩展体系继续停在“`Stop` 已 current，但 session delete 仍完全绕过 `SessionEnd` hooks”的断层状态，同时继续把没有真实宿主的 lifecycle 差异显式保留为 gap，而不是做假兼容。
- 已执行定向校验：
  - `cargo test --manifest-path "src-tauri/Cargo.toml" -p lime --lib run_runtime_session_end_project_hooks_for_session_should_pass_reason_and_clear_session_hooks -- --nocapture` 通过（`1 passed`）
  - `cargo check --manifest-path "src-tauri/Cargo.toml" -p lime --tests` 通过
- 下一刀最值得继续推进的是：
  - 继续保持 `SessionStart(resume)` 为显式 gap，不再来回犹豫
  - 优先核定 Lime 当前是否存在真实 `SessionEnd(clear / prompt_input_exit / logout)` 宿主；若没有，就明确保留为产品差异，不做假映射
  - 如果要继续追平 `Stop / PermissionRequest` 语义，再分别单独补 `preventContinuation / stopReason` 与 `updatedInput / updatedPermissions / interrupt`，不要把 richer 行为混进现有最小 current 路径里硬拼

### 继续推进（CCD-008 / SessionEnd lifecycle host audit）

- 继续对照本地参考运行时：
  - `"/Users/coso/Documents/dev/js/claudecode/src/commands/clear/conversation.ts"`
  - `"/Users/coso/Documents/dev/js/claudecode/src/utils/gracefulShutdown.ts"`
  - `"/Users/coso/Documents/dev/js/claudecode/src/screens/REPL.tsx"`
  - `"/Users/coso/Documents/dev/js/claudecode/src/entrypoints/sdk/coreSchemas.ts"`
  后确认 upstream 的 `SessionEnd` 宿主矩阵并不是抽象枚举，而是四类真实 lifecycle：
  - `/clear -> executeSessionEndHooks("clear")`
  - `REPL resume -> executeSessionEndHooks("resume")`
  - `gracefulShutdown -> executeSessionEndHooks("prompt_input_exit" / "logout" / "other")`
  - schema 侧还显式保留 `bypass_permissions_disabled`
- 继续排查 Lime current 宿主后，确认这几类入口目前都不存在等价实现：
  - 仓内没有 Claude Code 那种 `clearConversation(...) + regenerateSessionId(...)` 会话清空并重生的 runtime 生命周期；当前前端删除 topic 只是 [`useAgentSession.ts`](../../src/components/agent/chat/hooks/useAgentSession.ts) 在 `runtime.deleteSession(...)` 后清本地状态，不是 session clear host。
  - 仓内没有 `gracefulShutdown(...)` / `prompt_input_exit` 这类 runtime session 退出宿主；当前 `logout` 相关代码要么是 [`external_tools_cmd.rs`](../../src-tauri/src/commands/external_tools_cmd.rs) 返回 `"codex logout"` 字符串，要么是 [`oemCloudControlPlane.ts`](../../src/lib/api/oemCloudControlPlane.ts) 的 OEM control plane 登出接口，都不是 Aster runtime session lifecycle。
  - 当前公开的 [`agent_runtime_resume_thread`](../../src-tauri/src/commands/aster_agent_cmd/command_api/runtime_api.rs) 仍只是恢复排队线程执行，不是 upstream 那种 session 切换前后的 `SessionEnd(resume) / SessionStart(resume)` 宿主。
- 因此这一轮把 `SessionEnd` 剩余差距进一步钉成显式结论：
  - `current`：只有 `agent_runtime_delete_session -> SessionEnd(other)`
  - `current gap`：`SessionEnd(resume / clear / prompt_input_exit / logout)` 与 `SessionStart(resume)`
  - `product difference until new host exists`：`bypass_permissions_disabled`
  - `not a host`：`open_codex_cli_logout`、OEM cloud `logoutClient(...)`、topic 删除后的前端本地清空
- 这一步服务路线图主目标的关系是：把 `SessionEnd` 剩余 gap 从“还要继续找找看”推进成“已审计确认 Lime 当前没有这些宿主”，后续除非新增真实 current lifecycle host，否则不再围绕 `clear / resume / logout / prompt_input_exit` 反复做假映射判断。
- 下一刀最值得继续推进的是：
  - 继续保持 `SessionStart(resume)` 与 `SessionEnd(resume / clear / prompt_input_exit / logout)` 为显式 gap，不再来回犹豫
  - 后续只有在 Lime 真新增对应 lifecycle host 时，才重新打开这组对齐项
  - 当前主线应回到 richer 语义差距：`Stop` 的 `preventContinuation / stopReason` 与 `PermissionRequest` 的 `updatedInput / updatedPermissions / interrupt`

### 继续推进（CCD-008 / PermissionRequest updatedInput current）

- 继续对照本地参考运行时：
  - `"/Users/coso/Documents/dev/js/claudecode/src/types/hooks.ts"`
  - `"/Users/coso/Documents/dev/js/claudecode/src/cli/structuredIO.ts"`
  - `"/Users/coso/Documents/dev/js/claudecode/src/services/tools/toolExecution.ts"`
  后确认 upstream 的 `PermissionRequest.updatedInput` 不是展示字段，而是会真实改写后续工具执行输入；因此这一步继续只沿 `runtime_project_hooks -> PermissionRequestHookDecision -> handle_approval_tool_requests(...)` 当前主链推进，不额外发明第二套 permission rewrite runtime。
- [`types.rs`](../../src-tauri/crates/aster-rust/crates/aster/src/agents/types.rs) 现已把 `PermissionRequestHookDecision::Allow` 收成带载荷的 current 语义：
  - `Allow { updated_input: Option<Map<String, Value>> }`
  - `updated_input` 只接受 object 形状，与 Lime 当前 `CallToolRequestParam.arguments` 和 upstream `Record<string, unknown>` 保持同构，不再用宽泛 `Value` 做伪兼容
- [`runtime_project_hooks.rs`](../../src-tauri/src/commands/aster_agent_cmd/runtime_project_hooks.rs) 现已把 `updatedInput` 接进 PermissionRequest hook 解析：
  - `{"decision":"allow","updatedInput":{...}}` 会被解析成 `PermissionRequestHookDecision::Allow { updated_input: Some(...) }`
  - 若 `updatedInput` 不是 object，会直接 warning 并忽略该 decision，回退到后续 hook / 人工审批；不会偷偷拿原始输入继续 auto-allow
  - 现有 `allow`、`deny(message)` 路径保持不变，没有为了迁就 richer 语义再扩 compat 协议
- [`tool_execution.rs`](../../src-tauri/crates/aster-rust/crates/aster/src/agents/tool_execution.rs) 现已把改写后的输入真正送入工具执行：
  - 新增 `apply_permission_request_updated_input(...)`
  - `handle_approval_tool_requests(...)` 的 auto-allow 分支会先改写 `CallToolRequestParam.arguments`
  - 然后再 `dispatch_tool_call(...)`，确保 hook 返回的 `updatedInput` 真正进入工具，而不是只在 decision 对象里“看起来支持”
- 新增定向测试已经把这条 richer current 路径锚住：
  - `runtime_project_hooks` 侧新增 `allow + updatedInput` 解析测试
  - `tool_execution` 侧新增 end-to-end 测试，确认 auto-allow 时工具实际收到改写后的参数，而不是原始 `README.md`
- 这一步后的 `CCD-008` 边界继续收紧为：
  - `current`：`TaskCreated / TaskCompleted` hooks、project-level `UserPromptSubmit`、`SessionStart(startup / compact)`、`PreCompact`、`PermissionRequest`（含 `allow + updatedInput`）、`Stop`、`SessionEnd(other via delete_session)`、`command / url / prompt / agent / mcp` hook executor、`SkillTool` prompt/workflow/agent execution、skill frontmatter hooks、agent frontmatter hooks、plugin hooks（runtime `SessionStart / UserPromptSubmit / PreCompact / PermissionRequest / Stop / SessionEnd` current surfaces）
  - `current gap`：`SessionStart(resume)`、`SessionEnd(clear / prompt_input_exit / logout)`、`Stop` richer continuation policy、`PermissionRequest` richer decision surface（`updatedPermissions / interrupt`）、plugin hook 与 upstream managed policy / builtin plugin 加载链的完全同构仍未补齐
  - `explicitly unsupported gap`：`hook.if`、`asyncRewake`、非 `bash` shell、`allowedEnvVars`
  - `compat / deprecated / dead`：无新增；本轮没有为了 `updatedInput` 再发明新的 approval 协议，也没有把宽泛 JSON 重写偷偷塞回当前主链
- 这一步服务路线图主目标的关系是：把参考运行时图里 `PermissionRequest` 剩余最贴近 current 的 richer 语义推进到 Lime 当前主链，避免扩展体系继续停在“allow / deny 已 current，但 hook 仍无法真实改写工具输入”的半成品状态。
- 已执行定向校验：
  - `rustfmt --edition 2021 "src-tauri/crates/aster-rust/crates/aster/src/agents/types.rs" "src-tauri/crates/aster-rust/crates/aster/src/agents/tool_execution.rs" "src-tauri/src/commands/aster_agent_cmd/runtime_project_hooks.rs"` 通过
  - `cargo test --manifest-path "src-tauri/Cargo.toml" -p lime --lib decide_runtime_permission_request_project_hooks_for_session_should_ -- --nocapture` 通过（`3 passed`）
  - `cargo test --manifest-path "src-tauri/crates/aster-rust/crates/aster/Cargo.toml" handle_approval_tool_requests_should_ --lib -- --nocapture` 通过（`3 passed`；仅剩工作区既有 warning：`task_list_tools.rs / worktree_tools.rs` 的 `SessionManager` 未使用）
  - `cargo check --manifest-path "src-tauri/Cargo.toml" -p lime --tests` 通过
- 下一刀最值得继续推进的是：
  - 继续保持 `SessionStart(resume)` 与 `SessionEnd(resume / clear / prompt_input_exit / logout)` 为显式 gap，不再来回犹豫
  - 若继续追 `PermissionRequest` richer 语义，只能在找到真实权限事实源与 interrupt 宿主后，再分别推进 `updatedPermissions` 与 `interrupt`
  - 当前更稳的一刀是回到 `Stop` 的 `preventContinuation / stopReason` 审计，先确认 Lime 是否存在同样诚实的 continuation gate，再决定是否进入 current

### 继续推进（CCD-008 / Stop continuation gate audit）

- 继续对照本地参考运行时：
  - `"/Users/coso/Documents/dev/js/claudecode/src/query/stopHooks.ts"`
  - `"/Users/coso/Documents/dev/js/claudecode/src/query.ts"`
  - `"/Users/coso/Documents/dev/js/claudecode/src/types/hooks.ts"`
  后确认 upstream 的 `Stop.preventContinuation / stopReason` 不是展示字段，而是 query loop 里的真实 continuation gate：
  - `handleStopHooks(...)` 会把 `preventContinuation` 返回给 query loop
  - query loop 会据此走 `stop_hook_prevented / hook_stopped`，阻断后续 continuation
  - `stopReason` 只是在这个 gate 生效时给用户看的解释，不是独立功能
- 继续排查 Lime current 宿主后，确认本地目前没有与之等价的 continuation gate：
  - [`runtime_turn.rs`](../../src-tauri/src/commands/aster_agent_cmd/runtime_turn.rs) 的 [`finalize_runtime_turn_result(...)`](../../src-tauri/src/commands/aster_agent_cmd/runtime_turn.rs#L3616) 只会在 turn 成功后 fire-and-forget 运行 `Stop` hooks，然后继续发送 `FinalDone`；当前不会回收任何 hook continuation 决策。
  - [`prompt_context.rs`](../../src-tauri/src/commands/aster_agent_cmd/prompt_context.rs#L3) 与 [`dto.rs`](../../src-tauri/src/commands/aster_agent_cmd/dto.rs#L1834) 里的 `auto_continue` 只是“文稿续写”提示词增强，不是 upstream 那种 query-loop continuation state machine。
  - 因此 Lime 当前只有 `Stop event host`，没有 `Stop continuation gate host`；不能把 `auto_continue.enabled`、turn 正常收尾、或任何现有 runtime flag 硬映射成 `preventContinuation`
- 为了避免继续制造假对齐，这一轮补了最小守卫而不是伪实现：
  - [`runtime_project_hooks.rs`](../../src-tauri/src/commands/aster_agent_cmd/runtime_project_hooks.rs) 新增 `parse_runtime_stop_hook_continuation_request(...)`
  - 当 `Stop` hook 输出 upstream 形状的 `{"continue":false,"stopReason":"..."}` 时，Lime 会显式 warning：
    当前 runtime 识别到了这个 richer 请求，但仍无与 Claude Code 等价的 continuation gate，本次不会阻断 turn 收尾
  - [`runtime_turn.rs`](../../src-tauri/src/commands/aster_agent_cmd/runtime_turn.rs) 现已把这条 warning 从后台 tracing log 提升为前台 `RuntimeAgentEvent::Warning`，并写入 timeline；因此 gap 不再只是“开发者看日志才知道”，而是 turn 收尾前用户也能看到这是显式 unsupported
  - 这样 gap 从“静默忽略”收口成“显式 unsupported”，但没有为了迁就差异去伪造一套 continuation 行为
- 新增定向测试已经把这层 guardrail 锚住：
  - `run_runtime_stop_project_hooks_for_session_should_detect_unsupported_continue_false_request`
  - 覆盖 `continue:false + stopReason` 的解析与统一 warning message 返回路径，确保后续不会再把这种 richer 请求默默当成功输出吞掉
- 这一步后的 `CCD-008` 边界继续收紧为：
  - `current`：`TaskCreated / TaskCompleted` hooks、project-level `UserPromptSubmit`、`SessionStart(startup / compact)`、`PreCompact`、`PermissionRequest`（含 `allow + updatedInput`）、`Stop` event host、`SessionEnd(other via delete_session)`、`command / url / prompt / agent / mcp` hook executor、`SkillTool` prompt/workflow/agent execution、skill frontmatter hooks、agent frontmatter hooks、plugin hooks（runtime `SessionStart / UserPromptSubmit / PreCompact / PermissionRequest / Stop / SessionEnd` current surfaces）
  - `current gap`：`SessionStart(resume)`、`SessionEnd(clear / prompt_input_exit / logout)`、`Stop` richer continuation policy（`preventContinuation / stopReason` 仍无 honest host）、`PermissionRequest.updatedPermissions`、plugin hook 与 upstream managed policy / builtin plugin 加载链的完全同构仍未补齐
  - `explicitly unsupported gap`：`hook.if`、`asyncRewake`、非 `bash` shell、`allowedEnvVars`
  - `compat / deprecated / dead`：无新增；本轮没有为了 `Stop` richer 语义再发明第二套 continuation runtime，也没有把 `auto_continue` 或 turn 正常结束硬包装成 query-loop gate
- 这一步服务路线图主目标的关系是：把 `Stop` richer gap 从“也许还能找个现有 flag 复用”推进成“已审计确认 Lime 当前没有等价 continuation gate”，并用代码守卫封住静默假对齐，避免后续继续把 `auto_continue` 或普通 turn 收尾误判成 upstream `preventContinuation`。
- 已执行定向校验：
  - `cargo test --manifest-path "src-tauri/Cargo.toml" -p lime --lib run_runtime_stop_project_hooks_for_session_should_ -- --nocapture`
  - `cargo check --manifest-path "src-tauri/Cargo.toml" -p lime --tests`
- 下一刀最值得继续推进的是：
  - 继续保持 `Stop.preventContinuation / stopReason` 为显式 gap，除非 Lime 新增真实 continuation gate，否则不再围绕现有 `auto_continue` / turn 收尾反复犹豫
  - 若继续追 richer 语义，更值得回到 `PermissionRequest.updatedPermissions / interrupt` 的真实宿主审计

### 继续推进（CCD-008 / PermissionRequest interrupt current）

- 继续对照本地参考运行时：
  - `"/Users/coso/Documents/dev/js/claudecode/src/types/hooks.ts"`
  - `"/Users/coso/Documents/dev/js/claudecode/src/hooks/toolPermission/PermissionContext.ts"`
  - `"/Users/coso/Documents/dev/js/claudecode/src/cli/structuredIO.ts"`
  后确认 upstream 的 `PermissionRequest.deny + interrupt` 不是普通提示字段，而是会直接触发当前 turn 的中断：
  - hook 返回 `{"decision":"deny","message":"...","interrupt":true}` 后，会走 `toolUseContext.abortController.abort()`
  - deny message 仍会保留给当前工具拒绝结果，但 query / tool-use 主链会把这次 turn 当作被中断处理
- 继续审计 Lime current 主链后，确认本地其实已经存在与之诚实对应的 interrupt 宿主：
  - [`runtime_turn.rs`](../../src-tauri/src/commands/aster_agent_cmd/runtime_turn.rs) 的 `with_runtime_turn_session_scope(...)` 会为当前 session 建立单一 `CancellationToken`
  - [`agent.rs`](../../src-tauri/crates/aster-rust/crates/aster/src/agents/agent.rs) 的 `reply(...) / reply_internal(...)`、tool stream 合并循环与 turn finalize 都会持续检查这个 token；一旦被 cancel，turn 会按 `Aborted` 收尾
  - 因此 `interrupt` 不需要伪造第二套 runtime；只要沿当前 `PermissionRequest hook -> session cancel token` 主链接上，就是 honest host
- 这一轮据此把 `interrupt` 正式接进 Lime current，而没有继续把它误判成 gap：
  - [`runtime_project_hooks.rs`](../../src-tauri/src/commands/aster_agent_cmd/runtime_project_hooks.rs) 新增 `RuntimePermissionRequestHookRequest`
  - `parse_runtime_permission_request_hook_request(...)` 现在会解析 deny 分支里的 `interrupt:boolean`
  - `decide_runtime_permission_request_project_hooks_with_runtime(...)` 在 production current path 上发现 `interrupt:true` 后，会直接调用 `AsterAgentState.cancel_session(session_id)`，并记录 `source=hook` 的 interrupt marker
  - 这样 `PermissionRequest` deny 结果仍保持当前工具级拒绝语义，但 turn 本身也会像 upstream 一样进入中断收尾，而不是只回一条 deny message 后继续跑
- 同时继续把 `updatedPermissions` 诚实保留为 gap，而不是硬拼半套权限映射：
  - `PermissionRequest` allow 分支若带 `updatedPermissions`，Lime 当前不再“继续执行 allow 但忽略更新”，而是 fail-closed 回退到原生审批流：
    - 不执行 hook allow
    - 不应用 `updatedInput`
    - 不应用 `updatedPermissions`
  - 这样做是为了避免假对齐：upstream 的 `updatedPermissions.destination="session"` 会直接写回 `ToolPermissionContext`，既影响后续 turn，也会立刻影响当前 turn 后续工具决策；如果 Lime 只放行当前工具、却不真正改写权限事实源，会把 hook 作者带进错误语义
  - 继续往本地权限设施下钻后也确认，这不是“仓库里完全没权限代码”，而是“现有权限代码没有接在当前 approval 主链上，也没有 session 级权限事实源”：
    - [`tool_runtime.rs`](../../src-tauri/src/commands/aster_agent_cmd/tool_runtime.rs) 每次 turn 都会重建 `ToolPermissionManager::new(None)` 并重新挂到 `ToolRegistry`；这套 session permission 只是本 turn 内存对象
    - [`session_execution_runtime.rs`](../../src-tauri/crates/agent/src/session_execution_runtime.rs) 当前持久化到 session extension data 的只有 `recent_access_mode / recent_preferences / recent_team_selection`，没有 permission rules、额外目录或 upstream `defaultMode`
    - [`runtime_store.rs`](../../src-tauri/crates/aster-rust/crates/aster/src/session/runtime_store.rs) 的 `SessionRuntimeSnapshot` 只聚合 thread / turn runtime，也没有 session 权限规则快照
    - [`tool_inspection.rs`](../../src-tauri/crates/aster-rust/crates/aster/src/tool_inspection.rs) 里的 `update_permission_manager(...)` 只会把用户点击 `AlwaysAllow` 收成按工具名写入的 legacy `PermissionManager`
    - [`permission/permission_inspector.rs`](../../src-tauri/crates/aster-rust/crates/aster/src/permission/permission_inspector.rs) 的 `IntegratedPermissionManager` 只是可选能力，当前 `PermissionRequest` hook path 并不会在 allow 分支里消费 hook 返回的 permission update payload
    - [`permission/manager.rs`](../../src-tauri/crates/aster-rust/crates/aster/src/permission/manager.rs) 虽然存在更宽的 `ToolPermissionUpdate / update_permission(...)`，但当前仓库没有把这套更新器接到 `runtime_project_hooks -> PermissionRequest -> tool_execution` 这条 current path 上
  - 也就是说，这一轮只把 `interrupt` 从误判 gap 里收回 `current`；`updatedPermissions` 仍保持“显式 unsupported 的 current gap”，并且当前行为已经收紧为“显式回退审批流”，不再半执行 hook allow
- 新增定向测试已经把这条边界钉住：
  - `decide_runtime_permission_request_project_hooks_should_fallback_to_native_approval_when_allow_requests_updated_permissions`
  - `parse_runtime_permission_request_hook_request_should_detect_updated_permissions_request`
  - `decide_runtime_permission_request_project_hooks_with_runtime_should_interrupt_session_on_deny_interrupt_true`
- 这一步后的 `CCD-008` 边界继续收紧为：
  - `current`：`TaskCreated / TaskCompleted` hooks、project-level `UserPromptSubmit`、`SessionStart(startup / compact)`、`PreCompact`、`PermissionRequest`（含 `allow + updatedInput` 与 `deny + interrupt`）、`Stop` event host、`SessionEnd(other via delete_session)`、`command / url / prompt / agent / mcp` hook executor、`SkillTool` prompt/workflow/agent execution、skill frontmatter hooks、agent frontmatter hooks、plugin hooks（runtime `SessionStart / UserPromptSubmit / PreCompact / PermissionRequest / Stop / SessionEnd` current surfaces）
  - `current gap`：`SessionStart(resume)`、`SessionEnd(clear / prompt_input_exit / logout)`、`Stop` richer continuation policy（`preventContinuation / stopReason` 仍无 honest host）、`PermissionRequest.updatedPermissions`、plugin hook 与 upstream managed policy / builtin plugin 加载链的完全同构仍未补齐
  - `explicitly unsupported gap`：`hook.if`、`asyncRewake`、非 `bash` shell、`allowedEnvVars`
  - `compat / deprecated / dead`：无新增；本轮没有为了 `updatedPermissions` 再造一层 permission compat，也没有把用户 API `agent_runtime_interrupt_turn` 包一层假 hook host，而是直接复用当前 turn cancel token
- 这一步服务路线图主目标的关系是：把 `PermissionRequest` richer 语义里原本混在一起的两部分彻底拆开，只把已经存在 honest host 的 `interrupt` 收进 current，把还没有真实权限事实源的 `updatedPermissions` 留在显式 gap，避免后续再围绕“这俩是不是都没法做”产生误判。
- 已执行定向校验：
  - `rustfmt --edition 2021 "src-tauri/src/commands/aster_agent_cmd/runtime_project_hooks.rs"` 通过
  - `cargo test --manifest-path "src-tauri/Cargo.toml" -p lime --lib decide_runtime_permission_request_project_hooks_ -- --nocapture` 通过（`5 passed`）
  - `cargo test --manifest-path "src-tauri/Cargo.toml" -p lime --lib parse_runtime_permission_request_hook_request_should_detect_updated_permissions_request -- --nocapture` 通过（`1 passed`）
  - `cargo check --manifest-path "src-tauri/Cargo.toml" -p lime --tests` 通过
- 下一刀最值得继续推进的是：
  - 继续保持 `PermissionRequest.updatedPermissions` 为显式 gap，除非 Lime 先收敛出真实权限事实源，否则不做半套规则映射
  - `Stop.preventContinuation / stopReason` 仍应保持 gap，不要因为 `interrupt` 已 current 就误判 `Stop` 也有 continuation gate
  - 若继续追平 upstream extension 语义，更值得回到 managed plugin policy / builtin plugin hooks 的完全同构审计

### 继续推进（CCD-008 / Session lifecycle unsupported host guard）

- 继续对照本地参考运行时：
  - `"/Users/coso/Documents/dev/js/claudecode/src/utils/hooks.ts"`
  - `"/Users/coso/Documents/dev/js/claudecode/src/utils/sessionStart.ts"`
  - `"/Users/coso/Documents/dev/js/claudecode/src/commands/clear/conversation.ts"`
  - `"/Users/coso/Documents/dev/js/claudecode/src/screens/REPL.tsx"`
  - `"/Users/coso/Documents/dev/js/claudecode/src/utils/gracefulShutdown.ts"`
  后确认 upstream 的 session lifecycle 比 Lime 当前宿主面更宽：
  - `SessionStart` 的 source 真实包含 `startup / resume / clear / compact`
  - `SessionEnd` 的 reason 真实包含 `clear / resume / logout / prompt_input_exit / other / bypass_permissions_disabled`
- 继续审计 Lime current 宿主后，确认本地真正有调用点的只有：
  - [`session_runtime.rs`](../../src-tauri/src/commands/aster_agent_cmd/session_runtime.rs) 里的 `create_runtime_session_internal_with_optional_runtime(...) -> SessionSource::Startup`
  - [`runtime_turn.rs`](../../src-tauri/src/commands/aster_agent_cmd/runtime_turn.rs) 的压缩入口 -> `SessionSource::Compact`
  - [`session_runtime.rs`](../../src-tauri/src/commands/aster_agent_cmd/session_runtime.rs) 的 `delete_runtime_session_internal_with_runtime(...) -> SessionEndReason::Other`
  - [`command_api/runtime_api.rs`](../../src-tauri/src/commands/aster_agent_cmd/command_api/runtime_api.rs) 的 `agent_runtime_resume_thread(...)` 只是恢复 runtime queue，不是 upstream `/resume` 那种“旧 session 结束 + 新 query session start”
  - [`execute_commands.rs`](../../src-tauri/crates/aster-rust/crates/aster/src/agents/execute_commands.rs) 的 `/clear` 只是清空 conversation，也还没有接成 upstream `/clear` 那种 `SessionEnd(clear) + SessionStart(clear)` lifecycle host
- 为了避免后续有人把这些 enum 误当成“已经有 current host”，这一轮继续补了显式 unsupported guard，而不是偷接假宿主：
  - [`runtime_project_hooks.rs`](../../src-tauri/src/commands/aster_agent_cmd/runtime_project_hooks.rs) 新增 `build_runtime_session_start_unsupported_warning_message(...)`
  - 对 `SessionStart.resume / clear`，当前 runtime 会显式 warning 并直接跳过 hook 执行；不会因为 enum 已存在就默认放行
  - 同文件新增 `build_runtime_session_end_unsupported_warning_message(...)`
  - 对 `SessionEnd.clear / logout / prompt_input_exit`，当前 runtime 也会显式 warning 并直接跳过 hook 执行；当前唯一允许的 `SessionEnd` current host 仍只有 `delete_session -> other`
  - 这样做的目的不是“删掉未来能力”，而是先把 current 宿主边界钉死，防止 `resume_thread`、`/clear` 或其他局部动作被误包成完整 lifecycle hook host
- 新增定向测试已经把这层 guardrail 锚住：
  - `build_runtime_session_start_unsupported_warning_message_should_allow_only_current_sources`
  - `run_runtime_session_start_project_hooks_for_session_should_skip_unsupported_resume_source`
  - `build_runtime_session_end_unsupported_warning_message_should_allow_only_other_reason`
  - `run_runtime_session_end_project_hooks_for_session_should_skip_unsupported_clear_reason`
- 这一步后的 `CCD-008` 边界继续收紧为：
  - `current`：`TaskCreated / TaskCompleted` hooks、project-level `UserPromptSubmit`、`SessionStart(startup / compact)`、`PreCompact`、`PermissionRequest`（含 `allow + updatedInput` 与 `deny + interrupt`）、`Stop` event host、`SessionEnd(other via delete_session)`、`command / url / prompt / agent / mcp` hook executor、`SkillTool` prompt/workflow/agent execution、skill frontmatter hooks、agent frontmatter hooks、plugin hooks（runtime `SessionStart / UserPromptSubmit / PreCompact / PermissionRequest / Stop / SessionEnd` current surfaces）
  - `current gap`：`SessionStart(resume / clear)`、`SessionEnd(resume / clear / prompt_input_exit / logout / bypass_permissions_disabled)`、`Stop` richer continuation policy（`preventContinuation / stopReason` 仍无 honest host）、`PermissionRequest.updatedPermissions`、plugin hook 与 upstream managed policy / builtin plugin 加载链的完全同构仍未补齐
  - `explicitly unsupported gap`：`hook.if`、`asyncRewake`、非 `bash` shell、`allowedEnvVars`
  - `compat / deprecated / dead`：无新增；本轮没有把 `agent_runtime_resume_thread`、`/clear` 或退出动作硬包装成 Session lifecycle compat host，而是先用代码守卫封住误接线
- 这一步服务路线图主目标的关系是：把 `CCD-008` 里最容易被 enum / schema 误导的 lifecycle 差距进一步钉死为“只有真实宿主才允许进入 current”，避免后续实现者把 queue resume、conversation clear 或任意退出路径误判成已经对齐 Claude Code 的 `SessionStart / SessionEnd` 生命周期。
- 已执行定向校验：
  - `rustfmt --edition 2021 "src-tauri/src/commands/aster_agent_cmd/runtime_project_hooks.rs" "src-tauri/src/commands/aster_agent_cmd/runtime_turn.rs"` 通过
  - `cargo test --manifest-path "src-tauri/Cargo.toml" -p lime --lib run_runtime_session_start_project_hooks_for_session_should_ -- --nocapture` 通过
  - `cargo test --manifest-path "src-tauri/Cargo.toml" -p lime --lib run_runtime_session_end_project_hooks_for_session_should_ -- --nocapture` 通过
  - `cargo check --manifest-path "src-tauri/Cargo.toml" -p lime --tests` 通过
- 下一刀最值得继续推进的是：
  - 若要继续追 `SessionStart(clear / resume)` 或 `SessionEnd(...)`，先找出单一、真实、产品层接受的 lifecycle host，再接 hooks；不要反过来从 enum 倒推宿主
  - 更可能直接推进主线的一刀，仍是继续审 `managed plugin policy / builtin plugin hooks` 与 upstream loader 同构差距

## 2026-04-21

### 继续推进（CCD-008 / plugin cache fact-source convergence）

- 继续对照本地参考运行时：
  - `"/Users/coso/Documents/dev/js/claudecode/src/utils/plugins/loadPluginHooks.ts"`
  - `"/Users/coso/Documents/dev/js/claudecode/src/utils/plugins/pluginLoader.ts"`
  - `"/Users/coso/Documents/dev/js/claudecode/src/utils/plugins/pluginStartupCheck.ts"`
  后确认 Lime 当前更直接的漂移点不是“还没补 managed policy”，而是仓库内部已经有两套 `enabledPlugins + cache root` 解析事实源：
  - [`runtime_project_hooks.rs`](../../src-tauri/src/commands/aster_agent_cmd/runtime_project_hooks.rs) 会合并 `home/workspace + settings/settings.local`，再只加载 marketplace cache plugin hooks
  - [`skills/loader.rs`](../../src-tauri/crates/aster-rust/crates/aster/src/skills/loader.rs) 之前却只看 `~/.claude/settings.json`，并自己重扫一遍 `~/.claude/plugins/cache`
- 这一轮先没有为了“补名字”把旧 plugin installer 或另一套 plugin system 接回 current，而是直接把 repo 内部双轨收口成单一 helper：
  - 新增 [`claude_plugin_cache.rs`](../../src-tauri/crates/aster-rust/crates/aster/src/claude_plugin_cache.rs)，统一负责：
    - 合并 `~/.claude/settings.json`
    - 合并 `~/.claude/settings.local.json`
    - 合并 `<workspace>/.claude/settings.json`
    - 合并 `<workspace>/.claude/settings.local.json`
    - 解析 `plugin@marketplace`
    - 选择 `~/.claude/plugins/cache/<marketplace>/<plugin>/` 下的最高版本目录
  - [`runtime_project_hooks.rs`](../../src-tauri/src/commands/aster_agent_cmd/runtime_project_hooks.rs) 现在直接复用这条 helper 加载 plugin hooks，不再自己维护 `enabledPlugins` merge、plugin id 解析和 cache version 排序
  - [`skills/loader.rs`](../../src-tauri/crates/aster-rust/crates/aster/src/skills/loader.rs) 现在也复用同一 helper 加载 plugin skills，并补了一条定向测试锁住 `workspace/.claude/settings.local.json` 对 plugin skill 可见
  - `@builtin` 不再在 hook / skill 两侧各自静默掉过，而是统一标记为显式 unsupported gap：当前没有 honest host，就不伪装成 marketplace cache plugin current
- 这一步后的 `CCD-008` 边界继续收紧为：
  - `current`：plugin hooks 与 plugin skills 已共享 `claude_plugin_cache.rs` 单一 resolver；home/workspace settings 合并、latest-version 选择与 `@builtin` gap 口径都已收敛
  - `current gap`：upstream 的 managed plugin policy、builtin plugin hooks、plugin hot reload / prune 仍未同构；Lime 目前只对齐到 marketplace cache plugin 这一层 current 事实源
  - `compat / deprecated / dead`：无新增；这一轮没有把旧 installer、legacy plugin manager 或另一套 plugin surface 抬回 current
- 这一步服务路线图主目标的关系是：先把 Lime 仓库内部自己长出来的 plugin loader 双轨清掉，避免后续一边补 upstream gap、一边继续让 hook 与 skill 各自漂移；下一刀才值得继续追 `managed policy / builtin plugin hooks` 的真实宿主审计。
- 已执行定向校验：
  - `rustfmt --edition 2021 "src-tauri/crates/aster-rust/crates/aster/src/claude_plugin_cache.rs" "src-tauri/crates/aster-rust/crates/aster/src/lib.rs" "src-tauri/crates/aster-rust/crates/aster/src/skills/loader.rs" "src-tauri/src/commands/aster_agent_cmd/runtime_project_hooks.rs"` 通过
  - `cargo test --manifest-path "src-tauri/crates/aster-rust/crates/aster/Cargo.toml" claude_plugin_cache::tests --lib -- --nocapture` 通过（`3 passed`）
  - `cargo test --manifest-path "src-tauri/crates/aster-rust/crates/aster/Cargo.toml" test_load_skills_from_plugin_cache_uses_workspace_settings_local_and_latest_version --lib -- --nocapture` 通过（`1 passed`）
  - `cargo test --manifest-path "src-tauri/Cargo.toml" -p lime --lib runtime_project_hooks -- --nocapture` 通过（`22 passed`）
  - `cargo check --manifest-path "src-tauri/Cargo.toml" -p lime --tests` 通过
- 下一刀最值得继续推进的是：
  - 继续审 `managed plugin policy / builtin plugin hooks` 与 upstream loader 的同构差距
  - 在没有真实宿主前，继续保持 `@builtin` 为显式 gap，不把旧 plugin installer、legacy manager 或其他非 current plugin 系统重新接回主链

### 继续推进（CCD-008 / managed plugin policy unsupported guard）

- 继续对照本地参考运行时后，进一步把 `managed plugin policy` 和 Lime 现有 `policySettings` 区分开：
  - upstream 的 plugin loader 会把 `policySettings.enabledPlugins / strictKnownMarketplaces / blockedMarketplaces / extraKnownMarketplaces` 直接并进 `loadAllPluginsCacheOnly()` 的 discovery / merge / policy current 主链
  - Lime 当前虽然在 [`config_manager.rs`](../../src-tauri/crates/aster-rust/crates/aster/src/config/config_manager.rs) 有 `.aster/managed_settings.yaml` 的 `policySettings` 概念，但它属于通用配置管理器，不是 Claude 风格 `.claude plugin policy` 当前宿主，也没有接进 `plugin hook / plugin skill` loader
- 因此这一轮没有把 `.aster policySettings` 硬接成 plugin managed host，而是继续做 honest guard：
  - [`claude_plugin_cache.rs`](../../src-tauri/crates/aster-rust/crates/aster/src/claude_plugin_cache.rs) 现在会额外探测 `~/.aster/managed_settings.yaml` / `~/.aster/policy.yaml`
  - 如果这些文件里声明了 Claude 风格 plugin policy keys：`enabledPlugins / extraKnownMarketplaces / strictKnownMarketplaces / blockedMarketplaces`
  - resolver 会统一返回显式 skipped reason，说明“检测到 managed plugin policy key，但当前 runtime 尚未接入 policySettings/plugin loader current 宿主，已忽略”
  - 这样 `runtime_project_hooks` 和 `skills/loader` 复用同一 resolver 时，会共享这条 warning 口径，而不是继续静默掉过
- 这一步后的 `CCD-008` 边界继续收紧为：
  - `current`：marketplace cache plugin 的 hook / skill loader 继续共享单一 resolver；`@builtin` 与 managed plugin policy gap 都已有统一的代码级 skipped reason
  - `current gap`：upstream 的 managed plugin policy merge、builtin plugin registry、builtin plugin hooks、plugin hot reload / prune 仍未同构；Lime 还没有可复用的 honest host
  - `compat / deprecated / dead`：无新增；本轮没有把 `.aster policySettings`、旧 plugin installer 或其他 builtin/managed 相关旧面抬成 current
- 这一步服务路线图主目标的关系是：把“Lime 也有 policySettings”这种最容易诱发假对齐的点钉死成显式 unsupported guard，避免后续实现者把 `.aster managed_settings.yaml` 误当成 Claude Code 的 plugin managed policy current 宿主。
- 已执行定向校验：
  - `rustfmt --edition 2021 "src-tauri/crates/aster-rust/crates/aster/src/claude_plugin_cache.rs"` 通过
  - `cargo test --manifest-path "src-tauri/crates/aster-rust/crates/aster/Cargo.toml" claude_plugin_cache::tests --lib -- --nocapture` 通过（`5 passed`）
  - `cargo check --manifest-path "src-tauri/Cargo.toml" -p lime --tests` 通过
- 下一刀最值得继续推进的是：
  - 继续审 upstream 的 builtin plugin registry 与 builtin plugin hooks 是否在 Lime 存在真实宿主；如果没有，就继续保持 gap，而不是把 Lime 现有 builtin skill / extension / preset 系统误抬成 plugin current

### 继续推进（CCD-008 / builtin plugin registry host audit）

- 继续对照本地参考运行时：
  - `"/Users/coso/Documents/dev/js/claudecode/src/plugins/builtinPlugins.ts"`
  - `"/Users/coso/Documents/dev/js/claudecode/src/plugins/bundled/index.ts"`
  - `"/Users/coso/Documents/dev/js/claudecode/src/utils/plugins/pluginLoader.ts"`
  后确认 upstream 的 `@builtin` 确实不是 marketplace cache plugin，而是单独的 builtin plugin registry 宿主：
  - [`builtinPlugins.ts`](../../../../js/claudecode/src/plugins/builtinPlugins.ts) 定义了 `BuiltinPluginDefinition -> registerBuiltinPlugin() -> getBuiltinPlugins()` 这一条独立 registry
  - [`pluginLoader.ts`](../../../../js/claudecode/src/utils/plugins/pluginLoader.ts) 也明确把 `marketplace` 与 `builtin` 分开装配，builtins 通过 `getBuiltinPlugins()` 合并进最终 plugin load result，而不是走 `plugins/cache`
  - 但按当前参考源码，[`plugins/bundled/index.ts`](../../../../js/claudecode/src/plugins/bundled/index.ts) 仍是空 scaffold，今天还没有真正注册任何 builtin plugin
- 这意味着 Lime 当前不该做的事更明确了：
  - 不能把 `@builtin` 当成另一种 cache plugin 继续沿 `~/.claude/plugins/cache` 猜目录
  - 也不能把本地现有的 builtin skill / builtin profile / builtin team preset / builtin extension config 这些“名字里带 builtin”的系统，误抬成 Claude Code 的 builtin plugin registry current 宿主
- 因此这一轮只继续补 honest guard，不做假映射：
  - [`claude_plugin_cache.rs`](../../src-tauri/crates/aster-rust/crates/aster/src/claude_plugin_cache.rs) 里的 `@builtin` skipped reason 现在进一步收紧为：
    - 当前缺少独立的 builtin plugin registry/current 宿主
    - 不能回退为 marketplace cache plugin
    - 也不能回退到其他 builtin surface
- 这一步后的 `CCD-008` 边界继续收紧为：
  - `current`：marketplace cache plugin 的 hook / skill loader 与 managed-policy unsupported guard 已收敛到单一 resolver
  - `current gap`：upstream 的 builtin plugin registry host 目前在 Lime 缺席；不过参考运行时今天也还没有实际注册的 builtin plugins，所以这条 gap 当前属于“结构已存在、活跃能力尚未落地”的 dormant gap
  - `compat / deprecated / dead`：无新增；本轮没有把 builtin skill / profile / preset / extension 平移成 plugin compat
- 这一步服务路线图主目标的关系是：把 `@builtin` 的误导性空间进一步压扁，避免后续实现者因为仓库里到处有 `builtin` 命名，就误判 Lime 已经具备 Claude Code 的 builtin plugin current 宿主。
- 已执行定向校验：
  - `rustfmt --edition 2021 "src-tauri/crates/aster-rust/crates/aster/src/claude_plugin_cache.rs"` 通过
  - `cargo test --manifest-path "src-tauri/crates/aster-rust/crates/aster/Cargo.toml" claude_plugin_cache::tests --lib -- --nocapture` 通过（`5 passed`）
  - `cargo check --manifest-path "src-tauri/Cargo.toml" -p lime --tests` 通过
- 下一刀最值得继续推进的是：
  - 若继续沿 plugin loader 对齐主线推进，比起 builtin plugin，更值得回到 plugin hot reload / prune 与 managed policy merge 的 current 宿主差距

### 继续推进（CCD-008 / plugin skill on-demand refresh）

- 继续对照本地参考运行时并回看 Lime 当前实现后，进一步确认 `plugin hot reload / prune` 在仓库里的真实漂移点已经收缩：
  - [`runtime_project_hooks.rs`](../../src-tauri/src/commands/aster_agent_cmd/runtime_project_hooks.rs) 这条 hook current 主链本来就是“按次构建 `HookRegistry` -> 重新加载 project/plugin hooks”，所以 `plugin hooks` 侧并不存在一个额外的全局缓存宿主需要单独热刷新
  - 真正仍会漂的是 [`skills/registry.rs`](../../src-tauri/crates/aster-rust/crates/aster/src/skills/registry.rs) 里的全局 `SkillRegistry`：它之前挂在 `OnceLock` 后只初始化一次，导致 plugin skill 的 enable/disable、cache version 切换、同一路径 `SKILL.md` 内容变更都不会反映到后续 skill / workflow 使用
- 因此这一轮没有去发明新的 plugin listener、也没有把别的 legacy plugin/extension 面接回 current，而是继续沿现有 Rust runtime 补最诚实的一刀：
  - [`skills/loader.rs`](../../src-tauri/crates/aster-rust/crates/aster/src/skills/loader.rs) 新增 `build_plugin_skill_registry_snapshot_with_context(...)`，基于共享的 [`claude_plugin_cache.rs`](../../src-tauri/crates/aster-rust/crates/aster/src/claude_plugin_cache.rs) resolver 生成 plugin skill snapshot；snapshot 会记录：
    - 当前可见的 `plugins`
    - 当前 `skipped` reasons
    - 每个 plugin root 下 `skills/*/SKILL.md` 的路径、文件长度、修改时间与内容 hash
  - [`skills/registry.rs`](../../src-tauri/crates/aster-rust/crates/aster/src/skills/registry.rs) 新增 `plugin_snapshot` 状态，以及：
    - `initialize_with_context(...)`
    - `reload_with_context(...)`
    - `refresh_plugin_skills_if_needed_with_context(...)`
    - `refresh_shared_registry_if_needed(...)`
  - 刷新语义保持极简：
    - snapshot 不变时不 reload
    - snapshot 变化时重新装载整套 skills（plugin / user / project），沿用既有优先级
    - `invoked` 历史不清空，不为了刷新把使用记录抹掉
  - [`skills/tool.rs`](../../src-tauri/crates/aster-rust/crates/aster/src/skills/tool.rs) 与 [`workflow_tool.rs`](../../src-tauri/crates/aster-rust/crates/aster/src/tools/workflow_tool.rs) 现在都会在 current 入口前触发这层 refresh，因此下一次使用 `SkillTool` / `WorkflowTool` 时，就会真实反映 plugin skill 的启停、prune、版本切换和 `SKILL.md` 更新
- 这一步后的 `CCD-008` 边界继续收紧为：
  - `current`：plugin hooks 继续通过按次重建 registry 获得天然刷新；plugin skills 则已补上基于 snapshot 的 on-demand refresh，当前 `SkillTool / WorkflowTool` 会在使用前自动收敛到最新可见 plugin skill 集合
  - `current gap`：Lime 还没有 upstream 那种 push-style plugin settings listener / managed policy merge host；builtin plugin current 宿主也仍缺席，所以这一步只是把“效果对齐”补到当前 skill runtime，而不是宣称已拥有同构的 plugin loader 生命周期
  - `compat / deprecated / dead`：无新增；本轮没有为了追平热刷新语义，把旧 installer、legacy manager、`.aster policySettings` 或其它 extension surface 抬回 current
- 这一步服务路线图主目标的关系是：把 `CCD-008` 在仓库内部最后一个明显的 plugin skill 全局缓存漂移点收掉，让 Lime 现有 skill/runtime 主链不再停在“settings 已变、skill 仍读旧快照”的半成品阶段；下一刀才值得继续评估是否需要真正的 push listener / policy merge 宿主。
- 已执行定向校验：
  - `rustfmt --edition 2021 "src-tauri/crates/aster-rust/crates/aster/src/skills/loader.rs" "src-tauri/crates/aster-rust/crates/aster/src/skills/registry.rs" "src-tauri/crates/aster-rust/crates/aster/src/skills/tool.rs" "src-tauri/crates/aster-rust/crates/aster/src/tools/workflow_tool.rs"` 通过
  - `cargo test --manifest-path "src-tauri/crates/aster-rust/crates/aster/Cargo.toml" refresh_plugin_skills_if_needed_with_context --lib -- --nocapture` 通过（`3 passed`）
  - `cargo check --manifest-path "src-tauri/Cargo.toml" -p lime --tests` 通过
- 下一刀最值得继续推进的是：
  - 继续判断 Lime 是否真的需要补 upstream 风格的 plugin settings listener / managed policy merge host；如果没有真实宿主，就继续把这层差异保留为 gap，而不是把别的系统硬包装成 current

### 继续推进（CCD-008 / platform skills extension fact-source convergence）

- 顺着 `plugin skill` 刷新主线继续盘点后，又发现仓库里还留着一条容易误导实现者的平行技能面：
  - [`agents/skills_extension.rs`](../../src-tauri/crates/aster-rust/crates/aster/src/agents/skills_extension.rs) 过去会自己扫描 `~/.claude/skills`、`~/.config/agents/skills`、`$PWD/.claude/skills`、`$PWD/.aster/skills`、`$PWD/.agents/skills`
  - 这条 platform extension loader 与当前 [`skills/loader.rs`](../../src-tauri/crates/aster-rust/crates/aster/src/skills/loader.rs) / [`skills/registry.rs`](../../src-tauri/crates/aster-rust/crates/aster/src/skills/registry.rs) 的 current skill 主链不是同一事实源，甚至会把 `.aster/skills`、`.agents/skills` 这类 Claude Code 当前语义里并不存在的目录重新抬成可见 surface
  - 如果继续默认启用，它会形成第二套 `skills__loadSkill` 工具面，与 native `SkillTool` / `WorkflowTool` 并存，进一步偏离参考运行时
- 这一轮没有为了保留旧行为继续补 compat，而是直接收口：
  - [`extension.rs`](../../src-tauri/crates/aster-rust/crates/aster/src/agents/extension.rs) 里 `skills` platform extension 已从 `default_enabled: true` 降为 `false`，并在描述里明确 native `Skill tool` 才是 current surface
  - [`skills_extension.rs`](../../src-tauri/crates/aster-rust/crates/aster/src/agents/skills_extension.rs) 即使被手动启用，也不再自己扫描那套旧目录，而是改为直接复用共享的 `SkillRegistry`：
    - 读取前先执行 `refresh_shared_registry_if_needed(...)`
    - `loadSkill` 改为通过共享 registry 查找 skill
    - skill instructions 与工具可见性也都改为从共享 registry 读取
  - 这样处理后，仓库里不再存在“native skills 一套事实源，platform skills extension 另一套事实源”的并行 current
- 这一步后的 `CCD-008` 边界继续收紧为：
  - `current`：native `SkillTool / WorkflowTool + SkillRegistry` 继续是唯一技能 current surface
  - `compat`：platform `skills` extension 现在只剩显式 opt-in legacy surface；即便开启，也只能委托共享 `SkillRegistry`，不再拥有独立 loader / directory semantics
  - `dead`：`.aster/skills`、`.agents/skills` 这类 platform skills extension 私有目录语义已不再参与当前运行时事实源
- 这一步服务路线图主目标的关系是：把 Lime 仓库内部最后一个“技能系统自己再长一套目录发现逻辑”的平行面压回去，避免 `CCD-008` 主线刚把 native skill/runtime 收口完，另一边 platform extension 又把旧目录和旧工具面重新接回产品。
- 已执行定向校验：
  - `rustfmt --edition 2021 "src-tauri/crates/aster-rust/crates/aster/src/agents/extension.rs" "src-tauri/crates/aster-rust/crates/aster/src/agents/skills_extension.rs"` 通过
  - `cargo test --manifest-path "src-tauri/crates/aster-rust/crates/aster/Cargo.toml" skills_extension::tests --lib -- --nocapture` 通过（`12 passed`）
  - `cargo check --manifest-path "src-tauri/Cargo.toml" -p lime --tests` 通过
- 下一刀最值得继续推进的是：
  - 回到真正还没有 honest host 的部分，继续审 `plugin settings listener / managed policy merge` 是否需要产品级 current 宿主；如果没有，就继续把这层差异留在 gap，而不是从旧 extension / config surface 里找替身

### 继续推进（CCD-008 / plugin cache legacy fallback）

- 继续对照本地参考运行时 [`pluginLoader.ts`](../../../../js/claudecode/src/utils/plugins/pluginLoader.ts) 后，确认 plugin cache 目录语义还差最后一层真实 resolver 行为：
  - upstream 的 `resolvePluginPath(...)` 不是“只认 versioned cache”
  - 它会先尝试 `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/`
  - 若该 versioned 路径不存在，再回退到历史遗留的 `~/.claude/plugins/cache/<plugin>/`
- 因此这一轮没有去补没有 honest host 的 settings listener / managed policy merge，而是先把 Lime 的 cache resolver 对齐到 upstream 当前真实行为：
  - [`claude_plugin_cache.rs`](../../src-tauri/crates/aster-rust/crates/aster/src/claude_plugin_cache.rs) 里的 `resolve_cached_plugin_root(...)` 现在改为：
    - 先在 versioned `cache/<marketplace>/<plugin>/` 下选择最高版本目录
    - 找不到可用 versioned root 时，再回退到 legacy non-versioned `cache/<plugin>/`
    - marketplace / plugin path component 也改为按 upstream 同样的 sanitize 规则解析，避免 `@scope/plugin@demo.market` 这类真实插件 ID 因路径字符差异被误判成不存在
  - 这样 `runtime_project_hooks.rs` 与 `skills/loader.rs` 继续共享同一个 resolver 时，会同时获得：
    - versioned cache 优先
    - legacy cache fallback
    - `@builtin` / managed policy gap 的统一 skipped reason
  - 这一步只对齐 Claude Code 当前仍承认的 legacy cache path，不等于把 Lime 自己的 installer、`.aster` 插件目录或其它非 Claude cache 面接回 current
- 也补了最贴边界的回归测试，锁住 resolver 口径：
  - 只有 legacy `cache/<plugin>/` 时，仍能解析出 plugin root
  - versioned 与 legacy 同时存在时，必须优先选 versioned root
  - scoped plugin / 带点号 marketplace 会命中 sanitize 后的 cache 路径
  - `runtime_project_hooks.rs` 已补消费者级 legacy cache 集成测试，证明 plugin hook 当前主链也会吃到这条 fallback
  - `skills/loader.rs` 已补消费者级 sanitized path 集成测试，证明 plugin skill 当前主链也会吃到同一条 path 规则
- 这一步后的 `CCD-008` 边界继续收紧为：
  - `current`：plugin hooks / plugin skills 继续共享单一 `claude_plugin_cache.rs` resolver，当前口径已覆盖 home/workspace `settings*.json` 合并、highest-version 选择，以及 upstream 仍承认的 legacy cache fallback
  - `current gap`：push-style plugin settings listener、managed policy merge、builtin plugin registry / hooks 仍无 honest host；这些差距继续保留为 gap，不做假映射
  - `compat / deprecated / dead`：无新增；本轮没有把其它 plugin installer、legacy manager 或 `.aster policySettings` 抬回 current
- 这一步服务路线图主目标的关系是：把 `CCD-008` 在 plugin cache resolver 这一层收成真正与 upstream 一致的 current 事实源，避免后续实现者继续把“只认 versioned cache”的半截语义误当成已经对齐。
- 已执行定向校验：
  - `rustfmt --edition 2021 "src-tauri/src/commands/aster_agent_cmd/runtime_project_hooks.rs" "src-tauri/crates/aster-rust/crates/aster/src/skills/loader.rs"` 通过
  - `cargo test --manifest-path "src-tauri/Cargo.toml" -p lime load_runtime_project_hook_registry_should_include_legacy_cached_plugin_user_prompt_hooks -- --nocapture` 通过（`1 passed`）
  - `cargo test --manifest-path "src-tauri/crates/aster-rust/crates/aster/Cargo.toml" test_load_skills_from_plugin_cache_uses_sanitized_plugin_cache_paths --lib -- --nocapture` 通过（`1 passed`）
  - `cargo check --manifest-path "src-tauri/Cargo.toml" -p lime --tests` 通过

### 继续推进（CCD-008 / legacy plugin manifest fallback）

- 继续对照本地参考运行时 [`pluginLoader.ts`](../../../../js/claudecode/src/utils/plugins/pluginLoader.ts) 后，又确认 plugin hook loader 还有一条当前仍有效的旧布局读取语义：
  - upstream 读取 plugin manifest 时，优先 `.claude-plugin/plugin.json`
  - 若主路径不存在，仍会 fallback 到根目录 `plugin.json`
- Lime 之前的 [`runtime_project_hooks.rs`](../../src-tauri/src/commands/aster_agent_cmd/runtime_project_hooks.rs) 只读 `.claude-plugin/plugin.json`，这会让一部分旧 cache 布局下的 plugin hooks 被误判成“没有 manifest hooks”。
- 因此这一轮继续补的是当前真实读取顺序，而不是新造 compat：
  - plugin hook loader 现在改为 `resolve_plugin_manifest_path(...)`
  - 顺序固定为：
    - 先读 `.claude-plugin/plugin.json`
    - 若不存在，再读 legacy 根目录 `plugin.json`
  - 如果主路径存在，就不会去用 legacy 路径顶替，保持与 upstream 同样的优先级
- 也补了对应消费者级集成测试：
  - versioned plugin cache + legacy 根目录 `plugin.json` 时，`runtime_project_hooks` 仍能加载 `UserPromptSubmit` hook
- 这一步后的 `CCD-008` 边界继续收紧为：
  - `current`：plugin hook 当前主链现在同时对齐了 upstream 的 cache path 解析顺序与 manifest path 解析顺序
  - `current gap`：push-style plugin settings listener、managed policy merge、builtin plugin registry / hooks 仍无 honest host
  - `compat / deprecated / dead`：无新增；这一轮没有把旧 installer 或其他非 current plugin 面接回运行时
- 这一步服务路线图主目标的关系是：把 `CCD-008` 的 plugin hook loader 再往 upstream 当前真实布局推进一层，避免“cache 目录找对了，但 manifest 仍漏读 legacy layout”这种半对齐状态。
- 已执行定向校验：
  - `rustfmt --edition 2021 "src-tauri/src/commands/aster_agent_cmd/runtime_project_hooks.rs"` 通过
  - `cargo test --manifest-path "src-tauri/Cargo.toml" -p lime load_runtime_project_hook_registry_should_include_legacy_manifest_plugin_user_prompt_hooks -- --nocapture` 通过（`1 passed`）
  - `cargo check --manifest-path "src-tauri/Cargo.toml" -p lime --tests` 通过

### 继续推进（CCD-008 / plugin manifest.skills current）

- 继续对照本地参考运行时 [`pluginLoader.ts`](../../../../js/claudecode/src/utils/plugins/pluginLoader.ts) 与 [`loadPluginCommands.ts`](../../../../js/claudecode/src/utils/plugins/loadPluginCommands.ts) 后，又确认 plugin skill loader 还有一条当前真实发现语义：
  - upstream 不只是扫默认 `skills/`
  - `plugin.json` 的 `skills` 字段会显式指定 plugin skill 目录
  - 并且按当前执行代码，`manifest.skills` 一旦存在，就不再自动注册默认 `skills/` 目录；只有 `manifest.skills` 缺席时才做默认 autodetect
  - 每个 skill path 既可以是“目录本身就是一个 skill（含 `SKILL.md`）”，也可以是“目录下再挂多个 skill 子目录”
- Lime 之前的 [`loader.rs`](../../src-tauri/crates/aster-rust/crates/aster/src/skills/loader.rs) 只会扫 `plugin_root/skills/*/SKILL.md`，因此：
  - manifest 指定的额外 skill 目录不会进入 current
  - 根目录 `plugin.json` 这条 legacy manifest fallback 也不会影响 plugin skill 发现
  - `manifest.skills` 存在时默认 `skills/` 是否应继续自动加载，也与 upstream 当前执行语义不一致
- 因此这一轮继续把 plugin skill current 主链收口到 upstream 当前 loader 语义：
  - [`claude_plugin_cache.rs`](../../src-tauri/crates/aster-rust/crates/aster/src/claude_plugin_cache.rs) 新增共享 `resolve_cached_plugin_manifest_path(...)`
  - [`runtime_project_hooks.rs`](../../src-tauri/src/commands/aster_agent_cmd/runtime_project_hooks.rs) 与 [`loader.rs`](../../src-tauri/crates/aster-rust/crates/aster/src/skills/loader.rs) 都统一复用这条 manifest path 事实源，不再各自维护 `.claude-plugin/plugin.json` / 根目录 `plugin.json` fallback
  - plugin skills 现在改为：
    - `manifest.skills` 缺席：只自动扫描默认 `skills/`
    - `manifest.skills` 存在：只加载 manifest 显式声明的 skill 目录
    - 单个 skill 目录和“skill 容器目录”两种形态都支持
    - 同一路径命中的 `SKILL.md` 会做去重，避免标准目录与显式目录重叠时重复装载
- 这一步后的 `CCD-008` 边界继续收紧为：
  - `current`：plugin skill loader 现在同时对齐了 upstream 的 cache path、manifest path、以及 `manifest.skills` 发现优先级
  - `current gap`：push-style plugin settings listener、managed policy merge、builtin plugin registry / hooks 仍无 honest host；这些差距继续保留为 gap
  - `compat / deprecated / dead`：无新增；本轮没有把旧 plugin installer 或其它非 current plugin 面接回技能主链
- 这一步服务路线图主目标的关系是：把 `CCD-008` 的 plugin skill loader 从“只认默认目录”的半对齐推进到“manifest 显式技能路径也进入 current”，避免后续实现者继续按错误的自动发现规则补 plugin skills。
- 已执行定向校验：
  - `rustfmt --edition 2021 "src-tauri/crates/aster-rust/crates/aster/src/claude_plugin_cache.rs" "src-tauri/crates/aster-rust/crates/aster/src/skills/loader.rs" "src-tauri/src/commands/aster_agent_cmd/runtime_project_hooks.rs"` 通过
  - `cargo test --manifest-path "src-tauri/crates/aster-rust/crates/aster/Cargo.toml" test_load_skills_from_plugin_cache_prefers_manifest_skills_paths_and_legacy_manifest --lib -- --nocapture` 通过（`1 passed`）
  - `cargo test --manifest-path "src-tauri/Cargo.toml" -p lime load_runtime_project_hook_registry_should_include_legacy_manifest_plugin_user_prompt_hooks -- --nocapture` 通过（`1 passed`）
  - `cargo check --manifest-path "src-tauri/Cargo.toml" -p lime --tests` 通过

### 继续推进（CCD-008 / plugin manifest path strictness）

- 继续对照本地参考运行时 [`pluginLoader.ts`](../../../../js/claudecode/src/utils/plugins/pluginLoader.ts) 与 [`schemas.ts`](../../../../js/claudecode/src/utils/plugins/schemas.ts) 后，又确认 plugin loader 还差一层当前真实的 manifest path 约束：
  - upstream 不是“拿到 manifest 后宽松拼路径再试”
  - `PluginManifestSchema` 会先把 `manifest.skills` 约束成必须以 `./` 开头的相对路径
  - `manifest.hooks` 的 path 版本则进一步要求必须是 `./*.json`
  - `createPluginFromPath(...)` 对 hooks 还保留 strict duplicate 语义：`hooks/hooks.json` 自动加载后，如果 `manifest.hooks` 再指回同一个文件，会记为 duplicate error，而不是静默接受
- Lime 之前在 [`loader.rs`](../../src-tauri/crates/aster-rust/crates/aster/src/skills/loader.rs) 与 [`runtime_project_hooks.rs`](../../src-tauri/src/commands/aster_agent_cmd/runtime_project_hooks.rs) 虽然已经能读 `manifest.skills` / `manifest.hooks`，但仍有两处比 upstream 更松的行为：
  - `skills` / `hooks` 路径接受 `"extra-skill"`、`"hooks/extra.json"` 这类不带 `./` 的写法
  - `manifest.hooks` 指回标准 `hooks/hooks.json` 时只会静默去重，不会显式报告 duplicate
- 因此这一轮继续把 plugin manifest path current 主链收口到 upstream 当前 loader 语义：
  - [`claude_plugin_cache.rs`](../../src-tauri/crates/aster-rust/crates/aster/src/claude_plugin_cache.rs) 新增共享 helper：
    - `load_cached_plugin_manifest_json(...)`
    - `validate_claude_manifest_relative_path(...)`
    - `resolve_claude_manifest_relative_path(...)`
  - 这层 helper 现在会统一：
    - 只接受 Claude 当前风格的 `./...` manifest 相对路径
    - 对 hooks path 额外要求 `.json`
    - 按 Node `path.join(...)` 的当前语义把 `./` 规范掉，避免 Rust `PathBuf` 保留字面 `./` 造成路径表示漂移
  - [`loader.rs`](../../src-tauri/crates/aster-rust/crates/aster/src/skills/loader.rs) 现在改为：
    - `manifest.skills` 解析失败、类型不对、路径不带 `./`、或 manifest 自身损坏时，都会显式进入 skipped reason
    - 一旦 manifest 提供了非法 `skills` 配置，就不再偷偷回退默认 `skills/`
    - `build_plugin_skill_registry_snapshot_with_context(...)` 也会带出同一套 skipped 信息，方便后续 refresh/current 诊断
  - [`runtime_project_hooks.rs`](../../src-tauri/src/commands/aster_agent_cmd/runtime_project_hooks.rs) 现在改为：
    - 先验证 cached plugin manifest，再决定是否继续加载 plugin hooks
    - `manifest.hooks` path 只认 `./*.json`
    - 如果 `manifest.hooks` 指回已自动加载的 `hooks/hooks.json`，会显式记录 duplicate skipped reason，对齐 upstream strict 行为
- 这一步后的 `CCD-008` 边界继续收紧为：
  - `current`：plugin skill / plugin hook loader 现在继续共享单一 manifest path 事实源，当前口径已覆盖 `./` 前缀约束、hooks `.json` 约束、`./` 规范化，以及 duplicate hooks file 显式报告
  - `current gap`：managed plugin policy merge、builtin plugin registry / hooks、push-style plugin settings listener 仍无 honest host；这些差距继续保留为 gap
  - `compat / deprecated / dead`：无新增；本轮没有为了迁就旧 plugin manifest 写法再补宽松 fallback
- 这一步服务路线图主目标的关系是：把 `CCD-008` 从“能加载 plugin manifest，但边界仍比 upstream 松”的半对齐，推进到“manifest path 语义也按 upstream current 收紧”，避免后续实现者继续把宽松路径当成 current 契约。
- 已执行定向校验：
  - `rustfmt --edition 2021 "src-tauri/crates/aster-rust/crates/aster/src/claude_plugin_cache.rs"` 通过
  - `CARGO_NET_OFFLINE=true CARGO_TARGET_DIR="/tmp/lime-target-offline" cargo test --manifest-path "src-tauri/crates/aster-rust/crates/aster/Cargo.toml" load_cached_plugin_manifest_json_should --lib -- --nocapture` 通过（`1 passed`）
  - `CARGO_NET_OFFLINE=true CARGO_TARGET_DIR="/tmp/lime-target-offline" cargo test --manifest-path "src-tauri/crates/aster-rust/crates/aster/Cargo.toml" validate_claude_manifest_relative_path_should_ --lib -- --nocapture` 通过（`1 passed`）
  - `CARGO_NET_OFFLINE=true CARGO_TARGET_DIR="/tmp/lime-target-offline" cargo test --manifest-path "src-tauri/crates/aster-rust/crates/aster/Cargo.toml" test_load_skills_from_plugin_cache --lib -- --nocapture` 通过（`4 passed`）
  - `CARGO_NET_OFFLINE=true CARGO_TARGET_DIR="/tmp/lime-target-offline" cargo test --manifest-path "src-tauri/Cargo.toml" -p lime load_runtime_plugin_hook_registry_should_ -- --nocapture` 通过（`2 passed`）
  - `CARGO_NET_OFFLINE=true CARGO_TARGET_DIR="/tmp/lime-target-offline" cargo test --manifest-path "src-tauri/Cargo.toml" -p lime load_runtime_project_hook_registry_should_include_ -- --nocapture` 通过（`4 passed`）

### 继续推进（CCD-008 / plugin manifest validity gate）

- 继续对照本地参考运行时 [`schemas.ts`](../../../../js/claudecode/src/utils/plugins/schemas.ts) 与 [`pluginLoader.ts`](../../../../js/claudecode/src/utils/plugins/pluginLoader.ts) 后，又确认 Lime 之前还有一层“看起来能跑、其实仍比 upstream 松”的空档：
  - `load_cached_plugin_manifest_json(...)` 之前只校验“是不是 JSON object”
  - 这会导致 `manifest.name`、`manifest.commands`、`manifest.agents`、`manifest.outputStyles` 这类字段即使已经偏离 Claude current schema，只要 `skills/hooks` 自己那一小段还能解析，Lime 仍会继续把 plugin 当成可加载
  - upstream 当前不是按 surface 局部放行，而是先过整份 `PluginManifestSchema`，manifest 任一 current 字段失真，就整份 plugin 失效
- 因此这一轮继续把 plugin manifest current 主链收口到 upstream 当前 schema gate：
  - [`claude_plugin_cache.rs`](../../src-tauri/crates/aster-rust/crates/aster/src/claude_plugin_cache.rs) 新增共享 `validate_cached_plugin_manifest_compat(...)`
  - 这层 helper 现在会统一校验：
    - `manifest.name`：必填、非空、不能包含空格
    - `manifest.version` / `manifest.description`：若存在必须为 string
    - `manifest.skills` / `manifest.outputStyles`：只认 `./...` 的 `string | string[]`
    - `manifest.agents`：只认 `./*.md` 的 `string | string[]`
    - `manifest.hooks`：只认 `./*.json` path、inline hooks object、或两者数组
    - `manifest.commands`：只做 schema 级校验，接受 `string | string[] | object-map`，object metadata 必须满足 `source` 与 `content` 二选一等当前约束
  - [`load_cached_plugin_manifest_json(...)`](../../src-tauri/crates/aster-rust/crates/aster/src/claude_plugin_cache.rs) 现在会先过这层共享 gate，再把 manifest 交给 [`loader.rs`](../../src-tauri/crates/aster-rust/crates/aster/src/skills/loader.rs) 和 [`runtime_project_hooks.rs`](../../src-tauri/src/commands/aster_agent_cmd/runtime_project_hooks.rs)
  - 结果上，`skills/hooks` current surface 不再各自“只管自己那一段”；只要 manifest 整体偏离 Claude current schema，就会一起短路
- 这一步后的 `CCD-008` 边界继续收紧为：
  - `current`：plugin manifest 现在已有共享有效性事实源，`skills` 与 `hooks` 都跟着同一份 upstream-style schema gate 走
  - `current gap`：`manifest.commands` 仍只有 schema gate，没有 honest host；`outputStyles` 也仍缺当前宿主；managed policy、builtin plugin registry、push-style settings listener 仍保留为 gap
  - `compat / deprecated / dead`：无新增；本轮没有把旧 installer validator、旧 plugin 面、或任意假兼容包装接回 current
- 这一步服务路线图主目标的关系是：把 `CCD-008` 从“路径语义接近 upstream，但 manifest 仍可能局部穿透”的半对齐，推进到“manifest 必须先整体合法，当前 `skills/hooks` 才能生效”，避免后续继续把局部可解析误当成 Claude current 对齐完成。
- 已执行定向校验：
  - `rustfmt --edition 2021 "src-tauri/crates/aster-rust/crates/aster/src/claude_plugin_cache.rs" "src-tauri/crates/aster-rust/crates/aster/src/skills/loader.rs" "src-tauri/src/commands/aster_agent_cmd/runtime_project_hooks.rs"` 通过
  - `CARGO_NET_OFFLINE=true CARGO_TARGET_DIR="/tmp/lime-target-offline" cargo test --manifest-path "src-tauri/crates/aster-rust/crates/aster/Cargo.toml" load_cached_plugin_manifest_json_should_ --lib -- --nocapture` 通过（`3 passed`）
  - `CARGO_NET_OFFLINE=true CARGO_TARGET_DIR="/tmp/lime-target-offline" cargo test --manifest-path "src-tauri/crates/aster-rust/crates/aster/Cargo.toml" test_load_skills_from_plugin_cache --lib -- --nocapture` 通过（`5 passed`）
  - `CARGO_NET_OFFLINE=true CARGO_TARGET_DIR="/tmp/lime-target-offline" cargo test --manifest-path "src-tauri/Cargo.toml" -p lime load_runtime_plugin_hook_registry_should_ -- --nocapture` 通过（`3 passed`）
  - `CARGO_NET_OFFLINE=true CARGO_TARGET_DIR="/tmp/lime-target-offline" cargo test --manifest-path "src-tauri/Cargo.toml" -p lime load_runtime_project_hook_registry_should_include_ -- --nocapture` 通过（`4 passed`）

### 继续推进（CCD-008 / plugin agents current）

- 继续对照本地参考运行时 [`loadPluginAgents.ts`](../../../../js/claudecode/src/utils/plugins/loadPluginAgents.ts)、[`loadAgentsDir.ts`](../../../../js/claudecode/src/tools/AgentTool/loadAgentsDir.ts) 与 [`prompt.ts`](../../../../js/claudecode/src/tools/AgentTool/prompt.ts) 后，确认 plugin agents 在 upstream 里不是文案层概念，而是真正进入 subagent runtime 的 current surface。
- 因此这一轮没有去接旧 installer、builtin preset / profile、`.aster policySettings` 或其他伪 current 面，而是只把 Lime 当前已有 honest host 的 plugin agent 子集接到真实 runtime：
  - [`runtime_plugin_agents.rs`](../../src-tauri/src/commands/aster_agent_cmd/runtime_plugin_agents.rs) 新增 plugin agent catalog loader，唯一事实源复用 [`claude_plugin_cache.rs`](../../src-tauri/crates/aster-rust/crates/aster/src/claude_plugin_cache.rs) 的 enabled plugin cache 解析结果
  - 当前实际承接的字段只有：`agent_type`、`description / when-to-use`、markdown body -> `system_prompt`、`model`、`tools`、`disallowedTools`
  - `${CLAUDE_PLUGIN_ROOT}` 现在会在 plugin agent prompt 里做真实替换；`tools / disallowedTools` 不是只进 prompt 文案，而是继续落到 Lime 现有 `allowed_tools / disallowed_tools` 真实权限边界
  - [`subagent_runtime.rs`](../../src-tauri/src/commands/aster_agent_cmd/subagent_runtime.rs) 现在会在 `spawn_subagent` 时按 `agent_type -> plugin definition` 叠加 system prompt、model override、tool scope
  - [`runtime_turn.rs`](../../src-tauri/src/commands/aster_agent_cmd/runtime_turn.rs) 现在会把“当前可用 plugin agent types”并入主会话的 `RuntimeAgents` prompt augmentation，避免主 agent 看不到 plugin agent surface
- 这一轮也把 unsupported 边界继续收紧成 fail-closed，而不是做假兼容：
  - `skills`、`memory`、`effort`、`maxTurns / max_turns`、`isolation`：当前没有 honest host，整条 plugin agent definition 会被跳过并记录原因
  - `${user_config.*}`：当前没有对应宿主，直接 fail-closed
  - `permissionMode`、`hooks`、`mcpServers`：按 upstream 当前语义只记 warning，不额外硬接宿主
  - 测试里顺手修正了 plugin cache ID 口径：Lime 当前 `claude_plugin_cache` 只认 `plugin@marketplace`，不是 `market/plugin` 或 `@market/plugin`
- 这一步后的 `CCD-008` 边界继续收紧为：
  - `current`：plugin marketplace cache 里的 agent definitions 已进入 Lime 当前 subagent runtime 主链，真实承接了 prompt / model / tool scope 三个当前宿主
  - `current gap`：plugin agent 的 `skills / memory / effort / maxTurns / isolation` 仍无 honest host，继续 fail-closed；managed policy、builtin plugin registry / hooks、push-style settings listener 仍保留为 gap
  - `compat / deprecated / dead`：无新增；本轮没有为了“看起来兼容”去接旧 plugin 面、旧 preset 面或任意 policy 包装层
- 这一步服务路线图主目标的关系是：把 `CCD-008` 从“plugin skills / hooks 已 current，但 plugin 自带 agents 仍完全绕开 runtime”的断层，推进到“plugin agents 也进入当前 subagent 主路径”；后续剩余差距就集中在 unsupported agent fields 与 plugin loader 生命周期缺口，而不是继续卡在 agent surface 本身。
- 已执行定向校验：
  - `rustfmt --edition 2021 "src-tauri/src/commands/aster_agent_cmd/runtime_plugin_agents.rs" "src-tauri/src/commands/aster_agent_cmd/subagent_runtime.rs" "src-tauri/src/commands/aster_agent_cmd/mod.rs" "src-tauri/src/commands/aster_agent_cmd/runtime_turn.rs" "src-tauri/src/commands/aster_agent_cmd/tests.rs"` 通过
  - `cargo test --manifest-path "src-tauri/Cargo.toml" runtime_plugin_agents --lib -- --nocapture` 通过（`4 passed`）
  - `cargo test --manifest-path "src-tauri/Cargo.toml" test_build_subagent_customization_state_with_plugin_agent_applies_runtime_overlay_and_tool_scope --lib -- --nocapture` 通过（`1 passed`）

### 继续推进（CCD-008 / Agent current `run_in_background` 透传）

- 继续对照本地参考运行时 [`AgentTool.tsx`](../../../../js/claudecode/src/tools/AgentTool/AgentTool.tsx) 后，确认 `run_in_background` 不是可有可无的展示字段，而是 Claude current `Agent` surface 用来决定 child agent 是否异步运行的真实输入。
- 进一步核对 Lime 当前链路后，确认缺口不在 `aster-rust` schema：
  - [`agent_control.rs`](../../src-tauri/crates/aster-rust/crates/aster/src/tools/agent_control.rs) 已经把 `run_in_background` 解析进 `SpawnAgentRequest`
  - 但 [`subagent_tools.rs`](../../src-tauri/src/commands/aster_agent_cmd/tool_runtime/subagent_tools.rs) 之前在 callback 组装 [`AgentRuntimeSpawnSubagentRequest`](../../src-tauri/src/commands/aster_agent_cmd/dto.rs) 时把它硬编码成了 `false`
  - 结果是 Lime 当前 `Agent` tool surface 会静默吞掉 upstream 已经存在的后台运行语义，和参考运行时不一致
- 因此这一轮没有新增任何 compat 包装，而是把这条 current 字段透传补通：
  - [`subagent_tools.rs`](../../src-tauri/src/commands/aster_agent_cmd/tool_runtime/subagent_tools.rs) 新增小型 request mapping helper，统一负责 `SpawnAgentRequest -> AgentRuntimeSpawnSubagentRequest`
  - `run_in_background` 现在按真实输入继续向下透传，不再在 callback 层被写死
  - 同时补了一条映射单测，直接钉住 `Agent` current surface 的关键字段不再在 Lime host callback 里丢失
- 这一步后的 `CCD-008` 边界继续收紧为：
  - `current`：`Agent` current surface 的 `run_in_background` 已进入 Lime 当前 subagent runtime 主链，至少 metadata / runtime request 已与 upstream 对齐，不再在宿主 callback 处丢字段
  - `current gap`：plugin agent definition 的 `background: true` 仍未承接；`mode / isolation` 也仍没有 honest host，这两项都不应伪装成已支持
  - `compat / deprecated / dead`：无新增；本轮没有为了“先兼容着”去扩展旧 subagent surface
- 这一步服务路线图主目标的关系是：把 `CCD-008` 从“plugin agent prompt/model/tool scope 已 current，但 `Agent` 最基础的后台运行字段仍在 Lime callback 层失真”的状态，推进到“`Agent` current surface 的后台运行语义至少不再被宿主吞掉”；后续下一刀应继续判断是否把 plugin agent 的 `background: true` 也接回同一条主链。
- 已执行定向校验：
  - `rustfmt --edition 2021 "src-tauri/src/commands/aster_agent_cmd/tool_runtime/subagent_tools.rs"` 通过
  - `cargo test --manifest-path "src-tauri/Cargo.toml" test_map_spawn_agent_request_to_runtime_request_preserves_current_surface_fields --lib -- --nocapture` 通过（`1 passed`）
  - `cargo test --manifest-path "src-tauri/Cargo.toml" test_remove_duplicate_current_surface_agent_tool_keeps_send_message --lib -- --nocapture` 通过（`1 passed`）

### 继续推进（CCD-008 / plugin agent `background` current）

- 在补通 `Agent.run_in_background` 之后，继续对照本地参考运行时 [`loadPluginAgents.ts`](../../../../js/claudecode/src/utils/plugins/loadPluginAgents.ts) 与 [`AgentTool.tsx`](../../../../js/claudecode/src/tools/AgentTool/AgentTool.tsx) 后，确认 upstream 还有一层当前事实：
  - plugin agent frontmatter 自带 `background: true`
  - upstream 会把它和显式 `run_in_background` 一起并入 `shouldRunAsync`
  - 因此如果 Lime 只承接显式请求、完全忽略 plugin agent 自带 `background`，current surface 仍然是不完整的
- 继续核对 Lime 当前宿主能力后，也确认这一步只能按 honest host 收口：
  - [`subagent_runtime.rs`](../../src-tauri/src/commands/aster_agent_cmd/subagent_runtime.rs) 当前本来就是统一的后台 queued-turn 启动路径，没有另一套真正的前台 child-agent executor
  - 所以这一轮不能伪造“foreground/background 双引擎”
  - 但至少应该把 plugin agent 的 `background` 收进当前 runtime request / metadata 真相集，避免连 effective background intent 都丢掉
- 因此这一轮继续把 plugin agent `background` 接到同一条 current 主链：
  - [`runtime_plugin_agents.rs`](../../src-tauri/src/commands/aster_agent_cmd/runtime_plugin_agents.rs) 现在会解析 frontmatter `background`
  - [`subagent_runtime.rs`](../../src-tauri/src/commands/aster_agent_cmd/subagent_runtime.rs) 新增 effective background helper，把显式 `run_in_background` 与 plugin agent `background` 合并
  - child subagent turn metadata 里的 `subagent.run_in_background` 现在会写入 effective 值，而不是只看 request 显式字段
- 这一步后的 `CCD-008` 边界继续收紧为：
  - `current`：plugin agent definition 的 `background` 已进入 Lime 当前 subagent runtime 真相集；即使当前执行器仍是统一后台队列，effective background intent 已不再丢失
  - `current gap`：Lime 仍没有 upstream 那种真正区分 foreground/background child execution lifecycle 的宿主；`mode / isolation` 也仍无 honest host，继续保持 unsupported
  - `compat / deprecated / dead`：无新增；本轮没有为了对齐 `background` 去硬造另一套 child runtime
- 这一步服务路线图主目标的关系是：把 `CCD-008` 从“plugin agent prompt/model/tool scope 已 current，显式 `run_in_background` 也透传了，但 plugin 自带 `background` 仍失真”的状态，推进到“plugin agent 与 Agent tool 共享同一套 effective background 事实源”；后续若要继续补，只能往真正的 child lifecycle / notification host 收，不该回头补 compat 包装。
- 已执行定向校验：
  - `rustfmt --edition 2021 "src-tauri/src/commands/aster_agent_cmd/runtime_plugin_agents.rs" "src-tauri/src/commands/aster_agent_cmd/subagent_runtime.rs"` 通过
  - `cargo test --manifest-path "src-tauri/Cargo.toml" load_runtime_plugin_agent_catalog_should_load_supported_agents_and_skip_unsupported_fields --lib -- --nocapture` 通过（`1 passed`）
  - `cargo test --manifest-path "src-tauri/Cargo.toml" test_resolve_effective_run_in_background_prefers_plugin_agent_background --lib -- --nocapture` 通过（`1 passed`）
  - `cargo test --manifest-path "src-tauri/Cargo.toml" test_build_subagent_customization_state_with_plugin_agent_applies_runtime_overlay_and_tool_scope --lib -- --nocapture` 通过（`1 passed`）

### 继续推进（CCD-008 / Agent `mode` current subset）

- 在补通 `run_in_background` / plugin agent `background` 之后，继续对照本地参考运行时 [`AgentTool.tsx`](../../../../js/claudecode/src/tools/AgentTool/AgentTool.tsx) 与 [`PermissionMode.ts`](../../../../js/claudecode/src/utils/permissions/PermissionMode.ts) 后，确认 `mode` 也是 `Agent` current surface 的真实输入，而不是文案字段。
- 继续核对 Lime 当前宿主能力后，确认这条线不能“全量冒充支持”：
  - upstream 的 `plan` 绑定的是完整的 plan-mode / approval lifecycle
  - Lime 当前只有显式 [`EnterPlanMode` / `ExitPlanMode`](../../src-tauri/crates/aster-rust/crates/aster/src/tools/plan_mode_tool.rs) 工具流，没有可附着到 child session 的同构 permission runtime
  - `isolation` 同样仍缺 honest host，尤其 `worktree / remote` 会直接牵到另一套 child lifecycle
- 因此这一轮只把有真实宿主的 `mode` 子集接回 current，而不是做垃圾兼容：
  - [`subagent_tools.rs`](../../src-tauri/src/commands/aster_agent_cmd/tool_runtime/subagent_tools.rs) 不再吞掉 `mode / isolation`，而是完整透传到 runtime request
  - [`subagent_runtime.rs`](../../src-tauri/src/commands/aster_agent_cmd/subagent_runtime.rs) 现在会把：
    - `default` 视为继承父会话 access mode
    - `acceptEdits` 映射到 Lime 现有 `current` access mode
    - `dontAsk` 映射到 Lime 现有 `full-access` access mode
  - `plan` 与 `bypassPermissions` 继续明确 fail-closed，`isolation` 也继续明确拒绝
  - [`prompt_context.rs`](../../src-tauri/src/commands/aster_agent_cmd/prompt_context.rs) 的 current surface 提示也同步收口到这条最新事实，不再笼统声称“任何非空 mode 都拒绝”
- 这一步后的 `CCD-008` 边界继续收紧为：
  - `current`：`Agent.mode` 已进入 Lime 当前 subagent runtime 的 honest subset；`default / acceptEdits / dontAsk` 不再停留在 schema 层，而会真实影响 child access mode
  - `current gap`：`plan` 仍缺可绑定到 child session 的真实 plan-mode lifecycle；`bypassPermissions` 与 `isolation` 也仍无 honest host，继续保持 fail-closed
  - `compat / deprecated / dead`：无新增；本轮没有为了“看起来支持 mode”去长出平行 permission runtime
- 这一步服务路线图主目标的关系是：把 `CCD-008` 从“`Agent` 表面上接受 mode，但 Lime runtime 要么吞字段、要么一刀全拒”的状态，推进到“当前真正有宿主的 mode 子集已经进入 subagent 主链，而剩余部分被明确留在 gap”；后续若继续推进，应优先判断 child-specific plan lifecycle 是否值得 honest 落地，而不是回头给 `plan` / `isolation` 包一层假支持。
- 已执行定向校验：
  - `rustfmt --edition 2021 "src-tauri/src/commands/aster_agent_cmd/tool_runtime/subagent_tools.rs" "src-tauri/src/commands/aster_agent_cmd/subagent_runtime.rs" "src-tauri/src/commands/aster_agent_cmd/prompt_context.rs"` 通过
  - `cargo test --manifest-path "src-tauri/Cargo.toml" test_map_spawn_agent_request_to_runtime_request_preserves_current_surface_fields --lib -- --nocapture` 通过（`1 passed`）
  - `cargo test --manifest-path "src-tauri/Cargo.toml" test_validate_spawn_request_surface_accepts_supported_modes_and_rejects_unsupported_values --lib -- --nocapture` 通过（`1 passed`）
  - `cargo test --manifest-path "src-tauri/Cargo.toml" test_resolve_spawn_request_access_mode_prefers_supported_mode_override --lib -- --nocapture` 通过（`1 passed`）

### 继续推进（CCD-008 / plan mode honest 边界 + plugin agent `isolation` current）

- 继续对照本地参考运行时 [`AgentTool.tsx`](../../../../js/claudecode/src/tools/AgentTool/AgentTool.tsx)、[`loadPluginAgents.ts`](../../../../js/claudecode/src/utils/plugins/loadPluginAgents.ts) 与 Lime 当前宿主实现后，先把 `plan / isolation` 两条线重新核清了一次：
  - [`plan_mode_tool.rs`](../../src-tauri/crates/aster-rust/crates/aster/src/tools/plan_mode_tool.rs) 当前仍把 plan mode 挂在 `GLOBAL_STATE` 上，并且 `EnterPlanMode` 还会显式拒绝 agent context；这说明 Lime 现在仍没有可绑定到 child session 的 plan-mode host，不能把 `Agent.mode=plan` 伪装成已支持。
  - 但 plugin agent 的 `isolation: worktree` 在 upstream 并不是“非法 frontmatter”；[`loadPluginAgents.ts`](../../../../js/claudecode/src/utils/plugins/loadPluginAgents.ts) 会正常加载它，只是在真正 spawn 时再交给宿主能力决定是否能跑。
  - Lime 之前却把 plugin agent 的 `isolation` 放进了 loader 级 unsupported 字段集合，导致包含 `isolation: worktree` 的 plugin agent 在 catalog 阶段就整条被跳过。这不是 honest fail-closed，而是 current surface 漂移。
- 因此这一轮没有去硬接 `worktree` 宿主，而是先把事实源收正：
  - [`runtime_plugin_agents.rs`](../../src-tauri/src/commands/aster_agent_cmd/runtime_plugin_agents.rs) 不再把 `isolation` 当成 loader 级 unsupported 字段；runtime plugin agent catalog 现在会保留 `isolation: worktree` 定义，和 upstream current frontmatter 保持一致。
  - [`subagent_runtime.rs`](../../src-tauri/src/commands/aster_agent_cmd/subagent_runtime.rs) 新增 effective isolation 解析：显式 request isolation 优先，其次才回落到 plugin agent frontmatter。
  - 对 effective isolation 继续保持 fail-closed：只要最终 isolation 非空，runtime 仍会明确返回 `isolation is not supported in the current runtime`，而不是静默吞掉或假装已经进入 worktree lifecycle。
  - child turn metadata 里的 `subagent.isolation` 也收口到 effective 值，避免 request 为空但 plugin agent 自带 isolation 时继续写出失真的 metadata。
- 这一步后的 `CCD-008` 边界继续收紧为：
  - `current`：plugin agent `isolation` 已进入 Lime 当前 runtime catalog 真相集；Lime 不再在加载期错误跳过 upstream 合法的 plugin agent definition。
  - `current gap`：`worktree` 仍没有接上 Claude 那套创建 / cwd override / cleanup 生命周期，因此 spawn 侧继续 honest fail-closed；`mode=plan` 也仍缺 child-session scoped host，继续保持 gap。
  - `compat / deprecated / dead`：无新增；本轮没有为了“先看起来支持 isolation”去伪造 worktree session 或平移旧实现。
- 这一步服务路线图主目标的关系是：把 `CCD-008` 从“plugin agent current frontmatter 在 Lime loader 阶段就失真”的状态，推进到“catalog 事实源已对齐，剩余缺口只集中在真正的 worktree / plan host lifecycle”；下一刀如果继续推进，应优先判断是否值得 honest 落地 child worktree host，而不是再回头补 compat 包装。
- 已执行定向校验：
  - `rustfmt --edition 2021 "src-tauri/src/commands/aster_agent_cmd/runtime_plugin_agents.rs" "src-tauri/src/commands/aster_agent_cmd/subagent_runtime.rs"` 通过
  - `cargo test --manifest-path "src-tauri/Cargo.toml" load_runtime_plugin_agent_catalog_should_load_supported_agents_and_skip_unsupported_fields --lib -- --nocapture` 通过（`1 passed`）
  - `cargo test --manifest-path "src-tauri/Cargo.toml" test_resolve_effective_isolation_prefers_request_then_plugin_agent --lib -- --nocapture` 通过（`1 passed`）
  - `cargo test --manifest-path "src-tauri/Cargo.toml" test_validate_effective_spawn_isolation_rejects_plugin_agent_default --lib -- --nocapture` 通过（`1 passed`）

### 继续推进（CCD-008 / worktree honest host 接线）

- 继续严格对照本地参考运行时 `/Users/coso/Documents/dev/js/claudecode` 的 `AgentTool.tsx / worktree.ts / resumeAgent.ts` 后，这一轮没有再停在“catalog 接住 isolation，但 spawn 继续全拒”的中间态，而是把 Lime 已有的 Aster worktree host 真正接回了 subagent current 主链：
  - [`subagent_runtime.rs`](../../src-tauri/src/commands/aster_agent_cmd/subagent_runtime.rs) 现在会在 effective isolation 为 `worktree` 时直接复用 Aster 现成的 [`EnterWorktreeTool`](../../src-tauri/crates/aster-rust/crates/aster/src/tools/worktree_tools.rs)，不再重写一套 git worktree 生命周期。
  - `close_subagent` 现在也会复用 [`ExitWorktreeTool`](../../src-tauri/crates/aster-rust/crates/aster/src/tools/worktree_tools.rs) 做 honest 收尾：
    - worktree 干净时自动移除，并把 session 恢复回原目录
    - worktree 有改动时保留现状，后续 `resume` / `send` 继续沿用同一个 worktree
  - 这一步和 upstream 的“无改动清理、有改动保留”事实源保持一致，但没有为了表面对齐去伪造另一套 cleanup 逻辑。
- 同时把 Lime 本地真正的阻塞点一并收掉：
  - `resolve_workspace_id_for_working_dir(...)` 不再只认 workspace root 精确匹配；现在会对 `working_dir` 做最长祖先 workspace 匹配。
  - 因此 `cwd` 指向 workspace 子目录，以及 `.aster/worktrees/<slug>` 这种 child worktree 目录，现在都能正确映回原 workspace，不会再在 spawn / send 阶段因为 `working_dir` 不等于 root 而失败。
- 这一轮仍保持 honest fail-closed，没有为了“看起来像 upstream”硬编不存在的宿主语义：
  - `isolation=remote` 继续明确拒绝
  - `cwd + isolation=worktree` 继续明确拒绝，因为 Lime 当前 persistent subagent runtime 还不能诚实承接 upstream 那组组合语义
  - `mode=plan / bypassPermissions` 仍保持之前的 fail-closed 边界
- [`prompt_context.rs`](../../src-tauri/src/commands/aster_agent_cmd/prompt_context.rs) 的 current surface 提示也已经同步更新，不再继续向模型暴露“non-empty isolation 全不支持”的过时事实。
- 这一步后的 `CCD-008` 边界进一步收紧为：
  - `current`：`Agent.isolation=worktree`、plugin agent `isolation: worktree`、clean-remove / dirty-keep 的 child worktree close lifecycle、workspace 子目录与 `.aster/worktrees/*` 的 workspace 归属
  - `current gap`：`isolation=remote`、`cwd + worktree` 组合语义、child-scoped `plan` lifecycle
  - `compat / deprecated / dead`：无新增；本轮没有为了迁就现状去长第二套 compat worktree 实现
- 已执行定向校验：
  - `cargo test --manifest-path "src-tauri/Cargo.toml" test_validate_spawn_request_surface_accepts_supported_modes_and_rejects_unsupported_values --lib -- --nocapture`
  - `cargo test --manifest-path "src-tauri/Cargo.toml" test_validate_effective_spawn_isolation_accepts_worktree_and_rejects_unsupported_values --lib -- --nocapture`
  - `cargo test --manifest-path "src-tauri/Cargo.toml" test_resolve_workspace_id_for_working_dir_prefers_longest_ancestor_workspace --lib -- --nocapture`
  - `cargo test --manifest-path "src-tauri/Cargo.toml" test_maybe_enter_subagent_worktree_switches_session_to_worktree --lib -- --nocapture`
  - `cargo test --manifest-path "src-tauri/Cargo.toml" test_cleanup_subagent_worktree_for_close_removes_clean_and_keeps_dirty_worktree --lib -- --nocapture`

### 继续推进（CCD-008 / missing worktree fallback）

- 在把 `worktree` honest host 接回 child runtime 后，继续对照本地参考运行时 [`resumeAgent.ts`](../../../../js/claudecode/src/tools/AgentTool/resumeAgent.ts) 复盘了一次恢复链路，确认还有一个很贴边界的 current 漏口：
  - upstream 在 resume 前会先检查 `meta.worktreePath` 是否仍是有效目录；如果 worktree 已被外部删除，就直接回退到 parent cwd，而不是继续拿坏路径做后续执行上下文。
  - Lime 之前虽然已经有了 dirty-keep 的 child worktree close lifecycle，但如果该 worktree 之后被外部清理，`send_subagent_input / resume_subagent / close_subagent` 仍会继续读到陈旧 `working_dir + WorktreeSessionState`，把坏掉的路径继续沿 child runtime 传播。
- 因此这一轮没有去发明新的 worktree 宿主，而是把恢复保护补到现有 current 边界上：
  - [`subagent_runtime.rs`](../../src-tauri/src/commands/aster_agent_cmd/subagent_runtime.rs) 新增 `resolve_missing_subagent_worktree_restore(...)`，把“检测到 `worktree_path` 已丢失时，该回退到哪里、该清掉哪份 extension state”的决策收成单一事实源。
  - 同文件里的 `restore_missing_subagent_worktree_if_needed(...)` 会复用这份决策，在真正需要时把 child session 的 `working_dir` 回退到 `original_cwd`，并移除陈旧 `WorktreeSessionState`。
  - `agent_runtime_send_subagent_input_internal(...)`、`agent_runtime_resume_subagent_internal(...)` 与 `agent_runtime_close_subagent_internal(...)` 现在都会先经过这层恢复保护，再继续各自的队列恢复、输入投递或 close cleanup 流程。
- 这一步后的 `CCD-008` 边界进一步收紧为：
  - `current`：child worktree 在 dirty-keep 后若被外部删除，`send / resume / close` 会先回退到 `original_cwd` 并清理 stale worktree state，不再继续沿坏路径执行。
  - `current gap`：`isolation=remote`、`cwd + worktree` 组合语义、child-scoped `plan` lifecycle 仍未进入 honest host。
  - `compat / deprecated / dead`：无新增；本轮没有为了“让恢复先跑起来”去长第二套 worktree 状态源。
- 这一步服务路线图主目标的关系是：把 `CCD-008` 里刚接回来的 child worktree current 从“能创建、能保留，但恢复链路遇到外部删除就掉回坏状态”的半成品，推进到“至少在现有 host 之内具备 upstream 同类的最小恢复韧性”；下一刀若继续推进，应优先判断 `cwd + isolation=worktree` 能否 honest 落地，而不是回头补 compat 包装。
- 已执行定向校验：
  - `rustfmt --edition 2021 "src-tauri/src/commands/aster_agent_cmd/subagent_runtime.rs"` 通过
  - `cargo test --manifest-path "src-tauri/Cargo.toml" test_resolve_missing_subagent_worktree_restore_falls_back_to_original_cwd --lib -- --nocapture` 通过（`1 passed`）
  - `cargo test --manifest-path "src-tauri/Cargo.toml" test_resolve_workspace_id_for_working_dir_prefers_longest_ancestor_workspace --lib -- --nocapture` 通过（`1 passed`）
  - `cargo test --manifest-path "src-tauri/Cargo.toml" test_validate_effective_spawn_isolation_accepts_worktree_and_rejects_unsupported_values --lib -- --nocapture` 通过（`1 passed`）

### 继续推进（CCD-008 / final status worktree auto cleanup）

- 继续严格对照本地参考运行时 [`AgentTool.tsx`](../../../../js/claudecode/src/tools/AgentTool/AgentTool.tsx) 后，又补上了一处之前还没 honest 对齐的 child worktree 生命周期：
  - upstream 在 agent 自然结束时就会尝试清理 worktree；只有检测到未提交改动或额外提交时才保留 worktree，供后续继续处理。
  - Lime 之前虽然已经在 `close_subagent` 路径接上了 `clean-remove / dirty-keep`，但 child session 自然进入 `Completed / Failed / Aborted` 时不会自动清理，导致干净 worktree 会一直挂到显式 `close_agent` 才回收。
- 因此这一轮没有再造一套 git 清理器，而是继续复用现有 Aster host：
  - [`subagent_runtime.rs`](../../src-tauri/src/commands/aster_agent_cmd/subagent_runtime.rs) 新增 `should_auto_cleanup_subagent_worktree(...)` 与 `maybe_cleanup_subagent_worktree_after_runtime_event(...)`，把“哪些 runtime 终态应该尝试自动回收 worktree”收口成单一事实源。
  - `maybe_emit_subagent_status_for_runtime_event(...)` 现在会在 relevant runtime event 进入 child final status 后，先尝试复用 [`ExitWorktreeTool`](../../src-tauri/crates/aster-rust/crates/aster/src/tools/worktree_tools.rs) 做 clean-remove / dirty-keep，再发状态事件。
  - 如果 worktree 已被外部删除，仍会先经过前一轮补上的 missing-worktree fallback，回退 `original_cwd` 并移除 stale `WorktreeSessionState`，不会把坏路径继续带进自动清理流程。
- 这一步后的 `CCD-008` 边界继续收紧为：
  - `current`：`Agent.isolation=worktree` 现在同时具备 `spawn -> natural final status auto cleanup -> explicit close cleanup -> missing-worktree fallback` 的 honest child lifecycle；干净 worktree 不再需要额外依赖手动 close 才回收。
  - `current gap`：`isolation=remote`、`cwd + worktree` 组合语义、child-scoped `plan` lifecycle 仍未进入 honest host。
  - `compat / deprecated / dead`：无新增；本轮没有为了“补自动清理”去发明第二套 worktree 状态源或自写 git remove 流程。
- 这一步服务路线图主目标的关系是：把 `CCD-008` 的 child worktree current 从“能创建、能恢复、能在 close 时清理”的半收口状态，推进到“自然结束时也按 upstream 语义自动收尾”的更完整主链；下一刀若继续推进，应优先判断 `cwd + worktree` 是否有 honest host，而不是回头补手动约定或兼容包裹。
- 已执行定向校验：
  - `rustfmt --edition 2021 "src-tauri/src/commands/aster_agent_cmd/subagent_runtime.rs"` 通过
  - `env CARGO_TARGET_DIR="/tmp/lime-target-subagent-worktree" cargo test --manifest-path "src-tauri/Cargo.toml" "commands::aster_agent_cmd::subagent_runtime::tests::" --lib -- --nocapture` 通过（`18 passed`）

### 继续推进（CCD-008 / `cwd + worktree` honest host）

- 继续严格对照本地参考实现 [`AgentTool.tsx`](../../../../js/claudecode/src/tools/AgentTool/AgentTool.tsx) 后，这一轮把之前那条“看起来放开了组合，实际却把 child `working_dir` 回写到原仓库路径”的半成品收成了 honest host：
  - upstream 真实执行面虽然仍带着 “Mutually exclusive” 的旧 schema 文案，但实际代码已经允许 `cwd + isolation=worktree` 共存。
  - Lime 上一版也开始尝试承接这组语义，但当时仍把 child session 先绑到 bootstrap 目录、进入 worktree 后再直接写回原始 `cwd`；这会让 child 后续 filesystem / shell 行为重新落回原仓库，而不是 child worktree。
- 因此这一轮没有继续补 compat，而是把组合语义真正收口到现有 Aster worktree host 内：
  - [`subagent_runtime.rs`](../../src-tauri/src/commands/aster_agent_cmd/subagent_runtime.rs) 新增 `resolve_subagent_worktree_cwd_mapping(...)`，只在 `cwd` 属于父会话同一 Git 仓库时放行，并把请求目录映射成“源 worktree 根 -> 目标 child worktree 根”的相对路径。
  - 同文件里的 `resolve_subagent_session_bootstrap_working_dir(...)` 也同步改回以真实 `execution_working_dir` 建 child session，不再为了进 worktree 先把 child session 绑到父目录；这样 `EnterWorktreeTool` 记录下来的 `original_cwd` 就仍然是显式请求的 `cwd`。
  - `maybe_enter_subagent_worktree(...)` 现在会在创建 worktree 后立即调用 `remap_subagent_worktree_cwd_after_enter(...)`，把 child session 的 `working_dir` 切到 `worktree_path + relative_path` 对应的子目录，而不是切回原仓库路径。
  - 如果该子目录在新 worktree 中不存在，`rollback_subagent_worktree_after_spawn_failure(...)` 会复用现有 `ExitWorktreeTool` 把刚创建的临时 worktree 回滚掉，避免留下半成功的 child worktree 状态。
  - [`prompt_context.rs`](../../src-tauri/src/commands/aster_agent_cmd/prompt_context.rs) 也同步把提示更新成当前真实边界：允许组合，但只支持同仓库、可映射到 child worktree 的目录。
- 这一步后的 `CCD-008` 边界继续收紧为：
  - `current`：`Agent.isolation=worktree` 现在不仅支持单独使用，也支持与显式 `cwd` 组合；当 `cwd` 位于父会话同一 Git 仓库、且能映射到 child worktree 现有目录时，child 会真正运行在 `worktree` 内对应子目录，同时继续沿用既有的 dirty-keep、missing-worktree fallback 与 final-status auto cleanup lifecycle。
  - `current gap`：`isolation=remote`、跨仓库 `cwd + worktree`、无法映射到 child worktree 现有目录的 `cwd`、child-scoped `plan` lifecycle。
  - `compat / deprecated / dead`：无新增；本轮没有为了“看起来像 upstream”继续保留把 `working_dir` 回写到原仓库路径的假支持，也没有发明第二套 worktree 状态源。
- 这一步服务路线图主目标的关系是：把 `CCD-008` 里 child worktree 最后一块明显失真的 `cwd` 组合语义收成 honest current，避免 Lime 再停在“表面允许组合、实际仍在原仓库执行”的半对齐状态；下一刀如果继续推进，应回到 `isolation=remote`、child `plan` lifecycle 和 `PermissionRequest.updatedPermissions` 这些仍缺真实宿主的剩余 gap。
- 已执行定向校验：
  - `rustfmt --edition 2021 "src-tauri/src/commands/aster_agent_cmd/subagent_runtime.rs" "src-tauri/src/commands/aster_agent_cmd/prompt_context.rs"` 通过
  - `cargo test --manifest-path "src-tauri/Cargo.toml" test_maybe_enter_subagent_worktree_remaps_requested_cwd_into_child_worktree --lib -- --nocapture` 通过（`1 passed`）
  - `cargo test --manifest-path "src-tauri/Cargo.toml" test_resolve_subagent_worktree_cwd_mapping_rejects_cross_repo_cwd --lib -- --nocapture` 通过（`1 passed`）
  - `cargo test --manifest-path "src-tauri/Cargo.toml" test_resolve_subagent_session_bootstrap_working_dir_keeps_execution_working_dir --lib -- --nocapture` 通过（`1 passed`）
  - `cargo test --manifest-path "src-tauri/Cargo.toml" test_validate_effective_spawn_isolation_accepts_worktree_and_rejects_unsupported_values --lib -- --nocapture` 通过（`1 passed`）
  - `cargo test --manifest-path "src-tauri/Cargo.toml" test_resolve_missing_subagent_worktree_restore_falls_back_to_original_cwd --lib -- --nocapture` 通过（`1 passed`）
  - `cargo test --manifest-path "src-tauri/Cargo.toml" test_resolve_workspace_id_for_working_dir_prefers_longest_ancestor_workspace --lib -- --nocapture` 通过（`1 passed`）

### 继续推进（CCD-008 / Agent callback-backed `mode` / `isolation` reachability）

- 在补齐 `worktree + cwd` honest host 后，又顺着 Lime 当前真实入口复核了一次，确认还有一处更贴主链的阻断：
  - [`subagent_runtime.rs`](../../src-tauri/src/commands/aster_agent_cmd/subagent_runtime.rs) 虽然已经具备 `mode / isolation / cwd` 的宿主解析与 `worktree` 生命周期。
  - 但 Aster 当前真正暴露给模型的 [`Agent`](../../src-tauri/crates/aster-rust/crates/aster/src/agents/subagent_tool.rs) surface，在 callback-backed 分支的 [`agent.rs`](../../src-tauri/crates/aster-rust/crates/aster/src/agents/agent.rs) 里仍会先把 `mode / isolation` 一刀拒绝。
  - 结果就是：Lime 宿主内部已经能 honest 处理 `worktree + cwd`，但对外 current `Agent` surface 还到不了这条主链，属于“实现存在、入口失真”。
- 因此这一轮没有再改宿主内核，而是把入口边界收正：
  - [`agent.rs`](../../src-tauri/crates/aster-rust/crates/aster/src/agents/agent.rs) 的 `prepare_callback_backed_agent_spawn(...)` 不再提前拒绝 `mode / isolation`。
  - 同时把 `mode / isolation` 纳入 callback-backed path 的触发条件；即使没有 `run_in_background / name / team_name / cwd / tool scope`，只要显式请求了 `mode` 或 `isolation`，也会走真实宿主 callback，而不是误落回前景 foreground-only 分支。
  - [`subagent_tool.rs`](../../src-tauri/crates/aster-rust/crates/aster/src/agents/subagent_tool.rs) 的当前 schema / description 也同步更新：`mode / isolation` 不再继续宣称“当前 runtime 不支持”，而是明确为“callback-backed runtime 会透传给宿主，由宿主决定支持子集”。
- 这一步后的 `CCD-008` 边界继续收紧为：
  - `current`：top-level `Agent` callback-backed current surface 现在终于能真实到达 Lime 宿主的 `mode / isolation / cwd` 主链；`worktree + cwd` 不再只停留在宿主内部实现。
  - `current gap`：`isolation=remote` 仍无 honest host；`mode=plan` 现在会到达宿主，但仍在 [`subagent_runtime.rs`](../../src-tauri/src/commands/aster_agent_cmd/subagent_runtime.rs) 处明确 fail-closed，因为还没有 child-session scoped plan lifecycle。
  - `compat / deprecated / dead`：无新增；本轮没有为了让入口“看起来支持”再加第二套 Agent 壳，只是把当前 public surface 收回到已存在的真实宿主能力。
- 这一步服务路线图主目标的关系是：把 `CCD-008` 从“宿主内核已经对齐、但 Aster `Agent` 入口还把关键字段挡在外面”的半完成状态，推进到“对外 current surface 终于能 honest 命中 Lime 的 subagent runtime 主链”；下一刀若继续推进，应回到 `mode=plan` 的 child-scoped lifecycle 与 `isolation=remote` 这两个仍缺真实宿主的剩余 gap。

### 继续推进（CCD-008 / PermissionRequest.updatedPermissions session setMode current subset）

- 继续严格对照本地参考实现：
  - `"/Users/coso/Documents/dev/js/claudecode/src/utils/permissions/PermissionUpdate.ts"`
  - `"/Users/coso/Documents/dev/js/claudecode/src/utils/permissions/PermissionUpdateSchema.ts"`
  - `"/Users/coso/Documents/dev/js/claudecode/src/hooks/toolPermission/PermissionContext.ts"`
  后确认 Lime 这一刀仍不能假装拥有 Claude Code 那套完整 `ToolPermissionContext + permission rules/directories persistence host`。因此本轮没有把 `updatedPermissions` 整体宣称为 supported，而是只把当前确实有宿主的最小子集收成 `current`：
  - 仅支持 `PermissionRequest` hook 返回 `decision=allow` 且 `updatedPermissions` 全量属于 `setMode + destination=session`
  - 其它类型继续 fail-closed 回退原生审批流，不执行 hook allow，也不应用 `updatedInput / updatedPermissions`
- [`runtime_project_hooks.rs`](../../src-tauri/src/commands/aster_agent_cmd/runtime_project_hooks.rs) 现已把 `updatedPermissions` 从“只看 presence 的布尔标记”改成真实解析 supported subset：
  - `acceptEdits -> current`
  - `dontAsk -> full-access`
  - `default -> SessionExecutionRuntimeAccessMode::default_for_session()`，按 Lime 当前 session 默认值落到 `full-access`
  - `plan` / `bypassPermissions` 继续显式拒绝
  - `addRules / replaceRules / removeRules / addDirectories / removeDirectories` 与任何 `destination != session` 都继续按 unsupported 处理
- 同一文件里的 runtime hook 应用链也已补上最小 honest side effect：
  - 支持的 `updatedPermissions.setMode(session)` 会在返回 `Allow` 前调用 `persist_session_recent_access_mode(...)`
  - 如果 session access mode 持久化失败，本次会回退到原生审批流，而不是继续假装 hook allow 已完整生效
  - `updatedInput` 在 supported subset 下继续保留，不会因为补 side effect 又退回到“能改 mode 就不能改 input”的假取舍
- 前端同步闭环也已补齐：
  - [`agentSessionRefresh.ts`](../../src/components/agent/chat/hooks/agentSessionRefresh.ts) 刷新 detail 后若看到 `execution_runtime.recent_access_mode`，会同步更新当前 `accessMode` 状态并回写 session shadow storage
  - [`useAgentSession.ts`](../../src/components/agent/chat/hooks/useAgentSession.ts) 已把这条同步接进现有 `refreshSessionDetail(...)` 主链，因此同一会话里后端刚通过 hook 更新的 session access mode，会在发送结束后的 refresh 里立刻反映到下一条提交，而不必等用户切 topic
- 这一步后的 `CCD-008` 边界继续收紧为：
  - `current`：`PermissionRequest.updatedPermissions` 现在至少已有一条 honest current 子集：`allow + setMode(destination=session)`，并且能真实持久化 session `recent_access_mode`，再回流到当前聊天页的 access mode 主状态
  - `current gap`：rules 类 updates、directories 类 updates、任何 non-session destination、`plan` / `bypassPermissions` 仍无 honest host；本轮没有为了“看起来接近 upstream”去偷偷部分应用 mixed updates
  - `compat / deprecated / dead`：无新增；本轮没有把 `PermissionRequest.updatedPermissions` 包成“看起来都 supported，实际只有日志”的 compat 壳
- 这一步服务路线图主目标的关系是：把 `CCD-008` 里最后一块明显处于“schema 有、hook 可回、但宿主完全不生效”的权限更新断层推进到最小 honest current，避免 Lime 继续停在“hook allow 了，实际 session 权限状态却没变”的假对齐状态；下一刀若继续推进，应优先回到 `isolation=remote`、child-scoped `plan` lifecycle，或在未来真的存在规则/目录 permission host 之后再考虑扩 `updatedPermissions` 子集。
- 已执行定向校验：
  - `rustfmt --edition 2021 "src-tauri/src/commands/aster_agent_cmd/runtime_project_hooks.rs"` 通过
  - `npx vitest run "src/components/agent/chat/hooks/agentSessionRefresh.test.ts"` 通过（`4 passed`）
  - `npx vitest run "src/components/agent/chat/hooks/useAsterAgentChat.test.tsx" -t "已有 recent_access_mode 时发送消息应沿用恢复后的正式权限策略"` 通过（`1 passed, 142 skipped`）
  - `env CARGO_TARGET_DIR="/Users/coso/Documents/dev/ai/aiclientproxy/lime/.codex-target" cargo test --manifest-path "src-tauri/Cargo.toml" permission_request_project_hooks --lib -- --nocapture` 通过（`6 passed`）

### 继续推进（CCD-008 / managed-session peer messaging current）

- 继续严格对照本地参考实现：
  - `"/Users/coso/Documents/dev/js/claudecode/src/hooks/useInboxPoller.ts"`
  - `"/Users/coso/Documents/dev/js/claudecode/src/tools/SendMessageTool/SendMessageTool.ts"`
  - `"/Users/coso/Documents/dev/js/claudecode/src/constants/xml.ts"`
  后确认上一轮把 `teammate mode=plan` 宿主生命周期接回 current 后，剩下最贴主链的断层不该再停在“只有 plan_approval_request 能到 lead，普通 teammate 消息与 uds 本机会话消息仍卡死在 callback 层”：
  - upstream 对 lead / 本机会话 peer 的普通消息并不是另一套假的 host，而是包装成 `<teammate-message>` / `<cross-session-message>` 后继续走目标 session 的正常收件主链。
  - Lime 之前的真实问题不是缺少第三套 transport，而是 [`agent_runtime_send_subagent_input_internal`](../../src-tauri/src/commands/aster_agent_cmd/subagent_runtime.rs) 看到 non-subagent target 就直接拒绝，导致 [`agent_control.rs`](../../src-tauri/crates/aster-rust/crates/aster/src/tools/agent_control.rs) 已经能构造的 `uds:` peer surface 和 `team-lead` 路由始终停在“工具层看起来能发、宿主层实际打不进去”的假完成状态。
- 因此这一轮没有去补 mailbox compat，而是把 non-subagent plain/xml 消息 honest 接回 Lime 现有 managed-session queue：
  - [`subagent_runtime.rs`](../../src-tauri/src/commands/aster_agent_cmd/subagent_runtime.rs) 新增 `submit_runtime_message_to_managed_session(...)`，让 non-subagent target 在非结构化控制消息场景下也走 `submit_runtime_turn(queue_if_busy=true)`，事件名收口到现有 `agent_stream`，不再只允许 `plan_approval_request` 这一个特例。
  - 同文件继续保留 control-message 治理边界：`plan_approval_request` 仍走自动审批控制链；`shutdown_response` 与误投到 managed session 的 `plan_approval_response` 继续显式 fail-closed，而不是被偷偷降级成普通聊天文本。
  - [`agent_control.rs`](../../src-tauri/crates/aster-rust/crates/aster/src/tools/agent_control.rs) 现在会把“teammate 发给 team lead 的普通文本/普通 JSON 文本化消息”包装成 upstream 同类 `<teammate-message teammate_id="..." summary="...">...</teammate-message>`，只对 lead 目标生效，不影响现有 subagent->subagent 文本投递和结构化 control message。
  - 这样 `uds:` 本机会话 peer 的 `<cross-session-message>` 包络终于也不再停留在 callback 单测里，而是真能投递到 Lime 的 managed session runtime。
- 这一步后的 `CCD-008` 边界继续收紧为：
  - `current`：`SendMessage` 现在已具备两条 honest non-subagent 主链：`uds:` 本机会话 peer 文本消息，以及 teammate -> team lead 的普通消息；两者都进入目标 managed session 的正常 runtime queue，而不是停在 fake callback surface。
  - `current gap`：`bridge:` remote peer 仍无 host；lead-side `shutdown_response` 仍缺上游 inbox / graceful shutdown lifecycle，继续 fail-closed；更完整的 teammate-message UI 呈现也还没收成单独视图。
  - `compat / deprecated / dead`：无新增；本轮没有为了“看起来和 upstream 一样”再补一层 mailbox 文件或本地 bridge 兼容层，而是复用 Lime 现有 session queue 事实源。
- 这一步服务路线图主目标的关系是：把 `CCD-008` 从“teammate plan 生命周期已回正，但普通协作消息仍被宿主挡死”的半完成状态，推进到“本地 team/peer messaging 至少已经走进真实 managed-session 主路径”；下一刀若继续推进，应优先判断 lead-side `shutdown_response` 与 `bridge:` remote peer 是否存在 honest host，而不是回头包更多假的传输层。

### 继续推进（CCD-008 / lead-side shutdown response current subset）

- 继续严格对照本地参考实现：
  - `"/Users/coso/Documents/dev/js/claudecode/src/tools/SendMessageTool/SendMessageTool.ts"`
  - `"/Users/coso/Documents/dev/js/claudecode/src/hooks/useInboxPoller.ts"`
  - `"/Users/coso/Documents/dev/js/claudecode/src/utils/teammateMailbox.ts"`
  后确认上一刀把普通 teammate / `uds:` peer 文本消息接回 managed-session queue 后，最贴主链的剩余断层其实不是 `bridge:`，而是 `shutdown_response` 仍停留在“工具面能构造、lead side 明确拒收”的假支持：
  - upstream 的 `shutdown_response` 并不会原样回写给 lead；它会在发送侧翻译成 `shutdown_approved / shutdown_rejected`，携带 `from`，由 lead inbox poller 一边做 teammate lifecycle side effect，一边把结果继续回显给 lead。
  - Lime 之前之所以继续 fail-closed，不是因为 close 能力不存在，而是 managed-session lead 缺少这层 `sender + lifecycle + queue replay` 的 current 收件路径。
- 因此这一轮没有补 mailbox compat，也没有伪造 remote bridge，而是把 lead-side `shutdown_response` 收成最小 honest current subset：
  - [`agent_control.rs`](../../src-tauri/crates/aster-rust/crates/aster/src/tools/agent_control.rs) 现在会把 `shutdown_response` 在发送侧翻译成 upstream 同类 `shutdown_approved / shutdown_rejected` payload，并补上 `from` 与 `timestamp`；不再把缺失 sender 的裸 `shutdown_response` JSON 直接丢给 lead。
  - [`subagent_runtime.rs`](../../src-tauri/src/commands/aster_agent_cmd/subagent_runtime.rs) 新增 lead-side `shutdown_approved / shutdown_rejected` 控制消息解析；其中 `shutdown_approved` 会复用现有 `agent_runtime_close_subagent_internal(...)` 关闭对应 teammate，`shutdown_rejected` 则保留 teammate 生命周期不变。
  - 同文件还会把处理后的 shutdown 控制消息包装成 `<teammate-message teammate_id="...">...</teammate-message>` 再投递回 lead managed session 的正常 runtime queue，这样 lead 既能拿到真实 lifecycle side effect，也能像 upstream 一样在会话里看到 teammate 的审批结果，而不是只发生隐式后台关闭。
  - legacy 形态的裸 `shutdown_response` 继续在 managed-session lead 侧 fail-closed；本轮没有为了迁就旧 payload 再长一层兼容解析。
- 这一步后的 `CCD-008` 边界继续收紧为：
  - `current`：本地 team runtime 现在除了普通 teammate / `uds:` peer 文本消息外，也已经具备 lead-side `shutdown_response` 的最小 honest current subset：发送侧翻译、lead-side close、以及结果回显都走现有 runtime queue / subagent close 主链。
  - `current gap`：`bridge:` remote peer 仍无 honest host；`shutdown_request` 本身仍只是 structured prompt 主链，不是 upstream mailbox/pane backend 的完整宿主实现；更完整的 teammate-message 专用 UI 仍未单独收口。
  - `compat / deprecated / dead`：无新增；本轮没有引入 mailbox 文件层、pane backend compat 或第二套 shutdown transport。
- 这一步服务路线图主目标的关系是：把 `CCD-008` 从“普通协作消息已 current，但 shutdown 协作仍是假支持”的状态，推进到“至少本地 team runtime 的 shutdown approval 主链也已经回到 honest host”；下一刀若继续推进，应优先判断 `bridge:` remote peer 是否存在真实宿主面，而不是继续扩张本地 compat。
- 已执行定向校验：
  - `env CARGO_TARGET_DIR="/Users/coso/Documents/dev/ai/aiclientproxy/lime/.codex-target" cargo test --manifest-path "src-tauri/Cargo.toml" test_parse_runtime_control_message_accepts_shutdown_approved_shape --lib -- --nocapture` 通过（`1 passed`）
  - `env CARGO_TARGET_DIR="/Users/coso/Documents/dev/ai/aiclientproxy/lime/.codex-target" cargo test --manifest-path "src-tauri/Cargo.toml" test_reject_unsupported_managed_session_control_message --lib -- --nocapture` 通过（`2 passed`）
  - `env CARGO_TARGET_DIR="/Users/coso/Documents/dev/ai/aiclientproxy/lime/.codex-target-aster-verify" cargo test --manifest-path "src-tauri/crates/aster-rust/crates/aster/Cargo.toml" send_message_ --lib -- --nocapture` 通过（`16 passed`）
  - `env CARGO_TARGET_DIR="/Users/coso/Documents/dev/ai/aiclientproxy/lime/.codex-target-aster-verify" cargo test --manifest-path "src-tauri/crates/aster-rust/crates/aster/Cargo.toml" test_exit_plan_mode_teammate_submits_plan_approval_request --lib -- --nocapture` 通过（`1 passed`）

### 继续推进（CCD-008 / managed-session peer message display current subset）

- 继续严格对照本地参考实现：
  - `"/Users/coso/Documents/dev/js/claudecode/src/components/messages/UserTeammateMessage.tsx"`
  - `"/Users/coso/Documents/dev/js/claudecode/src/components/messages/PlanApprovalMessage.tsx"`
  - `"/Users/coso/Documents/dev/js/claudecode/src/components/messages/ShutdownMessage.tsx"`
  后确认上一刀虽然已经把 `<teammate-message>` / `<cross-session-message>` honest 接回了 Lime managed-session queue，但前端聊天显示仍停留在“把 XML 包络和 shutdown JSON 原样吐给用户”的半成品：
  - upstream 不会把 teammate / cross-session 包络直接裸露给用户；它至少会把 envelope 解析成可读的 teammate message 视图，并把 `shutdown_approved / shutdown_rejected / plan_approval_*` 这类已知结构化消息折叠成正常文案。
  - Lime 当前缺的也不是新的 pane backend，而是聊天显示层没有对已经进入 current 的 runtime peer envelope 做最小收口，导致主链明明已 honest 到达队列，界面却还像在看宿主协议原文。
- 因此这一轮没有补新的消息面板或 mailbox compat，而是先把现有聊天气泡收成最小可读 current：
  - [`runtimePeerMessageDisplay.ts`](../../src/components/agent/chat/utils/runtimePeerMessageDisplay.ts) 新增 runtime peer envelope 文本格式化器，会把 `<teammate-message>` / `<cross-session-message>` 解析成可读标题，并把 `shutdown_* / plan_approval_* / task_assignment / task_completed / idle_notification` 这些当前已知结构化 payload 转成用户能直接理解的正文。
  - [`internalImagePlaceholder.ts`](../../src/components/agent/chat/utils/internalImagePlaceholder.ts) 现已在现有消息清洗主链里复用这层格式化，因此无论消息最终走 assistant `StreamingRenderer`，还是 user `MarkdownRenderer`，都不会再把 XML 包络直接暴露给聊天区。
- 这一步后的 `CCD-008` 边界继续收紧为：
  - `current`：managed-session 当前已不仅能投递 teammate / `uds:` peer 消息，也能在现有聊天气泡里把这些 envelope 以可读文案展示出来；lead-side `shutdown_response` 的 current subset 不再退化成“界面里只剩一坨 XML + JSON”。
  - `current gap`：`bridge:` remote peer 仍无 honest host；`shutdown_request` 仍不是 upstream mailbox/pane backend 的完整宿主；更完整的 teammate-message 专用 UI 仍未单独收口成独立视图。
  - `compat / deprecated / dead`：无新增；本轮没有为了追求外观接近 upstream 再发明第二套消息模型或独立 pane backend，只复用现有聊天显示主链做 envelope 格式化。
- 这一步服务路线图主目标的关系是：把 `CCD-008` 从“runtime host 已接通，但用户看到的仍是协议原文”的半交付状态，推进到“已进入 current 的 peer/shutdown 协作消息至少在现有聊天主路径里可读可用”；下一刀若继续推进，应优先回到 `bridge:` honest host 判定或独立 teammate-message 视图是否值得单独收口，而不是回头补假的 transport。

### 继续推进（CCD-008 / runtime peer message card current subset）

- 继续严格对照本地参考实现：
  - `"/Users/coso/Documents/dev/js/claudecode/src/components/messages/UserTeammateMessage.tsx"`
  - `"/Users/coso/Documents/dev/js/claudecode/src/components/messages/PlanApprovalMessage.tsx"`
  - `"/Users/coso/Documents/dev/js/claudecode/src/components/messages/ShutdownMessage.tsx"`
  后确认上一刀虽然已经把 `<teammate-message>` / `<cross-session-message>` 从协议原文收成“可读文案”，但和 upstream 相比仍差最后一层真正的消息视图：
  - upstream 不是单纯把 peer envelope 改写成字符串，而是会根据 `plan_approval_* / shutdown_* / task_assignment / task_completed` 的不同语义渲染成专门 teammate message 组件。
  - Lime 当前若继续停在“纯文本摘要”，主路径虽然能读，但协作状态层级仍然和普通正文混在一起，不利于把 current 的 teammate runtime surface 真正收成可交付聊天体验。
- 因此这一轮没有发明新的 pane/backend，也没有把 peer message 另起一套 store，而是继续在现有聊天气泡主路径收一刀：
  - [`runtimePeerMessageDisplay.ts`](../../src/components/agent/chat/utils/runtimePeerMessageDisplay.ts) 现在除了保留纯文本摘要能力，也补出了 runtime peer envelope 的结构化解析模型，可按原始顺序识别多条 `<teammate-message>` / `<cross-session-message>`，并区分 `plan_approval_* / shutdown_* / task_assignment / task_completed / idle_notification / teammate_terminated` 等当前已知 payload。
  - [`RuntimePeerMessageCards.tsx`](../../src/components/agent/chat/components/RuntimePeerMessageCards.tsx) 新增聊天主路径的 peer message 卡片视图，按不同 payload 给予不同层级和状态色；计划审批、结束任务、任务分配/完成不再只是一段普通字符串。
  - [`StreamingRenderer.tsx`](../../src/components/agent/chat/components/StreamingRenderer.tsx) 现已在 assistant 正文主路径上优先识别“纯 peer envelope 消息”，直接渲染 peer cards；既保留原有 process/timeline 链路，也不再把这类 runtime 协作消息降级回普通 markdown。
  - [`MessageList.tsx`](../../src/components/agent/chat/components/MessageList.tsx) 现已在 user 正文分支做同样收口，因此无论消息最终落在 assistant 还是 user 气泡，只要原始正文是纯 peer envelope，都会沿用同一套卡片视图，而 preview/sidebar 仍继续复用文本摘要，不额外发明第二套预览协议。
- 这一步后的 `CCD-008` 边界继续收紧为：
  - `current`：managed-session current 路径里的 teammate / cross-session / shutdown / plan approval 消息，已经从“协议原文”进到“可读摘要”再进到“专门消息卡片”；现有聊天主路径已经具备最小 honest teammate message view。
  - `current gap`：`bridge:` remote peer 仍无 honest host；更完整的 teammate mailbox / pane backend 仍不存在；timeline / inbox 之外的更细粒度 peer 状态聚合仍未像 upstream 那样单独抽成更完整视图。
  - `compat / deprecated / dead`：无新增；本轮没有为了对齐 upstream 继续扩张 transport、mailbox 文件或第二套消息列表，只在现有气泡主路径补真实视图层。
- 这一步服务路线图主目标的关系是：把 `CCD-008` 从“聊天里能看懂 peer 消息”继续推进到“聊天里已经能把 peer 协作状态按类型分层显示”；下一刀若继续推进，应优先回到 `bridge:` honest host 或更完整 teammate-message 独立视图，而不是回头再堆字符串兼容。
- 已执行定向校验：
  - `npx vitest run "src/components/agent/chat/utils/runtimePeerMessageDisplay.test.ts" "src/components/agent/chat/components/RuntimePeerMessageCards.test.tsx" "src/components/agent/chat/components/StreamingRenderer.test.tsx" "src/components/agent/chat/components/MessageList.test.tsx"` 通过（`4 files, 102 tests passed`）

### 继续推进（CCD-008 / runtime peer lifecycle-noise 收口）

- 继续严格对照本地参考实现：
  - `"/Users/coso/Documents/dev/js/claudecode/src/components/messages/UserTeammateMessage.tsx"`
  - `"/Users/coso/Documents/dev/js/claudecode/src/components/messages/AttachmentMessage.tsx"`
  - `"/Users/coso/Documents/dev/js/claudecode/src/components/messages/TaskAssignmentMessage.tsx"`
  - `"/Users/coso/Documents/dev/js/claudecode/src/utils/teammateMailbox.ts"`
  后确认上一刀虽然已经把 managed-session peer message 收成专门卡片，但与 upstream 仍有两处 current 语义差：
  - upstream 会静默 `shutdown_approved`、`idle_notification`、`teammate_terminated`，不把这些 lifecycle/noise 消息继续暴露在主聊天里。
  - upstream `task_assignment` 明确保留 `assignedBy`，而 Lime 卡片之前只展示 `sender + taskId/subject/description`，丢掉了真正的任务分配者信息。
- 因此这一轮没有继续给 peer message 叠新 pane，也没有为了“看起来兼容”补 mailbox 伪层，而是直接在现有 current 解析主链收口：
  - [`runtimePeerMessageDisplay.ts`](../../src/components/agent/chat/utils/runtimePeerMessageDisplay.ts) 现已补 `task_assignment.assignedBy` 解析，并新增统一的 runtime peer envelope 静默规则；`parseRuntimePeerMessageEnvelopes(...)`、`isPureRuntimePeerMessageText(...)`、`formatRuntimePeerMessageText(...)` 都已共享同一套 `shutdown_approved / idle_notification / teammate_terminated` 过滤语义，不再让卡片、preview、内部文本清洗各自分叉判断。
  - [`RuntimePeerMessageCards.tsx`](../../src/components/agent/chat/components/RuntimePeerMessageCards.tsx) 已删除这些静默 lifecycle 消息对应的显示分支，避免 current UI 还保留不该露出的死路径；同时 `task_assignment` 卡片现会显式展示 `assignedBy`。
  - 由于 [`internalImagePlaceholder.ts`](../../src/components/agent/chat/utils/internalImagePlaceholder.ts) 继续复用 `formatRuntimePeerMessageText(...)`，这次收口不只影响 peer cards，也同步影响聊天摘要、preview 与内部文本清洗入口，保证不会在别的 current 出口重新漏出 lifecycle/noise 原文。
- 这一步后的 `CCD-008` 边界继续收紧为：
  - `current`：Lime 当前 managed-session peer message 主路径，已经不再把 upstream 会静默的 lifecycle/noise 消息暴露给主聊天；`task_assignment` 也已带上真实 `assignedBy`，而不是只剩 envelope sender。
  - `current gap`：`bridge:` remote peer 仍无 honest host；更完整的 teammate inbox / pane backend 仍不存在；更丰富的 peer lifecycle 聚合状态仍未像 upstream 那样抽成单独面板。
  - `compat / deprecated / dead`：无新增；本轮没有为了迁就旧面继续保留“可显示但不该显示”的 lifecycle UI 分支，也没有为 `bridge:` 缺口补假的 transport 或 fake host。
- 这一步服务路线图主目标的关系是：把 `CCD-008` 从“peer message 已有卡片，但主聊天里仍混入 upstream 会静默的噪音协议消息”的半收口状态，推进到“managed-session current surface 的显示语义也已对齐到 upstream 的最小 honest subset”；下一刀若继续推进，应优先回到 `bridge:` honest host / remote peer 宿主判定，而不是回头再修补显示层兼容。
- 已执行校验：
  - `npx vitest run "src/components/agent/chat/utils/runtimePeerMessageDisplay.test.ts" "src/components/agent/chat/components/RuntimePeerMessageCards.test.tsx" "src/components/agent/chat/components/StreamingRenderer.test.tsx" "src/components/agent/chat/components/MessageList.test.tsx"` 通过（`4 files, 106 tests passed`）
  - 宿主侧 `subagent_runtime` 的 parser / gate 复核已通过；更大范围的 `verify:local` / `verify:gui-smoke` 本轮未复核，不再写成已通过

### 继续推进（CCD-008 / peer address 事实源收口）

- 继续严格对照本地参考实现：
  - `"/Users/coso/Documents/dev/js/claudecode/src/utils/peerAddress.ts"`
  - `"/Users/coso/Documents/dev/js/claudecode/src/tools/SendMessageTool/SendMessageTool.ts"`
  后确认 Lime 当前真正需要的不是再“多支持一个前缀”，而是先把 peer address 的 current / unsupported 事实源说实话并收成一处：
  - upstream 会把 `uds:` / `bridge:` 的地址语法解析单独抽出来，再根据真实 host 能力决定是否可投递；语法识别不等于 transport 已存在。
  - Lime 当前已经把 synthetic `uds:<session-id>` 本地跨 session 投递收进 current，但 `bridge:` 仍没有 upstream 那种 remote peer host / session ingress；因此继续保留 “`bridge:` unsupported” 才是 honest host。
  - 之前 [`agent_control.rs`](../../src-tauri/crates/aster-rust/crates/aster/src/tools/agent_control.rs) 的 `send_message_unsupported_peer_result(...)` 还残留 `Uds => unsupported` 死分支，已经和现状漂移。
- 因此这一轮没有伪造 remote peer transport，也没有继续包 compat，而是做最小事实源收口：
  - 新增 [`peer_address_surface.rs`](../../src-tauri/crates/aster-rust/crates/aster/src/tools/peer_address_surface.rs)，把 `uds:` / `bridge:` 解析、`SendMessage` / `ListPeers` 描述文案，以及 `bridge:` unsupported 原因统一收成同一处；当前口径固定为：`uds:` = current local cross-session peer，`bridge:` = unsupported gap，原因是缺 remote peer host / session ingress。
  - [`agent_control.rs`](../../src-tauri/crates/aster-rust/crates/aster/src/tools/agent_control.rs) 已改为只在 `bridge:` 上走受控失败，并删除过时的 `Uds => unsupported` 分支；`unsupportedTargetScheme` 也复用同一事实源，不再各处手写。
  - [`team_tools.rs`](../../src-tauri/crates/aster-rust/crates/aster/src/tools/team_tools.rs) 现在复用同一套 peer surface 文案，因此 `ListPeers` 与 `SendMessage` 对 `uds:` / `bridge:` 的 current / unsupported 说明不会再各自漂移。
- 这一步后的 `CCD-008` 边界继续收紧为：
  - `current`：synthetic `uds:<session-id>` 仍是 Lime 当前唯一 honest 的 cross-session local peer address surface，可被 `ListPeers.send_to` 暴露并由 `SendMessage` 直接投递。
  - `current gap`：`bridge:` remote peer 仍无 honest host；更完整的 teammate inbox / pane backend 仍不存在；更丰富的 peer lifecycle 聚合状态仍未像 upstream 那样抽成单独面板。
  - `compat / deprecated / dead`：无新增；本轮没有为了“兼容 upstream 表面”假装支持 `bridge:`，也没有继续保留已经不真实的 `uds:` unsupported 文案分支。
- 这一步服务路线图主目标的关系是：把 `CCD-008` 从“peer address 能工作但事实源文案仍会自相矛盾”的状态，推进到“当前已支持与明确未支持的 peer surface 都由同一事实源定义”；下一刀若继续推进，应优先回到 `bridge:` honest host 判定或更完整 teammate-message 独立视图，而不是再补假的 remote transport。

## 2026-04-22

### 继续推进（CCD-008 / SessionStart resume honest host 收口）

- 继续严格对照本地参考实现：
  - `"/Users/coso/Documents/dev/js/claudecode/src/utils/conversationRecovery.ts"`
  - `"/Users/coso/Documents/dev/js/claudecode/src/utils/sessionStart.ts"`
  后确认 Lime 这一刀不该再新开第二套 `resume` 命令，而应把 Claude Code 的 `processSessionStartHooks('resume', { sessionId })` 语义收进现有 `agent_runtime_get_session` current 主链：
  - 只有“继续最近会话 / 自动恢复 / 初始会话导航 / hydrate 恢复 / sidebar resume 入口”这类真正的恢复路径，才显式透传 `resumeSessionStartHooks=true`
  - 普通 `refreshSessionDetail(...)`、`final_done` 后刷新、`stopSending` 后普通刷新、以及单纯 `getSession(sessionId)` 仍保持非 resume 语义，不把日常 detail refresh 伪装成 lifecycle host
- 因此这一轮没有新增 `agent_runtime_resume_session` 之类的平级协议，而是把恢复语义最小化补进既有命令面：
  - 前端 [`types.ts`](../../src/lib/api/agentRuntime/types.ts)、[`sessionClient.ts`](../../src/lib/api/agentRuntime/sessionClient.ts)、[`agentRuntimeAdapter.ts`](../../src/components/agent/chat/hooks/agentRuntimeAdapter.ts) 新增并透传 `resumeSessionStartHooks?: boolean`
  - [`useAgentSession.ts`](../../src/components/agent/chat/hooks/useAgentSession.ts)、[`useWorkspaceInitialSessionNavigation.ts`](../../src/components/agent/chat/workspace/useWorkspaceInitialSessionNavigation.ts)、[`useWorkspaceTopicSwitch.ts`](../../src/components/agent/chat/workspace/useWorkspaceTopicSwitch.ts)、[`useWorkspaceProjectSelection.ts`](../../src/components/agent/chat/hooks/useWorkspaceProjectSelection.ts)、[`AgentChatWorkspace.tsx`](../../src/components/agent/chat/AgentChatWorkspace.tsx) 现在只在真实 resume 路径上传这个标记
  - Rust [`runtime_api.rs`](../../src-tauri/src/commands/aster_agent_cmd/command_api/runtime_api.rs) 的 `agent_runtime_get_session(...)` 增加可选参数 `resume_session_start_hooks: Option<bool>`；当且仅当该标记为 `true` 时，才会在成功取回 detail 后执行 `run_runtime_session_start_project_hooks_for_session_with_runtime(..., SessionSource::Resume)`
  - [`runtime_project_hooks.rs`](../../src-tauri/src/commands/aster_agent_cmd/runtime_project_hooks.rs) 已把 `SessionSource::Resume` 从 unsupported warning 中移除，只保留 `Clear` 继续 fail-closed；[`agent_sessions.rs`](../../src-tauri/src/dev_bridge/dispatcher/agent_sessions.rs)、[`agentRuntimeCommandSchema.json`](../../src/lib/governance/agentRuntimeCommandSchema.json) 与 [`commandManifest.generated.ts`](../../src/lib/api/agentRuntime/commandManifest.generated.ts) 也已同步
- 这一步后的 `CCD-008` 边界继续收紧为：
  - `current`：Lime 现在已有一条 honest 的 `SessionStart(resume)` 宿主入口，而且仍然收敛在 `agent_runtime_get_session` 这一条 current 命令主链上；恢复语义由显式调用方决定，不再靠模糊的“只要拿 detail 就算 resume”
  - `current gap`：`SessionStart(clear)` 仍无 honest host；普通 refresh 与 queue resume 也仍不能冒充 lifecycle resume
  - `compat / deprecated / dead`：无新增；本轮没有为了对齐 upstream 再补第二套 session resume 协议，也没有把普通 detail refresh 接回 compat 壳
- 这一步服务路线图主目标的关系是：把 `CCD-008` 里最后一块此前一直被明确保留为 gap 的 `SessionStart(resume)`，推进成 Lime 当前真实存在、且不会误伤普通刷新路径的 honest current subset；下一刀若继续推进，应优先回到 `SessionEnd(clear / logout / prompt_input_exit)` 或 `SessionStart(clear)` 是否存在真实宿主，而不是再把更多 refresh 动作包成伪生命周期。
- 已执行校验：
  - `cargo fetch --manifest-path "src-tauri/Cargo.toml"` 执行，用于修复本机 `~/.cargo/registry/src` 缺失 `half-2.7.1`、`aws-lc-sys-0.37.1` 源文件导致的环境级假失败
  - `cargo test --manifest-path "src-tauri/Cargo.toml" runtime_project_hooks::tests::build_runtime_session_start_unsupported_warning_message_should_allow_current_sources -- --nocapture` 通过
  - `cargo test --manifest-path "src-tauri/Cargo.toml" runtime_project_hooks::tests::run_runtime_session_start_project_hooks_for_session_should_run_resume_source -- --nocapture` 通过
  - `npx vitest run "src/components/agent/chat/hooks/useAsterAgentChat.test.tsx"` 通过（`143 passed`）；已同步恢复路径与普通刷新路径对 `mockGetAgentRuntimeSession` 的一参/二参断言
  - `npm run verify:local` 未通过，但失败点是工作区既有无关改动：[`sceneapp.ts`](../../src/lib/api/sceneapp.ts) 里 `SceneAppExecutionPlan`、`SceneAppRuntimeAdapterPlan` 两个未使用导入触发 `eslint`，并非本轮 `resume` 改动回归
  - `npm run verify:gui-smoke` 已成功把 headless Tauri、DevBridge、`workspace-ready`、`browser-runtime`、`site-adapters` 与 `agent-service-skill-entry` 拉起并跑通；最终失败在 `smoke:agent-runtime-tool-surface` 的 [`useWorkspaceConversationSceneRuntime.test.ts`](../../src/components/agent/chat/workspace/useWorkspaceConversationSceneRuntime.test.ts) 上，报的是 `react-syntax-highlighter` / `refractor` 的 ESM-CJS 兼容错误，日志显示脚本运行时 Node 为 `v18.20.2`，同样不属于本轮 `resume` 主链回归

### 继续推进（CCD-008 / teammate plan team-context reachability）

- 继续严格对照本地参考实现：
  - `"/Users/coso/Documents/dev/js/claudecode/src/tools/AgentTool/AgentTool.tsx"`
  后确认 Lime 当前 `mode=plan` 剩余缺口不在 `plan_mode_tool.rs` 本身，而在 callback-backed `Agent -> subagent_runtime` 这段入口边界：
  - upstream 会先做 `resolveTeamName(input.team_name || appState.teamContext?.teamName)`，只要当前已有 team context，`name + mode=plan` 即使没显式传 `team_name`，仍会走 teammate spawn，并进入现成的 child-scoped plan lifecycle。
  - Lime 之前虽然在 [`agent_control.rs`](../../src-tauri/crates/aster-rust/crates/aster/src/tools/agent_control.rs) 文案上宣称“未传 `team_name` 时沿用当前 team 上下文”，但 [`subagent_runtime.rs`](../../src-tauri/src/commands/aster_agent_cmd/subagent_runtime.rs) 实际仍把 teammate / plan host 锁死在“必须显式 `team_name + name`”这一层，导致 lead session 里最贴主链的 `name + mode=plan` 仍会在宿主前门被挡掉。
- 因此这一轮没有发明第二套 compat 参数，也没有把 `plan` 泛化给普通 subagent，而是只把已有 honest host 接通：
  - [`subagent_runtime.rs`](../../src-tauri/src/commands/aster_agent_cmd/subagent_runtime.rs) 新增 `resolve_effective_teammate_spawn_request(...)`，会在父 session 已有 lead-side team context 时，从当前 team 自动补齐有效 `team_name`；显式 `team_name` 仍会校验当前 lead team 是否匹配。
  - 同文件的 `validate_spawn_request_surface(...)` 不再把 `name + mode=plan` 提前一刀拒绝，而是允许这类请求进入宿主，再由实际 team context / lead 身份做 fail-closed 判定；无 team context、non-lead session、以及 `team_name`/`name` 组合不合法的情况仍继续明确拒绝。
  - spawn 成功后写入的 child metadata 现在会持久化“解析后的有效 `team_name`”，避免 tool 入参为空但 session 元数据仍丢失当前 team 事实源。
  - [`prompt_context.rs`](../../src-tauri/src/commands/aster_agent_cmd/prompt_context.rs) 也同步收口：明确 `team_name` 可在已有 lead-side team context 时省略，`mode=plan` 当前只支持 team teammate 子集，不再继续把这条已经接通的 current surface 描述成全量 unsupported。
- 这一步后的 `CCD-008` 边界继续收紧为：
  - `current`：top-level lead session 现在已经能按 upstream 同类语义，用 `name + mode=plan` 命中现有 teammate plan lifecycle；如果当前 team context 已存在，即使调用方没显式传 `team_name`，也会沿用当前 team。
  - `current gap`：没有 team context 的普通 subagent 仍不能假装支持 `mode=plan`；non-lead / teammate session 也仍不能继续派生 teammate；`isolation=remote`、`bridge:` remote peer、`PermissionRequest.updatedPermissions` 的 rules/directories/non-session destination 依旧没有 honest host。
  - `compat / deprecated / dead`：无新增；本轮没有为了“看起来支持 plan”继续扩非 team child 的假 lifecycle，也没有再加前端兜底把错误 team surface 掩过去。
- 这一步服务路线图主目标的关系是：把 `CCD-008` 从“子 session plan lifecycle 明明已在宿主内部存在，但最常见的 lead/team 调用入口仍到不了”的半成品，推进到“当前真正有宿主的 `plan` 子集已经可达”；下一刀若继续推进，应优先回到 `isolation=remote` 或只在未来确实出现新的 child permission / lifecycle host 时再扩 `plan` 边界。
- 已执行定向校验：
  - `env CARGO_TARGET_DIR="/Users/coso/Documents/dev/ai/aiclientproxy/lime/.codex-target" cargo test --manifest-path "src-tauri/Cargo.toml" test_resolve_effective_teammate_spawn_request_ --lib -- --nocapture` 通过（`3 passed`）
  - `env CARGO_TARGET_DIR="/Users/coso/Documents/dev/ai/aiclientproxy/lime/.codex-target" cargo test --manifest-path "src-tauri/Cargo.toml" test_resolve_spawn_request_access_mode_prefers_supported_mode_override --lib -- --nocapture` 通过（`1 passed`）
  - `env CARGO_TARGET_DIR="/Users/coso/Documents/dev/ai/aiclientproxy/lime/.codex-target" cargo test --manifest-path "src-tauri/Cargo.toml" test_validate_spawn_request_surface_accepts_supported_modes_and_rejects_unsupported_values --lib -- --nocapture` 通过（`1 passed`）
