# Chrome MCP 模块

Chrome 浏览器集成模块，与官方 Claude Code Chrome 扩展兼容。

## 模块结构

```
chrome_mcp/
├── mod.rs           # 模块入口和导出
├── types.rs         # 类型定义（常量、配置、结果类型）
├── native_host.rs   # Native Host 安装和管理
├── socket_client.rs # Socket 客户端（MCP Server → Native Host）
├── socket_server.rs # Socket 服务器（Native Host 进程）
├── mcp_server.rs    # MCP 服务器（CLI ↔ stdio）
├── tools.rs         # 17 个 Chrome MCP 工具定义
└── README.md        # 本文档
```

## 架构

```
CLI ↔ stdio ↔ MCP Server ↔ Socket ↔ Native Host ↔ Native Messaging ↔ Chrome 扩展
```

## 核心组件

### types.rs
- `CHROME_EXTENSION_ID` - Chrome 扩展 ID
- `NATIVE_HOST_NAME` - Native Host 名称
- `Platform` - 平台枚举
- `ToolCallResult` - 工具调用结果

### native_host.rs
- `get_platform()` - 获取当前平台
- `get_socket_path()` - 获取 Socket 路径
- `setup_chrome_native_host()` - 安装 Native Host
- `should_enable_chrome_integration()` - 检查是否启用

### socket_client.rs
- `SocketClient` - 连接到 Native Host 的客户端
- `call_tool()` - 调用 Chrome 工具

### socket_server.rs
- `SocketServer` - 管理 MCP 客户端连接
- `run_native_host()` - 运行 Native Host 主循环

### mcp_server.rs
- `McpServer` - MCP 协议服务器
- `run_mcp_server()` - 运行 MCP 服务器

### tools.rs
- 17 个 Chrome MCP 工具定义
- `get_chrome_mcp_tools()` - 获取所有工具
- `get_tool_names_with_prefix()` - 获取带前缀的工具名

## 使用示例

```rust
use aster::chrome_mcp::{
    should_enable_chrome_integration,
    setup_chrome_native_host,
    run_mcp_server,
};

// 检查是否启用
if should_enable_chrome_integration(Some(true)) {
    // 安装 Native Host
    setup_chrome_native_host("aster native-host").await?;
    
    // 运行 MCP 服务器
    run_mcp_server().await?;
}
```

## 支持的工具

1. `javascript_tool` - 执行 JavaScript
2. `read_page` - 读取页面可访问性树
3. `find` - 自然语言查找元素
4. `form_input` - 填写表单
5. `computer` - 鼠标键盘操作
6. `navigate` - 页面导航
7. `resize_window` - 调整窗口大小
8. `gif_creator` - GIF 录制
9. `upload_image` - 上传图片
10. `get_page_text` - 获取页面文本
11. `tabs_context_mcp` - 获取标签页信息
12. `tabs_create_mcp` - 创建新标签页
13. `update_plan` - 更新自动化计划
14. `read_console_messages` - 读取控制台消息
15. `read_network_requests` - 读取网络请求
16. `shortcuts_list` - 列出快捷键
17. `shortcuts_execute` - 执行快捷键
