# Desktop Host 与 App Server 命令边界

状态：current

目录、依赖方向和完整协议层级以 [architecture.md](architecture.md) 为准。本页只定义命令应落在哪一层，以及跨层变更的同步要求。

## 唯一业务通道

```text
Desktop: Renderer typed gateway
  -> preload / Desktop Host（仅宿主能力或 JSONL 转发）
  -> app_server_handle_json_lines

TUI/CLI: lime CLI / tui
  -> Rust app-server-client session
  -> local stdio or authenticated WebSocket transport

Future Cloud: authenticated remote transport
  -> Rust app-server-client session

All surfaces
  -> App Server JSON-RPC method
  -> runtime/domain owner
```

业务能力只通过 App Server JSON-RPC 进入 Rust runtime。Electron IPC 只用于窗口、文件/目录选择、系统权限、外链、托盘、自动更新、sidecar 生命周期等宿主能力，或转发 `app_server_handle_json_lines`。CLI/TUI 只负责参数、TUI 生命周期、输入事件和 App Server transport。Renderer 与 TUI/CLI surface 都不直接调用 provider、tool runtime 或数据库。`app-server-client` 已提供 authenticated WebSocket transport foundation；握手在发送 `initialized` 前校验 `app-server` 服务端身份和 `appserver.v0` 协议版本，但生产 Cloud 仍未启动，后续必须补齐租户隔离、凭证、跨网络恢复、限流和审计，且不能改变业务 method 语义。

## Owner 判定

| 需求                                                            | Owner                                                  |
| --------------------------------------------------------------- | ------------------------------------------------------ |
| Thread / Turn / Item、read model、evidence、业务查询与写入      | App Server protocol + handler + current Rust domain    |
| 模型路由、canonical content、capability、provider wire lowering | `runtime-core` / `model-provider`                      |
| 工具定义、审批、sandbox、dispatch、MCP                          | `tool-runtime`                                         |
| 窗口、系统文件选择、通知、Dock、tray、updater、sidecar          | Electron Desktop Host                                  |
| Cloud session credential 的平台加密保存、删除与 metadata        | `electron/secureCredentialStore.ts` + Desktop Host IPC |
| UI request builder、response normalization、projection          | Renderer `src/lib/api/` 或 typed package               |
| TUI composer、terminal lifecycle、terminal projection           | `tui`                                                  |
| CLI 参数、非交互输出、进程退出码                                | `cli`                                                  |
| 本地/未来远端 App Server 会话、请求并发和 reverse request       | `app-server-client`                                    |

禁止为业务调用新增第二个 Electron/CLI 后端、renderer mock fallback、临时 DevBridge 命令或 legacy wrapper。生产失败必须显式失败；mock 仅在测试夹具中显式注入。

Cloud session credential 的 IPC 只允许 `cloud_session_credential_set`、
`cloud_session_credential_status` 和 `cloud_session_credential_delete`。写入由
Electron `safeStorage` 加密后落在统一 `AppDataRoot/credentials`，状态接口只返回
`exists`、`tenantId`、endpoint 和更新时间，不提供 token 读取 IPC。token 不得进入 URL、
query、Debug 或日志；safeStorage 不可用时必须 fail closed。该 owner 只是 Cloud
transport foundation，不会启用默认远端 App Server，也不替代 App Server JSON-RPC。

产品云账号的共享 owner 为 App Server `account` 领域，入口为 `account/login/start`、
`account/read`、无参 `account/logout`，同进程广播 `account/updated`。上述请求与 `cloud/request` 使用同一
`accountAuth` 序列化队列。`cloudAuthTokens` 是明确的外部会话扩展：由 Rust 调用
LimeCore `client/session` 验证租户/用户/会话，成功后原子替换组合根注入的
`AppDataRoot/credentials/account.json`；读取与通知只返回 metadata。此私有文件 owner
服务 Desktop/CLI/TUI，和上述未来 WebSocket transport 凭证用途不同，不提供 token 读取 RPC。
GUI 公开登录的临时 token 只用于导入；localStorage credential owner 与 window token globals
已删除，不迁移。`cloud/request` 由同一 AccountManager 发往当前 issuer/tenant 的 client API，
params 只有 path/method/body，无 caller URL/headers/token。禁止 redirect/路径越界，15 秒/
4MiB 上限，返回 status/body 和账号 metadata；Session/bootstrap 的账号 token 不回 renderer。
消费者重读共享账号并比对响应身份，避免换号/注销后的旧响应覆盖新投影。登录 JSONL 的诊断
不记录凭据。CLI 入口、OpenAI managed/device/API-key 与远端插件物化继续由执行计划跟踪。

## Desktop persisted atom

桌面未发送 UI 草稿与 Summary 固定偏好只允许：

```text
Renderer -> src/lib/api/persistedAtoms.ts
  -> current safeInvoke -> preload / persisted_atom_read|persisted_atom_update
  -> Main delegate -> PersistedAtomHost -> PersistedAtomStore -> PersistedAtomFile
  -> fixed AppDataRoot/host-state.json
```

草稿 read 为 `{key:"composer-drafts-v1",query}`，query 判别为 `{kind:"scope",scope}` 或 `{kind:"workspace-index",workspaceId}`；ready 结果分别为 `data:{queryKind:"scope",view}` 或 `data:{queryKind:"workspace-index",workspaceId,items}`，invalid/unavailable 为 data:null。草稿 update 为 `{key,mutation}`，仅支持 put/promote/consume/clear。索引精确匹配 workspace（含null），只发现当前 live binding，返回 scope/identity/updatedAt/sessionId?/threadId?，不读正文、不改变 revision、不截断。选中后重新读scope并执行原CAS。

Summary 固定偏好复用同两个命令和同一文件：key 为 `app-shell-summary-panel-pinned`，read query 为 `{kind:"value"}`，ready data 为 `{queryKind:"value",value:boolean}`；update mutation 仅为 `{op:"set",value:boolean}`，applied 结果为 `entry:null,value:boolean`。默认 true，文件缺失该 atom 时亦为 true；存在但类型错误须拒绝，不能强转或静默重置。宽 pane 的 toggle 写入该偏好，overlay toggle 仅开关 popover。它是 Desktop UI 偏好，不是 Thread/Turn/Item 字段。

read/update 结果与 `persisted-atom-update` notification 必须经过同一纯 JSON parser，并核对请求 key 与 query/mutation。两个 atom 共用 storeRevision/savedRevision、串行保存与 backup；每次广播两个 key 的 revision / persistence metadata，不含草稿正文或偏好值。草稿协调器忽略其他 key；Summary 拒绝较旧 revision 回读。Renderer emit/send 与 Main IPC handler 拒绝伪造该事件。旧 scope-only/top-level view 已直接删除。

`PersistedAtomStore` 为唯一 CAS/binding owner，`PersistedAtomFile` 为唯一原子保存/backup owner。typed gateway 之外禁止裸 invoke/listen；catalog、preload 白名单、实际 handler、ESLint restriction 与 command guard 同批同步。safeInvoke 与 HTTP 诊断由同一 `invokeDiagnostics` 承接，保存参数和任意原始错误正文不进入 trace/console。

该能力属于 Desktop UI 保存，不能承接业务 session、canonical transcript、队列、App Server runtime 或 Provider 请求；不新增 JSON-RPC method、CLI/TUI 草稿后端或生产 mock。Host ready 仅证明加载完成，savedRevision 才证明该 revision 已落盘；发送和退出不增加持久 checkpoint 或等待握手。真实正常重启仅证明 Host/IPC/file 基础能力，GUI 富草稿恢复仍需另验。

GUI send 的本地返回统一为 `RuntimeSubmissionResult`：`runtime-accepted` / `queue-accepted` / `local-handled` / `rejected` / `unknown`。start/steer 的接受从真实 response 捕获，queue 从真实 QueuedSubmission 投影；后处理失败不能撤销接受。composer capture、restore token 与导航 epoch 都是 renderer 本地能力，不增加 App Server wire 字段，也不以 void/boolean 或 dispatched 猜测接受。TaskCenter 请求保留原 capture，发送驱动的 materialization 禁止提前 promotion；接受后由唯一 React owner 使用 receipt 的 sessionId/threadId 先 promotion 再 consume。

## TUI/CLI 与 Cloud transport 边界

TUI 推理显示只消费同一协议的 summary/summaryIndex；原始 content 默认隐藏。摘要
分段 facts 归 `projection/reasoning`，正文拆分/详情绘制归 `history_cell/reasoning`，
status 从原始 parts 提取，pager/export 从同源 body 读取。独立空注释与首段活动标题
不重复绘制，canonical completion/历史快照保持既有 item identity；不新增私有配置、
method 或第二 read model。显式 raw reasoning 由下方共享
`show_raw_agent_reasoning` 策略承接，summary/content 保持独立索引。

运行中摘要恢复只由 TUI `projection/history` 暂存 host-owned recovery intent：同一
InProgress Turn 的 full snapshot 尾部 Reasoning 恢复 parts/status，后续首个增量可没有
item/started；不同 non-user item/Turn terminal 收尾，旧页不覆盖 live 进度，非尾部或
closed item 不重开。它继续消费同一 metadata-only resume 与 canonical items/turns 分页，
不新增 protocol 字段、IPC、GUI 私有策略或持久化完成标记。

`app-server-client` 是所有非 Renderer Rust surface 的会话 owner。它负责 JSON-RPC request id、并发 pending request、notification、reverse server request、断线与关闭；`tui` 和 `cli` 只能消费其 typed facade。当前 production transport 支持本地 stdio 与受控 authenticated WebSocket foundation。transport trait 是两种实现共用的依赖倒置边界；远端 token 仅允许 `wss://` 或 loopback `ws://`，remote 默认固定 `app-server` 身份和 `appserver.v0` 协议版本，生产 Cloud endpoint 仍需在租户、重连和审计策略明确后单独启用，不增加假 endpoint 或 fallback。

CLI surface 使用 Codex 风格命名：`lime`（无子命令）和 `lime tui` 进入 TUI，`lime resume [thread-id]` 通过 `thread/resume` 恢复 canonical 历史；省略 id 时先用 `thread/list` 打开 TUI session picker，再复用同一 resume 流程。`lime exec` 执行一次非交互回合；`lime execpolicy check --rules <path> <command...>` 由 CLI 的 `ExecpolicyCommand` / `ExecPolicyCheckCommand` 读取 prefix-rule 文件并输出 Codex 形状的 `matchedRules` 与最严格 `decision`，不参与实际执行和权限 lowering；`lime mcp list` 和 `lime skills list` 分别读取 current MCP/Skill catalog。TUI 的 `/model` 使用 `model/list` 可见 catalog，选择后统一写入 `thread/settings/update`；模型目录的 authority 仍在 App Server。这些入口都复用 `app-server-client` session owner，不得引入旧的 TUI 命名或平行历史/runtime 后端。TUI 连接断开时只允许 bounded reconnect + 原 Thread `thread/resume`，保留 composer draft，清理失效审批请求；重连失败必须显式退出。旧 `task`、`media`、单数 `skill` 与旧 `doctor` 命令已判定为 `dead / deleted / forbidden-to-restore`；媒体和诊断能力必须由 App Server current owner 承接，不得回填 CLI 直连入口。视频生成的 Agent surface 只允许使用 current typed `video_generate` 工具，经 `tool-runtime` gateway 委托 App Server `mediaTaskArtifact/video/create`；旧 `lime_create_video_generation_task` 不提供 alias 或 compat。

CLI/TUI/`exec`/`resume` 共用 Codex 形状的权限输入：`--sandbox {read-only|workspace-write|danger-full-access}`、`--ask-for-approval {on-request|never}`、`--approve-for-me`（隐藏 alias `--not-so-yolo`）和 `--dangerously-bypass-approvals-and-sandbox`（alias `--yolo`）。这些参数只 lowering 到已有 `thread/settings/update` 的 `approvalPolicy`、`approvalsReviewer` 和 `sandboxPolicy`；`--approve-for-me` 固定为 `on-request` + `auto_review` + `workspace-write`，危险绕过固定为 `never` + `danger-full-access`。root 级参数继承到 `tui`、`exec` 和 `resume`，子命令显式权限组覆盖 root；显式 sandbox 与 `--permissions` profile、approve-for-me 与其它权限组互斥，冲突在连接 App Server 前 fail closed。

`approvalsReviewer` 经唯一 settings actor 持久化，Turn lowering 使用 typed RuntimeRequest/Turn context。
`auto_review` 在 shell 需要审批时选择现有 Guardian（首次和 sandbox/network retry 均适用），不读取人工 session
approval cache；普通自动模式不增加无审批动作的采样，也不触发 strict permission grant notification。
`strictAutoReview` grant 仍强制走严格审查。无法自动审查的非 shell 审批明确拒绝，禁止退回人工审批。
Guardian sampling 仍由 session model-provider 承接，取消/超时/非法响应 fail closed，并结算同一 review lifecycle。
public v2 的 start/fork/resume/settings/turn 复用同一 reviewer enum，非法输入在 dispatch 前拒绝；响应和
settings notification 返回实际 reviewer，缺省为 `user`。`guardian_subagent` 只作为读取别名，输出统一为
`auto_review`；旧 settings 事件的 null/missing 在 durable event 投影边界转换为 `user`。
旧 metadata/importer 的完整迁移另由共享后端计划 R02 跟踪。

