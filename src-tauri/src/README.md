# src

<!-- 一旦我所属的文件夹有所变化，请更新我 -->

## 架构说明

Tauri 后端核心代码，处理系统级功能和 API 服务。
使用 Rust 实现高性能的代理、认证和流量监控逻辑。

## 文件索引

- `commands/` - Tauri 命令处理（前端调用入口）
- `config/` - 配置管理（导入/导出/热重载）
- `connect/` - Lime Connect 模块（中转商生态合作）
- `converter/` - 协议转换（OpenAI ↔ CW/Claude/Antigravity）
- `credential/` - 凭证池管理（负载均衡、健康检查）
- `database/` - 数据库层（SQLite + DAO）
- `errors/` - 错误类型定义（项目、人设、素材、模板、迁移错误）
- `flow_monitor/` - LLM 流量监控（拦截、存储、查询）
- `injection/` - 请求注入（系统提示词等）
- `middleware/` - HTTP 中间件
- `models/` - 数据模型定义
- `plugin/` - 插件系统（含声明式 UI 系统）
- `processor/` - 请求处理管道
- `providers/` - 各 Provider 的认证和 API 实现
- `proxy/` - HTTP 代理客户端
- `resilience/` - 弹性策略（重试、超时、故障转移）
- `router/` - 请求路由（模型映射、规则匹配）
- `server/` - HTTP 服务器（OpenAI/Claude 兼容 API）
- `services/` - 业务服务层
  - 包含更新提醒独立窗口（底部 Toast）管理能力
  - 更新检查支持提醒频控（同版本 24h 一次、关闭退避）与埋点计数
- `streaming/` - 流式响应处理
- `telemetry/` - 遥测和统计
- `terminal/` - 已移除的终端历史模块（仅保留治理语义，不再参与编译）
- `tray/` - 系统托盘
- `websocket/` - WebSocket 支持
- `workspace/` - Workspace 工作目录管理
- `lib.rs` - 库入口
- `main.rs` - 应用入口
- `logger.rs` - 日志配置
- `server_utils.rs` - 服务器工具函数

## 更新提醒

任何文件变更后，请更新此文档和相关的上级文档。
