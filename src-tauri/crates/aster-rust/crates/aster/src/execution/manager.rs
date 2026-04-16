use crate::agents::extension::PlatformExtensionContext;
use crate::agents::{Agent, SessionConfig};
use crate::config::paths::Paths;
use crate::config::Config;
use crate::conversation::message::Message;
use crate::scheduler::Scheduler;
use crate::scheduler_trait::SchedulerTrait;
use crate::session::{
    create_subagent_session, persist_session_extension_data, query_session,
    require_shared_session_runtime_store, save_team_membership, save_team_state, QueuedTurnRuntime,
    RuntimeQueueSubmitResult, SessionRuntimeQueueService, SubagentSessionMetadata, TeamMember,
    TeamMembershipState, TeamSessionState, ThreadRuntimeStore,
};
#[cfg(test)]
use crate::session::{SessionManager, SessionType};
use crate::tools::{
    AgentControlToolConfig, SendInputRequest, SendInputResponse, SpawnAgentRequest,
    SpawnAgentResponse, ToolRegistrationConfig,
};
use anyhow::{Context, Result};
use chrono::Utc;
use futures::StreamExt;
use lru::LruCache;
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap};
use std::num::NonZeroUsize;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::{OnceCell, RwLock};
use tracing::{debug, info, warn};
use uuid::Uuid;

const DEFAULT_MAX_SESSION: usize = 100;

static AGENT_MANAGER: OnceCell<Arc<AgentManager>> = OnceCell::const_new();

#[derive(Clone)]
struct AgentManagerRuntime {
    sessions: Arc<RwLock<LruCache<String, Arc<Agent>>>>,
    scheduler: Arc<dyn SchedulerTrait>,
    default_provider: Arc<RwLock<Option<Arc<dyn crate::providers::base::Provider>>>>,
    thread_runtime_store: Arc<dyn ThreadRuntimeStore>,
    runtime_queue: Arc<SessionRuntimeQueueService>,
}

fn normalize_optional_text(value: Option<String>) -> Option<String> {
    let trimmed = value?.trim().to_string();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

fn require_non_empty_text(value: String, field_name: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        Err(format!("{field_name} 不能为空"))
    } else {
        Ok(trimmed.to_string())
    }
}

fn resolve_spawn_working_dir(
    parent_working_dir: &Path,
    requested_cwd: Option<String>,
) -> Result<PathBuf, String> {
    let Some(cwd) = normalize_optional_text(requested_cwd) else {
        return Ok(parent_working_dir.to_path_buf());
    };

    let path = PathBuf::from(&cwd);
    if !path.is_absolute() {
        return Err("cwd 必须是绝对路径".to_string());
    }
    if !path.is_dir() {
        return Err(format!("cwd 不是有效目录: {cwd}"));
    }

    Ok(path)
}

fn message_preview(text: &str) -> String {
    const MAX_PREVIEW_CHARS: usize = 96;
    let normalized = text.split_whitespace().collect::<Vec<_>>().join(" ");
    let trimmed = normalized.trim();
    if trimmed.is_empty() {
        return "Empty message".to_string();
    }

    let chars = trimmed.chars().collect::<Vec<_>>();
    if chars.len() <= MAX_PREVIEW_CHARS {
        trimmed.to_string()
    } else {
        let truncated = chars
            .into_iter()
            .take(MAX_PREVIEW_CHARS.saturating_sub(3))
            .collect::<String>();
        format!("{truncated}...")
    }
}

fn queued_turn_from_request(request: &SendInputRequest, message: String) -> QueuedTurnRuntime {
    QueuedTurnRuntime {
        queued_turn_id: Uuid::new_v4().to_string(),
        session_id: request.id.clone(),
        message_preview: message_preview(&message),
        message_text: message,
        created_at: Utc::now().timestamp_millis(),
        image_count: 0,
        payload: json!({
            "source": "agent_control",
            "interrupt": request.interrupt
        }),
        metadata: HashMap::new(),
    }
}

