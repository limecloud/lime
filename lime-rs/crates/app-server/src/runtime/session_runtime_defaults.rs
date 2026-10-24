use super::{RuntimeCore, RuntimeCoreError};
use agent_protocol::CollaborationMode;
use app_server_protocol::{AgentSession, RuntimeOptions, RuntimeRequest};
use serde_json::{json, Map, Value};

const DYNAMIC_TOOLS_METADATA_KEY: &str = "dynamicTools";

impl RuntimeCore {
    pub(crate) fn session_skill_roots(
        &self,
        session_id: &str,
    ) -> Result<Vec<lime_skills::AgentSkillRoot>, RuntimeCoreError> {
        let defaults = self.session_runtime_defaults(session_id)?;
        let request = defaults.as_ref().and_then(RuntimeOptions::runtime_request);
        let working_dir = request.and_then(|request| request.working_dir.as_deref());
        let project_root = request.and_then(|request| {
            request
                .project_root
                .as_deref()
                .or(request.workspace_root.as_deref())
        });
        Ok(lime_skills::agent_skill_roots_for_workspace(
            working_dir.map(std::path::Path::new),
            project_root.map(std::path::Path::new),
        )
        .into_iter()
        .filter(|root| root.scope == lime_skills::AgentSkillScope::Project)
        .collect())
    }

    pub(in crate::runtime) fn session_runtime_defaults(
        &self,
        session_id: &str,
    ) -> Result<Option<RuntimeOptions>, RuntimeCoreError> {
        let state = self
            .state
            .lock()
            .expect("runtime core state mutex poisoned");
        let Some(stored) = state.sessions.get(session_id) else {
            return Err(RuntimeCoreError::SessionNotFound(session_id.to_string()));
        };
        default_runtime_options_for_session(&stored.session)
    }
}

fn default_runtime_options_for_session(
    session: &AgentSession,
) -> Result<Option<RuntimeOptions>, RuntimeCoreError> {
    let reference = session.business_object_ref.as_ref();
    let metadata = reference.and_then(|reference| reference.metadata.as_ref());
    let setting = |keys: &[&str]| metadata.and_then(|metadata| string_alias(metadata, keys));
    let provider_preference = setting(&["providerSelector", "provider_selector"])
        .or_else(|| setting(&["providerName", "provider_name"]));
    let persisted_model_preference = provider_preference
        .as_ref()
        .and_then(|_| setting(&["modelName", "model_name", "model"]));
    let collaboration_mode = metadata
        .and_then(|metadata| metadata.get("collaborationMode"))
        .cloned()
        .map(serde_json::from_value::<CollaborationMode>)
        .transpose()
        .map_err(|error| {
            RuntimeCoreError::InvalidRequest(format!(
                "invalid persisted collaborationMode for session {}: {error}",
                session.session_id
            ))
        })?;
    let model_preference = collaboration_mode
        .as_ref()
        .map(|mode| mode.settings.model.clone())
        .or(persisted_model_preference);
    // Runtime and watcher consume the same current Thread settings.
    let working_dir =
        metadata.and_then(|metadata| string_alias(metadata, &["workingDir", "cwd", "working_dir"]));
    let workspace_root = metadata.and_then(|metadata| {
        if metadata
            .get("runtimeWorkspaceRoots")
            .is_some_and(Value::is_array)
        {
            first_string(metadata, &["runtimeWorkspaceRoots"])
        } else {
            string_alias(
                metadata,
                &[
                    "workspaceRoot",
                    "workspace_root",
                    "projectRoot",
                    "project_root",
                ],
            )
        }
    });
    let runtime_metadata = metadata
        .map(thread_settings_runtime_metadata)
        .filter(|value| value.as_object().is_some_and(|value| !value.is_empty()));
    let reviewer = agent_protocol::ApprovalsReviewer::parse(
        metadata.and_then(|metadata| metadata.get("approvalsReviewer")),
    )
    .map_err(RuntimeCoreError::InvalidRequest)?;
    let request = RuntimeRequest {
        provider_preference,
        model_preference,
        collaboration_mode: collaboration_mode.clone(),
        approvals_reviewer: reviewer,
        reasoning_effort: collaboration_mode
            .as_ref()
            .and_then(|mode| mode.settings.reasoning_effort.clone())
            .or_else(|| setting(&["effort", "reasoningEffort", "reasoning_effort"])),
        service_tier: setting(&["serviceTier", "service_tier"]),
        approval_policy: setting(&["approvalPolicy", "approval_policy"]),
        sandbox_policy: setting(&["sandboxPolicy", "sandbox_policy", "sandbox"]),
        web_search_mode: Some(
            match metadata.and_then(|metadata| metadata.get("webSearchMode")) {
                Some(value) => serde_json::from_value(value.clone()).map_err(|error| {
                    RuntimeCoreError::InvalidRequest(format!(
                        "invalid persisted webSearchMode: {error}"
                    ))
                })?,
                None => agent_protocol::WebSearchMode::for_sandbox(
                    setting(&["sandboxPolicy", "sandbox_policy", "sandbox"]).as_deref(),
                ),
            },
        ),
        sandbox_network_access: metadata
            .and_then(|metadata| metadata.get("sandboxNetworkAccess"))
            .and_then(Value::as_bool),
        workspace_id: session.workspace_id.clone(),
        working_dir: working_dir.clone(),
        workspace_root: workspace_root.clone(),
        project_root: workspace_root.or(working_dir),
        execution_strategy: setting(&["executionStrategy", "execution_strategy"]),
        system_prompt: collaboration_mode.and_then(|mode| mode.settings.developer_instructions),
        metadata: runtime_metadata,
        ..RuntimeRequest::default()
    };
    if request == RuntimeRequest::default() {
        return Ok(None);
    }
    Ok(Some(RuntimeOptions {
        runtime_request: Some(request),
        ..RuntimeOptions::default()
    }))
}

