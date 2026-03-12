# 上下文管理升级方案

## 问题分析

### 当前状态

1. **session_context_service.rs** 使用本地关键词提取
   - `create_summary()` 方法（第 355-418 行）使用硬编码关键词匹配
   - 摘要质量差，无法理解语义
   - 不支持 AI 驱动的智能压缩

2. **SessionConfigBuilder** 缺少上下文配置
   - 只有 `max_turns`、`system_prompt`、`include_context_trace`
   - 没有暴露 token 限制、压缩策略等配置

3. **aster 框架能力未接入**
   - aster 有渐进式工具响应移除能力
   - aster 支持 AI 摘要
   - ProxyCast 未正确配置和使用这些能力

## 改进方案

### 阶段 1：扩展 SessionConfigBuilder

在 `src-tauri/crates/agent/src/aster_state_support.rs` 中扩展 `SessionConfigBuilder`：

```rust
pub struct SessionConfigBuilder {
    id: String,
    max_turns: Option<u32>,
    system_prompt: Option<String>,
    include_context_trace: Option<bool>,
    // 新增：上下文压缩配置
    max_context_tokens: Option<usize>,
    context_compression_threshold: Option<f32>,
    enable_ai_summary: Option<bool>,
    tool_response_retention_strategy: Option<ToolResponseRetentionStrategy>,
}

pub enum ToolResponseRetentionStrategy {
    KeepAll,
    Progressive { stages: Vec<f32> }, // 0.0, 0.1, 0.2, 0.5, 1.0
    RemoveAfterTurns(usize),
}
```

### 阶段 2：改造 session_context_service.rs

将 `create_summary()` 方法改为调用 AI 模型生成摘要：

```rust
async fn create_summary_with_ai(
    &self,
    session_id: &str,
    messages: &[ChatMessage],
    provider: &dyn LLMProvider,
) -> Result<SessionSummary, String> {
    // 构建摘要提示词
    let summary_prompt = build_summary_prompt(messages);

    // 调用 AI 模型生成摘要
    let summary_response = provider
        .complete(&summary_prompt)
        .await
        .map_err(|e| format!("AI 摘要生成失败: {e}"))?;

    // 解析摘要结果
    parse_summary_response(&summary_response)
}
```

### 阶段 3：集成到 Aster Agent 初始化

在 `aster_agent_cmd.rs` 中配置上下文压缩：

```rust
let session_config = SessionConfigBuilder::new(&session_id)
    .system_prompt(system_prompt)
    .max_context_tokens(100_000) // Claude 的上下文窗口
    .context_compression_threshold(0.8) // 80% 时触发压缩
    .enable_ai_summary(true)
    .tool_response_retention_strategy(
        ToolResponseRetentionStrategy::Progressive {
            stages: vec![0.0, 0.1, 0.2, 0.5, 1.0]
        }
    )
    .build();
```

## 验证方式

1. **单元测试**：测试 AI 摘要生成逻辑
2. **集成测试**：发起 20+ 轮长对话，验证：
   - AI 摘要是否在 80% token 使用率时触发
   - 摘要质量是否优于本地关键词提取
   - 工具响应是否按渐进式策略移除
3. **性能测试**：测试摘要生成的延迟和成本

## 实施步骤

1. ✅ 分析当前代码结构
2. ⬜ 扩展 SessionConfigBuilder
3. ⬜ 实现 AI 摘要生成逻辑
4. ⬜ 改造 session_context_service.rs
5. ⬜ 集成到 aster_agent_cmd.rs
6. ⬜ 编写单元测试
7. ⬜ 进行集成测试
8. ⬜ 性能优化和调优

## 注意事项

1. **向后兼容**：保留本地关键词提取作为降级方案
2. **成本控制**：AI 摘要会产生额外的 API 调用成本
3. **缓存策略**：摘要结果应该缓存，避免重复生成
4. **错误处理**：AI 摘要失败时应优雅降级到本地摘要