fn session_name_for_spawn(request: &SpawnAgentRequest) -> String {
    normalize_optional_text(request.name.clone())
        .or_else(|| normalize_optional_text(request.agent_type.clone()))
        .unwrap_or_else(|| "Background agent".to_string())
}

fn build_agent_control_tool_config(runtime: AgentManagerRuntime) -> AgentControlToolConfig {
    let spawn_runtime = runtime.clone();
    let send_runtime = runtime;

    AgentControlToolConfig::new()
        .with_spawn_agent_callback(Arc::new(move |request| {
            let runtime = spawn_runtime.clone();
            Box::pin(async move { spawn_agent_with_runtime(runtime, request).await })
        }))
        .with_send_input_callback(Arc::new(move |request| {
            let runtime = send_runtime.clone();
            Box::pin(async move { send_input_with_runtime(runtime, request).await })
        }))
}

async fn get_or_create_agent_with_runtime(
    runtime: &AgentManagerRuntime,
    session_id: String,
) -> Result<Arc<Agent>> {
    {
        let mut sessions = runtime.sessions.write().await;
        if let Some(existing) = sessions.get(&session_id) {
            return Ok(Arc::clone(existing));
        }
    }

    let tool_config = ToolRegistrationConfig::new()
        .with_agent_control_tools(build_agent_control_tool_config(runtime.clone()))
        .with_scheduler(Arc::clone(&runtime.scheduler));
    let agent = Arc::new(
        Agent::with_tool_config(tool_config)
            .with_thread_runtime_store(Arc::clone(&runtime.thread_runtime_store)),
    );
    agent
        .extension_manager
        .set_context(PlatformExtensionContext {
            session_id: Some(session_id.clone()),
            extension_manager: Some(Arc::downgrade(&agent.extension_manager)),
        })
        .await;
    if let Some(provider) = &*runtime.default_provider.read().await {
        agent
            .update_provider(Arc::clone(provider), &session_id)
            .await?;
    }

    let mut sessions = runtime.sessions.write().await;
    if let Some(existing) = sessions.get(&session_id) {
        Ok(Arc::clone(existing))
    } else {
        sessions.put(session_id, agent.clone());
        Ok(agent)
    }
}

async fn execute_queued_turn(
    runtime: AgentManagerRuntime,
    queued_turn: &QueuedTurnRuntime,
) -> Result<()> {
    let agent = get_or_create_agent_with_runtime(&runtime, queued_turn.session_id.clone()).await?;
    agent.provider().await.context(format!(
        "session {} 缺少 provider，无法继续后台 agent",
        queued_turn.session_id
    ))?;

    let user_message = Message::user().with_text(queued_turn.message_text.clone());
    let session_config = SessionConfig {
        id: queued_turn.session_id.clone(),
        thread_id: None,
        turn_id: Some(queued_turn.queued_turn_id.clone()),
        schedule_id: None,
        max_turns: None,
        retry_config: None,
        system_prompt: None,
        include_context_trace: None,
        turn_context: None,
    };

    let stream =
        crate::session_context::with_session_id(Some(queued_turn.session_id.clone()), async {
            agent.reply(user_message, session_config, None).await
        })
        .await?;
    let mut stream = std::pin::pin!(stream);

    while let Some(event) = stream.next().await {
        event?;
    }

    Ok(())
}

fn spawn_turn_processor(runtime: AgentManagerRuntime, initial_turn: QueuedTurnRuntime) {
    tokio::spawn(async move {
        let mut pending_turn = Some(initial_turn);
        while let Some(queued_turn) = pending_turn.take() {
            if let Err(error) = execute_queued_turn(runtime.clone(), &queued_turn).await {
                warn!(
                    "Background agent turn failed for session {}: {}",
                    queued_turn.session_id, error
                );
            }

            match runtime
                .runtime_queue
                .finish_turn_and_take_next(&queued_turn.session_id)
                .await
            {
                Ok(Some(next_turn)) => pending_turn = Some(next_turn),
                Ok(None) => break,
                Err(error) => {
                    warn!(
                        "Failed to resume queued background turn for session {}: {}",
                        queued_turn.session_id, error
                    );
                    break;
                }
            }
        }
    });
}

