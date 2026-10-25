# MCP 服务器与工具管理

## 事实源

MCP 管理、发现、工具调用、提示词、资源和订阅控制面只允许继续收敛到：

`src/lib/api/mcp.ts -> AppServerClient.request(...) -> app_server_handle_json_lines -> App Server JSON-RPC -> lime-rs/crates/mcp`

Electron Desktop Host 只负责 renderer bridge、事件转发、系统浏览器打开和 sidecar 生命周期，不承接 MCP 业务事实；desktop-host 默认 mock 不再提供 MCP fallback。

MCP 有两个不能混用的 current owner：GUI management read（server/status/resource/prompt）继续使用 `LocalAppDataSource` 的 management-only `McpClientManager`；Agent runtime MCP connection 必须按 Session/Thread 持有 immutable `threadId`。management manager 不拥有 Thread，也不允许 server-originated elicitation。`mcpServer/tool/call` 必须从 canonical Thread 解析 Session，并经 `ExecutionBackend -> AgentRuntimeState -> McpThreadRuntime` 执行；缺少可信 Thread owner 时直接拒绝，禁止从最近活动 Turn、singleton、`sessionId`、`parentToolCallId`、progress token 或 server metadata 猜测归属。

## 当前结构

```text
src/lib/api/
├── mcp.ts                 # 前端 MCP API 网关，唯一 renderer 调用入口
├── mcpTypes.ts            # 公开类型与 mcp__<server>__<tool> 命名 helper
└── mcpResponseGuards.ts   # App Server response fail-closed guard

src/components/settings-v2/integrations/plugins/
├── index.tsx                  # PluginsSettings，插件/MCP/技能/Marketplace 同一管理页
├── McpServerManager.tsx        # 用户配置与插件来源分组、启停和认证
├── McpServerDetail.tsx         # 新增/编辑/卸载及脏草稿守卫
├── McpServerFields.tsx         # STDIO / HTTP 结构化字段
├── mcpServerConfig.ts          # 配置往返，保留未展示字段
├── useMcpSettings.ts           # canonical 配置/status 与 typed notification
├── InstalledSkillsSettings.tsx # skills/list metadata 与精确路径启停
├── useSkillsSettings.ts        # skills/config/write、effective state 与只读确认
├── MarketplaceSettings.tsx     # 配置市场、升级与移除入口
└── useMarketplaceSettings.ts   # 精确市场身份、影响列表和逐个卸载恢复

lime-rs/crates/
├── mcp/                   # MCP manager、stdio / streamable HTTP、OAuth、tools/prompts/resources
├── app-server-protocol/   # mcpServer* / mcpTool* / mcpPrompt* / mcpResource* schema
└── app-server/            # JSON-RPC processor、runtime projection、evidence/read model 接线

scripts/mcp/
├── current-smoke.mjs      # MCP current smoke 入口
├── live-provider-smoke.mjs
└── lib/                   # smoke transport、fixture、contract guard helper
```

## App Server methods

Current MCP method 固定为：

- `mcpServer/list`
- `mcpServerStatus/list`
- `mcpServer/create`
- `mcpServer/update`
- `mcpServer/delete`
- `mcpServer/enabled/set`
- `mcpServer/oauth/login`
- `mcpServer/oauthLogin/completed`
- `mcpServer/startupStatus/updated`
- `mcpServer/start`
- `mcpServer/stop`
- `mcpServer/resource/read`
- `mcpServer/tool/call`
- `mcpTool/list`
- `mcpTool/listForContext`
- `mcpTool/search`
- `mcpPrompt/list`
- `mcpPrompt/get`
- `mcpResource/list`
- `mcpResource/subscribe`
- `mcpResource/unsubscribe`

`mcpServer/resource/read` 的 `threadId` 可选；携带时只读取对应 Session-owned runtime，未携带时才走 management manager。`mcpServer/tool/call` 的 `threadId` 必填。Settings 管理面不提供工具执行按钮；Workspace/Agent 消费者只能传真实 Thread identity。旧 `mcpTool/call`、`mcpTool/callWithCaller` 与 `mcpResource/read` 为 `dead / deleted / forbidden-to-restore`；protocol catalog、schema、App Server、typed clients、Renderer 和 smoke 均不得再提供正向入口。

