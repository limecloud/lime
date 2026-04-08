# Rewind 功能模块

提供对话和文件状态的回退功能，支持文件历史追踪、对话状态回退和全局实例管理。

**成熟度**: 🟢 稳定 - 20 个单元测试通过

## 文件索引

| 文件 | 说明 |
|------|------|
| `mod.rs` | 模块导出 |
| `file_history.rs` | 文件历史跟踪：备份、快照、恢复、哈希比较 |
| `manager.rs` | Rewind 管理器：协调文件和对话回退、全局实例管理 |

## 核心功能

### FileHistoryManager
- 文件修改跟踪（track/untrack）
- 快照创建和管理
- 基于哈希的文件状态恢复
- 差异计算（insertions/deletions）
- 备份目录大小统计

### RewindManager
- 用户消息记录
- 文件修改记录（单个/批量）
- 回退操作执行（Code/Conversation/Both）
- 回退预览（dry-run）
- 可回退消息列表
- 快照详情查询

### 全局实例管理
- `get_rewind_manager()` - 获取或创建会话的 Rewind 管理器
- `cleanup_rewind_manager()` - 清理指定会话
- `cleanup_all_rewind_managers()` - 清理所有会话

## 测试覆盖

- `test_new_manager` - 管理器创建
- `test_track_file` / `test_untrack_file` - 文件跟踪
- `test_backup_and_snapshot` - 备份和快照
- `test_rewind_to_message` - 回退到指定消息
- `test_rewind_code` - 代码回退
- `test_preview_rewind` - 预览模式
- `test_global_manager` - 全局实例管理
- 等共 20 个测试用例

## 使用示例

```rust
use aster::rewind::{
    RewindManager, RewindOption, SnapshotDetails,
    get_rewind_manager, cleanup_rewind_manager,
};

// 全局实例管理（推荐）
let manager = get_rewind_manager("session-123");

// 记录文件修改和消息
{
    let mut m = manager.write().unwrap();
    m.record_file_changes(&["src/main.rs", "src/lib.rs"]);
    m.record_user_message("msg-1");
}

// 查询快照详情
{
    let m = manager.read().unwrap();
    if let Some(details) = m.get_snapshot_details("msg-1") {
        println!("快照包含 {} 个文件", details.files_count);
    }
}

// 回退到最后一个快照
let result = manager.write().unwrap().rewind_to_last(RewindOption::Code);
if result.success {
    println!("回退成功");
}

// 清理
cleanup_rewind_manager("session-123");
```