插件命令按 [Codex 插件合同](../roadmap/plugin/codex-contract.md) 重构，CLI/TUI/GUI 共用
App Server 与 typed client。目标 list/installed 返回 marketplace 分组，read/install 通过市场与
pluginName 定位，uninstall 使用完整 `name@marketplace`，启停走共享 `config/batchWrite`。
旧 `sourcePath` 安装、扁平 catalog DTO、自建 `plugin/enabled/set` 已删除，禁止恢复为
消费者合同或兼容入口；市场管理走 `marketplace/add/remove/upgrade`，来源记录在共享配置。
远端 list/read 委托 RuntimeCore 插件 owner 与共享 AccountManager，不暴露 token/header/
任意 URL；账号 metadata 来自同一 account RPC。远端 pluginName 必须是 remotePluginId，
本地仍用 canonical name；不接受缺 ID 时回退名字。显式 local 不触网，显式远端缺账号失败。
GUI 插件页与 customization 侧栏在账号变化后清空旧目录并重新读取同一 plugin catalog /
plugin/installed，迟到响应不覆盖；bundle URL 不投影到 GUI。
远端安装复用共享 PluginStore 的暂存/提交/回滚；独立下载不携带账号 header，完整下载预算
60 秒，tar.gz 压缩上限 100 MiB、普通文件累计 512 MiB。来源绑定 opaque ID 与共享账号
fingerprint，Skills/MCP/Hooks 只读取当前账号匹配的安装记录。Electron 的请求超时策略由
`electron/appServerRequestTimeout.ts` 持有，current DevBridge 复用既有 long-running 分类：
`plugin/install`、`plugin/reconcile` 与当前五个 `plugin/share/save/list/updateTargets/delete/checkout` 等待窗口
均为150秒，其他插件读请求仍为30秒；Host只传输请求。
分享五方法与account/cloud复用AccountAuth队列；save的pluginPath必须为绝对路径，manifest和tar.gz
由共享PluginStore处理。renderer只接收typed结果，不接触上传capability、归档字节或账号凭据。
UNLISTED补当前workspace reader；create/update都POST，撤回严格要求204，失败不回退旧插件。
checkout仅取授权workspace分享为home内可编辑目录，注册同一store的个人市场和账号编辑映射；
复用目录保留编辑，未映射现存目录拒绝，不产生远端install或本地installed事实。
prefer-cache及其余完整合同继续按Codex补齐。实现和验证以
`internal/exec-plans/codex-plugin-reconstruction.md` 为准。

`@limecloud/lime` 的 npm 根包只暴露 `bin/lime.js`。它按当前 host 解析 optional platform package，启动 `vendor/<target-triple>/bin/lime[.exe]`，继承 stdio，转发 `SIGINT`/`SIGTERM`/`SIGHUP` 并镜像原生进程的退出码或 signal。平台载荷必须把 `lime`、`app-server`、`code-mode-host`、Windows sandbox helpers 和动态运行库放在同一 `bin` 目录，使 Rust CLI 的 sibling lookup 继续命中唯一 App Server 产品链。禁止恢复 npm `postinstall` 网络下载、生产 `LIME_CLI_BINARY_PATH`、源码 target 搜索或 `cargo run` fallback；开发 staging 仅允许从根包本地 `vendor` 读取与平台包相同的目录合同。

CLI/TUI 可使用 Codex 形状的 `--remote <URL>` 连接 WebSocket App Server；Bearer token 只从 `--remote-auth-token-env <ENV_VAR>` 指定的环境变量读取。未提供 remote endpoint、环境变量缺失或 token 为空时，连接在 initialize 前失败；token 不写入配置 Debug 或 URL，remote URL 中的 userinfo/fragment 也会被拒绝；不安全的公网 `ws://` token 连接由 `app-server-client` fail closed。

目录选择由 CLI `ConnectionArgs::workspace_cwd` 唯一决定：本地缺省使用客户端当前目录；
远端未传 `--cd` 时，start/Turn/fork 不发送客户端 cwd 或 roots，恢复列表不按客户端
目录筛选。显式远端路径原样传输，不在客户端检查存在、canonicalize 或改写 Windows 路径。
App Server 的 `session_operations/working_directory` 解析服务端缺省与相对 cwd/roots；
start/fork 的响应和持久化使用同一绝对目录，Turn 的相对覆盖也在服务端解析。
权限计算在省略 Turn cwd 时使用 canonical Thread cwd；TUI 从 start/resume/settings
响应更新当前目录，搜索、编辑器和后续请求消费该投影，不保留启动时的本机目录。
旧空值、相对 cwd/roots 与 root `cwd`/`working_dir` 别名在活动 Thread resume 时经已有
metadata actor 幂等归一，写入失败保留原数据并允许重试；归档 resume 不迁移，
fork 只归一新 target。已保存的绝对目录保持原值，不推测修正历史误传路径。

TUI `/model` 的模型和推理强度选择只消费同一次 `model/list` 的 supported/default effort。
模型、普通 effort 和 More reasoning 子层在确认前不写设置；Esc 逐层返回并保留模型搜索/高亮，
确认后经单次既有 `thread/settings/update` 同时写 model/provider/effort。v2
`thread/read`、`thread/list` provider filter 和 `thread/resume` 统一从 canonical durable
settings metadata 投影当前 provider；rollout 的创建字段保持不可变，不拿创建 provider 覆盖后续选择。
账号额度告警、全局默认持久化和 Plan-only scope 不由 TUI 猜测或复制。

TUI Alt+, / Alt+. 与 `/model` 共享同一 catalog reasoning options。模型/provider 必须唯一
匹配；unset/unsupported 先定位 server default（default 不在列表则首项），普通档位保持
advertised order，Max/Ultra 后置；边界不循环，Raise Ultra 只提示从 More reasoning 明确选择。
modal/popup、未完成 startup 和 parent-owned thread 禁止穿透；当前服务端尚无独立 Plan-only
effort override，因此 Plan 快捷键显式 fail closed，不把普通 durable settings 更新冒充该 scope。
普通模式只经既有 thread/settings/update 修改当前 Thread，成功后再更新本地投影，不写全局默认。

TUI 偏好只允许位于同一 Lime 用户配置的 `tui.right_click_paste`、`tui.keymap`、`tui.status_line`、
`tui.status_line_use_colors`、`tui.terminal_title` 与 `tui.animations`，由启动期
`config/read -> LocalSettings -> RuntimeKeymap` 解析为进程内不可变 snapshot；主 TUI 与独立 resume
picker 都必须在进入 alternate screen 前完成读取。`tui.animations` 默认true，false关闭
effort ignition、status-line transition及运行状态shimmer；低色终端仍保留静态accent。
Max/Ultra真实变化使用Composer内Wave/Aurora/Pulse（不连续重复），首次观察/启动/resume/
hydrate只建立baseline；效果首次可见render起算，popup不消耗ignition时钟，缺palette取消。
status-line outgoing、tier label和fade使用同一FooterProps投影与FrameRequester，无私有timer。
其余当前真实 consumer 包括
`tui.right_click_paste=auto|on|off`（右键 CLIPBOARD；中键 PRIMARY 仍要求本地 X11）以及
`global.open_agents|open_transcript|find_transcript`、pager 的
`scroll_up|scroll_down|page_up|page_down|half_page_up|half_page_down|jump_top|jump_bottom|close|close_transcript|find`
以及 `agents.resume|search|new_task|rename|stop|toggle_grouping`。
`list.move_up|move_down|move_left|move_right|page_up|page_down|jump_top|jump_bottom|accept|cancel`
当前由 resume/fork、模型及两级推理强度 picker、`/subagents`、`/statusline`、`/title` 和 Agent Center 消费，
其它 lists 尚未接入；默认 Ctrl+F/Ctrl+B 为 paging，
旧 Ctrl+F filter / Ctrl+S status / Ctrl+R sort 已删除。picker 固定退出、详情/密度、焦点和
搜索删除键不可被该 context 截获，冲突配置 fail closed；可打印导航仍优先进入搜索。
模型与子 Agent 选择复用 `bottom_pane/list_selection_view.rs` 的无边框底部布局、
换行 viewport 和真实按键 footer；`/subagents` 默认定位当前 Thread，显示 canonical
路径/Thread ID/closed 状态点。它只返回线程选择，实际切换仍由 App Server thread/resume 承接。
每个 action 接受单个按键字符串、
有序 alternatives 数组、最多两段且以空格分隔的 chord，或空数组显式 unbind。未知
context/action、非法键名、超过两段的 chord、同 context 冲突、single/chord prefix 冲突和会截获普通
文本的 printable chord prefix 均 fail closed；只有 Vim modal contexts 允许 printable prefix。
dispatch 与 footer hint 必须消费同一 snapshot；不得为 composer 专用提交/队列等尚未接线的
context 提前暴露配置，也不得新增 TUI 私有配置文件或环境变量配置面。

`/statusline` 的 current owner 为 `bottom_pane/status_line_setup` 与 `multi_select_picker`。
确认只经现有 `config/batchWrite` 同时更新有序 `tui.status_line` 和 `tui.status_line_use_colors`，
携带 `config/read` 用户层版本；取消不写，冲突不自动重试。None 使用 model-with-reasoning /
current-dir / thread-name，显式空列表关闭。preview/footer 共享 `status_surface_preview` 的真实
settings/cwd/Thread facts，未知或不可用项目省略，不填静态额度或 usage。Space 为多选固定键，
不得被 list 配置截获；左右排序只在空 query 生效。配置 schema 仍由共享 core TuiConfig 校验，
App Server config wire 保持现有 JSON value，GUI gateway/Host 无新增命令或平行配置。
状态栏运行状态/线程标识的 canonical ID 为 run-state/thread-id；Codex 自身的 status/
session-id alias 只在解析时识别，选择器确认直接保存去重后的 canonical 列表。

`/title` 对齐 Codex `bottom_pane/title_setup::TerminalTitleSetupView`，复用同一 MultiSelectPicker
的 state、布局、ListSelectionView geometry、preview 行与 resolved controls。临时 selection
只投影到现有 managed OSC，取消/断线/hydrate 恢复 saved preferences。确认只写共享
`tui.terminal_title`；标题和状态栏统一由 `app/status_controls::write_tui_preferences` 做
版本校验、config/batchWrite 与失败重读，不复制 transport 或建立私有存储。None 默认
activity/thread-name/project-name，[] 关闭；App facts renderer 同时用于窗口标题和配置预览。

状态栏/标题与 `/status` 的 token facts 只消费既有 `thread/tokenUsage/updated`，累计取
typed `total`、上下文取 `last` 与服务端 window；五语言显示和百分比算法统一在
`status/helpers`。没有用量来源时省略，未知 window 不补默认 100%。历史 read model
当前不含 token snapshot，因此原 bounded ThreadEventStore 在 session refresh 时保留
最后一份已观察 usage，继续按 current Thread/最后 Turn 校验；不新建 method、缓存文件、
provider 调用或第二套累计 owner。GUI 继续使用同一现有通知，不复制 TUI 交互组件。

顶层 `show_raw_agent_reasoning` 是 GUI/TUI 共享显示策略，默认 false；只通过现有
config/read 与 config/value/write、config/batchWrite 读写，由 core Config 校验 bool。
TUI LocalSettings 在进入终端前读取，live、hydrate、分页、完整记录及 export 均传递同一
snapshot。GUI ReasoningVisibility 消费同一 gateway/config changed，canonical reducer 保留
summary/content 独立索引，仅 renderer 决定原文是否显示；不得另建 stream buffer 或私有开关。
默认隐藏原文，不以 raw-only content 回退摘要。显式开启时按 summary 后 content 顺序显示，
不修改 canonical 身份/内容。顶层 hide_agent_reasoning 默认 false，仅由 CLI exec human
output 消费：隐藏优先于 raw 开关，未隐藏时 raw 有内容则选 content，否则选 summary。
CLI exec owner 在 cli/src/exec，直接使用共享 app-server-client transport 与 typed canonical
notifications；不得恢复 tui::run_exec、TUI projection 依赖或第二业务后端。
`exec --json`由同名`exec/exec_events`与`exec/event_processor_with_jsonl_output`输出
Codex形状逐事件JSONL，每条即时flush；只创建一个human或JSON renderer。
thread.started携带canonical Thread ID，Item生命周期使用本次输出内稳定的递增编号；
重复/迟到start不重开，terminal补漏，canonical正文变化以item.updated修复。
machine Reasoning只消费summary，不输出content；todo_list来自typed plan notification。
turn.completed使用最后usage.total五字段，failed为error/turn.failed和exit1，interrupted
无成功终态且exit130，连接前失败仅error。旧jsonl flag、render_json_envelope与single
result serializer已删除且禁止恢复；schema由Rust合同生成并随npm根包分发。
exec参数归同名`exec/cli.rs`，human输出归`exec/event_processor_with_human_output.rs`。
同名Command/ResumeArgs/ForkArgs/ExecSharedCliOptions承接exec resume/fork；shared连接参数仍由
ConnectionArgs唯一声明，root/exec/resume/fork逐层继承，显式子级权限组覆盖父级。
resolve_resume_thread_id只消费typed thread/list，updated_at倒序、未归档，本地或显式cwd时筛选，
远端缺省或all取消cwd筛选，UUID优先、名称精确匹配；找到后走thread/resume再turn/start。
last/name无匹配沿Codex语义新建，实际resume失败不fallback；不读取私有DB或rollout。
exec/thread的start_thread统一start/resume/fork生命周期。fork查源始终跨cwd，UUID优先、
名称精确匹配；缺源直接失败。thread/fork沿用canonical history/lineage与新Thread身份，
显式cwd/模型/权限在既有fork/settings合同设置。无PROMPT为ForkOnly，不读取pipe或
启动Turn，JSON仅thread.started，human五语言标签显示新会话ID；图片或-o要求PROMPT。
显式PROMPT或-为UserTurn，继续走共享turn/start与同一输出processor。
root/resume/fork的-i/--image为单参数、逗号列表、可重复；root图片先于子级图片，
最终Text排在图片之后。仅lower到typed LocalImage，读取/媒体lowering仍由共享runtime拥有。
App Server transport对thread/fork成功响应与start/resume使用同一SubscribeAndSend，
订阅响应里的target Thread，先回应再发thread/started；其后Turn通知供所有surface消费。
resume与fork source共用runtime/thread_fork/hydration的恢复选择；public fork的forkSequence
走canonical history与event log恢复，cold nested fork不进入generic全局Turn repair，不改
历史Turn/Item ID、source Thread或lineage。普通与AgentControl会话继续使用原恢复owner。
ExecCli.output_schema为global FILE参数，load_output_schema只读取/解析UTF-8 JSON，
InitialOperation::UserTurn将其传给既有TurnStartParams.output_schema；不校验/解释schema、
不更新Thread/global设置。fork-only携带schema或文件读取/JSON错误在连接前显式失败。
同名Command::Review/ReviewArgs/build_review_request只选择typed ReviewTarget：
--uncommitted/--base/--commit/custom互斥，--title要求commit且不能附到其它target；
没有target或custom空指令在连接前报错，custom '-'复用stdin解码并trim，显式指令忽略pipe。
InitialOperation::Review只走review/start；provider prompt与审查边界由共享runtime构造，
CLI不读取git或实现review loop。输出沿用同一EventProcessor及最后消息文件owner。
顶层Subcommand::Review/ReviewCommand由review_cmd委托同一ExecCli Review，不保留另一套
target解析。连接、权限与locale继承root；顶层默认human stdout最终回答/stderr过程，
JSON与-o仍由exec review入口提供。root main仅做类型注册与委托，不承接审查业务。
PROMPT为单参数，root+pipe追加stdin块、省略/-读取stdin；resume显式prompt不追加pipe。
prompt owner统一InitialOperation选择、UTF-8 BOM/UTF-16 decoding与空输入检查。output-last-message由共享
EventProcessor按成功canonical最终答案写入，失败/中断保留文件，写失败显式报错。
当前Thread/Turn的工具开始/终态/聚合输出、plan/diff、warning/error、model reroute和
hook均只进入stderr；canonical Item ID去重，terminal快照修复遗漏的最终回答。
用量只显示最后一次服务端累计快照的`max(0,input-cached)+max(0,output)`，不自行累加，
排除cached input且饱和运算；结束时输出`tokens used`和千位分隔数。
`--color auto|always|never`仅控制human标签，auto要求stderr TTY且无NO_COLOR/dumb终端，
always显式覆盖；机器模式不消费human renderer。`--locale`（含root继承）优先于
LIME_LOCALE/LC_ALL/LANG，覆盖五语言；两端都是TTY时只在stderr展示最终回答，任一端
被重定向时stdout输出成功最终答案，failed/interrupted保持空stdout及1/130退出码。

