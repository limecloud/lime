# Lime Chrome Connector 扩展

用于把 Chrome 页面能力接入 Lime 的浏览器连接器通道，供各业务 AI Agent 通过统一 `browser_execute_action` / MCP 浏览器工具调用。

## 功能

- Observer 通道自动连接：`/lime-chrome-observer/Lime_Key=...`
- 页面信息上报：标题、URL、Markdown
- 远程指令执行：`open_url` / `click` / `type` / `scroll` / `switch_tab` / `list_tabs` / `go_back` 等
- 弹窗入口：直接打开 Lime 的“连接器”页，并保留高级手动配置
- 自动配置文件：导出后自动写入 `auto_config.json`
- 弹窗配置：`serverUrl`、`bridgeKey`、`profileKey`、监控开关、手动抓取

## 安装

1. 在 Lime 设置页进入“连接器”
2. 点击“选择目录并安装”或“同步更新扩展”
3. 在文件选择器里选择一个用户自定义根目录
4. Lime 会把扩展导出到固定子目录：`<你选择的目录>/Lime Browser Connector`
5. 打开 Chrome `chrome://extensions`
6. 打开右上角「开发者模式」
7. 点击「加载已解压的扩展程序」
8. 选择目录：`<你选择的目录>/Lime Browser Connector`

## 配置

点击扩展图标后，优先使用“打开 Lime 连接器页”回到桌面端统一管理。

只有在自动配置失效或手动排查链路时，才需要展开“高级配置”并填写：

- `Server URL`：Lime 服务地址，例如 `ws://127.0.0.1:8999`
- `Bridge Key`：Lime 服务 API Key（与后端 `Lime_Key` 一致）
- `Profile Key`：浏览器会话隔离键（建议与业务场景对应，如 `research_a`）

点击「保存并重连」后，扩展会建立 observer WebSocket 连接。

如果你已经通过 Lime 导出了扩展，目录里会同时带上 `auto_config.json`。扩展加载后会自动读取该文件并应用默认配置。

## 验证

1. 在 Lime 设置中查看 `get_chrome_bridge_status`，`observer_count` 应大于 0
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
- Agent 侧通过 `aster_agent_cmd` 暴露的现役浏览器 MCP 工具访问。
- 若你同时使用独立 Chrome Profile（Tauri `open_chrome_profile_window`），请在对应 Profile 内安装该扩展，并使用不同 `profileKey` 做隔离。