async fn send_input_with_runtime(
    runtime: AgentManagerRuntime,
    request: SendInputRequest,
) -> Result<SendInputResponse, String> {
    let message = require_non_empty_text(request.message.clone(), "message")?;
    query_session(&request.id, false)
        .await
        .map_err(|error| format!("目标 agent 不存在: {error}"))?;

    let agent = get_or_create_agent_with_runtime(&runtime, request.id.clone())
        .await
        .map_err(|error| format!("加载目标 agent 失败: {error}"))?;
    agent
        .provider()
        .await
        .map_err(|error| format!("目标 agent 缺少 provider: {error}"))?;

    if request.interrupt {
        runtime
            .runtime_queue
            .clear_queued_turns(&request.id)
            .await
            .map_err(|error| format!("清理排队消息失败: {error}"))?;
    }

    let queued_turn = queued_turn_from_request(&request, message);
    let submit_result = runtime
        .runtime_queue
        .submit_turn(queued_turn.clone(), true)
        .await
        .map_err(|error| format!("提交后台 turn 失败: {error}"))?;

    let mut extra = BTreeMap::new();
    extra.insert(
        "delivery".to_string(),
        Value::String(
            match &submit_result {
                RuntimeQueueSubmitResult::StartNow => "started",
                RuntimeQueueSubmitResult::Busy => "busy",
                RuntimeQueueSubmitResult::Enqueued { .. } => "queued",
            }
            .to_string(),
        ),
    );
    extra.insert(
        "interruptClearedQueue".to_string(),
        Value::Bool(request.interrupt),
    );

    match submit_result {
        RuntimeQueueSubmitResult::StartNow => {
            spawn_turn_processor(runtime, queued_turn.clone());
        }
        RuntimeQueueSubmitResult::Enqueued { position, .. } => {
            extra.insert("queuePosition".to_string(), json!(position));
        }
        RuntimeQueueSubmitResult::Busy => {}
    }

    Ok(SendInputResponse {
        submission_id: queued_turn.queued_turn_id,
        extra,
    })
}

async fn register_spawned_teammate(
    parent_session_id: &str,
    child_session_id: &str,
    team_name: String,
    teammate_name: String,
    agent_type: Option<String>,
) -> Result<(), String> {
    let parent_session = query_session(parent_session_id, false)
        .await
        .map_err(|error| format!("读取父会话失败: {error}"))?;
    let Some(mut team_state) = TeamSessionState::from_session(&parent_session) else {
        return Err("当前 session 还没有 team 上下文，请先执行 TeamCreate".to_string());
    };
    if team_state.team_name != team_name {
        return Err(format!(
            "team_name 不匹配：当前 team 为 {}, 但请求的是 {}",
            team_state.team_name, team_name
        ));
    }
    if team_state.find_member_by_name(&teammate_name).is_some() {
        return Err(format!("team 中已存在名为 {teammate_name} 的成员"));
    }

    team_state.add_or_update_member(TeamMember::teammate(
        child_session_id.to_string(),
        teammate_name.clone(),
        agent_type.clone(),
    ));
    save_team_state(parent_session_id, Some(team_state))
        .await
        .map_err(|error| format!("更新 team 状态失败: {error}"))?;
    save_team_membership(
        child_session_id,
        Some(TeamMembershipState {
            team_name,
            lead_session_id: parent_session_id.to_string(),
            agent_id: child_session_id.to_string(),
            name: teammate_name,
            agent_type,
        }),
    )
    .await
    .map_err(|error| format!("保存 team 成员信息失败: {error}"))?;

    Ok(())
}

