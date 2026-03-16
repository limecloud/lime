# Proxycast Chrome Bridge 扩展

用于把 Chrome 页面能力接入 Proxycast 的浏览器桥接通道，供各业务 AI Agent 通过统一 `browser_execute_action` / MCP 浏览器工具调用。

## 功能

- Observer 通道自动连接：`/proxycast-chrome-observer/Proxycast_Key=...`
- 页面信息上报：标题、URL、Markdown
- 远程指令执行：`open_url` / `click` / `type` / `scroll` / `switch_tab` / `list_tabs` / `go_back` 等
- 弹窗配置：`serverUrl`、`bridgeKey`、`profileKey`、监控开关、手动抓取

## 安装

1. 打开 Chrome `chrome://extensions`
2. 打开右上角「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择目录：`extensions/proxycast-chrome`

## 配置

点击扩展图标打开弹窗，配置：

- `Server URL`：Proxycast 服务地址，例如 `ws://127.0.0.1:8999`
- `Bridge Key`：Proxycast 服务 API Key（与后端 `Proxycast_Key` 一致）
- `Profile Key`：浏览器会话隔离键（建议与业务场景对应，如 `research_a`）

点击「保存并重连」后，扩展会建立 observer WebSocket 连接。

## 验证

1. 在 Proxycast 设置中查看 `get_chrome_bridge_status`，`observer_count` 应大于 0
2. 调用 `browser_execute_action`：

```json
{
  "profile_key": "default",
  "action": "navigate",
  "args": { "url": "https://example.com" }
}
```

3. 再调用 `browser_execute_action`：

```json
{
  "action": "read_page"
}
```

如果返回 `success=true` 且 `data.markdown` 有内容，说明链路可用。

## 自动化联调脚本

仓库提供了桥接链路的端到端联调脚本（模拟 observer/control 双端）：

```bash
npm run bridge:e2e -- --server ws://127.0.0.1:8787 --key proxy_cast --profile default
```

脚本会验证：

- observer/control 握手
- 双向心跳 ack
- `wait_for_page_info=true` 命令链路（`command_result` + `page_info_update`）
- 普通命令链路（`command_result`）

## 兼容说明

- 扩展只负责浏览器侧采集与动作执行。
- Agent 侧通过 `aster_agent_cmd` 与 `unified_chat_cmd` 注册的浏览器 MCP 兼容工具访问。
- 若你同时使用独立 Chrome Profile（Tauri `open_chrome_profile_window`），请在对应 Profile 内安装该扩展，并使用不同 `profileKey` 做隔离。
