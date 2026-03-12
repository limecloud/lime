# P0 实施方案：分阶段升级上下文管理

## 决策：采用混合策略

基于当前分析，我决定采用**分阶段混合策略**：

### 阶段 1：快速改进（本次实施）
在 session_context_service.rs 中实现 AI 驱动的摘要，作为立即可用的改进。

### 阶段 2：架构统一（P1 完成后）
将 general 模式迁移到 aster 框架，统一上下文管理策略。

## 阶段 1 实施细节

### 1.1 创建 AI 摘要服务

创建新文件：`src-tauri/crates/services/src/ai_summary_service.rs`

```rust
//! AI 驱动的会话摘要服务

use proxycast_core::general_chat::ChatMessage;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AISummaryRequest {
    pub messages: Vec<ChatMessage>,
    pub max_summary_length: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AISummaryResponse {
    pub summary: String,
    pub key_topics: Vec<String>,
    pub decisions: Vec<String>,
}

pub struct AISummaryService {
    // 使用 ProxyCast 的 provider pool
    provider_pool: Arc<ProviderPoolService>,
}

impl AISummaryService {
    pub async fn generate_summary(
        &self,
        request: AISummaryRequest,
    ) -> Result<AISummaryResponse, String> {
        // 1. 构建摘要提示词
        let prompt = self.build_summary_prompt(&request.messages);

        // 2. 调用 AI 模型
        let response = self.call_llm(&prompt).await?;

        // 3. 解析响应
        self.parse_summary_response(&response)
    }

    fn build_summary_prompt(&self, messages: &[ChatMessage]) -> String {
        format!(
            "请为以下对话生成简洁的摘要（不超过 {} 字）：\n\n{}\n\n要求：\n1. 提取关键主题（3-5个）\n2. 总结重要决策\n3. 保留技术细节",
            500,
            self.format_messages(messages)
        )
    }
}
```

### 1.2 改造 session_context_service.rs

修改 `create_summary()` 方法：

```rust
/// 创建会话摘要（优先使用 AI，失败时降级到本地）
async fn create_summary(
    &self,
    session_id: &str,
    messages: &[ChatMessage],
) -> Result<SessionSummary, String> {
    // 尝试使用 AI 摘要
    if let Some(ai_service) = &self.ai_summary_service {
        match ai_service.generate_summary(messages).await {
            Ok(ai_summary) => {
                return Ok(SessionSummary {
                    session_id: session_id.to_string(),
                    summary: ai_summary.summary,
                    key_topics: ai_summary.key_topics,
                    decisions: ai_summary.decisions,
                    created_at: chrono::Utc::now().timestamp_millis(),
                    message_count: messages.len() as i32,
                    last_message_id: messages.last().unwrap().id.clone(),
                });
            }
            Err(e) => {
                tracing::warn!("AI 摘要生成失败，降级到本地摘要: {}", e);
            }
        }
    }

    // 降级到本地关键词提取
    self.create_summary_local(session_id, messages)
}

/// 本地关键词提取摘要（保留作为降级方案）
fn create_summary_local(
    &self,
    session_id: &str,
    messages: &[ChatMessage],
) -> Result<SessionSummary, String> {
    // 原有的本地摘要逻辑
    // ...
}
```

### 1.3 配置注入

修改 `SessionContextService` 构造函数：

```rust
pub struct SessionContextService {
    db_connection: Arc<Mutex<Connection>>,
    config: ContextWindowConfig,
    summary_cache: Arc<Mutex<HashMap<String, SessionSummary>>>,
    ai_summary_service: Option<Arc<AISummaryService>>, // 新增
}

impl SessionContextService {
    pub fn new(
        db_connection: Arc<Mutex<Connection>>,
        config: ContextWindowConfig,
        ai_summary_service: Option<Arc<AISummaryService>>,
    ) -> Self {
        Self {
            db_connection,
            config,
            summary_cache: Arc::new(Mutex::new(HashMap::new())),
            ai_summary_service,
        }
    }
}
```

## 实施步骤

### Step 1: 创建 AI 摘要服务 ✅
- [ ] 创建 `ai_summary_service.rs`
- [ ] 实现 `generate_summary()` 方法
- [ ] 实现提示词构建逻辑
- [ ] 实现响应解析逻辑

### Step 2: 改造 session_context_service.rs ✅
- [ ] 添加 `ai_summary_service` 字段
- [ ] 修改 `create_summary()` 为异步方法
- [ ] 实现 AI 摘要优先、本地降级的逻辑
- [ ] 保留 `create_summary_local()` 作为降级方案

### Step 3: 集成到命令层 ✅
- [ ] 在 Tauri 命令初始化时创建 `AISummaryService`
- [ ] 注入到 `SessionContextService`
- [ ] 更新相关的 Tauri 命令

### Step 4: 测试验证 ✅
- [ ] 编写单元测试
- [ ] 编写集成测试
- [ ] 手动测试 20+ 轮对话
- [ ] 验证降级逻辑

## 成本控制

### 摘要触发策略
- 只在消息数量超过 `summary_threshold`（默认 30）时触发
- 摘要结果缓存，避免重复生成
- 提供配置开关，允许用户禁用 AI 摘要

### API 调用优化
- 使用较小的模型（如 Claude Haiku）生成摘要
- 限制摘要长度（500 字以内）
- 批量处理多个会话的摘要请求

## 验证指标

### 质量指标
- AI 摘要的信息保留率 > 80%
- 关键主题提取准确率 > 90%
- 用户满意度评分 > 4/5

### 性能指标
- 摘要生成延迟 < 3 秒
- 缓存命中率 > 70%
- API 调用成本 < $0.01/会话

### 可靠性指标
- 降级成功率 100%
- AI 摘要失败时不影响对话流程
- 错误日志完整，便于排查

## 风险缓解

### 风险 1：AI 摘要质量不稳定
**缓解措施**：
- 精心设计提示词，包含明确的格式要求
- 实现响应验证逻辑，拒绝低质量摘要
- 提供用户反馈机制，持续优化提示词

### 风险 2：API 调用失败
**缓解措施**：
- 实现重试机制（最多 3 次）
- 降级到本地摘要，确保功能可用
- 记录详细的错误日志

### 风险 3：成本超预期
**缓解措施**：
- 实现智能缓存策略
- 提供配置开关，允许用户控制
- 监控 API 调用量，设置告警阈值

## 后续优化（阶段 2）

在 P1 任务完成后：
1. 将 general 模式迁移到 aster 框架
2. 统一 agent 和 general 的上下文管理
3. 利用 aster 的渐进式工具响应移除能力
4. 实现更智能的上下文压缩策略

## 参考资料

- 研究报告：ProxyCast AI Agent 改进研究报告
- Codex 上下文压缩：AI 摘要 + 保留最近消息
- aster 上下文管理：渐进式工具响应移除 + 摘要