async fn spawn_agent_with_runtime(
    runtime: AgentManagerRuntime,
    request: SpawnAgentRequest,
) -> Result<SpawnAgentResponse, String> {
    let initial_message = require_non_empty_text(request.message.clone(), "message")?;
    let parent_session = query_session(&request.parent_session_id, false)
        .await
        .map_err(|error| format!("读取父会话失败: {error}"))?;
    let working_dir = resolve_spawn_working_dir(&parent_session.working_dir, request.cwd.clone())?;
    let session_name = session_name_for_spawn(&request);
    let child_session = create_subagent_session(working_dir, session_name)
        .await
        .map_err(|error| format!("创建子会话失败: {error}"))?;

    let metadata = SubagentSessionMetadata::new(request.parent_session_id.clone())
        .with_task_summary(Some(message_preview(&initial_message)))
        .with_role_hint(
            normalize_optional_text(request.name.clone())
                .or_else(|| normalize_optional_text(request.agent_type.clone())),
        );
    let extension_data = metadata
        .into_updated_extension_data(&child_session)
        .map_err(|error| format!("构建子会话元数据失败: {error}"))?;
    persist_session_extension_data(&child_session.id, extension_data)
        .await
        .map_err(|error| format!("保存子会话元数据失败: {error}"))?;

    if let (Some(team_name), Some(name)) = (
        normalize_optional_text(request.team_name.clone()),
        normalize_optional_text(request.name.clone()),
    ) {
        register_spawned_teammate(
            &request.parent_session_id,
            &child_session.id,
            team_name,
            name,
            normalize_optional_text(request.agent_type.clone()),
        )
        .await?;
    }

    let parent_agent =
        get_or_create_agent_with_runtime(&runtime, request.parent_session_id.clone())
            .await
            .map_err(|error| format!("加载父 agent 失败: {error}"))?;
    let parent_provider = parent_agent
        .provider()
        .await
        .map_err(|error| format!("父 agent 缺少 provider: {error}"))?;
    let child_agent = get_or_create_agent_with_runtime(&runtime, child_session.id.clone())
        .await
        .map_err(|error| format!("加载子 agent 失败: {error}"))?;
    child_agent
        .update_provider(parent_provider, &child_session.id)
        .await
        .map_err(|error| format!("继承 provider 失败: {error}"))?;

    for extension in parent_agent.get_extension_configs().await {
        if let Err(error) = child_agent.add_extension(extension).await {
            debug!(
                "Failed to inherit extension for spawned agent {}: {}",
                child_session.id, error
            );
        }
    }

    let submission = send_input_with_runtime(
        runtime,
        SendInputRequest {
            id: child_session.id.clone(),
            message: initial_message,
            interrupt: false,
        },
    )
    .await?;

    let mut extra = BTreeMap::new();
    extra.insert(
        "submissionId".to_string(),
        Value::String(submission.submission_id),
    );

    Ok(SpawnAgentResponse {
        agent_id: child_session.id,
        nickname: normalize_optional_text(request.name),
        extra,
    })
}

pub struct AgentManager {
    sessions: Arc<RwLock<LruCache<String, Arc<Agent>>>>,
    scheduler: Arc<dyn SchedulerTrait>,
    default_provider: Arc<RwLock<Option<Arc<dyn crate::providers::base::Provider>>>>,
    thread_runtime_store: Arc<dyn ThreadRuntimeStore>,
    runtime_queue: Arc<SessionRuntimeQueueService>,
}

impl AgentManager {
    pub async fn new_with_thread_runtime_store(
        max_sessions: Option<usize>,
        thread_runtime_store: Arc<dyn ThreadRuntimeStore>,
    ) -> Result<Self> {
        let schedule_file_path = Paths::data_dir().join("schedule.json");

        let scheduler = Scheduler::new(schedule_file_path).await?;

        let capacity = NonZeroUsize::new(max_sessions.unwrap_or(DEFAULT_MAX_SESSION))
            .unwrap_or_else(|| NonZeroUsize::new(100).unwrap());

        let manager = Self {
            sessions: Arc::new(RwLock::new(LruCache::new(capacity))),
            scheduler,
            default_provider: Arc::new(RwLock::new(None)),
            runtime_queue: Arc::new(SessionRuntimeQueueService::new(
                thread_runtime_store.clone(),
            )),
            thread_runtime_store,
        };

        Ok(manager)
    }

