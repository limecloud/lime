use super::request_model_resolution::resolve_runtime_provider_auth_recovery_config;
#[cfg(test)]
use super::runtime_project_hooks::enforce_runtime_turn_user_prompt_submit_hooks;
use super::runtime_project_hooks::{
    decide_runtime_permission_request_project_hooks_for_session_with_runtime,
    enforce_runtime_pre_compact_project_hooks_for_session_with_runtime,
    enforce_runtime_turn_user_prompt_submit_hooks_with_runtime,
    run_runtime_session_start_project_hooks_for_session_with_runtime,
    run_runtime_stop_project_hooks_for_session_with_runtime,
};
use super::service_skill_launch::build_service_skill_preload_tool_projection;
use super::*;
use crate::commands::auxiliary_model_selection::{
    build_auxiliary_runtime_metadata, build_auxiliary_turn_context_override,
    prepare_auxiliary_provider_scope, AuxiliaryProviderResolution, AuxiliaryServiceModelSlot,
};
use aster::agents::extension::PlatformExtensionContext;
use aster::hooks::{CompactTrigger, SessionSource};
use aster::session::TurnContextOverride;
use aster::tools::{ConfigTool, SkillTool};
use lime_agent::AgentEvent as RuntimeAgentEvent;
use lime_core::workspace::WorkspaceSettings;
use regex::Regex;
use std::sync::{Arc, OnceLock};
use tauri::Manager;

const ARTIFACT_DOCUMENT_REPAIRED_WARNING_CODE: &str = "artifact_document_repaired";
const ARTIFACT_DOCUMENT_FAILED_WARNING_CODE: &str = "artifact_document_failed";
const ARTIFACT_DOCUMENT_PERSIST_FAILED_WARNING_CODE: &str = "artifact_document_persist_failed";
const AUTO_CONTEXT_COMPACTION_EVENT_PREFIX: &str = "agent_context_compaction_auto_internal";
const AUTO_CONTEXT_COMPACTION_FAILED_WARNING_CODE: &str = "context_compaction_auto_failed";
const CONTEXT_COMPACTION_NOT_NEEDED_WARNING_CODE: &str = "context_compaction_not_needed";
const RUNTIME_MODEL_PERMISSION_FALLBACK_WARNING_CODE: &str = "runtime_model_permission_fallback";
const STOP_HOOK_CONTINUATION_UNSUPPORTED_WARNING_CODE: &str = "stop_hook_continuation_unsupported";
const TURN_MEMORY_PREFETCH_PROMPT_MARKER: &str = "【运行时记忆召回】";
const TURN_LOCAL_PATH_FOCUS_PROMPT_MARKER: &str = "【本回合本地路径焦点】";
const LIME_RUNTIME_METADATA_KEY: &str = "lime_runtime";
const LIME_RUNTIME_AUTO_COMPACT_KEY: &str = "auto_compact";
const LIME_RUNTIME_TOOL_SURFACE_KEY: &str = "tool_surface";
const LIME_RUNTIME_IMAGE_INPUT_POLICY_KEY: &str = "image_input_policy";
const FAST_CHAT_TOOL_SURFACE_DIRECT_ANSWER: &str = "direct_answer";
const FAST_CHAT_TOOL_SURFACE_LOCAL_WORKSPACE: &str = "local_workspace";
const RUNTIME_IMAGE_INPUT_UNSUPPORTED_WARNING_CODE: &str = "runtime_image_input_unsupported";
const AUTO_RUNTIME_MEMORY_MIN_USER_CHARS: usize = 12;
const AUTO_RUNTIME_MEMORY_MIN_ASSISTANT_CHARS: usize = 48;
const AUTO_RUNTIME_MEMORY_MIN_TOTAL_CHARS: usize = 160;
const AUTO_RUNTIME_MEMORY_SESSION_MESSAGE_LIMIT: usize = 8;
const AUTO_RUNTIME_MEMORY_SESSION_MIN_MESSAGE_LENGTH: usize = 18;
const COMPACTION_FALLBACK_PROVIDER_CHAIN: [(&str, &str); 4] = [
    ("deepseek", "deepseek-chat"),
    ("openai", "gpt-4o-mini"),
    ("anthropic", "claude-3-haiku-20240307"),
    ("kiro", "anthropic.claude-3-haiku-20240307-v1:0"),
];

fn emit_runtime_events(app: &AppHandle, event_name: &str, events: Vec<RuntimeAgentEvent>) {
    for event in events {
        if let Err(error) = app.emit(event_name, &event) {
            tracing::error!("[AsterAgent] 发送运行时事件失败: {}", error);
        }
    }
}

fn is_runtime_model_permission_denied_error(message: &str) -> bool {
    let normalized = message.trim().to_ascii_lowercase();
    normalized.contains("authentication failed")
        && normalized.contains("403")
        && normalized.contains("illegal access")
}

fn build_submit_accepted_runtime_status() -> AgentRuntimeStatus {
    AgentRuntimeStatus {
        phase: "preparing".to_string(),
        title: "已接收请求，正在准备执行".to_string(),
        detail: "系统正在初始化本轮执行环境并整理上下文，稍后会继续返回更详细进度。".to_string(),
        checkpoints: vec![
            "请求已进入运行时主链".to_string(),
            "正在准备工作区与会话上下文".to_string(),
            "等待后续详细执行事件".to_string(),
        ],
        metadata: None,
    }
}

fn emit_submit_accepted_runtime_status(app: &AppHandle, event_name: &str) {
    if event_name.trim().is_empty() {
        return;
    }

    let event = RuntimeAgentEvent::RuntimeStatus {
        status: build_submit_accepted_runtime_status(),
    };
    if let Err(error) = app.emit(event_name, &event) {
        tracing::warn!(
            "[AsterAgent] 发送 submit accepted runtime_status 失败: event_name={}, error={}",
            event_name,
            error
        );
    }
}

async fn sync_runtime_skill_source_agent(session_id: &str, agent: &Agent) -> Result<(), String> {
    let donor = Agent::new().with_shared_native_tool_surface_from(agent);
    donor
        .extension_manager
        .set_context(PlatformExtensionContext {
            session_id: Some(session_id.to_string()),
            extension_manager: Some(Arc::downgrade(&donor.extension_manager)),
        })
        .await;
    donor
        .inherit_runtime_tool_surface_from(agent)
        .await
        .map_err(|error| format!("继承 runtime tool surface 失败: {error}"))?;
    SkillTool::register_source_agent_for_session(session_id.to_string(), Arc::new(donor)).await;
    Ok(())
}

async fn ensure_host_backed_config_tool_registered(
    app: &AppHandle,
    state: &AsterAgentState,
) -> Result<(), String> {
    let agent_arc = state.get_agent_arc();
    let guard = agent_arc.read().await;
    let agent = guard
        .as_ref()
        .ok_or_else(|| "Agent not initialized".to_string())?;
    let registry_arc = agent.tool_registry().clone();
    drop(guard);

    let mut registry = registry_arc.write().await;
    if !registry.contains_native("Config") {
        return Ok(());
    }

    let read_app = app.clone();
    let write_app = app.clone();
    registry.register(Box::new(ConfigTool::new().with_voice_enabled_callbacks(
        Arc::new(move || {
            let _read_app = read_app.clone();
            Box::pin(async move {
                let config = crate::voice::commands::get_voice_input_config().await?;
                Ok(config.enabled)
            })
        }),
        Arc::new(move |enabled| {
            let write_app = write_app.clone();
            Box::pin(async move {
                let mut config = crate::voice::commands::get_voice_input_config().await?;
                config.enabled = enabled;
                crate::voice::commands::save_voice_input_config(write_app, config.clone()).await?;
                Ok(config.enabled)
            })
        }),
    )));

    Ok(())
}

async fn ensure_runtime_permission_request_hook_handler_registered(
    state: &AsterAgentState,
    db: &DbConnection,
    mcp_manager: &McpManagerState,
) -> Result<(), String> {
    let db = db.clone();
    let hook_state = state.clone();
    let mcp_manager = mcp_manager.clone();

    state
        .with_agent_mut(move |agent| {
            let db = db.clone();
            let hook_state = hook_state.clone();
            let mcp_manager = mcp_manager.clone();

            agent.set_permission_request_hook_handler(Some(Arc::new(move |context| {
                let db = db.clone();
                let hook_state = hook_state.clone();
                let mcp_manager = mcp_manager.clone();
                Box::pin(async move {
                    decide_runtime_permission_request_project_hooks_for_session_with_runtime(
                        &db,
                        &hook_state,
                        &mcp_manager,
                        &context.session_id,
                        &context.tool_name,
                        context.tool_input,
                        &context.tool_use_id,
                        context.permission_mode,
                    )
                    .await
                })
            })));
        })
        .await
}

fn merge_runtime_memory_prefetch_prompt(
    base_prompt: Option<String>,
    prefetch_prompt: Option<&str>,
) -> Option<String> {
    let Some(prefetch_prompt) = prefetch_prompt
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return base_prompt;
    };

    match base_prompt {
        Some(base) => {
            if base.contains(TURN_MEMORY_PREFETCH_PROMPT_MARKER) {
                Some(base)
            } else if base.trim().is_empty() {
                Some(prefetch_prompt.to_string())
            } else {
                Some(format!("{base}\n\n{prefetch_prompt}"))
            }
        }
        None => Some(prefetch_prompt.to_string()),
    }
}

fn quoted_absolute_path_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(r#"["'“”‘’](?P<path>(?:/|[A-Za-z]:\\)[^"'“”‘’\r\n]+)["'“”‘’]"#)
            .expect("quoted absolute path regex should compile")
    })
}

fn unix_absolute_path_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(r#"(?P<path>/[^\s"'“”‘’,;:(){}\[\]<>]+)"#)
            .expect("unix absolute path regex should compile")
    })
}

fn windows_absolute_path_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(r#"(?P<path>[A-Za-z]:\\[^\s"'“”‘’,;:(){}\[\]<>]+)"#)
            .expect("windows absolute path regex should compile")
    })
}

fn normalize_explicit_local_path_candidate(candidate: &str) -> Option<String> {
    let trimmed = candidate
        .trim()
        .trim_end_matches(|ch: char| {
            matches!(
                ch,
                '.' | ','
                    | ';'
                    | ':'
                    | '。'
                    | '，'
                    | '；'
                    | '：'
                    | ')'
                    | '）'
                    | ']'
                    | '】'
                    | '}'
                    | '>'
            )
        })
        .trim();

    if trimmed.is_empty() {
        return None;
    }

    let path = Path::new(trimmed);
    if !path.is_absolute() || !path.exists() {
        return None;
    }

    Some(
        path.canonicalize()
            .unwrap_or_else(|_| path.to_path_buf())
            .to_string_lossy()
            .to_string(),
    )
}

fn push_unique_focus_path(paths: &mut Vec<String>, candidate: &str) {
    let Some(normalized) = normalize_explicit_local_path_candidate(candidate) else {
        return;
    };

    if paths.iter().any(|existing| existing == &normalized) {
        return;
    }

    paths.push(normalized);
}

fn extract_explicit_local_focus_paths_from_message(message: &str) -> Vec<String> {
    let mut paths = Vec::new();

    for captures in quoted_absolute_path_regex().captures_iter(message) {
        if let Some(path) = captures.name("path") {
            push_unique_focus_path(&mut paths, path.as_str());
        }
    }

    for captures in unix_absolute_path_regex().captures_iter(message) {
        if let Some(path) = captures.name("path") {
            push_unique_focus_path(&mut paths, path.as_str());
        }
    }

    for captures in windows_absolute_path_regex().captures_iter(message) {
        if let Some(path) = captures.name("path") {
            push_unique_focus_path(&mut paths, path.as_str());
        }
    }

    paths
}

fn merge_system_prompt_with_explicit_local_path_focus(
    base_prompt: Option<String>,
    user_message: &str,
    workspace_root: &str,
) -> Option<String> {
    let focus_paths = extract_explicit_local_focus_paths_from_message(user_message);
    if focus_paths.is_empty() {
        return base_prompt;
    }

    let workspace_root = workspace_root.trim();
    let should_warn_about_workspace =
        !workspace_root.is_empty() && focus_paths.iter().all(|path| path != workspace_root);

    let mut lines = vec![
        TURN_LOCAL_PATH_FOCUS_PROMPT_MARKER.to_string(),
        "本回合用户已经明确给出本地路径；这些路径是当前侦查与读取的第一优先级。".to_string(),
    ];
    for path in focus_paths.iter().take(3) {
        lines.push(format!("- 优先路径: {path}"));
    }
    lines.push(
        "- 第一批只围绕这些显式路径做 2 到 4 个只读工具调用，优先精确搜索和读取关键文件。"
            .to_string(),
    );
    lines.push(
        "- 如果有多个彼此独立的目录或文件需要核对，优先在同一批里并行完成这些只读调用，不要一轮只看一个。"
            .to_string(),
    );
    if should_warn_about_workspace {
        lines.push(format!(
            "- 不要先扫描当前默认工作目录 {workspace_root} 或其它无关目录，除非这些显式路径证据不足，或用户明确要求比较当前工作区。"
        ));
    }
    lines.push(
        "- 如果这些显式路径不存在、无法读取，或必须回退到其它路径，先在用户可见结论正文里说明原因，再继续下一批。"
            .to_string(),
    );
    lines.push(
        "- 不要在只拿到一两个证据点时就仓促下结论；如果证据还不够，继续下一批读取后再总结。"
            .to_string(),
    );
    let focus_prompt = lines.join("\n");

    match base_prompt {
        Some(base) => {
            if base.contains(TURN_LOCAL_PATH_FOCUS_PROMPT_MARKER) {
                Some(base)
            } else if base.trim().is_empty() {
                Some(focus_prompt)
            } else {
                Some(format!("{base}\n\n{focus_prompt}"))
            }
        }
        None => Some(focus_prompt),
    }
}

