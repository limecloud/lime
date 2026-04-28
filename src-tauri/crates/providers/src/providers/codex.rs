//! Codex API Key Provider
//!
//! Codex OAuth、本地 token refresh 与凭证池导入已退役；本模块只保留
//! API Key Provider 仍使用的 Responses API URL、请求转换和模型识别能力。

#![allow(dead_code)]

use lime_core::api_host_utils::is_openai_responses_endpoint;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::error::Error;

const DEFAULT_API_BASE_URL: &str = "https://api.openai.com";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodexCredentials {
    /// API Key（支持 Codex CLI API Key JSON 字段名，便于现有测试和手工构造复用）
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        alias = "apiKey",
        alias = "OPENAI_API_KEY"
    )]
    pub api_key: Option<String>,
    /// API Base URL（可选）
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "apiBaseUrl")]
    pub api_base_url: Option<String>,
    /// Provider 类型标记
    #[serde(default = "default_type")]
    pub r#type: String,
}

fn default_type() -> String {
    "codex".to_string()
}

impl Default for CodexCredentials {
    fn default() -> Self {
        Self {
            api_key: None,
            api_base_url: None,
            r#type: default_type(),
        }
    }
}

pub struct CodexProvider {
    pub credentials: CodexCredentials,
    pub client: Client,
}

impl Default for CodexProvider {
    fn default() -> Self {
        Self {
            credentials: CodexCredentials::default(),
            client: Client::new(),
        }
    }
}

impl CodexProvider {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_client(client: Client) -> Self {
        Self {
            client,
            ..Self::default()
        }
    }

    pub fn with_api_key(api_key: impl Into<String>, api_base_url: Option<String>) -> Self {
        Self {
            credentials: CodexCredentials {
                api_key: Some(api_key.into()),
                api_base_url,
                ..Default::default()
            },
            client: Client::new(),
        }
    }

    fn get_api_key(&self) -> Option<&str> {
        self.credentials
            .api_key
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
    }

    fn api_base_url(&self) -> &str {
        self.credentials
            .api_base_url
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or(DEFAULT_API_BASE_URL)
    }

    pub fn build_responses_url(base_url: &str) -> String {
        let base = base_url.trim_end_matches('/');

        if is_openai_responses_endpoint(base) {
            return base.to_string();
        }

        // - base_url 以 /v1 结尾：直接拼 /responses
        // - base_url 只有域名：拼 /v1/responses（OpenAI 标准）
        // - base_url 已包含路径前缀：认为前缀已包含路由信息，拼 /responses
        if base.ends_with("/v1") {
            return format!("{base}/responses");
        }

        if let Ok(parsed) = url::Url::parse(base) {
            let path = parsed.path().trim_end_matches('/');
            if path.is_empty() || path == "/" {
                return format!("{base}/v1/responses");
            }
            return format!("{base}/responses");
        }

        format!("{base}/v1/responses")
    }

    pub(crate) async fn call_api(
        &self,
        request: &serde_json::Value,
    ) -> Result<reqwest::Response, Box<dyn Error + Send + Sync>> {
        let token = self
            .get_api_key()
            .ok_or("Codex API Key 未配置，请通过 API Key Provider 配置。")?;
        let url = Self::build_responses_url(self.api_base_url());
        let codex_request = transform_to_codex_format(request)?;

        let mut req = self
            .client
            .post(&url)
            .header("Authorization", format!("Bearer {token}"))
            .header("Content-Type", "application/json")
            .header("Accept", "text/event-stream")
            .header("Connection", "Keep-Alive")
            .header("Openai-Beta", "responses=experimental")
            .json(&codex_request);

        if self
            .credentials
            .api_base_url
            .as_deref()
            .map(|value| !value.trim().is_empty())
            .unwrap_or(false)
        {
            req = req
                .header("Version", "0.21.0")
                .header(
                    "User-Agent",
                    "codex_cli_rs/0.50.0 (Mac OS 26.0.1; arm64) Apple_Terminal/464",
                )
                .header("Originator", "codex_cli_rs")
                .header("Session_id", uuid::Uuid::new_v4().to_string())
                .header("Conversation_id", uuid::Uuid::new_v4().to_string());
        }

        Ok(req.send().await?)
    }

    pub(crate) async fn call_api_stream(
        &self,
        request: &serde_json::Value,
    ) -> Result<reqwest::Response, Box<dyn Error + Send + Sync>> {
        self.call_api(request).await
    }

