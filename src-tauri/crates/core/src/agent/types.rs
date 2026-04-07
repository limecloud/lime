//! Agent 类型定义
//!
//! 定义 Agent 模块使用的核心类型
//! 参考 aster 项目的 Conversation 设计，支持连续对话和工具调用

use crate::models::provider_type::is_custom_provider_id;
use serde::{Deserialize, Serialize};

/// Provider 类型枚举
///
/// 决定使用哪种 API 协议
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum ProviderType {
    /// Claude (Anthropic 协议)
    Claude,
    /// Claude OAuth (Anthropic 协议)
    ClaudeOauth,
    /// Anthropic 兼容格式（支持 system 数组格式等变体）
    AnthropicCompatible,
    /// Kiro/CodeWhisperer (AWS Event Stream 协议)
    Kiro,
    /// Gemini (Gemini 协议)
    Gemini,
    /// OpenAI 及其兼容服务 (默认)
    #[default]
    OpenAI,
    /// 通义千问 (OpenAI 兼容)
    Qwen,
    /// Codex (OpenAI 兼容)
    Codex,
    /// Antigravity (OpenAI 兼容)
    Antigravity,
    /// iFlow (OpenAI 兼容)
    IFlow,
}

impl ProviderType {
    /// 从字符串解析 provider 类型
    pub fn parse(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "claude" | "anthropic" => Self::Claude,
            "claude_oauth" => Self::ClaudeOauth,
            "anthropic_compatible" | "anthropic-compatible" => Self::AnthropicCompatible,
            "kiro" => Self::Kiro,
            "gemini" | "gemini_api_key" => Self::Gemini,
            "openai" => Self::OpenAI,
            "qwen" => Self::Qwen,
            "codex" => Self::Codex,
            "antigravity" => Self::Antigravity,
            "iflow" => Self::IFlow,
            _ => Self::OpenAI, // 默认使用 OpenAI 协议
        }
    }

    /// 从 provider 字符串和模型名称推断 provider 类型
    ///
    /// 对于自定义 Provider ID（如 custom-xxx），不做协议推断。
    /// 真实协议应由 API Key Provider 的 `type`（即 ApiProviderType）在运行时决定。
    pub fn from_provider_and_model(provider: &str, model: &str) -> Self {
        // 首先检查是否是自定义 Provider ID（以 custom- 开头）
        if is_custom_provider_id(provider) {
            // 不对 custom-* 做协议猜测，避免与 DB 中真实 Provider 类型不一致
            return Self::OpenAI;
        }

        // 对于其他 Provider，尝试直接解析
        let provider_type = Self::parse(provider);

        // 如果能被识别，直接返回
        if !matches!(provider_type, Self::OpenAI) || provider.eq_ignore_ascii_case("openai") {
            return provider_type;
        }

        // 对于标准 Provider (kiro/openai/claude/gemini 等)，尝试从模型名称推断协议类型
        let model_lower = model.to_lowercase();

        // Claude 模型使用 Anthropic 协议
        if model_lower.starts_with("claude-") || model_lower.starts_with("anthropic-") {
            return Self::Claude;
        }

        // Gemini 模型
        if model_lower.starts_with("gemini") || model_lower.contains("gemini") {
            return Self::Gemini;
        }

        // 默认使用 OpenAI 协议
        Self::OpenAI
    }

    /// 获取 API 端点路径
    pub fn endpoint(&self) -> &'static str {
        match self {
            Self::Claude | Self::ClaudeOauth | Self::AnthropicCompatible => "/v1/messages",
            Self::Kiro => "/v1/chat/completions", // Kiro 使用 OpenAI 兼容格式，但后端会转换
            Self::Gemini => "/v1/gemini/chat/completions",
            _ => "/v1/chat/completions",
        }
    }

    /// 是否使用 Anthropic 协议
    pub fn is_anthropic(&self) -> bool {
        matches!(
            self,
            Self::Claude | Self::ClaudeOauth | Self::AnthropicCompatible
        )
    }

    /// 是否使用 Anthropic 兼容格式（system 为数组格式）
    pub fn uses_array_system_format(&self) -> bool {
        matches!(self, Self::AnthropicCompatible)
    }

    /// 是否使用 OpenAI 兼容协议
    pub fn is_openai_compatible(&self) -> bool {
        matches!(
            self,
            Self::OpenAI | Self::Qwen | Self::Codex | Self::Antigravity | Self::IFlow | Self::Kiro
        )
    }
}

#[cfg(test)]
mod tests {
    use super::{ProviderType, DEFAULT_SYSTEM_PROMPT};