fn normalize_runtime_memory_capture_text(input: &str) -> String {
    input.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn contains_runtime_memory_capture_signal(text: &str) -> bool {
    [
        "记住",
        "偏好",
        "喜欢",
        "不喜欢",
        "习惯",
        "以后",
        "规则",
        "流程",
        "workflow",
        "prefer",
        "always",
        "never",
        "计划",
        "待办",
        "todo",
        "下一步",
        "错误",
        "失败",
        "报错",
        "修复",
        "fix",
        "bug",
    ]
    .iter()
    .any(|keyword| text.contains(keyword))
}

fn should_auto_capture_runtime_memory_turn(user_message: &str, assistant_output: &str) -> bool {
    let normalized_user = normalize_runtime_memory_capture_text(user_message);
    let normalized_assistant = normalize_runtime_memory_capture_text(assistant_output);
    let total_chars = normalized_user.chars().count() + normalized_assistant.chars().count();

    if normalized_user.chars().count() >= AUTO_RUNTIME_MEMORY_MIN_USER_CHARS
        && normalized_assistant.chars().count() >= AUTO_RUNTIME_MEMORY_MIN_ASSISTANT_CHARS
        && total_chars >= AUTO_RUNTIME_MEMORY_MIN_TOTAL_CHARS
    {
        return true;
    }

    let signal_text = format!(
        "{} {}",
        normalized_user.to_lowercase(),
        normalized_assistant.to_lowercase()
    );
    contains_runtime_memory_capture_signal(signal_text.as_str())
}

fn spawn_runtime_memory_capture_task(
    app: &AppHandle,
    db: &DbConnection,
    memory_config: lime_core::config::MemoryConfig,
    session_id: &str,
    user_message: &str,
    assistant_output: &str,
) {
    if !memory_config.enabled || !memory_config.auto.enabled {
        return;
    }

    if !should_auto_capture_runtime_memory_turn(user_message, assistant_output) {
        return;
    }

    let context_memory_service = app
        .state::<crate::commands::context_memory::ContextMemoryServiceState>()
        .inner()
        .0
        .clone();
    let db = db.clone();
    let session_id = session_id.to_string();

    // 自动沉淀走后台任务，避免延长主回合完成时间。
    tokio::spawn(async move {
        let candidates = {
            let conn = match db.lock() {
                Ok(guard) => guard,
                Err(error) => {
                    tracing::warn!(
                        "[AsterAgent] 后台自动记忆无法获取数据库锁: session_id={}, error={}",
                        session_id,
                        error
                    );
                    return;
                }
            };

            match crate::services::chat_history_service::load_session_memory_source_candidates(
                &conn,
                &session_id,
                AUTO_RUNTIME_MEMORY_SESSION_MESSAGE_LIMIT,
                AUTO_RUNTIME_MEMORY_SESSION_MIN_MESSAGE_LENGTH,
            ) {
                Ok(candidates) => candidates,
                Err(error) => {
                    tracing::warn!(
                        "[AsterAgent] 后台自动记忆读取候选失败: session_id={}, error={}",
                        session_id,
                        error
                    );
                    return;
                }
            }
        };

        if candidates.is_empty() {
            return;
        }

        match crate::commands::memory_management_cmd::analyze_memory_candidates(
            context_memory_service.as_ref(),
            &memory_config,
            &candidates,
        ) {
            Ok(result) => {
                if result.generated_entries > 0 {
                    tracing::info!(
                        "[AsterAgent] 已自动沉淀工作记忆: session_id={}, generated={}, dedup={}",
                        session_id,
                        result.generated_entries,
                        result.deduplicated_entries
                    );
                }
            }
            Err(error) => {
                tracing::warn!(
                    "[AsterAgent] 后台自动沉淀工作记忆失败: session_id={}, error={}",
                    session_id,
                    error
                );
            }
        }

        match crate::commands::unified_memory_cmd::analyze_unified_memory_candidates(
            &db,
            &memory_config,
            &candidates,
        )
        .await
        {
            Ok(result) => {
                if result.generated_entries > 0 {
                    tracing::info!(
                        "[AsterAgent] 已自动沉淀长期记忆: session_id={}, generated={}, dedup={}",
                        session_id,
                        result.generated_entries,
                        result.deduplicated_entries
                    );
                }
            }
            Err(error) => {
                tracing::warn!(
                    "[AsterAgent] 后台自动沉淀长期记忆失败: session_id={}, error={}",
                    session_id,
                    error
                );
            }
        }
    });
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ProviderConfigApplyMode {
    Direct,
    CredentialPool,
}

fn normalize_provider_identity(value: &str) -> String {
    value.trim().to_ascii_lowercase()
}

fn resolve_provider_config_apply_mode(
    provider_config: &ConfigureProviderRequest,
) -> ProviderConfigApplyMode {
    if provider_config.api_key.is_some() || provider_config.base_url.is_some() {
        return ProviderConfigApplyMode::Direct;
    }

    let provider_selector = provider_config
        .provider_id
        .as_deref()
        .unwrap_or(&provider_config.provider_name);
    let normalized_selector = normalize_provider_identity(provider_selector);
    let normalized_provider_name = normalize_provider_identity(&provider_config.provider_name);

    if normalized_selector == "ollama" || normalized_provider_name == "ollama" {
        return ProviderConfigApplyMode::Direct;
    }

    ProviderConfigApplyMode::CredentialPool
}

async fn apply_runtime_turn_provider_config(
    state: &AsterAgentState,
    db: &DbConnection,
    session_id: &str,
    provider_config: Option<&ConfigureProviderRequest>,
) -> Result<(), String> {
    let Some(provider_config) = provider_config else {
        return Ok(());
    };

    tracing::info!(
        "[AsterAgent] 收到 provider_config: provider_id={:?}, provider_name={}, model_name={}, has_api_key={}, base_url={:?}",
        provider_config.provider_id,
        provider_config.provider_name,
        provider_config.model_name,
        provider_config.api_key.is_some(),
        provider_config.base_url
    );
    let apply_mode = resolve_provider_config_apply_mode(provider_config);
    let config = ProviderConfig {
        provider_name: provider_config.provider_name.clone(),
        provider_selector: provider_config
            .provider_id
            .clone()
            .or_else(|| Some(provider_config.provider_name.clone())),
        model_name: provider_config.model_name.clone(),
        api_key: provider_config.api_key.clone(),
        base_url: provider_config.base_url.clone(),
        credential_uuid: None,
        force_responses_api: false,
        credential_path: None,
        toolshim: matches!(
            provider_config.tool_call_strategy,
            Some(RuntimeToolCallStrategy::ToolShim)
        ),
        toolshim_model: provider_config.toolshim_model.clone(),
    };
    let provider_selector = provider_config
        .provider_id
        .as_deref()
        .unwrap_or(&provider_config.provider_name);
    tracing::info!(
        "[AsterAgent] provider_config 应用策略: provider_selector={}, mode={:?}, tool_call_strategy={:?}, toolshim_model={:?}",
        provider_selector,
        apply_mode,
        provider_config.tool_call_strategy,
        provider_config.toolshim_model
    );

    match apply_mode {
        ProviderConfigApplyMode::Direct => {
            state.configure_provider(config, session_id, db).await?;
        }
        ProviderConfigApplyMode::CredentialPool => {
            state
                .configure_provider_from_pool(
                    db,
                    provider_selector,
                    &provider_config.model_name,
                    session_id,
                )
                .await?;
        }
    }
    persist_session_provider_routing(session_id, provider_selector).await
}

fn emit_runtime_side_event(
    app: &AppHandle,
    event_name: &str,
    timeline_recorder: &Arc<Mutex<AgentTimelineRecorder>>,
    workspace_root: &str,
    event: RuntimeAgentEvent,
) {
    {
        let mut recorder = match timeline_recorder.lock() {
            Ok(guard) => guard,
            Err(error) => error.into_inner(),
        };
        if let Err(error) = recorder.record_runtime_event(app, event_name, &event, workspace_root) {
            tracing::warn!(
                "[AsterAgent] 记录 Artifact 运行时事件失败（已降级继续）: {}",
                error
            );
        }
    }

    if let Err(error) = app.emit(event_name, &event) {
        tracing::warn!("[AsterAgent] 发送 Artifact 运行时事件失败: {}", error);
    }
}

fn emit_service_skill_preload_runtime_events(
    app: &AppHandle,
    event_name: &str,
    timeline_recorder: &Arc<Mutex<AgentTimelineRecorder>>,
    workspace_root: &str,
    execution: &ServiceSkillLaunchPreloadExecution,
) {
    let projection = match build_service_skill_preload_tool_projection(execution) {
        Ok(projection) => projection,
        Err(error) => {
            tracing::warn!(
                "[AsterAgent] 构造站点技能预执行投影事件失败，已降级跳过可视过程: {}",
                error
            );
            return;
        }
    };

    emit_runtime_side_event(
        app,
        event_name,
        timeline_recorder,
        workspace_root,
        RuntimeAgentEvent::ToolStart {
            tool_name: projection.tool_name.clone(),
            tool_id: projection.tool_id.clone(),
            arguments: Some(projection.arguments),
        },
    );
    emit_runtime_side_event(
        app,
        event_name,
        timeline_recorder,
        workspace_root,
        RuntimeAgentEvent::ToolEnd {
            tool_id: projection.tool_id,
            result: projection.result,
        },
    );
}

fn build_artifact_document_warning_message(
    status: &str,
    fallback_used: bool,
    issues: &[String],
) -> String {
    if status == "failed" {
        return "结构化文稿未完整生成，已保留一份可继续编辑的恢复稿。".to_string();
    }

    if fallback_used
        || issues
            .iter()
            .any(|issue| issue.contains("Markdown 正文自动恢复"))
    {
        return "已根据正文整理出一份可继续编辑的草稿。".to_string();
    }

    if issues
        .iter()
        .any(|issue| issue.contains("不完整的 ArtifactDocument JSON"))
    {
        return "已补全文稿结构，可继续查看和编辑。".to_string();
    }

    "已整理为可继续编辑的文稿。".to_string()
}

fn merge_turn_context_with_artifact_output_schema(
    turn_context: Option<TurnContextOverride>,
    request_metadata: Option<&serde_json::Value>,
) -> Option<TurnContextOverride> {
    crate::services::artifact_output_schema_service::merge_turn_context_with_artifact_output_schema(
        turn_context,
        request_metadata,
    )
}

pub(crate) fn merge_turn_context_with_workspace_auto_compaction(
    turn_context: Option<TurnContextOverride>,
    workspace_settings: &WorkspaceSettings,
) -> Option<TurnContextOverride> {
    if workspace_settings.auto_compact {
        return turn_context;
    }

    let mut turn_context = turn_context.unwrap_or_default();
    let runtime_metadata = turn_context
        .metadata
        .entry(LIME_RUNTIME_METADATA_KEY.to_string())
        .or_insert_with(|| serde_json::Value::Object(serde_json::Map::new()));
    if !runtime_metadata.is_object() {
        *runtime_metadata = serde_json::Value::Object(serde_json::Map::new());
    }
    if let serde_json::Value::Object(runtime_metadata_map) = runtime_metadata {
        runtime_metadata_map.insert(
            LIME_RUNTIME_AUTO_COMPACT_KEY.to_string(),
            serde_json::Value::Bool(false),
        );
    }

    Some(turn_context)
}

fn build_runtime_turn_context_override(
    turn_context: Option<TurnContextOverride>,
    request_metadata: Option<&serde_json::Value>,
    workspace_settings: &WorkspaceSettings,
) -> Option<TurnContextOverride> {
    merge_turn_context_with_workspace_auto_compaction(
        merge_turn_context_with_artifact_output_schema(turn_context, request_metadata),
        workspace_settings,
    )
}

pub(crate) fn build_runtime_turn_context_snapshot(
    request_metadata: Option<&serde_json::Value>,
    workspace_settings: &WorkspaceSettings,
) -> TurnContextOverride {
    let seed_turn_context =
        request_metadata
            .and_then(serde_json::Value::as_object)
            .map(|metadata| TurnContextOverride {
                metadata: metadata.clone().into_iter().collect(),
                ..TurnContextOverride::default()
            });

    build_runtime_turn_context_override(seed_turn_context, request_metadata, workspace_settings)
        .unwrap_or_default()
}

fn build_runtime_turn_context_metadata_value(
    turn_context: &TurnContextOverride,
) -> Option<serde_json::Value> {
    if turn_context.metadata.is_empty() {
        None
    } else {
        Some(serde_json::Value::Object(
            turn_context.metadata.clone().into_iter().collect(),
        ))
    }
}

fn build_runtime_session_config(
    session_id: &str,
    thread_id: &str,
    turn_id: &str,
    system_prompt: Option<&str>,
    include_context_trace: Option<bool>,
    turn_context: Option<TurnContextOverride>,
) -> aster::agents::types::SessionConfig {
    let mut session_config_builder = SessionConfigBuilder::new(session_id)
        .thread_id(thread_id.to_string())
        .turn_id(turn_id.to_string());
    if let Some(system_prompt) = system_prompt {
        session_config_builder = session_config_builder.system_prompt(system_prompt.to_string());
    }
    if let Some(include_context_trace) = include_context_trace {
        session_config_builder =
            session_config_builder.include_context_trace(include_context_trace);
    }
    if let Some(turn_context) = turn_context {
        session_config_builder = session_config_builder.turn_context(turn_context);
    }
    session_config_builder.build()
}

fn insert_serialized_run_metadata<T: serde::Serialize>(
    metadata: &mut serde_json::Map<String, serde_json::Value>,
    key: &str,
    value: &T,
) {
    if let Ok(serialized) = serde_json::to_value(value) {
        metadata.insert(key.to_string(), serialized);
    }
}

fn build_runtime_run_start_metadata(
    request: &AsterChatRequest,
    workspace_id: &str,
    effective_strategy: AsterExecutionStrategy,
    request_tool_policy: &RequestToolPolicy,
    auto_continue_enabled: bool,
    auto_continue_metadata: Option<&AutoContinuePayload>,
    session_recent_preferences: Option<&lime_agent::SessionExecutionRuntimePreferences>,
    session_state_snapshot: &SessionStateSnapshot,
    runtime_projection_snapshot: &RuntimeProjectionSnapshot,
    turn_state: &TurnState,
    turn_input_diagnostics: &lime_agent::TurnDiagnosticsSnapshot,
    service_skill_preload: Option<&ServiceSkillLaunchPreloadExecution>,
) -> serde_json::Map<String, serde_json::Value> {
    let mut metadata = build_chat_run_metadata_base(
        request,
        workspace_id,
        effective_strategy,
        request_tool_policy,
        auto_continue_enabled,
        auto_continue_metadata,
        session_recent_preferences,
    );
    insert_serialized_run_metadata(&mut metadata, "session_state", session_state_snapshot);
    insert_serialized_run_metadata(
        &mut metadata,
        "runtime_projection",
        runtime_projection_snapshot,
    );
    insert_serialized_run_metadata(&mut metadata, "turn_state", turn_state);
    insert_serialized_run_metadata(&mut metadata, "turn_input", turn_input_diagnostics);

    if let Some(preload) = service_skill_preload {
        metadata.insert(
            "service_skill_launch_preload".to_string(),
            serde_json::json!({
                "executed": true,
                "adapter_name": preload.request.adapter_name,
                "ok": preload.result.ok,
                "error_code": preload.result.error_code,
                "saved_content_id": preload
                    .result
                    .saved_content
                    .as_ref()
                    .map(|content| content.content_id.clone()),
            }),
        );
    }

    metadata
}

#[derive(Clone)]
struct RuntimeTurnStreamSessionConfigState {
    session_id: String,
    thread_id: String,
    turn_id: String,
    system_prompt: Option<String>,
    include_context_trace: bool,
    turn_context_override: Option<TurnContextOverride>,
}

impl RuntimeTurnStreamSessionConfigState {
    fn build(&self) -> aster::agents::types::SessionConfig {
        build_runtime_session_config(
            &self.session_id,
            &self.thread_id,
            &self.turn_id,
            self.system_prompt.as_deref(),
            Some(self.include_context_trace),
            self.turn_context_override.clone(),
        )
    }
}

struct RuntimeTurnExecutionContext {
    run_start_metadata: serde_json::Map<String, serde_json::Value>,
    run_observation: Arc<Mutex<ChatRunObservation>>,
    timeline_recorder: Arc<Mutex<AgentTimelineRecorder>>,
    runtime_status_session_config: aster::agents::types::SessionConfig,
    stream_session_config_state: RuntimeTurnStreamSessionConfigState,
}

impl RuntimeTurnExecutionContext {
    fn build_run_finish_decision(&self, result: &Result<String, String>) -> RunFinishDecision {
        build_runtime_run_finish_decision(result, &self.run_start_metadata, &self.run_observation)
    }

    async fn execute_and_finalize(
        &self,
        tracker: &ExecutionTracker,
        agent: &Agent,
        app: &AppHandle,
        state: &AsterAgentState,
        db: &DbConnection,
        request: &AsterChatRequest,
        runtime_memory_config: &lime_core::config::MemoryConfig,
        session_id: &str,
        workspace_root: &str,
        workspace_id: &str,
        thread_id: &str,
        turn_id: &str,
        execution_profile: TurnExecutionProfile,
        request_metadata: Option<&serde_json::Value>,
        provider_continuation_capability: ProviderContinuationCapability,
        cancel_token: CancellationToken,
        request_tool_policy: &RequestToolPolicy,
        effective_strategy: AsterExecutionStrategy,
    ) -> Result<(), String> {
        let run_start_metadata = self.run_start_metadata.clone();
        let run_observation = self.run_observation.clone();
        let timeline_recorder = self.timeline_recorder.clone();
        let runtime_status_session_config = self.runtime_status_session_config.clone();
        let stream_session_config_state = self.stream_session_config_state.clone();

        let final_result = tracker
            .with_run_custom(
                RunSource::Chat,
                Some("agent_runtime_submit_turn".to_string()),
                Some(session_id.to_string()),
                Some(serde_json::Value::Object(run_start_metadata)),
                async move {
                    execute_runtime_stream_with_strategy(
                        agent,
                        app,
                        state,
                        db,
                        request,
                        &timeline_recorder,
                        &run_observation,
                        runtime_memory_config,
                        session_id,
                        workspace_root,
                        workspace_id,
                        thread_id,
                        turn_id,
                        execution_profile,
                        request_metadata,
                        provider_continuation_capability,
                        cancel_token,
                        request_tool_policy,
                        effective_strategy,
                        || stream_session_config_state.build(),
                    )
                    .await
                },
                move |result| self.build_run_finish_decision(result),
            )
            .await;

        finalize_runtime_turn_result(
            agent,
            app,
            state,
            db,
            &request.event_name,
            &self.timeline_recorder,
            workspace_root,
            &runtime_status_session_config,
            session_id,
            request_metadata,
            final_result,
        )
        .await
    }
}

struct RuntimeTurnBuildArtifacts {
    runtime_projection_snapshot: RuntimeProjectionSnapshot,
    turn_state: TurnState,
    turn_input_envelope: lime_agent::TurnInputEnvelope,
    turn_input_diagnostics: lime_agent::TurnDiagnosticsSnapshot,
}

struct RuntimeTurnPreparedExecution {
    service_skill_preload: Option<ServiceSkillLaunchPreloadExecution>,
    runtime_turn_artifacts: RuntimeTurnBuildArtifacts,
    runtime_turn_execution_context: RuntimeTurnExecutionContext,
}

struct RuntimeTurnSubmitBootstrap {
    request_metadata: Option<serde_json::Value>,
    runtime_memory_config: lime_core::config::MemoryConfig,
    provider_continuation_capability: ProviderContinuationCapability,
    tracker: ExecutionTracker,
    model_skill_tool_enabled: bool,
}

struct RuntimeTurnPromptStrategy {
    system_prompt: Option<String>,
    requested_strategy: AsterExecutionStrategy,
    effective_strategy: AsterExecutionStrategy,
    system_prompt_source: TurnSystemPromptSource,
}

struct RuntimeTurnSessionPreparation {
    auto_continue_config: Option<AutoContinuePayload>,
    auto_continue_enabled: bool,
    session_state_snapshot: SessionStateSnapshot,
    session_recent_preferences: Option<lime_agent::SessionExecutionRuntimePreferences>,
    session_recent_team_selection: Option<lime_agent::SessionExecutionRuntimeRecentTeamSelection>,
}

struct RuntimeTurnIngressContext {
    owned_session_id: String,
    workspace_id: String,
    workspace_root: String,
    workspace_settings: WorkspaceSettings,
    resolved_turn_id: String,
    runtime_config: lime_core::config::Config,
    session_recent_harness_context: SessionRecentHarnessContext,
    workspace_repaired: bool,
    workspace_warning: Option<String>,
}

struct RuntimeTurnSubmitPreparation {
    auto_continue_config: Option<AutoContinuePayload>,
    auto_continue_enabled: bool,
    session_state_snapshot: SessionStateSnapshot,
    session_recent_preferences: Option<lime_agent::SessionExecutionRuntimePreferences>,
    runtime_chat_mode: RuntimeChatMode,
    include_context_trace: bool,
    turn_input_builder: TurnInputEnvelopeBuilder,
    request_tool_policy: RequestToolPolicy,
    execution_profile: TurnExecutionProfile,
    requested_strategy: AsterExecutionStrategy,
    effective_strategy: AsterExecutionStrategy,
    system_prompt: Option<String>,
    system_prompt_source: TurnSystemPromptSource,
    submit_bootstrap: RuntimeTurnSubmitBootstrap,
}

struct RuntimeTurnRequestPreparation {
    runtime_chat_mode: RuntimeChatMode,
    include_context_trace: bool,
    turn_input_builder: TurnInputEnvelopeBuilder,
}

struct RuntimeTurnPolicyPreparation {
    request_tool_policy: RequestToolPolicy,
    execution_profile: TurnExecutionProfile,
}

impl RuntimeTurnPreparedExecution {
    fn thread_id(&self) -> &str {
        self.runtime_turn_artifacts.turn_state.thread_id.as_str()
    }

    fn turn_id(&self) -> &str {
        self.runtime_turn_artifacts.turn_state.turn_id.as_str()
    }

    async fn emit_prelude(
        &self,
        agent: &Agent,
        app: &AppHandle,
        request: &AsterChatRequest,
        workspace_root: &str,
        effective_strategy: AsterExecutionStrategy,
        request_tool_policy: &RequestToolPolicy,
        model_name: Option<&str>,
        session_recent_preferences: Option<&lime_agent::SessionExecutionRuntimePreferences>,
    ) -> Result<(), String> {
        prepare_runtime_turn_prelude(
            agent,
            app,
            request,
            &self.runtime_turn_execution_context.timeline_recorder,
            workspace_root,
            &self
                .runtime_turn_execution_context
                .runtime_status_session_config,
            effective_strategy,
            request_tool_policy,
            model_name,
            session_recent_preferences,
            self.service_skill_preload.as_ref(),
        )
        .await
    }

    #[allow(clippy::too_many_arguments)]
    async fn emit_prelude_and_execute(
        &self,
        agent: &Agent,
        tracker: &ExecutionTracker,
        app: &AppHandle,
        state: &AsterAgentState,
        db: &DbConnection,
        request: &AsterChatRequest,
        runtime_memory_config: &lime_core::config::MemoryConfig,
        session_id: &str,
        workspace_root: &str,
        workspace_id: &str,
        execution_profile: TurnExecutionProfile,
        request_metadata: Option<&serde_json::Value>,
        provider_continuation_capability: ProviderContinuationCapability,
        cancel_token: CancellationToken,
        effective_strategy: AsterExecutionStrategy,
        request_tool_policy: &RequestToolPolicy,
        model_name: Option<&str>,
        session_recent_preferences: Option<&lime_agent::SessionExecutionRuntimePreferences>,
    ) -> Result<(), String> {
        self.emit_prelude(
            agent,
            app,
            request,
            workspace_root,
            effective_strategy,
            request_tool_policy,
            model_name,
            session_recent_preferences,
        )
        .await?;

        self.runtime_turn_execution_context
            .execute_and_finalize(
                tracker,
                agent,
                app,
                state,
                db,
                request,
                runtime_memory_config,
                session_id,
                workspace_root,
                workspace_id,
                self.thread_id(),
                self.turn_id(),
                execution_profile,
                request_metadata,
                provider_continuation_capability,
                cancel_token,
                request_tool_policy,
                effective_strategy,
            )
            .await
    }
}

impl RuntimeTurnSubmitPreparation {
    fn model_skill_tool_enabled(&self) -> bool {
        self.submit_bootstrap.model_skill_tool_enabled
    }
}

#[allow(clippy::too_many_arguments)]
async fn prepare_runtime_turn_submit_bootstrap(
    app: &AppHandle,
    state: &AsterAgentState,
    db: &DbConnection,
    api_key_provider_service: &ApiKeyProviderServiceState,
    logs: &LogState,
    config_manager: &GlobalConfigManagerState,
    mcp_manager: &McpManagerState,
    automation_state: &AutomationServiceState,
    request: &AsterChatRequest,
    session_id: &str,
    workspace_root: &str,
    workspace_settings: &WorkspaceSettings,
    runtime_config: &lime_core::config::Config,
    runtime_chat_mode: RuntimeChatMode,
    execution_profile: TurnExecutionProfile,
    requested_strategy: AsterExecutionStrategy,
    request_tool_policy: &RequestToolPolicy,
    turn_input_builder: &mut TurnInputEnvelopeBuilder,
) -> Result<RuntimeTurnSubmitBootstrap, String> {
    if !state.is_provider_configured().await {
        return Err("Provider 未配置，请先调用 aster_agent_configure_provider".to_string());
    }

    maybe_auto_compact_runtime_session_before_turn(
        app,
        state,
        db,
        config_manager,
        session_id,
        &request.event_name,
        workspace_settings,
    )
    .await?;

    let effective_provider_config = state.get_provider_config().await;
    let provider_routing_snapshot =
        effective_provider_config
            .as_ref()
            .map(|config| TurnProviderRoutingSnapshot {
                provider_name: config.provider_name.clone(),
                provider_selector: config.provider_selector.clone(),
                model_name: config.model_name.clone(),
                credential_uuid: config.credential_uuid.clone(),
                configured_from_request: request.provider_config.is_some(),
                used_inline_api_key: request
                    .provider_config
                    .as_ref()
                    .and_then(|config| config.api_key.as_ref())
                    .is_some(),
            });
    turn_input_builder.set_provider_routing(provider_routing_snapshot.clone());

    let provider_continuation_capability = effective_provider_config
        .as_ref()
        .map(|config| config.provider_continuation_capability())
        .unwrap_or(ProviderContinuationCapability::HistoryReplayOnly);
    let configured_provider_continuation_state = effective_provider_config
        .as_ref()
        .map(|config| config.provider_continuation_state())
        .unwrap_or_else(ProviderContinuationState::history_replay_only);
    let restored_provider_continuation_state = load_previous_provider_continuation_state(
        db,
        session_id,
        provider_routing_snapshot.as_ref(),
        provider_continuation_capability,
    );
    let provider_continuation_state = if matches!(
        restored_provider_continuation_state,
        ProviderContinuationState::HistoryReplayOnly
    ) {
        configured_provider_continuation_state
    } else {
        tracing::info!(
            "[AsterAgent] 恢复上一条 terminal run 的 provider continuation: session_id={}, kind={}",
            session_id,
            restored_provider_continuation_state.kind()
        );
        restored_provider_continuation_state
    };
    turn_input_builder
        .set_provider_continuation_capability(provider_continuation_capability)
        .set_provider_continuation(provider_continuation_state);

    let request_metadata = request.metadata.clone();
    let sandbox_outcome = apply_workspace_sandbox_permissions(
        state,
        config_manager,
        db,
        api_key_provider_service,
        logs,
        mcp_manager,
        automation_state,
        app,
        session_id,
        request_metadata.as_ref(),
        workspace_root,
        runtime_chat_mode,
        execution_profile,
        request_tool_policy,
        requested_strategy,
    )
    .await
    .map_err(|error| format!("注入 workspace 安全策略失败: {error}"))?;

    match sandbox_outcome {
        WorkspaceSandboxApplyOutcome::Applied { sandbox_type } => {
            tracing::info!(
                "[AsterAgent] 已启用 workspace 本地 sandbox: root={}, type={}",
                workspace_root,
                sandbox_type
            );
        }
        WorkspaceSandboxApplyOutcome::DisabledByConfig => {
            tracing::info!(
                "[AsterAgent] workspace 本地 sandbox 已关闭，继续使用普通执行模式: root={}",
                workspace_root
            );
        }
        WorkspaceSandboxApplyOutcome::UnavailableFallback {
            warning_message,
            notify_user,
        } => {
            tracing::warn!(
                "[AsterAgent] workspace 本地 sandbox 不可用，已降级为普通执行: root={}, warning={}",
                workspace_root,
                warning_message
            );
            if notify_user {
                let warning_event = RuntimeAgentEvent::Warning {
                    code: Some(WORKSPACE_SANDBOX_FALLBACK_WARNING_CODE.to_string()),
                    message: warning_message,
                };
                if let Err(error) = app.emit(&request.event_name, &warning_event) {
                    tracing::error!("[AsterAgent] 发送 sandbox 降级提醒失败: {}", error);
                }
            }
        }
    }

    Ok(RuntimeTurnSubmitBootstrap {
        model_skill_tool_enabled: matches!(execution_profile, TurnExecutionProfile::FullRuntime)
            && should_enable_model_skill_tool(request_metadata.as_ref()),
        request_metadata,
        runtime_memory_config: runtime_config.memory.clone(),
        provider_continuation_capability,
        tracker: ExecutionTracker::new(db.clone()),
    })
}

async fn prepare_runtime_turn_session(
    app: &AppHandle,
    logs: &LogState,
    db: &DbConnection,
    request: &AsterChatRequest,
    session_id: &str,
    workspace_root: &str,
    workspace_repaired: bool,
    workspace_warning: Option<String>,
) -> Result<RuntimeTurnSessionPreparation, String> {
    let auto_continue_config = request
        .auto_continue
        .clone()
        .map(AutoContinuePayload::normalized);
    let auto_continue_enabled = auto_continue_config
        .as_ref()
        .map(|config| config.enabled)
        .unwrap_or(false);
    if let Some(config) = auto_continue_config
        .as_ref()
        .filter(|config| config.enabled)
    {
        tracing::info!(
            "[AsterAgent] 自动续写策略已启用: source={:?}, fast_mode={}, continuation_length={}, sensitivity={}",
            config.source,
            config.fast_mode_enabled,
            config.continuation_length,
            config.sensitivity
        );
    }

    if workspace_repaired {
        let warning_message = workspace_warning.unwrap_or_else(|| {
            format!(
                "检测到工作区目录缺失，已自动创建并继续执行: {}",
                workspace_root
            )
        });
        logs.write()
            .await
            .add("warn", &format!("[AsterAgent] {}", warning_message));
        let warning_event = RuntimeAgentEvent::Warning {
            code: Some(WORKSPACE_PATH_AUTO_CREATED_WARNING_CODE.to_string()),
            message: warning_message,
        };
        if let Err(error) = app.emit(&request.event_name, &warning_event) {
            tracing::error!("[AsterAgent] 发送工作区自动恢复提醒失败: {}", error);
        }
    }

    let mut session_state_snapshot = SessionStateSnapshot::from_persisted_metadata(
        session_id,
        AsterAgentWrapper::get_persisted_session_metadata_sync(db, session_id)?,
    );

    if session_state_snapshot.needs_working_dir_update(workspace_root) {
        tracing::info!(
            "[AsterAgent] workspace 变更，自动更新 session working_dir: {} -> {}",
            session_state_snapshot.working_dir().unwrap_or_default(),
            workspace_root
        );
        AsterAgentWrapper::update_session_working_dir_sync(db, session_id, workspace_root)?;
        session_state_snapshot =
            session_state_snapshot.with_working_dir(Some(workspace_root.to_string()));
    }

    let SessionRecentRuntimeContext {
        preferences: session_recent_preferences,
        team_selection: session_recent_team_selection,
    } = resolve_session_recent_runtime_context(session_id).await?;

    Ok(RuntimeTurnSessionPreparation {
        auto_continue_config,
        auto_continue_enabled,
        session_state_snapshot,
        session_recent_preferences,
        session_recent_team_selection,
    })
}

fn prepare_runtime_turn_policy(
    request: &AsterChatRequest,
    session_id: &str,
    session_recent_preferences: Option<&lime_agent::SessionExecutionRuntimePreferences>,
    auto_continue_enabled: bool,
) -> RuntimeTurnPolicyPreparation {
    let runtime_chat_mode = resolve_runtime_chat_mode(request.metadata.as_ref());
    let mode_default_web_search = default_web_search_enabled_for_chat_mode(runtime_chat_mode);
    let resolved_request_web_search = resolve_request_web_search_preference_from_sources(
        request.web_search,
        request.metadata.as_ref(),
        session_recent_preferences,
    );
    let (request_web_search, request_search_mode) =
        apply_browser_requirement_to_request_tool_policy(
            request.metadata.as_ref(),
            resolved_request_web_search,
            request.search_mode,
        );
    let (request_web_search, request_search_mode) =
        apply_site_search_skill_launch_to_request_tool_policy(
            request.metadata.as_ref(),
            request_web_search,
            request_search_mode,
        );

    let request_tool_policy = resolve_request_tool_policy_with_mode(
        request_web_search,
        request_search_mode,
        mode_default_web_search,
    );
    tracing::info!(
        "[AsterAgent][WebSearchGuard] session={}, chat_mode={:?}, request_web_search={:?}, request_search_mode={:?}, effective_request_web_search={:?}, effective_request_search_mode={:?}, mode_default_web_search={}, effective_web_search={}, search_mode={}",
        session_id,
        runtime_chat_mode,
        request.web_search,
        request.search_mode,
        request_web_search,
        request_search_mode,
        mode_default_web_search,
        request_tool_policy.effective_web_search,
        request_tool_policy.search_mode.as_str()
    );

    let execution_profile = resolve_turn_execution_profile(
        request,
        runtime_chat_mode,
        &request_tool_policy,
        auto_continue_enabled,
    );

    RuntimeTurnPolicyPreparation {
        request_tool_policy,
        execution_profile,
    }
}

async fn prepare_runtime_turn_request(
    state: &AsterAgentState,
    db: &DbConnection,
    mcp_manager: &McpManagerState,
    request: &mut AsterChatRequest,
    session_id: &str,
    workspace_id: &str,
    workspace_root: &str,
    resolved_turn_id: &str,
    runtime_config: &lime_core::config::Config,
    workspace_settings: &WorkspaceSettings,
    request_tool_policy: &RequestToolPolicy,
    execution_profile: TurnExecutionProfile,
    session_state_snapshot: &SessionStateSnapshot,
    session_recent_harness_context: &SessionRecentHarnessContext,
) -> RuntimeTurnRequestPreparation {
    request.metadata = merge_runtime_turn_tool_surface_metadata(
        request.metadata.take(),
        resolve_fast_chat_tool_surface_mode(request, execution_profile, request_tool_policy),
    );
    let runtime_chat_mode = resolve_runtime_chat_mode(request.metadata.as_ref());

    if matches!(execution_profile, TurnExecutionProfile::FullRuntime) {
        let (_start_ok, start_fail) = ensure_lime_mcp_servers_running(db, mcp_manager).await;
        let (_mcp_ok, mcp_fail) = inject_mcp_extensions(state, mcp_manager).await;

        if start_fail > 0 {
            tracing::warn!(
                "[AsterAgent] 部分 MCP server 自动启动失败 ({} 失败)，后续可用工具可能不完整",
                start_fail
            );
        }
        if mcp_fail > 0 {
            tracing::warn!(
                "[AsterAgent] 部分 MCP extension 注入失败 ({} 失败)，Agent 可能无法使用某些 MCP 工具",
                mcp_fail
            );
        }
    } else {
        tracing::info!(
            "[AsterAgent] FastChat 跳过 MCP runtime 预热: session={}, search_mode={}, chat_mode={:?}",
            session_id,
            request_tool_policy.search_mode.as_str(),
            runtime_chat_mode
        );
    }

    if matches!(execution_profile, TurnExecutionProfile::FullRuntime) {
        request.metadata = prepare_image_skill_launch_request_metadata(
            Path::new(workspace_root),
            session_id,
            resolved_turn_id,
            request.metadata.as_ref(),
            request.images.as_deref(),
        );
        request.metadata =
            prepare_broadcast_skill_launch_request_metadata(request.metadata.as_ref());
        request.metadata =
            prepare_resource_search_skill_launch_request_metadata(request.metadata.as_ref());
        request.metadata =
            prepare_research_skill_launch_request_metadata(request.metadata.as_ref());
        request.metadata = prepare_report_skill_launch_request_metadata(request.metadata.as_ref());
        request.metadata =
            prepare_deep_search_skill_launch_request_metadata(request.metadata.as_ref());
        request.metadata =
            prepare_site_search_skill_launch_request_metadata(request.metadata.as_ref());
        request.metadata =
            prepare_pdf_read_skill_launch_request_metadata(request.metadata.as_ref());
        request.metadata =
            prepare_presentation_skill_launch_request_metadata(request.metadata.as_ref());
        request.metadata = prepare_form_skill_launch_request_metadata(request.metadata.as_ref());
        request.metadata = prepare_summary_skill_launch_request_metadata(request.metadata.as_ref());
        request.metadata =
            prepare_translation_skill_launch_request_metadata(request.metadata.as_ref());
        request.metadata =
            prepare_analysis_skill_launch_request_metadata(request.metadata.as_ref());
        request.metadata =
            prepare_typesetting_skill_launch_request_metadata(request.metadata.as_ref());
        request.metadata = prepare_webpage_skill_launch_request_metadata(request.metadata.as_ref());
        request.metadata = prepare_service_scene_launch_request_metadata(request.metadata.as_ref());
        normalize_runtime_turn_request_metadata(
            request,
            session_recent_harness_context.theme.as_deref(),
            session_recent_harness_context.session_mode.as_deref(),
            session_recent_harness_context.gate_key.as_deref(),
            session_recent_harness_context.run_title.as_deref(),
            session_recent_harness_context.content_id.as_deref(),
            true,
        );
        let image_input_policy = resolve_runtime_image_input_policy(request);
        request.metadata = merge_runtime_image_input_policy_metadata(
            request.metadata.take(),
            image_input_policy.as_ref(),
        );
    }

    let runtime_chat_mode = resolve_runtime_chat_mode(request.metadata.as_ref());
    // `context_trace` 主要服务诊断面板；真实 GUI 回放里这条事件链会在主回复流中触发栈溢出。
    // 默认先关闭，只有显式打开调试开关时才继续发射，优先保证主聊天链稳定可交付。
    let include_context_trace =
        runtime_config.memory.enabled && std::env::var("LIME_ENABLE_CONTEXT_TRACE").is_ok();
    tracing::info!(
        "[AsterAgent] session_state_snapshot={}",
        serde_json::to_string(&session_state_snapshot).unwrap_or_else(|_| "{}".to_string())
    );
    let turn_context_snapshot =
        build_runtime_turn_context_snapshot(request.metadata.as_ref(), workspace_settings);
    let turn_context_metadata = build_runtime_turn_context_metadata_value(&turn_context_snapshot);

    let mut turn_input_builder = TurnInputEnvelopeBuilder::new(session_id, workspace_id);
    turn_input_builder
        .set_project_id(request.project_id.clone())
        .set_execution_profile(execution_profile)
        .set_has_persisted_session(session_state_snapshot.has_persisted_session())
        .set_request_tool_policy(Some(TurnRequestToolPolicySnapshot::from(
            request_tool_policy,
        )))
        .set_working_dir(Some(workspace_root.to_string()))
        .set_effective_user_message(request.message.clone())
        .set_include_context_trace(include_context_trace)
        .set_approval_policy(request.approval_policy.clone())
        .set_sandbox_policy(request.sandbox_policy.clone())
        .set_turn_output_schema(
            turn_context_snapshot.output_schema.clone(),
            turn_context_snapshot.output_schema_source,
        )
        .set_turn_context_metadata_from_value(turn_context_metadata.as_ref());

    RuntimeTurnRequestPreparation {
        runtime_chat_mode,
        include_context_trace,
        turn_input_builder,
    }
}

#[allow(clippy::too_many_arguments)]
fn prepare_runtime_turn_prompt_strategy(
    db: &DbConnection,
    request: &AsterChatRequest,
    session_id: &str,
    workspace_root: &str,
    execution_profile: TurnExecutionProfile,
    runtime_config: &lime_core::config::Config,
    request_tool_policy: &RequestToolPolicy,
    session_state_snapshot: &SessionStateSnapshot,
    session_recent_team_selection: Option<&lime_agent::SessionExecutionRuntimeRecentTeamSelection>,
    session_recent_preferences: Option<&lime_agent::SessionExecutionRuntimePreferences>,
    auto_continue_config: Option<&AutoContinuePayload>,
    turn_input_builder: &mut TurnInputEnvelopeBuilder,
) -> RuntimeTurnPromptStrategy {
    let persisted_strategy =
        AsterExecutionStrategy::from_db_value(session_state_snapshot.execution_strategy());
    let session_prompt = if let Some(prompt) = session_state_snapshot.system_prompt() {
        tracing::debug!(
            "[AsterAgent] 找到 session，system_prompt: {:?}",
            Some(prompt.len())
        );
        Some(prompt.to_string())
    } else {
        if !session_state_snapshot.has_persisted_session() {
            tracing::debug!("[AsterAgent] Lime 数据库中未找到 session: {}", session_id);
        }
        None
    };

    let project_prompt = if let Some(ref project_id) = request.project_id {
        match AsterAgentState::build_project_system_prompt(db, project_id) {
            Ok(prompt) => {
                tracing::info!(
                    "[AsterAgent] 已加载项目上下文: project_id={}, prompt_len={}",
                    project_id,
                    prompt.len()
                );
                Some(prompt)
            }
            Err(error) => {
                tracing::warn!(
                    "[AsterAgent] 加载项目上下文失败: {}, 继续使用 session prompt",
                    error
                );
                None
            }
        }
    } else {
        None
    };

    let (resolved_prompt, system_prompt_source) = if let Some(project_prompt) = project_prompt {
        (Some(project_prompt), TurnSystemPromptSource::Project)
    } else if let Some(session_prompt) = session_prompt {
        (Some(session_prompt), TurnSystemPromptSource::Session)
    } else if let Some(ref frontend_prompt) = request.system_prompt {
        if !frontend_prompt.trim().is_empty() {
            tracing::info!(
                "[AsterAgent] 使用前端传入的 system_prompt, len={}",
                frontend_prompt.len()
            );
            (
                Some(frontend_prompt.clone()),
                TurnSystemPromptSource::Frontend,
            )
        } else {
            (None, TurnSystemPromptSource::None)
        }
    } else {
        (None, TurnSystemPromptSource::None)
    };
    turn_input_builder.set_base_system_prompt(system_prompt_source, resolved_prompt.clone());

    let prompt_with_runtime_agents = merge_system_prompt_with_runtime_plugin_agents(
        merge_system_prompt_with_runtime_agents(resolved_prompt, Some(Path::new(workspace_root))),
        Path::new(workspace_root),
        dirs::home_dir().as_deref(),
    );
    turn_input_builder.apply_prompt_stage(
        TurnPromptAugmentationStageKind::RuntimeAgents,
        prompt_with_runtime_agents.clone(),
    );
    let prompt_with_local_path_focus = apply_turn_prompt_stage(
        turn_input_builder,
        TurnPromptAugmentationStageKind::ExplicitLocalPathFocus,
        prompt_with_runtime_agents,
        |prompt| {
            merge_system_prompt_with_explicit_local_path_focus(
                prompt,
                request.message.as_str(),
                workspace_root,
            )
        },
    );

    let system_prompt = if matches!(execution_profile, TurnExecutionProfile::FullRuntime) {
        build_full_runtime_system_prompt(
            turn_input_builder,
            prompt_with_local_path_focus,
            runtime_config,
            db,
            session_id,
            workspace_root,
            request,
            request_tool_policy,
            session_recent_team_selection,
            session_recent_preferences,
            auto_continue_config,
        )
    } else {
        build_fast_chat_system_prompt(
            turn_input_builder,
            prompt_with_local_path_focus,
            request_tool_policy,
        )
    };

    let requested_strategy = request.execution_strategy.unwrap_or(persisted_strategy);
    let effective_strategy = requested_strategy.effective_for_message(&request.message);
    turn_input_builder
        .set_requested_execution_strategy(Some(requested_strategy.as_db_value().to_string()))
        .set_effective_execution_strategy(Some(effective_strategy.as_db_value().to_string()));

    if let Some(explicit_strategy) = request.execution_strategy {
        if session_state_snapshot.has_persisted_session() {
            if let Err(error) = AsterAgentWrapper::update_session_execution_strategy_sync(
                db,
                session_id,
                explicit_strategy.as_db_value(),
            ) {
                tracing::warn!(
                    "[AsterAgent] 更新会话执行策略失败: session={}, strategy={}, error={}",
                    session_id,
                    explicit_strategy.as_db_value(),
                    error
                );
            }
        }
    }

    tracing::info!(
        "[AsterAgent] 执行策略: requested={:?}, effective={:?}",
        requested_strategy,
        effective_strategy
    );

    RuntimeTurnPromptStrategy {
        system_prompt,
        requested_strategy,
        effective_strategy,
        system_prompt_source,
    }
}

#[allow(clippy::too_many_arguments)]
async fn prepare_runtime_turn_submit_preparation(
    app: &AppHandle,
    state: &AsterAgentState,
    db: &DbConnection,
    api_key_provider_service: &ApiKeyProviderServiceState,
    logs: &LogState,
    config_manager: &GlobalConfigManagerState,
    mcp_manager: &McpManagerState,
    automation_state: &AutomationServiceState,
    request: &mut AsterChatRequest,
    session_id: &str,
    workspace_id: &str,
    workspace_root: &str,
    resolved_turn_id: &str,
    workspace_settings: &WorkspaceSettings,
    runtime_config: &lime_core::config::Config,
    workspace_repaired: bool,
    workspace_warning: Option<String>,
    session_recent_harness_context: &SessionRecentHarnessContext,
) -> Result<RuntimeTurnSubmitPreparation, String> {
    let RuntimeTurnSessionPreparation {
        auto_continue_config,
        auto_continue_enabled,
        session_state_snapshot,
        session_recent_preferences,
        session_recent_team_selection,
    } = prepare_runtime_turn_session(
        app,
        logs,
        db,
        request,
        session_id,
        workspace_root,
        workspace_repaired,
        workspace_warning,
    )
    .await?;

    let RuntimeTurnPolicyPreparation {
        request_tool_policy,
        execution_profile,
    } = prepare_runtime_turn_policy(
        request,
        session_id,
        session_recent_preferences.as_ref(),
        auto_continue_enabled,
    );

    let RuntimeTurnRequestPreparation {
        runtime_chat_mode,
        include_context_trace,
        mut turn_input_builder,
    } = prepare_runtime_turn_request(
        state,
        db,
        mcp_manager,
        request,
        session_id,
        workspace_id,
        workspace_root,
        resolved_turn_id,
        runtime_config,
        workspace_settings,
        &request_tool_policy,
        execution_profile,
        &session_state_snapshot,
        session_recent_harness_context,
    )
    .await;

    let RuntimeTurnPromptStrategy {
        system_prompt,
        requested_strategy,
        effective_strategy,
        system_prompt_source,
    } = prepare_runtime_turn_prompt_strategy(
        db,
        request,
        session_id,
        workspace_root,
        execution_profile,
        runtime_config,
        &request_tool_policy,
        &session_state_snapshot,
        session_recent_team_selection.as_ref(),
        session_recent_preferences.as_ref(),
        auto_continue_config.as_ref(),
        &mut turn_input_builder,
    );

    apply_runtime_turn_provider_config(state, db, session_id, request.provider_config.as_ref())
        .await?;

    let submit_bootstrap = prepare_runtime_turn_submit_bootstrap(
        app,
        state,
        db,
        api_key_provider_service,
        logs,
        config_manager,
        mcp_manager,
        automation_state,
        request,
        session_id,
        workspace_root,
        workspace_settings,
        runtime_config,
        runtime_chat_mode,
        execution_profile,
        requested_strategy,
        &request_tool_policy,
        &mut turn_input_builder,
    )
    .await?;

    Ok(RuntimeTurnSubmitPreparation {
        auto_continue_config,
        auto_continue_enabled,
        session_state_snapshot,
        session_recent_preferences,
        runtime_chat_mode,
        include_context_trace,
        turn_input_builder,
        request_tool_policy,
        execution_profile,
        requested_strategy,
        effective_strategy,
        system_prompt,
        system_prompt_source,
        submit_bootstrap,
    })
}

#[allow(clippy::too_many_arguments)]
async fn build_runtime_turn_artifacts(
    agent_arc: &Arc<tokio::sync::RwLock<Option<Agent>>>,
    session_id: &str,
    workspace_id: &str,
    resolved_turn_id: &str,
    execution_profile: TurnExecutionProfile,
    requested_strategy: AsterExecutionStrategy,
    effective_strategy: AsterExecutionStrategy,
    request_tool_policy: &RequestToolPolicy,
    include_context_trace: bool,
    runtime_chat_mode: RuntimeChatMode,
    system_prompt_source: TurnSystemPromptSource,
    mut turn_input_builder: TurnInputEnvelopeBuilder,
) -> Result<RuntimeTurnBuildArtifacts, String> {
    let runtime_snapshot = {
        let guard = agent_arc.read().await;
        let agent = guard.as_ref().ok_or("Agent not initialized")?;
        match agent.runtime_snapshot(session_id).await {
            Ok(snapshot) => Some(snapshot),
            Err(error) => {
                tracing::warn!(
                    "[AsterAgent] 提交 turn 前读取 runtime snapshot 失败: session_id={}, error={}",
                    session_id,
                    error
                );
                None
            }
        }
    };
    let runtime_projection_snapshot =
        RuntimeProjectionSnapshot::from_snapshot(session_id, runtime_snapshot.as_ref());
    if matches!(execution_profile, TurnExecutionProfile::FullRuntime) {
        tracing::info!(
            "[AsterAgent] runtime_projection_snapshot={}",
            serde_json::to_string(&runtime_projection_snapshot)
                .unwrap_or_else(|_| "{}".to_string())
        );
    }
    let resolved_thread_id = runtime_projection_snapshot
        .primary_thread_id()
        .map(str::to_string)
        .unwrap_or_else(|| session_id.to_string());
    let turn_state = TurnState::new(
        session_id,
        workspace_id,
        resolved_thread_id,
        resolved_turn_id,
        execution_profile,
        requested_strategy.as_db_value(),
        effective_strategy.as_db_value(),
        TurnRequestToolPolicySnapshot::from(request_tool_policy),
        include_context_trace,
        runtime_chat_mode_label(runtime_chat_mode),
    );
    turn_input_builder
        .set_thread_id(turn_state.thread_id.clone())
        .set_turn_id(turn_state.turn_id.clone());
    let turn_input_envelope = turn_input_builder.build();
    let turn_input_diagnostics = turn_input_envelope.diagnostics_snapshot();
    if matches!(execution_profile, TurnExecutionProfile::FullRuntime) {
        tracing::info!(
            "[AsterAgent] turn_state={}",
            serde_json::to_string(&turn_state).unwrap_or_else(|_| "{}".to_string())
        );
        tracing::info!(
            "[AsterAgent] turn_input_envelope={}",
            serde_json::to_string(&turn_input_diagnostics).unwrap_or_else(|_| "{}".to_string())
        );
    } else {
        tracing::info!(
            "[AsterAgent] fast_turn_summary={}",
            serde_json::json!({
                "session_id": session_id,
                "workspace_id": workspace_id,
                "thread_id": turn_state.thread_id.clone(),
                "turn_id": turn_state.turn_id.clone(),
                "execution_profile": execution_profile,
                "requested_execution_strategy": requested_strategy.as_db_value(),
                "effective_execution_strategy": effective_strategy.as_db_value(),
                "system_prompt_source": system_prompt_source,
                "final_system_prompt_len": turn_input_diagnostics.final_system_prompt_len,
                "has_turn_context_metadata": turn_input_diagnostics.has_turn_context_metadata,
            })
        );
    }

    Ok(RuntimeTurnBuildArtifacts {
        runtime_projection_snapshot,
        turn_state,
        turn_input_envelope,
        turn_input_diagnostics,
    })
}

fn build_runtime_turn_execution_context(
    db: &DbConnection,
    request: &AsterChatRequest,
    session_id: &str,
    workspace_id: &str,
    effective_strategy: AsterExecutionStrategy,
    request_tool_policy: &RequestToolPolicy,
    auto_continue_enabled: bool,
    auto_continue_metadata: Option<&AutoContinuePayload>,
    session_recent_preferences: Option<&lime_agent::SessionExecutionRuntimePreferences>,
    session_state_snapshot: &SessionStateSnapshot,
    runtime_projection_snapshot: &RuntimeProjectionSnapshot,
    turn_state: &TurnState,
    turn_input_system_prompt: Option<String>,
    turn_input_include_context_trace: bool,
    turn_input_turn_context_override: Option<TurnContextOverride>,
    turn_input_diagnostics: &lime_agent::TurnDiagnosticsSnapshot,
    service_skill_preload: Option<&ServiceSkillLaunchPreloadExecution>,
) -> Result<RuntimeTurnExecutionContext, String> {
    let run_start_metadata = build_runtime_run_start_metadata(
        request,
        workspace_id,
        effective_strategy,
        request_tool_policy,
        auto_continue_enabled,
        auto_continue_metadata,
        session_recent_preferences,
        session_state_snapshot,
        runtime_projection_snapshot,
        turn_state,
        turn_input_diagnostics,
        service_skill_preload,
    );
    let timeline_recorder = Arc::new(Mutex::new(AgentTimelineRecorder::create(
        db.clone(),
        turn_state.thread_id.clone(),
        turn_state.turn_id.clone(),
        request.message.clone(),
    )?));
    let runtime_status_session_config = build_runtime_session_config(
        session_id,
        &turn_state.thread_id,
        &turn_state.turn_id,
        None,
        None,
        turn_input_turn_context_override.clone(),
    );

    Ok(RuntimeTurnExecutionContext {
        run_start_metadata,
        run_observation: Arc::new(Mutex::new(ChatRunObservation::default())),
        timeline_recorder,
        runtime_status_session_config,
        stream_session_config_state: RuntimeTurnStreamSessionConfigState {
            session_id: session_id.to_string(),
            thread_id: turn_state.thread_id.clone(),
            turn_id: turn_state.turn_id.clone(),
            system_prompt: turn_input_system_prompt,
            include_context_trace: turn_input_include_context_trace,
            turn_context_override: turn_input_turn_context_override,
        },
    })
}

fn apply_service_skill_preload_prompt_stage(
    turn_input_builder: &mut TurnInputEnvelopeBuilder,
    execution_profile: TurnExecutionProfile,
    system_prompt: Option<String>,
    service_skill_preload: Option<&ServiceSkillLaunchPreloadExecution>,
) {
    if !matches!(execution_profile, TurnExecutionProfile::FullRuntime) {
        return;
    }

    let system_prompt =
        merge_system_prompt_with_service_skill_launch_preload(system_prompt, service_skill_preload);
    turn_input_builder.apply_prompt_stage(
        TurnPromptAugmentationStageKind::ServiceSkillLaunchPreload,
        system_prompt,
    );
}

#[allow(clippy::too_many_arguments)]
async fn prepare_runtime_turn_execution(
    agent_arc: &Arc<tokio::sync::RwLock<Option<Agent>>>,
    db: &DbConnection,
    request: &AsterChatRequest,
    session_id: &str,
    workspace_id: &str,
    resolved_turn_id: &str,
    execution_profile: TurnExecutionProfile,
    requested_strategy: AsterExecutionStrategy,
    effective_strategy: AsterExecutionStrategy,
    request_tool_policy: &RequestToolPolicy,
    include_context_trace: bool,
    runtime_chat_mode: RuntimeChatMode,
    system_prompt_source: TurnSystemPromptSource,
    system_prompt: Option<String>,
    mut turn_input_builder: TurnInputEnvelopeBuilder,
    auto_continue_enabled: bool,
    auto_continue_metadata: Option<&AutoContinuePayload>,
    session_recent_preferences: Option<&lime_agent::SessionExecutionRuntimePreferences>,
    session_state_snapshot: &SessionStateSnapshot,
    request_metadata: Option<&serde_json::Value>,
) -> Result<RuntimeTurnPreparedExecution, String> {
    let service_skill_preload = if matches!(execution_profile, TurnExecutionProfile::FullRuntime) {
        preload_service_skill_launch_execution(db, request_metadata)
            .await
            .map_err(|error| format!("站点技能预执行失败: {error}"))?
    } else {
        None
    };
    apply_service_skill_preload_prompt_stage(
        &mut turn_input_builder,
        execution_profile,
        system_prompt,
        service_skill_preload.as_ref(),
    );

    let runtime_turn_artifacts = build_runtime_turn_artifacts(
        agent_arc,
        session_id,
        workspace_id,
        resolved_turn_id,
        execution_profile,
        requested_strategy,
        effective_strategy,
        request_tool_policy,
        include_context_trace,
        runtime_chat_mode,
        system_prompt_source,
        turn_input_builder,
    )
    .await?;

    let runtime_turn_execution_context = build_runtime_turn_execution_context(
        db,
        request,
        session_id,
        workspace_id,
        effective_strategy,
        request_tool_policy,
        auto_continue_enabled,
        auto_continue_metadata,
        session_recent_preferences,
        session_state_snapshot,
        &runtime_turn_artifacts.runtime_projection_snapshot,
        &runtime_turn_artifacts.turn_state,
        runtime_turn_artifacts
            .turn_input_envelope
            .system_prompt()
            .map(str::to_string),
        runtime_turn_artifacts
            .turn_input_envelope
            .include_context_trace(),
        runtime_turn_artifacts
            .turn_input_envelope
            .turn_context_override(),
        &runtime_turn_artifacts.turn_input_diagnostics,
        service_skill_preload.as_ref(),
    )?;

    Ok(RuntimeTurnPreparedExecution {
        service_skill_preload,
        runtime_turn_artifacts,
        runtime_turn_execution_context,
    })
}

#[allow(clippy::too_many_arguments)]
async fn execute_runtime_turn_submit(
    app: &AppHandle,
    state: &AsterAgentState,
    db: &DbConnection,
    request: &AsterChatRequest,
    session_id: &str,
    workspace_id: &str,
    workspace_root: &str,
    resolved_turn_id: &str,
    submit_preparation: RuntimeTurnSubmitPreparation,
    cancel_token: CancellationToken,
) -> Result<(), String> {
    let RuntimeTurnSubmitPreparation {
        auto_continue_config,
        auto_continue_enabled,
        session_state_snapshot,
        session_recent_preferences,
        runtime_chat_mode,
        include_context_trace,
        turn_input_builder,
        request_tool_policy,
        execution_profile,
        requested_strategy,
        effective_strategy,
        system_prompt,
        system_prompt_source,
        submit_bootstrap,
    } = submit_preparation;

    sync_browser_assist_runtime_hint(session_id, submit_bootstrap.request_metadata.as_ref()).await;

    let agent_arc = state.get_agent_arc();
    let provider_model_name = request
        .provider_config
        .as_ref()
        .map(|config| config.model_name.as_str());
    let auto_continue_metadata = auto_continue_config.clone();
    let runtime_turn_prepared_execution = prepare_runtime_turn_execution(
        &agent_arc,
        db,
        request,
        session_id,
        workspace_id,
        resolved_turn_id,
        execution_profile,
        requested_strategy,
        effective_strategy,
        &request_tool_policy,
        include_context_trace,
        runtime_chat_mode,
        system_prompt_source,
        system_prompt,
        turn_input_builder,
        auto_continue_enabled,
        auto_continue_metadata.as_ref(),
        session_recent_preferences.as_ref(),
        &session_state_snapshot,
        submit_bootstrap.request_metadata.as_ref(),
    )
    .await?;

    let guard = agent_arc.read().await;
    let agent = guard.as_ref().ok_or("Agent not initialized")?;
    if let Err(error) = sync_runtime_skill_source_agent(session_id, agent).await {
        tracing::warn!(
            "[AsterAgent] 同步 runtime skill source agent 失败，已降级继续执行: {}",
            error
        );
    }
    runtime_turn_prepared_execution
        .emit_prelude_and_execute(
            agent,
            &submit_bootstrap.tracker,
            app,
            state,
            db,
            request,
            &submit_bootstrap.runtime_memory_config,
            session_id,
            workspace_root,
            workspace_id,
            execution_profile,
            submit_bootstrap.request_metadata.as_ref(),
            submit_bootstrap.provider_continuation_capability,
            cancel_token,
            effective_strategy,
            &request_tool_policy,
            provider_model_name,
            session_recent_preferences.as_ref(),
        )
        .await
}

#[allow(clippy::too_many_arguments)]
async fn execute_runtime_turn_with_session_scope(
    app: &AppHandle,
    state: &AsterAgentState,
    db: &DbConnection,
    request: &AsterChatRequest,
    session_id: &str,
    workspace_id: &str,
    workspace_root: &str,
    resolved_turn_id: &str,
    submit_preparation: RuntimeTurnSubmitPreparation,
) -> Result<(), String> {
    let model_skill_tool_enabled = submit_preparation.model_skill_tool_enabled();
    with_runtime_turn_session_scope(
        state,
        session_id,
        model_skill_tool_enabled,
        move |cancel_token| async move {
            execute_runtime_turn_submit(
                app,
                state,
                db,
                request,
                session_id,
                workspace_id,
                workspace_root,
                resolved_turn_id,
                submit_preparation,
                cancel_token,
            )
            .await
        },
    )
    .await
}

#[allow(clippy::too_many_arguments)]
async fn execute_runtime_turn_pipeline(
    app: &AppHandle,
    state: &AsterAgentState,
    db: &DbConnection,
    api_key_provider_service: &ApiKeyProviderServiceState,
    logs: &LogState,
    config_manager: &GlobalConfigManagerState,
    mcp_manager: &McpManagerState,
    automation_state: &AutomationServiceState,
    mut request: AsterChatRequest,
) -> Result<(), String> {
    prepare_runtime_turn_entry(app, state, db, api_key_provider_service, mcp_manager).await?;
    let RuntimeTurnIngressContext {
        owned_session_id,
        workspace_id,
        workspace_root,
        workspace_settings,
        resolved_turn_id,
        runtime_config,
        session_recent_harness_context,
        workspace_repaired,
        workspace_warning,
    } = prepare_runtime_turn_ingress_context(
        app,
        db,
        api_key_provider_service,
        logs,
        config_manager,
        &mut request,
    )
    .await?;

    enforce_runtime_turn_user_prompt_submit_hooks_with_runtime(
        &request.message,
        owned_session_id.as_str(),
        workspace_root.as_str(),
        db,
        state,
        mcp_manager,
    )
    .await?;

    let session_id = owned_session_id.as_str();
    let submit_preparation = prepare_runtime_turn_submit_preparation(
        app,
        state,
        db,
        api_key_provider_service,
        logs,
        config_manager,
        mcp_manager,
        automation_state,
        &mut request,
        session_id,
        workspace_id.as_str(),
        workspace_root.as_str(),
        resolved_turn_id.as_str(),
        &workspace_settings,
        &runtime_config,
        workspace_repaired,
        workspace_warning,
        &session_recent_harness_context,
    )
    .await?;

    execute_runtime_turn_with_session_scope(
        app,
        state,
        db,
        &request,
        session_id,
        workspace_id.as_str(),
        workspace_root.as_str(),
        resolved_turn_id.as_str(),
        submit_preparation,
    )
    .await
}

async fn prepare_runtime_turn_entry(
    app: &AppHandle,
    state: &AsterAgentState,
    db: &DbConnection,
    api_key_provider_service: &ApiKeyProviderServiceState,
    mcp_manager: &McpManagerState,
) -> Result<(), String> {
    let is_init = state.is_initialized().await;
    tracing::warn!("[AsterAgent] Agent 初始化状态: {}", is_init);
    if !is_init {
        tracing::warn!("[AsterAgent] Agent 未初始化，开始初始化...");
        state.init_agent_with_db(db).await?;
        tracing::warn!("[AsterAgent] Agent 初始化完成");
    } else {
        tracing::warn!("[AsterAgent] Agent 已初始化，检查 session_store...");
        let agent_arc = state.get_agent_arc();
        let guard = agent_arc.read().await;
        if let Some(agent) = guard.as_ref() {
            let has_store = agent.session_store().is_some();
            tracing::warn!("[AsterAgent] session_store 存在: {}", has_store);
        }
    }

    ensure_host_backed_config_tool_registered(app, state).await?;
    ensure_runtime_permission_request_hook_handler_registered(state, db, mcp_manager).await?;
    ensure_runtime_support_tools_registered(app, state, db, api_key_provider_service, mcp_manager)
        .await
}

async fn prepare_runtime_turn_ingress_context(
    app: &AppHandle,
    db: &DbConnection,
    api_key_provider_service: &ApiKeyProviderServiceState,
    logs: &LogState,
    config_manager: &GlobalConfigManagerState,
    request: &mut AsterChatRequest,
) -> Result<RuntimeTurnIngressContext, String> {
    let should_resolve_session_recent_harness_context = extract_harness_string(
        request.metadata.as_ref(),
        &["theme", "harness_theme", "harnessTheme"],
    )
    .is_none()
        || extract_harness_string(request.metadata.as_ref(), &["session_mode", "sessionMode"])
            .is_none()
        || extract_harness_string(request.metadata.as_ref(), &["gate_key", "gateKey"]).is_none()
        || extract_harness_string(
            request.metadata.as_ref(),
            &["run_title", "runTitle", "title"],
        )
        .is_none()
        || extract_harness_string(request.metadata.as_ref(), &["content_id", "contentId"])
            .is_none();
    let provider_resolution_future =
        resolve_runtime_request_provider_resolution(app, db, api_key_provider_service, request);
    let session_recent_harness_context_future = async {
        if should_resolve_session_recent_harness_context {
            resolve_session_recent_harness_context(&request.session_id).await
        } else {
            Ok(SessionRecentHarnessContext::default())
        }
    };
    let (provider_resolution, session_recent_harness_context) = tokio::try_join!(
        provider_resolution_future,
        session_recent_harness_context_future
    )?;

    request.metadata = merge_runtime_request_resolution_metadata(
        request.metadata.take(),
        &provider_resolution.task_profile,
        &provider_resolution.routing_decision,
        &provider_resolution.limit_state,
        &provider_resolution.cost_state,
        provider_resolution.limit_event.as_ref(),
        provider_resolution.oem_policy.as_ref(),
        &provider_resolution.runtime_summary,
    );
    if let Some(resolved_provider_config) = provider_resolution.provider_config {
        request.provider_config = Some(resolved_provider_config);
    }
    if let Some(provider_config) = request.provider_config.as_mut() {
        ensure_provider_runtime_ready(provider_config).await?;
        let runtime_tool_call_decision =
            enrich_provider_config_with_runtime_tool_strategy(provider_config).await;
        tracing::info!(
            "[AsterAgent] provider_config 运行时工具策略: provider_id={:?}, provider_name={}, model_name={}, strategy={:?}, toolshim_model={:?}, tools={}, function_calling={}, reasoning={}",
            provider_config.provider_id,
            provider_config.provider_name,
            provider_config.model_name,
            runtime_tool_call_decision.strategy,
            runtime_tool_call_decision.toolshim_model,
            runtime_tool_call_decision.capabilities.tools,
            runtime_tool_call_decision.capabilities.function_calling,
            runtime_tool_call_decision.capabilities.reasoning
        );
    }

    normalize_runtime_turn_request_metadata(
        request,
        session_recent_harness_context.theme.as_deref(),
        session_recent_harness_context.session_mode.as_deref(),
        session_recent_harness_context.gate_key.as_deref(),
        session_recent_harness_context.run_title.as_deref(),
        session_recent_harness_context.content_id.as_deref(),
        false,
    );
    backfill_runtime_access_policies(request);

    let owned_session_id = request.session_id.clone();

    let workspace_id = match resolve_runtime_turn_workspace_id(db, request) {
        Ok(workspace_id) => workspace_id,
        Err(message) => {
            logs.write()
                .await
                .add("error", &format!("[AsterAgent] {}", message));
            return Err(message);
        }
    };

    let manager = WorkspaceManager::new(db.clone());
    let workspace = match manager.get(&workspace_id) {
        Ok(Some(workspace)) => workspace,
        Ok(None) => {
            let message = format!("Workspace 不存在: {workspace_id}");
            logs.write()
                .await
                .add("error", &format!("[AsterAgent] {}", message));
            return Err(message);
        }
        Err(error) => {
            let message = format!("读取 workspace 失败: {error}");
            logs.write()
                .await
                .add("error", &format!("[AsterAgent] {}", message));
            return Err(message);
        }
    };
    let ensured = match ensure_workspace_ready_with_auto_relocate(&manager, &workspace) {
        Ok(result) => result,
        Err(message) => {
            logs.write()
                .await
                .add("error", &format!("[AsterAgent] {}", message));
            return Err(message);
        }
    };

    let runtime_config = config_manager.config();
    apply_web_search_runtime_env(&runtime_config);

    Ok(RuntimeTurnIngressContext {
        owned_session_id,
        workspace_id,
        workspace_root: ensured.root_path.to_string_lossy().to_string(),
        workspace_settings: workspace.settings.clone(),
        resolved_turn_id: request
            .turn_id
            .clone()
            .unwrap_or_else(|| Uuid::new_v4().to_string()),
        runtime_config,
        session_recent_harness_context,
        workspace_repaired: ensured.repaired,
        workspace_warning: ensured.warning,
    })
}

fn normalize_runtime_turn_request_metadata(
    request: &mut AsterChatRequest,
    session_recent_theme: Option<&str>,
    session_recent_session_mode: Option<&str>,
    session_recent_gate_key: Option<&str>,
    session_recent_run_title: Option<&str>,
    session_recent_content_id: Option<&str>,
    enable_artifact_defaults: bool,
) {
    request.metadata = crate::services::artifact_request_metadata_service::
        normalize_request_metadata_with_artifact_options(
            request.metadata.take(),
            session_recent_theme,
            session_recent_session_mode,
            session_recent_gate_key,
            session_recent_run_title,
            session_recent_content_id,
            crate::services::artifact_request_metadata_service::
                ArtifactRequestMetadataNormalizationOptions {
                    enable_artifact_defaults,
                },
        );
}

fn apply_turn_prompt_stage<F>(
    turn_input_builder: &mut TurnInputEnvelopeBuilder,
    stage: TurnPromptAugmentationStageKind,
    prompt: Option<String>,
    apply: F,
) -> Option<String>
where
    F: FnOnce(Option<String>) -> Option<String>,
{
    let prompt = apply(prompt);
    turn_input_builder.apply_prompt_stage(stage, prompt.clone());
    prompt
}

fn apply_turn_metadata_prompt_stage<F>(
    turn_input_builder: &mut TurnInputEnvelopeBuilder,
    stage: TurnPromptAugmentationStageKind,
    prompt: Option<String>,
    request_metadata: Option<&serde_json::Value>,
    apply: F,
) -> Option<String>
where
    F: FnOnce(Option<String>, Option<&serde_json::Value>) -> Option<String>,
{
    apply_turn_prompt_stage(turn_input_builder, stage, prompt, |prompt| {
        apply(prompt, request_metadata)
    })
}

fn merge_system_prompt_with_turn_memory_prefetch(
    prompt: Option<String>,
    runtime_config: &lime_core::config::Config,
    db: &DbConnection,
    session_id: &str,
    workspace_root: &str,
    request: &AsterChatRequest,
) -> Option<String> {
    if !runtime_config.memory.enabled {
        return prompt;
    }

    let prefetch_request = crate::commands::memory_management_cmd::TurnMemoryPrefetchRequest {
        session_id: session_id.to_string(),
        working_dir: Some(workspace_root.to_string()),
        user_message: request.message.clone(),
        request_metadata: request.metadata.clone(),
        max_durable_entries: None,
        max_working_chars: None,
    };

    match db.lock() {
        Ok(conn) => {
            match crate::commands::memory_management_cmd::build_turn_memory_prefetch_result(
                runtime_config,
                &conn,
                Path::new(workspace_root),
                &prefetch_request,
            ) {
                Ok(prefetch) => {
                    merge_runtime_memory_prefetch_prompt(prompt, prefetch.prompt.as_deref())
                }
                Err(error) => {
                    tracing::warn!(
                        "[AsterAgent] 单回合记忆预取失败，已降级继续: session_id={}, error={}",
                        session_id,
                        error
                    );
                    prompt
                }
            }
        }
        Err(error) => {
            tracing::warn!(
                "[AsterAgent] 记忆预取无法获取数据库锁，已降级继续: session_id={}, error={}",
                session_id,
                error
            );
            prompt
        }
    }
}

fn build_full_runtime_system_prompt(
    turn_input_builder: &mut TurnInputEnvelopeBuilder,
    prompt_with_local_path_focus: Option<String>,
    runtime_config: &lime_core::config::Config,
    db: &DbConnection,
    session_id: &str,
    workspace_root: &str,
    request: &AsterChatRequest,
    request_tool_policy: &RequestToolPolicy,
    session_recent_team_selection: Option<&lime_agent::SessionExecutionRuntimeRecentTeamSelection>,
    session_recent_preferences: Option<&lime_agent::SessionExecutionRuntimePreferences>,
    auto_continue_config: Option<&AutoContinuePayload>,
) -> Option<String> {
    let request_metadata = request.metadata.as_ref();
    let mut prompt = apply_turn_prompt_stage(
        turn_input_builder,
        TurnPromptAugmentationStageKind::Memory,
        prompt_with_local_path_focus,
        |prompt| {
            let prompt = merge_system_prompt_with_memory_context(
                prompt,
                runtime_config,
                MemoryPromptContext::with_working_dir(Path::new(workspace_root)),
            );
            merge_system_prompt_with_turn_memory_prefetch(
                prompt,
                runtime_config,
                db,
                session_id,
                workspace_root,
                request,
            )
        },
    );

    prompt = apply_turn_prompt_stage(
        turn_input_builder,
        TurnPromptAugmentationStageKind::WebSearch,
        prompt,
        |prompt| merge_system_prompt_with_web_search(prompt, runtime_config),
    );
    prompt = apply_turn_prompt_stage(
        turn_input_builder,
        TurnPromptAugmentationStageKind::RequestToolPolicy,
        prompt,
        |prompt| merge_system_prompt_with_request_tool_policy(prompt, request_tool_policy),
    );
    prompt = apply_turn_metadata_prompt_stage(
        turn_input_builder,
        TurnPromptAugmentationStageKind::Artifact,
        prompt,
        request_metadata,
        merge_system_prompt_with_artifact_context,
    );
    prompt = apply_turn_metadata_prompt_stage(
        turn_input_builder,
        TurnPromptAugmentationStageKind::ImageSkillLaunch,
        prompt,
        request_metadata,
        merge_system_prompt_with_image_skill_launch,
    );
    prompt = apply_turn_metadata_prompt_stage(
        turn_input_builder,
        TurnPromptAugmentationStageKind::CoverSkillLaunch,
        prompt,
        request_metadata,
        merge_system_prompt_with_cover_skill_launch,
    );
    prompt = apply_turn_metadata_prompt_stage(
        turn_input_builder,
        TurnPromptAugmentationStageKind::VideoSkillLaunch,
        prompt,
        request_metadata,
        merge_system_prompt_with_video_skill_launch,
    );
    prompt = apply_turn_metadata_prompt_stage(
        turn_input_builder,
        TurnPromptAugmentationStageKind::BroadcastSkillLaunch,
        prompt,
        request_metadata,
        merge_system_prompt_with_broadcast_skill_launch,
    );
    prompt = apply_turn_metadata_prompt_stage(
        turn_input_builder,
        TurnPromptAugmentationStageKind::ResourceSearchSkillLaunch,
        prompt,
        request_metadata,
        merge_system_prompt_with_resource_search_skill_launch,
    );
    prompt = apply_turn_metadata_prompt_stage(
        turn_input_builder,
        TurnPromptAugmentationStageKind::ResearchSkillLaunch,
        prompt,
        request_metadata,
        merge_system_prompt_with_research_skill_launch,
    );
    prompt = apply_turn_metadata_prompt_stage(
        turn_input_builder,
        TurnPromptAugmentationStageKind::ReportSkillLaunch,
        prompt,
        request_metadata,
        merge_system_prompt_with_report_skill_launch,
    );
    prompt = apply_turn_metadata_prompt_stage(
        turn_input_builder,
        TurnPromptAugmentationStageKind::DeepSearchSkillLaunch,
        prompt,
        request_metadata,
        merge_system_prompt_with_deep_search_skill_launch,
    );
    prompt = apply_turn_metadata_prompt_stage(
        turn_input_builder,
        TurnPromptAugmentationStageKind::SiteSearchSkillLaunch,
        prompt,
        request_metadata,
        merge_system_prompt_with_site_search_skill_launch,
    );
    prompt = apply_turn_metadata_prompt_stage(
        turn_input_builder,
        TurnPromptAugmentationStageKind::PdfReadSkillLaunch,
        prompt,
        request_metadata,
        merge_system_prompt_with_pdf_read_skill_launch,
    );
    prompt = apply_turn_metadata_prompt_stage(
        turn_input_builder,
        TurnPromptAugmentationStageKind::PresentationSkillLaunch,
        prompt,
        request_metadata,
        merge_system_prompt_with_presentation_skill_launch,
    );
    prompt = apply_turn_metadata_prompt_stage(
        turn_input_builder,
        TurnPromptAugmentationStageKind::FormSkillLaunch,
        prompt,
        request_metadata,
        merge_system_prompt_with_form_skill_launch,
    );
    prompt = apply_turn_metadata_prompt_stage(
        turn_input_builder,
        TurnPromptAugmentationStageKind::SummarySkillLaunch,
        prompt,
        request_metadata,
        merge_system_prompt_with_summary_skill_launch,
    );
    prompt = apply_turn_metadata_prompt_stage(
        turn_input_builder,
        TurnPromptAugmentationStageKind::TranslationSkillLaunch,
        prompt,
        request_metadata,
        merge_system_prompt_with_translation_skill_launch,
    );
    prompt = apply_turn_metadata_prompt_stage(
        turn_input_builder,
        TurnPromptAugmentationStageKind::AnalysisSkillLaunch,
        prompt,
        request_metadata,
        merge_system_prompt_with_analysis_skill_launch,
    );
    prompt = apply_turn_metadata_prompt_stage(
        turn_input_builder,
        TurnPromptAugmentationStageKind::TranscriptionSkillLaunch,
        prompt,
        request_metadata,
        merge_system_prompt_with_transcription_skill_launch,
    );
    prompt = apply_turn_metadata_prompt_stage(
        turn_input_builder,
        TurnPromptAugmentationStageKind::UrlParseSkillLaunch,
        prompt,
        request_metadata,
        merge_system_prompt_with_url_parse_skill_launch,
    );
    prompt = apply_turn_metadata_prompt_stage(
        turn_input_builder,
        TurnPromptAugmentationStageKind::TypesettingSkillLaunch,
        prompt,
        request_metadata,
        merge_system_prompt_with_typesetting_skill_launch,
    );
    prompt = apply_turn_metadata_prompt_stage(
        turn_input_builder,
        TurnPromptAugmentationStageKind::WebpageSkillLaunch,
        prompt,
        request_metadata,
        merge_system_prompt_with_webpage_skill_launch,
    );
    prompt = apply_turn_metadata_prompt_stage(
        turn_input_builder,
        TurnPromptAugmentationStageKind::ServiceSkillLaunch,
        prompt,
        request_metadata,
        merge_system_prompt_with_service_skill_launch,
    );
    prompt = apply_turn_metadata_prompt_stage(
        turn_input_builder,
        TurnPromptAugmentationStageKind::Elicitation,
        prompt,
        request_metadata,
        merge_system_prompt_with_elicitation_context,
    );

    let subagent_mode_enabled = resolve_recent_preference_from_sources(
        request_metadata,
        &["subagent_mode_enabled", "subagentModeEnabled"],
        session_recent_preferences.map(|preferences| preferences.subagent),
    )
    .unwrap_or(false);
    prompt = apply_turn_prompt_stage(
        turn_input_builder,
        TurnPromptAugmentationStageKind::TeamPreference,
        prompt,
        |prompt| {
            merge_system_prompt_with_team_preference(
                prompt,
                request_metadata,
                session_recent_team_selection,
                subagent_mode_enabled,
            )
        },
    );

    apply_turn_prompt_stage(
        turn_input_builder,
        TurnPromptAugmentationStageKind::AutoContinue,
        prompt,
        |prompt| merge_system_prompt_with_auto_continue(prompt, auto_continue_config),
    )
}

fn build_fast_chat_system_prompt(
    turn_input_builder: &mut TurnInputEnvelopeBuilder,
    prompt_with_local_path_focus: Option<String>,
    request_tool_policy: &RequestToolPolicy,
) -> Option<String> {
    apply_turn_prompt_stage(
        turn_input_builder,
        TurnPromptAugmentationStageKind::RequestToolPolicy,
        prompt_with_local_path_focus,
        |prompt| merge_system_prompt_with_request_tool_policy(prompt, request_tool_policy),
    )
}

fn has_root_object_key(request_metadata: Option<&serde_json::Value>, key: &str) -> bool {
    request_metadata
        .and_then(serde_json::Value::as_object)
        .and_then(|object| object.get(key))
        .and_then(serde_json::Value::as_object)
        .is_some()
}

fn request_metadata_contains_full_runtime_context(
    request_metadata: Option<&serde_json::Value>,
) -> bool {
    const FULL_RUNTIME_HARNESS_OBJECT_KEYS: [(&str, &str); 18] = [
        ("image_skill_launch", "imageSkillLaunch"),
        ("service_skill_launch", "serviceSkillLaunch"),
        ("service_scene_launch", "serviceSceneLaunch"),
        ("cover_skill_launch", "coverSkillLaunch"),
        ("video_skill_launch", "videoSkillLaunch"),
        ("broadcast_skill_launch", "broadcastSkillLaunch"),
        ("resource_search_skill_launch", "resourceSearchSkillLaunch"),
        ("research_skill_launch", "researchSkillLaunch"),
        ("report_skill_launch", "reportSkillLaunch"),
        ("deep_search_skill_launch", "deepSearchSkillLaunch"),
        ("site_search_skill_launch", "siteSearchSkillLaunch"),
        ("pdf_read_skill_launch", "pdfReadSkillLaunch"),
        ("presentation_skill_launch", "presentationSkillLaunch"),
        ("form_skill_launch", "formSkillLaunch"),
        ("summary_skill_launch", "summarySkillLaunch"),
        ("translation_skill_launch", "translationSkillLaunch"),
        ("analysis_skill_launch", "analysisSkillLaunch"),
        ("team_memory_shadow", "teamMemoryShadow"),
    ];
    const FULL_RUNTIME_HARNESS_OBJECT_KEYS_EXTRA: [(&str, &str); 4] = [
        ("transcription_skill_launch", "transcriptionSkillLaunch"),
        ("url_parse_skill_launch", "urlParseSkillLaunch"),
        ("typesetting_skill_launch", "typesettingSkillLaunch"),
        ("webpage_skill_launch", "webpageSkillLaunch"),
    ];

    if has_root_object_key(request_metadata, "artifact")
        || has_root_object_key(request_metadata, "elicitation_context")
    {
        return true;
    }

    if FULL_RUNTIME_HARNESS_OBJECT_KEYS
        .iter()
        .chain(FULL_RUNTIME_HARNESS_OBJECT_KEYS_EXTRA.iter())
        .any(|(snake_case, camel_case)| {
            extract_harness_nested_object(request_metadata, &[*snake_case, *camel_case]).is_some()
        })
    {
        return true;
    }

    extract_harness_string(
        request_metadata,
        &[
            "content_id",
            "contentId",
            "turn_purpose",
            "turnPurpose",
            "purpose",
        ],
    )
    .is_some()
        || extract_harness_string(
            request_metadata,
            &[
                "preferred_team_preset_id",
                "preferredTeamPresetId",
                "selected_team_id",
                "selectedTeamId",
            ],
        )
        .is_some()
        || extract_harness_string(
            request_metadata,
            &["browser_requirement", "browserRequirement"],
        )
        .is_some()
        || extract_harness_bool(request_metadata, &["task_mode_enabled", "taskModeEnabled"])
            .unwrap_or(false)
        || extract_harness_bool(
            request_metadata,
            &["subagent_mode_enabled", "subagentModeEnabled"],
        )
        .unwrap_or(false)
}

fn resolve_fast_chat_tool_surface_mode(
    request: &AsterChatRequest,
    execution_profile: TurnExecutionProfile,
    request_tool_policy: &RequestToolPolicy,
) -> Option<&'static str> {
    if !matches!(execution_profile, TurnExecutionProfile::FastChat)
        || request_tool_policy.allows_web_search()
    {
        return None;
    }

    if !extract_explicit_local_focus_paths_from_message(&request.message).is_empty() {
        Some(FAST_CHAT_TOOL_SURFACE_LOCAL_WORKSPACE)
    } else {
        Some(FAST_CHAT_TOOL_SURFACE_DIRECT_ANSWER)
    }
}

fn merge_runtime_turn_tool_surface_metadata(
    request_metadata: Option<serde_json::Value>,
    tool_surface_mode: Option<&str>,
) -> Option<serde_json::Value> {
    let Some(tool_surface_mode) = tool_surface_mode
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return request_metadata;
    };

    let mut root = match request_metadata {
        Some(serde_json::Value::Object(object)) => object,
        Some(_) | None => serde_json::Map::new(),
    };
    let runtime_entry = root
        .entry(LIME_RUNTIME_METADATA_KEY.to_string())
        .or_insert_with(|| serde_json::Value::Object(serde_json::Map::new()));
    let runtime_object = runtime_entry
        .as_object_mut()
        .expect("lime_runtime metadata should be an object");
    runtime_object.insert(
        LIME_RUNTIME_TOOL_SURFACE_KEY.to_string(),
        serde_json::Value::String(tool_surface_mode.to_string()),
    );

    Some(serde_json::Value::Object(root))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct RuntimeImageInputPolicy {
    submitted_image_count: usize,
    forwarded_image_count: usize,
    dropped_image_count: usize,
    provider_supports_vision: bool,
}

fn count_valid_runtime_images(images: Option<&[ImageInput]>) -> usize {
    images
        .unwrap_or_default()
        .iter()
        .filter(|image| !image.data.trim().is_empty() && !image.media_type.trim().is_empty())
        .count()
}

fn normalize_runtime_provider_text(value: &str) -> String {
    value.trim().to_ascii_lowercase()
}

fn runtime_provider_is_official_deepseek(config: &ConfigureProviderRequest) -> bool {
    let provider_id = config
        .provider_id
        .as_deref()
        .map(normalize_runtime_provider_text);
    let provider_name = normalize_runtime_provider_text(&config.provider_name);
    let base_url = config
        .base_url
        .as_deref()
        .map(normalize_runtime_provider_text)
        .unwrap_or_default();

    provider_id.as_deref() == Some("deepseek")
        || provider_name == "deepseek"
        || base_url.contains("api.deepseek.com")
}

fn runtime_provider_supports_image_input(config: Option<&ConfigureProviderRequest>) -> bool {
    let Some(config) = config else {
        return false;
    };

    if runtime_provider_is_official_deepseek(config) {
        return false;
    }

    config
        .model_capabilities
        .as_ref()
        .is_some_and(|capabilities| capabilities.vision)
}

fn resolve_runtime_image_input_policy(
    request: &AsterChatRequest,
) -> Option<RuntimeImageInputPolicy> {
    let submitted_image_count = count_valid_runtime_images(request.images.as_deref());
    if submitted_image_count == 0 {
        return None;
    }

    let provider_supports_vision =
        runtime_provider_supports_image_input(request.provider_config.as_ref());
    let forwarded_image_count = if provider_supports_vision {
        submitted_image_count
    } else {
        0
    };

    Some(RuntimeImageInputPolicy {
        submitted_image_count,
        forwarded_image_count,
        dropped_image_count: submitted_image_count.saturating_sub(forwarded_image_count),
        provider_supports_vision,
    })
}

fn merge_runtime_image_input_policy_metadata(
    request_metadata: Option<serde_json::Value>,
    policy: Option<&RuntimeImageInputPolicy>,
) -> Option<serde_json::Value> {
    let Some(policy) = policy else {
        return request_metadata;
    };

    let mut root = match request_metadata {
        Some(serde_json::Value::Object(object)) => object,
        Some(_) | None => serde_json::Map::new(),
    };
    let runtime_entry = root
        .entry(LIME_RUNTIME_METADATA_KEY.to_string())
        .or_insert_with(|| serde_json::Value::Object(serde_json::Map::new()));
    let runtime_object = runtime_entry
        .as_object_mut()
        .expect("lime_runtime metadata should be an object");
    runtime_object.insert(
        LIME_RUNTIME_IMAGE_INPUT_POLICY_KEY.to_string(),
        serde_json::json!({
            "submittedImageCount": policy.submitted_image_count,
            "forwardedImageCount": policy.forwarded_image_count,
            "droppedImageCount": policy.dropped_image_count,
            "providerSupportsVision": policy.provider_supports_vision,
        }),
    );

    Some(serde_json::Value::Object(root))
}

fn build_runtime_image_input_unsupported_warning(
    request: &AsterChatRequest,
) -> Option<RuntimeAgentEvent> {
    let policy = resolve_runtime_image_input_policy(request)?;
    if policy.dropped_image_count == 0 {
        return None;
    }

    let model_name = request
        .provider_config
        .as_ref()
        .map(|config| config.model_name.trim())
        .filter(|value| !value.is_empty())
        .unwrap_or("当前模型");

    Some(RuntimeAgentEvent::Warning {
        code: Some(RUNTIME_IMAGE_INPUT_UNSUPPORTED_WARNING_CODE.to_string()),
        message: format!(
            "本轮包含 {} 张图片，但 {} 不支持图片输入；已在发送给模型前省略图片，仅保留文本和图片占位说明。请切换支持图片理解的模型后再分析图片内容。",
            policy.dropped_image_count, model_name
        ),
    })
}

fn resolve_runtime_forwarded_images(request: &AsterChatRequest) -> Option<&[ImageInput]> {
    let policy = resolve_runtime_image_input_policy(request)?;
    if policy.forwarded_image_count == 0 {
        return None;
    }

    request.images.as_deref()
}

fn merge_runtime_image_input_unsupported_system_prompt(
    base_prompt: Option<String>,
    request: &AsterChatRequest,
) -> Option<String> {
    let policy = resolve_runtime_image_input_policy(request)?;
    if policy.dropped_image_count == 0 {
        return base_prompt;
    }

    let model_name = request
        .provider_config
        .as_ref()
        .map(|config| config.model_name.trim())
        .filter(|value| !value.is_empty())
        .unwrap_or("当前模型");
    let notice = format!(
        "【图片输入降级】本轮用户上传了 {} 张图片，但 {} 不支持图片输入；图片不会发送给模型，也不能被模型看到。不要声称已经看到了图片；如果用户要求识别或分析图片，请直接说明需要切换到支持多模态/视觉输入的模型。",
        policy.dropped_image_count, model_name
    );

    match base_prompt {
        Some(prompt) if prompt.trim().is_empty() => Some(notice),
        Some(prompt) => Some(format!("{prompt}\n\n{notice}")),
        None => Some(notice),
    }
}

fn merge_runtime_request_resolution_metadata(
    request_metadata: Option<serde_json::Value>,
    task_profile: &lime_agent::SessionExecutionRuntimeTaskProfile,
    routing_decision: &lime_agent::SessionExecutionRuntimeRoutingDecision,
    limit_state: &lime_agent::SessionExecutionRuntimeLimitState,
    cost_state: &lime_agent::SessionExecutionRuntimeCostState,
    limit_event: Option<&lime_agent::SessionExecutionRuntimeLimitEvent>,
    oem_policy: Option<&lime_agent::SessionExecutionRuntimeOemPolicy>,
    runtime_summary: &lime_agent::SessionExecutionRuntimeSummary,
) -> Option<serde_json::Value> {
    let mut root = match request_metadata {
        Some(serde_json::Value::Object(object)) => object,
        Some(_) | None => serde_json::Map::new(),
    };
    let runtime_entry = root
        .entry(LIME_RUNTIME_METADATA_KEY.to_string())
        .or_insert_with(|| serde_json::Value::Object(serde_json::Map::new()));
    if !runtime_entry.is_object() {
        *runtime_entry = serde_json::Value::Object(serde_json::Map::new());
    }
    let runtime_object = runtime_entry
        .as_object_mut()
        .expect("lime_runtime metadata should be an object");
    insert_serialized_run_metadata(runtime_object, "task_profile", task_profile);
    insert_serialized_run_metadata(runtime_object, "routing_decision", routing_decision);
    insert_serialized_run_metadata(runtime_object, "limit_state", limit_state);
    insert_serialized_run_metadata(runtime_object, "cost_state", cost_state);
    insert_serialized_run_metadata(runtime_object, "runtime_summary", runtime_summary);
    if let Some(limit_event) = limit_event {
        insert_serialized_run_metadata(runtime_object, "limit_event", limit_event);
    }
    if let Some(oem_policy) = oem_policy {
        insert_serialized_run_metadata(runtime_object, "oem_policy", oem_policy);
    }

    Some(serde_json::Value::Object(root))
}

fn extract_runtime_resolution_payload<T: serde::de::DeserializeOwned>(
    request_metadata: Option<&serde_json::Value>,
    key: &str,
) -> Option<T> {
    let root = request_metadata?.as_object()?;
    let runtime = root.get(LIME_RUNTIME_METADATA_KEY)?.as_object()?;
    serde_json::from_value(runtime.get(key)?.clone()).ok()
}

fn collect_runtime_request_resolution_side_events(
    request_metadata: Option<&serde_json::Value>,
) -> Vec<RuntimeAgentEvent> {
    let mut events = Vec::new();

    if let Some(task_profile) = extract_runtime_resolution_payload::<
        lime_agent::SessionExecutionRuntimeTaskProfile,
    >(request_metadata, "task_profile")
    {
        events.push(RuntimeAgentEvent::TaskProfileResolved { task_profile });
    }

    let routing_decision = extract_runtime_resolution_payload::<
        lime_agent::SessionExecutionRuntimeRoutingDecision,
    >(request_metadata, "routing_decision");
    if let Some(routing_decision) = routing_decision.clone() {
        events.push(RuntimeAgentEvent::CandidateSetResolved {
            routing_decision: routing_decision.clone(),
        });
        events.push(RuntimeAgentEvent::RoutingDecisionMade {
            routing_decision: routing_decision.clone(),
        });

        if !routing_decision.fallback_chain.is_empty() {
            events.push(RuntimeAgentEvent::RoutingFallbackApplied {
                routing_decision: routing_decision.clone(),
            });
        }

        if routing_decision.routing_mode == "no_candidate" {
            events.push(RuntimeAgentEvent::RoutingNotPossible { routing_decision });
        }
    }

    let limit_state = extract_runtime_resolution_payload::<
        lime_agent::SessionExecutionRuntimeLimitState,
    >(request_metadata, "limit_state");
    if let Some(limit_state) = limit_state.clone() {
        events.push(RuntimeAgentEvent::LimitStateUpdated {
            limit_state: limit_state.clone(),
        });

        if limit_state.single_candidate_only {
            events.push(RuntimeAgentEvent::SingleCandidateOnly {
                limit_state: limit_state.clone(),
            });

            if limit_state.capability_gap.is_some() {
                events.push(RuntimeAgentEvent::SingleCandidateCapabilityGap { limit_state });
            }
        }
    }

    if let Some(cost_state) = extract_runtime_resolution_payload::<
        lime_agent::SessionExecutionRuntimeCostState,
    >(request_metadata, "cost_state")
    {
        events.push(RuntimeAgentEvent::CostEstimated { cost_state });
    }

    if let Some(limit_event) = extract_runtime_resolution_payload::<
        lime_agent::SessionExecutionRuntimeLimitEvent,
    >(request_metadata, "limit_event")
    {
        events.push(map_runtime_limit_event_to_runtime_agent_event(limit_event));
    }

    events
}

fn emit_runtime_request_resolution_events(
    app: &AppHandle,
    event_name: &str,
    timeline_recorder: &Arc<Mutex<AgentTimelineRecorder>>,
    workspace_root: &str,
    request_metadata: Option<&serde_json::Value>,
) {
    for event in collect_runtime_request_resolution_side_events(request_metadata) {
        emit_runtime_side_event(app, event_name, timeline_recorder, workspace_root, event);
    }
}

fn map_runtime_limit_event_to_runtime_agent_event(
    limit_event: lime_agent::SessionExecutionRuntimeLimitEvent,
) -> RuntimeAgentEvent {
    match limit_event.event_kind.as_str() {
        "quota_blocked" => RuntimeAgentEvent::QuotaBlocked { limit_event },
        "quota_low" => RuntimeAgentEvent::QuotaLow { limit_event },
        "rate_limit_hit" => RuntimeAgentEvent::RateLimitHit { limit_event },
        _ => RuntimeAgentEvent::Warning {
            code: Some("runtime_limit_event_unknown".to_string()),
            message: limit_event.message,
        },
    }
}

fn resolve_turn_execution_profile(
    request: &AsterChatRequest,
    runtime_chat_mode: RuntimeChatMode,
    request_tool_policy: &RequestToolPolicy,
    auto_continue_enabled: bool,
) -> TurnExecutionProfile {
    let has_images = request
        .images
        .as_ref()
        .is_some_and(|images| !images.is_empty());

    if has_images
        || request.project_id.is_some()
        || auto_continue_enabled
        || request_tool_policy.effective_web_search
        || !matches!(runtime_chat_mode, RuntimeChatMode::General)
        || request_metadata_contains_full_runtime_context(request.metadata.as_ref())
        || extract_harness_bool(
            request.metadata.as_ref(),
            &["allow_model_skills", "allowModelSkills"],
        )
        .unwrap_or(false)
    {
        TurnExecutionProfile::FullRuntime
    } else {
        TurnExecutionProfile::FastChat
    }
}

pub(crate) fn resolve_workspace_id_from_sources(
    request_workspace_id: Option<String>,
    session_workspace_id: Option<String>,
) -> Option<String> {
    normalize_optional_text(request_workspace_id)
        .or_else(|| normalize_optional_text(session_workspace_id))
}

fn resolve_runtime_turn_workspace_id(
    db: &DbConnection,
    request: &AsterChatRequest,
) -> Result<String, String> {
    if let Some(workspace_id) =
        resolve_workspace_id_from_sources(Some(request.workspace_id.clone()), None)
    {
        return Ok(workspace_id);
    }

    let session_workspace_id =
        AsterAgentWrapper::get_session_sync(db, &request.session_id)?.workspace_id;

    resolve_workspace_id_from_sources(None, session_workspace_id)
        .ok_or_else(|| "workspace_id 必填，请先选择项目工作区".to_string())
}

pub(crate) fn resolve_request_web_search_preference_from_sources(
    request_web_search: Option<bool>,
    request_metadata: Option<&serde_json::Value>,
    session_recent_preferences: Option<&lime_agent::SessionExecutionRuntimePreferences>,
) -> Option<bool> {
    request_web_search.or_else(|| {
        resolve_recent_preference_from_sources(
            request_metadata,
            &["web_search_enabled", "webSearchEnabled"],
            session_recent_preferences.map(|preferences| preferences.web_search),
        )
    })
}

fn resolve_runtime_access_mode_from_request(
    request: &AsterChatRequest,
) -> Option<lime_agent::SessionExecutionRuntimeAccessMode> {
    lime_agent::SessionExecutionRuntimeAccessMode::from_runtime_policies(
        request.approval_policy.as_deref(),
        request.sandbox_policy.as_deref(),
    )
    .or_else(|| {
        let access_mode =
            extract_harness_string(request.metadata.as_ref(), &["access_mode", "accessMode"]);
        lime_agent::SessionExecutionRuntimeAccessMode::from_access_mode_text(access_mode.as_deref())
    })
}

fn backfill_runtime_access_policies(request: &mut AsterChatRequest) {
    let access_mode = resolve_runtime_access_mode_from_request(request).or_else(|| {
        if request.approval_policy.is_none() && request.sandbox_policy.is_none() {
            Some(lime_agent::SessionExecutionRuntimeAccessMode::default_for_session())
        } else {
            None
        }
    });
    let Some(access_mode) = access_mode else {
        return;
    };

    if request.approval_policy.is_none() {
        request.approval_policy = Some(access_mode.approval_policy().to_string());
    }
    if request.sandbox_policy.is_none() {
        request.sandbox_policy = Some(access_mode.sandbox_policy().to_string());
    }
}

fn should_skip_artifact_document_autopersist(
    run_observation: &Arc<Mutex<ChatRunObservation>>,
    final_text_output: &str,
) -> bool {
    if final_text_output.trim().is_empty() {
        return true;
    }

    let observation = match run_observation.lock() {
        Ok(guard) => guard,
        Err(error) => error.into_inner(),
    };
    // 只允许根据运行期 artifact observation 决定是否跳过 autopersist，
    // 不再从最终文本中的 `<write_file>` 片段反推 artifact 状态。
    !observation.artifact_paths.is_empty()
}

fn request_metadata_has_explicit_artifact_intent(
    request_metadata: Option<&serde_json::Value>,
) -> bool {
    let Some(root) = request_metadata.and_then(serde_json::Value::as_object) else {
        return false;
    };

    if root
        .get("artifact")
        .and_then(serde_json::Value::as_object)
        .is_some_and(|artifact| !artifact.is_empty())
    {
        return true;
    }

    [
        "artifact_mode",
        "artifactMode",
        "artifact_stage",
        "artifactStage",
        "artifact_kind",
        "artifactKind",
        "artifact_request_id",
        "artifactRequestId",
    ]
    .iter()
    .any(|key| {
        root.get(*key)
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .is_some_and(|value| !value.is_empty())
    })
}

fn should_skip_default_fast_chat_artifact_autopersist(
    execution_profile: TurnExecutionProfile,
    request_metadata: Option<&serde_json::Value>,
) -> bool {
    if !matches!(execution_profile, TurnExecutionProfile::FastChat) {
        return false;
    }

    if request_metadata_has_explicit_artifact_intent(request_metadata)
        || extract_harness_string(request_metadata, &["content_id", "contentId"]).is_some()
    {
        return false;
    }

    !matches!(
        extract_harness_string(request_metadata, &["session_mode", "sessionMode"]).as_deref(),
        Some("general_workbench")
    )
}

fn maybe_persist_artifact_document_after_stream(
    app: &AppHandle,
    db: &DbConnection,
    event_name: &str,
    timeline_recorder: &Arc<Mutex<AgentTimelineRecorder>>,
    run_observation: &Arc<Mutex<ChatRunObservation>>,
    workspace_root: &str,
    workspace_id: &str,
    thread_id: &str,
    turn_id: &str,
    execution_profile: TurnExecutionProfile,
    request_metadata: Option<&serde_json::Value>,
    final_text_output: &str,
) {
    if should_skip_default_fast_chat_artifact_autopersist(execution_profile, request_metadata) {
        return;
    }
    if !crate::services::artifact_document_service::should_attempt_artifact_document_autopersist(
        request_metadata,
    ) {
        return;
    }
    if should_skip_artifact_document_autopersist(run_observation, final_text_output) {
        return;
    }

    let persist_params =
        crate::services::artifact_document_service::ArtifactDocumentPersistParams {
            workspace_root: PathBuf::from(workspace_root),
            workspace_id: Some(workspace_id.to_string()),
            thread_id: thread_id.to_string(),
            turn_id: turn_id.to_string(),
            request_metadata: request_metadata.cloned(),
        };

    match crate::services::artifact_document_service::persist_artifact_document_from_text(
        final_text_output,
        &persist_params,
    ) {
        Ok(persisted) => {
            {
                let mut observation = match run_observation.lock() {
                    Ok(guard) => guard,
                    Err(error) => error.into_inner(),
                };
                observation.record_artifact_path(persisted.relative_path.clone(), request_metadata);
            }

            emit_runtime_side_event(
                app,
                event_name,
                timeline_recorder,
                workspace_root,
                RuntimeAgentEvent::ArtifactSnapshot {
                    artifact: lime_agent::AgentArtifactSignal {
                        artifact_id: persisted.artifact_id.clone(),
                        file_path: persisted.relative_path.clone(),
                        content: Some(persisted.serialized_document.clone()),
                        metadata: Some(
                            persisted
                                .snapshot_metadata
                                .iter()
                                .map(|(key, value)| (key.clone(), value.clone()))
                                .collect(),
                        ),
                    },
                },
            );

            if let Err(error) =
                crate::services::artifact_document_service::sync_persisted_artifact_document_to_content(
                    db,
                    request_metadata,
                    &persisted,
                )
            {
                tracing::warn!(
                    "[AsterAgent] ArtifactDocument 已落盘，但同步内容版本状态失败: {}",
                    error
                );
            }

            if persisted.repaired || persisted.status == "failed" {
                let (code, prefix) = if persisted.status == "failed" {
                    (
                        ARTIFACT_DOCUMENT_FAILED_WARNING_CODE,
                        "ArtifactDocument 已落盘",
                    )
                } else {
                    (
                        ARTIFACT_DOCUMENT_REPAIRED_WARNING_CODE,
                        "ArtifactDocument 已落盘",
                    )
                };
                let detail = build_artifact_document_warning_message(
                    persisted.status.as_str(),
                    persisted.fallback_used,
                    &persisted.issues,
                );
                emit_runtime_side_event(
                    app,
                    event_name,
                    timeline_recorder,
                    workspace_root,
                    RuntimeAgentEvent::Warning {
                        code: Some(code.to_string()),
                        message: format!("{prefix}: {detail}"),
                    },
                );
            }
        }
        Err(error) => {
            emit_runtime_side_event(
                app,
                event_name,
                timeline_recorder,
                workspace_root,
                RuntimeAgentEvent::Warning {
                    code: Some(ARTIFACT_DOCUMENT_PERSIST_FAILED_WARNING_CODE.to_string()),
                    message: format!("ArtifactDocument 自动落盘失败，已保留消息区结果：{error}"),
                },
            );
        }
    }
}

fn finalize_runtime_stream_success(
    app: &AppHandle,
    db: &DbConnection,
    event_name: &str,
    timeline_recorder: &Arc<Mutex<AgentTimelineRecorder>>,
    run_observation: &Arc<Mutex<ChatRunObservation>>,
    runtime_memory_config: &lime_core::config::MemoryConfig,
    session_id: &str,
    user_message: &str,
    workspace_root: &str,
    workspace_id: &str,
    thread_id: &str,
    turn_id: &str,
    execution_profile: TurnExecutionProfile,
    request_metadata: Option<&serde_json::Value>,
    execution: &lime_agent::request_tool_policy::StreamReplyExecution,
) {
    maybe_persist_artifact_document_after_stream(
        app,
        db,
        event_name,
        timeline_recorder,
        run_observation,
        workspace_root,
        workspace_id,
        thread_id,
        turn_id,
        execution_profile,
        request_metadata,
        execution.text_output.as_str(),
    );
    spawn_runtime_memory_capture_task(
        app,
        db,
        runtime_memory_config.clone(),
        session_id,
        user_message,
        execution.text_output.as_str(),
    );
}

async fn execute_runtime_stream_attempt(
    agent: &Agent,
    app: &AppHandle,
    db: &DbConnection,
    request: &AsterChatRequest,
    timeline_recorder: &Arc<Mutex<AgentTimelineRecorder>>,
    run_observation: &Arc<Mutex<ChatRunObservation>>,
    runtime_memory_config: &lime_core::config::MemoryConfig,
    session_id: &str,
    workspace_root: &str,
    workspace_id: &str,
    thread_id: &str,
    turn_id: &str,
    execution_profile: TurnExecutionProfile,
    request_metadata: Option<&serde_json::Value>,
    provider_continuation_capability: ProviderContinuationCapability,
    mut session_config: aster::agents::types::SessionConfig,
    cancel_token: CancellationToken,
    request_tool_policy: &RequestToolPolicy,
) -> Result<String, ReplyAttemptError> {
    if let Some(warning_event) = build_runtime_image_input_unsupported_warning(request) {
        emit_runtime_side_event(
            app,
            &request.event_name,
            timeline_recorder,
            workspace_root,
            warning_event,
        );
    }
    session_config.system_prompt = merge_runtime_image_input_unsupported_system_prompt(
        session_config.system_prompt.take(),
        request,
    );
    let images_for_provider = resolve_runtime_forwarded_images(request);

    let execution = stream_reply_once(
        agent,
        app,
        &request.event_name,
        build_runtime_user_message(&request.message, images_for_provider),
        Some(Path::new(workspace_root)),
        session_config,
        cancel_token,
        request_tool_policy,
        {
            let run_observation = run_observation.clone();
            let app = app.clone();
            let event_name = request.event_name.clone();
            let timeline_recorder = timeline_recorder.clone();
            move |event| {
                record_runtime_stream_event(
                    &run_observation,
                    &app,
                    &event_name,
                    &timeline_recorder,
                    workspace_root,
                    request_metadata,
                    provider_continuation_capability,
                    event,
                );
            }
        },
    )
    .await?;

    finalize_runtime_stream_success(
        app,
        db,
        &request.event_name,
        timeline_recorder,
        run_observation,
        runtime_memory_config,
        session_id,
        &request.message,
        workspace_root,
        workspace_id,
        thread_id,
        turn_id,
        execution_profile,
        request_metadata,
        &execution,
    );

    Ok(execution.text_output)
}

async fn remove_code_execution_extension_if_added(
    agent: &Agent,
    added_code_execution: &mut bool,
    warning_message: &str,
) {
    if !*added_code_execution {
        return;
    }

    if let Err(error) = agent.remove_extension(CODE_EXECUTION_EXTENSION_NAME).await {
        tracing::warn!("[AsterAgent] {}: {}", warning_message, error);
    }
    *added_code_execution = false;
}

async fn execute_runtime_stream_with_strategy<F>(
    agent: &Agent,
    app: &AppHandle,
    state: &AsterAgentState,
    db: &DbConnection,
    request: &AsterChatRequest,
    timeline_recorder: &Arc<Mutex<AgentTimelineRecorder>>,
    run_observation: &Arc<Mutex<ChatRunObservation>>,
    runtime_memory_config: &lime_core::config::MemoryConfig,
    session_id: &str,
    workspace_root: &str,
    workspace_id: &str,
    thread_id: &str,
    turn_id: &str,
    execution_profile: TurnExecutionProfile,
    request_metadata: Option<&serde_json::Value>,
    provider_continuation_capability: ProviderContinuationCapability,
    cancel_token: CancellationToken,
    request_tool_policy: &RequestToolPolicy,
    effective_strategy: AsterExecutionStrategy,
    build_session_config: F,
) -> Result<String, String>
where
    F: Fn() -> aster::agents::types::SessionConfig,
{
    let mut added_code_execution = false;
    if effective_strategy == AsterExecutionStrategy::CodeOrchestrated {
        added_code_execution = ensure_code_execution_extension_enabled(agent).await?;
    }

    let primary_result = execute_runtime_stream_attempt(
        agent,
        app,
        db,
        request,
        timeline_recorder,
        run_observation,
        runtime_memory_config,
        session_id,
        workspace_root,
        workspace_id,
        thread_id,
        turn_id,
        execution_profile,
        request_metadata,
        provider_continuation_capability,
        build_session_config(),
        cancel_token.clone(),
        request_tool_policy,
    )
    .await;

    let run_result = match primary_result {
        Ok(assistant_output) => Ok(assistant_output),
        Err(primary_error)
            if effective_strategy == AsterExecutionStrategy::CodeOrchestrated
                && should_fallback_to_react_from_code_orchestrated(&primary_error) =>
        {
            tracing::warn!(
                "[AsterAgent] 编排模式执行失败，自动降级到 ReAct: {}",
                primary_error.message
            );
            remove_code_execution_extension_if_added(
                agent,
                &mut added_code_execution,
                "降级前移除 code_execution 扩展失败",
            )
            .await;
            execute_runtime_stream_attempt(
                agent,
                app,
                db,
                request,
                timeline_recorder,
                run_observation,
                runtime_memory_config,
                session_id,
                workspace_root,
                workspace_id,
                thread_id,
                turn_id,
                execution_profile,
                request_metadata,
                provider_continuation_capability,
                build_session_config(),
                cancel_token,
                request_tool_policy,
            )
            .await
            .map_err(|fallback_err| fallback_err.message)
        }
        Err(primary_error) if is_runtime_model_permission_denied_error(&primary_error.message) => {
            let recovery_result: Result<Option<String>, String> = async {
                let Some(provider_config) = request.provider_config.as_ref() else {
                    return Ok(None);
                };
                let provider_selector = provider_config
                    .provider_id
                    .as_deref()
                    .unwrap_or(&provider_config.provider_name)
                    .trim();
                if provider_selector.is_empty() {
                    return Ok(None);
                }

                let api_key_provider_service = app.state::<ApiKeyProviderServiceState>();
                let Some(fallback_provider_config) = resolve_runtime_provider_auth_recovery_config(
                    app,
                    db,
                    api_key_provider_service.inner(),
                    request,
                    provider_selector,
                    &provider_config.model_name,
                )
                .await?
                else {
                    return Ok(None);
                };

                tracing::warn!(
                    "[AsterAgent] 模型访问受限，自动回退同 provider 候选: session={}, provider={}, failed_model={}, fallback_model={}",
                    session_id,
                    provider_selector,
                    provider_config.model_name,
                    fallback_provider_config.model_name
                );
                emit_runtime_side_event(
                    app,
                    &request.event_name,
                    timeline_recorder,
                    workspace_root,
                    RuntimeAgentEvent::Warning {
                        code: Some(RUNTIME_MODEL_PERMISSION_FALLBACK_WARNING_CODE.to_string()),
                        message: format!(
                            "当前模型暂不可用，已自动切换到同 Provider 的兼容候选模型 `{}` 后重试。",
                            fallback_provider_config.model_name
                        ),
                    },
                );

                apply_runtime_turn_provider_config(
                    state,
                    db,
                    session_id,
                    Some(&fallback_provider_config),
                )
                .await?;

                let mut fallback_request = request.clone();
                fallback_request.provider_config = Some(fallback_provider_config);

                execute_runtime_stream_attempt(
                    agent,
                    app,
                    db,
                    &fallback_request,
                    timeline_recorder,
                    run_observation,
                    runtime_memory_config,
                    session_id,
                    workspace_root,
                    workspace_id,
                    thread_id,
                    turn_id,
                    execution_profile,
                    request_metadata,
                    provider_continuation_capability,
                    build_session_config(),
                    cancel_token.clone(),
                    request_tool_policy,
                )
                .await
                .map(Some)
                .map_err(|fallback_error| fallback_error.message)
            }
            .await;

            match recovery_result {
                Ok(Some(assistant_output)) => Ok(assistant_output),
                Ok(None) => Err(primary_error.message),
                Err(recovery_error) => Err(recovery_error),
            }
        }
        Err(primary_error) => Err(primary_error.message),
    };

    remove_code_execution_extension_if_added(
        agent,
        &mut added_code_execution,
        "移除 code_execution 扩展失败，后续会话可能继续保留编排模式",
    )
    .await;

    run_result
}

async fn prepare_runtime_turn_prelude(
    agent: &Agent,
    app: &AppHandle,
    request: &AsterChatRequest,
    timeline_recorder: &Arc<Mutex<AgentTimelineRecorder>>,
    workspace_root: &str,
    runtime_status_session_config: &aster::agents::types::SessionConfig,
    effective_strategy: AsterExecutionStrategy,
    request_tool_policy: &RequestToolPolicy,
    model_name: Option<&str>,
    session_recent_preferences: Option<&lime_agent::SessionExecutionRuntimePreferences>,
    service_skill_preload: Option<&ServiceSkillLaunchPreloadExecution>,
) -> Result<(), String> {
    if let Err(error) = agent
        .ensure_runtime_turn_initialized(
            runtime_status_session_config,
            Some(request.message.clone()),
        )
        .await
    {
        tracing::warn!(
            "[AsterAgent] 初始化 runtime turn 失败，后续降级继续: {}",
            error
        );
    }

    let (initial_runtime_status, decided_runtime_status) = build_turn_runtime_statuses(
        request,
        effective_strategy,
        request_tool_policy,
        model_name,
        session_recent_preferences,
    )
    .await?;
    for status in [initial_runtime_status, decided_runtime_status] {
        emit_runtime_status_with_projection(
            agent,
            app,
            &request.event_name,
            timeline_recorder,
            workspace_root,
            runtime_status_session_config,
            status,
        )
        .await;
    }

    emit_runtime_request_resolution_events(
        app,
        &request.event_name,
        timeline_recorder,
        workspace_root,
        request.metadata.as_ref(),
    );

    if let Some(preload) = service_skill_preload {
        emit_service_skill_preload_runtime_events(
            app,
            &request.event_name,
            timeline_recorder,
            workspace_root,
            preload,
        );
    }

    Ok(())
}

async fn with_runtime_turn_session_scope<F, Fut>(
    state: &AsterAgentState,
    session_id: &str,
    skill_tool_access_enabled: bool,
    run: F,
) -> Result<(), String>
where
    F: FnOnce(CancellationToken) -> Fut,
    Fut: std::future::Future<Output = Result<(), String>>,
{
    let cancel_token = state.create_cancel_token(session_id).await;
    lime_agent::tools::set_skill_tool_session_access(session_id, skill_tool_access_enabled);

    let result = run(cancel_token).await;

    lime_agent::tools::clear_skill_tool_session_access(session_id);
    state.remove_cancel_token(session_id).await;
    result
}

fn record_runtime_stream_event(
    run_observation: &Arc<Mutex<ChatRunObservation>>,
    app: &AppHandle,
    event_name: &str,
    timeline_recorder: &Arc<Mutex<AgentTimelineRecorder>>,
    workspace_root: &str,
    request_metadata: Option<&serde_json::Value>,
    provider_continuation_capability: ProviderContinuationCapability,
    event: &RuntimeAgentEvent,
) {
    let mut observation = match run_observation.lock() {
        Ok(guard) => guard,
        Err(error) => {
            tracing::warn!("[AsterAgent] run observation lock poisoned，继续复用内部状态");
            error.into_inner()
        }
    };
    observation.record_event(
        event,
        workspace_root,
        request_metadata,
        provider_continuation_capability,
    );
    let mut recorder = match timeline_recorder.lock() {
        Ok(guard) => guard,
        Err(error) => error.into_inner(),
    };
    if let Err(error) = recorder.record_runtime_event(app, event_name, event, workspace_root) {
        tracing::warn!("[AsterAgent] 记录时间线事件失败（已降级继续）: {}", error);
    }
}

fn build_runtime_run_finish_decision<T>(
    result: &Result<T, String>,
    run_start_metadata: &serde_json::Map<String, serde_json::Value>,
    run_observation: &Arc<Mutex<ChatRunObservation>>,
) -> RunFinishDecision {
    let observation = match run_observation.lock() {
        Ok(guard) => guard.clone(),
        Err(error) => {
            tracing::warn!("[AsterAgent] finalize run metadata 时 observation lock 已 poisoned");
            error.into_inner().clone()
        }
    };
    let metadata = build_chat_run_finish_metadata(run_start_metadata, &observation);

    match result {
        Ok(_) => RunFinishDecision {
            status: lime_core::database::dao::agent_run::AgentRunStatus::Success,
            error_code: None,
            error_message: None,
            metadata: Some(metadata),
        },
        Err(error) => RunFinishDecision {
            status: lime_core::database::dao::agent_run::AgentRunStatus::Error,
            error_code: Some("chat_stream_failed".to_string()),
            error_message: Some(error.clone()),
            metadata: Some(metadata),
        },
    }
}

async fn finalize_runtime_turn_result(
    agent: &Agent,
    app: &AppHandle,
    state: &AsterAgentState,
    db: &DbConnection,
    event_name: &str,
    timeline_recorder: &Arc<Mutex<AgentTimelineRecorder>>,
    workspace_root: &str,
    runtime_status_session_config: &aster::agents::types::SessionConfig,
    session_id: &str,
    request_metadata: Option<&serde_json::Value>,
    result: Result<String, String>,
) -> Result<(), String> {
    complete_runtime_status_projection(
        agent,
        app,
        event_name,
        timeline_recorder,
        workspace_root,
        runtime_status_session_config,
    )
    .await;

    let terminal_events = {
        let mut recorder = match timeline_recorder.lock() {
            Ok(guard) => guard,
            Err(error) => error.into_inner(),
        };
        match result.as_ref() {
            Ok(_) => recorder.complete_turn_success(),
            Err(error) => recorder.fail_turn(error),
        }
    };
    if let Err(error) = &terminal_events {
        let message = match result.as_ref() {
            Ok(_) => "完成 turn 时间线失败",
            Err(_) => "记录失败 turn 时间线失败",
        };
        tracing::warn!("[AsterAgent] {}（已降级继续）: {}", message, error);
    }
    if let Ok(events) = terminal_events {
        emit_runtime_events(app, event_name, events);
    }

    match result {
        Ok(assistant_output) => {
            let unsupported_stop_warning = run_runtime_stop_project_hooks_for_session_with_runtime(
                db,
                state,
                app.state::<crate::mcp::McpManagerState>().inner(),
                session_id,
                false,
                Some(assistant_output.as_str()),
            )
            .await;
            if let Some(message) = unsupported_stop_warning {
                emit_runtime_side_event(
                    app,
                    event_name,
                    timeline_recorder,
                    workspace_root,
                    RuntimeAgentEvent::Warning {
                        code: Some(STOP_HOOK_CONTINUATION_UNSUPPORTED_WARNING_CODE.to_string()),
                        message,
                    },
                );
            }
            let done_event = resolve_runtime_final_done_event(session_id, Some(db)).await;
            if let RuntimeAgentEvent::FinalDone {
                usage: Some(ref usage),
            } = done_event
            {
                if let Err(error) = persist_latest_assistant_message_usage(db, session_id, usage) {
                    tracing::warn!(
                        "[AsterAgent] 持久化消息 usage 失败（已降级继续）: {}",
                        error
                    );
                }

                if let Some(cost_state) = extract_runtime_resolution_payload::<
                    lime_agent::SessionExecutionRuntimeCostState,
                >(request_metadata, "cost_state")
                {
                    emit_runtime_side_event(
                        app,
                        event_name,
                        timeline_recorder,
                        workspace_root,
                        RuntimeAgentEvent::CostRecorded {
                            cost_state: lime_agent::apply_usage_to_cost_state(cost_state, usage),
                        },
                    );
                }
            }
            if let Err(error) = app.emit(event_name, &done_event) {
                tracing::error!("[AsterAgent] 发送完成事件失败: {}", error);
            }
            emit_subagent_status_changed_events(app, session_id).await;
            Ok(())
        }
        Err(error) => {
            if let Some(limit_event) = lime_agent::detect_runtime_limit_event(Some(&error)) {
                let event = map_runtime_limit_event_to_runtime_agent_event(limit_event);
                emit_runtime_side_event(app, event_name, timeline_recorder, workspace_root, event);
            }
            let error_event = RuntimeAgentEvent::Error {
                message: error.clone(),
            };
            if let Err(emit_error) = app.emit(event_name, &error_event) {
                tracing::error!("[AsterAgent] 发送错误事件失败: {}", emit_error);
            }
            emit_subagent_status_changed_events(app, session_id).await;
            Err(error)
        }
    }
}

async fn execute_aster_chat_request(
    app: &AppHandle,
    state: &AsterAgentState,
    db: &DbConnection,
    api_key_provider_service: &ApiKeyProviderServiceState,
    logs: &LogState,
    config_manager: &GlobalConfigManagerState,
    mcp_manager: &McpManagerState,
    automation_state: &AutomationServiceState,
    request: AsterChatRequest,
) -> Result<(), String> {
    tracing::info!(
        "[AsterAgent] 发送流式消息: session={}, event={}",
        request.session_id,
        request.event_name
    );
    emit_submit_accepted_runtime_status(app, &request.event_name);

    execute_runtime_turn_pipeline(
        app,
        state,
        db,
        api_key_provider_service,
        logs,
        config_manager,
        mcp_manager,
        automation_state,
        request,
    )
    .await
}

fn build_queued_turn_preview(message: &str) -> String {
    let compact = message.split_whitespace().collect::<Vec<_>>().join(" ");
    if compact.is_empty() {
        return "空白输入".to_string();
    }

    let preview = compact.chars().take(80).collect::<String>();
    if compact.chars().count() > 80 {
        format!("{preview}...")
    } else {
        preview
    }
}

async fn update_compaction_session_metrics(
    session_config: &aster::agents::SessionConfig,
    usage: &aster::providers::base::ProviderUsage,
) -> Result<(), String> {
    let session = read_session(&session_config.id, false, "读取会话 token 统计失败").await?;

    let update = build_compaction_session_metrics_update(&session, session_config, usage);
    persist_compaction_session_metrics_update(&session_config.id, &update).await
}

fn resolve_runtime_message_usage_from_session(
    session: &aster::session::Session,
) -> Option<lime_agent::AgentTokenUsage> {
    match (session.input_tokens, session.output_tokens) {
        (Some(input_tokens), Some(output_tokens)) if input_tokens >= 0 && output_tokens >= 0 => {
            Some(lime_agent::AgentTokenUsage {
                input_tokens: input_tokens as u32,
                output_tokens: output_tokens as u32,
                cached_input_tokens: session
                    .cached_input_tokens
                    .filter(|value| *value >= 0)
                    .map(|value| value as u32),
                cache_creation_input_tokens: session
                    .cache_creation_input_tokens
                    .filter(|value| *value >= 0)
                    .map(|value| value as u32),
            })
        }
        _ => None,
    }
}

fn resolve_runtime_message_usage_from_persisted_values(
    input_tokens: Option<i64>,
    output_tokens: Option<i64>,
    cached_input_tokens: Option<i64>,
    cache_creation_input_tokens: Option<i64>,
) -> Option<lime_agent::AgentTokenUsage> {
    match (input_tokens, output_tokens) {
        (Some(input_tokens), Some(output_tokens)) if input_tokens >= 0 && output_tokens >= 0 => {
            Some(lime_agent::AgentTokenUsage {
                input_tokens: input_tokens as u32,
                output_tokens: output_tokens as u32,
                cached_input_tokens: cached_input_tokens
                    .filter(|value| *value >= 0)
                    .map(|value| value as u32),
                cache_creation_input_tokens: cache_creation_input_tokens
                    .filter(|value| *value >= 0)
                    .map(|value| value as u32),
            })
        }
        _ => None,
    }
}

fn resolve_runtime_message_usage_from_persisted_session(
    db: &DbConnection,
    session_id: &str,
) -> Option<lime_agent::AgentTokenUsage> {
    let conn = db.lock().ok()?;
    let usage_row = conn
        .query_row(
            "SELECT input_tokens, output_tokens, cached_input_tokens, cache_creation_input_tokens
             FROM agent_sessions
             WHERE id = ?1",
            [session_id],
            |row| {
                Ok((
                    row.get::<_, Option<i64>>(0)?,
                    row.get::<_, Option<i64>>(1)?,
                    row.get::<_, Option<i64>>(2)?,
                    row.get::<_, Option<i64>>(3)?,
                ))
            },
        )
        .ok()?;

    resolve_runtime_message_usage_from_persisted_values(
        usage_row.0,
        usage_row.1,
        usage_row.2,
        usage_row.3,
    )
}

async fn resolve_runtime_message_usage(
    session_id: &str,
    db: Option<&DbConnection>,
) -> Option<lime_agent::AgentTokenUsage> {
    if let Ok(session) = read_session(session_id, false, "读取会话 token 统计失败").await {
        if let Some(usage) = resolve_runtime_message_usage_from_session(&session) {
            return Some(usage);
        }
    }

    db.and_then(|value| resolve_runtime_message_usage_from_persisted_session(value, session_id))
}

async fn resolve_runtime_final_done_event(
    session_id: &str,
    db: Option<&DbConnection>,
) -> RuntimeAgentEvent {
    RuntimeAgentEvent::FinalDone {
        usage: resolve_runtime_message_usage(session_id, db).await,
    }
}

fn persist_latest_assistant_message_usage(
    db: &DbConnection,
    session_id: &str,
    usage: &lime_agent::AgentTokenUsage,
) -> Result<(), String> {
    let conn = db
        .lock()
        .map_err(|error| format!("更新消息 usage 时数据库锁定失败: {error}"))?;
    lime_core::database::agent_session_repository::update_latest_assistant_message_usage(
        &conn,
        session_id,
        usage.input_tokens,
        usage.output_tokens,
        usage.cached_input_tokens,
        usage.cache_creation_input_tokens,
    )?;
    Ok(())
}

fn build_compaction_session_metrics_update(
    session: &aster::session::Session,
    session_config: &aster::agents::SessionConfig,
    usage: &aster::providers::base::ProviderUsage,
) -> CompactionSessionMetricsUpdate {
    let schedule_id = session_config
        .schedule_id
        .clone()
        .or(session.schedule_id.clone());

    let accumulate = |current: Option<i32>, delta: Option<i32>| match (current, delta) {
        (Some(lhs), Some(rhs)) => Some(lhs + rhs),
        _ => current.or(delta),
    };

    let accumulated_total = accumulate(session.accumulated_total_tokens, usage.usage.total_tokens);
    let accumulated_input = accumulate(session.accumulated_input_tokens, usage.usage.input_tokens);
    let accumulated_output =
        accumulate(session.accumulated_output_tokens, usage.usage.output_tokens);
    let cached_input_tokens = if usage.usage.output_tokens.is_some() {
        usage.usage.cached_input_tokens
    } else {
        Some(0)
    };
    let cache_creation_input_tokens = if usage.usage.output_tokens.is_some() {
        usage.usage.cache_creation_input_tokens
    } else {
        Some(0)
    };

    let current_window_tokens = usage
        .usage
        .output_tokens
        .or(usage.usage.total_tokens)
        .unwrap_or(0);

    CompactionSessionMetricsUpdate {
        schedule_id,
        current_window_tokens,
        cached_input_tokens,
        cache_creation_input_tokens,
        accumulated_total_tokens: accumulated_total,
        accumulated_input_tokens: accumulated_input,
        accumulated_output_tokens: accumulated_output,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RuntimeSessionCompactionTrigger {
    Manual,
    Auto,
}

impl RuntimeSessionCompactionTrigger {
    fn as_str(self) -> &'static str {
        match self {
            Self::Manual => "manual",
            Self::Auto => "auto",
        }
    }

    fn start_detail(self) -> &'static str {
        match self {
            Self::Manual => "系统正在将较早消息整理为摘要，以释放上下文窗口。",
            Self::Auto => "检测到会话历史已接近上限，系统正在自动整理较早消息以释放上下文窗口。",
        }
    }

    fn completed_detail(self) -> &'static str {
        match self {
            Self::Manual => "较早消息已替换为摘要，后续回复会基于压缩后的上下文继续。",
            Self::Auto => "较早消息已自动替换为摘要，本轮回复会基于压缩后的上下文继续。",
        }
    }
}

