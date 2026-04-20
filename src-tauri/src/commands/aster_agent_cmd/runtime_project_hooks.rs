use super::*;
use crate::agent_tools::catalog::mcp_extension_runtime_name;
use aster::hooks::{
    load_project_hooks_to_registry, run_session_start_hooks_with_registry,
    run_session_start_hooks_with_registry_and_context, run_user_prompt_submit_hooks_with_registry,
    run_user_prompt_submit_hooks_with_registry_and_context, HookRegistry, HookResult,
    HookRuntimeContext, McpHookConfig, SessionSource,
};
use rmcp::model::{CallToolRequestParam, CallToolResult, Content, ErrorData, RawContent};
use tokio_util::sync::CancellationToken;

pub(crate) fn load_runtime_project_hook_registry(
    workspace_root: &str,
) -> Result<Arc<HookRegistry>, String> {
    let trimmed_workspace_root = workspace_root.trim();
    if trimmed_workspace_root.is_empty() {
        return Err("workspace_root 不能为空".to_string());
    }

    let registry = Arc::new(HookRegistry::new());
    load_project_hooks_to_registry(Path::new(trimmed_workspace_root), &registry)?;
    Ok(registry)
}

fn build_runtime_project_hook_context(
    db: &DbConnection,
    state: &AsterAgentState,
    mcp_manager: &McpManagerState,
) -> HookRuntimeContext {
    let db = db.clone();
    let state = state.clone();
    let mcp_manager = mcp_manager.clone();

    HookRuntimeContext::new().with_mcp_executor(Arc::new(move |hook, input| {
        let db = db.clone();
        let state = state.clone();
        let mcp_manager = mcp_manager.clone();
        Box::pin(async move {
            dispatch_runtime_mcp_hook(&db, &state, &mcp_manager, &hook, &input).await
        })
    }))
}

async fn resolve_runtime_hook_extension_manager(
    db: &DbConnection,
    state: &AsterAgentState,
    mcp_manager: &McpManagerState,
) -> Result<Arc<aster::agents::extension_manager::ExtensionManager>, String> {
    if !state.is_initialized().await {
        state.init_agent_with_db(db).await?;
    }

    let (_start_ok, start_fail) = ensure_lime_mcp_servers_running(db, mcp_manager).await;
    let (_inject_ok, inject_fail) = inject_mcp_extensions(state, mcp_manager).await;

    if start_fail > 0 {
        tracing::warn!(
            "[AsterAgent] MCP hook 预热时有 {} 个 server 启动失败，结果可能不完整",
            start_fail
        );
    }
    if inject_fail > 0 {
        tracing::warn!(
            "[AsterAgent] MCP hook 预热时有 {} 个 extension 注入失败，结果可能不完整",
            inject_fail
        );
    }

    let agent_arc = state.get_agent_arc();
    let guard = agent_arc.read().await;
    let agent = guard.as_ref().ok_or("Agent 未初始化，无法执行 MCP hook")?;
    Ok(agent.extension_manager.clone())
}

fn build_runtime_mcp_tool_call(hook: &McpHookConfig) -> Result<CallToolRequestParam, String> {
    let server = hook.server.trim();
    if server.is_empty() {
        return Err("MCP hook 缺少 server".to_string());
    }

    let tool = hook.tool.trim();
    if tool.is_empty() {
        return Err("MCP hook 缺少 tool".to_string());
    }

    let arguments = match hook.tool_args.clone().unwrap_or(serde_json::Value::Null) {
        serde_json::Value::Null => None,
        serde_json::Value::Object(map) => Some(map),
        _ => {
            return Err("MCP hook 的 tool_args 必须是 JSON object 或 null".to_string());
        }
    };

    Ok(CallToolRequestParam {
        name: format!("{}__{}", mcp_extension_runtime_name(server), tool).into(),
        arguments,
    })
}

fn parse_mcp_hook_blocked_payload(value: &serde_json::Value) -> Option<String> {
    if value.get("blocked").and_then(serde_json::Value::as_bool) != Some(true) {
        return None;
    }

    Some(
        value
            .get("message")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("Blocked by MCP hook")
            .to_string(),
    )
}

