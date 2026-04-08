# 诊断和健康检查模块 🟢

> 成熟度: 🟢 稳定 | 测试覆盖: 31 个测试用例

提供系统健康检查、故障排除功能。

## 文件索引

| 文件 | 说明 |
|------|------|
| `mod.rs` | 模块导出 |
| `checker.rs` | 诊断检查器：Git、Ripgrep、内存、环境变量等检查 |
| `report.rs` | 诊断报告：生成和格式化报告 |
| `network.rs` | 网络检查：API 连通性、代理配置、SSL 证书 |
| `system.rs` | 系统检查：CPU 负载、会话目录、缓存、MCP 服务器 |
| `health.rs` | 健康评分：健康状态评估、自动修复功能 |

## 核心功能

### DiagnosticChecker
- Git 可用性检查
- Ripgrep 可用性检查
- 磁盘空间检查
- 文件权限检查
- 内存使用检查
- 环境变量检查

### NetworkChecker
- API 连通性检查（Anthropic, OpenAI）
- 网络连接检查
- 代理配置检查
- SSL 证书检查

### SystemChecker
- CPU 负载检查
- 会话目录检查
- 缓存目录检查
- MCP 服务器配置检查

### HealthSummary
- 健康评分（0-100）
- 健康状态（Healthy/Degraded/Unhealthy）
- 关键问题列表

### AutoFixer
- 自动修复目录问题
- 修复结果报告

## 使用示例

```rust
use aster::diagnostics::{
    run_diagnostics, quick_health_check, 
    DiagnosticReport, DiagnosticOptions,
    HealthSummary, AutoFixer,
};

// 快速健康检查
let (healthy, issues) = quick_health_check().await;

// 完整诊断报告
let options = DiagnosticOptions { verbose: true, ..Default::default() };
let report = DiagnosticReport::generate(&options);

// 健康评分
let summary = HealthSummary::from_report(&report);
println!("健康评分: {}", summary.score);

// 自动修复
let fix_result = AutoFixer::auto_fix(&report);
```


