# Teleport 模块 🟢

> 成熟度: 🟢 稳定 | 测试覆盖: 35 个测试用例

远程会话连接模块，提供远程会话同步、仓库验证等功能。

## 功能概述

- **远程连接**: 通过 WebSocket 连接到远程会话
- **消息同步**: 实时同步会话消息和状态
- **仓库验证**: 确保在正确的 Git 仓库中运行
- **断线重连**: 自动重连机制
- **心跳机制**: 保持连接活跃

## 文件索引

| 文件 | 说明 |
|------|------|
| `mod.rs` | 模块入口和导出 |
| `types.rs` | 类型定义（TeleportConfig, RemoteMessage 等） |
| `session.rs` | 远程会话管理（RemoteSession） |
| `validation.rs` | 仓库验证（URL 规范化、分支检查） |
| `connection.rs` | WebSocket 连接管理（心跳、重连） |

## 使用示例

```rust
use aster::teleport::{connect_to_remote_session, TeleportConfig, RemoteSession};

// 便捷连接
let manager = connect_to_remote_session(
    "session-id",
    Some("wss://example.com"),
    Some("auth-token"),
).await?;

// 或使用 RemoteSession
let config = TeleportConfig {
    session_id: "session-id".to_string(),
    ingress_url: Some("wss://example.com".to_string()),
    auth_token: Some("token".to_string()),
    metadata: None,
};
let mut session = RemoteSession::new(config);
session.connect().await?;
```


