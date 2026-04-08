# 代码搜索模块 🟢

> 成熟度: 🟢 稳定 | 测试覆盖: 40 个测试用例

提供 ripgrep 集成的代码搜索功能。

## 文件索引

| 文件 | 说明 |
|------|------|
| `mod.rs` | 模块导出 |
| `ripgrep.rs` | Ripgrep 集成：搜索、文件列表、版本管理 |

## 核心功能

### 搜索功能
- `search()` - 异步搜索
- `search_sync()` - 同步搜索
- `list_files()` - 列出文件

### Ripgrep 管理
- `get_rg_path()` - 获取可用的 ripgrep 路径
- `is_ripgrep_available()` - 检查是否可用
- `get_ripgrep_version()` - 获取版本
- `download_vendored_rg()` - 下载内置版本
- `ensure_ripgrep_available()` - 确保可用

## 使用示例

```rust
use aster::search::{search, RipgrepOptions, ensure_ripgrep_available};

// 确保 ripgrep 可用
ensure_ripgrep_available().await?;

// 搜索代码
let options = RipgrepOptions {
    pattern: "fn main".to_string(),
    glob: Some("*.rs".to_string()),
    ignore_case: true,
    ..Default::default()
};

let result = search(options).await?;
for m in result.matches {
    println!("{}:{}: {}", m.path, m.line_number, m.line_content);
}
```
