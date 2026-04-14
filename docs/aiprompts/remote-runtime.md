# Remote runtime 主链

## 这份文档回答什么

本文件定义 Lime 当前 `Remote / SDK / Server Mode` 的唯一 remote runtime 事实源，主要回答：

- 哪些远程入口才算当前产品主链
- `消息渠道`、`浏览器连接器 / ChromeBridge`、`OpenClaw`、`DevBridge`、`telegram_remote` 分别属于哪一层
- 哪些路径负责真实 ingress / control plane，哪些只是安装壳、调试桥或兼容入口
- 后续新增 remote 能力应该往哪里收敛，而不是继续长平级旁路

它是 **远程入口与控制面的 current 文档**，不是 OpenClaw 页面说明，也不是单条渠道命令的局部注释。

## 什么时候先读

遇到以下任一情况时，先读本文件：

- 调整 `gateway_channel_*`、`gateway_tunnel_*`、渠道 probe 或多账号渠道运行时
- 调整浏览器连接器、ChromeBridge、远程调试入口或 browser backend policy
- 调整 `DevBridge` HTTP 桥、浏览器 dev shell 的后端接通逻辑
- 调整 `OpenClaw` Gateway、Dashboard、安装与运行态管理
- 调整单通道 Telegram 远程触发入口，或评估是否应该继续保留它

如果一个需求同时碰到“远程触发 + 浏览器接入”“渠道入口 + 本地 Gateway”“调试桥 + 产品运行时”中的两项以上，默认属于本主链。

## 固定 remote 主链

后续 Lime 的 remote runtime 只允许向下面这条主链收敛：

`外部入口（消息渠道 / 浏览器连接器） -> 当前本地 control plane -> agent/browser runtime -> 现有 session/task/evidence 事实源`

这条主链的固定判断是：

1. `消息渠道 runtime` 是当前 IM 远程入口主链
2. `浏览器连接器 / ChromeBridge` 是当前浏览器侧远程 transport 主链
3. `OpenClaw` 只作为本地 Gateway / 安装 / Dashboard 兼容壳，不再定义新的 remote 真相
4. `DevBridge` 只作为 debug-only 开发桥，不再冒充产品 remote runtime
5. `telegram_remote_cmd` 是旧单通道入口，不再继续扩成长期主链

固定规则只有一句：

**后续新增 remote 能力时，只允许接到 `消息渠道 runtime` 或 `浏览器连接器 / ChromeBridge` 这两条 current ingress；不允许再造第三条并列 remote runtime。**

## 代码入口地图

### 1. `消息渠道 runtime`

- `src/lib/api/channelsRuntime.ts`
- `src-tauri/src/commands/gateway_channel_cmd.rs`
- `lime_gateway::{telegram, feishu, discord, wechat}`

当前这里负责：

1. 多渠道 start / stop / status
2. 渠道账号 probe、登录、运行时模型绑定
3. tunnel / webhook 暴露与同步
4. 远程入站请求到本地 agent runtime 的 current 渠道入口

固定规则：

- 渠道远程入口统一走 `gateway_channel_*` 与 `gateway_tunnel_*`
- 前端当前主入口是 `channelsRuntime.ts`
- 不再把单独某个平台 bot runtime 重新拉回产品级总入口

### 2. `浏览器连接器 / ChromeBridge`

- `src/lib/webview-api.ts`
- `src-tauri/src/commands/browser_connector_cmd.rs`
- `src-tauri/src/services/browser_connector_service.rs`
- `src-tauri/src/commands/webview_cmd.rs`
- `src-tauri/src/commands/browser_runtime_cmd.rs`

当前这里负责：

1. 浏览器连接器安装、启停与权限配置
2. ChromeBridge 端点、连接状态与 connector session 断开
3. 外部 Chrome profile / CDP / managed browser backend 状态
4. Browser Assist 与远程浏览器接入的 current transport 事实

固定规则：

- 浏览器侧 remote transport 统一收口到 `webview-api.ts`
- `browser_connector_cmd.rs` 只负责设置与安装入口
- 真正的 session / backend / remote debugging 状态继续由 `webview_cmd.rs`、`browser_runtime_cmd.rs` 暴露

### 3. `OpenClaw` 本地 Gateway 壳

- `src/lib/api/openclaw.ts`
- `src-tauri/src/commands/openclaw_cmd.rs`
- `src-tauri/src/services/openclaw_service/*`
- `src/components/openclaw/*`

当前这里负责：

1. 本地安装、升级、环境检查
2. 本地 Gateway 进程拉起、停止、重启
3. Dashboard URL、健康检查、运行环境选择
4. 兼容页面与过渡操作壳

固定规则：

- `OpenClaw` 当前不是 remote runtime 的唯一事实源
- 它管理的是“本地 Gateway 壳与安装体验”，不是远程 session/control plane 真相
- 后续如果保留，只允许继续做 compat 支撑，不再扩成第二套产品 remote coordinator

