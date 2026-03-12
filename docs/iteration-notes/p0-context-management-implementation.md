# P0: 上下文管理升级实施文档

## 当前状态分析

### 代码结构

1. **session_context_service.rs** (src-tauri/crates/services/src/)
   - 负责 general 模式的上下文管理
   - 使用本地关键词提取生成摘要（第 355-463 行）
   - 支持配置：max_messages、max_characters、summary_threshold

2. **SessionConfigBuilder** (src-tauri/crates/agent/src/aster_state_support.rs)
   - 用于构建 aster Agent 的会话配置
   - 当前字段：id、max_turns、system_prompt、include_context_trace
   - 缺少上下文压缩相关配置

3. **AsterAgentWrapper** (src-tauri/src/agent/aster_agent.rs)
   - 在第 48-50 行创建 SessionConfig
   - 只设置了 `include_context_trace(true)`

### 问题识别

1. **双轨制**：
   - general 模式使用 session_context_service.rs
   - agent 模式使用 aster 框架
   - 两者的上下文管理策略不统一

2. **摘要质量差**：
   - session_context_service.rs 使用硬编码关键词匹配
   - 无法理解语义，摘要质量低

3. **aster 能力未接入**：
   - 不清楚 aster 框架是否内置上下文压缩
   - SessionConfig 未暴露相关配置

## 实施策略

### 策略 A：利用 aster 内置能力（优先）

**前提**：aster 框架已内置上下文压缩和 AI 摘要

**步骤**：
1. 研究 aster 框架文档，确认内置能力
2. 扩展 SessionConfigBuilder，暴露配置接口
3. 在 AsterAgentWrapper 中配置上下文压缩参数
4. 将 general 模式迁移到 aster 框架（与 P1 任务关联）

**优点**：
- 复用 aster 的成熟实现
- 统一 agent 和 general 模式的上下文管理
- 减少维护成本

**缺点**：
- 依赖 aster 框架的能力
- 需要等待 P1 任务完成（general 模式迁移）

### 策略 B：在 ProxyCast 层实现（备选）

**前提**：aster 框架不支持或支持不足

**步骤**：
1. 改造 session_context_service.rs，实现 AI 摘要
2. 创建 LLM Provider 抽象，调用 AI 模型生成摘要
3. 实现渐进式工具响应移除策略
4. 为 aster Agent 创建类似的上下文管理服务

**优点**：
- 完全可控，不依赖外部框架
- 可以针对 ProxyCast 的场景优化

**缺点**：
- 需要自己实现和维护
- 代码量大，开发周期长
- 可能与 aster 框架的内置能力冲突

## 下一步行动

### 立即执行

1. **研究 aster 框架**：
   - 查看 aster-rust GitHub 仓库文档
   - 搜索 context、compression、summary 相关代码
   - 确认是否有内置的上下文压缩能力

2. **决策路径**：
   - 如果 aster 有内置能力 → 采用策略 A
   - 如果 aster 没有或不足 → 采用策略 B

### 待确认问题

1. aster 框架的 SessionConfig 支持哪些字段？
2. aster 是否有 context_mgmt 模块？（研究报告提到）
3. aster 的 AI 摘要是如何实现的？
4. aster 的渐进式工具响应移除是如何配置的？

## 验证计划

### 单元测试

- [ ] 测试 AI 摘要生成逻辑
- [ ] 测试摘要缓存机制
- [ ] 测试降级到本地摘要的逻辑

### 集成测试

- [ ] 发起 20+ 轮长对话
- [ ] 验证 AI 摘要在 80% token 使用率时触发
- [ ] 对比 AI 摘要与本地摘要的质量
- [ ] 验证工具响应的渐进式移除

### 性能测试

- [ ] 测试摘要生成的延迟
- [ ] 评估 API 调用成本
- [ ] 测试缓存命中率

## 风险与缓解

### 风险 1：aster 框架能力不足

**缓解**：准备策略 B 作为备选方案

### 风险 2：AI 摘要成本过高

**缓解**：
- 实现智能缓存策略
- 提供本地摘要作为降级方案
- 允许用户配置是否启用 AI 摘要

### 风险 3：与 P1 任务的依赖关系

**缓解**：
- P0 和 P1 可以并行推进
- P0 先在 agent 模式验证，P1 完成后再统一

## 参考资料

- 研究报告：ProxyCast AI Agent 改进研究报告
- aster-rust GitHub: https://github.com/astercloud/aster-rust
- 相关文件：
  - src-tauri/crates/services/src/session_context_service.rs
  - src-tauri/crates/agent/src/aster_state_support.rs
  - src-tauri/src/agent/aster_agent.rs
