use super::definitions::{
    MEMORY_ADD_NOTE_TOOL_NAME, MEMORY_LIST_TOOL_NAME, MEMORY_READ_TOOL_NAME,
    MEMORY_SEARCH_TOOL_NAME,
};
use super::params::{
    bool_param, match_mode_param, required_string_param, root_params, runtime_memory_store_error,
    string_array_param, string_param, usize_param,
};
use crate::tool_executor::{
    RuntimeToolExecutionError, RuntimeToolExecutionFuture, RuntimeToolExecutionRequest,
    RuntimeToolExecutionResult, RuntimeToolExecutor, RuntimeToolExecutorHandle,
};
use app_server_protocol::{
    MemoryStoreAddNoteParams, MemoryStoreAddNoteResponse, MemoryStoreListParams,
    MemoryStoreListResponse, MemoryStoreReadParams, MemoryStoreReadResponse,
    MemoryStoreSearchParams, MemoryStoreSearchResponse,
};
use async_trait::async_trait;
use serde_json::{Value, json};
use std::collections::HashMap;
use std::sync::Arc;

#[async_trait]
pub trait MemoryStoreGateway: Send + Sync {
    async fn list_memory_store(
        &self,
        params: MemoryStoreListParams,
    ) -> Result<MemoryStoreListResponse, String>;

    async fn read_memory_store(
        &self,
        params: MemoryStoreReadParams,
    ) -> Result<MemoryStoreReadResponse, String>;

    async fn search_memory_store(
        &self,
        params: MemoryStoreSearchParams,
    ) -> Result<MemoryStoreSearchResponse, String>;

    async fn add_memory_store_note(
        &self,
        params: MemoryStoreAddNoteParams,
    ) -> Result<MemoryStoreAddNoteResponse, String>;
}

pub struct RuntimeMemoryStoreExecutor {
    gateway: Arc<dyn MemoryStoreGateway>,
}

impl RuntimeMemoryStoreExecutor {
    pub fn new(gateway: Arc<dyn MemoryStoreGateway>) -> Self {
        Self { gateway }
    }

    pub fn handle(gateway: Arc<dyn MemoryStoreGateway>) -> RuntimeToolExecutorHandle {
        RuntimeToolExecutorHandle::new(Arc::new(Self::new(gateway)))
    }

    async fn execute_memory_tool(
        &self,
        request: RuntimeToolExecutionRequest<'_>,
    ) -> Result<RuntimeToolExecutionResult, RuntimeToolExecutionError> {
        if request
            .context
            .cancel_token()
            .is_some_and(|token| token.is_cancelled())
        {
            return Err(runtime_memory_store_error("memory tool cancelled"));
        }

        match request.tool_name {
            MEMORY_LIST_TOOL_NAME => self.execute_list(request).await,
            MEMORY_READ_TOOL_NAME => self.execute_read(request).await,
            MEMORY_SEARCH_TOOL_NAME => self.execute_search(request).await,
            MEMORY_ADD_NOTE_TOOL_NAME => self.execute_add_note(request).await,
            tool_name => Err(runtime_memory_store_error(format!(
                "memory store executor cannot run tool '{tool_name}'"
            ))),
        }
    }

    async fn execute_list(
        &self,
        request: RuntimeToolExecutionRequest<'_>,
    ) -> Result<RuntimeToolExecutionResult, RuntimeToolExecutionError> {
        let params = request.params;
        let response = self
            .gateway
            .list_memory_store(MemoryStoreListParams {
                root: root_params(params, request.context.working_directory())?,
                path: string_param(params, &["path"]).map(str::to_string),
                cursor: string_param(params, &["cursor"]).map(str::to_string),
                max_results: usize_param(params, &["maxResults", "max_results"])?,
            })
            .await
            .map_err(runtime_memory_store_error)?;
        let metadata = metadata_map(json!({
            "operation": "list",
            "rootScope": response.root_scope,
            "path": response.path,
            "entries": response.entries,
            "truncated": response.truncated,
            "nextCursor": response.next_cursor,
        }));
        Ok(RuntimeToolExecutionResult::new(
            true,
            format!(
                "Listed {} memory entries under '{}'.{}",
                metadata
                    .get("entries")
                    .and_then(Value::as_array)
                    .map(Vec::len)
                    .unwrap_or(0),
                metadata
                    .get("path")
                    .and_then(Value::as_str)
                    .unwrap_or_default(),
                if metadata.get("truncated").and_then(Value::as_bool) == Some(true) {
                    " More entries are available via nextCursor."
                } else {
                    ""
                }
            ),
            None,
            metadata,
        ))
    }