composer 常驻推理档位提示由 `bottom_pane/effort_ignition::EffortTier` 承接：Max 为金色 ›，
Ultra 为紫色 »，其它/未知档位普通 ›，禁用输入为 dim ›。ChatWidget/settings 统一刷新
当前 effective collaboration/settings 投影；未指定普通档位保留已有 mode override，
显式 mode clear 才撤掉该 override，沿用已有协作设置语义。
提示符不进入 ComposerDraft 或用户消息，不改变一列 prompt gutter、cursor 或附件几何。
颜色通过已有 terminal_palette/style，NO_COLOR 不加色，ANSI16 使用 yellow/magenta。
一次性 ignition 动画/状态栏过渡复用同一FrameRequester与共享tui.animations，配置与
baseline规则见下方动画合同；不建立平行模型策略。
文件/技能补全列表分别由 `bottom_pane/file_search_popup` 与 `bottom_pane/skill_popup`
拥有绘制、选择和列表按键，直接消费既有 picker_rows/scroll_state/selection_row_layout。
ChatComposer 仅持有同一popup state并负责token替换/显示生命周期；旧composer子目录
模块与action re-export已删除，禁止恢复路径别名或第二列表实现。
命令/文件/技能补全处理Press和Repeat，忽略Release；Ctrl+P/N只匹配CONTROL。
command旧Ctrl+J/K导航已删除，二者继续由editor换行/删行绑定消费，不截获Ctrl+Alt。
AltGr文本沿同一key_hint/textarea的Windows规则；Unix Ctrl+Alt保持控制chord。
空输入Left导航由ChatComposer.handle_empty_prompt_shortcut独占，仅Press触发。
agents_navigation_key_available从当前editor/Vim move_left动作判断：Left重绑或解绑后
导航与footer提示同时失效；Repeat仍归editor，Release忽略。paste burst、pending chord、
search、附件、disabled输入与remote会话均不抢导航，不保留fallback或editor bypass。
Vim Normal的空草稿在plain '/'解析为search且无query/popup/pending operator/chord时
进入Insert并交给同一slash补全；非空草稿、搜索chord和显式remap/unbind仍由Vim动作拥有。
普通 composer footer 同样从上述 typed usage lowering 出 immutable FooterProps：有真实
window 时显示剩余百分比，无有效 window 时 fallback 为 server total.total_tokens，未知为空。
bottom_pane/footer 独占左右布局和窄屏优先级；passive status 不再重复 context，右侧为
模式/Vim；其它输入 modes/overlay 的展示边界不变。无新增命令或私有用量累计状态。

TUI 空输入两次 Esc 使用 `app_backtrack -> thread/turns/list` 读取 Full Turn，Enter 只请求
现有 `thread/revert {threadId,beforeTurnId}`。新建 CLI/TUI Thread 明确使用 Paginated，
fresh startup 与 resume 共用服务端 Thread hydration；Legacy 的回退显式不可用。目标
只能为已结束 Turn 的首条用户输入，steer/隐藏 review/残缺 typed input 不可独立回退。
取消恢复原 pager bookmark，不发 mutation；回退不回滚工作区文件。response 与
`thread/reverted` 共用 metadata-only read + bounded item paging 替换同一 projection，
刷新中的新通知与未决请求由既有 ThreadEventStore 保存重放，失败禁止提交且 Esc 重试。
恢复输入委托同一 HistoryEntry typed conversion，保留 TextElement、图片 detail 和
Skill/Mention path，不从 transcript 文本重建。GUI 继续使用同一既有 thread/revert 合同。

历史读取不以 historyMode 分流：resume/reconnect 请求 `excludeTurns=true`，所有存量
Thread 都经既有 `thread/items/list` 与 `thread/turns/list` 分页读取。非空页必须取得
对应 Turn facts；失败保留原 cursor/retry，不回退 `thread/read(includeTurns=true)` 或
item-only 展示。picker preview 先过滤 canonical review 再取六行，最多扫描 400 items；
完整 transcript/导出校验 Thread identity 与 item/Turn 对应关系。生命周期同样从 Turn
facts 恢复，存量 Legacy 的读取能力不改变其 thread/revert 限制。无 method/schema/
GUI gateway/backend 改动。

`editor` 的 17 个 Codex 同义动作由 `TuiEditorKeymap -> RuntimeKeymap.editor ->
TextArea::set_keymap_bindings/input_with_keymap` 消费，composer 普通/Insert/Replace 不再维护
静态编辑键清单。alternatives、chord 和显式 unbind 复用同一 matcher；global 与 editor 同键
或共享 chord prefix、host/composer 保留键冲突 fail closed。普通 Enter 仍是提交，editor
insert_newline 只承接修改键/其它显式绑定；history Up/Down 仅在对应 editor 动作仍绑定时进入。
pending chord 的完成/取消不穿透 App host/global；AltGr 字符不误触发 image paste。Vim Insert
录制 resolved semantic edit，改绑不改变 `.` 重放；配置 snapshot 不进入 ComposerDraft。

`vim_normal|vim_operator|vim_text_object|vim_search` 的 36/20/9/4 个 Codex 同义动作由
`TuiVim*Keymap -> RuntimeKeymap.{vim_normal,vim_operator,vim_text_object,vim_search} ->
TextArea::keymap_context -> VimKeymap::dispatch` 消费同一个 chord matcher。
Normal/operator/text-object 不保留 raw-key fallback；find/replace 的 literal 字符捕获仍归
TextArea。默认 `gg` 是两段 chord；显式 modal 绑定优先于同 context 默认，默认 search/modal
向显式动作和实际 global 绑定让位，显式冲突与保留 host 键 fail closed。undo/redo、事务启动、
Normal history movement 和 repeat 只消费 resolved action。`KillBufferKind` 区分 characterwise/
linewise；行复制/删除/vertical operator 与 `p` 共用 textarea register owner，不从 newline 猜类型。
App 同时将 snapshot 传给 composer 与 BottomPane；新请求和排队请求中的 user-input notes、
MCP 文本字段及 Vim query editor 使用同一 editor owner，pending completion 不穿透提交/取消。
旧 MCP Ctrl+J 换行 fallback 已删除，解绑不恢复硬编码入口。

successful thread handoff 先从同一 paste-burst owner 物化 held typing，再保存 composer 的
rich draft；目标恢复通过 `restore_thread_input_state` 重建编辑状态，注入当前 bindings。
旧 undo/redo、command/search、pending chord 与 popup dismissal 不进入新 Thread，register
通过 Codex 同名 `KillBufferSnapshot` take/restore 保持 session 语义。相同 Thread reconnect
不重建编辑器，失败 resume 不改当前 draft。该状态只属于 TUI 内存投影，不能成为 GUI 的
业务 read model、App Server 持久化字段或第二 backend。

TUI successful thread handoff 同时移交 `ThreadInputState` 中的 rich draft 与 unresolved
`BottomPaneInputState`。问答每题备注/选项/focus、审批选择和MCP表单保持原view，目标恢复
消费快照并注入当前keymap；打开Agent Center不提前搬走输入。相同Thread的resolved、
turn terminal、item started与ThreadClosed清理当前/休眠view，MCP只按其独立resolved或
ThreadClosed清理。断线统一清旧connection交互和bounded replay，不丢主输入草稿。
断线主输入经 BottomPane 委托唯一 `ChatComposer::handle_restricted_key`，先 flush 已接收
的 held/raw paste，再按登记范围逆序展开长粘贴；Backspace 删除一个 grapheme，保留
图片/mention 身份。Enter/Tab 仍不 submit/queue，恢复后继续 normal PasteBurst；旧
`handle_disconnected_key` 已删除，无兼容入口或 TUI 私有 runtime。
所有这些均为TUI内存投影，canonical queue、waiter、Thread/Turn/Item仍归共享App Server；
不新增GUI私有策略、method/schema、配置或另一套后端。完整ChatWidget owner迁移仍partial。
bounded ThreadEventStore 的 replay 只认同一张 exact request-id 未决表，不以 item/category
索引推测请求是否仍待回答。resolved/outbound/eviction 都按原 response identity 清理；
ItemStarted 同时匹配 turn/item，MCP 仍等待自身 resolved。无 native Op/FIFO 兼容适配。

Agent Center 默认任务键位为 Codex current 的 `o/f/n/r/x/g`（resume/search/new/rename/stop/group），
旧 Ctrl 组合不保留隐式兼容；`Ctrl+F/Ctrl+B` 归 list paging，metadata editing 不执行 printable
task shortcuts。用户显式配置覆盖默认值；标签页/帮助不宣传已被 task binding 占用的入口。
Agent Center task/list 共用同一 chord matcher，允许不同 action 共用 prefix；任务快捷键在任务列表优先，
编辑/search/help 不触发 task action，确认与返回始终来自实际 list bindings，不保留 Enter/Esc/Ctrl+D 暗路。

## Codex 能力边界

GUI/CLI/TUI 的 `turn/start|steer` 与 `thread/queue/add|update` 共用 canonical input 长度规则，
所有 Text parts 按 Unicode scalar count 汇总，上限只来自 `agent-protocol::input` 的
`MAX_USER_INPUT_TEXT_CHARS`（1 << 20）。超限返回 Codex structured INVALID_PARAMS，
`data={input_error_code:"input_too_large",max_chars,actual_chars}`，不创建 Turn 或修改既有 queue。
RuntimeCore admission 使用同一 validator；服务端不 trim GUI 文本、不拼接/重排输入部分。
TUI `chat_composer/submission` 在展开 pending paste 后 trim/rebase，再执行同一长度校验；
失败保留完整 rich draft，主 transcript 与嵌入式 notes footer 显示五语言错误，不新建业务
method、Electron 命令、私有配置或 mock fallback。

备注输入使用 `ChatComposerConfig::plain_text()` 和主输入同一 `handle_paste`，不启用命令/
file/skill补全或image-path attachment。Markdown blockquote与长粘贴原子范围共用当前owner，
每题保存 `ComposerDraft`；导航恢复游标与完整payload，提交时按登记范围展开，不能把显示
placeholder作为答案。提交前snapshot只在composer成功接受后保存，返回前题可继续编辑已
接受的备注；query或超限拒绝不清草稿。locale在enqueue、host切换和thread恢复时更新。普通主输入保留默认
配置；shell/slash执行与权限仍在原host/App Server边界，不复制到备注或新增业务协议。

