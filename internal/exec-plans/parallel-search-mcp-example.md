# Parallel Search MCP 配置示例

## 目标与写集

在 `docs/content/02.user-guide/9.mcp.md` 添加可运行的匿名 Streamable HTTP 配置和最小搜索、提取参数；本文件记录计划与验证。复用 current MCP owner，不新增预设、接口、运行时或依赖。退出条件是配置经现有加载器进入真实线程所属工具调用，搜索和提取返回有用内容。

## 边界与架构确认

现有 `MCP 配置页 -> App Server JSON-RPC -> crates/mcp` 管理链和 `Thread -> RuntimeCore -> MCP` 执行链不变。此项仅补文档，不属于重大架构变更；无新增 UI 文案 namespace 或 locale 资源。现有默认配置、用户保存的服务器和其他应用同步范围不变。

## 进度与验证

- 已读取根规则、MCP owner 文档、PR 模板及组织链接规则；未发现 issue、审批或领取任务前置要求。
- 已在干净目录按 README 的 npm 安装方式安装 Lime 1.154.0，使用真实 App Server runtime、隔离 app-data/data/XDG 路径。
- 已提取文档配置，通过 `mcpServer/create`、发现、真实 Thread 的 `mcpServer/tool/call` 调用匿名 `web_search` / `web_fetch`，返回官方 MCP 页面链接与摘录。
- 已用本地观测转发器记录真实 native HTTP transport 的 discovery/search/fetch 请求，确认每个请求携带示例中的 User-Agent、无 Authorization，并转发至真实 `/mcp` 端点；此观测配置只改变测试 URL，不进入产品。
- `npm run docs:boundary` 与 `git diff --check` 通过。最终提交将再次用文档原样配置和参数复验。
- 本项不修改 GUI/Bridge，Desktop Gate B 与 GUI smoke 不适用；不声明模型自动派发工具或端到端 Agent loop 验证。

## 分类与完成度

配置入口、HTTP transport 与线程工具执行均为 current；无 compat/deprecated/dead 路径变更。本项配置示例完成度 100%；验证覆盖配置加载、工具发现和线程工具调用，不扩大为 GUI 或 Agent loop 通过。