fn parse_mcp_hook_blocked_text(text: &str) -> Option<String> {
    serde_json::from_str::<serde_json::Value>(text)
        .ok()
        .and_then(|value| parse_mcp_hook_blocked_payload(&value))
}

fn serialize_mcp_hook_content(content: &Content) -> Option<String> {
    match &content.raw {
        RawContent::Text(text) => Some(text.text.clone()),
        RawContent::Image(image) => Some(format!("[image:{}]", image.mime_type)),
        RawContent::Audio(audio) => Some(format!("[audio:{}]", audio.mime_type)),
        RawContent::Resource(resource) => match &resource.resource {
            rmcp::model::ResourceContents::TextResourceContents { uri, text, .. } => {
                Some(format!("{uri}\n{text}"))
            }
            rmcp::model::ResourceContents::BlobResourceContents { uri, .. } => {
                Some(format!("[resource:{uri}]"))
            }
        },
        RawContent::ResourceLink(link) => Some(format!("{} ({})", link.name, link.uri)),
    }
}

fn convert_runtime_mcp_call_result(result: CallToolResult) -> HookResult {
    if let Some(message) = result
        .structured_content
        .as_ref()
        .and_then(parse_mcp_hook_blocked_payload)
    {
        return HookResult::blocked(message);
    }

    if let Some(message) = result
        .content
        .iter()
        .filter_map(|content| content.as_text())
        .find_map(|text| parse_mcp_hook_blocked_text(&text.text))
    {
        return HookResult::blocked(message);
    }

    let mut output_parts = result
        .content
        .iter()
        .filter_map(serialize_mcp_hook_content)
        .filter(|part| !part.trim().is_empty())
        .collect::<Vec<_>>();

    if let Some(structured) = result.structured_content.as_ref() {
        let structured_text = structured.to_string();
        if !structured_text.trim().is_empty() {
            output_parts.push(structured_text);
        }
    }

    let output = (!output_parts.is_empty()).then(|| output_parts.join("\n\n"));

    if result.is_error == Some(true) {
        return HookResult::failure(output.unwrap_or_else(|| "MCP hook 返回错误结果".to_string()));
    }

    HookResult::success(output)
}

fn convert_runtime_mcp_call_error(error: ErrorData) -> HookResult {
    HookResult::failure(error.to_string())
}

async fn dispatch_runtime_mcp_hook(
    db: &DbConnection,
    state: &AsterAgentState,
    mcp_manager: &McpManagerState,
    hook: &McpHookConfig,
    _input: &aster::hooks::HookInput,
) -> HookResult {
    let tool_call = match build_runtime_mcp_tool_call(hook) {
        Ok(tool_call) => tool_call,
        Err(error) => return HookResult::failure(error),
    };

    let extension_manager =
        match resolve_runtime_hook_extension_manager(db, state, mcp_manager).await {
            Ok(manager) => manager,
            Err(error) => return HookResult::failure(format!("MCP hook 初始化失败: {error}")),
        };

    let dispatched = match extension_manager
        .dispatch_tool_call(tool_call, CancellationToken::default())
        .await
    {
        Ok(result) => result,
        Err(error) => return HookResult::failure(format!("MCP hook 调用失败: {error}")),
    };

    match dispatched.result.await {
        Ok(result) => convert_runtime_mcp_call_result(result),
        Err(error) => convert_runtime_mcp_call_error(error),
    }
}

fn log_runtime_project_hook_results(event_name: &str, results: &[HookResult]) {
    for result in results {
        if result.blocked {
            tracing::warn!(
                "[AsterAgent] {} hook 返回 blocked，但当前入口不会因此中断: {}",
                event_name,
                result.block_message.as_deref().unwrap_or("未提供阻止原因")
            );
            continue;
        }

        if !result.success {
            tracing::warn!(
                "[AsterAgent] {} hook 执行失败: {}",
                event_name,
                result.error.as_deref().unwrap_or("未知错误")
            );
        }
    }
}

pub(crate) async fn enforce_runtime_turn_user_prompt_submit_hooks(
    prompt: &str,
    session_id: &str,
    workspace_root: &str,
) -> Result<(), String> {
    let registry = load_runtime_project_hook_registry(workspace_root)?;
    let (allowed, message) =
        run_user_prompt_submit_hooks_with_registry(prompt, Some(session_id.to_string()), &registry)
            .await;
    if allowed {
        return Ok(());
    }

    Err(format!(
        "UserPromptSubmit hook 已阻止本次提交：{}",
        message.unwrap_or_else(|| "未提供阻止原因".to_string())
    ))
}