    pub async fn instance() -> Result<Arc<Self>> {
        AGENT_MANAGER
            .get_or_try_init(|| async {
                let max_sessions = Config::global()
                    .get_aster_max_active_agents()
                    .unwrap_or(DEFAULT_MAX_SESSION);
                let manager = Self::new_with_thread_runtime_store(
                    Some(max_sessions),
                    require_shared_session_runtime_store()
                        .context("AgentManager 启动前必须先初始化 shared thread runtime store")?,
                )
                .await?;
                Ok(Arc::new(manager))
            })
            .await
            .cloned()
    }

    pub fn scheduler(&self) -> Arc<dyn SchedulerTrait> {
        Arc::clone(&self.scheduler)
    }

    pub async fn set_default_provider(&self, provider: Arc<dyn crate::providers::base::Provider>) {
        debug!("Setting default provider on AgentManager");
        *self.default_provider.write().await = Some(provider);
    }

    fn runtime_handle(&self) -> AgentManagerRuntime {
        AgentManagerRuntime {
            sessions: Arc::clone(&self.sessions),
            scheduler: Arc::clone(&self.scheduler),
            default_provider: Arc::clone(&self.default_provider),
            thread_runtime_store: Arc::clone(&self.thread_runtime_store),
            runtime_queue: Arc::clone(&self.runtime_queue),
        }
    }

    pub async fn get_or_create_agent(&self, session_id: String) -> Result<Arc<Agent>> {
        get_or_create_agent_with_runtime(&self.runtime_handle(), session_id).await
    }

    pub async fn remove_session(&self, session_id: &str) -> Result<()> {
        let mut sessions = self.sessions.write().await;
        sessions
            .pop(session_id)
            .ok_or_else(|| anyhow::anyhow!("Session {} not found", session_id))?;
        info!("Removed session {}", session_id);
        Ok(())
    }

    pub async fn has_session(&self, session_id: &str) -> bool {
        self.sessions.read().await.contains(session_id)
    }

    pub async fn session_count(&self) -> usize {
        self.sessions.read().await.len()
    }
}

#[cfg(test)]
mod tests {
    use serial_test::serial;
    use std::sync::Arc;

    use crate::execution::{manager::AgentManager, SessionExecutionMode};

    async fn test_manager() -> Arc<AgentManager> {
        Arc::new(
            AgentManager::new_with_thread_runtime_store(
                None,
                Arc::new(crate::session::InMemoryThreadRuntimeStore::default()),
            )
            .await
            .unwrap(),
        )
    }

    #[test]
    fn test_execution_mode_constructors() {
        assert_eq!(
            SessionExecutionMode::chat(),
            SessionExecutionMode::Interactive
        );
        assert_eq!(
            SessionExecutionMode::scheduled(),
            SessionExecutionMode::Background
        );

        let parent = "parent-123".to_string();
        assert_eq!(
            SessionExecutionMode::task(parent.clone()),
            SessionExecutionMode::SubTask {
                parent_session: parent
            }
        );
    }

    #[tokio::test]
    #[serial]
    async fn test_session_isolation() {
        let manager = test_manager().await;

        let session1 = uuid::Uuid::new_v4().to_string();
        let session2 = uuid::Uuid::new_v4().to_string();

        let agent1 = manager.get_or_create_agent(session1.clone()).await.unwrap();

        let agent2 = manager.get_or_create_agent(session2.clone()).await.unwrap();

        // Different sessions should have different agents
        assert!(!Arc::ptr_eq(&agent1, &agent2));

        // Getting the same session should return the same agent
        let agent1_again = manager.get_or_create_agent(session1).await.unwrap();

        assert!(Arc::ptr_eq(&agent1, &agent1_again));
    }

