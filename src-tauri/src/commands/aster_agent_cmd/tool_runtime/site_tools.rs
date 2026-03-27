use super::*;
#[cfg(test)]
use crate::services::site_capability_service::{
    build_site_result_document_body, save_site_result_to_project,
};
use crate::services::site_capability_service::{
    get_site_adapter, list_site_adapters, recommend_site_adapters,
    run_site_adapter_with_optional_save, search_site_adapters, RunSiteAdapterRequest,
};
#[cfg(test)]
use crate::services::site_capability_service::{
    SiteAdapterDefinition, SiteAdapterRecommendation, SiteAdapterRunResult,
};
use aster::session::{load_shared_session_runtime_snapshot, SessionRuntimeSnapshot};
use serde_json::Value;

const PROJECT_ID_ENV_KEYS: &[&str] = &["LIME_PROJECT_ID", "PROXYCAST_PROJECT_ID"];
const CONTENT_ID_ENV_KEYS: &[&str] = &["LIME_CONTENT_ID", "PROXYCAST_CONTENT_ID"];

#[derive(Debug, Clone, Copy)]
enum LimeSiteToolKind {
    List,
    Recommend,
    Search,
    Info,
    Run,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum LimeSiteSaveTargetSource {
    ExplicitProject,
    ContextProject,
    ExplicitContent,
    ContextContent,
}

impl LimeSiteSaveTargetSource {
    fn as_str(self) -> &'static str {
        match self {
            LimeSiteSaveTargetSource::ExplicitProject => "explicit_project",
            LimeSiteSaveTargetSource::ContextProject => "context_project",
            LimeSiteSaveTargetSource::ExplicitContent => "explicit_content",
            LimeSiteSaveTargetSource::ContextContent => "context_content",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct LimeSiteSaveTarget {
    project_id: Option<String>,
    content_id: Option<String>,
    source: LimeSiteSaveTargetSource,
}

#[derive(Debug, Clone)]
pub(crate) struct LimeSiteTool {
    tool_name: String,
    description: String,
    input_schema: serde_json::Value,
    kind: LimeSiteToolKind,
    db: DbConnection,
}

impl LimeSiteTool {
    fn new(
        tool_name: String,
        description: impl Into<String>,
        input_schema: serde_json::Value,
        kind: LimeSiteToolKind,
        db: DbConnection,
    ) -> Self {
        Self {
            tool_name,
            description: description.into(),
            input_schema,
            kind,
            db,
        }
    }

    fn extract_required_string(
        params: &serde_json::Value,
        keys: &[&str],
        field_name: &str,
    ) -> Result<String, ToolError> {
        keys.iter()
            .find_map(|key| {
                params
                    .get(*key)
                    .and_then(serde_json::Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(ToString::to_string)
            })
            .ok_or_else(|| ToolError::invalid_params(format!("{field_name} 不能为空")))
    }

    fn extract_optional_string(params: &serde_json::Value, keys: &[&str]) -> Option<String> {
        keys.iter().find_map(|key| {
            params
                .get(*key)
                .and_then(serde_json::Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string)
        })
    }

    fn extract_profile_key(
        params: &serde_json::Value,
        context: &ToolContext,
        session_hint: Option<&BrowserAssistRuntimeHint>,
    ) -> Option<String> {
        Self::extract_optional_string(params, &["profile_key"])
            .or_else(|| session_hint.map(|hint| hint.profile_key.clone()))
            .or_else(|| {
                context
                    .environment
                    .get(BROWSER_PROFILE_KEY_ENV_KEYS[0])
                    .cloned()
            })
            .or_else(|| {
                context
                    .environment
                    .get(BROWSER_PROFILE_KEY_ENV_KEYS[1])
                    .cloned()
            })
    }

    fn build_list_schema() -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {},
            "additionalProperties": false,
        })
    }

