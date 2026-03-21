//! OpenAI 请求转换为 CodeWhisperer 请求
//!
//! 将 OpenAI ChatCompletionRequest 转换为 CodeWhisperer API 格式。
//!
//! # 模型映射
//!
//! - claude-opus-4-5 → claude-opus-4.5
//! - claude-sonnet-4-5 → CLAUDE_SONNET_4_5_20250929_V1_0
//! - claude-sonnet-4-20250514 → CLAUDE_SONNET_4_20250514_V1_0
//! - claude-haiku-4-5 → claude-haiku-4.5

use crate::translator::traits::{RequestTranslator, TranslateError};
use lime_core::models::codewhisperer::*;
use lime_core::models::openai::*;
use std::collections::{HashMap, HashSet};
use uuid::Uuid;

/// OpenAI 到 Kiro 请求转换器
#[derive(Debug, Clone)]
pub struct OpenAiRequestTranslator {
    /// 可选的 Profile ARN (AWS CodeWhisperer)
    pub profile_arn: Option<String>,
}

impl Default for OpenAiRequestTranslator {
    fn default() -> Self {
        Self::new()
    }
}

impl OpenAiRequestTranslator {
    /// 创建新的转换器
    pub fn new() -> Self {
        Self { profile_arn: None }
    }

    /// 使用 Profile ARN 创建转换器
    pub fn with_profile_arn(profile_arn: String) -> Self {
        Self {
            profile_arn: Some(profile_arn),
        }
    }
}

impl RequestTranslator for OpenAiRequestTranslator {
    type Input = ChatCompletionRequest;
    type Output = CodeWhispererRequest;
    type Error = TranslateError;

    fn translate_request(&self, request: Self::Input) -> Result<Self::Output, Self::Error> {
        Ok(convert_openai_to_codewhisperer(
            &request,
            self.profile_arn.clone(),
        ))
    }
}

// ============================================================================
// 模型映射
// ============================================================================

/// 模型映射表
pub fn get_model_map() -> HashMap<&'static str, &'static str> {
    let mut map = HashMap::new();
    // Opus 4.5 系列
    map.insert("claude-opus-4-5", "claude-opus-4.5");
    map.insert("claude-opus-4-5-20251101", "claude-opus-4.5");
    // Haiku 4.5 系列
    map.insert("claude-haiku-4-5", "claude-haiku-4.5");
    map.insert("claude-haiku-4-5-20251001", "claude-haiku-4.5");
    // Sonnet 4.5 系列
    map.insert("claude-sonnet-4-5", "CLAUDE_SONNET_4_5_20250929_V1_0");
    map.insert(
        "claude-sonnet-4-5-20250929",
        "CLAUDE_SONNET_4_5_20250929_V1_0",
    );
    // Sonnet 4 系列
    map.insert("claude-sonnet-4-20250514", "CLAUDE_SONNET_4_20250514_V1_0");
    // Sonnet 3.7/3.5 系列（兼容旧版本）
    map.insert(
        "claude-3-7-sonnet-20250219",
        "CLAUDE_3_7_SONNET_20250219_V1_0",
    );
    map.insert(
        "claude-3-5-sonnet-20241022",
        "CLAUDE_3_7_SONNET_20250219_V1_0",
    );
    map.insert(
        "claude-3-5-sonnet-latest",
        "CLAUDE_3_7_SONNET_20250219_V1_0",
    );
    map
}

/// 获取支持的模型列表
pub fn get_supported_models() -> Vec<&'static str> {
    vec![
        "claude-opus-4-5",
        "claude-opus-4-5-20251101",
        "claude-haiku-4-5",
        "claude-haiku-4-5-20251001",
        "claude-sonnet-4-5",
        "claude-sonnet-4-5-20250929",
        "claude-sonnet-4-20250514",
        "claude-3-7-sonnet-20250219",
    ]
}

/// 默认模型
pub const DEFAULT_MODEL: &str = "CLAUDE_SONNET_4_5_20250929_V1_0";

// ============================================================================
// 内部类型
// ============================================================================