每题AnswerState独占草稿、选项焦点和接受状态；修改正文或选项后需再次明确接受，单纯
移动cursor不撤销接受。末题有未回答项时，confirm_unanswered复用list绑定提供继续或返回
首个未回答问题；最终response只投影已接受内容，未接受问题为空数组，不提交旧答案。
确认期间不透传输入到notes，退出确认后恢复同一rich draft/cursor。不存在第二答案缓存。
同一response投影将所有已接受备注统一编码为user_note，合成选项固定None of the above；
仅本地合成选项使用该wire label，作者label保持原样，App Server不重写任意用户答案。
非bracketed的快速按键粘贴经同一PasteBurst检测；Enter/Tab归完整正文，空闲flush经现有
FrameRequester和active notes pre_draw_tick完成。navigation先落入草稿再保存逐题snapshot；
修改接受答案时暂存字符也撤销接受，不提前回复App Server或把placeholder发送为正文。
混合ASCII/IME输入先落入held ASCII再即时插入IME；既有burst续写刷新idle时间，
保证正文与canonical答案的字符顺序，主输入/notes/MCP字段复用同一composer规则。
同名handle_paste_tab覆盖尚未active的短IME前缀：窗口内Tab接入原PasteBurst，保留备注
焦点和Unicode正文；窗口过期仍交给surface导航。不新增检测器或延长既有时间阈值。
常规runtime仅在消费TuiEvent::Draw后绘制，键盘和异步投影更新只请求FrameRequester；
Ratatui复用与Codex一致的layout-cache，避免每帧重复求解布局放大粘贴识别间隔。
主runtime与独立resume picker统一经 `Tui::screen_size_for_event` 解析geometry：普通键/
Paste/帧消费缓存，Resize即时采用事件尺寸并75ms后重采样，Resume/editor归还刷新。
`Tui::draw` 消费预留尺寸，Ratatui官方Fixed viewport避免隐式autoresize再次查询；滚动/
历史top-up同样读取缓存。Unix tmux的漏通知由broker后台SizeMonitor恢复，pause/observe/
drop使旧采样失效，不增加终端surface之外的策略或backend。
真实resize验收归 `scripts/app-server/terminal-resize-gate-b.mjs`：直接PTY保留正常信号回归，
Unix额外运行隔离tmux，fixture launcher在CLI spawn前屏蔽SIGWINCH，验证无键盘输入的
高/宽重排，以及editor期间resize、归还后首键、精确canonical提交和原tty模式恢复。
tmux缺失或不受测平台输出not-run，不能算monitor实跑通过；不修改用户tmux会话。
Windows Terminal显式`sendInput`的`ESC[13;2u`由`tui/windows_key_sequence`在现有
event source内还原为Shift+Enter，再进入同一BottomPane/ChatComposer换行逻辑；不把Esc
透传为取消操作或把序列尾部写入正文。只有完整无修饰Press序列接受映射，配对Release
合并；普通文字、Paste与失败候选原序保留，固定50ms候选deadline不因分片延长。
`tui/windows_console`在进入TUI与editor返回后清除继承的VT input位，crossterm poll前和
Pending后重申input-record mode；交接、退出、panic和失败初始化仅恢复原VT位，保留
其它console client的mode变化。无console时no-op，SetConsoleMode失败不消费snapshot。
该能力属于terminal host，不增加App Server方法、GUI配置或第二业务后端。
外部编辑器入口为App::launch_external_editor；VISUAL优先于EDITOR，包括空VISUAL直接
报EmptyCommand而不fallback。resolve_editor_command在终端交接前完成，Unix shlex/
Windows winsplit分别遵循本平台参数规则，Windows程序通过PATH/PATHEXT定位shim。
run_editor返回完整String，App清理尾部空白并回写同一BottomPane，空文本可清空输入；
失败保留rich draft并显示五语言错误。旧edit_draft/command_parts/optional draft已删除。
命令是terminal host本地交互，不新增App Server方法、配置或GUI业务后端。Codex的
policy-aware editor_directory需共享文件系统policy owner，真实Windows editor仍待验收。
App编辑器入口只读取当前App.cwd，runtime不再注入options.cwd；该值由服务端startup/
resume/thread handoff/reconnect同步。完整有效filesystem/grantedPermissions尚未进入
公开start/resume/settings策略投影，不能按active profile id在TUI猜测权限或读取本地YAML。
KeepScreen交接由Tui唯一承接：App经既有view/draw捕获一次当前帧，with_restored消费并释放，
恢复两屏输入模式、重绘并交出stdin；editor返回时强制回主屏，再恢复模式、flush并重新
进入alternate screen。普通draw无额外复制，不新增custom_terminal包装或第二renderer。
complete/images真实PTY使用阻塞editor，确认草稿可见后释放，检查editor主动退出与TUI
重新进入；源码守卫不能替代Windows平台验收，也不关闭历史首键稳定性缺口。

MCP form文本字段复用同一plain_text composer、rich draft、paste clock和active-view flush，
不再持有独立TextArea/String草稿或直接insert路径。逐字段恢复cursor/atomic payload；
接受后回访可继续编辑，cursor-only不撤销接受，正文改动需再次接受。渲染直接使用共享
textarea viewport，删除通用边框入口和手算cursor；超限保留草稿并显示同一五语言错误。
MCP response仍只有原mcpServer/elicitation/request一次typed回应；不新增协议或runtime。

TUI canonical queue/edit 与传输失败恢复继续消费原 `UserInput`：TextElement 的 optional
placeholder、Image/LocalImage 的各档 typed detail 必须保留。范围、顺序、UTF-8 边界和重叠
检查不能因允许 None 而放松；未知 Mention 仍不开放编辑。`AttachmentState` 与本地 rich
history 只持有完整 LocalImageAttachment/RemoteImageAttachment；url/path 投影只能用于
展示、计数或显式 test fixture，不能用来重建生产输入。`runtime/input_submission` 统一
start/steer/queue 的 acknowledgement 与完整恢复，服务端仍拥有 sidecar lowering、queue
和 canonical Thread/Turn/Item；不新增 method/schema 或 GUI 私有策略。

TUI prompt history 只通过现有 `promptHistory/read|append` 访问同一个 App Server history owner。
append 请求为 `{threadId,text}`，entry 也投影 `threadId`；不得发送或接受旧 `sessionId`。
内部 JSONL 保持 Codex 的 `session_id` 存储字段，但记录 canonical Thread ID；没有平行 history
DB 或 IPC。selected skill path 由 composer `mention_codec` 编码到正文 link，并在 recall 恢复。
普通图片/paste payload 仍是进程内 rich history，不把文本编码冒充完整附件持久化。
TUI startup 只读取 log/count metadata；按需单条 probe 与 query-independent batch 都由
`AppEvent::LookupMessageHistoryEntry/Batch -> app/message_history -> cloned RequestHandle`
访问同一 `promptHistory/read`。public cursor 是 exclusive end offset，host 映射为同名
`HistoryBatchCursor`，不直读 JSONL/byte cursor。limit 限制 offset 行窗口（最多 100），
坏行不补满 valid count，允许 empty data + nextCursor；consumer 必须继续下一页。
TUI 的 `on_*_response` 检查 thread/log/awaited cursor，并区分 pending、query miss、IO error；
GUI gateway 继续使用原 method/schema，没有第二份 storage 或兼容公开字段。

Codex 的 `requestAttestation` 只用于客户端声明接收 `attestation/generate`，由 Desktop Host 生成不透明 token，再转成上游 `x-oai-attestation`。Lime 当前没有真实 token producer，因此 initialize 收到 `capabilities.requestAttestation=true` 时必须 fail closed；不得静默忽略、生成假 token 或新增 `attestation/generate` 兼容入口。

Codex 不定义 portable signed receipt，也不为 task、tool、approval、artifact 或 transcript 提供逐项签名。Lime 的 handoff、replay、analysis 和 review 导出只消费 canonical Thread/Turn/Item read model；其 digest 只能表示完整性，不能宣称来源真实性。本轮不新增签名字段、密钥管理或 BoundaryAttest 依赖。

## 协议变更清单

新增或修改跨层业务 method 时，同一变更集必须同步：

1. `app-server-protocol` method、params、result、notification 与 schema。
2. App Server handler、current domain owner 与 Rust client（如适用）。
3. `packages/app-server-client` 或 Renderer typed gateway。
4. Electron preload / IPC 白名单，仅当请求需要宿主转发或系统能力时。
5. catalog、受控 fixture、mock policy 和负向回流 guard。
6. `npm run test:contracts` 与受影响的 Rust / TypeScript 定向测试。