    fn build_search_schema() -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "搜索适配器的关键词，可按站点名、域名或能力搜索"
                }
            },
            "required": ["query"],
            "additionalProperties": false,
        })
    }

    fn build_recommend_schema() -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "limit": {
                    "type": "integer",
                    "description": "可选返回数量上限；未传时返回按浏览器上下文排序后的推荐列表"
                }
            },
            "additionalProperties": false,
        })
    }

    fn build_info_schema() -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "adapter_name": {
                    "type": "string",
                    "description": "适配器名称，例如 github/search"
                }
            },
            "required": ["adapter_name"],
            "additionalProperties": false,
        })
    }

    fn build_run_schema() -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "adapter_name": {
                    "type": "string",
                    "description": "适配器名称，例如 zhihu/search"
                },
                "args": {
                    "type": "object",
                    "description": "适配器参数对象"
                },
                "profile_key": {
                    "type": "string",
                    "description": "浏览器资料 Key，可选；未传时优先复用当前 browser assist 会话，否则自动选择已连接的 existing_session 或最合适的资料"
                },
                "target_id": {
                    "type": "string",
                    "description": "可选的指定标签页 target_id"
                },
                "timeout_ms": {
                    "type": "integer",
                    "description": "脚本执行超时时间，毫秒"
                },
                "content_id": {
                    "type": "string",
                    "description": "可选内容 ID；未传时优先复用当前内容上下文，成功后优先写回当前主稿"
                },
                "project_id": {
                    "type": "string",
                    "description": "可选项目 ID；未传时优先复用当前项目上下文。仅当没有 content_id 时，成功后会保存为新资源文档"
                },
                "save_title": {
                    "type": "string",
                    "description": "可选保存标题；仅在保存为新资源文档时生效"
                }
            },
            "required": ["adapter_name"],
            "additionalProperties": false,
        })
    }

    fn extract_project_id_from_value(value: Option<&Value>) -> Option<String> {
        value
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string)
    }

    fn extract_content_id_from_value(value: Option<&Value>) -> Option<String> {
        value
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string)
    }

    fn extract_project_id_from_metadata_map(
        metadata: &HashMap<String, serde_json::Value>,
    ) -> Option<String> {
        ["project_id", "projectId"]
            .iter()
            .find_map(|key| Self::extract_project_id_from_value(metadata.get(*key)))
    }

    fn extract_content_id_from_metadata_map(
        metadata: &HashMap<String, serde_json::Value>,
    ) -> Option<String> {
        ["content_id", "contentId"]
            .iter()
            .find_map(|key| Self::extract_content_id_from_value(metadata.get(*key)))
    }

    fn extract_project_id_from_runtime_snapshot(
        snapshot: &SessionRuntimeSnapshot,
    ) -> Option<String> {
        snapshot
            .threads
            .iter()
            .flat_map(|thread| thread.turns.iter())
            .filter_map(|turn| {
                let project_id = turn.context_override.as_ref().and_then(|context| {
                    Self::extract_project_id_from_metadata_map(&context.metadata)
                })?;
                Some((turn.updated_at, project_id))
            })
            .max_by_key(|(updated_at, _)| *updated_at)
            .map(|(_, project_id)| project_id)
            .or_else(|| {
                snapshot
                    .threads
                    .iter()
                    .filter_map(|thread| {
                        let project_id =
                            Self::extract_project_id_from_metadata_map(&thread.thread.metadata)?;
                        Some((thread.thread.updated_at, project_id))
                    })
                    .max_by_key(|(updated_at, _)| *updated_at)
                    .map(|(_, project_id)| project_id)
            })
    }

    fn extract_content_id_from_runtime_snapshot(
        snapshot: &SessionRuntimeSnapshot,
    ) -> Option<String> {
        snapshot
            .threads
            .iter()
            .flat_map(|thread| thread.turns.iter())
            .filter_map(|turn| {
                let content_id = turn.context_override.as_ref().and_then(|context| {
                    Self::extract_content_id_from_metadata_map(&context.metadata)
                })?;
                Some((turn.updated_at, content_id))
            })
            .max_by_key(|(updated_at, _)| *updated_at)
            .map(|(_, content_id)| content_id)
            .or_else(|| {
                snapshot
                    .threads
                    .iter()
                    .filter_map(|thread| {
                        let content_id =
                            Self::extract_content_id_from_metadata_map(&thread.thread.metadata)?;
                        Some((thread.thread.updated_at, content_id))
                    })
                    .max_by_key(|(updated_at, _)| *updated_at)
                    .map(|(_, content_id)| content_id)
            })
    }

    fn extract_project_id_from_context_environment(context: &ToolContext) -> Option<String> {
        PROJECT_ID_ENV_KEYS.iter().find_map(|key| {
            context
                .environment
                .get(*key)
                .map(String::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string)
        })
    }

    fn extract_content_id_from_context_environment(context: &ToolContext) -> Option<String> {
        CONTENT_ID_ENV_KEYS.iter().find_map(|key| {
            context
                .environment
                .get(*key)
                .map(String::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string)
        })
    }

    async fn resolve_context_project_id(context: &ToolContext) -> Option<String> {
        let session_id = context.session_id.trim();
        if !session_id.is_empty() {
            match load_shared_session_runtime_snapshot(session_id).await {
                Ok(snapshot) => {
                    if let Some(project_id) =
                        Self::extract_project_id_from_runtime_snapshot(&snapshot)
                    {
                        return Some(project_id);
                    }
                }
                Err(error) => {
                    tracing::debug!(
                        "[AsterAgent][SiteTool] 读取 runtime snapshot 失败，跳过上下文项目解析: session_id={}, error={}",
                        session_id,
                        error
                    );
                }
            }
        }

        Self::extract_project_id_from_context_environment(context)
    }

    async fn resolve_context_content_id(context: &ToolContext) -> Option<String> {
        let session_id = context.session_id.trim();
        if !session_id.is_empty() {
            match load_shared_session_runtime_snapshot(session_id).await {
                Ok(snapshot) => {
                    if let Some(content_id) =
                        Self::extract_content_id_from_runtime_snapshot(&snapshot)
                    {
                        return Some(content_id);
                    }
                }
                Err(error) => {
                    tracing::debug!(
                        "[AsterAgent][SiteTool] 读取 runtime snapshot 失败，跳过上下文内容解析: session_id={}, error={}",
                        session_id,
                        error
                    );
                }
            }
        }

        Self::extract_content_id_from_context_environment(context)
    }

    async fn resolve_save_target(
        params: &serde_json::Value,
        context: &ToolContext,
    ) -> Option<LimeSiteSaveTarget> {
        if let Some(content_id) = Self::extract_optional_string(params, &["content_id"]) {
            return Some(LimeSiteSaveTarget {
                project_id: None,
                content_id: Some(content_id),
                source: LimeSiteSaveTargetSource::ExplicitContent,
            });
        }

        if let Some(project_id) = Self::extract_optional_string(params, &["project_id"]) {
            return Some(LimeSiteSaveTarget {
                project_id: Some(project_id),
                content_id: None,
                source: LimeSiteSaveTargetSource::ExplicitProject,
            });
        }

        if let Some(content_id) = Self::resolve_context_content_id(context).await {
            return Some(LimeSiteSaveTarget {
                project_id: None,
                content_id: Some(content_id),
                source: LimeSiteSaveTargetSource::ContextContent,
            });
        }

        Self::resolve_context_project_id(context)
            .await
            .map(|project_id| LimeSiteSaveTarget {
                project_id: Some(project_id),
                content_id: None,
                source: LimeSiteSaveTargetSource::ContextProject,
            })
    }

    fn apply_save_target_to_run_result(
        mut result: crate::services::site_capability_service::SiteAdapterRunResult,
        save_target: Option<&LimeSiteSaveTarget>,
    ) -> crate::services::site_capability_service::SiteAdapterRunResult {
        let Some(save_target) = save_target else {
            return result;
        };

        let normalized_source = save_target.source.as_str().to_string();
        if result.saved_content.is_some() || result.saved_project_id.is_some() {
            result.saved_by = Some(normalized_source.clone());
        }
        if result.save_skipped_by.is_some() || result.save_skipped_project_id.is_some() {
            result.save_skipped_by = Some(normalized_source);
        }

        result
    }

    fn attach_run_result_metadata(
        mut tool_result: ToolResult,
        result: &crate::services::site_capability_service::SiteAdapterRunResult,
        adapter_definition: Option<
            &crate::services::site_capability_service::SiteAdapterDefinition,
        >,
        browser_session: Option<serde_json::Value>,
    ) -> ToolResult {
        tool_result = tool_result
            .with_metadata("tool_family", serde_json::json!("site"))
            .with_metadata("adapter_name", serde_json::json!(result.adapter.clone()))
            .with_metadata("result", serde_json::json!(result.clone()));

        if let Some(saved_content) = result.saved_content.clone() {
            tool_result =
                tool_result.with_metadata("saved_content", serde_json::json!(saved_content));
        }
        if let Some(saved_project_id) = result.saved_project_id.as_ref() {
            tool_result =
                tool_result.with_metadata("saved_project_id", serde_json::json!(saved_project_id));
        }
        if let Some(saved_by) = result.saved_by.as_ref() {
            tool_result = tool_result.with_metadata("saved_by", serde_json::json!(saved_by));
        }
        if let Some(save_skipped_project_id) = result.save_skipped_project_id.as_ref() {
            tool_result = tool_result.with_metadata(
                "save_skipped_project_id",
                serde_json::json!(save_skipped_project_id),
            );
        }
        if let Some(save_skipped_by) = result.save_skipped_by.as_ref() {
            tool_result =
                tool_result.with_metadata("save_skipped_by", serde_json::json!(save_skipped_by));
        }
        if let Some(save_error_message) = result.save_error_message.as_ref() {
            tool_result = tool_result
                .with_metadata("save_error_message", serde_json::json!(save_error_message));
        }
        if let Some(adapter) = adapter_definition {
            if let Some(source_kind) = adapter.source_kind.as_ref() {
                tool_result = tool_result
                    .with_metadata("adapter_source_kind", serde_json::json!(source_kind));
            }
            if let Some(source_version) = adapter.source_version.as_ref() {
                tool_result = tool_result
                    .with_metadata("adapter_source_version", serde_json::json!(source_version));
            }
        }
        if let Some(browser_session) = browser_session {
            tool_result = tool_result.with_metadata("browser_session", browser_session);
        }

        tool_result
    }
}