    #[tokio::test]
    #[serial]
    async fn test_session_limit() {
        let manager = test_manager().await;

        let sessions: Vec<_> = (0..100).map(|i| format!("session-{}", i)).collect();

        for session in &sessions {
            manager.get_or_create_agent(session.clone()).await.unwrap();
        }

        // Create a new session after cleanup
        let new_session = "new-session".to_string();
        let _new_agent = manager.get_or_create_agent(new_session).await.unwrap();

        assert_eq!(manager.session_count().await, 100);
    }

    #[tokio::test]
    #[serial]
    async fn test_remove_session() {
        let manager = test_manager().await;
        let session = String::from("remove-test");

        manager.get_or_create_agent(session.clone()).await.unwrap();
        assert!(manager.has_session(&session).await);

        manager.remove_session(&session).await.unwrap();
        assert!(!manager.has_session(&session).await);

        assert!(manager.remove_session(&session).await.is_err());
    }

    #[tokio::test]
    #[serial]
    async fn test_concurrent_access() {
        let manager = test_manager().await;
        let session = String::from("concurrent-test");

        let mut handles = vec![];
        for _ in 0..10 {
            let mgr = Arc::clone(&manager);
            let sess = session.clone();
            handles.push(tokio::spawn(async move {
                mgr.get_or_create_agent(sess).await.unwrap()
            }));
        }

        let agents: Vec<_> = futures::future::join_all(handles)
            .await
            .into_iter()
            .map(|r| r.unwrap())
            .collect();

        for agent in &agents[1..] {
            assert!(Arc::ptr_eq(&agents[0], agent));
        }

        assert_eq!(manager.session_count().await, 1);
    }

    #[tokio::test]
    #[serial]
    async fn test_concurrent_session_creation_race_condition() {
        // Test that concurrent attempts to create the same new session ID
        // result in only one agent being created (tests double-check pattern)
        let manager = test_manager().await;
        let session_id = String::from("race-condition-test");

        // Spawn multiple tasks trying to create the same NEW session simultaneously
        let mut handles = vec![];
        for _ in 0..20 {
            let sess = session_id.clone();
            let mgr_clone = Arc::clone(&manager);
            handles.push(tokio::spawn(async move {
                mgr_clone.get_or_create_agent(sess).await.unwrap()
            }));
        }

        // Collect all agents
        let agents: Vec<_> = futures::future::join_all(handles)
            .await
            .into_iter()
            .map(|r| r.unwrap())
            .collect();

        for agent in &agents[1..] {
            assert!(
                Arc::ptr_eq(&agents[0], agent),
                "All concurrent requests should get the same agent"
            );
        }
        assert_eq!(manager.session_count().await, 1);
    }

    #[tokio::test]
    #[serial]
    async fn test_set_default_provider() {
        use crate::providers::testprovider::TestProvider;
        use std::sync::Arc;

        let manager = test_manager().await;

        // Create a test provider for replaying (doesn't need inner provider)
        let temp_file = format!(
            "{}/test_provider_{}.json",
            std::env::temp_dir().display(),
            std::process::id()
        );

        // Create an empty test provider (will fail on actual use but that's ok for this test)
        let test_provider = TestProvider::new_replaying(&temp_file)
            .unwrap_or_else(|_| TestProvider::new_replaying("/tmp/dummy.json").unwrap());

        manager.set_default_provider(Arc::new(test_provider)).await;

        let session = String::from("provider-test");
        let _agent = manager.get_or_create_agent(session.clone()).await.unwrap();

        assert!(manager.has_session(&session).await);
    }