pub(super) fn merge_with_request_options(
    defaults: RuntimeOptions,
    request: Option<RuntimeOptions>,
) -> RuntimeOptions {
    let Some(request) = request else {
        return defaults;
    };

    RuntimeOptions {
        capability_id: request.capability_id.or(defaults.capability_id),
        stream: request.stream || defaults.stream,
        event_name: request.event_name.or(defaults.event_name),
        queued_turn_id: request.queued_turn_id.or(defaults.queued_turn_id),
        runtime_request: merge_runtime_requests(defaults.runtime_request, request.runtime_request),
        expected_output: request.expected_output.or(defaults.expected_output),
        structured_output: request.structured_output.or(defaults.structured_output),
        output_schema: request.output_schema.or(defaults.output_schema),
    }
}

fn merge_runtime_requests(
    defaults: Option<RuntimeRequest>,
    request: Option<RuntimeRequest>,
) -> Option<RuntimeRequest> {
    let (defaults, request) = match (defaults, request) {
        (Some(defaults), Some(request)) => (defaults, request),
        (defaults, request) => return request.or(defaults),
    };

    let default_dynamic_tools = defaults
        .metadata
        .as_ref()
        .and_then(Value::as_object)
        .and_then(|metadata| metadata.get(DYNAMIC_TOOLS_METADATA_KEY))
        .cloned();
    let clears_service_tier = request
        .metadata
        .as_ref()
        .and_then(|metadata| metadata.get("serviceTier"))
        .is_some_and(Value::is_null);
    let mut metadata = merge_json_objects(defaults.metadata, request.metadata);
    match (
        metadata.as_mut().and_then(Value::as_object_mut),
        default_dynamic_tools,
    ) {
        (Some(metadata), Some(dynamic_tools)) => {
            metadata.insert(DYNAMIC_TOOLS_METADATA_KEY.to_string(), dynamic_tools);
        }
        (Some(metadata), None) => {
            metadata.remove(DYNAMIC_TOOLS_METADATA_KEY);
        }
        _ => {}
    }

    Some(RuntimeRequest {
        provider_config: request.provider_config.or(defaults.provider_config),
        provider_preference: request.provider_preference.or(defaults.provider_preference),
        model_preference: request.model_preference.or(defaults.model_preference),
        collaboration_mode: request.collaboration_mode.or(defaults.collaboration_mode),
        reasoning_effort: request.reasoning_effort.or(defaults.reasoning_effort),
        service_tier: if clears_service_tier {
            None
        } else {
            request.service_tier.or(defaults.service_tier)
        },
        thinking_enabled: request.thinking_enabled.or(defaults.thinking_enabled),
        approval_policy: request.approval_policy.or(defaults.approval_policy),
        approvals_reviewer: request.approvals_reviewer.or(defaults.approvals_reviewer),
        sandbox_network_access: if request.sandbox_policy.is_some() {
            Some(request.sandbox_network_access.unwrap_or(false))
        } else {
            request
                .sandbox_network_access
                .or(defaults.sandbox_network_access)
        },
        sandbox_policy: request.sandbox_policy.or(defaults.sandbox_policy),
        workspace_id: request.workspace_id.or(defaults.workspace_id),
        working_dir: request.working_dir.or(defaults.working_dir),
        workspace_root: request.workspace_root.or(defaults.workspace_root),
        project_root: request.project_root.or(defaults.project_root),
        web_search: request.web_search.or(defaults.web_search),
        web_search_mode: match (defaults.web_search_mode, request.web_search_mode) {
            (Some(ceiling), Some(requested)) => Some(ceiling.restrict_to(requested)),
            (ceiling, requested) => ceiling.or(requested),
        },
        search_mode: request.search_mode.or(defaults.search_mode),
        execution_strategy: request.execution_strategy.or(defaults.execution_strategy),
        auto_continue: request.auto_continue.or(defaults.auto_continue),
        system_prompt: request.system_prompt.or(defaults.system_prompt),
        metadata,
    })
}

