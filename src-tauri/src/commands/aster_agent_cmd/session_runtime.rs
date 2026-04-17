use super::*;
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