    pub fn supports_model(model: &str) -> bool {
        let model_lower = model.to_lowercase();
        model_lower.starts_with("gpt-")
            || model_lower.starts_with("o1")
            || model_lower.starts_with("o3")
            || model_lower.starts_with("o4")
            || model_lower.contains("codex")
    }
}

fn extract_text_fragments(content: &serde_json::Value) -> Vec<String> {
    if let Some(text) = content
        .as_str()
        .map(str::trim)
        .filter(|text| !text.is_empty())
    {
        return vec![text.to_string()];
    }

    let mut fragments = Vec::new();
    if let Some(parts) = content.as_array() {
        for part in parts {
            let text = if let Some(kind) = part.get("type").and_then(|v| v.as_str()) {
                match kind {
                    "text" | "input_text" | "output_text" => {
                        part.get("text").and_then(|v| v.as_str())
                    }
                    _ => part.get("text").and_then(|v| v.as_str()),
                }
            } else {
                part.get("text").and_then(|v| v.as_str())
            };
            if let Some(text) = text.map(str::trim).filter(|text| !text.is_empty()) {
                fragments.push(text.to_string());
            }
        }
    }
    fragments
}

fn resolve_codex_instructions(
    request: &serde_json::Value,
    system_instructions: &[String],
) -> Option<String> {
    if let Some(request_instructions) = request
        .get("instructions")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return Some(request_instructions.to_string());
    }

    if !system_instructions.is_empty() {
        return Some(system_instructions.join("\n\n"));
    }

    lime_core::env_compat::var_nonempty(&[
        "LIME_CODEX_DEFAULT_INSTRUCTIONS",
        "PROXYCAST_CODEX_DEFAULT_INSTRUCTIONS",
    ])
}