fn thread_settings_runtime_metadata(metadata: &Value) -> Value {
    compact_json(json!({
        DYNAMIC_TOOLS_METADATA_KEY: metadata.get(DYNAMIC_TOOLS_METADATA_KEY).cloned(),
        "serviceTier": metadata.get("serviceTier").cloned(),
        "modelVerbosity": metadata.get("modelVerbosity").cloned(),
        "reasoningSummary": metadata
            .get("reasoningSummary")
            .or_else(|| metadata.get("summary"))
            .cloned(),
        "personality": metadata.get("personality").cloned(),
        "memoryMode": metadata
            .get("memoryMode")
            .or_else(|| metadata.get("memory_mode"))
            .cloned(),
    }))
}

fn string_alias(value: &Value, keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| value.get(*key))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn first_string(value: &Value, keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| value.get(*key))
        .and_then(Value::as_array)
        .and_then(|values| values.iter().find_map(Value::as_str))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn merge_json_objects(defaults: Option<Value>, request: Option<Value>) -> Option<Value> {
    match (defaults, request) {
        (Some(Value::Object(mut defaults)), Some(Value::Object(request))) => {
            merge_object(&mut defaults, request);
            Some(Value::Object(defaults))
        }
        (_, Some(request)) => Some(request),
        (defaults, None) => defaults,
    }
}

fn merge_object(target: &mut Map<String, Value>, request: Map<String, Value>) {
    for (key, value) in request {
        match (target.get_mut(&key), value) {
            (Some(Value::Object(target)), Value::Object(request)) => {
                merge_object(target, request);
            }
            (_, value) => {
                target.insert(key, value);
            }
        }
    }
}

fn compact_json(value: Value) -> Value {
    match value {
        Value::Object(object) => {
            let mut compacted = Map::new();
            for (key, value) in object {
                let value = compact_json(value);
                if !value.is_null() {
                    compacted.insert(key, value);
                }
            }
            Value::Object(compacted)
        }
        Value::Array(values) => Value::Array(values.into_iter().map(compact_json).collect()),
        value => value,
    }
}

#[cfg(test)]
mod tests {
    include!("session_runtime_defaults/web_search_tests.rs");
    use super::*;
    use app_server_protocol::{AgentSessionStatus, BusinessObjectRef};