    #[tokio::test]
    #[serial]
    async fn test_manager_created_agents_expose_current_surface_coordination_tools() {
        use crate::session::{SessionManager, SessionType};
        use std::collections::HashSet;
        use tempfile::tempdir;

        let manager = test_manager().await;
        let temp_dir = tempdir().unwrap();
        let session = SessionManager::create_session(
            temp_dir.path().to_path_buf(),
            "manager-tool-surface".to_string(),
            SessionType::User,
        )
        .await
        .unwrap();

        let agent = manager.get_or_create_agent(session.id).await.unwrap();
        let tool_names = agent
            .list_tools(None)
            .await
            .into_iter()
            .map(|tool| tool.name)
            .collect::<HashSet<_>>();

        for expected in [
            "SendMessage",
            "TeamCreate",
            "TeamDelete",
            "ListPeers",
            "CronCreate",
            "CronList",
            "CronDelete",
        ] {
            assert!(
                tool_names.contains(expected),
                "manager-created current surface should expose {expected}"
            );
        }
    }

    #[tokio::test]
    #[serial]
    async fn test_spawned_named_agent_registers_name_route_for_parent_session() {
        use crate::providers::testprovider::TestProvider;
        use crate::session::{resolve_named_subagent_child_session, SessionManager, SessionType};
        use crate::tools::SpawnAgentRequest;
        use tempfile::tempdir;

        let manager = test_manager().await;
        let temp_dir = tempdir().unwrap();
        let session = SessionManager::create_session(
            temp_dir.path().to_path_buf(),
            "spawn-parent".to_string(),
            SessionType::User,
        )
        .await
        .unwrap();

        let temp_file = format!(
            "{}/test_provider_spawn_{}.json",
            std::env::temp_dir().display(),
            std::process::id()
        );
        let test_provider = TestProvider::new_replaying(&temp_file)
            .unwrap_or_else(|_| TestProvider::new_replaying("/tmp/dummy.json").unwrap());
        manager.set_default_provider(Arc::new(test_provider)).await;

        let response = super::spawn_agent_with_runtime(
            manager.runtime_handle(),
            SpawnAgentRequest {
                parent_session_id: session.id.clone(),
                message: "执行一次验证".to_string(),
                name: Some("verifier".to_string()),
                team_name: None,
                agent_type: None,
                model: None,
                run_in_background: false,
                reasoning_effort: None,
                fork_context: false,
                blueprint_role_id: None,
                blueprint_role_label: None,
                profile_id: None,
                profile_name: None,
                role_key: None,
                skill_ids: Vec::new(),
                skill_directories: Vec::new(),
                team_preset_id: None,
                theme: None,
                system_overlay: None,
                output_contract: None,
                mode: None,
                isolation: None,
                cwd: None,
            },
        )
        .await
        .unwrap();

        let resolved = resolve_named_subagent_child_session(&session.id, "verifier")
            .await
            .unwrap()
            .expect("应能按名字解析刚创建的子 agent");

        assert_eq!(resolved.id, response.agent_id);
    }