    async fn execute_read(
        &self,
        request: RuntimeToolExecutionRequest<'_>,
    ) -> Result<RuntimeToolExecutionResult, RuntimeToolExecutionError> {
        let params = request.params;
        let response = self
            .gateway
            .read_memory_store(MemoryStoreReadParams {
                root: root_params(params, request.context.working_directory())?,
                path: required_string_param(params, &["path"])?,
                line_offset: usize_param(params, &["lineOffset", "line_offset"])?,
                max_lines: usize_param(params, &["maxLines", "max_lines"])?,
                max_tokens: usize_param(params, &["maxTokens", "max_tokens"])?,
            })
            .await
            .map_err(runtime_memory_store_error)?;
        let content = response.content.clone();
        let memory_usage = memory_usage_for_path(&response.path);
        let metadata = metadata_map(json!({
            "operation": "read",
            "path": response.path,
            "startLineNumber": response.start_line_number,
            "content": response.content,
            "truncated": response.truncated,
            "citation": response.citation,
            "memoryUsage": memory_usage,
        }));
        Ok(RuntimeToolExecutionResult::new(
            true, content, None, metadata,
        ))
    }

    async fn execute_search(
        &self,
        request: RuntimeToolExecutionRequest<'_>,
    ) -> Result<RuntimeToolExecutionResult, RuntimeToolExecutionError> {
        let params = request.params;
        let response = self
            .gateway
            .search_memory_store(MemoryStoreSearchParams {
                root: root_params(params, request.context.working_directory())?,
                queries: string_array_param(params, &["queries"])?,
                match_mode: match_mode_param(params)?,
                within_lines: usize_param(params, &["withinLines", "within_lines"])?,
                case_sensitive: bool_param(params, &["caseSensitive", "case_sensitive"]),
                normalized: bool_param(params, &["normalized"]),
                context_lines: usize_param(params, &["contextLines", "context_lines"])?
                    .unwrap_or(0),
                cursor: string_param(params, &["cursor"]).map(str::to_string),
                max_results: usize_param(params, &["maxResults", "max_results"])?,
            })
            .await
            .map_err(runtime_memory_store_error)?;
        let hit_count = response.hits.len();
        let memory_usage = response
            .hits
            .iter()
            .filter_map(|hit| memory_usage_for_path(&hit.path))
            .collect::<Vec<_>>();
        let metadata = metadata_map(json!({
            "operation": "search",
            "hits": response.hits,
            "truncated": response.truncated,
            "nextCursor": response.next_cursor,
            "memoryUsage": memory_usage,
        }));
        Ok(RuntimeToolExecutionResult::new(
            true,
            format!(
                "Found {hit_count} memory hits.{}",
                if metadata.get("truncated").and_then(Value::as_bool) == Some(true) {
                    " More hits are available via nextCursor."
                } else {
                    ""
                }
            ),
            None,
            metadata,
        ))
    }

    async fn execute_add_note(
        &self,
        request: RuntimeToolExecutionRequest<'_>,
    ) -> Result<RuntimeToolExecutionResult, RuntimeToolExecutionError> {
        let params = request.params;
        let response = self
            .gateway
            .add_memory_store_note(MemoryStoreAddNoteParams {
                root: root_params(params, request.context.working_directory())?,
                content: required_string_param(params, &["content"])?,
                title: string_param(params, &["title"]).map(str::to_string),
                slug: string_param(params, &["slug"]).map(str::to_string),
            })
            .await
            .map_err(runtime_memory_store_error)?;
        let metadata = metadata_map(json!({
            "operation": "add_note",
            "path": response.path,
            "citation": response.citation,
        }));
        Ok(RuntimeToolExecutionResult::new(
            true,
            format!(
                "Saved memory note at {}.",
                metadata
                    .get("path")
                    .and_then(Value::as_str)
                    .unwrap_or("extensions/ad_hoc/notes")
            ),
            None,
            metadata,
        ))
    }
}

impl RuntimeToolExecutor for RuntimeMemoryStoreExecutor {
    fn execute<'a>(
        &'a self,
        request: RuntimeToolExecutionRequest<'a>,
    ) -> RuntimeToolExecutionFuture<'a> {
        Box::pin(async move { self.execute_memory_tool(request).await })
    }
}

pub fn runtime_memory_store_executor_handle(
    gateway: Arc<dyn MemoryStoreGateway>,
) -> RuntimeToolExecutorHandle {
    RuntimeMemoryStoreExecutor::handle(gateway)
}

fn metadata_map(value: Value) -> HashMap<String, Value> {
    match value {
        Value::Object(object) => object.into_iter().collect(),
        _ => HashMap::new(),
    }
}