    #[test]
    fn explicit_null_tier_does_not_inherit_an_updated_default() {
        let defaults = RuntimeOptions {
            runtime_request: Some(RuntimeRequest {
                service_tier: Some("priority".into()),
                ..RuntimeRequest::default()
            }),
            ..RuntimeOptions::default()
        };
        let patch = RuntimeOptions {
            runtime_request: Some(RuntimeRequest {
                metadata: Some(json!({"serviceTier": null})),
                ..RuntimeRequest::default()
            }),
            ..RuntimeOptions::default()
        };
        assert_eq!(
            merge_with_request_options(defaults.clone(), None)
                .runtime_request
                .unwrap()
                .service_tier
                .as_deref(),
            Some("priority")
        );
        assert_eq!(
            merge_with_request_options(defaults, Some(patch))
                .runtime_request
                .unwrap()
                .service_tier,
            None
        );
    }

    fn session(kind: &str, metadata: Value) -> AgentSession {
        AgentSession {
            session_id: "session-1".to_string(),
            thread_id: "thread-1".to_string(),
            app_id: "agent-chat".to_string(),
            workspace_id: Some("workspace-1".to_string()),
            business_object_ref: Some(BusinessObjectRef {
                kind: kind.to_string(),
                id: "thread-1".to_string(),
                title: None,
                uri: None,
                metadata: Some(metadata),
            }),
            status: AgentSessionStatus::Idle,
            created_at: "2026-07-19T00:00:00Z".to_string(),
            updated_at: "2026-07-19T00:00:00Z".to_string(),
        }
    }

    #[test]
    fn current_thread_metadata_becomes_typed_sticky_defaults() {
        let options = default_runtime_options_for_session(&session(
            "agent.thread",
            json!({
                "providerSelector": "openai",
                "providerName": "openai",
                "modelName": "gpt-5.4",
                "workingDir": "/workspace",
                "runtimeWorkspaceRoots": ["/workspace", "/shared"],
                "approvalPolicy": "on-request",
                "sandbox": "workspace-write"
            }),
        ))
        .expect("valid metadata")
        .expect("defaults");
        let request = options.runtime_request.expect("runtime request");

        assert_eq!(request.provider_preference.as_deref(), Some("openai"));
        assert_eq!(request.model_preference.as_deref(), Some("gpt-5.4"));
        assert_eq!(request.working_dir.as_deref(), Some("/workspace"));
        assert_eq!(request.workspace_root.as_deref(), Some("/workspace"));
        assert_eq!(request.approval_policy.as_deref(), Some("on-request"));
        assert_eq!(request.sandbox_policy.as_deref(), Some("workspace-write"));
        assert_eq!(request.workspace_id.as_deref(), Some("workspace-1"));
        assert!(request.metadata.is_none());
    }

    #[test]
    fn session_dynamic_tools_are_sticky_and_turn_injection_is_removed() {
        let defaults = default_runtime_options_for_session(&session(
            "agent.thread",
            json!({
                "providerSelector": "openai",
                "modelName": "gpt-5.4",
                "dynamicTools": [{
                    "type": "function",
                    "name": "desktop_app_info",
                    "description": "Read desktop app information",
                    "inputSchema": {"type": "object", "properties": {}}
                }]
            }),
        ))
        .expect("valid metadata")
        .expect("defaults");
        let forged = RuntimeOptions {
            runtime_request: Some(RuntimeRequest {
                metadata: Some(json!({
                    "dynamicTools": [{
                        "type": "function",
                        "name": "forged",
                        "description": "Forged",
                        "inputSchema": {"type": "object"}
                    }],
                    "callerValue": true
                })),
                ..RuntimeRequest::default()
            }),
            ..RuntimeOptions::default()
        };

        let merged = merge_with_request_options(defaults, Some(forged));
        let metadata = merged
            .runtime_request
            .and_then(|request| request.metadata)
            .expect("metadata");
        assert_eq!(metadata["dynamicTools"][0]["name"], "desktop_app_info");
        assert_eq!(metadata["callerValue"], true);

        let defaults = default_runtime_options_for_session(&session(
            "agent.thread",
            json!({"providerSelector": "openai", "modelName": "gpt-5.4"}),
        ))
        .expect("valid metadata")
        .expect("defaults");
        let injected = RuntimeOptions {
            runtime_request: Some(RuntimeRequest {
                metadata: Some(json!({"dynamicTools": [{"type": "function"}]})),
                ..RuntimeRequest::default()
            }),
            ..RuntimeOptions::default()
        };
        let metadata = merge_with_request_options(defaults, Some(injected))
            .runtime_request
            .and_then(|request| request.metadata)
            .expect("request metadata remains present");
        assert!(metadata.get(DYNAMIC_TOOLS_METADATA_KEY).is_none());
    }

