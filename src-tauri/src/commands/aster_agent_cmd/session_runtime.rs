use super::runtime_project_hooks::{
    run_runtime_session_start_project_hooks, run_runtime_session_start_project_hooks_with_runtime,
};
use super::*;
use aster::hooks::SessionSource;
use aster::session::load_shared_session_runtime_snapshot;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SessionProviderRoutingState {
    provider_selector: String,
}

impl ExtensionState for SessionProviderRoutingState {
    const EXTENSION_NAME: &'static str = "lime_provider_routing";
    const VERSION: &'static str = "v0";
}

impl SessionProviderRoutingState {
    fn new(provider_selector: impl Into<String>) -> Option<Self> {
        normalize_optional_text(Some(provider_selector.into()))
            .map(|provider_selector| Self { provider_selector })
    }

    fn from_extension_data(extension_data: &ExtensionData) -> Option<Self> {
        <Self as ExtensionState>::from_extension_data(extension_data)
    }

    fn from_session(session: &aster::session::Session) -> Option<Self> {
        Self::from_extension_data(&session.extension_data)
    }

    fn to_extension_data(&self, extension_data: &mut ExtensionData) -> Result<(), String> {
        <Self as ExtensionState>::to_extension_data(self, extension_data)
            .map_err(|error| error.to_string())
    }

    fn into_updated_extension_data(
        self,
        session: &aster::session::Session,
    ) -> Result<ExtensionData, String> {
        let mut extension_data = session.extension_data.clone();
        self.to_extension_data(&mut extension_data)?;
        Ok(extension_data)
    }
}