pub(crate) async fn enforce_runtime_turn_user_prompt_submit_hooks_with_runtime(
    prompt: &str,
    session_id: &str,
    workspace_root: &str,
    db: &DbConnection,
    state: &AsterAgentState,
    mcp_manager: &McpManagerState,
) -> Result<(), String> {
    let registry = load_runtime_project_hook_registry(workspace_root)?;
    let runtime = build_runtime_project_hook_context(db, state, mcp_manager);
    let (allowed, message) = run_user_prompt_submit_hooks_with_registry_and_context(
        prompt,
        Some(session_id.to_string()),
        &registry,
        &runtime,
    )
    .await;
    if allowed {
        return Ok(());
    }

    Err(format!(
        "UserPromptSubmit hook 已阻止本次提交：{}",
        message.unwrap_or_else(|| "未提供阻止原因".to_string())
    ))
}

pub(crate) async fn run_runtime_session_start_project_hooks(
    session_id: &str,
    workspace_root: &str,
    source: SessionSource,
) {
    let registry = match load_runtime_project_hook_registry(workspace_root) {
        Ok(registry) => registry,
        Err(error) => {
            tracing::warn!(
                "[AsterAgent] 加载 SessionStart project hooks 失败: workspace_root={}, error={}",
                workspace_root,
                error
            );
            return;
        }
    };

    let results =
        run_session_start_hooks_with_registry(session_id.to_string(), Some(source), &registry)
            .await;
    log_runtime_project_hook_results("SessionStart", &results);
}

pub(crate) async fn run_runtime_session_start_project_hooks_with_runtime(
    session_id: &str,
    workspace_root: &str,
    source: SessionSource,
    db: &DbConnection,
    state: &AsterAgentState,
    mcp_manager: &McpManagerState,
) {
    let registry = match load_runtime_project_hook_registry(workspace_root) {
        Ok(registry) => registry,
        Err(error) => {
            tracing::warn!(
                "[AsterAgent] 加载 SessionStart project hooks 失败: workspace_root={}, error={}",
                workspace_root,
                error
            );
            return;
        }
    };

    let runtime = build_runtime_project_hook_context(db, state, mcp_manager);
    let results = run_session_start_hooks_with_registry_and_context(
        session_id.to_string(),
        Some(source),
        &registry,
        &runtime,
    )
    .await;
    log_runtime_project_hook_results("SessionStart", &results);
}

pub(crate) fn resolve_runtime_project_hook_workspace_root(
    db: &DbConnection,
    session_id: &str,
) -> Result<String, String> {
    let detail = AsterAgentWrapper::get_session_sync(db, session_id)?;

    if let Some(workspace_id) = detail
        .workspace_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let manager = WorkspaceManager::new(db.clone());
        let workspace_id = workspace_id.to_string();
        match manager.get(&workspace_id) {
            Ok(Some(workspace)) => {
                match ensure_workspace_ready_with_auto_relocate(&manager, &workspace) {
                    Ok(ensured) => {
                        return Ok(ensured.root_path.to_string_lossy().to_string());
                    }
                    Err(error) => {
                        tracing::warn!(
                            "[AsterAgent] 解析 project hooks workspace_root 失败，准备回退 working_dir: session_id={}, workspace_id={}, error={}",
                            session_id,
                            workspace_id,
                            error
                        );
                    }
                }
            }
            Ok(None) => {
                tracing::warn!(
                    "[AsterAgent] project hooks 所属 workspace 不存在，准备回退 working_dir: session_id={}, workspace_id={}",
                    session_id,
                    workspace_id
                );
            }
            Err(error) => {
                tracing::warn!(
                    "[AsterAgent] 读取 project hooks 所属 workspace 失败，准备回退 working_dir: session_id={}, workspace_id={}, error={}",
                    session_id,
                    workspace_id,
                    error
                );
            }
        }
    }

    detail
        .working_dir
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .ok_or_else(|| format!("SessionStart project hooks 缺少可用 workspace_root: {session_id}"))
}

