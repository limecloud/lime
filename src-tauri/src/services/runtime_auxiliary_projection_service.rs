use crate::agent::AsterAgentWrapper;
use crate::database::DbConnection;
use crate::services::agent_timeline_service::AgentTimelineRecorder;
use lime_agent::{AgentArtifactSignal, AgentEvent as RuntimeAgentEvent, SessionExecutionRuntime};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

const AUXILIARY_RUNTIME_ARTIFACT_TYPE: &str = "auxiliary_runtime_projection";
const AUXILIARY_RUNTIME_EVENT_PREFIX: &str = "agent_auxiliary_runtime_projection";

#[derive(Debug, Clone)]
pub enum AuxiliaryRuntimeProjectionResult {
    TitleGeneration {
        title: String,
        used_fallback: bool,
        fallback_reason: Option<String>,
    },
    PersonaGeneration {
        persona: Value,
    },
}

#[derive(Debug, Clone)]
pub struct AuxiliaryRuntimeProjectionInput {
    pub parent_session_id: String,
    pub auxiliary_session_id: String,
    pub execution_runtime: Option<SessionExecutionRuntime>,
    pub result: AuxiliaryRuntimeProjectionResult,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AuxiliaryRuntimeProjectionKind {
    TitleGeneration,
    PersonaGeneration,
}

impl AuxiliaryRuntimeProjectionKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::TitleGeneration => "title_generation",
            Self::PersonaGeneration => "persona_generation",
        }
    }

    fn artifact_prefix(self) -> &'static str {
        match self {
            Self::TitleGeneration => "title-generation",
            Self::PersonaGeneration => "persona-generation",
        }
    }

    fn item_title(self) -> &'static str {
        match self {
            Self::TitleGeneration => "辅助标题生成",
            Self::PersonaGeneration => "辅助人设生成",
        }
    }

    fn snapshot_source(self) -> &'static str {
        match self {
            Self::TitleGeneration => "auxiliary.title_generation_result",
            Self::PersonaGeneration => "auxiliary.generate_persona",
        }
    }

    fn runtime_route(self) -> &'static str {
        match self {
            Self::TitleGeneration => "auxiliary.generate_title",
            Self::PersonaGeneration => "auxiliary.generate_persona",
        }
    }
}

