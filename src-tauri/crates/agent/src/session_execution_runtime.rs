use aster::session::{Session, SessionRuntimeSnapshot, TurnOutputSchemaRuntime, TurnStatus};
use serde::{Deserialize, Serialize};
use serde_json::Value;

fn normalize_optional_text(value: Option<String>) -> Option<String> {
    let trimmed = value?.trim().to_string();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SessionExecutionRuntimeSource {
    Session,
    RuntimeSnapshot,
    TurnContext,
    ModelChange,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SessionExecutionRuntimePreferences {
    pub web_search: bool,
    pub thinking: bool,
    pub task: bool,
    pub subagent: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SessionExecutionRuntime {
    pub session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider_selector: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub execution_strategy: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_schema_runtime: Option<TurnOutputSchemaRuntime>,
    pub source: SessionExecutionRuntimeSource,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latest_turn_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latest_turn_status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recent_preferences: Option<SessionExecutionRuntimePreferences>,
}

fn resolve_session_model_name(session: &Session) -> Option<String> {
    session
        .model_config
        .as_ref()
        .and_then(|config| normalize_optional_text(Some(config.model_name.clone())))
}

fn extract_bool_from_value(value: Option<&Value>) -> Option<bool> {
    value.and_then(Value::as_bool)
}

fn extract_bool_from_object(
    object: &serde_json::Map<String, Value>,
    keys: &[&str],
) -> Option<bool> {
    keys.iter()
        .find_map(|key| extract_bool_from_value(object.get(*key)))
}

fn extract_bool_from_metadata(
    metadata: &std::collections::HashMap<String, Value>,
    keys: &[&str],
) -> Option<bool> {
    keys.iter()
        .find_map(|key| extract_bool_from_value(metadata.get(*key)))
}

fn extract_recent_preferences_from_metadata(
    metadata: &std::collections::HashMap<String, Value>,
) -> Option<SessionExecutionRuntimePreferences> {
    let harness = metadata.get("harness").and_then(Value::as_object);
    let nested_preferences = harness
        .and_then(|value| value.get("preferences"))
        .and_then(Value::as_object)
        .or_else(|| metadata.get("preferences").and_then(Value::as_object));
    let resolve_nested = |keys: &[&str]| -> Option<bool> {
        nested_preferences.and_then(|value| extract_bool_from_object(value, keys))
    };
    let resolve_flat = |keys: &[&str]| -> Option<bool> {
        harness
            .and_then(|value| extract_bool_from_object(value, keys))
            .or_else(|| extract_bool_from_metadata(metadata, keys))
    };

    let web_search = resolve_nested(&["web_search", "webSearch"])
        .or_else(|| resolve_flat(&["web_search_enabled", "webSearchEnabled"]));
    let thinking = resolve_nested(&["thinking", "thinking_enabled", "thinkingEnabled"])
        .or_else(|| resolve_flat(&["thinking_enabled", "thinkingEnabled"]));
    let task = resolve_nested(&["task", "task_mode", "taskMode"])
        .or_else(|| resolve_flat(&["task_mode_enabled", "taskModeEnabled"]));
    let subagent = resolve_nested(&["subagent", "subagent_mode", "subagentMode"])
        .or_else(|| resolve_flat(&["subagent_mode_enabled", "subagentModeEnabled"]));

    if web_search.is_none() && thinking.is_none() && task.is_none() && subagent.is_none() {
        return None;
    }

    Some(SessionExecutionRuntimePreferences {
        web_search: web_search.unwrap_or(false),
        thinking: thinking.unwrap_or(false),
        task: task.unwrap_or(false),
        subagent: subagent.unwrap_or(false),
    })
}

fn resolve_latest_turn(snapshot: &SessionRuntimeSnapshot) -> Option<&aster::session::TurnRuntime> {
    snapshot
        .threads
        .iter()
        .flat_map(|thread| thread.turns.iter())
        .max_by(|left, right| {
            left.updated_at
                .cmp(&right.updated_at)
                .then_with(|| left.created_at.cmp(&right.created_at))
                .then_with(|| left.id.cmp(&right.id))
        })
}

fn map_turn_status(status: TurnStatus) -> String {
    match status {
        TurnStatus::Queued => "queued".to_string(),
        TurnStatus::Running => "running".to_string(),
        TurnStatus::Completed => "completed".to_string(),
        TurnStatus::Failed => "failed".to_string(),
        TurnStatus::Aborted => "aborted".to_string(),
    }
}

pub fn build_session_execution_runtime(
    session_id: &str,
    session: Option<&Session>,
    execution_strategy: Option<String>,
    snapshot: Option<&SessionRuntimeSnapshot>,
    provider_selector: Option<String>,
) -> Option<SessionExecutionRuntime> {
    let mut runtime = SessionExecutionRuntime {
        session_id: session_id.to_string(),
        provider_selector: normalize_optional_text(provider_selector),
        provider_name: session
            .and_then(|value| normalize_optional_text(value.provider_name.clone())),
        model_name: session.and_then(resolve_session_model_name),
        execution_strategy: normalize_optional_text(execution_strategy),
        output_schema_runtime: None,
        source: SessionExecutionRuntimeSource::Session,
        mode: None,
        latest_turn_id: None,
        latest_turn_status: None,
        recent_preferences: None,
    };

    if let Some(latest_turn) = snapshot.and_then(resolve_latest_turn) {
        runtime.latest_turn_id = Some(latest_turn.id.clone());
        runtime.latest_turn_status = Some(map_turn_status(latest_turn.status));
        runtime.output_schema_runtime = latest_turn.output_schema_runtime.clone();
        runtime.model_name = latest_turn
            .output_schema_runtime
            .as_ref()
            .and_then(|value| normalize_optional_text(value.model_name.clone()))
            .or_else(|| {
                latest_turn
                    .context_override
                    .as_ref()
                    .and_then(|value| normalize_optional_text(value.model.clone()))
            })
            .or(runtime.model_name);
        runtime.provider_name = latest_turn
            .output_schema_runtime
            .as_ref()
            .and_then(|value| normalize_optional_text(value.provider_name.clone()))
            .or(runtime.provider_name);
        runtime.recent_preferences = latest_turn
            .context_override
            .as_ref()
            .and_then(|value| extract_recent_preferences_from_metadata(&value.metadata));
        runtime.source = SessionExecutionRuntimeSource::RuntimeSnapshot;
    }

    if runtime.provider_selector.is_none()
        && runtime.provider_name.is_none()
        && runtime.model_name.is_none()
        && runtime.output_schema_runtime.is_none()
        && runtime.recent_preferences.is_none()
    {
        return None;
    }

    Some(runtime)
}

#[cfg(test)]
mod tests {
    use super::{
        build_session_execution_runtime, SessionExecutionRuntimePreferences,
        SessionExecutionRuntimeSource,
    };
    use aster::model::ModelConfig;
    use aster::session::{
        Session, SessionRuntimeSnapshot, ThreadRuntime, ThreadRuntimeSnapshot, TurnContextOverride,
        TurnOutputSchemaRuntime, TurnOutputSchemaSource, TurnOutputSchemaStrategy, TurnRuntime,
        TurnStatus,
    };
    use chrono::{Duration, Utc};
    use serde_json::json;
    use std::path::PathBuf;

    #[test]
    fn falls_back_to_session_when_runtime_snapshot_missing() {
        let mut session = Session::default();
        session.id = "session-1".to_string();
        session.provider_name = Some("openai".to_string());
        session.model_config = Some(ModelConfig::new("gpt-5.1").expect("model config"));

        let runtime = build_session_execution_runtime(
            "session-1",
            Some(&session),
            Some("react".to_string()),
            None,
            Some("openai".to_string()),
        )
        .expect("runtime");

        assert_eq!(runtime.source, SessionExecutionRuntimeSource::Session);
        assert_eq!(runtime.provider_selector.as_deref(), Some("openai"));
        assert_eq!(runtime.provider_name.as_deref(), Some("openai"));
        assert_eq!(runtime.model_name.as_deref(), Some("gpt-5.1"));
        assert_eq!(runtime.execution_strategy.as_deref(), Some("react"));
        assert!(runtime.output_schema_runtime.is_none());
        assert!(runtime.recent_preferences.is_none());
    }

    #[test]
    fn prefers_latest_runtime_snapshot_with_output_schema_runtime() {
        let now = Utc::now();
        let mut session = Session::default();
        session.id = "session-2".to_string();
        session.provider_name = Some("openai".to_string());
        session.model_config = Some(ModelConfig::new("gpt-5.1").expect("model config"));

        let latest_turn = TurnRuntime {
            id: "turn-new".to_string(),
            session_id: "session-2".to_string(),
            thread_id: "thread-1".to_string(),
            status: TurnStatus::Running,
            input_text: Some("hello".to_string()),
            error_message: None,
            context_override: Some(TurnContextOverride {
                model: Some("gpt-5.2".to_string()),
                ..TurnContextOverride::default()
            }),
            output_schema_runtime: Some(TurnOutputSchemaRuntime {
                source: TurnOutputSchemaSource::Turn,
                strategy: TurnOutputSchemaStrategy::Native,
                provider_name: Some("openai".to_string()),
                model_name: Some("gpt-5.2".to_string()),
            }),
            created_at: now - Duration::seconds(30),
            started_at: Some(now - Duration::seconds(30)),
            completed_at: None,
            updated_at: now,
        };
        let snapshot = SessionRuntimeSnapshot {
            session_id: "session-2".to_string(),
            threads: vec![ThreadRuntimeSnapshot {
                thread: ThreadRuntime::new(
                    "thread-1",
                    "session-2",
                    PathBuf::from("/tmp/workspace"),
                ),
                turns: vec![
                    TurnRuntime {
                        id: "turn-old".to_string(),
                        session_id: "session-2".to_string(),
                        thread_id: "thread-1".to_string(),
                        status: TurnStatus::Completed,
                        input_text: Some("old".to_string()),
                        error_message: None,
                        context_override: None,
                        output_schema_runtime: None,
                        created_at: now - Duration::minutes(2),
                        started_at: Some(now - Duration::minutes(2)),
                        completed_at: Some(now - Duration::minutes(1)),
                        updated_at: now - Duration::minutes(1),
                    },
                    latest_turn.clone(),
                ],
                items: Vec::new(),
            }],
        };

        let runtime = build_session_execution_runtime(
            "session-2",
            Some(&session),
            Some("auto".to_string()),
            Some(&snapshot),
            Some("openai".to_string()),
        )
        .expect("runtime");

        assert_eq!(
            runtime.source,
            SessionExecutionRuntimeSource::RuntimeSnapshot
        );
        assert_eq!(runtime.latest_turn_id.as_deref(), Some("turn-new"));
        assert_eq!(runtime.latest_turn_status.as_deref(), Some("running"));
        assert_eq!(runtime.model_name.as_deref(), Some("gpt-5.2"));
        assert_eq!(
            runtime
                .output_schema_runtime
                .as_ref()
                .and_then(|value| value.model_name.as_deref()),
            Some("gpt-5.2")
        );
        assert!(runtime.recent_preferences.is_none());
    }

    #[test]
    fn keeps_recent_preferences_from_latest_turn_metadata() {
        let now = Utc::now();
        let latest_turn = TurnRuntime {
            id: "turn-pref".to_string(),
            session_id: "session-3".to_string(),
            thread_id: "thread-1".to_string(),
            status: TurnStatus::Completed,
            input_text: Some("hello".to_string()),
            error_message: None,
            context_override: Some(TurnContextOverride {
                metadata: std::collections::HashMap::from([(
                    "harness".to_string(),
                    json!({
                        "preferences": {
                            "webSearch": true,
                            "thinking": true,
                            "task": false,
                            "subagent": true,
                        }
                    }),
                )]),
                ..TurnContextOverride::default()
            }),
            output_schema_runtime: None,
            created_at: now - Duration::seconds(10),
            started_at: Some(now - Duration::seconds(10)),
            completed_at: Some(now - Duration::seconds(1)),
            updated_at: now,
        };
        let snapshot = SessionRuntimeSnapshot {
            session_id: "session-3".to_string(),
            threads: vec![ThreadRuntimeSnapshot {
                thread: ThreadRuntime::new(
                    "thread-1",
                    "session-3",
                    PathBuf::from("/tmp/workspace"),
                ),
                turns: vec![latest_turn],
                items: Vec::new(),
            }],
        };

        let runtime =
            build_session_execution_runtime("session-3", None, None, Some(&snapshot), None)
                .expect("runtime");

        assert_eq!(
            runtime.source,
            SessionExecutionRuntimeSource::RuntimeSnapshot
        );
        assert_eq!(
            runtime.recent_preferences,
            Some(SessionExecutionRuntimePreferences {
                web_search: true,
                thinking: true,
                task: false,
                subagent: true,
            })
        );
    }
}