    #[test]
    fn request_model_override_keeps_durable_provider() {
        let defaults = default_runtime_options_for_session(&session(
            "agent.thread",
            json!({
                "providerSelector": "openai",
                "modelName": "gpt-4.1"
            }),
        ))
        .expect("valid metadata")
        .expect("defaults");
        let request = RuntimeOptions {
            runtime_request: Some(RuntimeRequest {
                model_preference: Some("gpt-5.4".to_string()),
                ..RuntimeRequest::default()
            }),
            ..RuntimeOptions::default()
        };

        let merged = merge_with_request_options(defaults, Some(request));
        let runtime_request = merged.runtime_request.expect("runtime request");

        assert_eq!(
            runtime_request.provider_preference.as_deref(),
            Some("openai")
        );
        assert_eq!(runtime_request.model_preference.as_deref(), Some("gpt-5.4"));
    }

    #[test]
    fn retired_nested_metadata_cannot_override_current_thread_settings() {
        for kind in ["agent.thread", "conversation.import"] {
            let options = default_runtime_options_for_session(&session(
                kind,
                json!({
                    "providerName": "current-provider",
                    "modelName": "current-model",
                    "workingDir": "/workspace",
                    "approvalPolicy": "on-request",
                    "sourceClient": "codex",
                    "sourceThreadId": "foreign-thread",
                    "importedContinuation": {
                        "providerName": "foreign-provider",
                        "model": "foreign-model",
                        "approvalPolicy": "never",
                        "cwd": "/foreign"
                    },
                    "importedThreadSettings": {
                        "reasoningEffort": "high",
                        "sandboxPolicy": "danger-full-access"
                    }
                }),
            ))
            .expect("valid current settings")
            .expect("defaults");
            let request = options.runtime_request.expect("runtime request");

            assert_eq!(
                request.provider_preference.as_deref(),
                Some("current-provider")
            );
            assert_eq!(request.model_preference.as_deref(), Some("current-model"));
            assert_eq!(request.working_dir.as_deref(), Some("/workspace"));
            assert_eq!(request.approval_policy.as_deref(), Some("on-request"));
            assert!(request.reasoning_effort.is_none());
            assert!(request.sandbox_policy.is_none());
            assert!(request.metadata.is_none());
        }
    }

    #[test]
    fn typed_collaboration_mode_becomes_the_sticky_runtime_owner() {
        let options = default_runtime_options_for_session(&session(
            "agent.thread",
            json!({
                "providerSelector": "openai",
                "modelName": "stale-model",
                "reasoningEffort": "low",
                "collaborationMode": {
                    "mode": "plan",
                    "settings": {
                        "model": "gpt-5.4",
                        "reasoning_effort": "high",
                        "developer_instructions": "Plan before editing."
                    }
                }
            }),
        ))
        .expect("valid typed mode")
        .expect("defaults");
        let request = options.runtime_request.expect("runtime request");

        assert_eq!(request.model_preference.as_deref(), Some("gpt-5.4"));
        assert_eq!(request.reasoning_effort.as_deref(), Some("high"));
        assert_eq!(
            request.system_prompt.as_deref(),
            Some("Plan before editing.")
        );
        assert_eq!(
            request.collaboration_mode.as_ref().map(|mode| mode.mode),
            Some(agent_protocol::ModeKind::Plan)
        );
        assert!(
            request
                .metadata
                .as_ref()
                .and_then(|metadata| metadata.get("collaborationMode"))
                .is_none(),
            "typed collaboration mode must not leak into generic runtime metadata"
        );
    }

    #[test]
    fn invalid_persisted_collaboration_mode_fails_closed() {
        let error = default_runtime_options_for_session(&session(
            "agent.thread",
            json!({
                "providerSelector": "openai",
                "modelName": "gpt-5.4",
                "collaborationMode": "plan"
            }),
        ))
        .expect_err("invalid typed mode must fail closed");

        assert!(matches!(
            error,
            RuntimeCoreError::InvalidRequest(message)
                if message.contains("invalid persisted collaborationMode")
        ));
    }
}