#[derive(Debug, Clone)]
struct ProcessedMessage {
    role: String,
    content: String,
    tool_calls: Option<Vec<CWToolUse>>,
    tool_results: Option<Vec<CWToolResult>>,
    images: Option<Vec<CWImage>>,
}

// ============================================================================
// 转换函数
// ============================================================================

/// 将 OpenAI ChatCompletionRequest 转换为 CodeWhisperer 请求
pub fn convert_openai_to_codewhisperer(
    request: &ChatCompletionRequest,
    profile_arn: Option<String>,
) -> CodeWhispererRequest {
    convert_openai_to_codewhisperer_with_conversation_id(request, profile_arn, None)
}

pub fn convert_openai_to_codewhisperer_with_conversation_id(
    request: &ChatCompletionRequest,
    profile_arn: Option<String>,
    conversation_id: Option<&str>,
) -> CodeWhispererRequest {
    let model_map = get_model_map();
    let cw_model = model_map
        .get(request.model.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| DEFAULT_MODEL.to_string());

    let conversation_id = conversation_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| Uuid::new_v4().to_string());

    // 提取 system prompt 和消息
    let mut system_prompt = String::new();
    let mut raw_messages: Vec<&ChatMessage> = Vec::new();

    for msg in &request.messages {
        if msg.role == "system" {
            system_prompt = msg.get_content_text();
        } else {
            raw_messages.push(msg);
        }
    }

    // 调试日志：打印 tool_choice 和 tools 信息
    tracing::info!(
        "[KIRO_TRANSLATE] 收到请求: tool_choice={:?}, has_tools={}, tools_count={}",
        request.tool_choice,
        request.tools.is_some(),
        request.tools.as_ref().map(|t| t.len()).unwrap_or(0)
    );

    // 处理 tool_choice: required - CodeWhisperer 不支持此参数，通过 prompt 注入强制
    if is_tool_choice_required(&request.tool_choice) && request.tools.is_some() {
        let tool_instruction = "\n\n[CRITICAL INSTRUCTION] You MUST use one of the provided tools to respond. Do NOT respond with plain text. Call a tool function immediately.";
        system_prompt.push_str(tool_instruction);
        tracing::info!("[KIRO_TRANSLATE] tool_choice=required detected, injected tool instruction");
    }

    // 预处理消息：合并 tool 消息
    let messages = preprocess_messages(&raw_messages);

    // 构建历史记录
    let mut history: Vec<HistoryItem> = Vec::new();
    let mut start_idx = 0;

    // 处理 system prompt - 合并到第一条用户消息
    if !system_prompt.is_empty() && !messages.is_empty() && messages[0].role == "user" {
        let first_content = &messages[0].content;
        let combined = format!("{system_prompt}\n\n{first_content}");

        let mut user_msg = UserInputMessage {
            content: combined,
            model_id: cw_model.clone(),
            origin: "AI_EDITOR".to_string(),
            images: messages[0].images.clone(), // 传递图片
            user_input_message_context: None,
        };

        if let Some(ref tool_results) = messages[0].tool_results {
            user_msg.user_input_message_context = Some(UserInputMessageContext {
                tools: None,
                tool_results: Some(tool_results.clone()),
            });
        }

        history.push(HistoryItem::User(UserHistoryItem {
            user_input_message: user_msg,
        }));
        start_idx = 1;
    }

    // 处理历史消息（除最后一条）
    for msg in messages
        .iter()
        .take(messages.len().saturating_sub(1))
        .skip(start_idx)
    {
        match msg.role.as_str() {
            "user" => {
                let content = if msg.content.is_empty() {
                    if msg.tool_results.is_some() {
                        "Tool results provided.".to_string()
                    } else {
                        "Continue".to_string()
                    }
                } else {
                    msg.content.clone()
                };

                let mut user_msg = UserInputMessage {
                    content,
                    model_id: cw_model.clone(),
                    origin: "AI_EDITOR".to_string(),
                    images: msg.images.clone(), // 传递图片
                    user_input_message_context: None,
                };

                if let Some(ref tool_results) = msg.tool_results {
                    user_msg.user_input_message_context = Some(UserInputMessageContext {
                        tools: None,
                        tool_results: Some(tool_results.clone()),
                    });
                }

                history.push(HistoryItem::User(UserHistoryItem {
                    user_input_message: user_msg,
                }));
            }
            "assistant" => {
                let content = if msg.content.is_empty() {
                    "I understand.".to_string()
                } else {
                    msg.content.clone()
                };

                history.push(HistoryItem::Assistant(AssistantHistoryItem {
                    assistant_response_message: AssistantResponseMessage {
                        content,
                        tool_uses: msg.tool_calls.clone(),
                    },
                }));
            }
            _ => {}
        }
    }

    // 修复历史记录交替顺序
    let history = fix_history_alternation(history, &cw_model);

    // 构建当前消息
    let (current_content, current_tool_results, current_images) =
        if let Some(last_msg) = messages.last() {
            if last_msg.role == "assistant" {
                ("Continue".to_string(), None, None)
            } else {
                let content = if last_msg.content.is_empty() {
                    if last_msg.tool_results.is_some() {
                        "Tool results provided.".to_string()
                    } else {
                        "Continue".to_string()
                    }
                } else {
                    last_msg.content.clone()
                };
                (
                    content,
                    last_msg.tool_results.clone(),
                    last_msg.images.clone(),
                )
            }
        } else {
            ("Continue".to_string(), None, None)
        };

    // 构建 tools
    let tools = convert_tools(&request.tools);

    let user_input_message_context = if tools.is_some() || current_tool_results.is_some() {
        Some(UserInputMessageContext {
            tools,
            tool_results: current_tool_results,
        })
    } else {
        None
    };

    // 记录图片信息
    if let Some(ref imgs) = current_images {
        tracing::info!(
            "[KIRO_TRANSLATE] OpenAI current message contains {} image(s)",
            imgs.len()
        );
    }

    CodeWhispererRequest {
        conversation_state: ConversationState {
            chat_trigger_type: "MANUAL".to_string(),
            conversation_id,
            current_message: CurrentMessage {
                user_input_message: UserInputMessage {
                    content: current_content,
                    model_id: cw_model,
                    origin: "AI_EDITOR".to_string(),
                    images: current_images, // 传递当前消息的图片
                    user_input_message_context,
                },
            },
            history: if history.is_empty() {
                None
            } else {
                Some(history)
            },
        },
        profile_arn,
    }
}