旧 Desktop facade 已归类为 `dead / retired guard-only`，包括 `get_mcp_servers`、`mcp_list_*`、`mcp_call_tool*`、`mcp_get_prompt`、`mcp_read_resource`、`mcp_start_server`、`mcp_stop_server`、`add_mcp_server`、`update_mcp_server`、`delete_mcp_server`、`toggle_mcp_server`、`import_mcp_from_app`、`sync_all_mcp_to_live`。这些名字只能出现在负向测试、contract forbidden snippet、smoke legacy 黑名单或历史 evidence 中。

## Lifecycle notification

- `mcpServer/start` 在调用 RuntimeCore 前发布 `mcpServer/startupStatus/updated { threadId: null, name, status: "starting", error: null, failureReason: null }`。
- 启动成功发布 `ready`；启动失败先发布带 typed error 的 `failed`，再保留原 JSON-RPC error。`cancelled` 与 `reauthenticationRequired` 保留为 Codex 对齐的严格协议值，当前 app-scoped start producer 不伪造它们。
- 插件设置同步订阅 App Server typed event bus，生命周期通知触发同一配置/status owner 重读。设置不提供独立运行统计、工具手工调用或资源预览面板；工具、资源和 prompts 由 Agent 现役消费者使用。
- `mcp:server_started`、`mcp:server_stopped`、`mcp:server_error` 与 `mcp:oauth_completed` 均为 `dead / deleted / forbidden-to-restore`。`mcp:tools_updated`、`mcp:resources_updated`、`mcp:resource_updated` 仍由各自 current owner 承接，不得与 startup notification 混成第二生命周期 owner。

## Server-Originated Elicitation

`mcpServer/elicitation/request` 是 App Server `serverRequest`，不是 Renderer `AppServerRequestMethod`。公开 request 只包含必填非空 `threadId`、可空 `turnId`、必填非空 `serverName` 和 typed `mode: "form"`；`sessionId`、`parentToolCallId`、私有 scope token 和 raw MCP request id 都禁止跨 JSON-RPC 边界。

它是瞬时 reverse request：App Server 以 outer JSON-RPC id 精确等待 Response/Error，`serverRequest/resolved` 只回到创建 request 的同一 connection，且先于 exact domain waiter continuation。它不得生成 Thread/Turn/Item、read model 或 durable store 写入。Renderer 在主窗口根部用全局 GUI Modal 消费 typed form；不得复用 TUI、Approval、通用 answer control 或生产 mock。

## Transport 与 auth

- `stdio` 与 `streamable_http` 都由 `lime-rs/crates/mcp` 管理。
- HTTP header 只允许来自配置中的安全字段或环境变量引用；inline secret、非法 header、缺失 env var 必须 fail closed。
- OAuth 登录走 `mcpServer/oauth/login`，使用系统浏览器 current 网关打开授权 URL；callback 成功或失败后由 App Server 发布 `mcpServer/oauthLogin/completed` typed notification，Renderer 经 typed event bus 刷新 server/tool 状态。旧 `mcp:oauth_completed` Desktop event 为 `dead / deleted / forbidden-to-restore`。
- OAuth token store 使用 app data runtime 下的 versioned credential envelope，按 server name + URL 隔离。
- 显式 `oauth.client_id` / `oauth_resource` 目前仍按 unsupported fail-closed，不能伪装成可用。

## Runtime 工具命名

MCP runtime 工具命名唯一事实源：

- 工具全名：`mcp__<server>__<tool>`
- extension surface key：`mcp__<server>`
- UI 展示名：优先显示 server 原名
- deferred 工具通过 `ToolSearch` 时优先使用 `select:mcp__<server>__<tool>`

不要恢复裸 `server__tool`、临时 `server_tool` 或 inventory / mock / GUI 各自一套前缀的旧心智。

## Resources / prompts / evidence