#[derive(Debug, Clone, Default)]
pub(crate) struct SessionRecentHarnessContext {
    pub(crate) theme: Option<String>,
    pub(crate) session_mode: Option<String>,
    pub(crate) gate_key: Option<String>,
    pub(crate) run_title: Option<String>,
    pub(crate) content_id: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub(crate) struct SessionRecentRuntimeContext {
    pub(crate) preferences: Option<lime_agent::SessionExecutionRuntimePreferences>,
    pub(crate) team_selection: Option<lime_agent::SessionExecutionRuntimeRecentTeamSelection>,
}

pub(crate) async fn persist_session_provider_routing(
    session_id: &str,
    provider_selector: &str,
) -> Result<(), String> {
    let Some(state) = SessionProviderRoutingState::new(provider_selector.to_string()) else {
        return Ok(());
    };
    let session = read_session(session_id, false, "读取会话 provider 路由上下文失败").await?;
    let extension_data = state.into_updated_extension_data(&session)?;
    persist_session_extension_data(session_id, extension_data, "持久化会话 provider 路由上下文")
        .await?;
    Ok(())
}

pub(crate) fn resolve_session_provider_selector(
    session: &aster::session::Session,
) -> Option<String> {
    SessionProviderRoutingState::from_session(session).map(|state| state.provider_selector)
}

fn build_session_recent_runtime_context(
    session_id: &str,
    session: &aster::session::Session,
) -> SessionRecentRuntimeContext {
    let runtime = lime_agent::build_session_execution_runtime(
        session_id,
        Some(session),
        None,
        None,
        resolve_session_provider_selector(session),
    );

    SessionRecentRuntimeContext {
        preferences: runtime
            .as_ref()
            .and_then(|value| value.recent_preferences.clone()),
        team_selection: runtime.and_then(|value| value.recent_team_selection),
    }
}

pub(crate) async fn resolve_session_recent_runtime_context(
    session_id: &str,
) -> Result<SessionRecentRuntimeContext, String> {
    let session = read_session(session_id, false, "读取会话 recent runtime 上下文失败").await?;
    Ok(build_session_recent_runtime_context(session_id, &session))
}

pub(crate) async fn resolve_session_recent_preferences(
    session_id: &str,
) -> Result<Option<lime_agent::SessionExecutionRuntimePreferences>, String> {
    Ok(resolve_session_recent_runtime_context(session_id)
        .await?
        .preferences)
}

pub(crate) async fn resolve_session_recent_harness_context(
    session_id: &str,
) -> Result<SessionRecentHarnessContext, String> {
    let trimmed_session_id = session_id.trim();
    if trimmed_session_id.is_empty() {
        return Ok(SessionRecentHarnessContext::default());
    }

    match load_shared_session_runtime_snapshot(trimmed_session_id).await {
        Ok(snapshot) => {
            let runtime = lime_agent::build_session_execution_runtime(
                trimmed_session_id,
                None,
                None,
                Some(&snapshot),
                None,
            );
            Ok(SessionRecentHarnessContext {
                theme: runtime
                    .as_ref()
                    .and_then(|value| value.recent_theme.clone()),
                session_mode: runtime
                    .as_ref()
                    .and_then(|value| value.recent_session_mode.clone()),
                gate_key: runtime
                    .as_ref()
                    .and_then(|value| value.recent_gate_key.clone()),
                run_title: runtime
                    .as_ref()
                    .and_then(|value| value.recent_run_title.clone()),
                content_id: runtime
                    .as_ref()
                    .and_then(|value| value.recent_content_id.clone()),
            })
        }
        Err(error) => {
            tracing::debug!(
                "[AsterAgent] 读取 runtime snapshot 失败，跳过 recent harness context 回退: session_id={}, error={}",
                trimmed_session_id,
                error
            );
            Ok(SessionRecentHarnessContext::default())
        }
    }
}

pub(crate) fn resolve_recent_preference_from_sources(
    request_metadata: Option<&serde_json::Value>,
    keys: &[&str],
    session_recent_preference: Option<bool>,
) -> Option<bool> {
    extract_harness_bool(request_metadata, keys).or(session_recent_preference)
}

pub(crate) async fn create_runtime_session_internal(
    db: &DbConnection,
    working_dir: Option<String>,
    workspace_id: String,
    name: Option<String>,
    execution_strategy: Option<AsterExecutionStrategy>,
) -> Result<String, String> {
    create_runtime_session_internal_impl(
        db,
        working_dir,
        workspace_id,
        name,
        execution_strategy,
        None,
    )
    .await
}

pub(crate) async fn create_runtime_session_internal_with_runtime(
    db: &DbConnection,
    state: &AsterAgentState,
    mcp_manager: &McpManagerState,
    working_dir: Option<String>,
    workspace_id: String,
    name: Option<String>,
    execution_strategy: Option<AsterExecutionStrategy>,
) -> Result<String, String> {
    create_runtime_session_internal_impl(
        db,
        working_dir,
        workspace_id,
        name,
        execution_strategy,
        Some((state, mcp_manager)),
    )
    .await
}

async fn create_runtime_session_internal_impl(
    db: &DbConnection,
    working_dir: Option<String>,
    workspace_id: String,
    name: Option<String>,
    execution_strategy: Option<AsterExecutionStrategy>,
    runtime: Option<(&AsterAgentState, &McpManagerState)>,
) -> Result<String, String> {
    tracing::info!("[AsterAgent] 创建会话: name={:?}", name);

    let workspace_id = workspace_id.trim().to_string();
    if workspace_id.is_empty() {
        return Err("workspace_id 必填，请先选择项目工作区".to_string());
    }

    let manager = WorkspaceManager::new(db.clone());
    let workspace = manager
        .get(&workspace_id)
        .map_err(|e| format!("读取 workspace 失败: {e}"))?
        .ok_or_else(|| format!("Workspace 不存在: {workspace_id}"))?;
    let ensured = ensure_workspace_ready_with_auto_relocate(&manager, &workspace)?;
    let workspace_root = ensured.root_path.to_string_lossy().to_string();

    if ensured.repaired {
        tracing::warn!(
            "[AsterAgent] 会话创建阶段检测到 workspace 目录异常并已修复: {}{}",
            workspace_root,
            if ensured.relocated {
                "（已迁移）"
            } else {
                ""
            }
        );
    }

    let resolved_working_dir = working_dir
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .or_else(|| Some(workspace_root.clone()));

    let session_id = AsterAgentWrapper::create_session_sync(
        db,
        name,
        resolved_working_dir,
        workspace_id,
        Some(
            execution_strategy
                .unwrap_or(AsterExecutionStrategy::React)
                .as_db_value()
                .to_string(),
        ),
    )?;

    AsterAgentWrapper::persist_session_recent_access_mode(
        &session_id,
        lime_agent::SessionExecutionRuntimeAccessMode::default_for_session(),
    )
    .await?;

    if let Some((state, mcp_manager)) = runtime {
        run_runtime_session_start_project_hooks_with_runtime(
            &session_id,
            &workspace_root,
            SessionSource::Startup,
            db,
            state,
            mcp_manager,
        )
        .await;
    } else {
        run_runtime_session_start_project_hooks(
            &session_id,
            &workspace_root,
            SessionSource::Startup,
        )
        .await;
    }

    Ok(session_id)
}

pub(crate) fn update_runtime_session_execution_strategy_internal(
    db: &DbConnection,
    session_id: &str,
    execution_strategy: AsterExecutionStrategy,
) -> Result<(), String> {
    AsterAgentWrapper::update_session_execution_strategy_sync(
        db,
        session_id,
        execution_strategy.as_db_value(),
    )
}

pub(crate) fn list_runtime_sessions_internal(
    db: &DbConnection,
) -> Result<Vec<SessionInfo>, String> {
    tracing::info!("[AsterAgent] 列出会话");
    AsterAgentWrapper::list_sessions_sync(db)
}

pub(crate) fn rename_runtime_session_internal(
    db: &DbConnection,
    session_id: &str,
    name: &str,
) -> Result<(), String> {
    tracing::info!("[AsterAgent] 重命名会话: {}", session_id);
    AsterAgentWrapper::rename_session_sync(db, session_id, name)
}

pub(crate) async fn delete_runtime_session_internal(
    db: &DbConnection,
    session_id: &str,
) -> Result<(), String> {
    tracing::info!("[AsterAgent] 删除会话: {}", session_id);
    AsterAgentWrapper::delete_session(db, session_id).await?;
    Ok(())
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
    use rusqlite::Connection;
    use tokio::sync::OnceCell;

    async fn ensure_session_runtime_test_manager() {
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

    fn write_session_start_hook(workspace_root: &Path, output_path: &Path) {
        let claude_dir = workspace_root.join(".claude");
        std::fs::create_dir_all(&claude_dir).expect("创建 .claude 目录失败");

        let settings = serde_json::json!({
            "hooks": {
                "SessionStart": [
                    {
                        "type": "command",
                        "command": "printf '%s' \"$CLAUDE_HOOK_SESSION_ID\" > \"$HOOK_OUTPUT_PATH\"",
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
    async fn create_runtime_session_internal_should_run_project_session_start_hooks() {
        ensure_session_runtime_test_manager().await;

        let conn = Connection::open_in_memory().expect("创建内存数据库失败");
        create_tables(&conn).expect("初始化表结构失败");
        let db = Arc::new(Mutex::new(conn));

        let temp_dir = tempfile::TempDir::new().expect("create temp dir");
        let workspace_root = temp_dir.path().join("workspace");
        std::fs::create_dir_all(&workspace_root).expect("创建 workspace 目录失败");
        let hook_output_path = temp_dir.path().join("session-start-hook.txt");
        write_session_start_hook(&workspace_root, &hook_output_path);

        let manager = WorkspaceManager::new(db.clone());
        let workspace = manager
            .create(
                "Session Start Hook Workspace".to_string(),
                workspace_root.clone(),
            )
            .expect("创建 workspace 失败");

        let session_id = create_runtime_session_internal(
            &db,
            None,
            workspace.id.clone(),
            Some("Session Start Hook Test".to_string()),
            Some(AsterExecutionStrategy::React),
        )
        .await
        .expect("创建 runtime session 失败");

        let hook_output =
            std::fs::read_to_string(&hook_output_path).expect("应能读取 SessionStart hook 输出");
        assert_eq!(hook_output, session_id);

        delete_managed_session(&session_id)
            .await
            .expect("清理测试 session 失败");
    }
}
