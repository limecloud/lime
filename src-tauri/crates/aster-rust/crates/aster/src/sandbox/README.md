# Sandbox 模块

沙箱模块提供进程隔离、文件系统沙箱、网络沙箱和资源限制功能。

## 功能概述

- **进程隔离**: 支持 Bubblewrap (Linux)、Seatbelt (macOS)、Docker、Firejail
- **文件系统沙箱**: 路径访问控制、读写权限管理
- **资源限制**: 内存、CPU、进程数、执行时间限制
- **配置管理**: 预设配置、配置验证、配置合并

## 文件索引

| 文件 | 说明 |
|------|------|
| `mod.rs` | 模块入口，导出公共 API |
| `config.rs` | 沙箱配置、预设、配置管理器 |
| `executor.rs` | 统一执行器，自动选择最佳沙箱 |
| `filesystem.rs` | 文件系统沙箱、路径规则 |
| `resource_limits.rs` | 资源限制器、使用监控 |

## 使用示例

```rust
use aster::sandbox::{
    SandboxConfig, SandboxExecutor, SandboxPreset,
    execute_in_sandbox, detect_best_sandbox,
};

// 使用预设配置
let config = SANDBOX_PRESETS.get(&SandboxPreset::Development).unwrap();

// 执行命令
let result = execute_in_sandbox("ls", &["-la".to_string()], &config).await?;

// 检测最佳沙箱
let best = detect_best_sandbox();
```