fn resolve_pre_compact_hook_trigger(trigger: RuntimeSessionCompactionTrigger) -> CompactTrigger {
    match trigger {
        RuntimeSessionCompactionTrigger::Manual => CompactTrigger::Manual,
        RuntimeSessionCompactionTrigger::Auto => CompactTrigger::Auto,
    }
}

fn build_auto_context_compaction_event_name(session_id: &str) -> String {
    format!(
        "{AUTO_CONTEXT_COMPACTION_EVENT_PREFIX}_{session_id}_{}",
        Uuid::new_v4()
    )
}

async fn ensure_compaction_agent_initialized(
    state: &AsterAgentState,
    db: &DbConnection,
) -> Result<(), String> {
    state.init_agent_with_db(db).await
}

fn resolve_context_compaction_conversation<'a>(
    session: &'a aster::session::Session,
) -> Result<Option<&'a aster::conversation::Conversation>, String> {
    let conversation = session
        .conversation
        .as_ref()
        .ok_or_else(|| "当前会话上下文尚未准备完成，请稍后再试".to_string())?;
    if session.message_count < 2 || conversation.messages().len() < 2 {
        return Ok(None);
    }
    Ok(Some(conversation))
}

fn resolve_pre_compact_current_tokens(session: &aster::session::Session) -> Option<u64> {
    session
        .total_tokens
        .and_then(|value| u64::try_from(value).ok())
        .or_else(|| {
            session.conversation.as_ref().map(|conversation| {
                aster::context::TokenEstimator::estimate_total_tokens(conversation.messages())
                    as u64
            })
        })
}