/// 预处理消息：合并连续的 tool 消息到前一个 assistant 消息后的 user 消息
fn preprocess_messages(messages: &[&ChatMessage]) -> Vec<ProcessedMessage> {
    let mut result: Vec<ProcessedMessage> = Vec::new();
    let mut pending_tool_results: Vec<CWToolResult> = Vec::new();

    for msg in messages {
        match msg.role.as_str() {
            "tool" => {
                let content = msg.get_content_text();
                let tool_id = msg.tool_call_id.clone().unwrap_or_default();
                pending_tool_results.push(CWToolResult {
                    content: vec![CWTextContent { text: content }],
                    status: "success".to_string(),
                    tool_use_id: tool_id,
                });
            }
            "user" => {
                let content = msg.get_content_text();
                let mut tool_results = pending_tool_results.clone();
                pending_tool_results.clear();

                // 去重 tool_results
                let mut seen_ids = HashSet::new();
                tool_results.retain(|tr| seen_ids.insert(tr.tool_use_id.clone()));

                // 提取图片
                let raw_images = msg.get_images();
                let images = if raw_images.is_empty() {
                    None
                } else {
                    Some(
                        raw_images
                            .into_iter()
                            .map(|(format, data)| CWImage {
                                format,
                                source: CWImageSource { bytes: data },
                            })
                            .collect(),
                    )
                };

                if images.is_some() {
                    tracing::debug!(
                        "[KIRO_TRANSLATE] OpenAI user message contains {} image(s)",
                        images.as_ref().map(|v: &Vec<CWImage>| v.len()).unwrap_or(0)
                    );
                }

                result.push(ProcessedMessage {
                    role: "user".to_string(),
                    content,
                    tool_calls: None,
                    tool_results: if tool_results.is_empty() {
                        None
                    } else {
                        Some(tool_results)
                    },
                    images,
                });
            }
            "assistant" => {
                // 如果有待处理的 tool results，先创建一个 user 消息
                if !pending_tool_results.is_empty() {
                    let mut tool_results = pending_tool_results.clone();
                    pending_tool_results.clear();

                    let mut seen_ids = HashSet::new();
                    tool_results.retain(|tr| seen_ids.insert(tr.tool_use_id.clone()));

                    result.push(ProcessedMessage {
                        role: "user".to_string(),
                        content: "Tool results provided.".to_string(),
                        tool_calls: None,
                        tool_results: Some(tool_results),
                        images: None,
                    });
                }

                let content = msg.get_content_text();
                let tool_calls = msg.tool_calls.as_ref().map(|calls| {
                    calls
                        .iter()
                        .map(|tc| CWToolUse {
                            input: serde_json::from_str(&tc.function.arguments)
                                .unwrap_or(serde_json::json!({})),
                            name: tc.function.name.clone(),
                            tool_use_id: tc.id.clone(),
                        })
                        .collect()
                });

                result.push(ProcessedMessage {
                    role: "assistant".to_string(),
                    content,
                    tool_calls,
                    tool_results: None,
                    images: None, // assistant 消息不包含图片
                });
            }
            _ => {}
        }
    }

    // 处理末尾的 tool results
    if !pending_tool_results.is_empty() {
        let mut tool_results = pending_tool_results;
        let mut seen_ids = HashSet::new();
        tool_results.retain(|tr| seen_ids.insert(tr.tool_use_id.clone()));

        result.push(ProcessedMessage {
            role: "user".to_string(),
            content: "Tool results provided.".to_string(),
            tool_calls: None,
            tool_results: Some(tool_results),
            images: None,
        });
    }

    result
}

