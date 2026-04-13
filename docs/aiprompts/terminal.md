# 终端底层能力

## 概述

Lime 仍保留终端底层能力，用于复用运行时、诊断与会话管理；独立前端 `terminal / sysinfo / files / web` 页面已经下线，不再保留 `src/components/terminal/` 页面模块。

## 目录结构

```
src-tauri/src/terminal/
├── mod.rs          # 模块入口
├── pty.rs          # PTY 管理
├── session.rs      # 会话管理
└── commands.rs     # 终端命令

src/lib/api/terminal.ts
src/lib/terminal/
├── store/          # 终端状态与输入态
├── stickers/       # 终端贴纸状态
└── vdom/           # VDOM 状态与类型
```

## PTY 管理

```rust
pub struct PtyManager {
    sessions: HashMap<String, PtySession>,
}

pub struct PtySession {
    id: String,
    master: PtyMaster,
    child: Child,
}

impl PtyManager {
    /// 创建新会话
    pub fn create_session(&mut self, shell: &str) -> Result<String>;
    
    /// 写入数据
    pub fn write(&self, session_id: &str, data: &[u8]) -> Result<()>;
    
    /// 读取输出
    pub fn read(&self, session_id: &str) -> Result<Vec<u8>>;
    
    /// 调整大小
    pub fn resize(&self, session_id: &str, cols: u16, rows: u16) -> Result<()>;
    
    /// 关闭会话
    pub fn close_session(&mut self, session_id: &str) -> Result<()>;
}
```

## 前端边界

前端当前只允许通过 `src/lib/api/terminal.ts` 和 `src/lib/terminal/*` 复用终端会话、事件和状态能力，不再新增独立页面壳。

## Tauri 命令

```rust
#[tauri::command]
async fn terminal_create(shell: Option<String>) -> Result<String, String>;

#[tauri::command]
async fn terminal_write(session_id: String, data: String) -> Result<(), String>;

#[tauri::command]
async fn terminal_resize(session_id: String, cols: u16, rows: u16) -> Result<(), String>;

#[tauri::command]
async fn terminal_close(session_id: String) -> Result<(), String>;
```

## 相关文档

- [commands.md](commands.md) - Tauri 命令
- [components.md](components.md) - 组件系统
