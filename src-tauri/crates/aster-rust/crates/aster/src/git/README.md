# Git 工具模块

提供 Git 状态检测、分支信息、安全检查等功能。

## 文件索引

| 文件 | 说明 |
|------|------|
| `mod.rs` | 模块导出 |
| `core.rs` | Git 核心工具：状态检测、分支信息、提交记录 |
| `safety.rs` | Git 安全检查：危险命令检测、敏感文件检查 |

## 核心功能

### GitStatus / GitInfo
- 工作区状态检测
- 已追踪/未追踪文件列表
- 当前分支、默认分支
- 远程 URL、提交哈希

### GitSafety
- 危险命令检测 (force push, reset --hard, clean -f 等)
- 强制推送到 main/master 保护
- 敏感文件检查 (.env, credentials.json 等)
- 跳过钩子检测 (--no-verify)
- Git 配置修改检测

## 使用示例

```rust
use aster::git::{is_git_repository, get_git_info, GitSafety};

// 检查是否在 Git 仓库中
if is_git_repository(Path::new(".")) {
    // 获取完整 Git 信息
    if let Some(info) = get_git_info(Path::new(".")) {
        println!("分支: {}", info.branch_name);
    }
}

// 安全检查
let result = GitSafety::comprehensive_check(
    "git push --force",
    Some("main"),
    None,
);
if !result.safe {
    println!("危险: {}", result.reason.unwrap());
}
```


