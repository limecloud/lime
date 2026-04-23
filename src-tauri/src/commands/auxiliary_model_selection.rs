use crate::agent::aster_state::ProviderConfig;
use crate::agent::AsterAgentState;
use crate::config::GlobalConfigManagerState;
use crate::database::DbConnection;

#[derive(Debug, Clone, Copy)]
pub enum AuxiliaryServiceModelSlot {
    Topic,
    GenerationTopic,
    AgentMeta,
    HistoryCompress,
}

pub struct AuxiliaryProviderScope {
    previous_provider_config: Option<ProviderConfig>,
    restore_session_id: String,
    should_restore: bool,
}

impl AuxiliaryProviderScope {
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
                return Ok(AuxiliaryProviderScope {
                    previous_provider_config,
                    restore_session_id: session_id.to_string(),
                    should_restore,
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
        return Ok(AuxiliaryProviderScope {
            previous_provider_config,
            restore_session_id: session_id.to_string(),
            should_restore: false,
        });
    }

    for (provider_id, model_id) in fallback_chain {
        match agent_state
            .configure_provider_from_pool(db, provider_id, model_id, session_id)
            .await
        {
            Ok(_) => {
                return Ok(AuxiliaryProviderScope {
                    previous_provider_config: None,
                    restore_session_id: session_id.to_string(),
                    should_restore: false,
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