这一步里“`OpenClaw` 属于 compat”是基于现有仓库实现和产品规划推断：

- 代码上它主要暴露安装、环境、Gateway、Dashboard 与 runtime candidate 管理
- 产品规划里它已被明确定位为“过渡安装入口”，不是长期一级产品导航

### 4. `DevBridge`

- `src-tauri/src/dev_bridge.rs`
- `src-tauri/src/dev_bridge/*`
- `src/lib/dev-bridge/*`

当前这里负责：

1. 仅在 `debug_assertions` 下提供 `3030` HTTP 桥
2. 让浏览器 dev server 调用现有 Tauri 命令
3. 为浏览器开发模式提供事件流和本地后端接通能力

固定规则：

- `DevBridge` 是 debug-only 开发桥，不是产品 remote runtime
- 它可以桥接 current 命令，但不能反向定义 current remote taxonomy
- 后续只允许继续做开发态适配与调试支撑

### 5. `telegram_remote_cmd`

- `src-tauri/src/commands/telegram_remote_cmd.rs`

当前这里负责：

1. Telegram 单通道轮询
2. 将命令映射到 `agent.run / agent.wait / agent.stop / cron.* / sessions.*`

固定规则：

- 它当前没有前端主入口
- 多渠道 current 主链已经迁到 `gateway_channel_cmd.rs`
- 后续只允许迁移、收口或下线，不再继续扩功能

## current / compat / deprecated / dead

### `current`

- `src/lib/api/channelsRuntime.ts`
- `src-tauri/src/commands/gateway_channel_cmd.rs`
- `gateway_tunnel_*`
- `lime_gateway::{telegram, feishu, discord, wechat}`
- `src/lib/webview-api.ts`
- `src-tauri/src/commands/browser_connector_cmd.rs`
- `src-tauri/src/services/browser_connector_service.rs`
- `src-tauri/src/commands/webview_cmd.rs`
- `src-tauri/src/commands/browser_runtime_cmd.rs`
- `docs/aiprompts/remote-runtime.md`

这些路径共同构成当前 remote 主链：

- IM 远程入口看 `gateway_channel_*`
- 远程浏览器 transport 看 `browser connector / ChromeBridge`
- 真实会话、任务与执行结果继续回到既有 agent/browser runtime 真相

### `compat`

- `src-tauri/src/dev_bridge.rs`
- `src-tauri/src/dev_bridge/*`
- `src/lib/dev-bridge/*`
- `src/lib/api/openclaw.ts`
- `src-tauri/src/commands/openclaw_cmd.rs`
- `src-tauri/src/services/openclaw_service/*`
- `src/components/openclaw/*`

保留原因：

- `DevBridge` 仍是浏览器开发模式的必要桥接层
- `OpenClaw` 仍承接本地 Gateway、安装、升级与 Dashboard 过渡体验

退出条件：

- `DevBridge` 继续只做开发态桥接，不再承担产品 remote 叙事
- `OpenClaw` 若继续保留，也只能作为本地壳与兼容入口，不再扩成第二套 remote control plane

### `deprecated`

- `src-tauri/src/commands/telegram_remote_cmd.rs`
- 任何继续把单渠道 bot runtime 直接定义为 remote 总入口的新实现
- 任何继续把 `OpenClaw` 页面或 `DevBridge` HTTP 桥当成产品 remote runtime 真相的新实现

### `dead`

- 当前 `M3` 不新增远程面的强制删除项；本轮先完成 current 事实源收口，不做额外硬删

## 最低验证要求

如果本轮改动涉及本主链，至少按边界选择最贴近的验证：

- 纯文档 / 分类回写：`npm run harness:doc-freshness`
- 改渠道命令 / tunnel / webhook：`npm run test:contracts` 与相关渠道定向测试
- 改浏览器连接器 / ChromeBridge：浏览器相关定向测试或 `verify:gui-smoke`
- 改 `DevBridge`：至少补桥接定向测试
- 改 `OpenClaw`：至少补相关页面或命令定向测试

## 这一步如何服务主线

`M3` 的目标不是一次性重写所有 remote 功能，而是先把 remote 真相收成一条 current 主链。

从现在开始：

- 解释 IM 远程入口时，回到 `gateway_channel_*`
- 解释远程浏览器 transport 时，回到 `browser connector / ChromeBridge`
- 解释开发态浏览器接通时，回到 `DevBridge` compat
- 解释本地 Gateway / Dashboard 壳时，回到 `OpenClaw` compat
- 解释旧 Telegram 单通道触发时，视为 `deprecated`

这样后续 `M4 Memory / Compaction` 和 `M5 State / History / Telemetry` 就不必继续被 remote 入口语言打断。
