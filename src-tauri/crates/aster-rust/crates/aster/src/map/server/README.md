# 可视化服务器模块

提供代码本体图谱的交互式可视化 Web 服务器。

## 模块结构

| 文件 | 说明 |
|------|------|
| `mod.rs` | 模块入口和导出 |
| `types.rs` | 可视化相关类型定义 |
| `server.rs` | HTTP 服务器实现 |
| `routes.rs` | API 路由处理 |
| `services/` | 业务逻辑服务 |

## services 子目录

| 文件 | 说明 |
|------|------|
| `mod.rs` | 服务模块入口 |
| `architecture.rs` | 架构分析服务 |
| `dependency.rs` | 依赖分析服务 |

## 主要功能

- `VisualizationServer` - 可视化服务器
- `ApiHandlers` - API 处理器集合
- `build_architecture_map` - 构建逻辑架构图
- `get_module_detail` - 获取模块详情
- `get_symbol_refs` - 获取符号引用
- `detect_entry_points` - 检测入口点
- `build_dependency_tree` - 构建依赖树