    #[tokio::test]
    #[serial]
    async fn test_team_spawned_agent_can_list_peers_and_receive_named_send_message() {
        use crate::providers::testprovider::TestProvider;
        use crate::session::{SessionManager, SessionType};
        use crate::tools::{ListPeersTool, SpawnAgentRequest, TeamCreateTool, Tool, ToolContext};
        use rmcp::model::CallToolRequestParam;
        use serde_json::json;
        use tempfile::tempdir;

        let manager = test_manager().await;
        let temp_dir = tempdir().unwrap();
        let lead = SessionManager::create_session(
            temp_dir.path().to_path_buf(),
            "team-lead-parent".to_string(),
            SessionType::User,
        )
        .await
        .unwrap();

        let temp_file = format!(
            "{}/test_provider_team_spawn_{}.json",
            std::env::temp_dir().display(),
            std::process::id()
        );
        let test_provider = TestProvider::new_replaying(&temp_file)
            .unwrap_or_else(|_| TestProvider::new_replaying("/tmp/dummy.json").unwrap());
        manager.set_default_provider(Arc::new(test_provider)).await;

        let lead_agent = manager.get_or_create_agent(lead.id.clone()).await.unwrap();
        let lead_context =
            ToolContext::new(temp_dir.path().to_path_buf()).with_session_id(&lead.id);
        let team_name = format!("delivery-team-{}", lead.id);

        TeamCreateTool::new()
            .execute(
                json!({
                    "team_name": team_name,
                    "description": "team routing smoke"
                }),
                &lead_context,
            )
            .await
            .unwrap();

        let spawned = super::spawn_agent_with_runtime(
            manager.runtime_handle(),
            SpawnAgentRequest {
                parent_session_id: lead.id.clone(),
                message: "执行一次协作验证".to_string(),
                name: Some("verifier".to_string()),
                team_name: Some(team_name),
                agent_type: None,
                model: None,
                run_in_background: false,
                reasoning_effort: None,
                fork_context: false,
                blueprint_role_id: None,
                blueprint_role_label: None,
                profile_id: None,
                profile_name: None,
                role_key: None,
                skill_ids: Vec::new(),
                skill_directories: Vec::new(),
                team_preset_id: None,
                theme: None,
                system_overlay: None,
                output_contract: None,
                mode: None,
                isolation: None,
                cwd: Some(temp_dir.path().display().to_string()),
            },
        )
        .await
        .unwrap();

        let spawned_session = query_session(&spawned.agent_id, false).await.unwrap();
        assert_eq!(spawned_session.working_dir, temp_dir.path());

        let peers_result = ListPeersTool::new()
            .execute(json!({}), &lead_context)
            .await
            .unwrap();
        let peers = peers_result.metadata["peers"]
            .as_array()
            .expect("peers metadata should be an array");
        assert_eq!(peers.len(), 1);
        assert_eq!(peers[0]["name"], json!("verifier"));
        assert_eq!(peers[0]["sendTo"], json!("verifier"));

        let send_message_args = json!({
            "to": peers[0]["sendTo"].as_str().expect("sendTo should be string"),
            "message": "继续验证 team 主线"
        });
        let send_message_call = CallToolRequestParam {
            name: "SendMessage".into(),
            arguments: Some(
                send_message_args
                    .as_object()
                    .cloned()
                    .expect("send message args should be an object"),
            ),
        };

        let (_request_id, tool_result) = lead_agent
            .dispatch_tool_call(
                send_message_call,
                "req-team-send-message".to_string(),
                None,
                &lead,
            )
            .await;
        let tool_result = tool_result.expect("SendMessage dispatch should succeed");
        let call_result = tool_result
            .result
            .await
            .expect("SendMessage tool result should succeed");
        let structured_content = call_result
            .structured_content
            .expect("SendMessage should return structured metadata");

        assert_eq!(
            structured_content["send_message"]["deliveries"][0]["target"],
            json!("verifier")
        );
        assert_eq!(
            structured_content["send_message"]["deliveries"][0]["agentId"],
            json!(spawned.agent_id)
        );
    }

    #[tokio::test]
    #[serial]
    async fn test_eviction_updates_last_used() {
        // Test that accessing a session updates its last_used timestamp
        // and affects eviction order
        let manager = test_manager().await;

        let sessions: Vec<_> = (0..100).map(|i| format!("session-{}", i)).collect();

        for session in &sessions {
            manager.get_or_create_agent(session.clone()).await.unwrap();
            // Small delay to ensure different timestamps
            tokio::time::sleep(tokio::time::Duration::from_millis(10)).await;
        }

        // Access the first session again to update its last_used
        tokio::time::sleep(tokio::time::Duration::from_millis(10)).await;
        manager
            .get_or_create_agent(sessions[0].clone())
            .await
            .unwrap();

        // Now create a 101st session - should evict session2 (least recently used)
        let session101 = String::from("session-101");
        manager
            .get_or_create_agent(session101.clone())
            .await
            .unwrap();

        assert!(manager.has_session(&sessions[0]).await);
        assert!(!manager.has_session(&sessions[1]).await);
        assert!(manager.has_session(&session101).await);
    }

    #[tokio::test]
    #[serial]
    async fn test_remove_nonexistent_session_error() {
        // Test that removing a non-existent session returns an error
        let manager = test_manager().await;
        let session = String::from("never-created");

        let result = manager.remove_session(&session).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("not found"));
    }
}