fn emit_context_compaction_skip(app: &AppHandle, event_name: &str, message: &str) {
    let warning_event = RuntimeAgentEvent::Warning {
        code: Some(CONTEXT_COMPACTION_NOT_NEEDED_WARNING_CODE.to_string()),
        message: message.to_string(),
    };
    if let Err(error) = app.emit(event_name, &warning_event) {
        tracing::warn!("[AsterAgent] 发送压缩跳过提醒失败: {}", error);
    }

    let done_event = RuntimeAgentEvent::FinalDone { usage: None };
    if let Err(error) = app.emit(event_name, &done_event) {
        tracing::warn!("[AsterAgent] 发送压缩跳过完成事件失败: {}", error);
    }
}

fn build_runtime_compaction_session_config(
    session_id: &str,
    thread_id: &str,
    turn_id: &str,
    turn_context: Option<TurnContextOverride>,
) -> aster::agents::types::SessionConfig {
    // 压缩控制回合只需要稳定 thread/turn 锚点来写时间线和 session metrics；
    // 它不会走常规 turn prompt / tool / turn_context 组包链，避免再造第二份输入真相。
    let mut session_config_builder = SessionConfigBuilder::new(session_id)
        .thread_id(thread_id.to_string())
        .turn_id(turn_id.to_string());
    if let Some(turn_context) = turn_context {
        session_config_builder = session_config_builder.turn_context(turn_context);
    }
    session_config_builder.build()
}

