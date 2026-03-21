//! 主题工作台上下文搜索命令
//!
//! 为左侧栏“搜索上下文”提供真正的后端检索能力，
//! 统一复用 Aster Agent + WebSearch 策略，并返回结构化结果。

use crate::agent::{AsterAgentState, AsterAgentWrapper};
use crate::config::GlobalConfigManagerState;
use crate::database::DbConnection;
use crate::services::memory_profile_prompt_service::{
    merge_system_prompt_with_memory_context, MemoryPromptContext,
};
use crate::services::web_search_prompt_service::merge_system_prompt_with_web_search;
use crate::services::web_search_runtime_service::apply_web_search_runtime_env;
use crate::services::workspace_health_service::ensure_workspace_ready_with_auto_relocate;
use crate::workspace::WorkspaceManager;
use lime_agent::{
    merge_system_prompt_with_runtime_agents, resolve_request_tool_policy_with_mode,
    stream_reply_with_policy, RequestToolPolicyMode, SessionConfigBuilder,
};
use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::State;
use url::Url;
use uuid::Uuid;

const CONTEXT_SEARCH_SESSION_PREFIX: &str = "__lime_theme_context_search__";
const FALLBACK_SUMMARY_LENGTH: usize = 420;

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ThemeContextSearchMode {
    Web,
    Social,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ThemeContextSearchRequest {
    #[serde(alias = "workspaceId")]
    pub workspace_id: String,
    #[serde(default, alias = "projectId")]
    pub project_id: Option<String>,
    #[serde(alias = "providerType", alias = "providerId")]
    pub provider_type: String,
    pub model: String,
    pub query: String,
    pub mode: ThemeContextSearchMode,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ThemeContextSearchCitation {
    pub title: String,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ThemeContextSearchResponse {
    pub title: String,
    pub summary: String,
    pub citations: Vec<ThemeContextSearchCitation>,
    pub raw_response: String,
    pub attempts_summary: String,
}

#[derive(Debug, Clone)]
struct ParsedThemeContextSearchPayload {
    title: Option<String>,
    summary: Option<String>,
    citations: Vec<ThemeContextSearchCitation>,
}

fn normalize_whitespace(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn build_context_search_prompt(query: &str, mode: ThemeContextSearchMode) -> String {
    let social_constraint = match mode {
        ThemeContextSearchMode::Social => [
            "优先寻找社交媒体平台、品牌官方账号、媒体社媒账号、KOL/KOC 讨论与趋势帖相关信息。",
            "如果直接社媒来源不足，可补充官方网站或媒体报道，但摘要必须保留社媒传播视角。",
            "适当优先关注小红书、微博、公众号、抖音、B站、知乎等中文平台。",
        ]
        .join("\n"),
        ThemeContextSearchMode::Web => {
            "优先提供最新且可信的公开网络资料，兼顾官方来源与主流媒体。".to_string()
        }
    };

    [
        "你是 Lime 的资料检索助手。",
        "请先执行联网搜索，再输出整理结果。",
        "你必须返回且仅返回一个 JSON 对象，不要使用 Markdown 代码块，不要输出多余说明。",
        "JSON 结构如下：",
        r#"{"title":"","summary":"","citations":[{"title":"","url":""}]}"#,
        "字段要求：",
        "1. title：12-28 字中文标题，概括本次检索主题。",
        "2. summary：180-320 字中文摘要，聚合 3-5 个来源，突出时间点、关键事实、趋势或洞察。",
        "3. citations：保留 3-5 条最重要来源，必须带可访问 URL。",
        social_constraint.as_str(),
        &format!("检索主题：{}", query.trim()),
    ]
    .join("\n")
}

fn strip_code_fence(value: &str) -> String {
    value
        .trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim()
        .to_string()
}

fn build_citation_title_from_url(url: &str) -> String {
    Url::parse(url)
        .ok()
        .and_then(|parsed| {
            parsed
                .host_str()
                .map(|host| host.trim_start_matches("www.").to_string())
        })
        .filter(|host| !host.is_empty())
        .unwrap_or_else(|| "来源链接".to_string())
}

fn sanitize_url(url: &str) -> String {
    url.trim_end_matches(&[',', ')', '.', ';', '!', '?'][..])
        .trim()
        .to_string()
}

fn parse_json_payload(raw_response: &str) -> Option<ParsedThemeContextSearchPayload> {
    let trimmed = raw_response.trim();
    if trimmed.is_empty() {
        return None;
    }

    let fenced_match = regex::Regex::new(r"```(?:json)?\s*([\s\S]*?)\s*```")
        .ok()
        .and_then(|regex| regex.captures(trimmed))
        .and_then(|captures| captures.get(1).map(|value| value.as_str().to_string()));
    let json_block_match = regex::Regex::new(r"\{[\s\S]*\}")
        .ok()
        .and_then(|regex| regex.find(trimmed))
        .map(|value| value.as_str().to_string());

    let mut candidates = Vec::new();
    if let Some(value) = fenced_match {
        candidates.push(value);
    }
    if let Some(value) = json_block_match {
        candidates.push(value);
    }
    candidates.push(trimmed.to_string());

    for candidate in candidates {
        let normalized = strip_code_fence(&candidate);
        let parsed = match serde_json::from_str::<serde_json::Value>(&normalized) {
            Ok(value) => value,
            Err(_) => continue,
        };

        let citations_raw = parsed
            .get("citations")
            .and_then(serde_json::Value::as_array)
            .or_else(|| parsed.get("sources").and_then(serde_json::Value::as_array));

        let citations = citations_raw
            .into_iter()
            .flatten()
            .filter_map(|item| {
                let url = item
                    .get("url")
                    .and_then(serde_json::Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())?;
                let title = item
                    .get("title")
                    .and_then(serde_json::Value::as_str)
                    .or_else(|| item.get("name").and_then(serde_json::Value::as_str))
                    .map(normalize_whitespace)
                    .filter(|value| !value.is_empty())
                    .unwrap_or_else(|| build_citation_title_from_url(url));
                Some(ThemeContextSearchCitation {
                    title,
                    url: url.to_string(),
                })
            })
            .take(5)
            .collect::<Vec<_>>();

        let title = parsed
            .get("title")
            .and_then(serde_json::Value::as_str)
            .map(normalize_whitespace)
            .filter(|value| !value.is_empty());
        let summary = parsed
            .get("summary")
            .and_then(serde_json::Value::as_str)
            .or_else(|| parsed.get("content").and_then(serde_json::Value::as_str))
            .map(normalize_whitespace)
            .filter(|value| !value.is_empty());

        return Some(ParsedThemeContextSearchPayload {
            title,
            summary,
            citations,
        });
    }

    None
}

fn extract_citations_from_text(raw_response: &str) -> Vec<ThemeContextSearchCitation> {
    let mut citations = Vec::new();
    let mut seen = std::collections::HashSet::new();

    if let Ok(markdown_regex) = regex::Regex::new(r"\[([^\]]+)\]\((https?://[^\s)]+)\)") {
        for captures in markdown_regex.captures_iter(raw_response) {
            let url = captures
                .get(2)
                .map(|value| sanitize_url(value.as_str()))
                .unwrap_or_default();
            if url.is_empty() || !seen.insert(url.clone()) {
                continue;
            }
            let title = captures
                .get(1)
                .map(|value| normalize_whitespace(value.as_str()))
                .filter(|value| !value.is_empty())
                .unwrap_or_else(|| build_citation_title_from_url(&url));
            citations.push(ThemeContextSearchCitation { title, url });
            if citations.len() >= 5 {
                return citations;
            }
        }
    }

    if let Ok(url_regex) = regex::Regex::new(r"https?://[^\s)\]]+") {
        for captures in url_regex.find_iter(raw_response) {
            let url = sanitize_url(captures.as_str());
            if url.is_empty() || !seen.insert(url.clone()) {
                continue;
            }
            citations.push(ThemeContextSearchCitation {
                title: build_citation_title_from_url(&url),
                url,
            });
            if citations.len() >= 5 {
                break;
            }
        }
    }

    citations
}

fn build_fallback_summary(raw_response: &str) -> String {
    let without_citations = regex::Regex::new(r#""citations"\s*:\s*\[[\s\S]*?\]"#)
        .ok()
        .map(|regex| {
            regex
                .replace_all(&strip_code_fence(raw_response), "")
                .to_string()
        })
        .unwrap_or_else(|| strip_code_fence(raw_response));
    let normalized =
        normalize_whitespace(&without_citations.replace(&['{', '}', '[', ']', '"'][..], " "));

    if normalized.is_empty() {
        return "暂无可用摘要，请重新尝试检索。".to_string();
    }

    if normalized.chars().count() <= FALLBACK_SUMMARY_LENGTH {
        return normalized;
    }

    let mut summary = normalized
        .chars()
        .take(FALLBACK_SUMMARY_LENGTH)
        .collect::<String>();
    summary.push_str("...");
    summary
}

fn build_fallback_title(query: &str, mode: ThemeContextSearchMode) -> String {
    let suffix = match mode {
        ThemeContextSearchMode::Social => "社媒搜索上下文",
        ThemeContextSearchMode::Web => "网络搜索上下文",
    };
    format!("{} · {}", query.trim(), suffix)
}

fn normalize_search_result(
    raw_response: &str,
    query: &str,
    mode: ThemeContextSearchMode,
    attempts_summary: String,
) -> ThemeContextSearchResponse {
    let parsed = parse_json_payload(raw_response);
    let citations = parsed
        .as_ref()
        .filter(|payload| !payload.citations.is_empty())
        .map(|payload| payload.citations.clone())
        .unwrap_or_else(|| extract_citations_from_text(raw_response));

    ThemeContextSearchResponse {
        title: parsed
            .as_ref()
            .and_then(|payload| payload.title.clone())
            .unwrap_or_else(|| build_fallback_title(query, mode)),
        summary: parsed
            .as_ref()
            .and_then(|payload| payload.summary.clone())
            .unwrap_or_else(|| build_fallback_summary(raw_response)),
        citations,
        raw_response: raw_response.to_string(),
        attempts_summary,
    }
}

#[tauri::command]
pub async fn aster_agent_theme_context_search(
    state: State<'_, AsterAgentState>,
    db: State<'_, DbConnection>,
    config_manager: State<'_, GlobalConfigManagerState>,
    request: ThemeContextSearchRequest,
) -> Result<ThemeContextSearchResponse, String> {
    let workspace_id = request.workspace_id.trim().to_string();
    if workspace_id.is_empty() {
        return Err("workspace_id 必填，请先选择项目工作区".to_string());
    }

    let provider_type = request.provider_type.trim().to_string();
    if provider_type.is_empty() {
        return Err("当前未选择可用模型，无法执行联网搜索".to_string());
    }

    let model = request.model.trim().to_string();
    if model.is_empty() {
        return Err("当前未选择可用模型，无法执行联网搜索".to_string());
    }

    let query = request.query.trim().to_string();
    if query.is_empty() {
        return Err("搜索词不能为空".to_string());
    }

    if !state.is_initialized().await {
        state.init_agent_with_db(&db).await?;
    }

    let manager = WorkspaceManager::new(db.inner().clone());
    let workspace = manager
        .get(&workspace_id)
        .map_err(|error| format!("读取 workspace 失败: {error}"))?
        .ok_or_else(|| format!("Workspace 不存在: {workspace_id}"))?;
    let ensured = ensure_workspace_ready_with_auto_relocate(&manager, &workspace)?;
    let workspace_root = ensured.root_path.to_string_lossy().to_string();

    let runtime_config = config_manager.config();
    apply_web_search_runtime_env(&runtime_config);

    let project_prompt = request
        .project_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .and_then(|project_id| {
            match AsterAgentState::build_project_system_prompt(&db, project_id) {
                Ok(prompt) => Some(prompt),
                Err(error) => {
                    tracing::warn!(
                        "[ThemeContextSearch] 加载项目上下文失败，降级为基础搜索提示词: {}",
                        error
                    );
                    None
                }
            }
        });

    let request_tool_policy = resolve_request_tool_policy_with_mode(
        Some(true),
        Some(RequestToolPolicyMode::Required),
        false,
    );
    let system_prompt = lime_agent::merge_system_prompt_with_request_tool_policy(
        merge_system_prompt_with_web_search(
            merge_system_prompt_with_memory_context(
                merge_system_prompt_with_runtime_agents(
                    project_prompt,
                    Some(Path::new(&workspace_root)),
                ),
                &runtime_config,
                MemoryPromptContext::with_working_dir(Path::new(&workspace_root)),
            ),
            &runtime_config,
        ),
        &request_tool_policy,
    );

    let session_id = format!("{}-{}", CONTEXT_SEARCH_SESSION_PREFIX, Uuid::new_v4());
    state
        .configure_provider_from_pool(&db, &provider_type, &model, &session_id)
        .await?;

    let cancel_token = state.create_cancel_token(&session_id).await;
    let execution_result = {
        let agent_arc = state.get_agent_arc();
        let guard = agent_arc.read().await;
        let agent = guard
            .as_ref()
            .ok_or_else(|| "Agent not initialized".to_string())?;

        let mut session_config_builder = SessionConfigBuilder::new(&session_id);
        session_config_builder = session_config_builder.include_context_trace(false);
        if let Some(prompt) = system_prompt {
            session_config_builder = session_config_builder.system_prompt(prompt);
        }

        stream_reply_with_policy(
            agent,
            &build_context_search_prompt(&query, request.mode),
            Some(Path::new(&workspace_root)),
            session_config_builder.build(),
            Some(cancel_token.clone()),
            &request_tool_policy,
            |_| {},
        )
        .await
    };

    state.remove_cancel_token(&session_id).await;
    if let Err(error) = AsterAgentWrapper::delete_session(&db, &session_id).await {
        tracing::warn!(
            "[ThemeContextSearch] 删除临时会话失败: session={}, error={}",
            session_id,
            error
        );
    }

    let execution = execution_result.map_err(|error| error.message)?;
    let raw_response = execution.text_output.trim().to_string();
    if raw_response.is_empty() {
        return Err("上下文搜索未返回可用内容，请重试".to_string());
    }

    Ok(normalize_search_result(
        &raw_response,
        &query,
        request.mode,
        execution.attempts_summary,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn should_parse_json_result() {
        let result = normalize_search_result(
            r#"{"title":"智能体市场观察","summary":"市场讨论聚焦推理成本、工作流平台和企业落地节奏。","citations":[{"title":"官方博客","url":"https://example.com/blog"}]}"#,
            "智能体市场 2026",
            ThemeContextSearchMode::Web,
            "WebSearch#1:success".to_string(),
        );

        assert_eq!(result.title, "智能体市场观察");
        assert!(result.summary.contains("推理成本"));
        assert_eq!(
            result.citations,
            vec![ThemeContextSearchCitation {
                title: "官方博客".to_string(),
                url: "https://example.com/blog".to_string(),
            }]
        );
        assert_eq!(result.attempts_summary, "WebSearch#1:success");
    }

    #[test]
    fn should_fallback_to_text_and_links_when_json_invalid() {
        let result = normalize_search_result(
            [
                "2026 年社交媒体讨论聚焦 Agent 产品的真实 ROI。",
                "参考链接：",
                "[小红书热议](https://example.com/xhs)",
                "https://example.com/weibo",
            ]
            .join("\n")
            .as_str(),
            "Agent 社媒讨论",
            ThemeContextSearchMode::Social,
            "WebSearch#1:success".to_string(),
        );

        assert!(result.title.contains("Agent 社媒讨论"));
        assert!(result.summary.contains("真实 ROI"));
        assert_eq!(
            result.citations,
            vec![
                ThemeContextSearchCitation {
                    title: "小红书热议".to_string(),
                    url: "https://example.com/xhs".to_string(),
                },
                ThemeContextSearchCitation {
                    title: "example.com".to_string(),
                    url: "https://example.com/weibo".to_string(),
                },
            ]
        );
    }

    #[test]
    fn should_deserialize_theme_context_request_with_aliases() {
        let request: ThemeContextSearchRequest = serde_json::from_str(
            r#"{
                "workspaceId": "workspace-test",
                "projectId": "project-test",
                "providerType": "openai",
                "model": "gpt-4.1",
                "query": "AI Agent 最新动态",
                "mode": "web"
            }"#,
        )
        .expect("request should deserialize");

        assert_eq!(request.workspace_id, "workspace-test");
        assert_eq!(request.project_id.as_deref(), Some("project-test"));
        assert_eq!(request.provider_type, "openai");
        assert_eq!(request.model, "gpt-4.1");
        assert_eq!(request.mode, ThemeContextSearchMode::Web);
    }
}
