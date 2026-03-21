use super::*;

fn extract_provider_continuation_value(
    metadata: &HashMap<String, serde_json::Value>,
    keys: &[&str],
) -> Option<String> {
    for key in keys {
        let value = metadata.get(*key).and_then(serde_json::Value::as_str);
        let Some(value) = normalize_optional_text(value.map(str::to_string)) else {
            continue;
        };
        return Some(value);
    }
    None
}

pub(super) fn extract_provider_continuation_from_metadata(
    metadata: &HashMap<String, serde_json::Value>,
    capability: ProviderContinuationCapability,
) -> Option<ProviderContinuationState> {
    match capability {
        ProviderContinuationCapability::HistoryReplayOnly => None,
        ProviderContinuationCapability::PreviousResponseId => extract_provider_continuation_value(
            metadata,
            &["previous_response_id", "previousResponseId"],
        )
        .map(ProviderContinuationState::previous_response_id),
        ProviderContinuationCapability::ProviderSessionToken => {
            extract_provider_continuation_value(
                metadata,
                &[
                    "provider_session_token",
                    "providerSessionToken",
                    "session_token",
                    "sessionToken",
                    "conversation_id",
                    "conversationId",
                ],
            )
            .map(ProviderContinuationState::provider_session_token)
        }
        ProviderContinuationCapability::StickyRoutingHint => {
            extract_provider_continuation_value(metadata, &["routing_hint", "routingHint"])
                .map(ProviderContinuationState::sticky_routing_hint)
        }
    }
}

pub(super) fn extract_provider_continuation_from_message(
    message: &TauriMessage,
    capability: ProviderContinuationCapability,
) -> Option<ProviderContinuationState> {
    for content in &message.content {
        if let TauriMessageContent::ToolResponse {
            metadata: Some(metadata),
            ..
        } = content
        {
            if let Some(provider_continuation) =
                extract_provider_continuation_from_metadata(metadata, capability)
            {
                return Some(provider_continuation);
            }
        }
    }

    if message.role == "assistant" {
        if capability == ProviderContinuationCapability::PreviousResponseId {
            return message
                .id
                .clone()
                .map(ProviderContinuationState::previous_response_id);
        }

        if capability == ProviderContinuationCapability::ProviderSessionToken {
            return message
                .id
                .clone()
                .map(ProviderContinuationState::provider_session_token);
        }
    }

    None
}

fn extract_provider_routing_from_run_metadata(
    metadata: &serde_json::Value,
) -> Option<TurnProviderRoutingSnapshot> {
    metadata
        .get("turn_input")
        .and_then(|value| value.get("provider_routing"))
        .cloned()
        .and_then(|value| serde_json::from_value(value).ok())
}

fn extract_provider_continuation_from_run_metadata(
    metadata: &serde_json::Value,
) -> Option<ProviderContinuationState> {
    metadata
        .get("provider_continuation")
        .cloned()
        .or_else(|| {
            metadata
                .get("turn_input")
                .and_then(|value| value.get("provider_continuation"))
                .cloned()
        })
        .and_then(|value| serde_json::from_value::<ProviderContinuationState>(value).ok())
        .filter(|state| !matches!(state, ProviderContinuationState::HistoryReplayOnly))
}

fn normalize_provider_identifier(value: Option<&str>) -> Option<String> {
    normalize_optional_text(value.map(str::to_string)).map(|value| value.to_ascii_lowercase())
}

pub(in crate::commands::aster_agent_cmd) fn provider_routing_matches_current(
    previous: &TurnProviderRoutingSnapshot,
    current: &TurnProviderRoutingSnapshot,
) -> bool {
    let same_provider = normalize_provider_identifier(Some(previous.provider_name.as_str()))
        == normalize_provider_identifier(Some(current.provider_name.as_str()));
    let same_model = normalize_provider_identifier(Some(previous.model_name.as_str()))
        == normalize_provider_identifier(Some(current.model_name.as_str()));
    let same_selector = match (
        normalize_provider_identifier(previous.provider_selector.as_deref()),
        normalize_provider_identifier(current.provider_selector.as_deref()),
    ) {
        (Some(left), Some(right)) => left == right,
        _ => true,
    };

    same_provider && same_model && same_selector
}

pub(in crate::commands::aster_agent_cmd) fn load_previous_provider_continuation_state(
    db: &DbConnection,
    session_id: &str,
    current_routing: Option<&TurnProviderRoutingSnapshot>,
    capability: ProviderContinuationCapability,
) -> ProviderContinuationState {
    if !capability.supports_remote_continuation() {
        return ProviderContinuationState::history_replay_only();
    }

    let Some(current_routing) = current_routing else {
        return ProviderContinuationState::history_replay_only();
    };

    let conn = match crate::database::lock_db(db) {
        Ok(conn) => conn,
        Err(error) => {
            tracing::warn!(
                "[AsterAgent] 读取 provider continuation 时数据库锁定失败: session_id={}, error={}",
                session_id,
                error
            );
            return ProviderContinuationState::history_replay_only();
        }
    };

    let runs = match lime_core::database::dao::agent_run::AgentRunDao::list_terminal_runs_by_session(
        &conn, session_id, 12, 0,
    ) {
        Ok(runs) => runs,
        Err(error) => {
            tracing::warn!(
                "[AsterAgent] 查询历史 terminal runs 失败，忽略 provider continuation 恢复: session_id={}, error={}",
                session_id,
                error
            );
            return ProviderContinuationState::history_replay_only();
        }
    };

    for run in runs {
        let Some(metadata_text) = run.metadata.as_deref() else {
            continue;
        };
        let Ok(metadata_value) = serde_json::from_str::<serde_json::Value>(metadata_text) else {
            continue;
        };
        let Some(previous_routing) = extract_provider_routing_from_run_metadata(&metadata_value)
        else {
            continue;
        };
        if !provider_routing_matches_current(&previous_routing, current_routing) {
            continue;
        }
        let Some(provider_continuation) =
            extract_provider_continuation_from_run_metadata(&metadata_value)
        else {
            continue;
        };
        if provider_continuation.matches_capability(capability) {
            return provider_continuation;
        }
    }

    ProviderContinuationState::history_replay_only()
}
