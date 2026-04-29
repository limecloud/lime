//! AI 驱动的会话摘要服务
//!
//! 使用 AI 模型生成高质量的会话摘要，提取关键主题和重要决策

use lime_core::general_chat::{ChatMessage, MessageRole};
use serde::{Deserialize, Serialize};

/// AI 摘要请求
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AISummaryRequest {
    /// 要摘要的消息列表
    pub messages: Vec<ChatMessage>,
    /// 最大摘要长度（字符数）
    pub max_summary_length: usize,
}

/// AI 摘要响应
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AISummaryResponse {
    /// 摘要内容
    pub summary: String,
    /// 关键主题列表
    pub key_topics: Vec<String>,
    /// 重要决策列表
    pub decisions: Vec<String>,
}

/// AI 摘要服务配置
#[derive(Debug, Clone)]
pub struct AISummaryConfig {
    /// 摘要最大长度
    pub max_summary_length: usize,
    /// 最大关键主题数量
    pub max_topics: usize,
    /// 最大决策数量
    pub max_decisions: usize,
    /// 使用的模型
    pub model: String,
}

impl Default for AISummaryConfig {
    fn default() -> Self {
        Self {
            max_summary_length: 500,
            max_topics: 5,
            max_decisions: 3,
            model: "claude-haiku-4".to_string(),
        }
    }
}

/// AI 摘要服务
///
/// 使用 Lime current model runtime 生成摘要。
pub struct AISummaryService {
    config: AISummaryConfig,
}

impl AISummaryService {
    /// 创建新的 AI 摘要服务
    pub fn new(config: AISummaryConfig) -> Self {
        Self { config }
    }

    /// 生成会话摘要
    ///
    /// # 参数
    /// - `messages`: 要摘要的消息列表
    ///
    /// # 返回
    /// - `Ok(AISummaryResponse)`: 摘要成功
    /// - `Err(String)`: 摘要失败
    pub async fn generate_summary(
        &self,
        messages: &[ChatMessage],
    ) -> Result<AISummaryResponse, String> {
        if messages.is_empty() {
            return Err("消息列表为空，无法生成摘要".to_string());
        }

        // 1. 构建摘要提示词
        let prompt = self.build_summary_prompt(messages);

        // 2. 调用摘要模型（当前为本地 stub，真实调用必须走 API Key Provider / model registry 主路径）
        let response = self.call_summary_model_stub(&prompt).await?;

        // 3. 解析响应
        self.parse_summary_response(&response)
    }

    /// 构建摘要提示词
    fn build_summary_prompt(&self, messages: &[ChatMessage]) -> String {
        let formatted_messages = self.format_messages(messages);

        format!(
            r#"请为以下对话生成简洁的摘要。

对话内容：
{}

要求：
1. 摘要长度不超过 {} 字
2. 提取 {}-{} 个关键主题
3. 总结 {}-{} 个重要决策或结论
4. 保留技术细节和专业术语

请按以下 JSON 格式返回：
{{
  "summary": "摘要内容",
  "key_topics": ["主题1", "主题2", ...],
  "decisions": ["决策1", "决策2", ...]
}}"#,
            formatted_messages,
            self.config.max_summary_length,
            1,
            self.config.max_topics,
            0,
            self.config.max_decisions
        )
    }

    /// 格式化消息列表为文本
    fn format_messages(&self, messages: &[ChatMessage]) -> String {
        messages
            .iter()
            .map(|msg| {
                let role = match msg.role {
                    MessageRole::User => "用户",
                    MessageRole::Assistant => "助手",
                    MessageRole::System => "系统",
                };
                format!("[{}]: {}", role, msg.content)
            })
            .collect::<Vec<_>>()
            .join("\n\n")
    }

    /// 调用摘要模型（临时 stub 实现）
    ///
    /// TODO: 接入 Lime current API Key Provider / model registry runtime。
    async fn call_summary_model_stub(&self, _prompt: &str) -> Result<String, String> {
        // 临时返回 stub 数据，后续接入真实的模型调用。
        Ok(r#"{
  "summary": "本次对话主要讨论了 Lime AI Agent 的上下文管理改进方案，包括引入 AI 驱动的摘要生成、渐进式工具响应移除等策略。",
  "key_topics": ["上下文管理", "AI 摘要", "工具响应移除", "性能优化"],
  "decisions": ["采用分阶段混合策略", "优先使用 AI 摘要，失败时降级到本地摘要"]
}"#.to_string())
    }

    /// 解析摘要响应
    fn parse_summary_response(&self, response: &str) -> Result<AISummaryResponse, String> {
        // 尝试解析 JSON 响应
        serde_json::from_str::<AISummaryResponse>(response)
            .map_err(|e| format!("解析摘要响应失败: {}", e))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_messages() -> Vec<ChatMessage> {
        vec![
            ChatMessage {
                id: "msg-1".to_string(),
                session_id: "test-session".to_string(),
                role: MessageRole::User,
                content: "你好，我想了解 Lime 的上下文管理功能".to_string(),
                blocks: None,
                status: "complete".to_string(),
                created_at: 1000,
                metadata: None,
            },
            ChatMessage {
                id: "msg-2".to_string(),
                session_id: "test-session".to_string(),
                role: MessageRole::Assistant,
                content: "Lime 的上下文管理包括消息历史管理、智能摘要生成等功能".to_string(),
                blocks: None,
                status: "complete".to_string(),
                created_at: 2000,
                metadata: None,
            },
        ]
    }

    #[test]
    fn test_format_messages() {
        let service = AISummaryService::new(AISummaryConfig::default());
        let messages = create_test_messages();
        let formatted = service.format_messages(&messages);

        assert!(formatted.contains("[用户]"));
        assert!(formatted.contains("[助手]"));
        assert!(formatted.contains("Lime"));
    }

    #[test]
    fn test_build_summary_prompt() {
        let service = AISummaryService::new(AISummaryConfig::default());
        let messages = create_test_messages();
        let prompt = service.build_summary_prompt(&messages);

        assert!(prompt.contains("摘要"));
        assert!(prompt.contains("关键主题"));
        assert!(prompt.contains("JSON"));
    }

    #[tokio::test]
    async fn test_generate_summary_mock() {
        let service = AISummaryService::new(AISummaryConfig::default());
        let messages = create_test_messages();

        let result = service.generate_summary(&messages).await;
        assert!(result.is_ok());

        let summary = result.unwrap();
        assert!(!summary.summary.is_empty());
        assert!(!summary.key_topics.is_empty());
    }

    #[tokio::test]
    async fn test_generate_summary_empty_messages() {
        let service = AISummaryService::new(AISummaryConfig::default());
        let messages = vec![];

        let result = service.generate_summary(&messages).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("消息列表为空"));
    }
}