fn build_history_compaction_runtime_metadata(
    trigger: RuntimeSessionCompactionTrigger,
    resolution: &AuxiliaryProviderResolution,
) -> Option<serde_json::Value> {
    build_auxiliary_runtime_metadata(
        resolution,
        &format!("context_compaction_{}", trigger.as_str()),
        Some(trigger.as_str()),
        &["service_model_slot", "internal_turn"],
        &["当前为内部辅助任务，运行时只会使用一条已解析的 provider/model 路线。"],
    )
}

async fn should_auto_compact_runtime_session(
    provider: &dyn aster::providers::base::Provider,
    session: &aster::session::Session,
    workspace_settings: &WorkspaceSettings,
    threshold_override: Option<f64>,
) -> Result<bool, String> {
    if !workspace_settings.auto_compact {
        return Ok(false);
    }

    let Some(conversation) = session.conversation.as_ref() else {
        return Ok(false);
    };
    if session.message_count < 2 || conversation.messages().len() < 2 {
        return Ok(false);
    }

    aster::context_mgmt::check_if_compaction_needed(
        provider,
        conversation,
        threshold_override,
        session,
    )
    .await
    .map_err(|error| format!("检查自动压缩阈值失败: {error}"))
}

async fn maybe_auto_compact_runtime_session_before_turn(
    app: &AppHandle,
    state: &AsterAgentState,
    db: &DbConnection,
    config_manager: &GlobalConfigManagerState,
    session_id: &str,
    request_event_name: &str,
    workspace_settings: &WorkspaceSettings,
) -> Result<(), String> {
    let session = read_session(session_id, true, "读取自动压缩会话失败").await?;
    let provider_scope = prepare_auxiliary_provider_scope(
        state,
        db,
        config_manager,
        session_id,
        AuxiliaryServiceModelSlot::HistoryCompress,
        &COMPACTION_FALLBACK_PROVIDER_CHAIN,
    )
    .await?;
    let should_compact_result = async {
        let agent_arc = state.get_agent_arc();
        let guard = agent_arc.read().await;
        let agent = guard.as_ref().ok_or("Agent not initialized")?;
        let provider = agent
            .provider()
            .await
            .map_err(|error| format!("读取自动压缩 provider 失败: {error}"))?;
        should_auto_compact_runtime_session(provider.as_ref(), &session, workspace_settings, None)
            .await
    }
    .await;
    provider_scope.restore(state, db).await;

    if !should_compact_result? {
        return Ok(());
    }

    let auto_event_name = build_auto_context_compaction_event_name(session_id);
    if let Err(error) = compact_runtime_session_with_trigger(
        app,
        state,
        db,
        config_manager,
        session_id.to_string(),
        auto_event_name,
        RuntimeSessionCompactionTrigger::Auto,
    )
    .await
    {
        tracing::warn!(
            "[AsterAgent] 自动压缩上下文失败，已降级继续当前 turn: session_id={}, error={}",
            session_id,
            error
        );
        let warning_event = RuntimeAgentEvent::Warning {
            code: Some(AUTO_CONTEXT_COMPACTION_FAILED_WARNING_CODE.to_string()),
            message: format!("自动压缩上下文失败，已继续当前请求：{error}"),
        };
        if let Err(emit_error) = app.emit(request_event_name, &warning_event) {
            tracing::warn!("[AsterAgent] 发送自动压缩失败提醒失败: {}", emit_error);
        }
    }

    Ok(())
}