fn memory_usage_for_path(path: &str) -> Option<Value> {
    let normalized = path.replace('\\', "/");
    let version = if normalized.contains("memories_v2/") {
        "v2"
    } else {
        "v1"
    };
    let normalized = normalized.replace("memories_v2/", "memories/");
    let relative = normalized
        .strip_prefix("memories/")
        .or_else(|| normalized.rsplit_once("/memories/").map(|(_, path)| path))
        .unwrap_or(&normalized);
    let kind = if relative == "MEMORY.md" {
        "memory_md"
    } else if relative == "memory_summary.md" {
        "memory_summary"
    } else if relative == "raw_memories.md" {
        "raw_memories"
    } else if relative.starts_with("rollout_summaries/") {
        "rollout_summaries"
    } else if relative.starts_with("skills/") {
        "skills"
    } else {
        return None;
    };
    Some(json!({"kind": kind, "version": version, "path": path}))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tool_executor::{RuntimeToolExecutionContext, RuntimeToolExecutionContextInput};
    use app_server_protocol::{MemoryStoreCitation, MemoryStoreScope, MemoryStoreSearchResponse};
    use serde_json::json;
    use std::path::PathBuf;
    use tempfile::tempdir;

    fn context(path: PathBuf) -> RuntimeToolExecutionContext {
        RuntimeToolExecutionContext::new(RuntimeToolExecutionContextInput {
            working_directory: path,
            session_id: "test-session".to_string(),
            cancel_token: None,
            workspace_sandbox: None,
        })
    }

    #[derive(Default)]
    struct FakeMemoryStoreGateway;

    #[async_trait]
    impl MemoryStoreGateway for FakeMemoryStoreGateway {
        async fn list_memory_store(
            &self,
            params: MemoryStoreListParams,
        ) -> Result<MemoryStoreListResponse, String> {
            Ok(MemoryStoreListResponse {
                root_scope: params.root.scope,
                path: params.path.unwrap_or_default(),
                entries: Vec::new(),
                truncated: false,
                next_cursor: None,
            })
        }

        async fn read_memory_store(
            &self,
            params: MemoryStoreReadParams,
        ) -> Result<MemoryStoreReadResponse, String> {
            Ok(MemoryStoreReadResponse {
                path: params.path,
                start_line_number: 1,
                content: "remember this".to_string(),
                truncated: false,
                citation: MemoryStoreCitation {
                    path: "MEMORY.md".to_string(),
                    start_line_number: 1,
                    end_line_number: 1,
                },
            })
        }

        async fn search_memory_store(
            &self,
            _params: MemoryStoreSearchParams,
        ) -> Result<MemoryStoreSearchResponse, String> {
            Ok(MemoryStoreSearchResponse {
                hits: Vec::new(),
                truncated: false,
                next_cursor: None,
            })
        }

        async fn add_memory_store_note(
            &self,
            _params: MemoryStoreAddNoteParams,
        ) -> Result<MemoryStoreAddNoteResponse, String> {
            Ok(MemoryStoreAddNoteResponse {
                path: "extensions/ad_hoc/notes/note.md".to_string(),
                citation: MemoryStoreCitation {
                    path: "extensions/ad_hoc/notes/note.md".to_string(),
                    start_line_number: 1,
                    end_line_number: 1,
                },
            })
        }
    }

    #[tokio::test]
    async fn list_tool_uses_workspace_scope_by_default() {
        let dir = tempdir().expect("tempdir");
        let executor = RuntimeMemoryStoreExecutor::new(Arc::new(FakeMemoryStoreGateway));
        let context = context(dir.path().to_path_buf());
        let result = executor
            .execute_memory_tool(RuntimeToolExecutionRequest {
                tool_name: MEMORY_LIST_TOOL_NAME,
                params: &json!({}),
                context: &context,
                turn_context: None,
            })
            .await
            .expect("list result");

        assert!(result.success);
        assert_eq!(result.metadata.get("rootScope"), Some(&json!("workspace")));
    }

    #[tokio::test]
    async fn read_tool_keeps_content_and_citation_metadata() {
        let dir = tempdir().expect("tempdir");
        let executor = RuntimeMemoryStoreExecutor::new(Arc::new(FakeMemoryStoreGateway));
        let context = context(dir.path().to_path_buf());
        let result = executor
            .execute_memory_tool(RuntimeToolExecutionRequest {
                tool_name: MEMORY_READ_TOOL_NAME,
                params: &json!({"path": "MEMORY.md"}),
                context: &context,
                turn_context: None,
            })
            .await
            .expect("read result");

        assert_eq!(result.output, "remember this");
        assert_eq!(result.metadata.get("operation"), Some(&json!("read")));
        assert_eq!(result.metadata["citation"]["path"], json!("MEMORY.md"));
        assert_eq!(result.metadata["memoryUsage"]["kind"], json!("memory_md"));
    }

    #[test]
    fn fake_gateway_keeps_scope_type_available() {
        assert_eq!(MemoryStoreScope::Workspace, MemoryStoreScope::Workspace);
    }
}