    #[test]
    fn test_custom_provider_does_not_force_anthropic_protocol() {
        assert_eq!(
            ProviderType::from_provider_and_model(
                "custom-ba4e7574-dd00-4784-945a-0f383dfa1272",
                "claude-sonnet-4-5"
            ),
            ProviderType::OpenAI
        );
    }

    #[test]
    fn test_unknown_provider_still_supports_model_based_inference() {
        assert_eq!(
            ProviderType::from_provider_and_model("unknown-provider", "claude-3-7-sonnet"),
            ProviderType::Claude
        );
        assert_eq!(
            ProviderType::from_provider_and_model("unknown-provider", "gemini-2.5-pro"),
            ProviderType::Gemini
        );
    }

    #[test]
    fn test_default_system_prompt_mentions_web_tools() {
        assert!(DEFAULT_SYSTEM_PROMPT.contains("WebSearch"));
        assert!(DEFAULT_SYSTEM_PROMPT.contains("WebFetch"));
    }

    #[test]
    fn test_default_system_prompt_requires_authorization_for_local_ops_only() {
        assert!(DEFAULT_SYSTEM_PROMPT.contains("本地操作需授权"));
        assert!(DEFAULT_SYSTEM_PROMPT.contains("实时信息"));
    }
}

/// Agent 会话状态
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentSession {
    /// 会话 ID
    pub id: String,
    /// 使用的模型
    pub model: String,
    /// 会话消息历史（支持连续对话）
    pub messages: Vec<AgentMessage>,
    /// 系统提示词
    pub system_prompt: Option<String>,
    /// 会话标题（可选，用于 UI 显示）
    pub title: Option<String>,
    /// 会话工作目录（对应 Workspace.root_path）
    pub working_dir: Option<String>,
    /// 会话执行策略（react / code_orchestrated / auto）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub execution_strategy: Option<String>,
    /// 创建时间
    pub created_at: String,
    /// 最后活动时间
    pub updated_at: String,
}

/// Agent 消息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentMessage {
    /// 角色: user, assistant, system, tool
    pub role: String,
    /// 消息内容（文本或结构化内容）
    pub content: MessageContent,
    /// 时间戳
    pub timestamp: String,
    /// 工具调用（assistant 消息可能包含）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<ToolCall>>,
    /// 工具调用 ID（tool 角色消息需要）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
    /// 推理内容（DeepSeek R1 等模型的思维链内容）
    /// DeepSeek Reasoner 在 Tool Calls 场景下要求此字段
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning_content: Option<String>,
    /// 当前消息的 token 使用量
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage: Option<TokenUsage>,
}

/// 消息内容类型
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum MessageContent {
    /// 纯文本
    Text(String),
    /// 多部分内容（文本 + 图片）
    Parts(Vec<ContentPart>),
}

impl MessageContent {
    /// 获取文本内容
    pub fn as_text(&self) -> String {
        match self {
            MessageContent::Text(s) => s.clone(),
            MessageContent::Parts(parts) => parts
                .iter()
                .filter_map(|p| match p {
                    ContentPart::Text { text } => Some(text.clone()),
                    _ => None,
                })
                .collect::<Vec<_>>()
                .join("\n"),
        }
    }
}

/// 内容部分
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ContentPart {
    /// 文本
    Text { text: String },
    /// 图片 URL
    ImageUrl { image_url: ImageUrl },
}

/// 图片 URL
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageUrl {
    pub url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

/// 工具调用
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCall {
    /// 工具调用 ID
    pub id: String,
    /// 工具类型
    #[serde(rename = "type")]
    pub call_type: String,
    /// 函数调用详情
    pub function: FunctionCall,
}

/// 函数调用
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FunctionCall {
    /// 函数名
    pub name: String,
    /// 参数（JSON 字符串）
    pub arguments: String,
}

/// 工具定义
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolDefinition {
    /// 工具类型
    #[serde(rename = "type")]
    pub tool_type: String,
    /// 函数定义
    pub function: FunctionDefinition,
}

/// 函数定义
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FunctionDefinition {
    /// 函数名
    pub name: String,
    /// 函数描述
    pub description: String,
    /// 参数 schema
    pub parameters: serde_json::Value,
    /// 工具输入示例（用于复杂参数提高准确率）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub input_examples: Option<Vec<serde_json::Value>>,
    /// 允许调用方（assistant/code_execution/tool_search）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub allowed_callers: Option<Vec<String>>,
    /// 是否延迟加载（默认不注入上下文）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deferred_loading: Option<bool>,
}

/// Agent 配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentConfig {
    /// 模型名称
    pub model: String,
    /// 系统提示词
    pub system_prompt: Option<String>,
    /// 温度参数
    pub temperature: Option<f32>,
    /// 最大 token 数
    pub max_tokens: Option<u32>,
    /// 可用工具
    pub tools: Vec<ToolDefinition>,
}