改变 method、schema、read model、notification、preload 边界或 sidecar 行为属于重大架构变更时，按 [architecture.md](architecture.md#11-重大架构变更与开发者确认) 更新架构图并由责任开发者确认。

## 验证入口

| 风险                    | 最低验证                                              |
| ----------------------- | ----------------------------------------------------- |
| Typed client / protocol | `npm run test:contracts`                              |
| Rust domain             | `npm run test:rust:related -- <paths...>`             |
| Desktop bridge          | `npm run test:contracts` + `npm run verify:gui-smoke` |
| Agent 主链              | `npm run smoke:agent-runtime-current-fixture`         |
| 真实桌面闭环            | Gate B Electron fixture / GUI smoke                   |

具体质量选择见 [quality-workflow.md](quality-workflow.md)。

## MCP 控制面主链

MCP 管理、发现和调用只允许走：

`src/lib/api/mcp.ts -> AppServerClient.request(...) -> app_server_handle_json_lines -> App Server JSON-RPC -> lime-rs/crates/mcp`

current method 为 `mcpServer/list`、`mcpServerStatus/list`、`mcpServer/create`、`mcpServer/update`、`mcpServer/delete`、`mcpServer/enabled/set`、`mcpServer/importFromApp`、`mcpServer/syncAllToLive`、`mcpServer/oauth/login`、`mcpServer/oauthLogin/completed`、`mcpServer/startupStatus/updated`、`mcpServer/start`、`mcpServer/stop`、`mcpServer/resource/read`、`mcpServer/tool/call`、`mcpTool/list`、`mcpTool/listForContext`、`mcpTool/search`、`mcpPrompt/list`、`mcpPrompt/get`、`mcpResource/list`、`mcpResource/subscribe` 与 `mcpResource/unsubscribe`。`mcpServerStatus/list` 只接受 Codex v2 `{ data, nextCursor }` 分页响应；Renderer 和 current smoke 必须遍历 opaque cursor，旧 `{ servers }` status response 为 `dead / forbidden-to-restore`。`mcpServer/tool/call` 强制真实 `threadId` 并经 Session-owned `McpThreadRuntime` 执行；Settings 没有 Thread owner，只允许浏览工具。`mcpServer/resource/read` 可做 management read，也可携带真实 `threadId` 读取同一 runtime；MCP App 从 canonical tool Item 传 `originCallId`，从 `appContext.connectorId` 传 `connectorId`，`sessionId` 不进入 exact wire。旧 `mcpTool/call`、`mcpTool/callWithCaller` 与 `mcpResource/read` 已从 protocol catalog、schema、App Server、typed clients、Renderer、smoke 和正向测试物理删除，分类为 `dead / deleted / forbidden-to-restore`，只能出现在负向回流守卫或历史 evidence。OAuth 完成态只允许由 App Server v2 typed notification `mcpServer/oauthLogin/completed` 投影给 Renderer；MCP startup lifecycle 只允许由 `mcpServer/startupStatus/updated` 投影连接态并触发终态刷新。旧 `mcp:oauth_completed`、`mcp:server_started`、`mcp:server_stopped`、`mcp:server_error` 均为 `dead / deleted / forbidden-to-restore`。事件 `mcp:resources_updated` 和 `mcp:resource_updated` 必须经真实 MCP manager / Desktop Host event bridge 投影；浏览器模式不得静默回退 mock event fallback。

Thread-owned `mcpServer/resource/read` 收到 `originCallId` 时必须先命中已加载 Thread；无 `threadId` 时 fail closed。只有 `server=codex_apps` 才消费该字段，并要求来源是已完成、resource URI 一致的 canonical MCP tool Item；其它 server 按 Codex 语义忽略 `originCallId`。MCP tool lifecycle 必须从同一次冻结的 step route 把 `connectorId/linkId/resourceUri/appName/actionName` 写入 canonical `appContext`；materializer、read model、history merge 与冷恢复继续消费同一 Item，不允许 Renderer 或 live catalog 补写 authority。

MCP Apps 面板从 completed canonical MCP tool Item 的 `ui:` resource identity 打开，原生视图
先空白挂载，再通过同一 `mcpServer/resource/read` 受控加载 HTML。旧插件 URL/embedding/strategy
投影已删除；`workspaceRightSurface/request` 的 `surfaceKind=appSurface` 返回 invalid request，
不写 pending 或发布 requested 通知。Renderer 不从 pending 创建插件面板，不传插件 URL 给 mount/navigation。

`codex_apps` resource origin 从 canonical Thread 完整历史派生，最多保留最近 64 条、单条 authority 最多 1024 bytes。读取时必须重新核对当前 MCP tool metadata 的 connector/link authority；tool argument 与 canonical `linkId` 冲突、缺少明确要求的 account link、connector/link 漂移或 URI 不一致均 fail closed。通过校验后，真实 MCP `resources/read.params._meta` 同时携带 `threadId`、`selected_connector_ids` 与 canonical `link_id`；Renderer 传入的 `connectorId` 不能覆盖 origin authority。非 origin read 的 `connectorId` 仍 lowering 到 `x-codex-turn-metadata.mcp_request_meta.selected_connector_ids`，不得只在 App Server response 回填。

`mcpServerStatus/list.data[].authStatus` 使用 Codex v2 exact camelCase wire：`unknown`、`unsupported`、`notLoggedIn`、`bearerToken`、`oAuth`。OAuth runtime `available=false` 必须投影 `notLoggedIn`，已具备凭证时投影 `oAuth`；静态 header 可用时投影 `bearerToken`，无认证配置投影 `unsupported`。不得恢复旧 `notloggedin`、`bearertoken`、`oauth` lowercase wire 或在 Renderer 猜测修复错误枚举。

live evidence 仅通过 `smoke:mcp-current -- --allow-live-provider` 显式开启，且需要 `LIME_MCP_LIVE_SERVER_URL`。该 URL 不得包含 username、password、query 或 hash；认证只能引用环境变量名，不允许 inline secret。`network-invoke.json` 仅可记录脱敏的 host、环境变量名、header 名、范围和工具/资源摘要。

MCP server-originated elicitation 使用独立 reverse JSON-RPC method `mcpServer/elicitation/request`。该 method 在 protocol catalog 中属于 `serverRequest`，不属于 Renderer 发起的 `AppServerRequestMethod`。App Server 生成 outer JSON-RPC id 并按 id 精确等待 Response/Error；Electron `app_server_drain_events` 只上行 notification/request，`app_server_handle_json_lines` 只把 Renderer 回包原样写回 sidecar。Renderer 必须通过 typed server-request dispatcher 注册 method handler；未知 method 返回 `METHOD_NOT_FOUND`。禁止暴露 MCP raw request id、按 server/turn/tool 扫描 waiter，或复用 `agentSession/action/respond`、Approval、`request_user_input` 与生产 mock fallback。

MCP model Tool surface 与 GUI 管理读必须分层：`tool-runtime::McpStepSnapshot` 只冻结同一次 provider sampling 的 tool definitions、caller policy、exact route 和 connection handle；`mcpPrompt/*`、`mcpResource/*`、`mcpServerStatus/list` 继续由 App Server 直接向 `lime-mcp::McpClientManager` 做 live read。禁止让管理面经过 model bridge、让 GUI inventory 替换 in-flight snapshot，或用 caller-unaware live registry dispatch 绕过当前 step allowlist。

旧 MCP Desktop facade 已统一归类为 `dead / retired guard-only`：`get_mcp_servers`、`mcp_list_servers_with_status`、`mcp_list_tools`、`mcp_list_prompts`、`mcp_list_resources`、`mcp_call_tool`、`mcp_start_server`、`sync_all_mcp_to_live` 只能出现在负向 guard 或历史 evidence，禁止回到前端网关、Desktop Host、mock 或 App Server current 主链。

## Skills Catalog 主链

Composer 可执行 Skill catalog 只允许走：

`src/lib/api/skill-execution.ts -> AppServerClient.request(...) -> app_server_handle_json_lines -> App Server skills/list -> RuntimeCore -> lime-skills AgentSkillSnapshot`

current list method 为 `skills/list`，contract 是 `cwds + forceReload -> data[{cwd,skills,errors}]`；catalog 变更只通过 typed `skills/changed {}` 触发 Renderer 刷新。`skill/read` 独立承担稳定 id 的正文/工作流详情读取，`skillManagement/*` 只属于管理中心，不得冒充 Composer catalog。singular `skill/list` 与 `get_local_skills_for_app` Desktop facade 为 `dead / deleted / forbidden-to-restore`，只能出现在负向守卫或历史 evidence。

Skill 运行时配置只允许走同一 App Server 主链：`skills/config/write` 使用 exactly-one `path/name` selector 写入 Lime 用户级 YAML `skills.config` 并返回 `effectiveEnabled`；`skills/extraRoots/set` 原子替换进程级 roots，不持久化，缺失目录按空目录处理，成功后发送 `skills/changed {}`。Renderer typed gateway 可以调用这些 current method，但不得用 `skillManagement/*`、Electron IPC 或 Codex TUI 配置路径建立第二套状态。

Orchestrator-owned remote Skills 不新增 Renderer/Electron 命令，且不经过全局管理面 MCP inventory。一次真实 turn 初始化后，App Server 通过 `AgentRuntimeState[sessionId, threadId] -> McpThreadRuntime` 连接固定 `codex_apps`，以 10 秒、10 页和资源/正文边界发现 `mcp/skill`，把结果合并进同一 `AgentSkillSnapshot`；reroute 复用该快照。模型可见的 `skill_search` 只返回 metadata 与 `skill://.../SKILL.md` locator，正文必须显式调用 `read_mcp_resource(server="codex_apps", uri=...)`，不能由 Skills 或 Tool runtime 直接读取本地文件。`orchestrator.mcp=false` 只过滤 `codex_apps` catalog、tool definitions 和 dispatch route；普通 MCP 与已冻结且精确匹配的 Skills resource read 不受影响。`mcpResource/list` 的 cursor 只能与指定 `server` 一起使用，并返回 `nextCursor`；GUI 管理面仍可从全局 `McpClientManager` live read，但不能替换 in-flight snapshot。Electron 只转发 `app_server_handle_json_lines`，不得持有这套配置、discovery 或读取逻辑。

## Apps Catalog 主链

Apps/connectors 只允许走同一个 Plugin catalog owner：

`src/lib/api/apps.ts -> AppServerClient.request(...) -> app_server_handle_json_lines -> App Server app/* -> RuntimeCore -> PluginDataSource -> local plugin_catalog`

current method 为 `app/list`、`app/read`、`app/installed` 与 `app/list/updated`。Portable
Agent Plugins manifest 不允许顶层 `apps`；`app/list` 只从显式 Codex
`extensions.com.openai.apps`（或 overlay fallback）指向的独立 Apps JSON 构建分页 catalog，
配置项的 connector `id` 是 catalog identity。旧内联 Apps object fail closed；非法 Apps
配置只禁用该组件。`app/read` 最多接收 100 个 id，去重并保持首次请求顺序，未知 id 放入
`missingAppIds`；携带 `threadId` 时必须命中已加载 canonical Thread。`app/installed` 只报告有效 enabled/runtime
state；本地 Plugin 没有 hosted connector model-visible tool snapshot 时，`callable` 强制为 `false`，Desktop 不得
把安装或启用状态冒充模型 readiness。`forceRefetch` / `forceRefresh` 在本地 registry 上只是 fresh read，不伪造
hosted refresh。

成功的 `plugin/install`、`plugin/uninstall`、插件 `config/batchWrite` 与首页 `app/list` 读取经过现有 server
notification hook 发布 typed `app/list/updated { data: AppInfo[] }`，Renderer 通过 App Server typed event bus 消费并
重新读取 Apps。禁止新增第二 Apps catalog、`window` 自定义事件事实源、TUI Apps UI、compat wrapper 或生产 mock
fallback。Apps 专用真实 Electron Gate B 已完成：App Center 经 typed `app/list/updated` 触发 fresh
`app/list + app/installed` 读取，并从本地 Plugin 的 `pending` 投影切换到停用后的 `disabled`。该 Gate B 属于旧插件替换前基线，新插件链需重新验收；未完成项还包括
Codex 原生 Apps 默认资源与 overlay，以及 hosted connector model-visible tool snapshot 与真实 `callable=true` provider readiness；不得用本地 Plugin enabled
状态替代。

## Collaboration Mode Catalog 主链

Desktop Composer 的协作模式发现只允许走：

`src/lib/api/collaborationModes.ts -> AppServerClient.request(...) -> app_server_handle_json_lines -> App Server collaborationMode/list -> collaboration mode catalog`

current method 为 exact `collaborationMode/list`，返回 Codex mask shape：`data[{name,mode,model,reasoning_effort}]`。
App Server 是 Default/Plan preset 的唯一事实源；Plan 固定以 `reasoning_effort=medium` 覆盖当前 Turn effort，`model=null`
表示继续使用 Grok-aligned `model-provider` 当前模型选择。Renderer 的 `task_mode` 只表达用户选择意图，真正提交前必须解析
唯一 Plan preset；catalog 缺失、重复或形状非法时 fail closed。不得在 Renderer 重建本地 preset、复制 Codex TUI picker、
新增 Electron 业务命令，或让 collaboration catalog 承接模型 catalog/capability/readiness。

## Feature 配置主链

`experimentalFeature/list` 与 `experimentalFeature/enablement/set` 保留为 App Server 公共协议，唯一目录项是 Codex 的
`workspace_dependencies`（Stable，默认开启）。配置由 core `ConfigLayers` 解析；enablement 委托现役 config batch write，
遵守同一来源、受管字段和持久化约束。未知键（包括已删除的 `webmcp`）返回 `INVALID_PARAMS`；空 map 为 no-op。
`list` 的 cursor/limit 与已加载 Thread identity 校验保留，不建立第二份 feature store。

依赖管理的真实 GUI 消费者是 Configuration 中的 `primaryRuntime` gateway；多模型、多协议继续归 `model-provider`。
开发者/实验室页面、ClawTrace 专属 UI/告警链、WebMCP 和工具调用调试开关，以及旧 experimental Electron 命令均为
`dead / deleted / forbidden-to-restore`。通用请求关联与审批传输诊断继续由现役 trace context/agent debug owner 承接。
自定义统计页的 `usageStats/read`、`usageStats/modelRanking/list`、`usageStats/dailyTrends/list` 及 client、service、DAO、
建表代码已经删除；canonical Thread/Turn Token 用量不经过该统计链。

## Memory Reset 主链

全局记忆重置只允许走：

`src/lib/api/memoryStore.ts -> AppServerClient.request(...) -> app_server_handle_json_lines -> App Server memory/reset -> RuntimeCore -> MemoryAppDataSource -> LocalMemoryBackend`

current method 为 exact `memory/reset`，只接受 omitted、`null` 或空对象 params，返回空对象。它只清理全局 memory
root 并重建受管目录，不删除 Thread/Turn/Item、event log、projection store 或 memory root 外的 soul 配置。旧 scoped
`memoryStore/reset`、`MemoryStoreResetParams/Response`、typed client 与设置页调用均为
`dead / deleted / forbidden-to-restore`；workspace memory reset 不再作为未被产品消费的平级公开能力保留。

## Command Exec 主链

canonical `Command` 的展示动作统一由 `tool-runtime::parse_command` 解析，再通过 App Server
`thread/projection/command` 投影到既有 v2 `commandActions`。实时 `item/started|completed`、
`thread/read|resume` 与 `thread/items/list` 共用同一 item projection；GUI/TUI 不解析 shell 文本。
读取路径从 item 的 `cwd` 解析，不借用 App Server 进程工作目录；保留搜索 query 和列表 path hint。
已记录的 `commandArgv` 优先于 script 文本，非法 argv facts 投影 Unknown；无 argv 的旧 script
使用保守 Bash AST。任何未识别的 stage 都折叠为完整原命令，不能把 mutation 隐藏成纯探索。
`userShell` source 保持独立，TUI 不把用户 shell 命令并入探索分组。这是展示分类，不是权限
证明；shell_analysis、execution policy 和 process supervisor 继续持有原业务职责。

`exec_command` 的真实 `commandArgv`、canonical cwd 与 process id 来自同一
`RuntimeLiveExecutionGateway::start_process` 请求，经 typed `CommandStartEvent` 进入
canonical Command。generic dispatch Started 不提前冒充执行开始；准备失败在终态前
记录一次没有 process/argv 的 Unknown invocation start，保持 started/completed 校验。
session、output delta、结果与 `write_stdin` 复用同一 invocation，不能借用新请求的 cwd。
invocation 同时保存最多20项脱敏 `terminalInteractions`，empty poll也保留；canonical数组
是完整快照，materializer以实际envelope区分snapshot与`command.interaction`增量。
snapshot替换、delta追加，不按摘要文本去重真实重复输入；无interaction字段的完成态
保留已观察事实。旧单值metadata producer已删除，live/read/page/restart共用同一列表。
canonical Item 独占 command 的开始/完成；`CodingEventMirror` 对 canonical Command 仅
增加输出、测试和安全 terminal interaction facts，不再重复 command.started/exited。
所有产品继续消费既有 `item/started|completed` 与 read model，没有新增 GUI/TUI 解析器。

模型Turn结束后，session-owned `unifiedExecStartup` Command可以继续inProgress。
原Invocation观察实际进程输出和退出，经owned publisher与scoped Appender追加同一
Thread/Turn/Item/process的canonical output/interaction/completion；不依赖再次poll，
也不延长模型Turn。GUI保留原route/Turn binding，TUI保留原command projection；
最后真实Command终态才回收订阅。sequence verifier禁止process漂移、普通工具穿透、
terminal后新Item和已完成Command重开。模型完成不得在客户端合成进程退出。

Codex exact 独立命令执行与 Desktop 交互终端只允许走 connection-scoped App Server JSON-RPC：

`src/lib/api/commandExec.ts -> typed App Server client -> command/exec -> App Server CommandExecServer -> ExecutionProcessServer -> tool-runtime local process supervisor`

一次性命令通过 `command/exec` 返回 `exitCode/stdout/stderr`；流式命令通过
`command/exec/outputDelta` 投影 raw bytes 的 `deltaBase64`，并由同一连接内的 `processId` 过滤。交互终端的
输入、PTY 尺寸和终止分别使用 `command/exec/write`、`command/exec/resize`、`command/exec/terminate`；stdin 写入、超时终止、
断连清理和 lifecycle/status/output owner 统一复用内部 `ExecutionProcessServer`。公开 `processId` 仍按
`ConnectionId` 隔离，内部 owner ID 以 `command-exec-{connectionId}-{processId}` 为 base；终态 owner 仍保留时，后续
复用追加 instance UUID，不进入 command/exec wire。
`outputBytesCap`、`timeoutMs` 保持 omitted/null/value 语义；stdin close 后的非空写入、非 TTY resize、零值尺寸、
未知 process id 和同一连接重复 active id 均 fail closed。断连、response 发送失败或 notification writer 失败都清理该
连接拥有的进程。Electron 只转发 App Server JSONL，不持有第二套终端会话、轮询 drain 或 renderer mock fallback。

`command/exec` 的 response 在进程退出后返回，transport deadline 必须跟随该生命周期。共享
`app-server-client/command-exec-timeout` 将 `disableTimeout: true` 投影为无 transport deadline；有限
`timeoutMs` 使用进程时限加 30 秒 response grace，省略时按服务端默认 10 秒计算。Renderer current bridge
与 Electron Host 都消费同一规则，不能用普通请求的 30 秒或固定 10 分钟提前切断交互 PTY；其它 method
继续原有 deadline。进程超时、权限和终止 authority 仍在 App Server，没有客户端延长执行权限。

`command/exec.sandboxPolicy` 使用 Codex 的 tagged `SandboxPolicy`，不接受字符串或任意 JSON：
`readOnly`、`workspaceWrite`、`dangerFullAccess`、`externalSandbox`。完整策略由 protocol 经
CommandExecServer 传入 tool-runtime 的同一 OS runner，不能压缩成 label 后丢弃限制。
`workspaceWrite` 的写根为 cwd、显式 `writableRoots`，以及未被 `excludeTmpdirEnvVar` /
`excludeSlashTmp` 排除的 TMPDIR / Unix `/tmp`；readOnly 不获得隐式临时写根。`networkAccess`
与已授权的 permission profile 一起 lower 到同一 runner。Windows 同步 roots / TEMP、TMP 排除，
其实际 ACL enforcement 仍需 Windows 平台证据。该配置不控制 model-provider 的采样网络。

旧 `project_shell_*`、`run_project_shell_command`、Project Shell v0 DTO/schema、旧 API gateway 和 Electron 私有
session host 均为 `dead / deleted / forbidden-to-restore`；没有 compat/deprecated wrapper。

## Process Control 主链

Codex exact 子进程控制只允许走 connection-scoped App Server 主链：

`typed App Server client -> process/{spawn,writeStdin,resizePty,kill} -> ProcessServer -> tool-runtime local process supervisor -> process/{outputDelta,exited}`

`processHandle` 只在发起请求的 `ConnectionId` 内唯一；spawn response 必须先于该进程的 notification，output 必须先于
exited。断连、response 发送失败或 notification writer 失败都终止该连接拥有的进程。stdin close 后的非空写入、
非 TTY resize、零值 terminal size、重复 active handle 和未知 handle 均 fail closed；output cap 默认 1 MiB，
omitted、`null` 与 value 保持三态，notification 的 `deltaBase64` 保留 raw bytes。

Desktop Workspace 不直接消费 connection handle。代码工作台只允许通过
`src/lib/api/backgroundTerminals.ts -> thread/backgroundTerminals/list -> command itemId 匹配 -> thread/backgroundTerminals/terminate`
终止 Thread-owned 后台终端；不提供旧 status refresh、drain、signal-only interrupt 或任意 stdin 写入控件。旧公开
`executionProcess/*`、v0 DTO/schema、typed helpers 和 Renderer gateway 均为
`dead / deleted / forbidden-to-restore`；内部 `ExecutionProcessServer` 继续作为 Thread shell、unified exec 和后台终端
的 current supervisor owner，不是公开兼容层。

## Filesystem 主链

Codex exact 文件 IO 与 watcher 只允许走 connection-aware App Server 主链：

`src/lib/api/fileBrowser.ts -> typed App Server client -> fs/{readFile,writeFile,createDirectory,getMetadata,readDirectory,remove,copy,watch,unwatch} -> App Server FsServer -> fs/changed`

所有路径必须为绝对路径；文件 bytes 在协议边界统一使用 base64。`watchId` 只在发起请求的 `ConnectionId` 内唯一，
`fs/changed` 只发送给该 owner；断连只清理本连接的 watcher。Desktop 文件浏览器继续保留目录、预览、文件类型和
symlink 等 GUI 投影，但不得定义第二套 file wire。rename 由 Renderer 组合 `getMetadata -> copy -> remove`，当前为非原子
Desktop 操作，不新增 Codex 不存在的 rename method。

旧 `fileSystem/*`、v0 DTO/schema、App Server `processor/file.rs`、RuntimeCore file projection、services
`file_browser_service`、旧 renderer aliases 与旧左侧文件管理器专属 `get_file_manager_locations` 均为
`dead / deleted / forbidden-to-restore`。后者已同步删除 API、Host 分发、IPC 白名单、catalog 和旧正向 fixture。
`get_file_icon_data_url` 仍是 Electron Desktop Host 的系统壳能力，不属于业务文件 IO，也不能承接 fs fallback。
Office/PDF 文本提取不属于 `fs/readFile`；若产品继续需要，应在独立 current 文档能力 owner 中重建，禁止恢复旧
`fileSystem/readFilePreview`。

## Fuzzy File Search 主链

Desktop Composer 项目文件补全只允许走一发式 current 链：

`CharacterMention -> src/lib/api/fuzzyFileSearch.ts -> typed App Server client -> app_server_handle_json_lines -> App Server fuzzyFileSearch -> filesystem search owner`

请求使用 `{ query, roots: [absoluteProjectRoot], cancellationToken }`，返回最多 50 条按 score/path 排序的相对路径、
file/directory、file name 与 match indices。Renderer 使用稳定 cancellation token、AbortSignal 和 request version
丢弃旧响应；选中结果只替换当前 `@token`，空格路径加引号，不创建 connector/plugin `Mention`。Electron 只转发
现有 JSONL，不新增文件搜索 IPC、业务后端或生产 mock fallback。

Codex experimental `fuzzyFileSearch/sessionStart|sessionUpdate|sessionStop` 与
`fuzzyFileSearch/sessionUpdated|sessionCompleted` 均已纳入planned，复用同一文件搜索owner。
目前仍无session接线，不将drift diagnostics当作current投影；实施时同步exact协议、取消/
终态和GUI/CLI消费者，不建立第二文件搜索服务或兼容wrapper。范围见method scope矩阵。

## Browser Workspace 主链

浏览数据设置使用 `src/lib/api/browserData.ts` → `browser_data_settings/summary/clear` →
同一 `BrowserTabHost` 的 `BrowserDataHost`。这是浏览器 Profile 的 Desktop Host 操作，
不增加 App Server runtime 或持久化 owner。严格六类/五时段，最近4周为28天；删除前整体
校验能力，不支持组合零删除。history/downloads 委托原 owner，按 visit/开始时间清理终态记录；
下载文件、附件和 artifact 保留。Cookie domain/cache 摘要为当前总量，可选读取失败为 null。
只操作 `persist:embedded-browser`；stock native mask 仅允许全时段 siteData/cache，
formData/siteSettings 与原生范围绑定仍待完成，不把被忽略的 timeRange 或未知类型传给 Electron。
失败结果区分已完成、可能部分生效的失败类与尚未执行类；不声称跨 store 事务或回滚。

Browser 只有一个网页执行体：Right Surface 中用户可见的 Electron `WebContentsView`。用户操作与 Agent 动作分别从以下两条控制路径进入同一个 `BrowserTabHost` route：

`browser_tab_focus_page` 为Desktop Host焦点命令，gateway仅发送tabId/viewId/webContentsId。BrowserTabHost按调用窗口验证route，再由独立focus委托拒绝过期native identity；未选中、隐藏、脱离当前窗口或焦点已到其他原生视图时不交接。它不导航、不触发select的批注副作用、不释放Agent控制、不调用window.show/focus，也不提供mock fallback。preload继续消费同一ELECTRON_HOST_COMMANDS allowlist，catalog/typed gateway/fixture同步；无需新增Rust业务method。

设备模式复用 `browser_tab_set_device` / `browser_tab_set_bounds`，不增加 IPC/RPC 方法。
`bounds` 始终指 Renderer 外层容器；`EmbeddedBrowserHost` 保存该容器，按共享设备几何限制同一
WCV 的实际区域。`device.scale` 为用户倍率上限，`deviceViewport: { bounds, scale } | null`
投影实际原生边界与自动适配倍率；有效倍率可以低于请求的10%下限，零空间返回零尺寸并隐藏。
切标签、新标签、弹窗和关闭后恢复使用原容器，批注使用实际 WCV 边界。被动 resize 只走
bounds，不触发用户接管；响应式外围手柄通过原 device gateway 串行发送最新尺寸，生命周期
变化取消排队输入及迟到 receipt，不创建 Renderer 设备状态 authority。

设备请求及原生投影中的 `presetId` 只接受共享13项目录。未提供时规范化为 `responsive`，
提供未知值则在原生布局/模拟前拒绝；不按宽高反推身份。固定预设改变已确认的宽高，
保留当前 DPR/mobile；选择 responsive 保留尺寸，手工宽高和拖动转为 responsive。旋转归整宽高，
原尺寸匹配具名预设的任一方向时保留身份，否则归 responsive。宽240–4096、高160–4096由共享
边界限制，非法请求在原生变更前拒绝。工具栏有效输入即时发送、失焦归整；连续输入串行合并，
scope变化取消未发送动作。预设的device成功后沿原set-zoom方法重置原生page zoom=1，失败不重置。
`browserZoom`共享原生25–500%边界；设备显示百分比=round(basePercent×viewportScale)，选择值
反算原生base，不能改变device.scale冒充页面缩放。更多菜单同步消费边界，完整菜单步进仍待对齐。
目录及工具栏语义来自固定安装包静态证据；完整视觉、动效、主题与键盘矩阵仍未验收。

`navigationRevision` 是同一 native WCV 的非负整数状态投影，只在 main-frame
`did-start-navigation`（含同文档导航）时递增。它用于取消拖拽；既有 `pageRevision`
仍会因设备命令或其他快照失效递增，不能把自身设备命令的 receipt 当成导航。

```text
Renderer Browser Workspace -> src/lib/api/browserTab.ts -> browser_tab_* Desktop Host command -> BrowserTabHost
RuntimeCore / tool-runtime browser__* -> App Server item/tool/call -> AppServerDynamicToolHost -> BrowserTabHost
```

动态工具执行权由 App Server 的 ThreadStateManager 持有：`thread/start.dynamicTools` 绑定发起连接，
`thread/resume.dynamicTools` 显式声明可承接旧会话 frozen namespace/tool/inputSchema 的 Host 能力。
声明只校验能力，不重写会话工具；允许新 Host catalog 是旧 frozen 集的超集，描述更新不改变执行合同。
不携带声明的 resume 仅订阅，活跃 Host 不被替换；断连后仅 idle Thread 可重绑。
`item/tool/call` 精确发给该连接，禁止全局 writer fallback、广播或把活跃 Turn 的审批 token 转交。
首次派发经过既有 Thread listener 的 resume 屏障，响应先入 writer，再派发执行请求；
恢复快照只重放交互表单，不能重放 `item/tool/call`，同一 Host resume 不得重复执行。
Electron start/resume 注入自己的不可变 catalog，断连同时撤销本地 frozen binding 和阶段状态；
公开 schema/generated client 和真实双 Host fixture 同步该合同，不增加 IPC method 或 renderer 执行入口。

App Server 持有 Thread/Turn、动态工具生命周期、Browser read model 与 canonical identity；Electron 只持有 native view、window、`webContents.debugger`、下载和权限等宿主状态；Renderer 只消费 projection 并发送用户意图。Agent action 必须按 connection/thread/turn/session/tab/view/WebContents owner 精确路由，用户操作或 turn terminal 必须使旧控制权失效。

`browser__executeCdpCommand` 复用 frozen Browser namespace 与原 `item/tool/call` 多阶段合同，不新增 IPC/RPC。
输入为必填 `method`、可选对象 `commandParams`、`tabId` 和 `timeoutMs`（1–30000，默认10000）。
当前只执行主页面 Runtime.evaluate、Page 导航/历史/重载/停止/几何/截图与三种 Input 命令；
精确集合由 `electron/browserCdp.ts` 单一管理，catalog 描述同步其边界。未知命令、持久 debugger
覆盖、跨站 cookie、显式 frame/context、子 target 及直接文件上传在审批/attach 前拒绝。
全局开关和实际 URL 的独立 debug 策略都必须允许，browse receipt 不能替代一次性 `full_cdp`
action 批准。批准 token 绑定原命令参数和完整 route/page revision；命令途中策略变化或人工
接管禁止投影迟到结果，超时释放原生控制。返回原 native 数据与相同 tab identity；导航另验目的
URL（仅 http/https）。回合终态复用原 detach/release。frame session、事件流、Target 模拟和
WebMCP 尚未接入，不能据此声明完整 CDP。

网站权限 request/check 均属于同一原生 Session。无 Agent 回合的用户浏览使用
`BrowserSitePermissionPrompt -> BrowserOverlayHost` 的私有可信确认，直接结算原 native callback；
不新增 Renderer 授权命令、App Server 方法或 canonical Agent approval。确认绑定当前选中且可见/attached
的用户标签与 native frame/document/requesting origin，关闭、导航、切标签和接管后拒绝旧请求。
临时 grant 只服务该文档的原生 check，媒体种类分开，控制变更/回合终态撤销。Agent 请求继续原
`grantPermission` 的 turn scope 与 canonical 决策。permission event 增加必需 isMainFrame 与可选
mediaTypes（audio/video），原生事件和 browser-tab 事件共用 Renderer parser；旧缺 frame 的夹具已迁移。
overlay 的精确 menuId/generation 清理是 Host 内部方法，不开放网页/Renderer bridge。
用户请求由可信确认呈现，不向 Renderer 转发 Agent 的 pending banner，避免决定后残留“等待 Agent 审批”。

`browser__history` 是原 frozen Browser namespace 的只读动态工具，不是新增 App Server 或 Desktop IPC
方法。参数为可选 `query`（最多256字符，省略/空白查询最近记录）、原 `nextCursor`、`limit`（1–200，
默认50）及审批 anchor 的可选 `tabId`；不接受路径、数据库或写入参数。复用原历史 parser 与
`BrowserHistoryHost.invoke(browser_history_list)`。根 `browser_use.allow_history_access=false` 拒绝查询；
其余由 `browser.iabHistoryApprovalMode` 的 alwaysAsk/neverAsk/disabled 表示每次查询审批、允许查询和禁用 Agent 查询；禁用不影响用户历史管理。历史工具不 claimTab、
不取得页面控制或 browse grant。alwaysAsk 经原 `item/tool/call` preflight/approvedExecute 和
RuntimeCore canonical approval，只返回一次性 descriptor，不夹带历史内容；批准后只执行原 query。
工具调用及原生 anchor identity 必须精确匹配，设置撤销、导航/销毁、接管、turn terminal 和断连
使 token 与 in-flight 结果失效；IO 后再次回读配置、核验同一 policy revision/route，错误不转空成功。
审批 anchor 当前要求同 thread 的可用 canonical tab；这属于原 descriptor 的 route 前置条件。

用户历史管理复用既有 `browser_history_list`，显式 `{view:"visits",query,source,cursor,limit}`
返回访问投影；source 仅允许 all/agent/other，cursor 绑定 query/source/view/revision。
Agent 工具仍只接收原只读参数，不接受 view/source/entries 或删除参数。
`browser_history_remove` 只接收 `{entries:[{url,visitTime}]}`，严格验证整批后按 URL/本地日期去重删除，
同一天的来源一起移除、其他日期保留；旧 ids、混合字段、路径与非法时间在变更前拒绝。
列表与删除共享原 `BrowserHistoryHost/Store` 的 schema2 访问日志，来源由原生 route 派生，标题更新不增加访问。
`browser_history_clear` 继续作为 BrowserDataHost 的内部历史清理入口；设置页清理统一走
`browser_data_clear` 和原六类/五时段对话框，旧历史页专用清理及无消费者的前端 wrapper 已移出。
IPC 命令名、preload allowlist 和 catalog 归属不变，无新 App Server method 或 Renderer mock fallback。

`browser_tab_list` 是既有 native tab owner 的只读 snapshot，不是新的 App Server 业务方法。
Host 从实际 IPC sender 派生 window / ownerWebContents，并校验 browserSession / thread；身份不符必须
拒绝，不能返回空列表。返回完整 live tabs、selected、URL 和 native identity；Renderer 验证 scope、
唯一 tab/view/WebContents 及至多一个 selected。BrowserWorkspace 重挂载先恢复完整 snapshot，非空时
保留 Host selected 并恢复 bounds；只有真正空列表才隐藏挂载 canonical primary，再由当前 owner 显示。
不能用 App Server 分配的 primary tab id 代替当前 native selected，或复活已关闭 primary。
`useBrowserWorkspaceHydration` 是唯一恢复接线，使用单调 epoch、事件合并与 close tombstone 拒绝
ABA、迟到 snapshot / event / mount；它只持有显示投影，不增加 tab store 或网页执行体。

Browser 设置继续走 `updateConfig` 队列与 `config/batchWrite(expectedVersion)`。`updateBrowserSetting`
必须携带界面看到的字段旧值，并在队列内部比较规范化结果；即使 cache 已刷新到新版本，也不能用旧权限矩阵覆盖。
字段冲突与 App Server `configVersionConflict` 统一为可识别的冲突终态，不自动重放授权。
UI 回读权威值并保留模式草稿；回读失败时禁止继续修改，显式重新加载成功后恢复。
编辑开始的矩阵作为表单基准，冲突后的再次显式提交使用回读值；已删除的规则不可被重建或以空操作报告保存成功。
这只是配置编辑合同，不替代网站设备权限或 canonical Agent 操作审批；不新增 Browser 配置 store、IPC 或 JSON-RPC method。

下载管理复用 `browser_downloads_list/action/clear`。列表返回公开 entries、total、nextOffset、
与磁盘一致的 durable `revision`，以及仅用于当前进程分页一致性的 `historyRevision`。
`browser-downloads-changed` 只由 Main 发布 `{kind:"updated",revision,historyRevision,entries,removedIds}`
或 `{kind:"invalidated"}`；typed gateway 校验完整字段与身份，非法通知只触发重新读取，私有路径/恢复参数不进入 Renderer。
进度字节更新直接合并已加载行；成员、状态、排序或搜索元数据变化才使历史分页失效。
消费者拒绝旧事件，保留历史文件可用性，翻页使用 historyRevision，不能要求 durable revision 在持续下载时不变。

外部 Chrome/CDP `browserSession/*`、`BrowserRuntimeManager`、Settings Chrome relay、`BrowserSessionRef` adapter、Canvas Browser 和 `mcp__lime-browser__*` 正向工具均为 `dead / deleted / forbidden-to-restore`；只允许出现在负向回流守卫或不可变历史 evidence。Browser current command 变更必须同步 Electron Host/preload、Renderer typed gateway、App Server reverse-request/catalog、fixture、read model 与 `npm run test:contracts`。

网页批注的 Design Tweaks CSS/纯文本预览复用现有 annotation selection/editor 事件，不新增通用网页 bridge 或 App Server method。
受限 page preload 为已选元素读取有界 `designSnapshot`；Host 验证并绑定原 annotation/document/frame identity。
可信 editor 的正文、图片、`designChange` 共用同一 revision，旧 revision 或伪造 previousValue 不得替换草稿。
Editor Host 的事件由 BrowserTabHost 委托 Annotation Host，再以原 private token 发送到同一 PageAnnotation；
CSS 使用原 Document/ShadowRoot 的局部构造样式表，文本撤销恢复原节点。保存后保留预览，关闭未保存的临时预览恢复已保存组；
隐藏、Agent 接管、导航、取消和销毁沿原 annotation 生命周期撤销。模型输入只投影 old→new 和源代码修改指引，
不把临时属性当作应写入项目的源码。站点 controls/virtual 与完整 provenance 仍按执行计划继续实现。

首次 Design save/send 由原 Annotation owner 校验后，通过私有 `prepare-design-capture`、双 rAF ready、
同一 WebContents 截图及 `clear-design-capture` 清理完成；这些消息仅限原 token/document/frame，
不暴露网页 bridge。Editor 事件可携带同 revision 的 `capture`；gateway 共用严格截图校验，唯一 draft
store 保留原 selection 并原子更新截图。超时/失败明确无图，stale 阻止旧 send；已有保存批注 edit
保留原截图。事件 relay 保持 save/send → close 顺序，最终 close 仍可在页面退役后冲刷正文与附图。
无新增 Desktop command 或 App Server method；现有提交和接受回执仍是唯一 canonical 消费入口。

工具条按住原图使用 Desktop presentation 命令`browser_tab_set_annotation_original`，沿原共享IPC白名单/
preload、BrowserTabHost命令委托和Annotation Host，不新增App Server业务方法、工具或通用网页bridge。
请求为`{tabId,identity,gestureId,original}`，identity显式匹配session/thread/tab/view/WebContents/window/pageRevision；
回执重复完整identity与gestureId/original。Host只对同页可用的原annotation发送私有`design-original`，
旧gesture的释放不结束新hold，旧page identity拒绝。Renderer串行提交start/release，指针取消、键盘松开、
失焦、禁用和卸载释放；Host窗口失焦、owner renderer销毁、导航和Agent暂停独立清理。标记偏好与原图分离，
隐藏marker不撤销CSS/text，original不改草稿/revision/marker偏好；恢复同页时不继承旧hold。

## Review 主链

Desktop code review 只允许走 current `review/start`：

`src/lib/api/review.ts -> typed App Server client -> app_server_handle_json_lines -> App Server review/start -> RuntimeCore::start_review -> Thread/Turn/Item projection`

请求必须携带真实 `threadId` 和 typed `target`（`uncommittedChanges`、`baseBranch`、`commit` 或 `custom`）。App Server
拒绝 detached delivery；RuntimeCore 先检查 session/active turn，再规范化 target 字段并提交异步 turn。响应立即返回
`reviewThreadId` 与 `turn.status=inProgress`，review 结果通过同一 thread 的 canonical events/read model 回流 GUI。

review boundary 使用 `enteredReviewMode` / `exitedReviewMode` Extension Item，分别投影为 v2 `EnteredReviewMode` /
`ExitedReviewMode`，并在 turn terminal 前完成退出 item。Renderer 不扫描工作区猜测 review 状态，不创建第二套
review transcript，也不把 Codex TUI detached/background review 伪装成 Desktop 能力。

旧 review facade、raw `agentSession/event` review side-channel、detached/background 入口和生产 mock fallback 均为
`dead / deleted / forbidden-to-restore`；没有 compat/deprecated wrapper。该边界的最低验证是
`cargo test -p app-server processor::thread::projection::tests`、`cargo test -p app-server processor::tests::review`
和 `npm run test:contracts`。真实 Electron Gate B evidence 已建立于
`.lime/qc/gui-evidence/code-artifact-workbench-electron-fixture/code-artifact-workbench-electron-fixture-summary.json`，
证明 preload/IPC 命中 `app_server_handle_json_lines`、`review/start` 与 backend turn identity 绑定，GUI 可见终态与
内部 prompt 隔离，且无生产 mock fallback；不得用 TUI 或浏览器投影冒充该证据。

## Scheduled Tasks 主链

Desktop 已安排任务只允许走：

`ScheduledTasksPage -> src/lib/api/scheduledTasks.ts -> AppServerClient.request(...) -> app_server_handle_json_lines -> App Server scheduledTask/* -> RuntimeCore -> LocalAppDataSource automation owner -> Thread/Turn/Item + Agent Run`

current method 为 `scheduledTask/list`、`scheduledTask/read`、`scheduledTask/create`、
`scheduledTask/update`、`scheduledTask/delete`、`scheduledTask/enabled/set`、
`scheduledTask/run/start`、`scheduledTask/run/list` 与 `scheduledTask/schedule/preview`。
Renderer 只持有筛选、选中项和编辑表单状态；任务、next run、revision 与运行历史由 App Server read model 提供。
`run/start` 必须经同一个 RuntimeCore execution service 创建或继续 canonical Thread，并提交真实 Turn；GUI 只在运行
返回真实 `sessionId` 时开放恢复对话。App Server 同时发布 typed `scheduledTask/changed`（create/update/delete/enabled-set）
和 `scheduledTask/run/updated`（canonical `turn.completed/failed/canceled` 终态、missed/catch-up/recovery 终态）；
Agent Run 使用 `finished_at IS NULL` 幂等门，事件重放不得重复终态通知。Renderer 通过全局 notification bridge 按
`all_runs / failures / none` 决定是否请求 Electron Desktop Host `show_desktop_notification`，Host 的 unsupported/failed
结果必须显示可见错误。任务删除写入 tombstone、禁用并清除未来调度，但不取消正在运行的 Turn；canonical terminal 写回
仍保留运行历史且不得复活 tombstone。Electron 继续只转发 JSONL 和系统通知壳能力，不新增任务 CRUD IPC、renderer timer 或第二调度器。

旧 `automationJob/*`、`automationSchedule/*`、`automationScheduler/*`、`src/lib/api/automation.ts` 与旧设置工作台已物理删除，
分类为 `dead / deleted / forbidden-to-restore`；旧 method 字符串只允许存在于 contract、Electron fixture 和治理扫描的负向
回流守卫中。`automation_jobs` 表、Rust `AutomationJob` DAO 与内部 execution helper 仍是 Scheduled Tasks 的 current 存储映射，
不构成第二公开协议或产品对象。scheduler 的原子 claim、24 小时休眠补跑、超窗 missed、DST、通知和删除并发合同已由 current
owner 收口。真实 OS sleep/wake、Windows Notification Center 和 Windows Gate B 仍是平台证据缺口。生产路径禁止 mock
fallback，测试专用 Rust backend 只能用于 public JSON-RPC fixture。

## Host Reverse Requests, Plan And Diff Notifications

`currentTime/read`、`item/permissions/requestApproval`、`item/tool/call` 使用同一 App Server server-request dispatcher：

```text
RuntimeCore waiter
  -> App Server JSON-RPC server-request
  -> Electron Desktop Host / PendingInteraction responder
  -> exact response id
  -> RuntimeCore continuation
```

`currentTime/read` 只能由 Electron Host 读取系统时钟，App Server 负责 thread scope、超时和响应校验；它不创建
Thread Item，也不提供 Renderer 时钟 API。`item/permissions/requestApproval` 只接受 tool-runtime 规范化后的
permission profile 和 canonical session/thread/turn/item/environment identity；统一 `PendingInteractionController`
只能返回 turn/session-scoped grant 或空 grant，不能扩大请求权限。`item/tool/call` 只能命中
`thread/start`/`thread/resume` 后冻结的 Desktop dynamic-tool binding，调用 identity、namespace、tool 和参数必须逐项
匹配；结果由 canonical DynamicToolCall Item 投影，Renderer 不得伪造 server request 或直接执行宿主能力。

`turn/plan/updated` 是 RuntimeCore `update_plan` producer 生成的 server notification，经 App Server v2 projector、
typed client 和 Renderer projection 进入同一 Thread/Turn/Item read model。计划 snapshot 的权威 owner 是 canonical
Plan Item；Renderer 本地 checklist 只做投影，不得替代 durable plan fact。

`turn.diff.updated` 是 RuntimeCore `apply_patch` coding event producer 在 Turn 范围内聚合精确 mutation 后生成的 durable
fact，经 App Server JSON-RPC projector 投影为 exact `turn/diff/updated { threadId, turnId, diff }`，再由 typed client
和 Renderer conversation reducer 写入 canonical Turn 的 `unified_diff`。Desktop Changes 的 previous-conversation 模式只
消费该字段；空字符串是有效 net-zero 清除信号，不得回退到本地 patch 拼装或第二份 diff store。Renderer 不承接 Codex
TUI 的 review surface，Electron 只做既有 Desktop Host JSONL 转发，不新增业务后端。

这条通知的 owner 是 App Server JSON-RPC + RuntimeCore durable event 链，不是 Electron IPC、旧 facade 或 provider。
多模型 catalog、model switch、provider capability/readiness、retry/circuit breaker 和多模态 sampling/media lowering
继续归 Grok-aligned `model-provider`；Codex 对齐只覆盖 Agent loop、Thread/Turn/Item、工具生命周期和 GUI 投影边界。

`turn.moderation_metadata` 是 trusted first-party Responses metadata producer 生成的 durable fact，经 App Server
JSON-RPC projector 投影为 exact
`turn/moderationMetadata { threadId, turnId, metadata }`。`metadata` 必须原样保持 JSON value；object、array、scalar 与
`null` 都有效，缺失字段或 wrapper 额外字段 fail closed。该事件不去重，每次更新都经 typed client signal router 写入
canonical Turn 的 `moderation_metadata`，Renderer 只做 last-write-wins 且不展示 raw JSON。Electron 不新增 IPC，Codex
TUI 忽略该通知的行为不复制为 Desktop UI；多模型与多模态控制面仍由 Grok-aligned `model-provider` 承接。

runtime diagnostics 与 command terminal interaction 只允许走 typed server notification：`runtime.warning` / `runtime.error`
由 App Server 分别投影为 `warning` / `error`，live 与 cold read 共用 durable event owner；`error.willRetry` 不直接生成
Turn terminal。`item/commandExecution/terminalInteraction` 只发送脱敏、bounded summary，并与 canonical
CommandExecution read model 合并。raw diagnostic side-channel、未脱敏 stdin/stdout 和 Renderer 自建 terminal history
均为 `dead / forbidden-to-restore`。

## Thread Revert 主链

Codex `thread/revert` 是 experimental 的 paginated history replacement，Lime current owner 只允许以下主链：

`AppServerClient.revertThread -> app_server_handle_json_lines -> App Server thread/revert -> RuntimeCore history replacement -> canonical Thread/Turn/Item projection`

Rust `app-server-client`、`packages/app-server-client`、v2 method/envelope、schema registry 和 generated TypeScript
必须同步 `ThreadRevertParams`、`ThreadRevertResponse`、`thread/reverted`。入口在 connection transport 边界检查
`initialize.capabilities.experimentalApi`；未声明时返回 `INVALID_REQUEST`，不得由 renderer 或 mock 绕过。每个 Thread
拥有独占串行 scope，活动 Turn 先复用现有 interrupt/cancel 流程，失败时保持原历史不变。

RuntimeCore 使用 append-only `history.rollback` replacement marker 重算 effective event stream，不截断旧 JSONL，
不回滚本地 workspace 文件；provider history、cold hydration、read model 和 turns/items cursor 都从同一 effective
stream 读取。响应保留原 Thread identity，`thread.turns` 返回空数组并携带分页回溯 cursor，成功后发送一次
`thread/reverted`。`thread/rollback` 属于 Codex deprecated surface，不恢复为 GUI 主操作。

Renderer current GUI 由用户消息旁的 `ThreadRevertTrigger` 和共享 `ThreadRevertDialog` 承接；canonical Turn 与 fallback
消息投影必须复用同一入口。确认态明确说明只移除目标 Turn 及其后的对话、保留 Thread 且不回滚工作区文件。提交只通过
typed `revertThread` gateway，成功后以 `timelineMode=replace` 刷新 canonical `thread/read`，使已从 read model 消失的
Turn/Item 同步从 GUI 删除；普通 streaming/terminal refresh 继续使用 merge。Thread identity 漂移或调用失败时 fail
closed，并保留现有历史。独立 Gate B 证据位于
`.lime/qc/gui-evidence/thread-revert-electron-gate-b/thread-revert-electron-gate-b-summary.json`，证明真实 Electron GUI 点击、
preload/IPC、`app_server_handle_json_lines -> thread/revert -> thread/read`、`app_server_drain_events`、Thread identity 保留、
第一轮保留、第二轮移除和 workspace 文件不变，mock/invoke/console/page error 均为 0；该受控 external fixture 不证明 live
provider、packaged app 或 Windows。

该能力的定向证据必须覆盖 paginated replacement、metadata-only response、cursor、notification、missing-turn exact
error、transport experimental gate、active-turn interrupt、cold resume、重复 revert、provider prefix 保留与 workspace
文件不变。生产链禁止第二套历史存储、截断日志或 mock fallback。

## Config Control Plane 主链

Desktop 配置只允许走现役 core 配置 owner 的用户/项目层：

`Settings/fixture -> AppServerClient.request(config/read|config/value/write|config/batchWrite) -> app_server_handle_json_lines -> App Server config processor -> lime_core config.yaml`

`config/read` 无 cwd 时返回用户层；有 cwd 时从用户层与最近 Git 根到 cwd 的
`.lime/config.toml` 项目层合成 effective config、origins 和独立 layers。项目文件只能影响
已接入新 Thread 默认值的字段；信任仅来自用户 YAML `projects.<absolute-path>.trust_level`，
未信任和符号链接项目层不参与合成且不可写。新 Thread 根据 cwd 冻结默认值，旧 Thread/恢复保持
canonical 快照；全局桌面和模型偏好仍写用户层。

`config/value/write` / `config/batchWrite` 的绝对 filePath 只允许当前用户文件或可解析的可信
项目配置；项目 revision 使用原始 TOML 字节摘要，逐项编辑保护注释与无关字段，整个 batch
校验成功后才落盘。项目的内联 sandbox 表无法安全编辑时明确报错。未知 key、版本冲突、
无效 schema 和其他路径均拒绝。Electron 只转发 `app_server_handle_json_lines`，不得恢复
`get_config` / `save_config` 或新增第二套配置业务后端。真实 macOS 强制配置以 MDM 层投影，受管父子路径写入在落盘前拒绝。

`configRequirements/read` 由 core `config::managed` 组合、`config::requirements` 校验与 RuntimeCore 单一读取路径实现，独立于用户/项目/cwd：Unix 为 `/etc/lime/requirements.toml`，Windows 经系统 Known Folder API 定位 ProgramData/Lime/requirements.toml。仅 Host composition 可注入源路径；没有环境变量、配置字段或 RPC 路径覆盖。当前支持 `allowed_approval_policies`、`allowed_sandbox_modes`、`allowed_web_search_modes` 及 `[in_app_browser].allow_external_browser_settings_import`；系统文件和强制偏好均缺失或组合无有效约束时返回 null，损坏/空审批或沙盒列表明确拒绝，关闭搜索始终允许。浏览器字段使用上游 `InAppBrowserRequirementsToml` / `InAppBrowserRequirements`，wire 为 `inAppBrowser.allowExternalBrowserSettingsImport`；仅显式 false 禁止，省略/高层空表不替换低层显式值，任何层的非法类型均拒绝。网关保留缺省/null/boolean 并拒绝非法嵌套策略；普通用户配置和 RPC 参数不能提供管理员 authority。该读取接线不表示尚未实现的原生导入执行器已完成。用户/项目写入在落盘前检查；config/read/new Thread 默认值只收敛继承值，显式 Thread/设置/Turn 与 command/exec 的有效沙盒在执行前拒绝越权；旧 Thread 不因历史快照豁免。每次操作重新读取策略。macOS 强制配置的 MDM origin 已接入同一 ConfigLayers；requirements 按系统文件 → 强制配置中 approval/sandbox 的单值回填 → 独立强制 requirements 逐字段覆盖。域固定 com.limecloud.lime，键为 config_toml_base64 / requirements_toml_base64；读取前后均检查 forced，错误类型/base64/TOML/超限/未支持键明确拒绝。非 macOS 没有虚构 MDM 层；enterprise transport 和其他 requirements 字段尚未实现。`browser_requirement` 仍只是任务意图。

`config/mcpServer/reload`同为planned，
必须重读同一配置并协调现役MCP连接；既有`mcpServer/list|create|update|delete`和start/stop
继续current，不增加第二配置库或用同类功能冒充exact reload合同。

## Permission Profile 主链

Desktop、CLI/TUI 新回合和 standalone `command/exec` 的权限选择只允许走：

`Desktop/CLI/TUI -> AppServerClient.request(...) -> app_server_handle_json_lines -> App Server permissionProfile/list | thread/start | turn/start | thread/settings/update | command/exec -> permission profile resolver -> RuntimeRequest/CommandExecServer -> tool-runtime`

catalog 按 Codex 顺序返回三个内建 profile，再返回 YAML `permissions` named profiles。`default_permissions` 在未显式选择
时生效；显式 profile 覆盖 default。每个 named profile 支持 `extends`、filesystem `entries`（read/write/none/deny）和
network enabled。App Server 根据当前 cwd、平台 backend 和 strict readiness 计算 `allowed`，并把 profile lowering 为
runtime `read-only`、`workspace-write`、`danger-full-access` 与内部 `grantedPermissions`。客户端 wire 只允许传
`permissionProfile`，`grantedPermissions` 为服务端派生字段，直接注入必须拒绝。`thread/start`、`turn/start`、
`thread/settings/update.permissions` 与 `command/exec.permissionProfile` 使用同一 resolver；settings mutation 原子
持久化 profile provenance 和 lowering 后的 sandbox policy，再通过 `thread/settings/updated` 与 canonical `thread/read`
回流 GUI。profile 与显式 `sandboxPolicy` 双传、未知 profile、继承环和非法 grants 必须拒绝。

`permissionProfile/list`、`thread/start`、`turn/start` 与 `thread/settings/update` 共用同一个动态 policy producer。它从 Lime
全局 `agent.workspace_sandbox`、物化后的请求 cwd、当前平台 sandbox backend 和 Windows setup artifact readiness 计算
`allowed`；strict 模式要求受限 backend 但 backend 不可用时，`:read-only` 与 `:workspace` 必须禁止，
`:danger-full-access` 保持显式逃生选项。Renderer 在提交 Turn 前用当前 Thread cwd 查询 catalog，不能只依赖启动时快照。

Electron 不新增权限业务命令或本地 catalog；Renderer/TUI 不复制 Codex picker 或读取 project-local `.codex/config.toml`。
系统 requirements 的三个 allowed lists 已由上文 core/RuntimeCore owner 约束全部执行入口。Cloud managed config、enterprise requirements、其他管理员字段及真实 Windows packaged enforcement
仍属于 deferred/fail-closed；Cloud profile 只能由 authenticated remote transport 提供，不能在 CLI 伪造。多模型 catalog、
model switch、provider capability/readiness、retry/circuit breaker 与多模态 sampling/media lowering 继续归
Grok-aligned `model-provider`。

本地 rollout 维护入口为 rollout/compress，params 只接受省略、null 或空对象；返回 {}
只确认触发，不表示压缩已经结束。只支持本地 canonical rollout owner，缺少该 owner
按 Codex 返回 MethodNotFound。Rust typed client、共享 TypeScript client 与
src/lib/api/rolloutMaintenance.ts 均走同一 JSON-RPC，不增加 IPC 或 mock 命令。
可通过共享 config/value/write 设置 experimental.local_thread_store_compression；
默认 false，只控制下次启动自动触发，手动 RPC 不受 startup gate 限制。
thread/unarchive 在未归档/不存在时返回 InvalidRequest，无成功或环境连接通知。

r33 源码补核：Codex message_processor.rs、v2/rollout_compress_tests.rs 要求
连接 initialize.capabilities.experimentalApi=true；rollout/compress 现在遵守该
connection-local opt-in，无声明返回 -32600 和上游同文错误，且不调度 worker。

## Managed Worktrees 主链

Worktrees 设置清单与删除复用 `projectGit/worktree/list|delete`，沿 typed renderer gateway、
现役 JSONL IPC、App Server project_git processor、RuntimeCore 与 Git service 执行。
`list` 只读取当前全局 `worktrees.root` 中已注册的 linked checkout；不存在的根目录返回空清单，
不创建目录、不写清单数据库。关联聊天来自 canonical ThreadStore 分页（包括归档），固定状态
来自现役 section owner，活动状态来自 canonical projection 与 loaded runtime。

`delete` 只接受 `rootPath`，不接受强制丢弃参数。服务端重新核对当前配置根、Git registration、
common-dir、gitdir backlink 与本地文件状态；固定或活动聊天拒绝删除。归档关联聊天后再次检查
聊天状态和 checkout，再执行无 force 的 targeted `git worktree remove`。失败可能已经归档聊天，
客户端必须保留失败状态并明确说明。此流程不是跨进程事务；不声称具有快照恢复或自动清理能力。
Electron 仅转发既有 IPC，不增加 Git 业务命令或生产 mock fallback。


## 独立知识平台退役

`knowledgePack/list|read|source/import|compile|default/set|status/update`、
`knowledgeContext/resolve` 与 `knowledgeContextRun/validate` 已从 public protocol、
catalog、Rust/TypeScript client 和 App Server dispatch 删除，返回 MethodNotFound。
知识页面、前端网关、专用 mock、crate 和编译执行器为 dead/deleted/forbidden-to-restore。
资料整理专家继续通过标准 Skills、同一 Thread/Turn 与现役工具执行，输出普通工作区文档；
不恢复隐藏知识会话或额外编译协议。多模型、主题、专家广场、消息渠道保持 current。


浏览器配置沿现役 config/read、config/batchWrite 与 config/value/write，无新增 IPC/JSON-RPC。
`browser_use` 为 Codex 同名公共准入配置；`browser` 仅保存 Desktop 原生询问偏好与 grants，
矩阵编辑使用一次 CAS batch 原子写入两部分，过期冲突不重放授权。
Renderer 与 Host 共用同一校验和 deny 优先投影：任意匹配拒绝优先、重复规范化别名不放宽、
access deny 连带禁止下载/上传/CDP。旧持久化 agent_permissions/history_access/site_tools_enabled/full_cdp_access 已退出；
full_cdp_access 仅保留为上游 browser_use 准入字段，历史及矩阵名称仅是 UI view model。
设置页沿原 `config/read(includeLayers)` 同次消费 effective 配置、raw User 与 origins，
只读投影区分保存值、生效值、跨规则限制及真实受管来源；该上下文不进入任何配置写入。
完整覆盖的 deny 与部分交集分别显示阻断和“按网址判定”，不以虚构网址推断通配许可。
只读单元格和覆盖的受管拒绝同时在控件与事件处理中禁用，规则编辑继续使用原队列/CAS；
没有新增 IPC、App Server method 或管理员 authority，也不代表完整企业浏览器 requirements 已实现。


## 独立资源窗口退役

`open_resource_manager_window` 已从 Electron Host、IPC allowlist、Renderer gateway、
命令目录册和 DevBridge 专用策略删除。独立 `/resource-manager` 路由和资源导航 intent
不再消费；旧窗口参数只进入主应用，不能启动第二资源面。图片预览使用现有 Artifact/Files
入口，普通文件保存不触发额外 material import。保留标准文件、MCP resource、插件 resource
与模型 media task 的现役协议；不增加兼容命令、mock fallback 或平行文件后端。


Browser 独立管理员策略继续使用现有 `configRequirements/read`（无新 method、IPC 或 catalog 入口），
新增 `allowBrowserAndComputerUse` 与 Codex 同名 `browserUse` 对象。来源仅为系统 requirements 和平台 forced
requirements，RPC 参数及普通配置不能提供 authority。`config/read.browser_use` 是用户/受管配置层准入；
它不能替代独立管理员约束。BrowserAppServerBridge 与设置 gateway 均消费此只读响应，Host 在配置读取
失败时关闭 Agent 控制并撤销旧授权；权限 UI 不持久化 requirements，`browserPreferences` 剥离此投影。
原生扩展头、网络代理/域名 requirements 与自动审核执行仍未接线，不能按字段存在宣称完成。

Browser browse receipt 默认 thread；管理员 accessApprovalLifetime=turn 时按回合撤销。
凭据只保存在现役 BrowserPermissions，按 owner/window/thread/browserSession/精确 origin 隔离，
policy revision 变化立即失效。pending token 与 action approval 仍属于原 call/turn/tab/view/page，
跨回合只复用已批准的浏览准入，后续回合必须重新 claim 原生控制；不增加 RPC/IPC 方法或 Renderer authority。