/// Transform OpenAI chat completion request to Codex Responses format.
fn transform_to_codex_format(
    request: &serde_json::Value,
) -> Result<serde_json::Value, Box<dyn Error + Send + Sync>> {
    let model = request["model"].as_str().unwrap_or("gpt-4o");
    let messages = request["messages"].as_array();

    let mut input = Vec::new();
    let mut system_instructions: Vec<String> = Vec::new();

    if let Some(msgs) = messages {
        for msg in msgs {
            let role = msg["role"].as_str().unwrap_or("user");
            let content = &msg["content"];

            match role {
                "system" => {
                    system_instructions.extend(extract_text_fragments(content));
                }
                "user" => {
                    let content_parts = if let Some(text) = content.as_str() {
                        vec![serde_json::json!({"type": "input_text", "text": text})]
                    } else if let Some(arr) = content.as_array() {
                        arr.iter()
                            .filter_map(|part| {
                                let part_type = part["type"].as_str().unwrap_or("");
                                match part_type {
                                    "text" => part["text"].as_str().map(
                                        |text| serde_json::json!({"type": "input_text", "text": text}),
                                    ),
                                    "image_url" => part["image_url"]["url"].as_str().map(
                                        |url| serde_json::json!({"type": "input_image", "image_url": url}),
                                    ),
                                    _ => part["text"].as_str().map(
                                        |text| serde_json::json!({"type": "input_text", "text": text}),
                                    ),
                                }
                            })
                            .collect()
                    } else {
                        vec![]
                    };

                    if !content_parts.is_empty() {
                        input.push(serde_json::json!({
                            "type": "message",
                            "role": "user",
                            "content": content_parts
                        }));
                    }
                }
                "assistant" => {
                    let content_parts = if let Some(text) = content.as_str() {
                        vec![serde_json::json!({"type": "output_text", "text": text})]
                    } else if let Some(arr) = content.as_array() {
                        arr.iter()
                            .filter_map(|part| {
                                part["text"].as_str().map(
                                    |text| serde_json::json!({"type": "output_text", "text": text}),
                                )
                            })
                            .collect()
                    } else {
                        vec![]
                    };

                    if !content_parts.is_empty() {
                        input.push(serde_json::json!({
                            "type": "message",
                            "role": "assistant",
                            "content": content_parts
                        }));
                    }

                    if let Some(tool_calls) = msg["tool_calls"].as_array() {
                        for tc in tool_calls {
                            if tc["type"].as_str() == Some("function") {
                                input.push(serde_json::json!({
                                    "type": "function_call",
                                    "call_id": tc["id"].as_str().unwrap_or(""),
                                    "name": tc["function"]["name"].as_str().unwrap_or(""),
                                    "arguments": tc["function"]["arguments"].as_str().unwrap_or("{}")
                                }));
                            }
                        }
                    }
                }
                "tool" => {
                    let tool_call_id = msg["tool_call_id"].as_str().unwrap_or("");
                    let output = content.as_str().unwrap_or("");
                    input.push(serde_json::json!({
                        "type": "function_call_output",
                        "call_id": tool_call_id,
                        "output": output
                    }));
                }
                _ => {}
            }
        }
    }

    let mut codex_request = serde_json::json!({
        "model": model,
        "input": input,
        "stream": true,
        "store": false,
        "parallel_tool_calls": true,
        "reasoning": {
            "effort": "medium",
            "summary": "auto"
        },
        "include": ["reasoning.encrypted_content"]
    });

    if let Some(instructions) = resolve_codex_instructions(request, &system_instructions) {
        codex_request["instructions"] = serde_json::json!(instructions);
    }

    if let Some(temp) = request.get("temperature") {
        codex_request["temperature"] = temp.clone();
    }
    if let Some(max_tokens) = request.get("max_tokens") {
        codex_request["max_output_tokens"] = max_tokens.clone();
    }
    if let Some(top_p) = request.get("top_p") {
        codex_request["top_p"] = top_p.clone();
    }

    if let Some(tools) = request["tools"].as_array() {
        let codex_tools: Vec<serde_json::Value> = tools
            .iter()
            .filter_map(|tool| {
                let tool_type = tool["type"].as_str().unwrap_or("");
                if tool_type == "function" {
                    let func = &tool["function"];
                    Some(serde_json::json!({
                        "type": "function",
                        "name": func["name"],
                        "description": func["description"],
                        "parameters": func["parameters"]
                    }))
                } else if !tool_type.is_empty() {
                    Some(tool.clone())
                } else {
                    None
                }
            })
            .collect();

        if !codex_tools.is_empty() {
            codex_request["tools"] = serde_json::json!(codex_tools);
        }
    }

    if let Some(tool_choice) = request.get("tool_choice") {
        if let Some(tc_str) = tool_choice.as_str() {
            codex_request["tool_choice"] = serde_json::json!(tc_str);
        } else if tool_choice.is_object() {
            let tc_type = tool_choice["type"].as_str().unwrap_or("");
            if tc_type == "function" {
                codex_request["tool_choice"] = serde_json::json!({
                    "type": "function",
                    "name": tool_choice["function"]["name"]
                });
            } else if !tc_type.is_empty() {
                codex_request["tool_choice"] = tool_choice.clone();
            }
        }
    }

    if let Some(reasoning_effort) = request["reasoning_effort"].as_str() {
        codex_request["reasoning"]["effort"] = serde_json::json!(reasoning_effort);
    }

    if let Some(rf) = request.get("response_format") {
        let rf_type = rf["type"].as_str().unwrap_or("");
        match rf_type {
            "text" => {
                codex_request["text"] = serde_json::json!({
                    "format": {"type": "text"}
                });
            }
            "json_schema" => {
                if let Some(js) = rf.get("json_schema") {
                    let mut format = serde_json::json!({
                        "type": "json_schema"
                    });
                    if let Some(name) = js["name"].as_str() {
                        format["name"] = serde_json::json!(name);
                    }
                    if let Some(strict) = js["strict"].as_bool() {
                        format["strict"] = serde_json::json!(strict);
                    }
                    if let Some(schema) = js.get("schema") {
                        format["schema"] = schema.clone();
                    }
                    codex_request["text"] = serde_json::json!({
                        "format": format
                    });
                }
            }
            _ => {}
        }
    }

    Ok(codex_request)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_codex_credentials_default() {
        let creds = CodexCredentials::default();
        assert!(creds.api_key.is_none());
        assert!(creds.api_base_url.is_none());
        assert_eq!(creds.r#type, "codex");
    }

    #[test]
    fn test_codex_credentials_api_key_fields() {
        let json = r#"{
            "api_key": "sk-test",
            "api_base_url": "https://api.openai.com/v1"
        }"#;

        let creds: CodexCredentials = serde_json::from_str(json).unwrap();
        assert_eq!(creds.api_key, Some("sk-test".to_string()));
        assert_eq!(
            creds.api_base_url,
            Some("https://api.openai.com/v1".to_string())
        );

        let json2 = r#"{
            "apiKey": "sk-test-2",
            "apiBaseUrl": "https://example.com/v1"
        }"#;
        let creds2: CodexCredentials = serde_json::from_str(json2).unwrap();
        assert_eq!(creds2.api_key, Some("sk-test-2".to_string()));
        assert_eq!(
            creds2.api_base_url,
            Some("https://example.com/v1".to_string())
        );
    }

    #[test]
    fn test_codex_provider_default() {
        let provider = CodexProvider::new();
        assert!(provider.credentials.api_key.is_none());
        assert_eq!(provider.api_base_url(), DEFAULT_API_BASE_URL);
    }

    #[test]
    fn test_build_responses_url() {
        assert_eq!(
            CodexProvider::build_responses_url("https://api.openai.com"),
            "https://api.openai.com/v1/responses"
        );
        assert_eq!(
            CodexProvider::build_responses_url("https://api.openai.com/v1"),
            "https://api.openai.com/v1/responses"
        );
        assert_eq!(
            CodexProvider::build_responses_url("https://example.com/v1/"),
            "https://example.com/v1/responses"
        );
        assert_eq!(
            CodexProvider::build_responses_url("https://yunyi.cfd/codex"),
            "https://yunyi.cfd/codex/responses"
        );
        assert_eq!(
            CodexProvider::build_responses_url("https://gateway.example.com/proxy/responses"),
            "https://gateway.example.com/proxy/responses"
        );
    }

    #[test]
    fn test_supports_model() {
        assert!(CodexProvider::supports_model("gpt-4"));
        assert!(CodexProvider::supports_model("gpt-4o"));
        assert!(CodexProvider::supports_model("gpt-4-turbo"));
        assert!(CodexProvider::supports_model("GPT-4"));
        assert!(CodexProvider::supports_model("o1"));
        assert!(CodexProvider::supports_model("o1-preview"));
        assert!(CodexProvider::supports_model("o3"));
        assert!(CodexProvider::supports_model("o4-mini"));
        assert!(CodexProvider::supports_model("codex-mini"));
        assert!(CodexProvider::supports_model("gpt-4-codex"));
        assert!(!CodexProvider::supports_model("claude-3"));
        assert!(!CodexProvider::supports_model("gemini-pro"));
        assert!(!CodexProvider::supports_model("llama-2"));
    }

    #[test]
    fn test_transform_to_codex_format_basic() {
        let request = serde_json::json!({
            "model": "gpt-4o",
            "messages": [
                {"role": "system", "content": "You are a helpful assistant."},
                {"role": "user", "content": "Hello!"}
            ],
            "stream": true
        });

        let result = transform_to_codex_format(&request).unwrap();

        assert_eq!(result["model"], "gpt-4o");
        assert_eq!(result["stream"], true);
        assert_eq!(
            result["instructions"].as_str(),
            Some("You are a helpful assistant.")
        );

        let input = result["input"].as_array().unwrap();
        assert_eq!(input.len(), 1);
        assert_eq!(input[0]["role"], "user");
    }

    #[test]
    fn test_transform_to_codex_format_without_system_does_not_inject_instructions() {
        let request = serde_json::json!({
            "model": "gpt-4o",
            "messages": [
                {"role": "user", "content": "Hello!"}
            ]
        });

        let result = transform_to_codex_format(&request).unwrap();
        assert!(result.get("instructions").is_none());
    }

    #[test]
    fn test_transform_to_codex_format_uses_explicit_instructions() {
        let request = serde_json::json!({
            "model": "gpt-4o",
            "instructions": "You are a general assistant.",
            "messages": [
                {"role": "user", "content": "Hello!"}
            ]
        });

        let result = transform_to_codex_format(&request).unwrap();
        assert_eq!(
            result["instructions"].as_str(),
            Some("You are a general assistant.")
        );
    }

    #[test]
    fn test_transform_to_codex_format_with_tools() {
        let request = serde_json::json!({
            "model": "gpt-4o",
            "messages": [
                {"role": "user", "content": "What's the weather?"}
            ],
            "tools": [
                {
                    "type": "function",
                    "function": {
                        "name": "get_weather",
                        "description": "Get weather info",
                        "parameters": {"type": "object"}
                    }
                }
            ]
        });

        let result = transform_to_codex_format(&request).unwrap();

        let tools = result["tools"].as_array().unwrap();
        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0]["name"], "get_weather");
        assert_eq!(tools[0]["description"], "Get weather info");
    }

    #[test]
    fn test_transform_to_codex_format_with_parameters() {
        let request = serde_json::json!({
            "model": "gpt-4o",
            "messages": [{"role": "user", "content": "Hi"}],
            "temperature": 0.7,
            "max_tokens": 1000,
            "top_p": 0.9
        });

        let result = transform_to_codex_format(&request).unwrap();

        assert_eq!(result["temperature"], 0.7);
        assert_eq!(result["max_output_tokens"], 1000);
        assert_eq!(result["top_p"], 0.9);
    }
}