pub(crate) async fn run_runtime_session_start_project_hooks_for_session(
    db: &DbConnection,
    session_id: &str,
    source: SessionSource,
) {
    let workspace_root = match resolve_runtime_project_hook_workspace_root(db, session_id) {
        Ok(workspace_root) => workspace_root,
        Err(error) => {
            tracing::warn!(
                "[AsterAgent] 解析 SessionStart project hooks workspace_root 失败: session_id={}, error={}",
                session_id,
                error
            );
            return;
        }
    };

    run_runtime_session_start_project_hooks(session_id, &workspace_root, source).await;
}

pub(crate) async fn run_runtime_session_start_project_hooks_for_session_with_runtime(
    db: &DbConnection,
    state: &AsterAgentState,
    mcp_manager: &McpManagerState,
    session_id: &str,
    source: SessionSource,
) {
    let workspace_root = match resolve_runtime_project_hook_workspace_root(db, session_id) {
        Ok(workspace_root) => workspace_root,
        Err(error) => {
            tracing::warn!(
                "[AsterAgent] 解析 SessionStart project hooks workspace_root 失败: session_id={}, error={}",
                session_id,
                error
            );
            return;
        }
    };

    run_runtime_session_start_project_hooks_with_runtime(
        session_id,
        &workspace_root,
        source,
        db,
        state,
        mcp_manager,
    )
    .await;
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tests::runtime_test_support::shared_aster_runtime_test_root;
    use aster::session::{
        delete_managed_session, initialize_shared_session_runtime_with_root,
        is_global_session_store_set,
    };
    use lime_core::database::schema::create_tables;
    use lime_services::aster_session_store::LimeSessionStore;
    use rmcp::model::Content;
    use rusqlite::Connection;
    use tokio::sync::OnceCell;

    async fn ensure_runtime_project_hooks_test_manager() {
        static INIT: OnceCell<()> = OnceCell::const_new();

        INIT.get_or_init(|| async {
            if is_global_session_store_set() {
                return;
            }

            let conn = Connection::open_in_memory().expect("创建内存数据库失败");
            create_tables(&conn).expect("初始化表结构失败");

            let runtime_root = shared_aster_runtime_test_root();
            std::fs::create_dir_all(&runtime_root).expect("创建 runtime 测试目录失败");

            let session_store = Arc::new(LimeSessionStore::new(Arc::new(Mutex::new(conn))));
            initialize_shared_session_runtime_with_root(runtime_root, Some(session_store))
                .await
                .expect("初始化测试 session manager 失败");
        })
        .await;
    }

    fn write_session_start_capture_hook(workspace_root: &Path, output_path: &Path) {
        let claude_dir = workspace_root.join(".claude");
        std::fs::create_dir_all(&claude_dir).expect("创建 .claude 目录失败");

        let settings = serde_json::json!({
            "hooks": {
                "SessionStart": [
                    {
                        "type": "command",
                        "command": "cat > \"$HOOK_OUTPUT_PATH\"",
                        "blocking": true,
                        "env": {
                            "HOOK_OUTPUT_PATH": output_path.to_string_lossy().to_string(),
                        }
                    }
                ]
            }
        });
        std::fs::write(
            claude_dir.join("settings.json"),
            serde_json::to_string_pretty(&settings).expect("序列化 settings 失败"),
        )
        .expect("写入 settings.json 失败");
    }

    #[tokio::test]
    async fn run_runtime_session_start_project_hooks_for_session_should_use_workspace_root_for_compact_source(
    ) {
        ensure_runtime_project_hooks_test_manager().await;

        let conn = Connection::open_in_memory().expect("创建内存数据库失败");
        create_tables(&conn).expect("初始化表结构失败");
        let db = Arc::new(Mutex::new(conn));

        let temp_dir = tempfile::TempDir::new().expect("create temp dir");
        let workspace_root = temp_dir.path().join("workspace");
        std::fs::create_dir_all(&workspace_root).expect("创建 workspace 目录失败");
        let hook_output_path = temp_dir.path().join("session-start-compact.json");
        write_session_start_capture_hook(&workspace_root, &hook_output_path);

        let manager = WorkspaceManager::new(db.clone());
        let workspace = manager
            .create(
                "Runtime Project Hook Workspace".to_string(),
                workspace_root.clone(),
            )
            .expect("创建 workspace 失败");

        let session_id = AsterAgentWrapper::create_session_sync(
            &db,
            Some("Runtime Project Hook Session".to_string()),
            Some(workspace_root.to_string_lossy().to_string()),
            workspace.id.clone(),
            Some(AsterExecutionStrategy::React.as_db_value().to_string()),
        )
        .expect("创建 session 失败");

        run_runtime_session_start_project_hooks_for_session(
            &db,
            &session_id,
            SessionSource::Compact,
        )
        .await;

        let hook_input: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(&hook_output_path).expect("应能读取 hook 输入"),
        )
        .expect("hook 输入应为有效 JSON");
        assert_eq!(
            hook_input.get("event").and_then(serde_json::Value::as_str),
            Some("SessionStart")
        );
        assert_eq!(
            hook_input.get("source").and_then(serde_json::Value::as_str),
            Some("compact")
        );
        assert_eq!(
            hook_input
                .get("session_id")
                .and_then(serde_json::Value::as_str),
            Some(session_id.as_str())
        );

        delete_managed_session(&session_id)
            .await
            .expect("清理测试 session 失败");
    }

    #[tokio::test]
    async fn run_runtime_session_start_project_hooks_for_session_should_fallback_to_working_dir_when_workspace_missing(
    ) {
        ensure_runtime_project_hooks_test_manager().await;

        let conn = Connection::open_in_memory().expect("创建内存数据库失败");
        create_tables(&conn).expect("初始化表结构失败");
        let db = Arc::new(Mutex::new(conn));

        let temp_dir = tempfile::TempDir::new().expect("create temp dir");
        let workspace_root = temp_dir.path().join("working-dir-fallback");
        std::fs::create_dir_all(&workspace_root).expect("创建 working_dir 目录失败");
        let hook_output_path = temp_dir.path().join("session-start-working-dir.json");
        write_session_start_capture_hook(&workspace_root, &hook_output_path);

        let session_id = AsterAgentWrapper::create_session_sync(
            &db,
            Some("Runtime Project Hook WorkingDir Session".to_string()),
            Some(workspace_root.to_string_lossy().to_string()),
            "workspace-missing".to_string(),
            Some(AsterExecutionStrategy::React.as_db_value().to_string()),
        )
        .expect("创建 session 失败");

        run_runtime_session_start_project_hooks_for_session(
            &db,
            &session_id,
            SessionSource::Compact,
        )
        .await;

        let hook_input: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(&hook_output_path).expect("应能读取 fallback hook 输入"),
        )
        .expect("fallback hook 输入应为有效 JSON");
        assert_eq!(
            hook_input.get("source").and_then(serde_json::Value::as_str),
            Some("compact")
        );
        assert_eq!(
            hook_input
                .get("session_id")
                .and_then(serde_json::Value::as_str),
            Some(session_id.as_str())
        );

        delete_managed_session(&session_id)
            .await
            .expect("清理测试 session 失败");
    }

    #[test]
    fn convert_runtime_mcp_call_result_should_block_from_structured_content() {
        let result = CallToolResult {
            content: vec![Content::text("ignored".to_string())],
            structured_content: Some(serde_json::json!({
                "blocked": true,
                "message": "blocked by structured payload"
            })),
            is_error: Some(false),
            meta: None,
        };

        let converted = convert_runtime_mcp_call_result(result);

        assert!(converted.blocked);
        assert_eq!(
            converted.block_message.as_deref(),
            Some("blocked by structured payload")
        );
    }

    #[test]
    fn convert_runtime_mcp_call_result_should_join_text_and_structured_output() {
        let result = CallToolResult {
            content: vec![Content::text("hello".to_string())],
            structured_content: Some(serde_json::json!({
                "answer": "world"
            })),
            is_error: Some(false),
            meta: None,
        };

        let converted = convert_runtime_mcp_call_result(result);

        assert!(converted.success);
        assert_eq!(
            converted.output.as_deref(),
            Some("hello\n\n{\"answer\":\"world\"}")
        );
    }
}
