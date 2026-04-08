# LSP 服务器管理模块

提供 Language Server Protocol 服务器管理功能。

## 文件索引

| 文件 | 说明 |
|------|------|
| `mod.rs` | 模块导出 |
| `config.rs` | LSP 服务器配置：配置结构、默认配置、配置文件加载 |
| `server.rs` | LSP 服务器实例：进程管理、文档管理 |
| `manager.rs` | LSP 服务器管理器：多服务器管理、诊断缓存 |

## 核心功能

### LSPServerConfig
- 服务器配置定义
- 支持 .lsp.json 配置文件
- 默认配置 (TypeScript, Python, Rust)

### LSPServer
- 进程启动/停止
- 文档打开/关闭
- 健康检查

### LSPServerManager
- 多服务器管理
- 按文件扩展名查找服务器
- 诊断信息缓存

## 使用示例

```rust
use aster::lsp::{LSPServerManager, InitializeLSPOptions};

let manager = LSPServerManager::new("/path/to/workspace");
manager.initialize(InitializeLSPOptions {
    load_config_file: true,
    use_defaults: true,
    ..Default::default()
}).await?;

// 获取文件对应的服务器
if let Some(server_name) = manager.get_server_for_file(Path::new("main.rs")).await {
    println!("使用服务器: {}", server_name);
}

// 关闭
manager.shutdown().await;
```