#[async_trait]
impl Tool for LimeSiteTool {
    fn name(&self) -> &str {
        &self.tool_name
    }

    fn description(&self) -> &str {
        &self.description
    }

    fn input_schema(&self) -> serde_json::Value {
        self.input_schema.clone()
    }

    fn options(&self) -> ToolOptions {
        ToolOptions::new()
            .with_max_retries(1)
            .with_base_timeout(Duration::from_secs(90))
            .with_dynamic_timeout(false)
    }

    async fn execute(
        &self,
        params: serde_json::Value,
        context: &ToolContext,
    ) -> Result<ToolResult, ToolError> {
        let session_hint = get_browser_assist_runtime_hint(&context.session_id).await;
        match self.kind {
            LimeSiteToolKind::List => {
                let result = list_site_adapters();
                let payload = serde_json::to_string_pretty(&result).map_err(|error| {
                    ToolError::execution_failed(format!("序列化适配器列表失败: {error}"))
                })?;
                Ok(ToolResult::success(payload)
                    .with_metadata("tool_family", serde_json::json!("site"))
                    .with_metadata("result", serde_json::json!(result)))
            }
            LimeSiteToolKind::Recommend => {
                let limit = params.get("limit").and_then(serde_json::Value::as_u64);
                let limit = limit
                    .and_then(|value| usize::try_from(value).ok())
                    .filter(|value| *value > 0);
                let result = recommend_site_adapters(&self.db, limit)
                    .await
                    .map_err(ToolError::execution_failed)?;
                let payload = serde_json::to_string_pretty(&result).map_err(|error| {
                    ToolError::execution_failed(format!("序列化站点推荐结果失败: {error}"))
                })?;
                Ok(ToolResult::success(payload)
                    .with_metadata("tool_family", serde_json::json!("site"))
                    .with_metadata("result", serde_json::json!(result)))
            }
            LimeSiteToolKind::Search => {
                let query = Self::extract_required_string(&params, &["query"], "query")?;
                let result = search_site_adapters(&query);
                let payload = serde_json::to_string_pretty(&result).map_err(|error| {
                    ToolError::execution_failed(format!("序列化适配器搜索结果失败: {error}"))
                })?;
                Ok(ToolResult::success(payload)
                    .with_metadata("tool_family", serde_json::json!("site"))
                    .with_metadata("query", serde_json::json!(query))
                    .with_metadata("result", serde_json::json!(result)))
            }
            LimeSiteToolKind::Info => {
                let adapter_name = Self::extract_required_string(
                    &params,
                    &["adapter_name", "name"],
                    "adapter_name",
                )?;
                let result = get_site_adapter(&adapter_name).ok_or_else(|| {
                    ToolError::invalid_params("未找到对应的站点适配器".to_string())
                })?;
                let payload = serde_json::to_string_pretty(&result).map_err(|error| {
                    ToolError::execution_failed(format!("序列化适配器详情失败: {error}"))
                })?;
                Ok(ToolResult::success(payload)
                    .with_metadata("tool_family", serde_json::json!("site"))
                    .with_metadata("adapter_name", serde_json::json!(adapter_name))
                    .with_metadata("result", serde_json::json!(result)))
            }
            LimeSiteToolKind::Run => {
                let adapter_name = Self::extract_required_string(
                    &params,
                    &["adapter_name", "name"],
                    "adapter_name",
                )?;
                let adapter_definition = get_site_adapter(&adapter_name);
                let profile_key =
                    Self::extract_profile_key(&params, context, session_hint.as_ref());
                let args = params
                    .get("args")
                    .cloned()
                    .unwrap_or_else(|| serde_json::json!({}));
                let target_id = Self::extract_optional_string(&params, &["target_id"]);
                let timeout_ms = params.get("timeout_ms").and_then(serde_json::Value::as_u64);
                let save_target = Self::resolve_save_target(&params, context).await;
                let save_title = Self::extract_optional_string(&params, &["save_title"]);
                let run_request = RunSiteAdapterRequest {
                    adapter_name: adapter_name.clone(),
                    args,
                    profile_key,
                    target_id,
                    timeout_ms,
                    content_id: save_target
                        .as_ref()
                        .and_then(|target| target.content_id.clone()),
                    project_id: save_target
                        .as_ref()
                        .and_then(|target| target.project_id.clone()),
                    save_title,
                };

                let result = Self::apply_save_target_to_run_result(
                    run_site_adapter_with_optional_save(&self.db, run_request.clone()).await,
                    save_target.as_ref(),
                );
                let browser_session = if result.session_id.is_some() || result.target_id.is_some() {
                    Some(serde_json::json!({
                        "session_id": result.session_id,
                        "target_id": result.target_id,
                        "profile_key": result.profile_key,
                    }))
                } else {
                    None
                };
                let payload = serde_json::to_string_pretty(&result).map_err(|error| {
                    ToolError::execution_failed(format!("序列化站点执行结果失败: {error}"))
                })?;

                if result.ok {
                    Ok(Self::attach_run_result_metadata(
                        ToolResult::success(payload),
                        &result,
                        adapter_definition.as_ref(),
                        browser_session,
                    ))
                } else {
                    Ok(Self::attach_run_result_metadata(
                        ToolResult::error(
                            result
                                .error_message
                                .clone()
                                .unwrap_or_else(|| "站点命令执行失败".to_string()),
                        ),
                        &result,
                        adapter_definition.as_ref(),
                        browser_session,
                    ))
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::content::{ContentManager, ContentType};
    use crate::database::schema::create_tables;
    use crate::workspace::{WorkspaceManager, WorkspaceType};
    use aster::session::{
        SessionRuntimeSnapshot, ThreadRuntime, ThreadRuntimeSnapshot, TurnContextOverride,
        TurnRuntime,
    };
    use chrono::{Duration as ChronoDuration, Utc};
    use rusqlite::Connection;
    use std::sync::{Arc, Mutex};
    use tempfile::tempdir;

    fn setup_test_db() -> DbConnection {
        let conn = Connection::open_in_memory().expect("创建内存数据库失败");
        create_tables(&conn).expect("初始化表结构失败");
        Arc::new(Mutex::new(conn))
    }

    #[test]
    fn should_include_project_save_fields_in_run_schema() {
        let schema = LimeSiteTool::build_run_schema();
        let properties = schema
            .get("properties")
            .and_then(serde_json::Value::as_object)
            .expect("properties should exist");

        assert!(properties.contains_key("content_id"));
        assert!(properties.contains_key("project_id"));
        assert!(properties.contains_key("save_title"));
    }

    #[test]
    fn should_include_limit_field_in_recommend_schema() {
        let schema = LimeSiteTool::build_recommend_schema();
        let properties = schema
            .get("properties")
            .and_then(serde_json::Value::as_object)
            .expect("properties should exist");

        assert!(properties.contains_key("limit"));
    }

    #[test]
    fn should_build_site_result_document_body_with_sections() {
        let adapter = SiteAdapterDefinition {
            name: "github/search".to_string(),
            domain: "github.com".to_string(),
            description: "按关键词采集 GitHub 仓库搜索结果。".to_string(),
            read_only: true,
            capabilities: vec!["search".to_string()],
            input_schema: serde_json::json!({}),
            example_args: serde_json::json!({"query":"mcp","limit":5}),
            example: "github/search {\"query\":\"mcp\"}".to_string(),
            auth_hint: Some("请先登录 GitHub。".to_string()),
            source_kind: Some("bundled".to_string()),
            source_version: Some("2026-03-25".to_string()),
        };
        let request = RunSiteAdapterRequest {
            adapter_name: "github/search".to_string(),
            args: serde_json::json!({"query":"mcp","limit":5}),
            profile_key: Some("general_browser_assist".to_string()),
            target_id: None,
            timeout_ms: Some(20_000),
            content_id: None,
            project_id: None,
            save_title: None,
        };
        let result = SiteAdapterRunResult {
            ok: true,
            adapter: "github/search".to_string(),
            domain: "github.com".to_string(),
            profile_key: "general_browser_assist".to_string(),
            session_id: Some("session-1".to_string()),
            target_id: Some("target-1".to_string()),
            entry_url: "https://github.com/search?q=mcp&type=repositories".to_string(),
            source_url: Some("https://github.com/search?q=mcp&type=repositories".to_string()),
            data: Some(serde_json::json!({
                "items": [
                    {"title": "modelcontextprotocol/servers"}
                ]
            })),
            error_code: None,
            error_message: None,
            auth_hint: Some("请先登录 GitHub。".to_string()),
            report_hint: None,
            saved_content: None,
            saved_project_id: None,
            saved_by: None,
            save_skipped_project_id: None,
            save_skipped_by: None,
            save_error_message: None,
        };

        let body = build_site_result_document_body(&adapter, &request, &result);

        assert!(body.contains("# 站点采集结果"));
        assert!(body.contains("## 执行参数"));
        assert!(body.contains("\"query\": \"mcp\""));
        assert!(body.contains("## 结构化结果"));
        assert!(body.contains("modelcontextprotocol/servers"));
        assert!(body.contains("## 登录提示"));
    }

    #[test]
    fn should_save_site_result_to_project_as_document_content() {
        let db = setup_test_db();
        let workspace_root = tempdir().expect("创建临时目录失败");
        let workspace = WorkspaceManager::new(db.clone())
            .create_with_type(
                "站点采集项目".to_string(),
                workspace_root.path().join("site-adapter-project"),
                WorkspaceType::Document,
            )
            .expect("创建测试项目失败");
        let adapter = SiteAdapterDefinition {
            name: "github/search".to_string(),
            domain: "github.com".to_string(),
            description: "按关键词采集 GitHub 仓库搜索结果。".to_string(),
            read_only: true,
            capabilities: vec!["search".to_string()],
            input_schema: serde_json::json!({}),
            example_args: serde_json::json!({"query":"mcp","limit":5}),
            example: "github/search {\"query\":\"mcp\"}".to_string(),
            auth_hint: Some("请先登录 GitHub。".to_string()),
            source_kind: Some("bundled".to_string()),
            source_version: Some("2026-03-25".to_string()),
        };
        let request = RunSiteAdapterRequest {
            adapter_name: "github/search".to_string(),
            args: serde_json::json!({"query":"mcp","limit":5}),
            profile_key: Some("general_browser_assist".to_string()),
            target_id: Some("target-1".to_string()),
            timeout_ms: Some(20_000),
            content_id: None,
            project_id: None,
            save_title: None,
        };
        let result = SiteAdapterRunResult {
            ok: true,
            adapter: "github/search".to_string(),
            domain: "github.com".to_string(),
            profile_key: "general_browser_assist".to_string(),
            session_id: Some("session-1".to_string()),
            target_id: Some("target-1".to_string()),
            entry_url: "https://github.com/search?q=mcp&type=repositories".to_string(),
            source_url: Some("https://github.com/search?q=mcp&type=repositories".to_string()),
            data: Some(serde_json::json!({
                "items": [
                    {"title": "modelcontextprotocol/servers"}
                ]
            })),
            error_code: None,
            error_message: None,
            auth_hint: Some("请先登录 GitHub。".to_string()),
            report_hint: None,
            saved_content: None,
            saved_project_id: None,
            saved_by: None,
            save_skipped_project_id: None,
            save_skipped_by: None,
            save_error_message: None,
        };

        let saved_content = save_site_result_to_project(
            &db,
            &workspace.id,
            Some("GitHub MCP 搜索结果"),
            &adapter,
            &request,
            &result,
        )
        .expect("保存站点结果到项目失败");
        let manager = ContentManager::new(db);
        let contents = manager
            .list_by_project(&workspace.id, None)
            .expect("读取项目内容失败");

        assert_eq!(contents.len(), 1);

        let content = &contents[0];
        assert_eq!(content.id, saved_content.content_id);
        assert_eq!(content.project_id, workspace.id);
        assert_eq!(content.title, "GitHub MCP 搜索结果");
        assert_eq!(content.content_type, ContentType::Document);
        assert!(content.body.contains("# 站点采集结果"));
        assert!(content.body.contains("\"query\": \"mcp\""));
        assert!(content.body.contains("modelcontextprotocol/servers"));

        let metadata = content.metadata.as_ref().expect("应写入 metadata");
        assert_eq!(
            metadata.get("resourceKind"),
            Some(&serde_json::json!("document"))
        );
        assert_eq!(
            metadata.get("siteAdapterName"),
            Some(&serde_json::json!("github/search"))
        );
        assert_eq!(
            metadata.get("siteAdapterDomain"),
            Some(&serde_json::json!("github.com"))
        );
        assert_eq!(
            metadata.get("siteAdapterProfileKey"),
            Some(&serde_json::json!("general_browser_assist"))
        );
        assert_eq!(
            metadata.get("siteAdapterEntryUrl"),
            Some(&serde_json::json!(
                "https://github.com/search?q=mcp&type=repositories"
            ))
        );
        assert_eq!(
            metadata.get("siteAdapterSourceUrl"),
            Some(&serde_json::json!(
                "https://github.com/search?q=mcp&type=repositories"
            ))
        );
    }

    #[test]
    fn should_extract_latest_project_id_from_runtime_snapshot() {
        let now = Utc::now();
        let mut older_turn = TurnRuntime::new(
            "turn-older",
            "session-1",
            "thread-1",
            Some("旧 turn".to_string()),
            Some(TurnContextOverride {
                metadata: HashMap::from([(
                    "project_id".to_string(),
                    serde_json::json!("project-older"),
                )]),
                ..TurnContextOverride::default()
            }),
        );
        older_turn.updated_at = now;

        let mut latest_turn = TurnRuntime::new(
            "turn-latest",
            "session-1",
            "thread-1",
            Some("新 turn".to_string()),
            Some(TurnContextOverride {
                metadata: HashMap::from([(
                    "project_id".to_string(),
                    serde_json::json!("project-current"),
                )]),
                ..TurnContextOverride::default()
            }),
        );
        latest_turn.updated_at = now + ChronoDuration::seconds(5);

        let mut thread =
            ThreadRuntime::new("thread-1", "session-1", PathBuf::from("/tmp/site-runtime"));
        thread.updated_at = latest_turn.updated_at;

        let snapshot = SessionRuntimeSnapshot {
            session_id: "session-1".to_string(),
            threads: vec![ThreadRuntimeSnapshot {
                thread,
                turns: vec![older_turn, latest_turn],
                items: Vec::new(),
            }],
        };

        let project_id = LimeSiteTool::extract_project_id_from_runtime_snapshot(&snapshot);

        assert_eq!(project_id.as_deref(), Some("project-current"));
    }

    #[test]
    fn should_extract_latest_content_id_from_runtime_snapshot() {
        let now = Utc::now();
        let mut older_turn = TurnRuntime::new(
            "turn-older",
            "session-1",
            "thread-1",
            Some("旧 turn".to_string()),
            Some(TurnContextOverride {
                metadata: HashMap::from([(
                    "content_id".to_string(),
                    serde_json::json!("content-older"),
                )]),
                ..TurnContextOverride::default()
            }),
        );
        older_turn.updated_at = now;

        let mut latest_turn = TurnRuntime::new(
            "turn-latest",
            "session-1",
            "thread-1",
            Some("新 turn".to_string()),
            Some(TurnContextOverride {
                metadata: HashMap::from([(
                    "content_id".to_string(),
                    serde_json::json!("content-current"),
                )]),
                ..TurnContextOverride::default()
            }),
        );
        latest_turn.updated_at = now + ChronoDuration::seconds(5);

        let mut thread =
            ThreadRuntime::new("thread-1", "session-1", PathBuf::from("/tmp/site-runtime"));
        thread.updated_at = latest_turn.updated_at;

        let snapshot = SessionRuntimeSnapshot {
            session_id: "session-1".to_string(),
            threads: vec![ThreadRuntimeSnapshot {
                thread,
                turns: vec![older_turn, latest_turn],
                items: Vec::new(),
            }],
        };

        let content_id = LimeSiteTool::extract_content_id_from_runtime_snapshot(&snapshot);

        assert_eq!(content_id.as_deref(), Some("content-current"));
    }

    #[test]
    fn should_extract_project_id_from_thread_metadata_when_turn_metadata_missing() {
        let now = Utc::now();
        let mut thread =
            ThreadRuntime::new("thread-1", "session-1", PathBuf::from("/tmp/site-runtime"));
        thread.updated_at = now;
        thread.metadata.insert(
            "project_id".to_string(),
            serde_json::json!("project-thread"),
        );

        let snapshot = SessionRuntimeSnapshot {
            session_id: "session-1".to_string(),
            threads: vec![ThreadRuntimeSnapshot {
                thread,
                turns: vec![TurnRuntime::new(
                    "turn-1",
                    "session-1",
                    "thread-1",
                    Some("无项目上下文".to_string()),
                    None,
                )],
                items: Vec::new(),
            }],
        };

        let project_id = LimeSiteTool::extract_project_id_from_runtime_snapshot(&snapshot);

        assert_eq!(project_id.as_deref(), Some("project-thread"));
    }

    #[test]
    fn should_resolve_project_target_as_explicit_when_param_exists() {
        let runtime = tokio::runtime::Runtime::new().expect("创建 runtime 失败");
        let context =
            ToolContext::new(PathBuf::from("/tmp/site-runtime")).with_session_id("session-1");

        let target = runtime.block_on(LimeSiteTool::resolve_save_target(
            &serde_json::json!({
                "project_id": "project-explicit"
            }),
            &context,
        ));

        assert_eq!(
            target,
            Some(LimeSiteSaveTarget {
                project_id: Some("project-explicit".to_string()),
                content_id: None,
                source: LimeSiteSaveTargetSource::ExplicitProject,
            })
        );
    }

    #[test]
    fn should_resolve_content_target_as_explicit_when_param_exists() {
        let runtime = tokio::runtime::Runtime::new().expect("创建 runtime 失败");
        let context =
            ToolContext::new(PathBuf::from("/tmp/site-runtime")).with_session_id("session-1");

        let target = runtime.block_on(LimeSiteTool::resolve_save_target(
            &serde_json::json!({
                "content_id": "content-explicit"
            }),
            &context,
        ));

        assert_eq!(
            target,
            Some(LimeSiteSaveTarget {
                project_id: None,
                content_id: Some("content-explicit".to_string()),
                source: LimeSiteSaveTargetSource::ExplicitContent,
            })
        );
    }

    #[test]
    fn should_resolve_project_target_from_context_environment_when_runtime_missing() {
        let runtime = tokio::runtime::Runtime::new().expect("创建 runtime 失败");
        let mut context =
            ToolContext::new(PathBuf::from("/tmp/site-runtime")).with_session_id("missing");
        context.environment.insert(
            "LIME_PROJECT_ID".to_string(),
            "project-from-env".to_string(),
        );

        let target = runtime.block_on(LimeSiteTool::resolve_save_target(
            &serde_json::json!({}),
            &context,
        ));

        assert_eq!(
            target,
            Some(LimeSiteSaveTarget {
                project_id: Some("project-from-env".to_string()),
                content_id: None,
                source: LimeSiteSaveTargetSource::ContextProject,
            })
        );
    }

    #[test]
    fn should_resolve_content_target_from_context_environment_when_runtime_missing() {
        let runtime = tokio::runtime::Runtime::new().expect("创建 runtime 失败");
        let mut context =
            ToolContext::new(PathBuf::from("/tmp/site-runtime")).with_session_id("missing");
        context.environment.insert(
            "LIME_CONTENT_ID".to_string(),
            "content-from-env".to_string(),
        );

        let target = runtime.block_on(LimeSiteTool::resolve_save_target(
            &serde_json::json!({}),
            &context,
        ));

        assert_eq!(
            target,
            Some(LimeSiteSaveTarget {
                project_id: None,
                content_id: Some("content-from-env".to_string()),
                source: LimeSiteSaveTargetSource::ContextContent,
            })
        );
    }

    #[test]
    fn should_execute_recommend_tool_and_return_result_metadata() {
        let runtime = tokio::runtime::Runtime::new().expect("创建 runtime 失败");
        let tool = LimeSiteTool::new(
            LIME_SITE_RECOMMEND_TOOL_NAME.to_string(),
            "推荐站点适配器",
            LimeSiteTool::build_recommend_schema(),
            LimeSiteToolKind::Recommend,
            setup_test_db(),
        );
        let context =
            ToolContext::new(PathBuf::from("/tmp/site-runtime")).with_session_id("session-1");

        let result = runtime
            .block_on(tool.execute(
                serde_json::json!({
                    "limit": 1
                }),
                &context,
            ))
            .expect("推荐工具应返回 ToolResult");

        assert!(result.success);
        let recommendations = serde_json::from_value::<Vec<SiteAdapterRecommendation>>(
            result
                .metadata
                .get("result")
                .cloned()
                .expect("metadata 应包含 result"),
        )
        .expect("应能解析推荐结果");
        assert_eq!(recommendations.len(), 1);
        assert!(!recommendations[0].adapter.name.is_empty());
    }

    #[test]
    fn should_rewrite_saved_source_as_context_project_when_result_comes_from_context() {
        let result = SiteAdapterRunResult {
            ok: true,
            adapter: "github/search".to_string(),
            domain: "github.com".to_string(),
            profile_key: "general_browser_assist".to_string(),
            session_id: Some("session-1".to_string()),
            target_id: Some("target-1".to_string()),
            entry_url: "https://github.com/search?q=mcp&type=repositories".to_string(),
            source_url: Some("https://github.com/search?q=mcp&type=repositories".to_string()),
            data: Some(serde_json::json!({ "items": [] })),
            error_code: None,
            error_message: None,
            auth_hint: None,
            report_hint: None,
            saved_content: Some(
                crate::services::site_capability_service::SavedSiteAdapterContent {
                    content_id: "content-1".to_string(),
                    project_id: "project-context".to_string(),
                    title: "GitHub MCP 搜索结果".to_string(),
                },
            ),
            saved_project_id: Some("project-context".to_string()),
            saved_by: Some("explicit_project".to_string()),
            save_skipped_project_id: None,
            save_skipped_by: None,
            save_error_message: None,
        };

        let normalized = LimeSiteTool::apply_save_target_to_run_result(
            result,
            Some(&LimeSiteSaveTarget {
                project_id: Some("project-context".to_string()),
                content_id: None,
                source: LimeSiteSaveTargetSource::ContextProject,
            }),
        );

        assert_eq!(normalized.saved_by.as_deref(), Some("context_project"));
    }

    #[test]
    fn should_rewrite_skipped_source_as_context_project_when_run_fails_in_context() {
        let result = SiteAdapterRunResult {
            ok: false,
            adapter: "missing/adapter".to_string(),
            domain: String::new(),
            profile_key: "general_browser_assist".to_string(),
            session_id: None,
            target_id: None,
            entry_url: String::new(),
            source_url: None,
            data: None,
            error_code: Some("adapter_not_found".to_string()),
            error_message: Some("未找到对应的站点适配器".to_string()),
            auth_hint: None,
            report_hint: None,
            saved_content: None,
            saved_project_id: None,
            saved_by: None,
            save_skipped_project_id: Some("project-context".to_string()),
            save_skipped_by: Some("explicit_project".to_string()),
            save_error_message: None,
        };

        let normalized = LimeSiteTool::apply_save_target_to_run_result(
            result,
            Some(&LimeSiteSaveTarget {
                project_id: Some("project-context".to_string()),
                content_id: None,
                source: LimeSiteSaveTargetSource::ContextProject,
            }),
        );

        assert_eq!(
            normalized.save_skipped_by.as_deref(),
            Some("context_project")
        );
    }

    #[test]
    fn should_expose_context_project_save_skip_metadata_when_site_run_fails() {
        let runtime = tokio::runtime::Runtime::new().expect("创建 runtime 失败");
        let tool = LimeSiteTool::new(
            LIME_SITE_RUN_TOOL_NAME.to_string(),
            "执行站点适配器",
            LimeSiteTool::build_run_schema(),
            LimeSiteToolKind::Run,
            setup_test_db(),
        );
        let mut context =
            ToolContext::new(PathBuf::from("/tmp/site-runtime")).with_session_id("missing");
        context.environment.insert(
            "LIME_PROJECT_ID".to_string(),
            "project-from-env".to_string(),
        );

        let result = runtime
            .block_on(tool.execute(
                serde_json::json!({
                    "adapter_name": "missing/adapter"
                }),
                &context,
            ))
            .expect("工具执行应返回 ToolResult");

        assert!(!result.success);
        assert_eq!(
            result.metadata.get("save_skipped_project_id"),
            Some(&serde_json::json!("project-from-env"))
        );
        assert_eq!(
            result.metadata.get("save_skipped_by"),
            Some(&serde_json::json!("context_project"))
        );
        assert_eq!(
            result
                .metadata
                .get("result")
                .and_then(serde_json::Value::as_object)
                .and_then(|value| value.get("save_skipped_by")),
            Some(&serde_json::json!("context_project"))
        );
    }
}

pub(super) fn site_tool_names() -> Vec<&'static str> {
    vec![
        LIME_SITE_LIST_TOOL_NAME,
        LIME_SITE_RECOMMEND_TOOL_NAME,
        LIME_SITE_SEARCH_TOOL_NAME,
        LIME_SITE_INFO_TOOL_NAME,
        LIME_SITE_RUN_TOOL_NAME,
    ]
}

pub(super) fn register_site_tools_to_registry(
    registry: &mut aster::tools::ToolRegistry,
    db: DbConnection,
) {
    let definitions = [
        (
            LIME_SITE_LIST_TOOL_NAME,
            "列出 Lime 内置站点适配器目录。",
            LimeSiteTool::build_list_schema(),
            LimeSiteToolKind::List,
        ),
        (
            LIME_SITE_RECOMMEND_TOOL_NAME,
            "基于当前浏览器资料、已连接标签页和站点范围推荐可直接运行的 Lime 站点适配器，优先复用现有登录态。",
            LimeSiteTool::build_recommend_schema(),
            LimeSiteToolKind::Recommend,
        ),
        (
            LIME_SITE_SEARCH_TOOL_NAME,
            "按关键词搜索 Lime 内置站点适配器。",
            LimeSiteTool::build_search_schema(),
            LimeSiteToolKind::Search,
        ),
        (
            LIME_SITE_INFO_TOOL_NAME,
            "查看指定 Lime 站点适配器的参数和说明。",
            LimeSiteTool::build_info_schema(),
            LimeSiteToolKind::Info,
        ),
        (
            LIME_SITE_RUN_TOOL_NAME,
            "在真实浏览器登录态中执行 Lime 站点适配器，返回结构化只读结果；未传 project_id 时会优先复用当前项目上下文自动保存到项目文档。",
            LimeSiteTool::build_run_schema(),
            LimeSiteToolKind::Run,
        ),
    ];

    for (name, description, input_schema, kind) in definitions {
        if registry.contains(name) {
            continue;
        }
        registry.register(Box::new(LimeSiteTool::new(
            name.to_string(),
            description,
            input_schema,
            kind,
            db.clone(),
        )));
    }
}

pub(super) fn unregister_site_tools_from_registry(registry: &mut aster::tools::ToolRegistry) {
    for tool_name in site_tool_names() {
        registry.unregister(tool_name);
    }
}