async fn compact_runtime_session_with_trigger(
    app: &AppHandle,
    state: &AsterAgentState,
    db: &DbConnection,
    config_manager: &GlobalConfigManagerState,
    session_id: String,
    event_name: String,
    trigger: RuntimeSessionCompactionTrigger,
) -> Result<(), String> {
    ensure_compaction_agent_initialized(state, db).await?;

    let session = read_session(&session_id, true, "读取会话失败").await?;
    let Some(conversation) = resolve_context_compaction_conversation(&session)? else {
        if trigger == RuntimeSessionCompactionTrigger::Manual {
            emit_context_compaction_skip(app, &event_name, "当前会话还没有足够的历史可压缩");
        }
        return Ok(());
    };
    let pre_compact_current_tokens = resolve_pre_compact_current_tokens(&session);
    enforce_runtime_pre_compact_project_hooks_for_session_with_runtime(
        db,
        state,
        app.state::<crate::mcp::McpManagerState>().inner(),
        &session_id,
        pre_compact_current_tokens,
        resolve_pre_compact_hook_trigger(trigger),
    )
    .await?;
    let provider_scope = prepare_auxiliary_provider_scope(
        state,
        db,
        config_manager,
        &session_id,
        AuxiliaryServiceModelSlot::HistoryCompress,
        &COMPACTION_FALLBACK_PROVIDER_CHAIN,
    )
    .await?;

    let cancel_token = state.create_cancel_token(&session_id).await;
    let agent_arc = state.get_agent_arc();

    let runtime_snapshot = {
        let guard = agent_arc.read().await;
        let agent = guard.as_ref().ok_or("Agent not initialized")?;
        match agent.runtime_snapshot(&session_id).await {
            Ok(snapshot) => Some(snapshot),
            Err(error) => {
                tracing::warn!(
                    "[AsterAgent] 压缩上下文前读取 runtime snapshot 失败，继续使用 session 默认线程: session_id={}, error={}",
                    session_id,
                    error
                );
                None
            }
        }
    };
    let runtime_projection_snapshot =
        RuntimeProjectionSnapshot::from_snapshot(&session_id, runtime_snapshot.as_ref());
    let resolved_thread_id = runtime_projection_snapshot
        .primary_thread_id()
        .map(str::to_string)
        .unwrap_or_else(|| session_id.clone());
    let resolved_turn_id = Uuid::new_v4().to_string();
    let timeline_recorder = Arc::new(Mutex::new(AgentTimelineRecorder::create(
        db.clone(),
        resolved_thread_id.clone(),
        resolved_turn_id.clone(),
        "压缩上下文",
    )?));
    let compaction_request_metadata =
        build_history_compaction_runtime_metadata(trigger, provider_scope.resolution());
    let compaction_side_events =
        collect_runtime_request_resolution_side_events(compaction_request_metadata.as_ref());
    let session_config = build_runtime_compaction_session_config(
        &session_id,
        &resolved_thread_id,
        &resolved_turn_id,
        build_auxiliary_turn_context_override(compaction_request_metadata),
    );

    let final_result: Result<(), String> = {
        let guard = agent_arc.read().await;
        let agent = guard.as_ref().ok_or("Agent not initialized")?;
        let turn = agent
            .ensure_runtime_turn_initialized(&session_config, Some("压缩上下文".to_string()))
            .await
            .map_err(|error| format!("初始化压缩 turn 失败: {error}"))?;
        for event in lime_agent::project_runtime_event(AgentEvent::TurnStarted { turn }) {
            {
                let mut recorder = match timeline_recorder.lock() {
                    Ok(guard) => guard,
                    Err(error) => error.into_inner(),
                };
                if let Err(error) = recorder.record_runtime_event(app, &event_name, &event, "") {
                    tracing::warn!(
                        "[AsterAgent] 记录压缩时间线事件失败（已降级继续）: {}",
                        error
                    );
                }
            }
            if let Err(error) = app.emit(&event_name, &event) {
                tracing::error!("[AsterAgent] 发送压缩事件失败: {}", error);
            }
        }

        for event in compaction_side_events.iter().cloned() {
            {
                let mut recorder = match timeline_recorder.lock() {
                    Ok(guard) => guard,
                    Err(error) => error.into_inner(),
                };
                if let Err(error) = recorder.record_runtime_event(app, &event_name, &event, "") {
                    tracing::warn!(
                        "[AsterAgent] 记录压缩路由时间线事件失败（已降级继续）: {}",
                        error
                    );
                }
            }
            if let Err(error) = app.emit(&event_name, &event) {
                tracing::error!("[AsterAgent] 发送压缩路由事件失败: {}", error);
            }
        }

        let compaction_turn_id = session_config
            .turn_id
            .clone()
            .unwrap_or_else(|| session_id.clone());
        let compaction_item_id = format!("context_compaction:{compaction_turn_id}");
        let start_event = RuntimeAgentEvent::ContextCompactionStarted {
            item_id: compaction_item_id.clone(),
            trigger: trigger.as_str().to_string(),
            detail: Some(trigger.start_detail().to_string()),
        };
        {
            let mut recorder = match timeline_recorder.lock() {
                Ok(guard) => guard,
                Err(error) => error.into_inner(),
            };
            if let Err(error) = recorder.record_runtime_event(app, &event_name, &start_event, "") {
                tracing::warn!(
                    "[AsterAgent] 记录压缩开始时间线失败（已降级继续）: {}",
                    error
                );
            }
        }
        if let Err(error) = app.emit(&event_name, &start_event) {
            tracing::error!("[AsterAgent] 发送压缩开始事件失败: {}", error);
        }

        let provider = agent
            .provider()
            .await
            .map_err(|error| format!("读取 provider 失败: {error}"))?;
        let (compacted_conversation, usage) =
            aster::context_mgmt::compact_messages(provider.as_ref(), conversation, true)
                .await
                .map_err(|error| format!("压缩上下文失败: {error}"))?;
        replace_session_conversation(&session_id, &compacted_conversation, "写回压缩后的会话")
            .await?;
        update_compaction_session_metrics(&session_config, &usage).await?;

        let completed_event = RuntimeAgentEvent::ContextCompactionCompleted {
            item_id: compaction_item_id,
            trigger: trigger.as_str().to_string(),
            detail: Some(trigger.completed_detail().to_string()),
        };
        {
            let mut recorder = match timeline_recorder.lock() {
                Ok(guard) => guard,
                Err(error) => error.into_inner(),
            };
            if let Err(error) =
                recorder.record_runtime_event(app, &event_name, &completed_event, "")
            {
                tracing::warn!(
                    "[AsterAgent] 记录压缩完成时间线失败（已降级继续）: {}",
                    error
                );
            }
        }
        if let Err(error) = app.emit(&event_name, &completed_event) {
            tracing::error!("[AsterAgent] 发送压缩完成事件失败: {}", error);
        }

        Ok(())
    };

    provider_scope.restore(state, db).await;

    match final_result {
        Ok(()) => {
            let terminal_events = {
                let mut recorder = match timeline_recorder.lock() {
                    Ok(guard) => guard,
                    Err(error) => error.into_inner(),
                };
                recorder.complete_turn_success()
            };
            if let Err(error) = &terminal_events {
                tracing::warn!(
                    "[AsterAgent] 完成压缩 turn 时间线失败（已降级继续）: {}",
                    error
                );
            }
            if let Ok(events) = terminal_events {
                emit_runtime_events(app, &event_name, events);
            }
            run_runtime_session_start_project_hooks_for_session_with_runtime(
                db,
                state,
                app.state::<crate::mcp::McpManagerState>().inner(),
                &session_id,
                SessionSource::Compact,
            )
            .await;
            let done_event = resolve_runtime_final_done_event(&session_id, None).await;
            if let Err(error) = app.emit(&event_name, &done_event) {
                tracing::error!("[AsterAgent] 发送压缩完成事件失败: {}", error);
            }
        }
        Err(error) => {
            let terminal_events = {
                let mut recorder = match timeline_recorder.lock() {
                    Ok(guard) => guard,
                    Err(error) => error.into_inner(),
                };
                recorder.fail_turn(&error)
            };
            {
                if let Err(timeline_error) = &terminal_events {
                    tracing::warn!(
                        "[AsterAgent] 记录压缩失败 turn 时间线失败（已降级继续）: {}",
                        timeline_error
                    );
                }
            }
            if let Ok(events) = terminal_events {
                emit_runtime_events(app, &event_name, events);
            }
            let error_event = RuntimeAgentEvent::Error {
                message: error.clone(),
            };
            if let Err(emit_error) = app.emit(&event_name, &error_event) {
                tracing::error!("[AsterAgent] 发送压缩错误事件失败: {}", emit_error);
            }
            state.remove_cancel_token(&session_id).await;
            return Err(error);
        }
    }

    drop(cancel_token);
    state.remove_cancel_token(&session_id).await;
    Ok(())
}

pub(crate) async fn compact_runtime_session_internal(
    app: &AppHandle,
    state: &AsterAgentState,
    db: &DbConnection,
    config_manager: &GlobalConfigManagerState,
    request: AgentRuntimeCompactSessionRequest,
) -> Result<(), String> {
    let session_id = normalize_required_text(&request.session_id, "session_id")?;
    let event_name = normalize_required_text(&request.event_name, "event_name")?;
    compact_runtime_session_with_trigger(
        app,
        state,
        db,
        config_manager,
        session_id,
        event_name,
        RuntimeSessionCompactionTrigger::Manual,
    )
    .await
}