- `mcpResource/list` 同时返回 `resources` 与 `resourceTemplates`；读取使用 exact `mcpServer/resource/read -> contents[]`。
- `mcpResource/subscribe` / `mcpResource/unsubscribe` 使用 MCP 标准 resource subscription。
- 标准通知 `notifications/resources/list_changed` 与 `notifications/resources/updated` 通过现役 MCP runtime/事件协议消费；不能为旧设置面板恢复第二份资源投影。
- `ReadMcpResourceTool` 的 grounding 进入 canonical read model 的 diagnostics facts，只记录 server、URI 摘要、mime、content refs 等可回放元数据，不复制 resource 正文或 blob。

## 校验入口

最低校验按改动范围选择：

```bash
npx vitest run "src/lib/api/mcp.test.ts" "src/lib/api/mcp.failClosed.test.ts" "src/components/settings-v2/integrations/plugins/McpServerManager.test.tsx"
npm run test:contracts
npm run verify:gui-smoke
```

MCP smoke：

```bash
npm run smoke:mcp-current
npm run smoke:mcp-current -- --allow-write-fixture
npm run smoke:mcp-current -- --allow-oauth-fixture
npm run smoke:mcp-oauth-notification-electron-fixture
npm run smoke:mcp-startup-notification-electron-fixture
npm run smoke:mcp-current -- --allow-live-provider
```

`--allow-live-provider` 只能在提供 `LIME_MCP_LIVE_SERVER_URL` 和凭证环境后运行；缺 env 必须在 DevBridge / App Server 调用前 fail closed，不能把无凭证环境伪造成 live provider 成功。

## 相关文档

- [commands.md](commands.md) - MCP 控制面主链、旧命令 dead 分类、工具命名主链
- [quality-workflow.md](quality-workflow.md) - GUI / command / bridge 校验门槛
- [governance.md](governance.md) - current / compat / deprecated / dead 分类语言
- [../exec-plans/mcp-modernization-progress.md](../exec-plans/mcp-modernization-progress.md) - 当前 MCP 现代化进度与缺口

### 跨应用同步已退役

外部应用 MCP 导入与同步为 `dead / deleted / forbidden-to-restore`：原同步模块、两条公共 RPC、SDK/gateway 方法及专用启用 flags 均删除。普通 CRUD 和启停仅操作本地 MCP authority，不读写其它应用的配置文件；启用参数只有服务器 id 与 enabled，旧 appType 必须拒绝。数据库启动时移除退役列，保留当前配置和本地启用状态，不根据其它应用的旧开关重新启用服务器。模型 provider 的多协议配置不受影响。

### STDIO 环境与配置 owner

`lime-rs/crates/mcp/src/mcp_types.rs` 是 MCP 传输配置唯一类型化解析 owner，`types.rs` 仅重导出公共配置类型并承接协议数据。旧 core `McpServerConfigTyped` 与容错 `parse_config` 已删除，持久化仍保存原始 server_config 对象。

本地 STDIO 的 `env_vars` 与显式 `env` 分开：前者只包含需从宿主读取的变量名，后者的原始值覆盖透传值。设置的名称列表修剪空白、空项不落盘，显式值原样；无关宿主变量不隐式继承，不可继承变量即使显式覆盖也被过滤。本机不接受 remote source 对象。`utils.rs#create_env_for_mcp_server` 与进程 launcher 直接接线，名称、优先级和环境筛选复制适配自 Codex rmcp-client/src/utils.rs；Windows 使用同一 agent-protocol 的 WINDOWS_CORE_ENV_VARS，证书路径按上游转为绝对路径。

### 组合管理边界

分组顺序沿安装包证据为 Plugins、Apps、MCPs、Skills、Marketplace；MCPs 恒可见，其他分组在完整读回为空后隐藏。Apps 的 hosted connector 与独立启停 authority 尚有缺口，不能用本地插件声明或 `callable: false` 冒充可连接应用，也不显示无真实行为的开关。

Skills 消费完整项目 roots 和 `skills/list` metadata，按 canonical 绝对路径去重和写入 `skills/config/write`，不按显示名称修改。Marketplace 按名称与 canonical manifest path 标识；只有唯一已配置市场可移除，只有 Git 来源可升级。移除前完整读取已安装插件，按精确 plugin ID 顺序卸载；重试跳过已成功项。升级或移除写入成功而读回失败时只读确认，不能再次提交破坏性操作。所有操作仍使用既有 gateway、App Server 和持久化 owner。