impl Default for AgentConfig {
    fn default() -> Self {
        Self {
            model: "claude-sonnet-4-20250514".to_string(),
            system_prompt: Some(DEFAULT_SYSTEM_PROMPT.to_string()),
            temperature: Some(0.7),
            max_tokens: Some(4096),
            tools: Vec::new(),
        }
    }
}

/// 默认系统提示词
///
/// 参考 Manus Agent 的模块化设计，使用结构化的提示词组织
/// 支持通过配置文件覆盖
pub const DEFAULT_SYSTEM_PROMPT: &str = r#"你是 Lime 内置的 AI 助手。

<identity>
- 你是一个友好、专业的 AI 助手
- 擅长编程、文件操作和系统任务
- 使用中文与用户交流
</identity>

<core_principles>
1. **自然交流优先**：问候、闲聊、问答类对话，直接用文字回复
2. **按任务选择工具**：当工具能显著提升准确性或完成度时，应主动调用工具
3. **本地操作需授权**：读取/修改本地文件、执行本地命令前，需有用户明确意图
4. **不无依据臆测**：涉及实时信息或外部事实时，优先通过工具检索再回答
</core_principles>

<tool_use_rules>
## 何时使用工具

✅ **使用工具的情况**：
- 用户需要实时信息、新闻、外部来源或网页事实核验
- 用户明确提供了文件路径（如 "读取 /path/to/file"）
- 用户明确要求执行命令（如 "运行 npm install"）
- 用户要求创建或修改文件

❌ **禁止使用工具的情况**：
- 用户说 "你好"、"嗨"、"hello" 等问候语
- 用户进行闲聊或一般性提问
- 用户没有提供具体路径时猜测路径
- 为了 "了解环境" 或 "打招呼" 而读取本地文件/执行本地命令

## 可用工具

- **read**：读取用户指定的文件或目录内容
- **write**：创建或覆盖用户指定的文件
- **edit**：修改用户指定文件的特定内容
- **bash**：执行用户要求的 shell 命令
- **WebSearch**：联网搜索公开网页信息
- **WebFetch**：抓取并提取指定网页内容
</tool_use_rules>

<response_examples>
## 正确示例

用户: "你好"
助手: "你好！有什么我可以帮助你的吗？"
（直接文字回复，不调用任何工具）

用户: "看看 /tmp/test.txt"
助手: 调用 read_file 工具读取 /tmp/test.txt

用户: "帮我列出当前目录"
助手: "请告诉我你想查看哪个目录？"
（询问具体路径，不要猜测）
</response_examples>

<output_format>
- 使用 Markdown 格式
- 回复简洁明了
- 使用中文
</output_format>"#;

/// 聊天请求
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NativeChatRequest {
    /// 会话 ID（用于连续对话）
    pub session_id: Option<String>,
    /// 用户消息
    pub message: String,
    /// 模型名称（可选）
    pub model: Option<String>,
    /// 图片列表（可选）
    pub images: Option<Vec<ImageData>>,
    /// 是否流式响应
    pub stream: bool,
}

/// 图片数据
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageData {
    /// base64 编码的图片数据
    pub data: String,
    /// MIME 类型
    pub media_type: String,
}

/// 聊天响应
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NativeChatResponse {
    /// 响应内容
    pub content: String,
    /// 使用的模型
    pub model: String,
    /// Token 使用量
    pub usage: Option<TokenUsage>,
    /// 是否成功
    pub success: bool,
    /// 错误信息
    pub error: Option<String>,
}

/// Token 使用量
///
/// 记录 API 调用的 token 消耗
/// Requirements: 1.3 - THE Streaming_Handler SHALL emit a done event with token usage statistics
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TokenUsage {
    /// 输入 token 数
    pub input_tokens: u32,
    /// 输出 token 数
    pub output_tokens: u32,
}

impl TokenUsage {
    /// 创建新的 TokenUsage
    pub fn new(input_tokens: u32, output_tokens: u32) -> Self {
        Self {
            input_tokens,
            output_tokens,
        }
    }

    /// 计算总 token 数
    pub fn total(&self) -> u32 {
        self.input_tokens + self.output_tokens
    }
}

/// 流式响应事件
///
/// 定义流式输出过程中的各种事件类型
/// Requirements: 1.1, 1.3, 1.4
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type")]
pub enum StreamEvent {
    /// 文本增量
    /// Requirements: 1.1 - THE Streaming_Handler SHALL emit text deltas to the frontend in real-time
    #[serde(rename = "text_delta")]
    TextDelta { text: String },

    /// 推理内容增量（DeepSeek reasoner 等模型的思考过程）
    /// Requirements: 1.1 - THE Streaming_Handler SHALL emit reasoning deltas to the frontend in real-time
    #[serde(rename = "reasoning_delta")]
    ReasoningDelta { text: String },

