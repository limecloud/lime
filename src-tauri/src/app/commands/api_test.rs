//! API 兼容性与模型查询命令
//!
//! 保留面向开发者与内部工具的只读能力。

use crate::app::types::{AppState, LogState, ProviderType};
use crate::commands::model_registry_cmd::ModelRegistryState;

/// 模型信息
#[derive(serde::Serialize)]
pub struct ModelInfo {
    pub id: String,
    pub object: String,
    pub owned_by: String,
}

/// API 检查结果
#[derive(serde::Serialize)]
pub struct ApiCheckResult {
    pub model: String,
    pub available: bool,
    pub status: u16,
    pub error_type: Option<String>,
    pub error_message: Option<String>,
    pub time_ms: u64,
}

/// API 兼容性结果
#[derive(serde::Serialize)]
pub struct ApiCompatibilityResult {
    pub provider: String,
    pub overall_status: String,
    pub checked_at: String,
    pub results: Vec<ApiCheckResult>,
    pub warnings: Vec<String>,
}

/// 检查 API 兼容性
#[tauri::command]
pub async fn check_api_compatibility(
    state: tauri::State<'_, AppState>,
    logs: tauri::State<'_, LogState>,
    provider: String,
) -> Result<ApiCompatibilityResult, String> {
    // 使用枚举验证 provider
    let provider_type: ProviderType = provider.parse().map_err(|e: String| e)?;

    logs.write().await.add(
        "info",
        &format!("[API检测] 开始检测 {provider_type} API 兼容性（代理工具调用能力测试）..."),
    );

    let s = state.read().await;
    let mut results: Vec<ApiCheckResult> = Vec::new();
    let mut warnings: Vec<String> = Vec::new();

    // 代理工具调用主链需要的测试项目
    let test_cases: Vec<(&str, &str)> = match provider_type {
        ProviderType::Kiro => vec![
            ("claude-sonnet-4-5", "basic"),
            ("claude-sonnet-4-5", "tool_call"),
        ],
        ProviderType::Gemini => vec![
            ("gemini-2.5-flash", "basic"),
            ("gemini-2.5-flash", "tool_call"),
        ],
        ProviderType::Antigravity => vec![
            ("gemini-3-pro-preview", "basic"),
            ("gemini-3-pro-preview", "tool_call"),
        ],
        ProviderType::Vertex => vec![
            ("gemini-2.0-flash", "basic"),
            ("gemini-2.0-flash", "tool_call"),
        ],
        ProviderType::GeminiApiKey => vec![
            ("gemini-2.5-flash", "basic"),
            ("gemini-2.5-flash", "tool_call"),
        ],
        ProviderType::Codex => vec![("gpt-4.1", "basic"), ("gpt-4.1", "tool_call")],
        ProviderType::ClaudeOAuth => vec![
            ("claude-sonnet-4-5", "basic"),
            ("claude-sonnet-4-5", "tool_call"),
        ],
        // Anthropic 兼容格式 - 使用 Claude 相同的测试
        ProviderType::AnthropicCompatible => vec![],
        ProviderType::OpenAI | ProviderType::Claude => vec![],
        // API Key Provider 类型 - 暂不支持自动测试
        ProviderType::Anthropic
        | ProviderType::AzureOpenai
        | ProviderType::AwsBedrock
        | ProviderType::Ollama => vec![],
    };

    for (model, test_type) in test_cases {
        let start = std::time::Instant::now();
        let test_name = format!("{model} ({test_type})");

        // 根据测试类型构建不同的请求
        let test_request = match test_type {
            "tool_call" => {
                // 测试 Tool Calls - 代理工具调用主链能力
                crate::models::openai::ChatCompletionRequest {
                    model: model.to_string(),
                    messages: vec![crate::models::openai::ChatMessage {
                        role: "user".to_string(),
                        content: Some(crate::models::openai::MessageContent::Text(
                            "What is 2+2? Use the calculator tool to compute this.".to_string(),
                        )),
                        tool_calls: None,
                        tool_call_id: None,
                        reasoning_content: None,
                    }],
                    temperature: None,
                    max_tokens: Some(100),
                    top_p: None,
                    stream: false,
                    tools: Some(vec![crate::models::openai::Tool::Function {
                        function: crate::models::openai::FunctionDef {
                            name: "calculator".to_string(),
                            description: Some("Perform basic arithmetic calculations".to_string()),
                            parameters: Some(serde_json::json!({
                                "type": "object",
                                "properties": {
                                    "expression": {
                                        "type": "string",
                                        "description": "The math expression to evaluate"
                                    }
                                },
                                "required": ["expression"]
                            })),
                        },
                    }]),
                    tool_choice: None,
                    reasoning_effort: None,
                }
            }
            _ => {
                // 基础对话测试
                crate::models::openai::ChatCompletionRequest {
                    model: model.to_string(),
                    messages: vec![crate::models::openai::ChatMessage {
                        role: "user".to_string(),
                        content: Some(crate::models::openai::MessageContent::Text(
                            "Say 'OK' only.".to_string(),
                        )),
                        tool_calls: None,
                        tool_call_id: None,
                        reasoning_content: None,
                    }],
                    temperature: None,
                    max_tokens: Some(10),
                    top_p: None,
                    stream: false,
                    tools: None,
                    tool_choice: None,
                    reasoning_effort: None,
                }
            }
        };

        let result = match provider_type {
            ProviderType::Kiro => s.kiro_provider.call_api(&test_request).await,
            ProviderType::Gemini => {
                Err("Gemini API compatibility check not yet implemented".into())
            }
            _ => Err("Provider not supported for direct API check".into()),
        };

        let time_ms = start.elapsed().as_millis() as u64;

        match result {
            Ok(resp) => {
                let status = resp.status().as_u16();
                let body = resp.text().await.unwrap_or_default();

                let (available, error_type, error_message) = if (200..300).contains(&status) {
                    if test_type == "tool_call" {
                        let has_tool_use =
                            body.contains("\"name\"") && body.contains("\"toolUseId\"");
                        if !has_tool_use {
                            warnings.push(format!(
                                "{test_name}: 响应未包含 tool_use，兼容代理工具调用能力可能无法正常工作"
                            ));
                        }
                    }
                    (true, None, None)
                } else {
                    let err_type = match status {
                        401 => {
                            warnings.push(format!("{test_name} 返回 401: Token 可能已过期或无效"));
                            Some("AUTH_ERROR".to_string())
                        }
                        403 => {
                            warnings.push(format!(
                                "{test_name} 返回 403: 无权访问，可能需要刷新 Token"
                            ));
                            Some("FORBIDDEN".to_string())
                        }
                        400 => {
                            warnings.push(format!("{test_name} 返回 400: 请求格式可能已变更"));
                            Some("BAD_REQUEST".to_string())
                        }
                        404 => {
                            warnings.push(format!("{test_name} 返回 404: 模型或接口可能已下线"));
                            Some("NOT_FOUND".to_string())
                        }
                        429 => {
                            warnings.push(format!("{test_name} 返回 429: 请求过于频繁"));
                            Some("RATE_LIMITED".to_string())
                        }
                        500..=599 => {
                            warnings.push(format!("{test_name} 返回 {status}: 服务端错误"));
                            Some("SERVER_ERROR".to_string())
                        }
                        _ => Some("UNKNOWN_ERROR".to_string()),
                    };
                    (
                        false,
                        err_type,
                        Some(body[..body.len().min(200)].to_string()),
                    )
                };

                results.push(ApiCheckResult {
                    model: test_name,
                    available,
                    status,
                    error_type,
                    error_message,
                    time_ms,
                });
            }
            Err(e) => {
                warnings.push(format!("{test_name} 请求失败: {e}"));
                results.push(ApiCheckResult {
                    model: test_name,
                    available: false,
                    status: 0,
                    error_type: Some("REQUEST_FAILED".to_string()),
                    error_message: Some(e.to_string()),
                    time_ms,
                });
            }
        }
    }

    let overall_status = if results.iter().all(|r| r.available) {
        "healthy".to_string()
    } else if results.iter().any(|r| r.available) {
        "partial".to_string()
    } else {
        "error".to_string()
    };

    let checked_at = chrono::Utc::now().to_rfc3339();

    logs.write().await.add(
        "info",
        &format!("[API检测] {provider} 检测完成: {overall_status}"),
    );

    Ok(ApiCompatibilityResult {
        provider,
        overall_status,
        checked_at,
        results,
        warnings,
    })
}

/// 获取可用模型列表
#[tauri::command]
pub async fn get_available_models(
    state: tauri::State<'_, ModelRegistryState>,
) -> Result<Vec<ModelInfo>, String> {
    let guard = state.read().await;
    let service = guard
        .as_ref()
        .ok_or_else(|| "模型注册服务未初始化".to_string())?;

    let models = service.get_all_models().await;

    Ok(models
        .into_iter()
        .map(|m| ModelInfo {
            id: m.id,
            object: "model".to_string(),
            owned_by: m.provider_id,
        })
        .collect())
}
