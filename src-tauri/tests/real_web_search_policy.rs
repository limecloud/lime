use futures::StreamExt;
use lime_agent::event_converter::convert_agent_event;
use lime_agent::{
    merge_system_prompt_with_request_tool_policy, resolve_request_tool_policy, AgentEvent,
    AsterAgentState, SessionConfigBuilder, WebSearchExecutionTracker,
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

    Err(
        "未找到可用模型：请设置 LIME_REAL_MODEL，或在 Provider custom_models 中配置模型（兼容旧的 PROXYCAST_REAL_MODEL）。"
            .to_string(),
    )
}

fn resolve_codex_provider_and_model(
    db: &lime_core::database::DbConnection,
) -> Result<(String, String), String> {
    let explicit_model = lime_core::env_compat::var(&["LIME_REAL_MODEL", "PROXYCAST_REAL_MODEL"]);

    if let Some(explicit) =
        lime_core::env_compat::var(&["LIME_REAL_PROVIDER_ID", "PROXYCAST_REAL_PROVIDER_ID"])
    {
        let trimmed = explicit.trim();
        if !trimmed.is_empty() {
            let service = ApiKeyProviderService::new();
            let provider = service
                .get_provider(db, trimmed)?
                .ok_or_else(|| format!("未找到指定 Provider: {trimmed}"))?;
            let model = resolve_model_name(explicit_model, &provider.provider.custom_models)?;
            return Ok((trimmed.to_string(), model));
        }
    }

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

#[derive(Debug, Default)]
struct RealRunSummary {
    session_id: String,
    web_search: bool,
    model: String,
    tool_start_count: usize,
    tool_end_count: usize,
    web_search_tool_names: Vec<String>,
    errors: Vec<String>,
    final_text_preview: String,
}

async fn run_real_case(
    state: &AsterAgentState,
    db: &lime_core::database::DbConnection,
    provider_id: &str,
    model_name: &str,
    web_search: bool,
    prompt: &str,
) -> Result<RealRunSummary, String> {
    let session_id = format!("real-web-policy-{}", Uuid::new_v4());
    state
        .configure_provider_from_pool(db, provider_id, model_name, &session_id)
        .await
        .map_err(|e| format!("配置 Provider 失败: {e}"))?;

    let agent_arc = state.get_agent_arc();
    let guard = agent_arc.read().await;
    let agent = guard.as_ref().ok_or_else(|| "Agent 未初始化".to_string())?;

    let policy = resolve_request_tool_policy(Some(web_search), false);
    let merged_prompt = merge_system_prompt_with_request_tool_policy(None, &policy);
    let mut session_config_builder = SessionConfigBuilder::new(&session_id);
    if let Some(system_prompt) = merged_prompt {
        session_config_builder = session_config_builder.system_prompt(system_prompt);
    }
    let session_config = session_config_builder.build();

    let user_message = aster::conversation::message::Message::user().with_text(prompt);
    let mut stream = agent
        .reply(user_message, session_config, None)
        .await
        .map_err(|e| format!("创建流式回复失败: {e}"))?;

    let mut summary = RealRunSummary {
        session_id,
        web_search,
        model: model_name.to_string(),
        ..RealRunSummary::default()
    };
    let mut tracker = WebSearchExecutionTracker::default();
    let mut text_buffer = String::new();

    while let Some(event_result) = stream.next().await {
        match event_result {
            Ok(agent_event) => {
                for event in convert_agent_event(agent_event) {
                    match &event {
                        AgentEvent::ToolStart {
                            tool_name, tool_id, ..
                        } => {
                            summary.tool_start_count += 1;
                            tracker.record_tool_start(&policy, tool_id, tool_name);
                            if tool_name.to_ascii_lowercase().contains("websearch") {
                                summary.web_search_tool_names.push(tool_name.clone());
                            }
                        }
                        AgentEvent::ToolEnd { tool_id, result } => {
                            summary.tool_end_count += 1;
                            tracker.record_tool_end(
                                &policy,
                                tool_id,
                                result.success,
                                result.error.as_deref(),
                            );
                        }
                        AgentEvent::TextDelta { text } => text_buffer.push_str(text),
                        AgentEvent::Error { message } => summary.errors.push(message.clone()),
                        _ => {}
                    }
                }
            }
            Err(error) => summary.errors.push(format!("stream_error: {error}")),
        }
    }

    if let Err(error) = tracker.validate_web_search_requirement(&policy) {
        summary.errors.push(error);
    }

    summary.final_text_preview = text_buffer.chars().take(280).collect();
    Ok(summary)
}

#[tokio::test]
#[ignore = "真实联网测试：设置 LIME_REAL_API_TEST=1 后执行"]
async fn test_real_gpt53_codex_web_search_scenarios() {
    if !should_run_real_test() {
        return;
    }

    let db = init_database().expect("初始化数据库失败");
    let (provider_id, resolved_model) =
        resolve_codex_provider_and_model(&db).expect("解析 Codex Provider/模型失败");
    let model_name = lime_core::env_compat::var(&["LIME_REAL_MODEL", "PROXYCAST_REAL_MODEL"])
        .unwrap_or_else(|| {
            if resolved_model.trim().is_empty() {
                "gpt-5.3-codex".to_string()
            } else {
                resolved_model
            }
        });

    assert_eq!(
        model_name.trim(),
        "gpt-5.3-codex",
        "本测试仅允许使用 gpt-5.3-codex"
    );

    let state = AsterAgentState::new();

    let scenario_a = run_real_case(
        &state,
        &db,
        &provider_id,
        &model_name,
        false,
        "场景A：webSearch=false。请简要解释什么是 Rust 的所有权模型。",
    )
    .await
    .expect("场景A调用失败");

    println!(
        "[ScenarioA] request={{model:{}, web_search:{}, session:{}}} events={{tool_start:{}, tool_end:{}, web_search_tools:{:?}}} errors={:?} final_preview={}",
        scenario_a.model,
        scenario_a.web_search,
        scenario_a.session_id,
        scenario_a.tool_start_count,
        scenario_a.tool_end_count,
        scenario_a.web_search_tool_names,
        scenario_a.errors,
        scenario_a.final_text_preview
    );
    assert!(
        scenario_a.errors.is_empty(),
        "场景A出现错误: {:?}",
        scenario_a.errors
    );

    let scenario_b = run_real_case(
        &state,
        &db,
        &provider_id,
        &model_name,
        true,
        "场景B：webSearch=true。请搜索并总结2026年3月4日全球重要新闻，给出来源链接。",
    )
    .await
    .expect("场景B调用失败");

    println!(
        "[ScenarioB] request={{model:{}, web_search:{}, session:{}}} events={{tool_start:{}, tool_end:{}, web_search_tools:{:?}}} errors={:?} final_preview={}",
        scenario_b.model,
        scenario_b.web_search,
        scenario_b.session_id,
        scenario_b.tool_start_count,
        scenario_b.tool_end_count,
        scenario_b.web_search_tool_names,
        scenario_b.errors,
        scenario_b.final_text_preview
    );

    assert!(
        scenario_b.errors.is_empty(),
        "场景B出现错误: {:?}",
        scenario_b.errors
    );
    assert!(
        scenario_b
            .web_search_tool_names
            .iter()
            .any(|name| name.to_ascii_lowercase().contains("websearch")),
        "场景B必须包含 WebSearch 工具调用，实际: {:?}",
        scenario_b.web_search_tool_names
    );
    assert!(
        scenario_b.tool_start_count > 0 && scenario_b.tool_end_count > 0,
        "场景B必须出现 tool_start/tool_end 事件，实际: start={}, end={}",
        scenario_b.tool_start_count,
        scenario_b.tool_end_count
    );
}
