# plugin

<!-- 一旦我所属的文件夹有所变化，请更新我 -->

## 架构说明

插件系统模块，提供插件扩展功能：
- 插件加载和初始化
- 请求前/响应后钩子
- 插件隔离和错误处理
- 插件配置管理
- 二进制组件下载和管理
- 声明式插件 UI 系统（基于 A2UI 设计理念）

## 文件索引

- `mod.rs` - 模块入口和导出
- `types.rs` - 核心类型定义（Plugin trait、PluginContext 等）
- `loader.rs` - 插件加载器
- `manager.rs` - 插件管理器（生命周期、钩子执行）
- `binary_downloader.rs` - 二进制组件下载管理
- `ui_types.rs` - 插件 UI 类型定义（组件、消息、数据绑定）
- `ui_trait.rs` - 插件 UI Trait 定义
- `ui_builder.rs` - UI 构建器辅助 API
- `ui_events.rs` - UI 事件推送（Tauri 事件）
- `examples/` - 示例插件占位；旧凭证池状态示例已随凭证池退役删除
- `tests.rs` - 单元测试

## 插件 UI 系统

基于 A2UI 设计理念的声明式 UI 系统：

- **安全如数据**：插件只能声明 UI 结构，不能执行任意代码
- **组件白名单**：预定义可用组件集（Row, Column, Card, Text, Button 等）
- **数据绑定分离**：UI 结构与数据模型分离，支持增量更新

### 使用示例

```rust
use crate::plugin::{
    SurfaceDefinition, ComponentDef, ChildrenDef, 
    BoundValue, Action, ComponentType, ColumnProps,
};
use serde_json::json;

// 创建 Surface 定义
let surface = SurfaceDefinition {
    surface_id: "my-plugin-ui".into(),
    root_id: "root".into(),
    initial_components: vec![
        ComponentDef::column("root", ChildrenDef::explicit(vec!["title", "content"])),
        ComponentDef::text_literal("title", "插件标题"),
        ComponentDef::text_bound("content", "/data/message"),
    ],
    initial_data: json!({
        "data": {
            "message": "Hello from plugin!"
        }
    }),
    styles: None,
};
```

## 更新提醒

任何文件变更后，请更新此文档和相关的上级文档。
