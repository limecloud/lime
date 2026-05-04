use crate::agent::aster_state::ProviderConfig;
use crate::agent::AsterAgentState;
use crate::config::GlobalConfigManagerState;
use crate::database::DbConnection;
use aster::session::TurnContextOverride;
use serde_json::{Map, Value};

const LIME_RUNTIME_METADATA_KEY: &str = "lime_runtime";

#[derive(Debug, Clone, Copy)]
pub enum AuxiliaryServiceModelSlot {
    Topic,
    GenerationTopic,
    AgentMeta,
    HistoryCompress,
}

impl AuxiliaryServiceModelSlot {
    pub fn service_model_slot_key(self) -> &'static str {
        match self {
            Self::Topic => "topic",
            Self::GenerationTopic => "generation_topic",
            Self::AgentMeta => "agent_meta",
            Self::HistoryCompress => "history_compress",
        }
    }

    pub fn task_kind(self) -> &'static str {
        match self {
            Self::Topic => "title_generation",
            Self::GenerationTopic => "generation_topic",
            Self::AgentMeta => "agent_meta",
            Self::HistoryCompress => "history_compress",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuxiliaryProviderResolution {
    pub service_model_slot: String,
    pub task_kind: String,
    pub decision_source: String,
    pub decision_reason: String,
    pub selected_provider: Option<String>,
    pub selected_model: Option<String>,
    pub requested_provider: Option<String>,
    pub requested_model: Option<String>,
    pub fallback_chain: Vec<String>,
    pub settings_source: Option<String>,
    pub estimated_cost_class: Option<String>,
}

pub struct AuxiliaryProviderScope {
    previous_provider_config: Option<ProviderConfig>,
    restore_session_id: String,
    should_restore: bool,
    resolution: AuxiliaryProviderResolution,
}

impl AuxiliaryProviderScope {
    pub fn resolution(&self) -> &AuxiliaryProviderResolution {
        &self.resolution
    }

    pub async fn restore(self, agent_state: &AsterAgentState, db: &DbConnection) {
        if !self.should_restore {
            return;
        }

        let Some(previous_provider_config) = self.previous_provider_config else {
            return;
        };

        if let Err(error) = agent_state
            .configure_provider(previous_provider_config, &self.restore_session_id, db)
            .await
        {
            tracing::warn!(
                "[AuxiliaryModel] 恢复之前的 Provider 失败: session_id={}, error={}",
                self.restore_session_id,
                error
            );
        }
    }
}

fn estimate_cost_class_from_model(model_name: Option<&str>) -> Option<String> {
    let normalized = normalize_optional_string(model_name)?.to_ascii_lowercase();
    if normalized.contains("mini")
        || normalized.contains("haiku")
        || normalized.contains("flash")
        || normalized.contains("nano")
        || normalized.contains("small")
    {
        return Some("low".to_string());
    }
    if normalized.contains("opus")
        || normalized.contains("max")
        || normalized.contains("ultra")
        || normalized.contains("pro")
    {
        return Some("high".to_string());
    }

    Some("medium".to_string())
}

fn resolve_selected_provider(config: &ProviderConfig) -> Option<String> {
    normalize_optional_string(config.provider_selector.as_deref())
        .or_else(|| normalize_optional_string(Some(config.provider_name.as_str())))
}

fn build_auxiliary_provider_resolution(
    slot: AuxiliaryServiceModelSlot,
    decision_source: &str,
    decision_reason: String,
    selected_provider: Option<String>,
    selected_model: Option<String>,
    requested_provider: Option<String>,
    requested_model: Option<String>,
    fallback_chain: Vec<String>,
    settings_source: Option<String>,
) -> AuxiliaryProviderResolution {
    AuxiliaryProviderResolution {
        service_model_slot: slot.service_model_slot_key().to_string(),
        task_kind: slot.task_kind().to_string(),
        decision_source: decision_source.to_string(),
        decision_reason,
        estimated_cost_class: estimate_cost_class_from_model(selected_model.as_deref()),
        selected_provider,
        selected_model,
        requested_provider,
        requested_model,
        fallback_chain,
        settings_source,
    }
}

fn insert_serialized_runtime_metadata<T: serde::Serialize>(
    runtime_object: &mut Map<String, Value>,
    key: &str,
    payload: &T,
) {
    if let Ok(value) = serde_json::to_value(payload) {
        runtime_object.insert(key.to_string(), value);
    }
}

fn push_unique_non_empty_string(values: &mut Vec<String>, candidate: Option<&str>) {
    let Some(candidate) = normalize_optional_string(candidate) else {
        return;
    };
    if values.iter().any(|existing| existing == &candidate) {
        return;
    }
    values.push(candidate);
}

pub fn build_auxiliary_turn_context_override(
    request_metadata: Option<serde_json::Value>,
) -> Option<TurnContextOverride> {
    let metadata = request_metadata?.as_object()?.clone();
    Some(TurnContextOverride {
        metadata: metadata.into_iter().collect(),
        ..TurnContextOverride::default()
    })
}

pub fn build_auxiliary_runtime_metadata(
    resolution: &AuxiliaryProviderResolution,
    source: &str,
    entry_source: Option<&str>,
    traits: &[&str],
    notes: &[&str],
) -> Option<serde_json::Value> {
    let source = normalize_optional_string(Some(source))?;
    let has_selection =
        resolution.selected_provider.is_some() || resolution.selected_model.is_some();
    let candidate_count = if has_selection { 1 } else { 0 };
    let mut task_traits = Vec::new();
    for trait_value in traits {
        push_unique_non_empty_string(&mut task_traits, Some(*trait_value));
    }

    let mut limit_notes = Vec::new();
    push_unique_non_empty_string(&mut limit_notes, Some(resolution.decision_reason.as_str()));
    for note in notes {
        push_unique_non_empty_string(&mut limit_notes, Some(*note));
    }

    let task_profile = lime_agent::SessionExecutionRuntimeTaskProfile {
        kind: resolution.task_kind.clone(),
        source,
        traits: task_traits,
        modality_contract_key: None,
        routing_slot: None,
        execution_profile_key: None,
        executor_adapter_key: None,
        executor_kind: None,
        executor_binding_key: None,
        permission_profile_keys: Vec::new(),
        user_lock_policy: None,
        service_model_slot: normalize_optional_string(Some(resolution.service_model_slot.as_str())),
        scene_kind: None,
        scene_skill_id: None,
        entry_source: normalize_optional_string(entry_source),
    };
    let routing_decision = lime_agent::SessionExecutionRuntimeRoutingDecision {
        routing_mode: if has_selection {
            "single_candidate".to_string()
        } else {
            "no_candidate".to_string()
        },
        decision_source: resolution.decision_source.clone(),
        decision_reason: resolution.decision_reason.clone(),
        selected_provider: resolution.selected_provider.clone(),
        selected_model: resolution.selected_model.clone(),
        requested_provider: resolution.requested_provider.clone(),
        requested_model: resolution.requested_model.clone(),
        candidate_count,
        estimated_cost_class: resolution.estimated_cost_class.clone(),
        capability_gap: None,
        fallback_chain: resolution.fallback_chain.clone(),
        settings_source: resolution.settings_source.clone(),
        service_model_slot: normalize_optional_string(Some(resolution.service_model_slot.as_str())),
    };
    let limit_state = lime_agent::SessionExecutionRuntimeLimitState {
        status: if has_selection {
            "single_candidate_only".to_string()
        } else {
            "no_candidate".to_string()
        },
        single_candidate_only: has_selection,
        provider_locked: has_selection,
        settings_locked: resolution.settings_source.is_some(),
        oem_locked: false,
        candidate_count,
        capability_gap: None,
        notes: limit_notes,
    };
    let cost_state = lime_agent::SessionExecutionRuntimeCostState {
        status: if has_selection {
            "estimated".to_string()
        } else {
            "unavailable".to_string()
        },
        estimated_cost_class: resolution.estimated_cost_class.clone(),
        input_per_million: None,
        output_per_million: None,
        cache_read_per_million: None,
        cache_write_per_million: None,
        currency: None,
        estimated_total_cost: None,
        input_tokens: None,
        output_tokens: None,
        total_tokens: None,
        cached_input_tokens: None,
        cache_creation_input_tokens: None,
    };
    let permission_state = lime_agent::SessionExecutionRuntimePermissionState {
        status: "not_required".to_string(),
        required_profile_keys: Vec::new(),
        ask_profile_keys: Vec::new(),
        blocking_profile_keys: Vec::new(),
        decision_source: "execution_profile_registry".to_string(),
        decision_scope: "declared_permission_profiles_only".to_string(),
        confirmation_status: Some("not_required".to_string()),
        confirmation_request_id: None,
        confirmation_source: Some("declared_profile_only".to_string()),
        notes: vec!["内部辅助任务未声明 permissionProfileKeys。".to_string()],
    };

    let mut root = Map::new();
    let mut runtime_object = Map::new();
    insert_serialized_runtime_metadata(&mut runtime_object, "task_profile", &task_profile);
    insert_serialized_runtime_metadata(&mut runtime_object, "routing_decision", &routing_decision);
    insert_serialized_runtime_metadata(&mut runtime_object, "limit_state", &limit_state);
    insert_serialized_runtime_metadata(&mut runtime_object, "cost_state", &cost_state);
    insert_serialized_runtime_metadata(&mut runtime_object, "permission_state", &permission_state);
    root.insert(
        LIME_RUNTIME_METADATA_KEY.to_string(),
        Value::Object(runtime_object),
    );
    Some(Value::Object(root))
}

fn normalize_optional_string(value: Option<&str>) -> Option<String> {
    let trimmed = value?.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn resolve_preference_ids(
    config: &lime_core::config::Config,
    slot: AuxiliaryServiceModelSlot,
) -> (Option<String>, Option<String>) {
    let preference = match slot {
        AuxiliaryServiceModelSlot::Topic => &config.workspace_preferences.service_models.topic,
        AuxiliaryServiceModelSlot::GenerationTopic => {
            &config.workspace_preferences.service_models.generation_topic
        }
        AuxiliaryServiceModelSlot::AgentMeta => {
            &config.workspace_preferences.service_models.agent_meta
        }
        AuxiliaryServiceModelSlot::HistoryCompress => {
            &config.workspace_preferences.service_models.history_compress
        }
    };

    (
        normalize_optional_string(preference.preferred_provider_id.as_deref()),
        normalize_optional_string(preference.preferred_model_id.as_deref()),
    )
}

pub async fn prepare_auxiliary_provider_scope(
    agent_state: &AsterAgentState,
    db: &DbConnection,
    config_manager: &GlobalConfigManagerState,
    session_id: &str,
    slot: AuxiliaryServiceModelSlot,
    fallback_chain: &[(&str, &str)],
) -> Result<AuxiliaryProviderScope, String> {
    agent_state.init_agent_with_db(db).await?;

    let previous_provider_config = agent_state.get_provider_config().await;
    let config = config_manager.config();
    let (preferred_provider_id, preferred_model_id) = resolve_preference_ids(&config, slot);
    let slot_settings_source = format!("service_models.{}", slot.service_model_slot_key());
    let had_explicit_service_model =
        preferred_provider_id.is_some() && preferred_model_id.is_some();

    if let (Some(provider_id), Some(model_id)) = (
        preferred_provider_id.as_deref(),
        preferred_model_id.as_deref(),
    ) {
        match agent_state
            .configure_provider_from_pool(db, provider_id, model_id, session_id)
            .await
        {
            Ok(_) => {
                let should_restore = previous_provider_config.is_some();
                let current_provider_config = agent_state.get_provider_config().await;
                let selected_provider = current_provider_config
                    .as_ref()
                    .and_then(resolve_selected_provider)
                    .or_else(|| normalize_optional_string(Some(provider_id)));
                let selected_model = current_provider_config
                    .as_ref()
                    .and_then(|config| normalize_optional_string(Some(config.model_name.as_str())))
                    .or_else(|| normalize_optional_string(Some(model_id)));
                return Ok(AuxiliaryProviderScope {
                    previous_provider_config,
                    restore_session_id: session_id.to_string(),
                    should_restore,
                    resolution: build_auxiliary_provider_resolution(
                        slot,
                        "service_model_setting",
                        format!("命中 {slot_settings_source}"),
                        selected_provider,
                        selected_model,
                        normalize_optional_string(Some(provider_id)),
                        normalize_optional_string(Some(model_id)),
                        Vec::new(),
                        Some(slot_settings_source.clone()),
                    ),
                });
            }
            Err(error) => {
                tracing::warn!(
                    "[AuxiliaryModel] 指定服务模型不可用，继续回退当前 Provider: slot={:?}, provider={}, model={}, error={}",
                    slot,
                    provider_id,
                    model_id,
                    error
                );
            }
        }
    }

    if previous_provider_config.is_some() {
        let selected_provider = previous_provider_config
            .as_ref()
            .and_then(resolve_selected_provider);
        let selected_model = previous_provider_config
            .as_ref()
            .and_then(|config| normalize_optional_string(Some(config.model_name.as_str())));
        let fallback_chain = if had_explicit_service_model {
            vec![format!("{slot_settings_source} -> session_default")]
        } else {
            Vec::new()
        };
        let decision_reason = if had_explicit_service_model {
            format!("{slot_settings_source} 不可用，沿用当前 provider/model。")
        } else {
            format!("当前未配置 {slot_settings_source}，沿用当前 provider/model。")
        };
        return Ok(AuxiliaryProviderScope {
            previous_provider_config,
            restore_session_id: session_id.to_string(),
            should_restore: false,
            resolution: build_auxiliary_provider_resolution(
                slot,
                "session_default",
                decision_reason,
                selected_provider,
                selected_model,
                preferred_provider_id.clone(),
                preferred_model_id.clone(),
                fallback_chain,
                had_explicit_service_model.then_some(slot_settings_source.clone()),
            ),
        });
    }

    for (provider_id, model_id) in fallback_chain {
        match agent_state
            .configure_provider_from_pool(db, provider_id, model_id, session_id)
            .await
        {
            Ok(_) => {
                let current_provider_config = agent_state.get_provider_config().await;
                let selected_provider = current_provider_config
                    .as_ref()
                    .and_then(resolve_selected_provider)
                    .or_else(|| normalize_optional_string(Some(provider_id)));
                let selected_model = current_provider_config
                    .as_ref()
                    .and_then(|config| normalize_optional_string(Some(config.model_name.as_str())))
                    .or_else(|| normalize_optional_string(Some(model_id)));
                let mut fallback_runtime_chain = Vec::new();
                if had_explicit_service_model {
                    fallback_runtime_chain.push(format!(
                        "{slot_settings_source} -> {provider_id}/{model_id}"
                    ));
                } else {
                    fallback_runtime_chain
                        .push(format!("auxiliary_default -> {provider_id}/{model_id}"));
                }
                return Ok(AuxiliaryProviderScope {
                    previous_provider_config: None,
                    restore_session_id: session_id.to_string(),
                    should_restore: false,
                    resolution: build_auxiliary_provider_resolution(
                        slot,
                        "auxiliary_fallback",
                        if had_explicit_service_model {
                            format!("{slot_settings_source} 不可用，已回退辅助默认链路。")
                        } else {
                            format!("当前未配置 {slot_settings_source}，已使用辅助默认链路。")
                        },
                        selected_provider,
                        selected_model,
                        preferred_provider_id.clone(),
                        preferred_model_id.clone(),
                        fallback_runtime_chain,
                        had_explicit_service_model.then_some(slot_settings_source.clone()),
                    ),
                });
            }
            Err(error) => {
                tracing::debug!(
                    "[AuxiliaryModel] 回退 Provider 失败，继续尝试下一个: slot={:?}, provider={}, model={}, error={}",
                    slot,
                    provider_id,
                    model_id,
                    error
                );
            }
        }
    }

    Err("没有可用的 AI 凭证，请先在设置中添加凭证".to_string())
}
