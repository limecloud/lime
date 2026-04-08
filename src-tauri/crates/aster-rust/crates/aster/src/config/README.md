# config

<!-- 一旦我所属的文件夹有所变化，请更新我 -->

## 架构说明

配置管理模块，提供多源配置合并、来源追踪、热重载、备份恢复等功能。

### 配置优先级（从低到高）

1. `default` - 内置默认值
2. `userSettings` - 用户全局配置 (~/.aster/settings.yaml)
3. `projectSettings` - 项目配置 (.aster/settings.yaml)
4. `localSettings` - 本地配置 (.aster/settings.local.yaml)
5. `envSettings` - 环境变量 (ASTER_*)
6. `flagSettings` - 命令行标志
7. `policySettings` - 企业策略（最高优先级）

## 文件索引

| 文件 | 说明 |
|------|------|
| `mod.rs` | 模块入口和导出 |
| `agents_md_parser.rs` | AGENTS.md 解析器，注入系统提示 |
| `aster_mode.rs` | Aster 运行模式定义 |
| `base.rs` | 基础配置结构和 YAML/Keyring 存储 |
| `config_command.rs` | /config 命令处理器 |
| `config_manager.rs` | 增强版配置管理器（多源合并、来源追踪） |
| `declarative_providers.rs` | 声明式 Provider 配置 |
| `experiments.rs` | 实验功能管理 |
| `extensions.rs` | 扩展配置管理 |
| `paths.rs` | 路径配置 |
| `permission.rs` | 权限管理 |
| `search_path.rs` | 搜索路径配置 |
| `signup_openrouter/` | OpenRouter 注册配置 |
| `signup_tetrate/` | Tetrate 注册配置 |

## 更新提醒

任何文件变更后，请更新此文档和相关的上级文档。
