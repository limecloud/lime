use lime_agent::{
    execute_web_search_preflight_if_needed, resolve_request_tool_policy_with_mode, AsterAgentState,
    RequestToolPolicyMode, WebSearchExecutionTracker,
};
use lime_core::database::dao::api_key_provider::ApiProviderType;
use lime_core::database::init_database;
use lime_services::api_key_provider_service::ApiKeyProviderService;
use uuid::Uuid;

fn should_run_real_test() -> bool {
    lime_core::env_compat::var(&["LIME_REAL_API_TEST", "PROXYCAST_REAL_API_TEST"]).as_deref()
        == Some("1")
}

fn resolve_model_name(
    explicit: Option<String>,
    provider_models: &[String],
) -> Result<String, String> {
    if let Some(model) = explicit
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return Ok(model.to_string());
    }

    if let Some(model) = provider_models
        .iter()
        .map(|value| value.trim())
        .find(|value| !value.is_empty())
    {
        return Ok(model.to_string());
    }

    Err("未找到可用模型".to_string())
}

fn resolve_codex_provider_and_model(
    db: &lime_core::database::DbConnection,
) -> Result<(String, String), String> {
    let explicit_model = lime_core::env_compat::var(&["LIME_REAL_MODEL", "PROXYCAST_REAL_MODEL"]);
    let service = ApiKeyProviderService::new();
    let providers = service.get_all_providers(db)?;

    providers
        .into_iter()
        .find(|item| {
            item.provider.enabled
                && item.provider.provider_type == ApiProviderType::Codex
                && item.api_keys.iter().any(|key| key.enabled)
        })
        .map(|item| -> Result<(String, String), String> {
            let model = resolve_model_name(explicit_model, &item.provider.custom_models)?;
            Ok((item.provider.id, model))
        })
        .transpose()?
        .ok_or_else(|| "未找到启用且含可用 Key 的 Codex Provider".to_string())
}

#[tokio::test]
#[ignore = "真实联网测试：设置 LIME_REAL_API_TEST=1 后执行"]
async fn test_real_web_search_preflight_short_input_continue() {
    if !should_run_real_test() {
        return;
    }

    let db = init_database().expect("初始化数据库失败");
    let (provider_id, resolved_model) =
        resolve_codex_provider_and_model(&db).expect("解析 Codex Provider/模型失败");
    let model_name = lime_core::env_compat::var(&["LIME_REAL_MODEL", "PROXYCAST_REAL_MODEL"])
        .unwrap_or(resolved_model);
    assert_eq!(
        model_name.trim(),
        "gpt-5.3-codex",
        "本测试仅允许使用 gpt-5.3-codex"
    );

    let state = AsterAgentState::new();
    let session_id = format!("real-web-preflight-{}", Uuid::new_v4());
    state
        .configure_provider_from_pool(&db, &provider_id, &model_name, &session_id)
        .await
        .expect("配置 Provider 失败");

    let agent_arc = state.get_agent_arc();
    let guard = agent_arc.read().await;
    let agent = guard.as_ref().expect("Agent 未初始化");

    let policy = resolve_request_tool_policy_with_mode(
        Some(true),
        Some(RequestToolPolicyMode::Required),
        false,
    );
    let mut tracker = WebSearchExecutionTracker::default();
    let mut metadata = std::collections::HashMap::new();
    metadata.insert("webSearchEnabled".to_string(), serde_json::json!(true));
    let turn_context = aster::session::TurnContextOverride {
        metadata,
        ..aster::session::TurnContextOverride::default()
    };
    let execution = execute_web_search_preflight_if_needed(
        agent,
        &session_id,
        "继续",
        None,
        None,
        Some(turn_context),
        &policy,
        &mut tracker,
    )
    .await
    .expect("预调用失败");

    let mut tool_start_count = 0usize;
    let mut tool_end_count = 0usize;
    let mut tool_names = Vec::new();
    for event in execution.events {
        match event {
            lime_agent::AgentEvent::ToolStart { tool_name, .. } => {
                tool_start_count += 1;
                tool_names.push(tool_name);
            }
            lime_agent::AgentEvent::ToolEnd { .. } => {
                tool_end_count += 1;
            }
            _ => {}
        }
    }

    println!(
        "[PreflightContinue] request={{model:{}, web_search:true, prompt:\"继续\", session:{}}} events={{tool_start:{}, tool_end:{}, tools:{:?}}}",
        model_name, session_id, tool_start_count, tool_end_count, tool_names
    );

    assert!(
        tool_names
            .iter()
            .any(|name| name.to_ascii_lowercase().contains("websearch")),
        "预调用必须包含 WebSearch，实际: {:?}",
        tool_names
    );
    assert!(tool_start_count > 0, "必须出现 tool_start");
    assert!(tool_end_count > 0, "必须出现 tool_end");
    tracker
        .validate_web_search_requirement(&policy)
        .expect("预调用后应满足必需工具约束");
}