/// 转换工具列表
fn convert_tools(tools: &Option<Vec<Tool>>) -> Option<Vec<CWToolItem>> {
    tools.as_ref().map(|tools| {
        let mut cw_tools: Vec<CWToolItem> = Vec::new();
        let mut function_count = 0;

        for t in tools.iter() {
            match t {
                Tool::Function { function } => {
                    // 限制最多 50 个函数工具
                    if function_count >= 50 {
                        continue;
                    }
                    function_count += 1;

                    let params = function
                        .parameters
                        .clone()
                        .unwrap_or_else(|| serde_json::json!({"type": "object", "properties": {}}));

                    let desc = function
                        .description
                        .clone()
                        .unwrap_or_else(|| format!("Tool: {}", function.name));

                    cw_tools.push(CWToolItem::Standard(CWTool {
                        tool_specification: ToolSpecification {
                            name: function.name.clone(),
                            description: if desc.len() > 500 {
                                let truncated: String = desc.chars().take(497).collect();
                                format!("{truncated}...")
                            } else {
                                desc
                            },
                            input_schema: InputSchema { json: params },
                        },
                    }));
                }
                Tool::WebSearch | Tool::WebSearch20250305 => {
                    cw_tools.push(CWToolItem::WebSearch(CWWebSearchTool {
                        tool_type: "web_search".to_string(),
                    }));
                }
            }
        }

        cw_tools
    })
}