    /// 工具调用开始
    /// Requirements: 7.6 - WHILE the Tool_Loop is executing, THE Frontend SHALL display the current tool being executed
    #[serde(rename = "tool_start")]
    ToolStart {
        /// 工具名称
        tool_name: String,
        /// 工具调用 ID
        tool_id: String,
        /// 工具参数（JSON 字符串）
        #[serde(skip_serializing_if = "Option::is_none")]
        arguments: Option<String>,
    },

    /// 工具调用结束
    /// Requirements: 7.6 - 工具执行完成后通知前端
    #[serde(rename = "tool_end")]
    ToolEnd {
        /// 工具调用 ID
        tool_id: String,
        /// 工具执行结果
        result: ToolExecutionResult,
    },

    /// 权限确认请求
    /// 当 Agent 需要用户确认某个操作时发送
    #[serde(rename = "action_required")]
    ActionRequired {
        /// 请求 ID
        request_id: String,
        /// 操作类型
        action_type: String,
        /// 工具名称（tool_confirmation 类型）
        #[serde(skip_serializing_if = "Option::is_none")]
        tool_name: Option<String>,
        /// 工具参数（tool_confirmation 类型）
        #[serde(skip_serializing_if = "Option::is_none")]
        arguments: Option<serde_json::Value>,
        /// 提示信息
        #[serde(skip_serializing_if = "Option::is_none")]
        prompt: Option<String>,
        /// 问题列表（ask_user 类型）
        #[serde(skip_serializing_if = "Option::is_none")]
        questions: Option<serde_json::Value>,
        /// 请求的数据结构（elicitation 类型）
        #[serde(skip_serializing_if = "Option::is_none")]
        requested_schema: Option<serde_json::Value>,
    },

    /// 完成（单次 API 响应完成，工具循环可能继续）
    /// Requirements: 1.3 - THE Streaming_Handler SHALL emit a done event with token usage statistics
    #[serde(rename = "done")]
    Done { usage: Option<TokenUsage> },

    /// 最终完成（整个对话完成，包括所有工具调用循环）
    /// 前端收到此事件后才能取消监听
    #[serde(rename = "final_done")]
    FinalDone { usage: Option<TokenUsage> },

    /// 错误
    /// Requirements: 1.4 - IF a streaming error occurs, THEN THE Streaming_Handler SHALL emit an error event
    #[serde(rename = "error")]
    Error { message: String },
}

/// 工具执行结果（用于 StreamEvent）
///
/// 简化版的工具结果，用于前端显示
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ToolExecutionResult {
    /// 是否成功
    pub success: bool,
    /// 输出内容
    pub output: String,
    /// 错误信息（如果失败）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl ToolExecutionResult {
    /// 创建成功结果
    pub fn success(output: impl Into<String>) -> Self {
        Self {
            success: true,
            output: output.into(),
            error: None,
        }
    }

    /// 创建失败结果
    pub fn failure(error: impl Into<String>) -> Self {
        let error_msg = error.into();
        Self {
            success: false,
            output: String::new(),
            error: Some(error_msg),
        }
    }

    /// 创建带输出的失败结果
    pub fn failure_with_output(output: impl Into<String>, error: impl Into<String>) -> Self {
        Self {
            success: false,
            output: output.into(),
            error: Some(error.into()),
        }
    }
}

/// 流式响应结果
///
/// 流式处理完成后的最终结果
/// Requirements: 1.1, 1.3
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamResult {
    /// 完整的响应内容
    pub content: String,
    /// 工具调用列表（如果有）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<ToolCall>>,
    /// Token 使用量
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage: Option<TokenUsage>,
    /// 推理内容（DeepSeek R1 等模型的思维链内容）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning_content: Option<String>,
}

impl StreamResult {
    /// 创建新的流式结果
    pub fn new(content: String) -> Self {
        Self {
            content,
            tool_calls: None,
            usage: None,
            reasoning_content: None,
        }
    }

    /// 设置工具调用
    pub fn with_tool_calls(mut self, tool_calls: Vec<ToolCall>) -> Self {
        self.tool_calls = Some(tool_calls);
        self
    }

    /// 设置 token 使用量
    pub fn with_usage(mut self, usage: TokenUsage) -> Self {
        self.usage = Some(usage);
        self
    }

    /// 设置推理内容
    pub fn with_reasoning_content(mut self, reasoning_content: String) -> Self {
        self.reasoning_content = Some(reasoning_content);
        self
    }

    /// 是否有工具调用
    pub fn has_tool_calls(&self) -> bool {
        self.tool_calls
            .as_ref()
            .map(|tc| !tc.is_empty())
            .unwrap_or(false)
    }
}
