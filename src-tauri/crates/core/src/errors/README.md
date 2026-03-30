# 错误类型模块

定义 Lime 应用中的各种错误类型。

## 文件索引

| 文件 | 说明 |
|------|------|
| `mod.rs` | 模块入口，导出所有错误类型 |
| `project_error.rs` | 项目相关错误类型 |

## 错误类型

### ProjectError
项目操作错误，包括：
- `NotFound` - 项目不存在
- `CannotDeleteDefault` - 无法删除默认项目
- `CannotArchiveDefault` - 无法归档默认项目
- `NameAlreadyExists` - 项目名称已存在
- `DatabaseError` - 数据库错误
- `IoError` - IO 错误

### PersonaError
人设操作错误，包括：
- `NotFound` - 人设不存在
- `ProjectNotFound` - 项目不存在
- `NameAlreadyExists` - 人设名称已存在
- `DatabaseError` - 数据库错误

### MaterialError
素材操作错误，包括：
- `NotFound` - 素材不存在
- `ProjectNotFound` - 项目不存在
- `UnsupportedFileType` - 不支持的文件类型
- `FileTooLarge` - 文件过大
- `FileReadError` - 文件读取失败
- `DatabaseError` - 数据库错误
- `IoError` - IO 错误

### MigrationError
数据迁移错误，包括：
- `MigrationFailed` - 迁移失败
- `DatabaseError` - 数据库错误

## 使用示例

```rust
use crate::errors::{ProjectError, PersonaError};

fn delete_project(id: &str, is_default: bool) -> Result<(), ProjectError> {
    if is_default {
        return Err(ProjectError::CannotDeleteDefault);
    }
    // ...
    Ok(())
}
```

## 相关需求
- Requirements 2.4: 迁移错误处理
- Requirements 11.6: 默认项目保护