/// 修复历史记录，确保 user/assistant 严格交替
fn fix_history_alternation(history: Vec<HistoryItem>, model_id: &str) -> Vec<HistoryItem> {
    if history.is_empty() {
        return history;
    }

    let mut fixed: Vec<HistoryItem> = Vec::new();

    for item in history {
        match &item {
            HistoryItem::User(user_item) => {
                if let Some(HistoryItem::User(last_user)) = fixed.last_mut() {
                    let has_tool_results = user_item
                        .user_input_message
                        .user_input_message_context
                        .as_ref()
                        .map(|ctx| ctx.tool_results.is_some())
                        .unwrap_or(false);

                    if has_tool_results {
                        let new_results = user_item
                            .user_input_message
                            .user_input_message_context
                            .as_ref()
                            .and_then(|ctx| ctx.tool_results.clone())
                            .unwrap_or_default();

                        if let Some(ref mut ctx) =
                            last_user.user_input_message.user_input_message_context
                        {
                            if let Some(ref mut existing) = ctx.tool_results {
                                existing.extend(new_results);
                            } else {
                                ctx.tool_results = Some(new_results);
                            }
                        } else {
                            last_user.user_input_message.user_input_message_context =
                                Some(UserInputMessageContext {
                                    tools: None,
                                    tool_results: Some(new_results),
                                });
                        }
                        continue;
                    } else {
                        fixed.push(HistoryItem::Assistant(AssistantHistoryItem {
                            assistant_response_message: AssistantResponseMessage {
                                content: "I understand.".to_string(),
                                tool_uses: None,
                            },
                        }));
                    }
                }
                fixed.push(item);
            }
            HistoryItem::Assistant(_) => {
                if let Some(HistoryItem::Assistant(_)) = fixed.last() {
                    fixed.push(HistoryItem::User(UserHistoryItem {
                        user_input_message: UserInputMessage {
                            content: "Continue".to_string(),
                            model_id: model_id.to_string(),
                            origin: "AI_EDITOR".to_string(),
                            images: None,
                            user_input_message_context: None,
                        },
                    }));
                }
                if fixed.is_empty() {
                    fixed.push(HistoryItem::User(UserHistoryItem {
                        user_input_message: UserInputMessage {
                            content: "Continue".to_string(),
                            model_id: model_id.to_string(),
                            origin: "AI_EDITOR".to_string(),
                            images: None,
                            user_input_message_context: None,
                        },
                    }));
                }
                fixed.push(item);
            }
        }
    }

    // 确保以 assistant 结尾
    if let Some(HistoryItem::User(_)) = fixed.last() {
        fixed.push(HistoryItem::Assistant(AssistantHistoryItem {
            assistant_response_message: AssistantResponseMessage {
                content: "I understand.".to_string(),
                tool_uses: None,
            },
        }));
    }

    fixed
}

/// 检查 tool_choice 是否为 required
///
/// tool_choice 可以是:
/// - "required" 字符串
/// - {"type": "any"} 或类似结构
fn is_tool_choice_required(tool_choice: &Option<serde_json::Value>) -> bool {
    match tool_choice {
        Some(serde_json::Value::String(s)) => s == "required" || s == "any",
        Some(serde_json::Value::Object(obj)) => {
            // 检查 {"type": "any"} 或 {"type": "tool", ...}
            if let Some(serde_json::Value::String(t)) = obj.get("type") {
                t == "any" || t == "tool"
            } else {
                false
            }
        }
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_model_mapping() {
        let map = get_model_map();
        assert_eq!(map.get("claude-opus-4-5"), Some(&"claude-opus-4.5"));
        assert_eq!(
            map.get("claude-sonnet-4-5"),
            Some(&"CLAUDE_SONNET_4_5_20250929_V1_0")
        );
    }

    #[test]
    fn test_convert_simple_request() {
        let request = ChatCompletionRequest {
            model: "claude-sonnet-4-5".to_string(),
            messages: vec![ChatMessage {
                role: "user".to_string(),
                content: Some(MessageContent::Text("Hello".to_string())),
                tool_calls: None,
                tool_call_id: None,
                reasoning_content: None,
            }],
            tools: None,
            stream: false,
            max_tokens: None,
            temperature: None,
            top_p: None,
            tool_choice: None,
            reasoning_effort: None,
        };

        let translator = OpenAiRequestTranslator::new();
        let result = translator.translate_request(request);
        assert!(result.is_ok());

        let cw_request = result.unwrap();
        assert_eq!(
            cw_request
                .conversation_state
                .current_message
                .user_input_message
                .model_id,
            "CLAUDE_SONNET_4_5_20250929_V1_0"
        );
    }
}
