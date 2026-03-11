## ProxyCast v0.84.0

### ✨ 新功能
- 新增 API 网关层架构，将 useTauri 聚合层拆分为独立的 API 模块（appConfig、serverRuntime、logs、experimentalFeatures、channelsRuntime 等）
- 新增 OpenClaw 安装与运行时集成（openclaw_install、OpenClaw 配置/安装/运行页面）
- 新增环境变量管理服务（environment_service），支持 Shell 导入预览与环境变量覆盖
- 新增 Harness 状态面板，实时展示 Agent 运行状态
- 新增 Aster Agent 执行策略与 Web 搜索集成，大幅扩展 Aster 命令能力
- 新增 General Chat 统一消息桥接层（bridge.ts），支持跨模块消息同步
- 新增 Poster 主题系统（themes/poster）
- 新增 Agent 流式传输运行时（agentStream、agentRuntime、agentCompat）
- 新增持久化记忆文件系统（durable_memory_fs）与工具 IO 卸载（tool_io_offload）
- 新增 CI 工作流配置（.github/workflows/ci.yml）
- 新增应用更新检测 API（appUpdate）
- 新增 Sub-Agent 调度器测试覆盖
- 新增 Skill 模型层与技能服务增强

### 🐛 修复
- 修复 Web 搜索运行时 priority 列表包含无效引擎的问题
- 修复 ESLint 导入限制违规：将受限导入从 useTauri 迁移到专用 API 模块
- 修复 SkillsPage 导出非组件函数导致 Fast Refresh 失效的问题
- 修复 OpenClaw 安装候选路径类型复杂度 clippy 警告

### 🔧 优化与重构
- 重构 General Chat 命令层，统一消息处理流程（+1200 行）
- 重构 Aster Agent 命令层，增强执行策略与自动续写能力（+950 行）
- 重构 Agent 会话存储，支持持久化与恢复
- 重构事件转换器，增强流式事件处理
- 重构设置页面 v2 多个子模块（channels、developer、experimental、environment）
- 重构终端 AI 集成与控制器
- 优化 ESLint 配置，新增命令调用与导入来源限制规则
- 优化 Skill 服务与默认技能注册
- 优化 DevBridge 调度器，增强浏览器开发模式兼容性

### 📦 其他
- 更新 Cargo 依赖锁文件
- 更新 AI 提示词文档（aster-integration、content-creator、governance）
- 更新 AI Agent 开发指南

---

**完整变更**: v0.83.2...v0.84.0
