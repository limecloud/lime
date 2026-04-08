# 自动更新系统 🟢

> 成熟度: 🟢 稳定 | 测试覆盖: 39 个测试用例

提供版本检查、下载、安装和回滚功能。

## 文件索引

| 文件 | 说明 |
|------|------|
| `mod.rs` | 模块导出 |
| `checker.rs` | 版本检查器：版本比较、更新检查 |
| `installer.rs` | 安装器：下载、安装、回滚、备份管理 |
| `manager.rs` | 更新管理器：事件通知、状态管理、便捷函数 |

## 核心功能

### Installer
- 下载更新包
- 安装和回滚
- 备份管理
- 清理旧版本

### UpdateManager
- 更新状态管理
- 事件通知（UpdateEvent）
- 多更新通道（Stable/Beta/Canary）
- 自动检查和安装

### 便捷函数
- `check_for_updates()` - 检查更新
- `perform_update()` - 执行更新
- `rollback_version()` - 回滚版本
- `list_versions()` - 列出可用版本

## 使用示例

```rust
use aster::updater::{UpdateManager, UpdateConfig, UpdateOptions, UpdateEvent};

// 创建带事件通知的管理器
let (tx, mut rx) = tokio::sync::mpsc::channel(32);
let manager = UpdateManager::new(UpdateConfig::default())
    .with_event_sender(tx);

// 监听事件
tokio::spawn(async move {
    while let Some(event) = rx.recv().await {
        match event {
            UpdateEvent::UpdateAvailable { latest, .. } => println!("新版本: {}", latest),
            UpdateEvent::Installed { version } => println!("已安装: {}", version),
            _ => {}
        }
    }
});

// 检查并安装更新
let result = manager.check_for_updates().await?;
if result.has_update {
    manager.download(None, &UpdateOptions::default()).await?;
    manager.install(None, &UpdateOptions::default()).await?;
}

// 回滚到旧版本
manager.rollback("0.1.0", &UpdateOptions::default()).await?;
```


