# Session 模块

## 概述

Session 模块提供会话管理功能，支持可插拔的存储抽象。

## 架构

```
┌─────────────────────────────────────────────────────────────┐
│                      应用层 (CLI/Server/第三方应用)          │
├─────────────────────────────────────────────────────────────┤
│  impl SessionStore for MyStore { ... }                      │
│  Agent::new().with_session_store(Arc::new(MyStore))         │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      框架层 (aster crate)                    │
├─────────────────────────────────────────────────────────────┤
│  pub trait SessionStore: Send + Sync { ... }                │
│  pub struct Agent { session_store: Option<Arc<dyn ...>> }   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   默认实现 (SessionManager)                  │
├─────────────────────────────────────────────────────────────┤
│  SQLite 存储 (~/.aster/sessions/sessions.db)                │
└─────────────────────────────────────────────────────────────┘
```

## 使用方式

### 方式 1: 使用默认 SQLite 存储（向后兼容）

```rust
use aster::session::SessionManager;

// 使用全局 SessionManager（默认 SQLite 存储）
let session = SessionManager::create_session(dir, name, session_type).await?;
SessionManager::add_message(&session.id, &message).await?;
```

### 方式 2: 注入自定义存储（推荐）

```rust
use aster::session::{SessionStore, NoopSessionStore};
use aster::agents::Agent;
use std::sync::Arc;

// 使用空存储（不保存任何数据）
let agent = Agent::new().with_session_store(Arc::new(NoopSessionStore));

// 或实现自定义存储
struct MyCustomStore { /* ... */ }

#[async_trait]
impl SessionStore for MyCustomStore {
    async fn add_message(&self, session_id: &str, message: &Message) -> Result<()> {
        // 自定义存储逻辑
    }
    // ... 实现其他方法
}

let store = Arc::new(MyCustomStore::new());
let agent = Agent::new().with_session_store(store);
```

## 核心类型

### SessionStore trait

定义存储操作的抽象接口：

- `create_session` - 创建新会话
- `get_session` - 获取会话
- `add_message` - 添加消息
- `replace_conversation` - 替换对话历史
- `list_sessions` - 列出会话
- `delete_session` - 删除会话
- 等等...

### NoopSessionStore

空实现，不保存任何数据。适用于：
- 测试场景
- 无状态 API 服务
- 应用层自行管理存储

### SessionManager

默认的 SQLite 实现，提供静态方法（向后兼容）。

## 迁移指南

### 从旧版本迁移

旧代码（直接使用 SessionManager）：
```rust
SessionManager::add_message(&session_id, &msg).await?;
```

新代码（使用 Agent 注入存储）：
```rust
let agent = Agent::new().with_session_store(my_store);
// Agent 内部会自动使用注入的存储
```

## 文件结构

- `mod.rs` - 模块导出
- `store.rs` - SessionStore trait 定义
- `session_manager.rs` - 默认 SQLite 实现
- `extension_data.rs` - 扩展数据类型
- `archive.rs` - 会话归档
- `export.rs` - 会话导出
- `fork.rs` - 会话分支
- `statistics.rs` - 统计功能