fn extract_subagent_parent_session_id(metadata: Option<&serde_json::Value>) -> Option<String> {
    metadata
        .and_then(|value| value.get("subagent"))
        .and_then(serde_json::Value::as_object)
        .and_then(|subagent| {
            subagent
                .get("parent_session_id")
                .or_else(|| subagent.get("parentSessionId"))
        })
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

async fn resolve_team_runtime_provider_group_for_request(request: &AsterChatRequest) -> String {
    if let Some(provider_config) = request.provider_config.as_ref() {
        if let Some(provider_selector) = provider_config
            .provider_id
            .as_deref()
            .filter(|value| !value.trim().is_empty())
        {
            return normalize_team_runtime_provider_group(provider_selector);
        }
        return normalize_team_runtime_provider_group(&provider_config.provider_name);
    }

    match read_session(&request.session_id, false, "读取 provider 会话上下文失败").await {
        Ok(session) => {
            let provider_selector = resolve_session_provider_selector(&session)
                .or_else(|| normalize_optional_text(session.provider_name.clone()));
            provider_selector
                .map(|value| normalize_team_runtime_provider_group(&value))
                .unwrap_or_else(|| "default".to_string())
        }
        Err(_) => "default".to_string(),
    }
}

fn should_apply_provider_runtime_guard(provider_group: &str) -> bool {
    resolve_provider_runtime_parallel_budget(provider_group).is_some()
}

fn build_provider_runtime_guard_lease_id(request: &AsterChatRequest) -> String {
    format!("provider-runtime-guard:{}", request.session_id)
}

fn build_provider_runtime_status_metadata(
    snapshot: &ProviderRuntimeGovernorSnapshot,
) -> std::collections::HashMap<String, serde_json::Value> {
    let mut metadata = std::collections::HashMap::new();
    metadata.insert(
        "concurrency_phase".to_string(),
        serde_json::Value::String(snapshot.provider_phase.clone()),
    );
    metadata.insert(
        "concurrency_scope".to_string(),
        serde_json::Value::String("provider_global".to_string()),
    );
    metadata.insert(
        "concurrency_active_count".to_string(),
        serde_json::Value::Number(snapshot.provider_active_count.into()),
    );
    metadata.insert(
        "concurrency_queued_count".to_string(),
        serde_json::Value::Number(snapshot.provider_queued_count.into()),
    );
    metadata.insert(
        "concurrency_budget".to_string(),
        serde_json::Value::Number(snapshot.provider_parallel_budget.into()),
    );
    metadata.insert(
        "provider_concurrency_group".to_string(),
        serde_json::Value::String(snapshot.provider_concurrency_group.clone()),
    );
    metadata.insert(
        "provider_parallel_budget".to_string(),
        serde_json::Value::Number(snapshot.provider_parallel_budget.into()),
    );
    if let Some(queue_reason) = snapshot.queue_reason.as_ref() {
        metadata.insert(
            "queue_reason".to_string(),
            serde_json::Value::String(queue_reason.clone()),
        );
    }
    metadata.insert(
        "retryable_overload".to_string(),
        serde_json::Value::Bool(snapshot.retryable_overload),
    );
    metadata
}

fn build_provider_waiting_runtime_status(
    snapshot: &ProviderRuntimeGovernorSnapshot,
    is_team_member: bool,
) -> AgentRuntimeStatus {
    let target_label = if is_team_member {
        "这位协作成员"
    } else {
        "这条请求"
    };
    let mut checkpoints = vec![format!(
        "当前服务仅同时处理 {} 条此类请求",
        snapshot.provider_parallel_budget
    )];
    if snapshot.provider_active_count > 0 {
        checkpoints.push(format!(
            "前面还有 {} 条请求正在处理",
            snapshot.provider_active_count
        ));
    }
    if snapshot.provider_queued_count > 0 {
        checkpoints.push(format!(
            "还有 {} 条请求在等待顺序处理",
            snapshot.provider_queued_count
        ));
    }

    AgentRuntimeStatus {
        phase: "routing".to_string(),
        title: "当前服务较忙，稍后开始处理".to_string(),
        detail: snapshot
            .queue_reason
            .clone()
            .unwrap_or_else(|| format!("为了保证稳定性，{target_label}会在前一项完成后自动继续。")),
        checkpoints,
        metadata: Some(build_provider_runtime_status_metadata(snapshot)),
    }
}

fn build_provider_running_runtime_status(
    snapshot: &ProviderRuntimeGovernorSnapshot,
    is_team_member: bool,
) -> AgentRuntimeStatus {
    let detail = if is_team_member {
        "已轮到这位协作成员，系统会按更稳妥的节奏继续处理。".to_string()
    } else {
        "已轮到这条请求，系统会按更稳妥的节奏开始处理。".to_string()
    };

    AgentRuntimeStatus {
        phase: "routing".to_string(),
        title: if is_team_member {
            "协作成员开始处理".to_string()
        } else {
            "开始处理这条请求".to_string()
        },
        detail,
        checkpoints: vec![
            format!("当前服务同时处理上限 {}", snapshot.provider_parallel_budget),
            "系统会继续保持稳妥处理，尽量避免直接失败".to_string(),
        ],
        metadata: Some(build_provider_runtime_status_metadata(snapshot)),
    }
}

fn build_team_runtime_status_metadata(
    snapshot: &TeamRuntimeGovernorSnapshot,
) -> std::collections::HashMap<String, serde_json::Value> {
    let mut metadata = std::collections::HashMap::new();
    metadata.insert(
        "team_phase".to_string(),
        serde_json::Value::String(snapshot.team_phase.clone()),
    );
    metadata.insert(
        "team_parallel_budget".to_string(),
        serde_json::Value::Number(snapshot.team_parallel_budget.into()),
    );
    metadata.insert(
        "team_active_count".to_string(),
        serde_json::Value::Number(snapshot.team_active_count.into()),
    );
    metadata.insert(
        "team_queued_count".to_string(),
        serde_json::Value::Number(snapshot.team_queued_count.into()),
    );
    metadata.insert(
        "provider_concurrency_group".to_string(),
        serde_json::Value::String(snapshot.provider_concurrency_group.clone()),
    );
    metadata.insert(
        "provider_parallel_budget".to_string(),
        serde_json::Value::Number(snapshot.provider_parallel_budget.into()),
    );
    if let Some(queue_reason) = snapshot.queue_reason.as_ref() {
        metadata.insert(
            "queue_reason".to_string(),
            serde_json::Value::String(queue_reason.clone()),
        );
    }
    metadata.insert(
        "retryable_overload".to_string(),
        serde_json::Value::Bool(snapshot.retryable_overload),
    );
    metadata
}

fn build_team_waiting_runtime_status(snapshot: &TeamRuntimeGovernorSnapshot) -> AgentRuntimeStatus {
    let mut checkpoints = vec![format!(
        "当前已有 {}/{} 位协作成员在处理",
        snapshot.team_active_count, snapshot.team_parallel_budget
    )];
    if snapshot.team_queued_count > 0 {
        checkpoints.push(format!(
            "还有 {} 位协作成员在等待执行",
            snapshot.team_queued_count
        ));
    }
    if snapshot.provider_parallel_budget == 1 {
        checkpoints.push("当前服务较忙，已切换为更稳妥的顺序处理".to_string());
    }

    AgentRuntimeStatus {
        phase: "routing".to_string(),
        title: "等待执行窗口".to_string(),
        detail: snapshot
            .queue_reason
            .clone()
            .unwrap_or_else(|| "系统正在安排可用的处理窗口，稍后会自动继续。".to_string()),
        checkpoints,
        metadata: Some(build_team_runtime_status_metadata(snapshot)),
    }
}

fn build_team_running_runtime_status(snapshot: &TeamRuntimeGovernorSnapshot) -> AgentRuntimeStatus {
    let mut checkpoints = vec![format!(
        "当前并发预算 {}/{}",
        snapshot.team_active_count, snapshot.team_parallel_budget
    )];
    if snapshot.provider_parallel_budget == 1 {
        checkpoints.push("当前服务使用稳妥处理模式".to_string());
    }

    AgentRuntimeStatus {
        phase: "routing".to_string(),
        title: "开始处理".to_string(),
        detail: "已获得可用执行窗口，这位协作成员正在接手当前任务。".to_string(),
        checkpoints,
        metadata: Some(build_team_runtime_status_metadata(snapshot)),
    }
}

fn emit_transient_runtime_status(app: &AppHandle, event_name: &str, status: AgentRuntimeStatus) {
    if event_name.trim().is_empty() {
        return;
    }
    let event = RuntimeAgentEvent::RuntimeStatus { status };
    if let Err(error) = app.emit(event_name, &event) {
        tracing::warn!(
            "[AsterAgent] 发送 team runtime 状态失败: event_name={}, error={}",
            event_name,
            error
        );
    }
}

async fn execute_queued_request_with_team_runtime_governor(
    context: &crate::agent::runtime_queue_service::AgentRuntimeQueueContext,
    request: AsterChatRequest,
) -> Result<(), String> {
    let request_session_id = request.session_id.clone();
    let provider_group = resolve_team_runtime_provider_group_for_request(&request).await;
    let parent_session_id = extract_subagent_parent_session_id(request.metadata.as_ref());
    let is_team_member = parent_session_id.is_some();
    let provider_guard_lease_id = build_provider_runtime_guard_lease_id(&request);
    let provider_guard_permit = if should_apply_provider_runtime_guard(&provider_group) {
        if let Some(waiting_snapshot) =
            preview_provider_runtime_wait_snapshot(&provider_group).await
        {
            emit_transient_runtime_status(
                &context.app,
                &request.event_name,
                build_provider_waiting_runtime_status(&waiting_snapshot, is_team_member),
            );
            if is_team_member {
                emit_subagent_status_changed_events(&context.app, &request_session_id).await;
            }
        }

        let permit = acquire_provider_runtime_permit(
            provider_guard_lease_id.clone(),
            provider_group.clone(),
        )
        .await;
        if let Some(running_snapshot) =
            snapshot_provider_runtime_lease(&provider_guard_lease_id).await
        {
            emit_transient_runtime_status(
                &context.app,
                &request.event_name,
                build_provider_running_runtime_status(&running_snapshot, is_team_member),
            );
        }
        if is_team_member {
            emit_subagent_status_changed_events(&context.app, &request_session_id).await;
        }
        Some(permit)
    } else {
        None
    };

    let result = if let Some(parent_session_id) = parent_session_id {
        if let Some(waiting_snapshot) =
            preview_team_runtime_wait_snapshot(&parent_session_id, &provider_group).await
        {
            emit_transient_runtime_status(
                &context.app,
                &request.event_name,
                build_team_waiting_runtime_status(&waiting_snapshot),
            );
            emit_subagent_status_changed_events(&context.app, &request_session_id).await;
        }

        let permit = acquire_team_runtime_permit(
            request_session_id.clone(),
            parent_session_id,
            provider_group,
        )
        .await;
        if let Some(running_snapshot) = snapshot_team_runtime_session(&request_session_id).await {
            emit_transient_runtime_status(
                &context.app,
                &request.event_name,
                build_team_running_runtime_status(&running_snapshot),
            );
        }
        emit_subagent_status_changed_events(&context.app, &request_session_id).await;

        let result = execute_aster_chat_request(
            &context.app,
            &context.state,
            &context.db,
            &context.api_key_provider_service,
            &context.logs,
            &context.config_manager,
            &context.mcp_manager,
            &context.automation_state,
            request.clone(),
        )
        .await;

        release_team_runtime_permit(permit).await;
        emit_subagent_status_changed_events(&context.app, &request_session_id).await;
        result
    } else {
        execute_aster_chat_request(
            &context.app,
            &context.state,
            &context.db,
            &context.api_key_provider_service,
            &context.logs,
            &context.config_manager,
            &context.mcp_manager,
            &context.automation_state,
            request,
        )
        .await
    };

    if let Some(permit) = provider_guard_permit {
        release_provider_runtime_permit(permit).await;
        if is_team_member {
            emit_subagent_status_changed_events(&context.app, &request_session_id).await;
        }
    }
    result
}

pub(crate) fn build_queued_turn_task(
    mut request: AsterChatRequest,
) -> Result<QueuedTurnTask<serde_json::Value>, String> {
    let queued_turn_id = request
        .queued_turn_id
        .clone()
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    request.queued_turn_id = Some(queued_turn_id.clone());

    let image_count = request
        .images
        .as_ref()
        .map(|images| images.len())
        .unwrap_or(0);
    let payload =
        serde_json::to_value(&request).map_err(|e| format!("序列化排队 turn 失败: {e}"))?;

    Ok(QueuedTurnTask {
        queued_turn_id,
        session_id: request.session_id.clone(),
        event_name: request.event_name.clone(),
        message_preview: build_queued_turn_preview(&request.message),
        message_text: request.message.clone(),
        created_at: chrono::Utc::now().timestamp_millis(),
        image_count,
        payload,
    })
}

fn deserialize_queued_turn_request(payload: serde_json::Value) -> Result<AsterChatRequest, String> {
    serde_json::from_value(payload).map_err(|e| format!("反序列化排队 turn 失败: {e}"))
}

pub(crate) fn build_runtime_queue_executor() -> RuntimeQueueExecutor {
    Arc::new(|context, payload| {
        async move {
            let request = deserialize_queued_turn_request(payload)?;
            execute_queued_request_with_team_runtime_governor(&context, request).await
        }
        .boxed()
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tests::runtime_test_support::shared_aster_runtime_test_root;
    use aster::conversation::message::Message;
    use aster::model::ModelConfig;
    use aster::providers::base::{Provider, ProviderMetadata, ProviderUsage, Usage};
    use aster::providers::errors::ProviderError;
    use aster::session::{
        delete_managed_session, initialize_shared_session_runtime_with_root,
        is_global_session_store_set, SessionManager, SessionType,
    };
    use async_trait::async_trait;
    use chrono::Utc;
    use lime_core::database::schema::create_tables;
    use lime_services::aster_session_store::LimeSessionStore;
    use rmcp::model::Tool;
    use rusqlite::Connection;
    use serde_json::{json, Value};
    use std::fs;
    use tokio::sync::OnceCell;

    async fn ensure_runtime_turn_test_session_manager() {
        static INIT: OnceCell<()> = OnceCell::const_new();

        INIT.get_or_init(|| async {
            if is_global_session_store_set() {
                return;
            }

            let conn = Connection::open_in_memory().expect("创建内存数据库失败");
            create_tables(&conn).expect("初始化表结构失败");

            let runtime_root = shared_aster_runtime_test_root();
            fs::create_dir_all(&runtime_root).expect("创建 runtime 测试目录失败");

            let session_store = Arc::new(LimeSessionStore::new(Arc::new(Mutex::new(conn))));
            initialize_shared_session_runtime_with_root(runtime_root, Some(session_store))
                .await
                .expect("初始化测试 session manager 失败");
        })
        .await;
    }

    fn build_runtime_turn_test_request(message: &str, metadata: Option<Value>) -> AsterChatRequest {
        AsterChatRequest {
            message: message.to_string(),
            session_id: "session-test".to_string(),
            event_name: "agent_stream".to_string(),
            images: None,
            provider_config: None,
            provider_preference: None,
            model_preference: None,
            thinking_enabled: None,
            approval_policy: None,
            sandbox_policy: None,
            project_id: None,
            workspace_id: "workspace-test".to_string(),
            web_search: None,
            search_mode: None,
            execution_strategy: None,
            auto_continue: None,
            system_prompt: None,
            metadata,
            turn_id: None,
            queue_if_busy: None,
            queued_turn_id: None,
        }
    }

    #[derive(Clone)]
    struct AutoCompactThresholdTestProvider {
        context_limit: Option<usize>,
    }

    impl AutoCompactThresholdTestProvider {
        fn new(context_limit: Option<usize>) -> Self {
            Self { context_limit }
        }
    }

    #[async_trait]
    impl Provider for AutoCompactThresholdTestProvider {
        fn metadata() -> ProviderMetadata {
            ProviderMetadata::new(
                "auto-compact-threshold-test",
                "Auto Compact Threshold Test",
                "用于测试自动压缩阈值判断的 provider",
                "auto-compact-threshold-test-model",
                vec!["auto-compact-threshold-test-model"],
                "",
                vec![],
            )
        }

        fn get_name(&self) -> &str {
            "auto-compact-threshold-test"
        }

        async fn complete_with_model(
            &self,
            _model_config: &ModelConfig,
            _system: &str,
            _messages: &[Message],
            _tools: &[Tool],
        ) -> Result<(Message, ProviderUsage), ProviderError> {
            Err(ProviderError::ExecutionError(
                "测试不应调用 complete_with_model".to_string(),
            ))
        }

        fn get_model_config(&self) -> ModelConfig {
            ModelConfig {
                model_name: "auto-compact-threshold-test-model".to_string(),
                context_limit: self.context_limit,
                temperature: None,
                max_tokens: None,
                toolshim: false,
                toolshim_model: None,
                fast_model: None,
            }
        }
    }

    fn build_auto_compaction_test_session(total_tokens: Option<i32>) -> aster::session::Session {
        let conversation = aster::conversation::Conversation::new_unvalidated(vec![
            Message::user().with_text("第一条用户消息"),
            Message::assistant().with_text("第一条助手回复"),
        ]);

        aster::session::Session {
            conversation: Some(conversation),
            message_count: 2,
            total_tokens,
            ..aster::session::Session::default()
        }
    }

    fn write_blocking_user_prompt_submit_hook(workspace_root: &std::path::Path, message: &str) {
        let claude_dir = workspace_root.join(".claude");
        fs::create_dir_all(&claude_dir).expect("创建 .claude 目录失败");

        let blocking_payload = serde_json::json!({
            "blocked": true,
            "message": message,
        })
        .to_string();
        let settings = serde_json::json!({
            "hooks": {
                "UserPromptSubmit": [
                    {
                        "type": "command",
                        "command": format!("printf '%s' '{blocking_payload}'; exit 2"),
                        "blocking": true,
                    }
                ]
            }
        });
        fs::write(
            claude_dir.join("settings.json"),
            serde_json::to_string_pretty(&settings).expect("序列化 settings 失败"),
        )
        .expect("写入 settings.json 失败");
    }

    #[test]
    fn resolve_turn_execution_profile_should_use_fast_chat_for_plain_general_message() {
        let request = build_runtime_turn_test_request(
            "你好",
            Some(json!({
                "harness": {
                    "theme": "general",
                    "chat_mode": "general",
                    "session_mode": "general_workbench"
                }
            })),
        );
        let policy = lime_agent::resolve_request_tool_policy(Some(false), false);

        assert_eq!(
            resolve_turn_execution_profile(&request, RuntimeChatMode::General, &policy, false,),
            TurnExecutionProfile::FastChat
        );
    }

    #[test]
    fn resolve_turn_execution_profile_should_keep_fast_chat_for_default_browser_assist_hint() {
        let request = build_runtime_turn_test_request(
            "你好",
            Some(json!({
                "harness": {
                    "theme": "general",
                    "chat_mode": "general",
                    "browser_assist": {
                        "enabled": true,
                        "profile_key": "general_browser_assist",
                        "auto_launch": true,
                        "stream_mode": "both"
                    }
                }
            })),
        );
        let policy = lime_agent::resolve_request_tool_policy(Some(false), false);

        assert_eq!(
            resolve_turn_execution_profile(&request, RuntimeChatMode::General, &policy, false,),
            TurnExecutionProfile::FastChat
        );
    }

    #[test]
    fn resolve_turn_execution_profile_should_use_full_runtime_for_service_skill_launch() {
        let request = build_runtime_turn_test_request(
            "请帮我抓取站点内容",
            Some(json!({
                "harness": {
                    "theme": "general",
                    "chat_mode": "general",
                    "service_skill_launch": {
                        "adapter_name": "github/search"
                    }
                }
            })),
        );
        let policy = lime_agent::resolve_request_tool_policy(Some(false), false);

        assert_eq!(
            resolve_turn_execution_profile(&request, RuntimeChatMode::General, &policy, false,),
            TurnExecutionProfile::FullRuntime
        );
    }

    #[test]
    fn resolve_turn_execution_profile_should_use_full_runtime_for_image_skill_launch_without_model_skill_flag(
    ) {
        let request = build_runtime_turn_test_request(
            "@配图 生成 一张春日咖啡馆插画",
            Some(json!({
                "harness": {
                    "theme": "general",
                    "chat_mode": "general",
                    "image_skill_launch": {
                        "image_task": {
                            "mode": "generate",
                            "prompt": "一张春日咖啡馆插画"
                        }
                    }
                }
            })),
        );
        let policy = lime_agent::resolve_request_tool_policy(Some(false), false);

        assert_eq!(
            resolve_turn_execution_profile(&request, RuntimeChatMode::General, &policy, false,),
            TurnExecutionProfile::FullRuntime
        );
    }

    #[test]
    fn resolve_turn_execution_profile_should_use_full_runtime_for_explicit_web_search() {
        let mut request = build_runtime_turn_test_request("帮我搜今天的新闻", None);
        request.web_search = Some(true);
        let policy = lime_agent::resolve_request_tool_policy(Some(true), false);

        assert_eq!(
            resolve_turn_execution_profile(&request, RuntimeChatMode::General, &policy, false,),
            TurnExecutionProfile::FullRuntime
        );
    }

    #[test]
    fn resolve_fast_chat_tool_surface_mode_should_use_direct_answer_for_plain_greeting() {
        let request = build_runtime_turn_test_request("你好", None);
        let policy = lime_agent::resolve_request_tool_policy(Some(false), false);

        assert_eq!(
            resolve_fast_chat_tool_surface_mode(&request, TurnExecutionProfile::FastChat, &policy,),
            Some(FAST_CHAT_TOOL_SURFACE_DIRECT_ANSWER)
        );
    }

    #[test]
    fn resolve_fast_chat_tool_surface_mode_should_use_local_workspace_for_explicit_local_path() {
        let request = build_runtime_turn_test_request(
            "请读取并分析项目 /Users/coso/Documents/dev/js/claudecode",
            None,
        );
        let policy = lime_agent::resolve_request_tool_policy(Some(false), false);

        assert_eq!(
            resolve_fast_chat_tool_surface_mode(&request, TurnExecutionProfile::FastChat, &policy,),
            Some(FAST_CHAT_TOOL_SURFACE_LOCAL_WORKSPACE)
        );
    }

    #[test]
    fn resolve_fast_chat_tool_surface_mode_should_not_infer_local_workspace_from_repo_keywords() {
        let request = build_runtime_turn_test_request("帮我看看这个仓库哪里慢", None);
        let policy = lime_agent::resolve_request_tool_policy(Some(false), false);

        assert_eq!(
            resolve_fast_chat_tool_surface_mode(&request, TurnExecutionProfile::FastChat, &policy,),
            Some(FAST_CHAT_TOOL_SURFACE_DIRECT_ANSWER)
        );
    }

    #[test]
    fn extract_explicit_local_focus_paths_from_message_should_keep_existing_absolute_paths() {
        let temp_dir = tempfile::TempDir::new().expect("create temp dir");
        let quoted_dir = temp_dir.path().join("quoted repo");
        let plain_dir = temp_dir.path().join("plain-repo");
        std::fs::create_dir_all(&quoted_dir).expect("create quoted dir");
        std::fs::create_dir_all(&plain_dir).expect("create plain dir");

        let message = format!(
            "先看 \"{}\"，再对比 {}。",
            quoted_dir.display(),
            plain_dir.display()
        );

        let paths = extract_explicit_local_focus_paths_from_message(&message);
        let quoted_expected = quoted_dir
            .canonicalize()
            .expect("canonicalize quoted dir")
            .to_string_lossy()
            .to_string();
        let plain_expected = plain_dir
            .canonicalize()
            .expect("canonicalize plain dir")
            .to_string_lossy()
            .to_string();

        assert!(paths.contains(&quoted_expected));
        assert!(paths.contains(&plain_expected));
    }

    #[test]
    fn merge_system_prompt_with_explicit_local_path_focus_should_append_focus_guidance() {
        let temp_dir = tempfile::TempDir::new().expect("create temp dir");
        let repo_dir = temp_dir.path().join("claudecode");
        std::fs::create_dir_all(&repo_dir).expect("create repo dir");
        let user_message = format!("请只分析 {}", repo_dir.display());

        let merged = merge_system_prompt_with_explicit_local_path_focus(
            Some("基础系统提示".to_string()),
            &user_message,
            "/tmp/lime/workspaces/default",
        )
        .expect("merged prompt");

        assert!(merged.contains(TURN_LOCAL_PATH_FOCUS_PROMPT_MARKER));
        assert!(merged.contains(&repo_dir.to_string_lossy().to_string()));
        assert!(merged.contains("不要先扫描当前默认工作目录 /tmp/lime/workspaces/default"));
    }

    #[tokio::test]
    async fn enforce_runtime_turn_user_prompt_submit_hooks_should_allow_without_project_hooks() {
        let temp_dir = tempfile::TempDir::new().expect("create temp dir");

        enforce_runtime_turn_user_prompt_submit_hooks(
            "继续执行",
            "session-runtime-hook-allow",
            temp_dir
                .path()
                .to_str()
                .expect("temp dir path should be utf-8"),
        )
        .await
        .expect("没有项目 hooks 时不应阻止提交");
    }

    #[tokio::test]
    async fn enforce_runtime_turn_user_prompt_submit_hooks_should_block_when_project_hook_blocks() {
        let temp_dir = tempfile::TempDir::new().expect("create temp dir");
        write_blocking_user_prompt_submit_hook(temp_dir.path(), "runtime project hook blocked");

        let error = enforce_runtime_turn_user_prompt_submit_hooks(
            "继续执行",
            "session-runtime-hook-blocked",
            temp_dir
                .path()
                .to_str()
                .expect("temp dir path should be utf-8"),
        )
        .await
        .expect_err("阻塞型项目 hook 应阻止提交");

        assert!(error.contains("UserPromptSubmit hook 已阻止本次提交"));
        assert!(error.contains("runtime project hook blocked"));
    }

    #[test]
    fn merge_runtime_turn_tool_surface_metadata_should_inject_runtime_hint() {
        let metadata = merge_runtime_turn_tool_surface_metadata(None, Some("direct_answer"))
            .expect("should inject metadata");

        assert_eq!(
            metadata
                .get(LIME_RUNTIME_METADATA_KEY)
                .and_then(|value| value.get(LIME_RUNTIME_TOOL_SURFACE_KEY))
                .and_then(serde_json::Value::as_str),
            Some("direct_answer")
        );
    }

    fn runtime_test_model_capabilities(
        vision: bool,
    ) -> lime_core::models::model_registry::ModelCapabilities {
        lime_core::models::model_registry::ModelCapabilities {
            vision,
            tools: true,
            streaming: true,
            json_mode: true,
            function_calling: true,
            reasoning: false,
        }
    }

    #[test]
    fn runtime_image_input_policy_should_mark_non_vision_model_drops() {
        let mut request = build_runtime_turn_test_request("看一下这张图", None);
        request.images = Some(vec![ImageInput {
            data: "aGVsbG8=".to_string(),
            media_type: "image/png".to_string(),
        }]);
        request.provider_config = Some(ConfigureProviderRequest {
            provider_id: Some("deepseek".to_string()),
            provider_name: "openai".to_string(),
            model_name: "deepseek-reasoner".to_string(),
            api_key: None,
            base_url: None,
            model_capabilities: Some(runtime_test_model_capabilities(false)),
            tool_call_strategy: None,
            toolshim_model: None,
        });

        let policy = resolve_runtime_image_input_policy(&request).expect("image policy");

        assert_eq!(
            policy,
            RuntimeImageInputPolicy {
                submitted_image_count: 1,
                forwarded_image_count: 0,
                dropped_image_count: 1,
                provider_supports_vision: false,
            }
        );

        let metadata = merge_runtime_image_input_policy_metadata(None, Some(&policy))
            .expect("policy metadata");
        assert_eq!(
            metadata.pointer("/lime_runtime/image_input_policy/providerSupportsVision"),
            Some(&Value::Bool(false))
        );
        assert_eq!(
            metadata.pointer("/lime_runtime/image_input_policy/droppedImageCount"),
            Some(&json!(1))
        );

        let warning = build_runtime_image_input_unsupported_warning(&request)
            .expect("non-vision image input should warn");
        let warning_value = serde_json::to_value(warning).expect("serialize warning");
        assert_eq!(
            warning_value.get("type").and_then(Value::as_str),
            Some("warning")
        );
        assert_eq!(
            warning_value.get("code").and_then(Value::as_str),
            Some(RUNTIME_IMAGE_INPUT_UNSUPPORTED_WARNING_CODE)
        );
    }

    #[test]
    fn runtime_image_input_policy_should_treat_official_deepseek_as_text_only() {
        let mut request = build_runtime_turn_test_request("看一下这张图", None);
        request.images = Some(vec![ImageInput {
            data: "aGVsbG8=".to_string(),
            media_type: "image/png".to_string(),
        }]);
        request.provider_config = Some(ConfigureProviderRequest {
            provider_id: Some("deepseek".to_string()),
            provider_name: "deepseek".to_string(),
            model_name: "deepseek-v4-flash".to_string(),
            api_key: None,
            base_url: Some("https://api.deepseek.com".to_string()),
            model_capabilities: Some(runtime_test_model_capabilities(true)),
            tool_call_strategy: None,
            toolshim_model: None,
        });

        let policy = resolve_runtime_image_input_policy(&request).expect("image policy");

        assert_eq!(policy.forwarded_image_count, 0);
        assert_eq!(policy.dropped_image_count, 1);
        assert!(!policy.provider_supports_vision);
    }

    #[test]
    fn runtime_forwarded_images_should_drop_text_only_provider_images_before_agent_turn() {
        let mut request = build_runtime_turn_test_request("看一下这张图", None);
        request.images = Some(vec![ImageInput {
            data: "aGVsbG8=".to_string(),
            media_type: "image/png".to_string(),
        }]);
        request.provider_config = Some(ConfigureProviderRequest {
            provider_id: Some("deepseek".to_string()),
            provider_name: "deepseek".to_string(),
            model_name: "deepseek-v4-flash".to_string(),
            api_key: None,
            base_url: Some("https://api.deepseek.com".to_string()),
            model_capabilities: Some(runtime_test_model_capabilities(true)),
            tool_call_strategy: None,
            toolshim_model: None,
        });

        let message = build_runtime_user_message(
            &request.message,
            resolve_runtime_forwarded_images(&request),
        );

        assert_eq!(message.as_concat_text(), "看一下这张图");
        assert!(
            message
                .content
                .iter()
                .all(|content| !matches!(content, MessageContent::Image(_))),
            "text-only provider 的图片应在进入 Agent turn 前被剥离"
        );
    }

    #[test]
    fn runtime_image_input_policy_should_append_agent_only_system_notice() {
        let mut request = build_runtime_turn_test_request("看一下这张图", None);
        request.images = Some(vec![ImageInput {
            data: "aGVsbG8=".to_string(),
            media_type: "image/png".to_string(),
        }]);
        request.provider_config = Some(ConfigureProviderRequest {
            provider_id: Some("deepseek".to_string()),
            provider_name: "deepseek".to_string(),
            model_name: "deepseek-v4-flash".to_string(),
            api_key: None,
            base_url: Some("https://api.deepseek.com".to_string()),
            model_capabilities: Some(runtime_test_model_capabilities(true)),
            tool_call_strategy: None,
            toolshim_model: None,
        });

        let prompt = merge_runtime_image_input_unsupported_system_prompt(
            Some("基础提示".to_string()),
            &request,
        )
        .expect("system prompt");

        assert!(prompt.contains("基础提示"));
        assert!(prompt.contains("图片输入降级"));
        assert!(prompt.contains("deepseek-v4-flash"));
        assert!(prompt.contains("不要声称已经看到了图片"));
    }

    #[test]
    fn runtime_image_input_policy_should_keep_vision_model_images() {
        let mut request = build_runtime_turn_test_request("看一下这张图", None);
        request.images = Some(vec![ImageInput {
            data: "aGVsbG8=".to_string(),
            media_type: "image/png".to_string(),
        }]);
        request.provider_config = Some(ConfigureProviderRequest {
            provider_id: Some("openai".to_string()),
            provider_name: "openai".to_string(),
            model_name: "gpt-4o".to_string(),
            api_key: None,
            base_url: None,
            model_capabilities: Some(runtime_test_model_capabilities(true)),
            tool_call_strategy: None,
            toolshim_model: None,
        });

        let policy = resolve_runtime_image_input_policy(&request).expect("image policy");

        assert_eq!(policy.forwarded_image_count, 1);
        assert_eq!(policy.dropped_image_count, 0);
        assert!(build_runtime_image_input_unsupported_warning(&request).is_none());
    }

    #[test]
    fn normalize_runtime_turn_request_metadata_should_enable_artifact_prompt_before_turn_build() {
        let mut request = AsterChatRequest {
            message: "请基于目标先生成一版演示提纲".to_string(),
            session_id: "session-artifact".to_string(),
            event_name: "agent_stream".to_string(),
            images: None,
            provider_config: None,
            provider_preference: None,
            model_preference: None,
            thinking_enabled: None,
            approval_policy: None,
            sandbox_policy: None,
            project_id: None,
            workspace_id: "workspace-artifact".to_string(),
            web_search: None,
            search_mode: None,
            execution_strategy: None,
            auto_continue: None,
            system_prompt: None,
            metadata: Some(json!({
                "harness": {
                    "theme": "general",
                    "session_mode": "general_workbench",
                    "content_id": "content-1"
                }
            })),
            turn_id: None,
            queue_if_busy: None,
            queued_turn_id: None,
        };

        let raw_prompt = merge_system_prompt_with_artifact_context(
            Some("基础系统提示".to_string()),
            request.metadata.as_ref(),
        )
        .expect("raw prompt");
        assert!(!raw_prompt.contains("【Artifact 交付策略】"));

        normalize_runtime_turn_request_metadata(&mut request, None, None, None, None, None, true);

        let normalized_metadata = request.metadata.as_ref().expect("normalized metadata");
        assert_eq!(
            normalized_metadata
                .pointer("/artifact/artifact_mode")
                .and_then(Value::as_str),
            Some("draft")
        );

        let prompt = merge_system_prompt_with_artifact_context(
            Some("基础系统提示".to_string()),
            Some(normalized_metadata),
        )
        .expect("normalized prompt");
        assert!(prompt.contains("【Artifact 交付策略】"));
        assert!(prompt.contains("【Artifact Stage 2 合同】"));
        assert!(prompt.contains("artifact:content-1"));

        let mut turn_input_builder =
            TurnInputEnvelopeBuilder::new(&request.session_id, &request.workspace_id);
        turn_input_builder
            .set_base_system_prompt(
                TurnSystemPromptSource::Frontend,
                Some("基础系统提示".to_string()),
            )
            .set_turn_context_metadata_from_value(request.metadata.as_ref())
            .set_effective_user_message(&request.message)
            .apply_prompt_stage(TurnPromptAugmentationStageKind::Artifact, Some(prompt));

        let envelope = turn_input_builder.build();
        let diagnostics = envelope.diagnostics_snapshot();
        let turn_context = envelope.turn_context_override().expect("turn context");

        assert!(diagnostics.has_turn_context_metadata);
        assert!(diagnostics
            .turn_context_metadata_keys
            .contains(&"artifact".to_string()));
        assert_eq!(
            turn_context
                .metadata
                .get("artifact")
                .and_then(|artifact| artifact.get("artifact_stage"))
                .and_then(Value::as_str),
            Some("stage2")
        );
    }

    #[test]
    fn resolve_provider_config_apply_mode_prefers_direct_for_ollama_without_api_key() {
        let provider_config = ConfigureProviderRequest {
            provider_id: Some("ollama".to_string()),
            provider_name: "ollama".to_string(),
            model_name: "deepseek-r1:latest".to_string(),
            api_key: None,
            base_url: None,
            model_capabilities: None,
            tool_call_strategy: None,
            toolshim_model: None,
        };

        assert_eq!(
            resolve_provider_config_apply_mode(&provider_config),
            ProviderConfigApplyMode::Direct
        );
    }

    #[test]
    fn should_auto_capture_runtime_memory_turn_for_long_turn_content() {
        let user_message = "请记下这个团队的偏好：所有需求都先回到主线任务，再给出下一步明确行动。";
        let assistant_output = "好的，我会把这条协作规则当作后续回合的默认执行约束，并在继续实现前先说明当前主线、当前阶段以及下一刀要推进的内容，同时避免把工作扩散到无关页面或额外配置面。";

        assert!(should_auto_capture_runtime_memory_turn(
            user_message,
            assistant_output
        ));
    }

    #[test]
    fn should_auto_capture_runtime_memory_turn_for_memory_signal_keywords() {
        let user_message = "记住：以后回复先给结论";
        let assistant_output = "收到，我以后会先给结论。";

        assert!(should_auto_capture_runtime_memory_turn(
            user_message,
            assistant_output
        ));
    }

    #[test]
    fn should_not_auto_capture_runtime_memory_turn_for_short_generic_turn() {
        let user_message = "你好";
        let assistant_output = "收到";

        assert!(!should_auto_capture_runtime_memory_turn(
            user_message,
            assistant_output
        ));
    }

    #[test]
    fn service_skill_launch_stage_should_preserve_simple_user_message_and_force_site_run_first() {
        let user_message = "请帮我使用 GitHub 查一下 AI Agent 项目";
        let metadata = json!({
            "harness": {
                "browser_assist": {
                    "enabled": true,
                    "profile_key": "attached-github",
                },
                "service_skill_launch": {
                    "kind": "site_adapter",
                    "skill_title": "GitHub 仓库线索检索",
                    "adapter_name": "github/search",
                    "args": {
                        "query": "AI Agent",
                        "limit": 10
                    },
                    "save_mode": "current_content",
                    "content_id": "content-1",
                    "project_id": "project-1",
                    "launch_readiness": {
                        "status": "ready",
                        "message": "已检测到 github.com 的真实浏览器页面。",
                        "target_id": "tab-github"
                    }
                }
            }
        });

        let prompt_with_web_search =
            Some("基础系统提示\n- 如果需要可使用 WebSearch 补充信息。".to_string());
        let prompt_with_service_skill_launch = merge_system_prompt_with_service_skill_launch(
            prompt_with_web_search.clone(),
            Some(&metadata),
        )
        .expect("service skill prompt");

        let mut turn_input_builder =
            TurnInputEnvelopeBuilder::new("session-service-skill", "workspace-service-skill");
        turn_input_builder
            .set_base_system_prompt(
                TurnSystemPromptSource::Frontend,
                Some("基础系统提示".to_string()),
            )
            .set_turn_context_metadata_from_value(Some(&metadata))
            .set_effective_user_message(user_message)
            .apply_prompt_stage(
                TurnPromptAugmentationStageKind::WebSearch,
                prompt_with_web_search,
            )
            .apply_prompt_stage(
                TurnPromptAugmentationStageKind::ServiceSkillLaunch,
                Some(prompt_with_service_skill_launch.clone()),
            );

        let envelope = turn_input_builder.build();
        let diagnostics = envelope.diagnostics_snapshot();
        let final_prompt = envelope.system_prompt().expect("final prompt");
        let service_skill_stage = diagnostics
            .prompt_augmentation_stages
            .iter()
            .find(|stage| stage.stage == TurnPromptAugmentationStageKind::ServiceSkillLaunch)
            .expect("service skill stage");

        assert_eq!(
            diagnostics.effective_user_message_len,
            user_message.chars().count()
        );
        assert!(diagnostics.has_turn_context_metadata);
        assert!(diagnostics
            .turn_context_metadata_keys
            .contains(&"harness".to_string()));
        assert!(service_skill_stage.changed);
        assert!(final_prompt.contains(SERVICE_SKILL_LAUNCH_PROMPT_MARKER));
        assert!(final_prompt.contains("第一步优先调用 lime_site_run"));
        assert!(final_prompt.contains("不要先用 WebSearch、research、webReader"));
        assert!(final_prompt.contains("不要直接调用 mcp__lime-browser__browser_navigate"));
        assert!(final_prompt.contains("第一工具调用示例(lime_site_run 参数 JSON)"));
        assert!(final_prompt.contains("profile_key=attached-github"));
        assert!(final_prompt.contains("target_id=tab-github"));
        assert!(final_prompt.contains("\"adapter_name\":\"github/search\""));
        assert!(final_prompt.contains("attached_session_required、no_matching_context"));
    }

    #[test]
    fn normalize_runtime_turn_request_metadata_should_backfill_content_id_from_session_runtime() {
        let mut request = AsterChatRequest {
            message: "继续完善当前文档".to_string(),
            session_id: "session-artifact-content-fallback".to_string(),
            event_name: "agent_stream".to_string(),
            images: None,
            provider_config: None,
            provider_preference: None,
            model_preference: None,
            thinking_enabled: None,
            approval_policy: None,
            sandbox_policy: None,
            project_id: None,
            workspace_id: "workspace-artifact".to_string(),
            web_search: None,
            search_mode: None,
            execution_strategy: None,
            auto_continue: None,
            system_prompt: None,
            metadata: Some(json!({
                "harness": {
                    "theme": "general",
                    "session_mode": "general_workbench"
                }
            })),
            turn_id: None,
            queue_if_busy: None,
            queued_turn_id: None,
        };

        normalize_runtime_turn_request_metadata(
            &mut request,
            Some("general"),
            Some("general_workbench"),
            None,
            None,
            Some("content-from-session"),
            true,
        );

        let normalized_metadata = request.metadata.as_ref().expect("normalized metadata");
        assert_eq!(
            normalized_metadata
                .pointer("/harness/theme")
                .and_then(Value::as_str),
            Some("general")
        );
        assert_eq!(
            normalized_metadata
                .pointer("/harness/session_mode")
                .and_then(Value::as_str),
            Some("general_workbench")
        );
        assert_eq!(
            normalized_metadata
                .pointer("/harness/content_id")
                .and_then(Value::as_str),
            Some("content-from-session")
        );
        assert_eq!(
            normalized_metadata
                .pointer("/artifact/artifact_request_id")
                .and_then(Value::as_str),
            Some("artifact:content-from-session")
        );
    }

    #[test]
    fn normalize_runtime_turn_request_metadata_should_backfill_theme_and_session_mode_from_session_runtime(
    ) {
        let mut request = AsterChatRequest {
            message: "继续推进当前工作区编排".to_string(),
            session_id: "session-artifact-theme-fallback".to_string(),
            event_name: "agent_stream".to_string(),
            images: None,
            provider_config: None,
            provider_preference: None,
            model_preference: None,
            thinking_enabled: None,
            approval_policy: None,
            sandbox_policy: None,
            project_id: None,
            workspace_id: "workspace-artifact".to_string(),
            web_search: None,
            search_mode: None,
            execution_strategy: None,
            auto_continue: None,
            system_prompt: None,
            metadata: Some(json!({
                "harness": {
                    "content_id": "content-from-session"
                }
            })),
            turn_id: None,
            queue_if_busy: None,
            queued_turn_id: None,
        };

        normalize_runtime_turn_request_metadata(
            &mut request,
            Some("general"),
            Some("general_workbench"),
            None,
            None,
            Some("content-from-session"),
            true,
        );

        let normalized_metadata = request.metadata.as_ref().expect("normalized metadata");
        assert_eq!(
            normalized_metadata
                .pointer("/harness/theme")
                .and_then(Value::as_str),
            Some("general")
        );
        assert_eq!(
            normalized_metadata
                .pointer("/harness/session_mode")
                .and_then(Value::as_str),
            Some("general_workbench")
        );
        assert_eq!(
            normalized_metadata
                .pointer("/harness/content_id")
                .and_then(Value::as_str),
            Some("content-from-session")
        );
    }

    #[test]
    fn normalize_runtime_turn_request_metadata_should_backfill_gate_key_and_run_title_from_session_runtime(
    ) {
        let mut request = AsterChatRequest {
            message: "继续当前社媒运行".to_string(),
            session_id: "session-social-gate-fallback".to_string(),
            event_name: "agent_stream".to_string(),
            images: None,
            provider_config: None,
            provider_preference: None,
            model_preference: None,
            thinking_enabled: None,
            approval_policy: None,
            sandbox_policy: None,
            project_id: None,
            workspace_id: "workspace-general-fallback".to_string(),
            web_search: None,
            search_mode: None,
            execution_strategy: None,
            auto_continue: None,
            system_prompt: None,
            metadata: Some(json!({
                "harness": {
                    "theme": "general",
                    "session_mode": "general_workbench",
                    "content_id": "content-social-1"
                }
            })),
            turn_id: None,
            queue_if_busy: None,
            queued_turn_id: None,
        };

        normalize_runtime_turn_request_metadata(
            &mut request,
            Some("general"),
            Some("general_workbench"),
            Some("write_mode"),
            Some("社媒初稿"),
            Some("content-social-1"),
            true,
        );

        let normalized_metadata = request.metadata.as_ref().expect("normalized metadata");
        assert_eq!(
            normalized_metadata
                .pointer("/harness/gate_key")
                .and_then(Value::as_str),
            Some("write_mode")
        );
        assert_eq!(
            normalized_metadata
                .pointer("/harness/run_title")
                .and_then(Value::as_str),
            Some("社媒初稿")
        );
    }

    #[test]
    fn backfill_runtime_access_policies_should_derive_from_legacy_harness_access_mode() {
        let mut request = AsterChatRequest {
            message: "继续执行".to_string(),
            session_id: "session-access-legacy".to_string(),
            event_name: "agent_stream".to_string(),
            images: None,
            provider_config: None,
            provider_preference: None,
            model_preference: None,
            thinking_enabled: None,
            approval_policy: None,
            sandbox_policy: None,
            project_id: None,
            workspace_id: "workspace-access".to_string(),
            web_search: None,
            search_mode: None,
            execution_strategy: None,
            auto_continue: None,
            system_prompt: None,
            metadata: Some(json!({
                "harness": {
                    "access_mode": "full-access"
                }
            })),
            turn_id: None,
            queue_if_busy: None,
            queued_turn_id: None,
        };

        backfill_runtime_access_policies(&mut request);

        assert_eq!(request.approval_policy.as_deref(), Some("never"));
        assert_eq!(
            request.sandbox_policy.as_deref(),
            Some("danger-full-access")
        );
    }

    #[test]
    fn backfill_runtime_access_policies_should_default_to_full_access_when_request_missing() {
        let mut request = AsterChatRequest {
            message: "继续执行".to_string(),
            session_id: "session-access-default".to_string(),
            event_name: "agent_stream".to_string(),
            images: None,
            provider_config: None,
            provider_preference: None,
            model_preference: None,
            thinking_enabled: None,
            approval_policy: None,
            sandbox_policy: None,
            project_id: None,
            workspace_id: "workspace-access".to_string(),
            web_search: None,
            search_mode: None,
            execution_strategy: None,
            auto_continue: None,
            system_prompt: None,
            metadata: None,
            turn_id: None,
            queue_if_busy: None,
            queued_turn_id: None,
        };

        backfill_runtime_access_policies(&mut request);

        assert_eq!(request.approval_policy.as_deref(), Some("never"));
        assert_eq!(
            request.sandbox_policy.as_deref(),
            Some("danger-full-access")
        );
    }

    #[tokio::test]
    async fn update_compaction_session_metrics_should_move_summary_tokens_to_current_window() {
        ensure_runtime_turn_test_session_manager().await;

        let session = SessionManager::create_session(
            PathBuf::from("."),
            "压缩统计测试".to_string(),
            SessionType::User,
        )
        .await
        .expect("创建测试会话失败");

        SessionManager::update_session(&session.id)
            .schedule_id(Some("job-before".to_string()))
            .total_tokens(Some(90))
            .input_tokens(Some(60))
            .output_tokens(Some(30))
            .cached_input_tokens(Some(12))
            .cache_creation_input_tokens(Some(4))
            .accumulated_total_tokens(Some(300))
            .accumulated_input_tokens(Some(200))
            .accumulated_output_tokens(Some(100))
            .apply()
            .await
            .expect("预置 token 统计失败");

        let mut session_config = SessionConfigBuilder::new(&session.id).build();
        session_config.schedule_id = Some("job-compact".to_string());

        let usage = ProviderUsage::new(
            "gpt-4.1".to_string(),
            Usage::new(Some(120), Some(45), Some(165))
                .with_cached_input_tokens(Some(90))
                .with_cache_creation_input_tokens(Some(30)),
        );

        update_compaction_session_metrics(&session_config, &usage)
            .await
            .expect("更新压缩 token 统计失败");

        let updated = SessionManager::get_session(&session.id, false)
            .await
            .expect("读取更新后的会话失败");

        assert_eq!(updated.schedule_id.as_deref(), Some("job-compact"));
        assert_eq!(updated.total_tokens, Some(45));
        assert_eq!(updated.input_tokens, Some(45));
        assert_eq!(updated.output_tokens, Some(0));
        assert_eq!(updated.cached_input_tokens, Some(90));
        assert_eq!(updated.cache_creation_input_tokens, Some(30));
        assert_eq!(updated.accumulated_total_tokens, Some(465));
        assert_eq!(updated.accumulated_input_tokens, Some(320));
        assert_eq!(updated.accumulated_output_tokens, Some(145));

        delete_managed_session(&session.id)
            .await
            .expect("清理测试会话失败");
    }

    #[tokio::test]
    async fn update_compaction_session_metrics_should_reset_current_window_when_usage_tokens_missing(
    ) {
        ensure_runtime_turn_test_session_manager().await;

        let session = SessionManager::create_session(
            PathBuf::from("."),
            "压缩统计缺字段测试".to_string(),
            SessionType::User,
        )
        .await
        .expect("创建测试会话失败");

        SessionManager::update_session(&session.id)
            .schedule_id(Some("job-before".to_string()))
            .total_tokens(Some(180))
            .input_tokens(Some(120))
            .output_tokens(Some(60))
            .cached_input_tokens(Some(24))
            .cache_creation_input_tokens(Some(8))
            .accumulated_total_tokens(Some(700))
            .accumulated_input_tokens(Some(500))
            .accumulated_output_tokens(Some(200))
            .apply()
            .await
            .expect("预置 token 统计失败");

        let mut session_config = SessionConfigBuilder::new(&session.id).build();
        session_config.schedule_id = Some("job-compact-missing".to_string());

        let usage = ProviderUsage::new("gpt-4.1".to_string(), Usage::default());

        update_compaction_session_metrics(&session_config, &usage)
            .await
            .expect("更新压缩 token 统计失败");

        let updated = SessionManager::get_session(&session.id, false)
            .await
            .expect("读取更新后的会话失败");

        assert_eq!(updated.schedule_id.as_deref(), Some("job-compact-missing"));
        assert_eq!(updated.total_tokens, Some(0));
        assert_eq!(updated.input_tokens, Some(0));
        assert_eq!(updated.output_tokens, Some(0));
        assert_eq!(updated.cached_input_tokens, Some(0));
        assert_eq!(updated.cache_creation_input_tokens, Some(0));
        assert_eq!(updated.accumulated_total_tokens, Some(700));
        assert_eq!(updated.accumulated_input_tokens, Some(500));
        assert_eq!(updated.accumulated_output_tokens, Some(200));

        delete_managed_session(&session.id)
            .await
            .expect("清理测试会话失败");
    }

    #[tokio::test]
    async fn update_compaction_session_metrics_should_preserve_existing_schedule_id_when_request_is_empty(
    ) {
        ensure_runtime_turn_test_session_manager().await;

        let session = SessionManager::create_session(
            PathBuf::from("."),
            "压缩统计保留任务测试".to_string(),
            SessionType::User,
        )
        .await
        .expect("创建测试会话失败");

        SessionManager::update_session(&session.id)
            .schedule_id(Some("job-existing".to_string()))
            .total_tokens(Some(20))
            .input_tokens(Some(10))
            .output_tokens(Some(10))
            .cached_input_tokens(Some(6))
            .cache_creation_input_tokens(Some(2))
            .accumulated_total_tokens(Some(200))
            .accumulated_input_tokens(Some(120))
            .accumulated_output_tokens(Some(80))
            .apply()
            .await
            .expect("预置 token 统计失败");

        let session_config = SessionConfigBuilder::new(&session.id).build();
        let usage = ProviderUsage::new(
            "gpt-4.1".to_string(),
            Usage::new(Some(30), Some(15), Some(45))
                .with_cached_input_tokens(Some(18))
                .with_cache_creation_input_tokens(Some(6)),
        );

        update_compaction_session_metrics(&session_config, &usage)
            .await
            .expect("更新压缩 token 统计失败");

        let updated = SessionManager::get_session(&session.id, false)
            .await
            .expect("读取更新后的会话失败");

        assert_eq!(updated.schedule_id.as_deref(), Some("job-existing"));
        assert_eq!(updated.total_tokens, Some(15));
        assert_eq!(updated.input_tokens, Some(15));
        assert_eq!(updated.output_tokens, Some(0));
        assert_eq!(updated.cached_input_tokens, Some(18));
        assert_eq!(updated.cache_creation_input_tokens, Some(6));
        assert_eq!(updated.accumulated_total_tokens, Some(245));
        assert_eq!(updated.accumulated_input_tokens, Some(150));
        assert_eq!(updated.accumulated_output_tokens, Some(95));

        delete_managed_session(&session.id)
            .await
            .expect("清理测试会话失败");
    }

    #[tokio::test]
    async fn resolve_runtime_final_done_event_should_include_usage_from_session() {
        ensure_runtime_turn_test_session_manager().await;

        let session = SessionManager::create_session(
            PathBuf::from("."),
            "final_done usage 测试".to_string(),
            SessionType::User,
        )
        .await
        .expect("创建测试会话失败");

        SessionManager::update_session(&session.id)
            .input_tokens(Some(204))
            .output_tokens(Some(88))
            .cached_input_tokens(Some(160))
            .cache_creation_input_tokens(Some(48))
            .apply()
            .await
            .expect("写入 usage 失败");

        let event = resolve_runtime_final_done_event(&session.id, None).await;
        match event {
            RuntimeAgentEvent::FinalDone { usage } => {
                assert_eq!(
                    usage.map(|value| (
                        value.input_tokens,
                        value.output_tokens,
                        value.cached_input_tokens,
                        value.cache_creation_input_tokens,
                    )),
                    Some((204, 88, Some(160), Some(48)))
                );
            }
            other => panic!("收到意外事件: {:?}", other),
        }

        delete_managed_session(&session.id)
            .await
            .expect("清理测试会话失败");
    }

    #[tokio::test]
    async fn resolve_runtime_final_done_event_should_fall_back_to_none_without_session_usage() {
        ensure_runtime_turn_test_session_manager().await;

        let session = SessionManager::create_session(
            PathBuf::from("."),
            "final_done 无 usage 测试".to_string(),
            SessionType::User,
        )
        .await
        .expect("创建测试会话失败");

        let event = resolve_runtime_final_done_event(&session.id, None).await;
        match event {
            RuntimeAgentEvent::FinalDone { usage } => {
                assert!(usage.is_none(), "未写入 usage 时应返回 None");
            }
            other => panic!("收到意外事件: {:?}", other),
        }

        delete_managed_session(&session.id)
            .await
            .expect("清理测试会话失败");
    }

    #[tokio::test]
    async fn resolve_runtime_final_done_event_should_fall_back_to_persisted_session_usage() {
        ensure_runtime_turn_test_session_manager().await;

        let conn = Connection::open_in_memory().expect("创建持久化回退数据库失败");
        create_tables(&conn).expect("初始化持久化回退表结构失败");
        let now = Utc::now().to_rfc3339();
        let session_id = format!("persisted-usage-{}", Uuid::new_v4());
        conn.execute(
            "INSERT INTO agent_sessions (
                id, model, system_prompt, title, created_at, updated_at, working_dir,
                execution_strategy, session_type, user_set_name, extension_data_json,
                input_tokens, output_tokens, cached_input_tokens, cache_creation_input_tokens
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
            rusqlite::params![
                session_id,
                "glm-4.5",
                Option::<String>::None,
                "persisted usage",
                now,
                now,
                ".",
                "react",
                "user",
                false,
                "{}",
                321i64,
                123i64,
                222i64,
                18i64
            ],
        )
        .expect("写入持久化 usage 会话失败");
        let db = Arc::new(Mutex::new(conn));

        let event = resolve_runtime_final_done_event(&session_id, Some(&db)).await;
        match event {
            RuntimeAgentEvent::FinalDone { usage } => {
                assert_eq!(
                    usage.map(|value| (
                        value.input_tokens,
                        value.output_tokens,
                        value.cached_input_tokens,
                        value.cache_creation_input_tokens,
                    )),
                    Some((321, 123, Some(222), Some(18)))
                );
            }
            other => panic!("收到意外事件: {:?}", other),
        }
    }

    #[tokio::test]
    async fn should_auto_compact_runtime_session_when_workspace_pref_enabled_and_context_threshold_exceeded(
    ) {
        let provider = AutoCompactThresholdTestProvider::new(Some(1_000));
        let session = build_auto_compaction_test_session(Some(900));

        assert!(should_auto_compact_runtime_session(
            &provider,
            &session,
            &WorkspaceSettings::default(),
            Some(0.8),
        )
        .await
        .expect("检查自动压缩阈值失败"));
    }

    #[tokio::test]
    async fn should_not_auto_compact_runtime_session_when_workspace_pref_disabled() {
        let provider = AutoCompactThresholdTestProvider::new(Some(1_000));
        let session = build_auto_compaction_test_session(Some(900));
        let workspace_settings = WorkspaceSettings {
            auto_compact: false,
            ..WorkspaceSettings::default()
        };

        assert!(!should_auto_compact_runtime_session(
            &provider,
            &session,
            &workspace_settings,
            Some(0.8),
        )
        .await
        .expect("检查自动压缩阈值失败"));
    }

    #[tokio::test]
    async fn should_not_auto_compact_runtime_session_when_context_threshold_not_exceeded() {
        let provider = AutoCompactThresholdTestProvider::new(Some(1_000));
        let session = build_auto_compaction_test_session(Some(700));

        assert!(!should_auto_compact_runtime_session(
            &provider,
            &session,
            &WorkspaceSettings::default(),
            Some(0.8),
        )
        .await
        .expect("检查自动压缩阈值失败"));
    }

    #[test]
    fn should_inject_turn_context_metadata_when_workspace_auto_compaction_disabled() {
        let merged = merge_turn_context_with_workspace_auto_compaction(
            Some(TurnContextOverride::default()),
            &WorkspaceSettings {
                auto_compact: false,
                ..WorkspaceSettings::default()
            },
        )
        .expect("应返回 turn context");

        assert_eq!(
            merged
                .metadata
                .get(LIME_RUNTIME_METADATA_KEY)
                .and_then(|value| value.get(LIME_RUNTIME_AUTO_COMPACT_KEY))
                .and_then(Value::as_bool),
            Some(false)
        );
    }

    #[test]
    fn should_keep_turn_context_unchanged_when_workspace_auto_compaction_enabled() {
        assert!(merge_turn_context_with_workspace_auto_compaction(
            None,
            &WorkspaceSettings::default()
        )
        .is_none());
    }

    #[test]
    fn build_runtime_turn_context_snapshot_should_capture_final_turn_context_inputs() {
        let metadata = json!({
            "artifact": {
                "artifact_mode": "draft",
                "artifact_stage": "stage2",
                "artifact_kind": "analysis"
            },
            "harness": {
                "theme": "analysis"
            }
        });
        let workspace_settings = WorkspaceSettings {
            auto_compact: false,
            ..WorkspaceSettings::default()
        };

        let snapshot = build_runtime_turn_context_snapshot(Some(&metadata), &workspace_settings);
        let snapshot_metadata =
            build_runtime_turn_context_metadata_value(&snapshot).expect("snapshot metadata");

        assert_eq!(
            snapshot.output_schema_source,
            Some(aster::session::TurnOutputSchemaSource::Turn)
        );
        assert!(snapshot.output_schema.is_some());
        assert_eq!(
            snapshot_metadata
                .get(LIME_RUNTIME_METADATA_KEY)
                .and_then(|value| value.get(LIME_RUNTIME_AUTO_COMPACT_KEY))
                .and_then(Value::as_bool),
            Some(false)
        );
        assert_eq!(
            snapshot_metadata
                .get("harness")
                .and_then(|value| value.get("theme"))
                .and_then(Value::as_str),
            Some("analysis")
        );
    }

    #[test]
    fn build_runtime_compaction_session_config_should_keep_minimal_control_turn_context() {
        let session_config = build_runtime_compaction_session_config(
            "session-compact",
            "thread-compact",
            "turn-compact",
            None,
        );

        assert_eq!(session_config.id, "session-compact");
        assert_eq!(session_config.thread_id.as_deref(), Some("thread-compact"));
        assert_eq!(session_config.turn_id.as_deref(), Some("turn-compact"));
        assert_eq!(session_config.system_prompt, None);
        assert_eq!(session_config.include_context_trace, None);
        assert!(session_config.turn_context.is_none());
    }

    #[test]
    fn build_runtime_compaction_session_config_should_attach_history_compress_turn_context() {
        let metadata = build_history_compaction_runtime_metadata(
            RuntimeSessionCompactionTrigger::Manual,
            &AuxiliaryProviderResolution {
                service_model_slot: "history_compress".to_string(),
                task_kind: "history_compress".to_string(),
                decision_source: "session_default".to_string(),
                decision_reason:
                    "当前未配置 service_models.history_compress，沿用当前 provider/model。"
                        .to_string(),
                selected_provider: Some("openai".to_string()),
                selected_model: Some("gpt-4o-mini".to_string()),
                requested_provider: None,
                requested_model: None,
                fallback_chain: Vec::new(),
                settings_source: None,
                estimated_cost_class: Some("low".to_string()),
            },
        );
        let session_config = build_runtime_compaction_session_config(
            "session-compact",
            "thread-compact",
            "turn-compact",
            build_auxiliary_turn_context_override(metadata),
        );

        let turn_context = session_config.turn_context.expect("turn context");
        let lime_runtime = turn_context
            .metadata
            .get("lime_runtime")
            .and_then(serde_json::Value::as_object)
            .expect("lime runtime");
        let task_profile = lime_runtime
            .get("task_profile")
            .and_then(serde_json::Value::as_object)
            .expect("task profile");

        assert_eq!(
            task_profile.get("kind").and_then(serde_json::Value::as_str),
            Some("history_compress")
        );
        assert_eq!(
            task_profile
                .get("source")
                .and_then(serde_json::Value::as_str),
            Some("context_compaction_manual")
        );
    }

    #[test]
    fn build_history_compaction_runtime_metadata_should_project_history_compress_route() {
        let metadata = build_history_compaction_runtime_metadata(
            RuntimeSessionCompactionTrigger::Auto,
            &AuxiliaryProviderResolution {
                service_model_slot: "history_compress".to_string(),
                task_kind: "history_compress".to_string(),
                decision_source: "service_model_setting".to_string(),
                decision_reason: "命中 service_models.history_compress".to_string(),
                selected_provider: Some("openai".to_string()),
                selected_model: Some("gpt-5.4-mini".to_string()),
                requested_provider: Some("openai".to_string()),
                requested_model: Some("gpt-5.4-mini".to_string()),
                fallback_chain: Vec::new(),
                settings_source: Some("service_models.history_compress".to_string()),
                estimated_cost_class: Some("low".to_string()),
            },
        )
        .expect("metadata");

        let task_profile = extract_runtime_resolution_payload::<
            lime_agent::SessionExecutionRuntimeTaskProfile,
        >(Some(&metadata), "task_profile")
        .expect("task profile");
        let routing_decision = extract_runtime_resolution_payload::<
            lime_agent::SessionExecutionRuntimeRoutingDecision,
        >(Some(&metadata), "routing_decision")
        .expect("routing decision");
        let limit_state = extract_runtime_resolution_payload::<
            lime_agent::SessionExecutionRuntimeLimitState,
        >(Some(&metadata), "limit_state")
        .expect("limit state");
        let cost_state = extract_runtime_resolution_payload::<
            lime_agent::SessionExecutionRuntimeCostState,
        >(Some(&metadata), "cost_state")
        .expect("cost state");

        assert_eq!(task_profile.kind, "history_compress");
        assert_eq!(task_profile.source, "context_compaction_auto");
        assert_eq!(
            task_profile.service_model_slot.as_deref(),
            Some("history_compress")
        );
        assert_eq!(routing_decision.routing_mode, "single_candidate");
        assert_eq!(routing_decision.decision_source, "service_model_setting");
        assert_eq!(
            routing_decision.settings_source.as_deref(),
            Some("service_models.history_compress")
        );
        assert_eq!(
            routing_decision.selected_model.as_deref(),
            Some("gpt-5.4-mini")
        );
        assert!(limit_state.single_candidate_only);
        assert!(limit_state.settings_locked);
        assert_eq!(cost_state.estimated_cost_class.as_deref(), Some("low"));
    }

    #[test]
    fn should_skip_artifact_document_autopersist_when_output_is_empty() {
        let observation = Arc::new(Mutex::new(ChatRunObservation::default()));

        assert!(should_skip_artifact_document_autopersist(
            &observation,
            "   \n  "
        ));
    }

    #[test]
    fn should_skip_artifact_document_autopersist_when_runtime_observation_has_artifacts() {
        let observation = Arc::new(Mutex::new(ChatRunObservation::default()));
        observation
            .lock()
            .expect("lock observation")
            .record_artifact_path("content-posts/demo.md".to_string(), None);

        assert!(should_skip_artifact_document_autopersist(
            &observation,
            "普通正文输出"
        ));
    }

    #[test]
    fn should_not_skip_artifact_document_autopersist_based_on_write_file_text_only() {
        let observation = Arc::new(Mutex::new(ChatRunObservation::default()));

        assert!(!should_skip_artifact_document_autopersist(
            &observation,
            "<write_file path=\"content-posts/demo.md\">内容</write_file>"
        ));
    }

    #[test]
    fn should_skip_default_fast_chat_artifact_autopersist_for_plain_chat() {
        assert!(should_skip_default_fast_chat_artifact_autopersist(
            TurnExecutionProfile::FastChat,
            Some(&json!({
                "harness": {
                    "theme": "general",
                    "session_mode": "default"
                }
            })),
        ));
    }

    #[test]
    fn should_not_skip_default_fast_chat_artifact_autopersist_for_workbench_content() {
        assert!(!should_skip_default_fast_chat_artifact_autopersist(
            TurnExecutionProfile::FastChat,
            Some(&json!({
                "harness": {
                    "theme": "general",
                    "session_mode": "general_workbench",
                    "content_id": "content-1"
                }
            })),
        ));
    }

    #[test]
    fn should_not_skip_default_fast_chat_artifact_autopersist_for_explicit_artifact_request() {
        assert!(!should_skip_default_fast_chat_artifact_autopersist(
            TurnExecutionProfile::FastChat,
            Some(&json!({
                "artifact_mode": "draft",
                "artifact_stage": "stage2"
            })),
        ));
    }

    #[test]
    fn collect_runtime_request_resolution_side_events_should_emit_routing_chain() {
        let metadata = json!({
            "lime_runtime": {
                "task_profile": {
                    "kind": "translation",
                    "source": "translation_skill_launch",
                    "traits": ["service_model_slot"],
                    "serviceModelSlot": "translation"
                },
                "routing_decision": {
                    "routingMode": "single_candidate",
                    "decisionSource": "service_model_setting",
                    "decisionReason": "命中 service_models.translation",
                    "selectedProvider": "openai",
                    "selectedModel": "gpt-4.1-mini",
                    "candidateCount": 1,
                    "fallbackChain": ["service_models.translation -> session_default"]
                },
                "limit_state": {
                    "status": "single_candidate_only",
                    "singleCandidateOnly": true,
                    "providerLocked": true,
                    "settingsLocked": true,
                    "oemLocked": false,
                    "candidateCount": 1,
                    "capabilityGap": "tools_missing"
                },
                "cost_state": {
                    "status": "estimated",
                    "estimatedCostClass": "low"
                },
                "limit_event": {
                    "eventKind": "quota_low",
                    "message": "OEM 云端额度偏低",
                    "retryable": true
                }
            }
        });

        let events = collect_runtime_request_resolution_side_events(Some(&metadata))
            .into_iter()
            .map(|event| {
                serde_json::to_value(event)
                    .ok()
                    .and_then(|value| {
                        value
                            .get("type")
                            .and_then(Value::as_str)
                            .map(str::to_string)
                    })
                    .expect("应能序列化 runtime event")
            })
            .collect::<Vec<_>>();

        assert_eq!(
            events,
            vec![
                "task_profile_resolved".to_string(),
                "candidate_set_resolved".to_string(),
                "routing_decision_made".to_string(),
                "routing_fallback_applied".to_string(),
                "limit_state_updated".to_string(),
                "single_candidate_only".to_string(),
                "single_candidate_capability_gap".to_string(),
                "cost_estimated".to_string(),
                "quota_low".to_string(),
            ]
        );
    }

    #[test]
    fn collect_runtime_request_resolution_side_events_should_cover_generation_topic_current_chain()
    {
        let metadata = json!({
            "lime_runtime": {
                "task_profile": {
                    "kind": "generation_topic",
                    "source": "auxiliary_generation_topic",
                    "traits": ["service_model_slot"],
                    "serviceModelSlot": "generation_topic"
                },
                "routing_decision": {
                    "routingMode": "single_candidate",
                    "decisionSource": "service_model_setting",
                    "decisionReason": "命中 service_models.generation_topic",
                    "selectedProvider": "openai",
                    "selectedModel": "gpt-5.4-mini",
                    "candidateCount": 1,
                    "fallbackChain": []
                },
                "limit_state": {
                    "status": "single_candidate_only",
                    "singleCandidateOnly": true,
                    "providerLocked": false,
                    "settingsLocked": true,
                    "oemLocked": false,
                    "candidateCount": 1
                },
                "cost_state": {
                    "status": "estimated",
                    "estimatedCostClass": "low"
                }
            }
        });

        let events = collect_runtime_request_resolution_side_events(Some(&metadata))
            .into_iter()
            .map(|event| {
                serde_json::to_value(event)
                    .ok()
                    .and_then(|value| {
                        value
                            .get("type")
                            .and_then(Value::as_str)
                            .map(str::to_string)
                    })
                    .expect("应能序列化 runtime event")
            })
            .collect::<Vec<_>>();

        assert_eq!(
            events,
            vec![
                "task_profile_resolved".to_string(),
                "candidate_set_resolved".to_string(),
                "routing_decision_made".to_string(),
                "limit_state_updated".to_string(),
                "single_candidate_only".to_string(),
                "cost_estimated".to_string(),
            ]
        );
    }

    #[test]
    fn collect_runtime_request_resolution_side_events_should_emit_routing_not_possible() {
        let metadata = json!({
            "lime_runtime": {
                "routing_decision": {
                    "routingMode": "no_candidate",
                    "decisionSource": "auto_default",
                    "decisionReason": "当前没有可用候选",
                    "candidateCount": 0
                },
                "limit_state": {
                    "status": "no_candidate",
                    "singleCandidateOnly": false,
                    "providerLocked": false,
                    "settingsLocked": false,
                    "oemLocked": false,
                    "candidateCount": 0
                }
            }
        });

        let events = collect_runtime_request_resolution_side_events(Some(&metadata))
            .into_iter()
            .map(|event| {
                serde_json::to_value(event)
                    .ok()
                    .and_then(|value| {
                        value
                            .get("type")
                            .and_then(Value::as_str)
                            .map(str::to_string)
                    })
                    .expect("应能序列化 runtime event")
            })
            .collect::<Vec<_>>();

        assert_eq!(
            events,
            vec![
                "candidate_set_resolved".to_string(),
                "routing_decision_made".to_string(),
                "routing_not_possible".to_string(),
                "limit_state_updated".to_string(),
            ]
        );
    }

    #[test]
    fn map_runtime_limit_event_to_runtime_agent_event_should_cover_quota_low() {
        let event = map_runtime_limit_event_to_runtime_agent_event(
            lime_agent::SessionExecutionRuntimeLimitEvent {
                event_kind: "quota_low".to_string(),
                message: "额度偏低".to_string(),
                retryable: true,
            },
        );

        let event_type = serde_json::to_value(event)
            .ok()
            .and_then(|value| {
                value
                    .get("type")
                    .and_then(Value::as_str)
                    .map(str::to_string)
            })
            .expect("应能序列化 runtime limit event");

        assert_eq!(event_type, "quota_low");
    }

    #[test]
    fn build_submit_accepted_runtime_status_should_use_preparing_copy() {
        let status = build_submit_accepted_runtime_status();

        assert_eq!(status.phase, "preparing");
        assert_eq!(status.title, "已接收请求，正在准备执行");
        assert_eq!(
            status.detail,
            "系统正在初始化本轮执行环境并整理上下文，稍后会继续返回更详细进度。"
        );
        assert_eq!(
            status.checkpoints,
            vec![
                "请求已进入运行时主链".to_string(),
                "正在准备工作区与会话上下文".to_string(),
                "等待后续详细执行事件".to_string(),
            ]
        );
        assert!(status.metadata.is_none());
    }
}