fn normalize_optional_text(value: Option<String>) -> Option<String> {
    let trimmed = value?.trim().to_string();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

fn truncate_chars(input: &str, max_chars: usize) -> String {
    let mut chars = input.chars();
    let prefix: String = chars.by_ref().take(max_chars).collect();
    if chars.next().is_some() {
        format!("{prefix}...")
    } else {
        prefix
    }
}

fn build_projection_turn_prompt(
    kind: AuxiliaryRuntimeProjectionKind,
    result: &AuxiliaryRuntimeProjectionResult,
) -> String {
    let subject = match result {
        AuxiliaryRuntimeProjectionResult::TitleGeneration { title, .. } => {
            normalize_optional_text(Some(title.clone()))
        }
        AuxiliaryRuntimeProjectionResult::PersonaGeneration { persona } => read_json_string(
            persona,
            &[&["name"][..], &["personaName"][..], &["persona_name"][..]],
        ),
    };

    match subject {
        Some(subject) => format!("{} · {}", kind.item_title(), truncate_chars(&subject, 24)),
        None => kind.item_title().to_string(),
    }
}

fn read_json_string(value: &Value, paths: &[&[&str]]) -> Option<String> {
    for path in paths {
        let mut current = value;
        let mut matched = true;
        for segment in *path {
            let Some(next) = current.get(*segment) else {
                matched = false;
                break;
            };
            current = next;
        }
        if !matched {
            continue;
        }
        if let Some(raw) = current.as_str() {
            let trimmed = raw.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }
    None
}

fn build_projection_document(
    kind: AuxiliaryRuntimeProjectionKind,
    parent_session_id: &str,
    auxiliary_session_id: &str,
    execution_runtime: Option<&SessionExecutionRuntime>,
    result: &AuxiliaryRuntimeProjectionResult,
) -> Value {
    let mut execution_runtime_value = execution_runtime
        .and_then(|runtime| serde_json::to_value(runtime).ok())
        .unwrap_or(Value::Null);
    if let Value::Object(runtime_object) = &mut execution_runtime_value {
        runtime_object
            .entry("route".to_string())
            .or_insert_with(|| Value::String(kind.runtime_route().to_string()));
    }
    let result_payload = match result {
        AuxiliaryRuntimeProjectionResult::TitleGeneration {
            title,
            used_fallback,
            fallback_reason,
        } => json!({
            "title": title,
            "sessionId": auxiliary_session_id,
            "usedFallback": used_fallback,
            "fallbackReason": fallback_reason,
            "executionRuntime": execution_runtime_value.clone()
        }),
        AuxiliaryRuntimeProjectionResult::PersonaGeneration { persona } => json!({
            "sessionId": auxiliary_session_id,
            "persona": persona,
            "executionRuntime": execution_runtime_value.clone()
        }),
    };
    let payload_key = match kind {
        AuxiliaryRuntimeProjectionKind::TitleGeneration => "titleGenerationResult",
        AuxiliaryRuntimeProjectionKind::PersonaGeneration => "personaGenerationResult",
    };

    json!({
        "schemaVersion": 1,
        "artifactType": AUXILIARY_RUNTIME_ARTIFACT_TYPE,
        "projectionKind": kind.as_str(),
        "source": kind.snapshot_source(),
        "parentSessionId": parent_session_id,
        "auxiliarySessionId": auxiliary_session_id,
        "executionRuntime": execution_runtime_value,
        payload_key: result_payload
    })
}

fn build_projection_artifact_metadata(
    kind: AuxiliaryRuntimeProjectionKind,
    parent_session_id: &str,
    auxiliary_session_id: &str,
    execution_runtime: Option<&SessionExecutionRuntime>,
) -> HashMap<String, Value> {
    let mut metadata = HashMap::from([
        (
            "task_type".to_string(),
            Value::String(AUXILIARY_RUNTIME_ARTIFACT_TYPE.to_string()),
        ),
        (
            "projection_kind".to_string(),
            Value::String(kind.as_str().to_string()),
        ),
        (
            "source".to_string(),
            Value::String(kind.snapshot_source().to_string()),
        ),
        (
            "parent_session_id".to_string(),
            Value::String(parent_session_id.to_string()),
        ),
        (
            "session_id".to_string(),
            Value::String(auxiliary_session_id.to_string()),
        ),
        (
            "lastUpdateSource".to_string(),
            Value::String("auxiliary_runtime_projection".to_string()),
        ),
    ]);

    if let Some(runtime) = execution_runtime {
        if let Some(task_kind) = runtime
            .task_profile
            .as_ref()
            .and_then(|profile| normalize_optional_text(Some(profile.kind.clone())))
        {
            metadata.insert("task_kind".to_string(), Value::String(task_kind));
        }
        metadata.insert(
            "route".to_string(),
            Value::String(kind.runtime_route().to_string()),
        );
        if let Some(runtime_source) = serde_json::to_value(runtime.source)
            .ok()
            .and_then(|value| value.as_str().map(str::to_string))
            .and_then(|value| normalize_optional_text(Some(value)))
        {
            metadata.insert("runtime_source".to_string(), Value::String(runtime_source));
        }
        if let Some(routing_mode) = runtime
            .routing_decision
            .as_ref()
            .and_then(|decision| normalize_optional_text(Some(decision.routing_mode.clone())))
        {
            metadata.insert("routing_mode".to_string(), Value::String(routing_mode));
        }
        if let Some(decision_source) = runtime
            .routing_decision
            .as_ref()
            .and_then(|decision| normalize_optional_text(Some(decision.decision_source.clone())))
        {
            metadata.insert(
                "decision_source".to_string(),
                Value::String(decision_source),
            );
        }
        if let Some(estimated_cost_class) = runtime
            .cost_state
            .as_ref()
            .and_then(|state| normalize_optional_text(state.estimated_cost_class.clone()))
        {
            metadata.insert(
                "estimated_cost_class".to_string(),
                Value::String(estimated_cost_class),
            );
        }
    }

    metadata
}

fn resolve_projection_kind(
    result: &AuxiliaryRuntimeProjectionResult,
) -> AuxiliaryRuntimeProjectionKind {
    match result {
        AuxiliaryRuntimeProjectionResult::TitleGeneration { .. } => {
            AuxiliaryRuntimeProjectionKind::TitleGeneration
        }
        AuxiliaryRuntimeProjectionResult::PersonaGeneration { .. } => {
            AuxiliaryRuntimeProjectionKind::PersonaGeneration
        }
    }
}

fn build_projection_relative_path(
    kind: AuxiliaryRuntimeProjectionKind,
    parent_session_id: &str,
    auxiliary_session_id: &str,
) -> String {
    format!(
        ".lime/harness/sessions/{parent_session_id}/auxiliary-runtime/{}-{auxiliary_session_id}.json",
        kind.artifact_prefix()
    )
}

fn build_projection_event_name(parent_session_id: &str) -> String {
    format!("{AUXILIARY_RUNTIME_EVENT_PREFIX}:{parent_session_id}")
}

fn record_and_emit_event(
    app: &AppHandle,
    event_name: &str,
    recorder: &mut AgentTimelineRecorder,
    workspace_root: &str,
    event: RuntimeAgentEvent,
) {
    if let Err(error) = recorder.record_runtime_event(app, event_name, &event, workspace_root) {
        tracing::warn!(
            "[AuxRuntimeProjection] 记录辅助运行时投影事件失败，已降级继续: {}",
            error
        );
    }
    if let Err(error) = app.emit(event_name, &event) {
        tracing::warn!(
            "[AuxRuntimeProjection] 发送辅助运行时投影事件失败，已降级继续: {}",
            error
        );
    }
}

pub async fn project_auxiliary_runtime_to_parent_session(
    app: &AppHandle,
    db: &DbConnection,
    input: AuxiliaryRuntimeProjectionInput,
) -> Result<Option<String>, String> {
    let Some(parent_session_id) = normalize_optional_text(Some(input.parent_session_id)) else {
        return Ok(None);
    };
    let Some(auxiliary_session_id) = normalize_optional_text(Some(input.auxiliary_session_id))
    else {
        return Ok(None);
    };

    let parent_detail =
        match AsterAgentWrapper::get_runtime_session_detail(db, &parent_session_id).await {
            Ok(detail) => detail,
            Err(error) => {
                tracing::warn!(
                "[AuxRuntimeProjection] 读取父会话详情失败，已跳过投影: session_id={}, error={}",
                parent_session_id,
                error
            );
                return Ok(None);
            }
        };
    let Some(workspace_root) = normalize_optional_text(parent_detail.working_dir.clone()) else {
        tracing::warn!(
            "[AuxRuntimeProjection] 父会话缺少 working_dir，已跳过投影: session_id={}",
            parent_session_id
        );
        return Ok(None);
    };
    let thread_id = parent_detail.thread_id.trim().to_string();
    if thread_id.is_empty() {
        tracing::warn!(
            "[AuxRuntimeProjection] 父会话缺少 thread_id，已跳过投影: session_id={}",
            parent_session_id
        );
        return Ok(None);
    }

    let kind = resolve_projection_kind(&input.result);
    let relative_path =
        build_projection_relative_path(kind, &parent_session_id, &auxiliary_session_id);
    let absolute_path = PathBuf::from(workspace_root.as_str()).join(relative_path.as_str());
    let document = build_projection_document(
        kind,
        &parent_session_id,
        &auxiliary_session_id,
        input.execution_runtime.as_ref(),
        &input.result,
    );
    let serialized_document = serde_json::to_string_pretty(&document)
        .map_err(|error| format!("序列化辅助运行时投影失败: {error}"))?;
    let metadata = build_projection_artifact_metadata(
        kind,
        &parent_session_id,
        &auxiliary_session_id,
        input.execution_runtime.as_ref(),
    );
    let turn_id = format!("auxiliary-runtime-projection-{}", Uuid::new_v4());
    let event_name = build_projection_event_name(&parent_session_id);
    let turn_prompt = build_projection_turn_prompt(kind, &input.result);
    let mut recorder = AgentTimelineRecorder::create(db.clone(), thread_id, turn_id, turn_prompt)
        .map_err(|error| format!("创建辅助运行时投影时间线失败: {error}"))?;

    let projection_result = (|| -> Result<(), String> {
        if let Some(parent) = absolute_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("创建辅助运行时投影目录失败: {error}"))?;
        }
        fs::write(&absolute_path, serialized_document.as_bytes())
            .map_err(|error| format!("写入辅助运行时投影文件失败: {error}"))?;

        record_and_emit_event(
            app,
            &event_name,
            &mut recorder,
            workspace_root.as_str(),
            RuntimeAgentEvent::ArtifactSnapshot {
                artifact: AgentArtifactSignal {
                    artifact_id: format!(
                        "auxiliary-runtime:{}:{}",
                        kind.as_str(),
                        auxiliary_session_id
                    ),
                    file_path: relative_path.clone(),
                    content: Some(serialized_document.clone()),
                    metadata: Some(metadata),
                },
            },
        );

        Ok(())
    })();

    match projection_result {
        Ok(()) => {
            if let Ok(events) = recorder.complete_turn_success() {
                for event in events {
                    if let Err(error) = app.emit(&event_name, &event) {
                        tracing::warn!(
                            "[AuxRuntimeProjection] 发送辅助运行时投影完成事件失败，已降级继续: {}",
                            error
                        );
                    }
                }
            }
            Ok(Some(relative_path))
        }
        Err(error) => {
            if let Ok(events) = recorder.fail_turn(&error) {
                for event in events {
                    if let Err(emit_error) = app.emit(&event_name, &event) {
                        tracing::warn!(
                            "[AuxRuntimeProjection] 发送辅助运行时投影失败事件失败，已降级继续: {}",
                            emit_error
                        );
                    }
                }
            }
            Err(error)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_execution_runtime() -> SessionExecutionRuntime {
        serde_json::from_value(json!({
            "session_id": "aux-session-1",
            "source": "runtime_snapshot",
            "task_profile": {
                "kind": "generation_topic",
                "source": "auxiliary_generation_topic"
            },
            "routing_decision": {
                "routingMode": "single_candidate",
                "decisionSource": "service_model_setting",
                "decisionReason": "命中辅助模型配置",
                "candidateCount": 1
            },
            "cost_state": {
                "status": "estimated",
                "estimatedCostClass": "low"
            }
        }))
        .expect("runtime")
    }

    #[test]
    fn build_projection_document_should_include_title_generation_payload() {
        let document = build_projection_document(
            AuxiliaryRuntimeProjectionKind::TitleGeneration,
            "session-parent-1",
            "title-gen-1",
            Some(&sample_execution_runtime()),
            &AuxiliaryRuntimeProjectionResult::TitleGeneration {
                title: "城市夜景主视觉".to_string(),
                used_fallback: false,
                fallback_reason: None,
            },
        );

        assert_eq!(
            document.get("artifactType").and_then(Value::as_str),
            Some(AUXILIARY_RUNTIME_ARTIFACT_TYPE)
        );
        assert_eq!(
            document.get("projectionKind").and_then(Value::as_str),
            Some("title_generation")
        );
        assert_eq!(
            document
                .pointer("/titleGenerationResult/title")
                .and_then(Value::as_str),
            Some("城市夜景主视觉")
        );
        assert_eq!(
            document
                .pointer("/executionRuntime/route")
                .and_then(Value::as_str),
            Some("auxiliary.generate_title")
        );
    }

    #[test]
    fn build_projection_document_should_include_persona_payload() {
        let document = build_projection_document(
            AuxiliaryRuntimeProjectionKind::PersonaGeneration,
            "session-parent-1",
            "persona-gen-1",
            Some(&sample_execution_runtime()),
            &AuxiliaryRuntimeProjectionResult::PersonaGeneration {
                persona: json!({
                    "name": "理性产品经理",
                    "style": "结构化",
                    "tone": "克制"
                }),
            },
        );

        assert_eq!(
            document.get("projectionKind").and_then(Value::as_str),
            Some("persona_generation")
        );
        assert_eq!(
            document
                .pointer("/personaGenerationResult/persona/name")
                .and_then(Value::as_str),
            Some("理性产品经理")
        );
        assert_eq!(
            document
                .pointer("/executionRuntime/route")
                .and_then(Value::as_str),
            Some("auxiliary.generate_persona")
        );
    }
}
