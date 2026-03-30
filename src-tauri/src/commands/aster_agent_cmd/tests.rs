#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::aster_agent_cmd::action_runtime::build_runtime_action_scope;
    use crate::commands::aster_agent_cmd::dto::AgentRuntimeActionScope;
    use crate::services::site_capability_service::{
        RunSiteAdapterRequest, SiteAdapterDefinition, SiteAdapterRunResult,
    };
    use async_trait::async_trait;
    use lime_agent::request_tool_policy::resolve_request_tool_policy;
    use lime_agent::AgentEvent as RuntimeAgentEvent;
    use regex::Regex;
    use std::ffi::OsString;
    use std::path::{Path, PathBuf};
    use std::sync::{Mutex, OnceLock};
    use tempfile::TempDir;

    struct DummyTool {
        name: String,
        description: String,
        schema: serde_json::Value,
    }

    impl DummyTool {
        fn new(name: &str, description: &str, schema: serde_json::Value) -> Self {
            Self {
                name: name.to_string(),
                description: description.to_string(),
                schema,
            }
        }
    }

    #[async_trait]
    impl Tool for DummyTool {
        fn name(&self) -> &str {
            &self.name
        }

        fn description(&self) -> &str {
            &self.description
        }

        fn input_schema(&self) -> serde_json::Value {
            self.schema.clone()
        }

        async fn execute(
            &self,
            _params: serde_json::Value,
            _context: &ToolContext,
        ) -> Result<ToolResult, ToolError> {
            Ok(ToolResult::success("ok"))
        }
    }

    fn durable_memory_test_lock() -> &'static Mutex<()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
    }

    struct DurableMemoryEnvGuard {
        previous: Option<OsString>,
    }

    impl DurableMemoryEnvGuard {
        fn set(path: &Path) -> Self {
            let previous = lime_core::env_compat::var_os(&[
                lime_agent::LIME_DURABLE_MEMORY_ROOT_ENV,
                lime_agent::LEGACY_DURABLE_MEMORY_ROOT_ENV,
            ]);
            std::env::set_var(lime_agent::LIME_DURABLE_MEMORY_ROOT_ENV, path.as_os_str());
            std::env::remove_var(lime_agent::LEGACY_DURABLE_MEMORY_ROOT_ENV);
            Self { previous }
        }
    }

    impl Drop for DurableMemoryEnvGuard {
        fn drop(&mut self) {
            if let Some(value) = &self.previous {
                std::env::set_var(lime_agent::LIME_DURABLE_MEMORY_ROOT_ENV, value);
            } else {
                std::env::remove_var(lime_agent::LIME_DURABLE_MEMORY_ROOT_ENV);
            }
            std::env::remove_var(lime_agent::LEGACY_DURABLE_MEMORY_ROOT_ENV);
        }
    }

    fn builtin_extension_config(
        name: &str,
        available_tools: Vec<&str>,
        deferred_loading: bool,
        always_expose_tools: Vec<&str>,
        allowed_caller: Option<&str>,
    ) -> ExtensionConfig {
        ExtensionConfig::Builtin {
            name: name.to_string(),
            display_name: Some(name.to_string()),
            description: format!("{name} tools"),
            timeout: None,
            bundled: Some(false),
            available_tools: available_tools
                .into_iter()
                .map(|item| item.to_string())
                .collect(),
            deferred_loading,
            always_expose_tools: always_expose_tools
                .into_iter()
                .map(|item| item.to_string())
                .collect(),
            allowed_caller: allowed_caller.map(ToString::to_string),
        }
    }

    #[test]
    fn test_aster_chat_request_deserialize() {
        let json = r#"{
            "message": "Hello",
            "session_id": "test-session",
            "event_name": "agent_stream",
            "workspace_id": "workspace-test"
        }"#;

        let request: AsterChatRequest = serde_json::from_str(json).unwrap();
        assert_eq!(request.message, "Hello");
        assert_eq!(request.session_id, "test-session");
        assert_eq!(request.event_name, "agent_stream");
        assert_eq!(request.workspace_id, "workspace-test");
        assert_eq!(request.execution_strategy, None);
        assert_eq!(request.auto_continue, None);
    }

    #[test]
    fn test_message_suggests_live_search_accepts_explicit_search_verbs() {
        assert!(message_suggests_live_search(
            "请帮我搜一下哥德尔不完备定理的历史背景"
        ));
        assert!(message_suggests_live_search(
            "please look up kyoto travel tips"
        ));
        assert!(!message_suggests_live_search(
            "帮我解释一下什么是向量数据库"
        ));
    }

    #[test]
    fn test_resolve_workspace_id_from_sources_prefers_request_value() {
        assert_eq!(
            resolve_workspace_id_from_sources(
                Some("workspace-request".to_string()),
                Some("workspace-session".to_string()),
            ),
            Some("workspace-request".to_string())
        );
    }

    #[test]
    fn test_resolve_workspace_id_from_sources_falls_back_to_session_value() {
        assert_eq!(
            resolve_workspace_id_from_sources(
                Some("   ".to_string()),
                Some("workspace-session".to_string()),
            ),
            Some("workspace-session".to_string())
        );
    }

    #[test]
    fn test_aster_chat_request_deserialize_with_execution_strategy() {
        let json = r#"{
            "message": "Hello",
            "session_id": "test-session",
            "event_name": "agent_stream",
            "workspace_id": "workspace-test",
            "execution_strategy": "code_orchestrated"
        }"#;

        let request: AsterChatRequest = serde_json::from_str(json).unwrap();
        assert_eq!(
            request.execution_strategy,
            Some(AsterExecutionStrategy::CodeOrchestrated)
        );
    }

    #[test]
    fn test_aster_chat_request_deserialize_with_web_search_flag() {
        let json = r#"{
            "message": "Hello",
            "session_id": "test-session",
            "event_name": "agent_stream",
            "workspace_id": "workspace-test",
            "web_search": true
        }"#;

        let request: AsterChatRequest = serde_json::from_str(json).unwrap();
        assert_eq!(request.web_search, Some(true));
    }

    #[test]
    fn test_aster_chat_request_deserialize_with_auto_continue_payload() {
        let json = r#"{
            "message": "Hello",
            "session_id": "test-session",
            "event_name": "agent_stream",
            "workspace_id": "workspace-test",
            "auto_continue": {
                "enabled": true,
                "fast_mode_enabled": true,
                "continuation_length": 2,
                "sensitivity": 88,
                "source": "document_canvas"
            }
        }"#;

        let request: AsterChatRequest = serde_json::from_str(json).unwrap();
        assert_eq!(
            request.auto_continue,
            Some(AutoContinuePayload {
                enabled: true,
                fast_mode_enabled: true,
                continuation_length: 2,
                sensitivity: 88,
                source: Some("document_canvas".to_string()),
            })
        );
    }

    #[test]
    fn test_aster_chat_request_deserialize_with_auto_continue_camel_case_aliases() {
        let json = r#"{
            "message": "Hello",
            "session_id": "test-session",
            "event_name": "agent_stream",
            "workspace_id": "workspace-test",
            "autoContinue": {
                "enabled": true,
                "fastModeEnabled": true,
                "continuationLength": 1,
                "sensitivity": 45
            }
        }"#;

        let request: AsterChatRequest = serde_json::from_str(json).unwrap();
        assert_eq!(
            request.auto_continue,
            Some(AutoContinuePayload {
                enabled: true,
                fast_mode_enabled: true,
                continuation_length: 1,
                sensitivity: 45,
                source: None,
            })
        );
    }

    #[test]
    fn test_aster_chat_request_deserialize_with_metadata() {
        let json = r#"{
            "message": "Hello",
            "session_id": "test-session",
            "event_name": "agent_stream",
            "workspace_id": "workspace-test",
            "metadata": {
                "harness": {
                    "theme": "social-media",
                    "gate_key": "write_mode",
                    "run_title": "社媒初稿"
                }
            }
        }"#;

        let request: AsterChatRequest = serde_json::from_str(json).unwrap();
        assert_eq!(
            request
                .metadata
                .as_ref()
                .and_then(|value| value.get("harness"))
                .and_then(|value| value.get("theme"))
                .and_then(serde_json::Value::as_str),
            Some("social-media")
        );
    }

    #[test]
    fn test_resolve_runtime_chat_mode_prefers_explicit_chat_mode() {
        let metadata = serde_json::json!({
            "harness": {
                "theme": "social-media",
                "chat_mode": "general"
            }
        });

        assert_eq!(
            resolve_runtime_chat_mode(Some(&metadata)),
            RuntimeChatMode::General
        );
    }

    #[test]
    fn test_resolve_runtime_chat_mode_falls_back_to_general_theme_group() {
        let metadata = serde_json::json!({
            "harness": {
                "theme": "planning"
            }
        });

        assert_eq!(
            resolve_runtime_chat_mode(Some(&metadata)),
            RuntimeChatMode::General
        );
    }

    #[test]
    fn test_default_web_search_enabled_for_chat_mode_requires_explicit_opt_in() {
        assert!(!default_web_search_enabled_for_chat_mode(
            RuntimeChatMode::Agent
        ));
        assert!(!default_web_search_enabled_for_chat_mode(
            RuntimeChatMode::Creator
        ));
        assert!(!default_web_search_enabled_for_chat_mode(
            RuntimeChatMode::General
        ));
    }

    #[test]
    fn test_browser_required_task_disables_web_search_policy() {
        let metadata = serde_json::json!({
            "harness": {
                "browser_requirement": "required_with_user_step"
            }
        });

        assert_eq!(
            apply_browser_requirement_to_request_tool_policy(
                Some(&metadata),
                Some(true),
                Some(RequestToolPolicyMode::Allowed),
            ),
            (Some(false), Some(RequestToolPolicyMode::Disabled))
        );
    }

    #[test]
    fn test_optional_browser_task_keeps_original_web_search_policy() {
        let metadata = serde_json::json!({
            "harness": {
                "browser_requirement": "optional"
            }
        });

        assert_eq!(
            apply_browser_requirement_to_request_tool_policy(
                Some(&metadata),
                Some(true),
                Some(RequestToolPolicyMode::Allowed),
            ),
            (Some(true), Some(RequestToolPolicyMode::Allowed))
        );
    }

    #[test]
    fn test_should_enable_model_skill_tool_defaults_to_false() {
        let metadata = serde_json::json!({
            "harness": {
                "theme": "general",
                "session_mode": "default"
            }
        });

        assert!(!should_enable_model_skill_tool(Some(&metadata)));
        assert!(!should_enable_model_skill_tool(None));
    }

    #[test]
    fn test_should_enable_model_skill_tool_allows_theme_workbench() {
        let metadata = serde_json::json!({
            "harness": {
                "theme": "social-media",
                "session_mode": "theme_workbench"
            }
        });

        assert!(should_enable_model_skill_tool(Some(&metadata)));
    }

    #[test]
    fn test_should_enable_model_skill_tool_respects_explicit_override() {
        let metadata = serde_json::json!({
            "harness": {
                "theme": "social-media",
                "session_mode": "theme_workbench",
                "allow_model_skills": false
            }
        });

        assert!(!should_enable_model_skill_tool(Some(&metadata)));
    }

    #[test]
    fn test_extract_browser_assist_runtime_hint_from_harness_metadata() {
        let metadata = serde_json::json!({
            "harness": {
                "theme": "general",
                "browser_assist": {
                    "profile_key": "general_browser_assist",
                    "preferred_backend": "cdp_direct",
                    "auto_launch": true,
                    "launch_url": "https://www.google.com"
                }
            }
        });

        assert_eq!(
            extract_browser_assist_runtime_hint(Some(&metadata)),
            Some(BrowserAssistRuntimeHint {
                profile_key: "general_browser_assist".to_string(),
                preferred_backend: Some(BrowserBackendType::CdpDirect),
                auto_launch: true,
                launch_url: Some("https://www.google.com".to_string()),
            })
        );
    }

    #[test]
    fn test_resolve_browser_backend_keeps_explicit_backend() {
        let params = serde_json::json!({
            "backend": "cdp_direct"
        });
        let session_hint = BrowserAssistRuntimeHint {
            profile_key: "general_browser_assist".to_string(),
            preferred_backend: Some(BrowserBackendType::AsterCompat),
            auto_launch: true,
            launch_url: None,
        };

        assert_eq!(
            LimeBrowserMcpTool::resolve_backend("find", &params, Some(&session_hint)),
            Some(BrowserBackendType::CdpDirect)
        );
    }

    #[test]
    fn test_resolve_browser_backend_does_not_force_cdp_for_unsupported_action() {
        let params = serde_json::json!({});
        let session_hint = BrowserAssistRuntimeHint {
            profile_key: "general_browser_assist".to_string(),
            preferred_backend: Some(BrowserBackendType::CdpDirect),
            auto_launch: true,
            launch_url: None,
        };

        assert_eq!(
            LimeBrowserMcpTool::resolve_backend("drag", &params, Some(&session_hint)),
            None
        );
    }

    #[test]
    fn test_resolve_browser_backend_keeps_cdp_for_supported_action() {
        let params = serde_json::json!({});
        let session_hint = BrowserAssistRuntimeHint {
            profile_key: "general_browser_assist".to_string(),
            preferred_backend: Some(BrowserBackendType::CdpDirect),
            auto_launch: true,
            launch_url: None,
        };

        assert_eq!(
            LimeBrowserMcpTool::resolve_backend("navigate", &params, Some(&session_hint)),
            Some(BrowserBackendType::CdpDirect)
        );
        assert_eq!(
            LimeBrowserMcpTool::resolve_backend("find", &params, Some(&session_hint)),
            Some(BrowserBackendType::CdpDirect)
        );
        assert_eq!(
            LimeBrowserMcpTool::resolve_backend("read_page", &params, Some(&session_hint)),
            Some(BrowserBackendType::CdpDirect)
        );
        assert_eq!(
            LimeBrowserMcpTool::resolve_backend("javascript_tool", &params, Some(&session_hint)),
            Some(BrowserBackendType::CdpDirect)
        );
        assert_eq!(
            LimeBrowserMcpTool::resolve_backend("computer", &params, Some(&session_hint)),
            Some(BrowserBackendType::CdpDirect)
        );
    }

    #[test]
    fn test_should_not_auto_launch_managed_browser_for_existing_session_profile() {
        let session_hint = BrowserAssistRuntimeHint {
            profile_key: "attached-xhs".to_string(),
            preferred_backend: Some(BrowserBackendType::LimeExtensionBridge),
            auto_launch: true,
            launch_url: None,
        };

        assert!(!LimeBrowserMcpTool::should_auto_launch_managed_browser(
            Some(BrowserBackendType::LimeExtensionBridge),
            Some(&session_hint),
            Some(lime_core::database::dao::browser_profile::BrowserProfileTransportKind::ExistingSession),
        ));
    }

    #[test]
    fn test_should_keep_managed_auto_launch_for_managed_cdp_profile() {
        let session_hint = BrowserAssistRuntimeHint {
            profile_key: "general_browser_assist".to_string(),
            preferred_backend: Some(BrowserBackendType::CdpDirect),
            auto_launch: true,
            launch_url: Some("https://www.google.com".to_string()),
        };

        assert!(LimeBrowserMcpTool::should_auto_launch_managed_browser(
            Some(BrowserBackendType::CdpDirect),
            Some(&session_hint),
            Some(
                lime_core::database::dao::browser_profile::BrowserProfileTransportKind::ManagedCdp
            ),
        ));
    }

    #[test]
    fn test_is_browser_assist_enabled_respects_explicit_flag() {
        let disabled_metadata = serde_json::json!({
            "harness": {
                "browser_assist": {
                    "enabled": false,
                    "profile_key": "general_browser_assist"
                }
            }
        });
        let enabled_metadata = serde_json::json!({
            "harness": {
                "browser_assist": {
                    "profile_key": "general_browser_assist"
                }
            }
        });

        assert!(!is_browser_assist_enabled(Some(&disabled_metadata)));
        assert!(is_browser_assist_enabled(Some(&enabled_metadata)));
        assert!(!is_browser_assist_enabled(None));
    }

    #[test]
    fn test_append_browser_assist_session_permissions_adds_session_scoped_rules() {
        let metadata = serde_json::json!({
            "harness": {
                "browser_assist": {
                    "enabled": true,
                    "profile_key": "general_browser_assist"
                }
            }
        });
        let mut permissions = Vec::new();

        append_browser_assist_session_permissions(
            &mut permissions,
            "session-browser-1",
            Some(&metadata),
        );

        let allow_rule = permissions
            .iter()
            .find(|permission| permission.tool == BROWSER_ASSIST_ALLOW_PATTERN)
            .expect("should add browser assist allow rule");
        assert!(allow_rule.allowed);
        assert_eq!(allow_rule.priority, 1100);
        assert_eq!(allow_rule.conditions.len(), 1);
        assert_eq!(
            allow_rule.conditions[0].field.as_deref(),
            Some("session_id")
        );
        assert_eq!(
            allow_rule.conditions[0].value,
            serde_json::json!("session-browser-1")
        );

        let deny_rule = permissions
            .iter()
            .find(|permission| permission.tool == "mcp__playwright__*")
            .expect("should add playwright deny rule");
        assert!(!deny_rule.allowed);
        assert_eq!(deny_rule.priority, 1200);
        assert_eq!(deny_rule.conditions, allow_rule.conditions);
    }

    #[test]
    fn test_build_service_skill_launch_run_request_requires_attached_session() {
        let metadata = serde_json::json!({
            "harness": {
                "browser_assist": {
                    "enabled": true,
                    "profile_key": "attached-github"
                },
                "service_skill_launch": {
                    "kind": "site_adapter",
                    "skill_title": "GitHub 仓库线索检索",
                    "adapter_name": "github/search",
                    "args": {
                        "query": "AI Agent",
                        "limit": 10
                    },
                    "content_id": "content-1",
                    "project_id": "project-1",
                    "save_title": "AI Agent GitHub 结果",
                    "launch_readiness": {
                        "status": "ready",
                        "target_id": "tab-github"
                    }
                }
            }
        });

        let request = build_service_skill_launch_run_request(Some(&metadata))
            .expect("should build run request");

        assert_eq!(request.adapter_name, "github/search");
        assert_eq!(request.profile_key.as_deref(), Some("attached-github"));
        assert_eq!(request.target_id.as_deref(), Some("tab-github"));
        assert_eq!(request.require_attached_session, Some(true));
        assert_eq!(request.skill_title.as_deref(), Some("GitHub 仓库线索检索"));
    }

    #[test]
    fn test_append_service_skill_launch_session_permissions_blocks_browser_compat_tools() {
        let metadata = serde_json::json!({
            "harness": {
                "browser_assist": {
                    "enabled": true,
                    "profile_key": "attached-github"
                },
                "service_skill_launch": {
                    "kind": "site_adapter",
                    "adapter_name": "github/search",
                    "args": {
                        "query": "AI Agent"
                    }
                }
            }
        });
        let mut permissions = Vec::new();

        append_service_skill_launch_session_permissions(
            &mut permissions,
            "session-service-skill-1",
            Some(&metadata),
        );

        let deny_rule = permissions
            .iter()
            .find(|permission| permission.tool == "mcp__lime-browser__*")
            .expect("should add browser compat deny rule");
        assert!(!deny_rule.allowed);
        assert_eq!(deny_rule.priority, 1250);
        assert_eq!(deny_rule.conditions.len(), 1);
        assert_eq!(
            deny_rule.conditions[0].value,
            serde_json::json!("session-service-skill-1")
        );
    }

    #[test]
    fn test_agent_runtime_submit_turn_request_maps_to_aster_chat_request() {
        let json = r#"{
            "message": "Hello runtime",
            "session_id": "runtime-session",
            "event_name": "runtime_stream",
            "workspace_id": "workspace-runtime",
            "turn_config": {
                "execution_strategy": "auto",
                "web_search": true,
                "provider_preference": "custom-provider",
                "model_preference": "gpt-5.3-codex",
                "thinking_enabled": true,
                "system_prompt": "runtime prompt",
                "provider_config": {
                    "provider_id": "custom-provider",
                    "provider_name": "custom-provider",
                    "model_name": "gpt-5.3-codex"
                },
                "metadata": {
                    "source": "hook-facade"
                }
            }
        }"#;

        let request: AgentRuntimeSubmitTurnRequest = serde_json::from_str(json).unwrap();
        let mapped: AsterChatRequest = request.into();

        assert_eq!(mapped.message, "Hello runtime");
        assert_eq!(mapped.session_id, "runtime-session");
        assert_eq!(mapped.event_name, "runtime_stream");
        assert_eq!(mapped.workspace_id, "workspace-runtime");
        assert_eq!(
            mapped.execution_strategy,
            Some(AsterExecutionStrategy::Auto)
        );
        assert_eq!(mapped.web_search, Some(true));
        assert_eq!(
            mapped.provider_preference.as_deref(),
            Some("custom-provider")
        );
        assert_eq!(mapped.model_preference.as_deref(), Some("gpt-5.3-codex"));
        assert_eq!(mapped.thinking_enabled, Some(true));
        assert_eq!(mapped.system_prompt.as_deref(), Some("runtime prompt"));
        assert_eq!(
            mapped
                .provider_config
                .as_ref()
                .and_then(|config| config.provider_id.as_deref()),
            Some("custom-provider")
        );
        assert_eq!(
            mapped
                .metadata
                .as_ref()
                .and_then(|value| value.get("source"))
                .and_then(serde_json::Value::as_str),
            Some("hook-facade")
        );
    }

    #[test]
    fn test_agent_runtime_submit_turn_request_allows_missing_workspace_id() {
        let json = r#"{
            "message": "Hello runtime",
            "session_id": "runtime-session",
            "event_name": "runtime_stream",
            "turn_config": {
                "execution_strategy": "auto",
                "web_search": true
            }
        }"#;

        let request: AgentRuntimeSubmitTurnRequest = serde_json::from_str(json).unwrap();
        assert_eq!(request.workspace_id, None);

        let mapped: AsterChatRequest = request.into();
        assert_eq!(mapped.workspace_id, "");
        assert_eq!(
            mapped.execution_strategy,
            Some(AsterExecutionStrategy::Auto)
        );
        assert_eq!(mapped.web_search, Some(true));
    }

    #[test]
    fn test_build_runtime_user_message_includes_images() {
        let message = build_runtime_user_message(
            "这个是什么",
            Some(&[ImageInput {
                data: "aGVsbG8=".to_string(),
                media_type: "image/png".to_string(),
            }]),
        );

        assert_eq!(message.as_concat_text(), "这个是什么");
        assert_eq!(message.content.len(), 2);

        if let MessageContent::Image(image) = &message.content[1] {
            assert_eq!(image.data, "aGVsbG8=");
            assert_eq!(image.mime_type, "image/png");
        } else {
            panic!("expected image content in runtime user message");
        }
    }

    #[test]
    fn test_build_runtime_action_user_data_prefers_structured_payload() {
        let request = AgentRuntimeRespondActionRequest {
            session_id: "session-1".to_string(),
            request_id: "req-1".to_string(),
            action_type: AgentRuntimeActionType::AskUser,
            confirmed: true,
            response: Some("{\"answer\":\"A\"}".to_string()),
            user_data: Some(serde_json::json!({ "answer": "B" })),
            metadata: None,
            event_name: None,
            action_scope: None,
        };

        assert_eq!(
            build_runtime_action_user_data(&request),
            serde_json::json!({ "answer": "B" })
        );
    }

    #[test]
    fn test_build_runtime_action_user_data_parses_json_response() {
        let request = AgentRuntimeRespondActionRequest {
            session_id: "session-1".to_string(),
            request_id: "req-1".to_string(),
            action_type: AgentRuntimeActionType::Elicitation,
            confirmed: true,
            response: Some("{\"answer\":\"A\"}".to_string()),
            user_data: None,
            metadata: None,
            event_name: None,
            action_scope: None,
        };

        assert_eq!(
            build_runtime_action_user_data(&request),
            serde_json::json!({ "answer": "A" })
        );
    }

    #[test]
    fn test_build_runtime_action_user_data_returns_empty_string_when_not_confirmed() {
        let request = AgentRuntimeRespondActionRequest {
            session_id: "session-1".to_string(),
            request_id: "req-2".to_string(),
            action_type: AgentRuntimeActionType::AskUser,
            confirmed: false,
            response: Some("{\"answer\":\"A\"}".to_string()),
            user_data: None,
            metadata: None,
            event_name: None,
            action_scope: None,
        };

        assert_eq!(
            build_runtime_action_user_data(&request),
            serde_json::Value::String(String::new())
        );
    }

    #[test]
    fn test_agent_runtime_respond_action_request_deserializes_event_name_alias() {
        let request: AgentRuntimeRespondActionRequest = serde_json::from_value(serde_json::json!({
            "sessionId": "session-1",
            "requestId": "req-1",
            "actionType": "ask_user",
            "confirmed": true,
            "eventName": "aster_stream_session-1"
        }))
        .expect("request should deserialize");

        assert_eq!(request.session_id, "session-1");
        assert_eq!(request.request_id, "req-1");
        assert_eq!(request.action_type, AgentRuntimeActionType::AskUser);
        assert_eq!(
            request.event_name.as_deref(),
            Some("aster_stream_session-1")
        );
    }

    #[test]
    fn test_agent_runtime_respond_action_request_deserializes_action_scope_aliases() {
        let request: AgentRuntimeRespondActionRequest = serde_json::from_value(serde_json::json!({
            "sessionId": "session-1",
            "requestId": "req-2",
            "actionType": "elicitation",
            "confirmed": true,
            "actionScope": {
                "sessionId": "session-1",
                "threadId": "thread-1",
                "turnId": "turn-1"
            }
        }))
        .expect("request should deserialize");

        assert_eq!(
            request.action_scope,
            Some(AgentRuntimeActionScope {
                session_id: Some("session-1".to_string()),
                thread_id: Some("thread-1".to_string()),
                turn_id: Some("turn-1".to_string()),
            })
        );
    }

    #[test]
    fn test_build_runtime_action_scope_ignores_blank_values() {
        let request = AgentRuntimeRespondActionRequest {
            session_id: "session-1".to_string(),
            request_id: "req-3".to_string(),
            action_type: AgentRuntimeActionType::AskUser,
            confirmed: true,
            response: None,
            user_data: None,
            metadata: None,
            event_name: None,
            action_scope: Some(AgentRuntimeActionScope {
                session_id: Some(" session-1 ".to_string()),
                thread_id: Some("   ".to_string()),
                turn_id: Some("turn-1".to_string()),
            }),
        };

        assert_eq!(
            build_runtime_action_scope(&request),
            Some(ActionRequiredScope {
                session_id: Some("session-1".to_string()),
                thread_id: None,
                turn_id: Some("turn-1".to_string()),
            })
        );
    }

    #[test]
    fn test_agent_runtime_promote_queued_turn_request_deserializes_aliases() {
        let request: AgentRuntimePromoteQueuedTurnRequest =
            serde_json::from_value(serde_json::json!({
                "sessionId": "session-1",
                "queuedTurnId": "queued-2"
            }))
            .expect("request should deserialize");

        assert_eq!(request.session_id, "session-1");
        assert_eq!(request.queued_turn_id, "queued-2");
    }

    #[test]
    fn test_agent_runtime_update_session_request_deserializes_recent_preferences_aliases() {
        let request: AgentRuntimeUpdateSessionRequest = serde_json::from_value(serde_json::json!({
            "sessionId": "session-1",
            "providerName": "openai",
            "modelName": "gpt-5.4",
            "recentPreferences": {
                "webSearch": true,
                "thinking": false,
                "task": true,
                "subagent": true
            }
        }))
        .expect("request should deserialize");

        assert_eq!(request.session_id, "session-1");
        assert_eq!(request.provider_name.as_deref(), Some("openai"));
        assert_eq!(request.model_name.as_deref(), Some("gpt-5.4"));
        assert_eq!(
            request.recent_preferences,
            Some(lime_agent::SessionExecutionRuntimePreferences {
                web_search: true,
                thinking: false,
                task: true,
                subagent: true,
            })
        );
    }

    #[test]
    fn test_agent_runtime_update_session_request_deserializes_recent_team_selection_aliases() {
        let request: AgentRuntimeUpdateSessionRequest = serde_json::from_value(serde_json::json!({
            "sessionId": "session-1",
            "recentTeamSelection": {
                "disabled": false,
                "theme": "general",
                "preferredTeamPresetId": "code-triage-team",
                "selectedTeamId": "custom-team-1",
                "selectedTeamSource": "custom",
                "selectedTeamLabel": "前端联调团队",
                "selectedTeamDescription": "分析、实现、验证三段式推进。",
                "selectedTeamSummary": "分析、实现、验证三段式推进。 角色分工：分析：负责定位问题与影响范围。",
                "selectedTeamRoles": [
                    {
                        "id": "explorer",
                        "label": "分析",
                        "summary": "负责定位问题与影响范围。",
                        "profileId": "code-explorer",
                        "roleKey": "explorer",
                        "skillIds": ["repo-exploration"]
                    }
                ]
            }
        }))
        .expect("request should deserialize");

        assert_eq!(request.session_id, "session-1");
        assert_eq!(
            request.recent_team_selection,
            Some(lime_agent::SessionExecutionRuntimeRecentTeamSelection {
                disabled: false,
                theme: Some("general".to_string()),
                preferred_team_preset_id: Some("code-triage-team".to_string()),
                selected_team_id: Some("custom-team-1".to_string()),
                selected_team_source: Some("custom".to_string()),
                selected_team_label: Some("前端联调团队".to_string()),
                selected_team_description: Some("分析、实现、验证三段式推进。".to_string()),
                selected_team_summary: Some(
                    "分析、实现、验证三段式推进。 角色分工：分析：负责定位问题与影响范围。"
                        .to_string(),
                ),
                selected_team_roles: Some(vec![
                    lime_agent::SessionExecutionRuntimeRecentTeamRole {
                        id: "explorer".to_string(),
                        label: "分析".to_string(),
                        summary: "负责定位问题与影响范围。".to_string(),
                        profile_id: Some("code-explorer".to_string()),
                        role_key: Some("explorer".to_string()),
                        skill_ids: vec!["repo-exploration".to_string()],
                    },
                ]),
            })
        );
    }

    #[test]
    fn test_extract_artifact_path_from_tool_start_reads_write_file_path() {
        let path = extract_artifact_path_from_tool_start(
            "write_file",
            Some(r##"{"path":"social-posts/demo.md","content":"# 标题"}"##),
            "/tmp/workspace",
        );

        assert_eq!(path.as_deref(), Some("social-posts/demo.md"));
    }

    #[test]
    fn test_extract_artifact_path_from_tool_start_reads_nested_artifact_protocol_path() {
        let path = extract_artifact_path_from_tool_start(
            "write_file",
            Some(r##"{"payload":{"artifact_paths":["social-posts\\nested.md"]}}"##),
            "/tmp/workspace",
        );

        assert_eq!(path.as_deref(), Some("social-posts/nested.md"));
    }

    #[test]
    fn test_resolve_social_run_artifact_descriptor_matches_social_draft() {
        let descriptor = resolve_social_run_artifact_descriptor(
            "social-posts/draft.md",
            Some("write_mode"),
            Some("社媒初稿"),
        );

        assert_eq!(descriptor.artifact_type, "draft");
        assert_eq!(descriptor.stage, "drafting");
        assert_eq!(descriptor.version_label, "社媒初稿");
        assert!(!descriptor.is_auxiliary);
    }

    #[test]
    fn test_build_chat_run_finish_metadata_includes_social_fields() {
        let base = build_chat_run_metadata_base(
            &AsterChatRequest {
                message: "hello".to_string(),
                session_id: "session-1".to_string(),
                event_name: "event-1".to_string(),
                images: None,
                provider_config: None,
                provider_preference: None,
                model_preference: None,
                thinking_enabled: None,
                approval_policy: None,
                sandbox_policy: None,
                project_id: Some("project-1".to_string()),
                workspace_id: "workspace-1".to_string(),
                web_search: Some(false),
                search_mode: None,
                execution_strategy: Some(AsterExecutionStrategy::React),
                auto_continue: None,
                system_prompt: None,
                metadata: Some(serde_json::json!({
                    "harness": {
                        "theme": "social-media",
                        "gate_key": "write_mode"
                    }
                })),
                turn_id: None,
                queue_if_busy: None,
                queued_turn_id: None,
            },
            "workspace-1",
            AsterExecutionStrategy::React,
            &RequestToolPolicy {
                search_mode: RequestToolPolicyMode::Disabled,
                effective_web_search: false,
                required_tools: vec![],
                allowed_tools: vec![],
                disallowed_tools: vec![],
            },
            false,
            None,
            None,
        );
        let mut observation = ChatRunObservation::default();
        observation.record_artifact_path(
            "social-posts/draft.md".to_string(),
            Some(&serde_json::json!({
                "harness": {
                    "theme": "social-media",
                    "gate_key": "write_mode"
                }
            })),
        );

        let metadata = build_chat_run_finish_metadata(&base, &observation);

        assert_eq!(
            metadata
                .get("artifact_paths")
                .and_then(serde_json::Value::as_array),
            Some(&vec![serde_json::json!("social-posts/draft.md")])
        );
        assert_eq!(
            metadata
                .get("artifact_type")
                .and_then(serde_json::Value::as_str),
            Some("draft")
        );
        assert_eq!(
            metadata.get("stage").and_then(serde_json::Value::as_str),
            Some("drafting")
        );
        assert_eq!(
            metadata
                .get("version_id")
                .and_then(serde_json::Value::as_str),
            Some("artifact:social-posts/draft.md")
        );
    }

    #[test]
    fn test_extract_harness_bool_reads_nested_preferences() {
        let metadata = serde_json::json!({
            "harness": {
                "preferences": {
                    "web_search": true,
                    "thinking": true,
                    "task": false,
                    "subagent": true
                }
            }
        });

        assert_eq!(
            extract_harness_bool(Some(&metadata), &["web_search_enabled", "webSearchEnabled"]),
            Some(true)
        );
        assert_eq!(
            extract_harness_bool(Some(&metadata), &["thinking_enabled", "thinkingEnabled"]),
            Some(true)
        );
        assert_eq!(
            extract_harness_bool(Some(&metadata), &["task_mode_enabled", "taskModeEnabled"]),
            Some(false)
        );
        assert_eq!(
            extract_harness_bool(
                Some(&metadata),
                &["subagent_mode_enabled", "subagentModeEnabled"]
            ),
            Some(true)
        );
    }

    #[test]
    fn test_resolve_request_web_search_preference_from_sources_prefers_request_flag() {
        let metadata = serde_json::json!({
            "harness": {
                "preferences": {
                    "web_search": false
                }
            }
        });
        let session_recent_preferences = lime_agent::SessionExecutionRuntimePreferences {
            web_search: false,
            thinking: true,
            task: false,
            subagent: true,
        };

        assert_eq!(
            resolve_request_web_search_preference_from_sources(
                Some(true),
                Some(&metadata),
                Some(&session_recent_preferences),
            ),
            Some(true)
        );
    }

    #[test]
    fn test_resolve_request_web_search_preference_from_sources_reads_nested_metadata() {
        let metadata = serde_json::json!({
            "harness": {
                "preferences": {
                    "web_search": true
                }
            }
        });
        let session_recent_preferences = lime_agent::SessionExecutionRuntimePreferences {
            web_search: false,
            thinking: true,
            task: false,
            subagent: true,
        };

        assert_eq!(
            resolve_request_web_search_preference_from_sources(
                None,
                Some(&metadata),
                Some(&session_recent_preferences),
            ),
            Some(true)
        );
    }

    #[test]
    fn test_resolve_request_web_search_preference_from_sources_falls_back_to_session_runtime() {
        let session_recent_preferences = lime_agent::SessionExecutionRuntimePreferences {
            web_search: true,
            thinking: true,
            task: false,
            subagent: true,
        };

        assert_eq!(
            resolve_request_web_search_preference_from_sources(
                None,
                None,
                Some(&session_recent_preferences),
            ),
            Some(true)
        );
    }

    #[test]
    fn test_build_chat_run_metadata_base_flattens_nested_preferences() {
        let metadata = build_chat_run_metadata_base(
            &AsterChatRequest {
                message: "hello".to_string(),
                session_id: "session-1".to_string(),
                event_name: "event-1".to_string(),
                images: None,
                provider_config: None,
                provider_preference: None,
                model_preference: None,
                thinking_enabled: None,
                approval_policy: None,
                sandbox_policy: None,
                project_id: Some("project-1".to_string()),
                workspace_id: "workspace-1".to_string(),
                web_search: Some(false),
                search_mode: None,
                execution_strategy: Some(AsterExecutionStrategy::React),
                auto_continue: None,
                system_prompt: None,
                metadata: Some(serde_json::json!({
                    "harness": {
                        "theme": "general",
                        "preferences": {
                            "thinking": true,
                            "task": false,
                            "subagent": true
                        }
                    }
                })),
                turn_id: None,
                queue_if_busy: None,
                queued_turn_id: None,
            },
            "workspace-1",
            AsterExecutionStrategy::React,
            &RequestToolPolicy {
                search_mode: RequestToolPolicyMode::Disabled,
                effective_web_search: false,
                required_tools: vec![],
                allowed_tools: vec![],
                disallowed_tools: vec![],
            },
            false,
            None,
            None,
        );

        assert_eq!(
            metadata
                .get("thinking_enabled")
                .and_then(serde_json::Value::as_bool),
            Some(true)
        );
        assert_eq!(
            metadata
                .get("task_mode_enabled")
                .and_then(serde_json::Value::as_bool),
            Some(false)
        );
        assert_eq!(
            metadata
                .get("subagent_mode_enabled")
                .and_then(serde_json::Value::as_bool),
            Some(true)
        );
    }

    #[test]
    fn test_build_chat_run_metadata_base_falls_back_to_session_recent_preferences() {
        let session_recent_preferences = lime_agent::SessionExecutionRuntimePreferences {
            web_search: false,
            thinking: true,
            task: true,
            subagent: false,
        };
        let metadata = build_chat_run_metadata_base(
            &AsterChatRequest {
                message: "hello".to_string(),
                session_id: "session-1".to_string(),
                event_name: "event-1".to_string(),
                images: None,
                provider_config: None,
                provider_preference: None,
                model_preference: None,
                thinking_enabled: None,
                approval_policy: None,
                sandbox_policy: None,
                project_id: Some("project-1".to_string()),
                workspace_id: "workspace-1".to_string(),
                web_search: None,
                search_mode: None,
                execution_strategy: Some(AsterExecutionStrategy::React),
                auto_continue: None,
                system_prompt: None,
                metadata: Some(serde_json::json!({
                    "harness": {
                        "theme": "general",
                    }
                })),
                turn_id: None,
                queue_if_busy: None,
                queued_turn_id: None,
            },
            "workspace-1",
            AsterExecutionStrategy::React,
            &RequestToolPolicy {
                search_mode: RequestToolPolicyMode::Disabled,
                effective_web_search: false,
                required_tools: vec![],
                allowed_tools: vec![],
                disallowed_tools: vec![],
            },
            false,
            None,
            Some(&session_recent_preferences),
        );

        assert_eq!(
            metadata
                .get("thinking_enabled")
                .and_then(serde_json::Value::as_bool),
            Some(true)
        );
        assert_eq!(
            metadata
                .get("task_mode_enabled")
                .and_then(serde_json::Value::as_bool),
            Some(true)
        );
        assert_eq!(
            metadata
                .get("subagent_mode_enabled")
                .and_then(serde_json::Value::as_bool),
            Some(false)
        );
    }

    #[test]
    fn test_build_chat_run_metadata_base_derives_access_mode_from_formal_turn_context() {
        let metadata = build_chat_run_metadata_base(
            &AsterChatRequest {
                message: "hello".to_string(),
                session_id: "session-access".to_string(),
                event_name: "event-access".to_string(),
                images: None,
                provider_config: None,
                provider_preference: None,
                model_preference: None,
                thinking_enabled: None,
                approval_policy: Some("never".to_string()),
                sandbox_policy: Some("danger-full-access".to_string()),
                project_id: None,
                workspace_id: "workspace-1".to_string(),
                web_search: Some(false),
                search_mode: None,
                execution_strategy: Some(AsterExecutionStrategy::React),
                auto_continue: None,
                system_prompt: None,
                metadata: None,
                turn_id: None,
                queue_if_busy: None,
                queued_turn_id: None,
            },
            "workspace-1",
            AsterExecutionStrategy::React,
            &RequestToolPolicy {
                search_mode: RequestToolPolicyMode::Disabled,
                effective_web_search: false,
                required_tools: vec![],
                allowed_tools: vec![],
                disallowed_tools: vec![],
            },
            false,
            None,
            None,
        );

        assert_eq!(
            metadata
                .get("approval_policy")
                .and_then(serde_json::Value::as_str),
            Some("never")
        );
        assert_eq!(
            metadata
                .get("sandbox_policy")
                .and_then(serde_json::Value::as_str),
            Some("danger-full-access")
        );
        assert_eq!(
            metadata
                .get("access_mode")
                .and_then(serde_json::Value::as_str),
            Some("full-access")
        );
    }

    #[test]
    fn test_chat_run_observation_records_nested_artifact_protocol_paths_from_tool_result() {
        let mut observation = ChatRunObservation::default();
        observation.record_event(
            &RuntimeAgentEvent::ToolEnd {
                tool_id: "tool-1".to_string(),
                result: lime_agent::AgentToolResult {
                    success: true,
                    output: "done".to_string(),
                    error: None,
                    images: None,
                    metadata: Some(HashMap::from([(
                        "payload".to_string(),
                        serde_json::json!({
                            "artifact_paths": [" /tmp/workspace/social-posts\\final.md "]
                        }),
                    )])),
                },
            },
            "/tmp/workspace",
            Some(&serde_json::json!({
                "harness": {
                    "theme": "social-media",
                    "gate_key": "write_mode"
                }
            })),
            ProviderContinuationCapability::HistoryReplayOnly,
        );

        assert_eq!(
            observation.artifact_paths,
            vec!["social-posts/final.md".to_string()]
        );
        assert_eq!(
            observation
                .primary_social_artifact
                .as_ref()
                .map(|artifact| artifact.source_file_name.as_str()),
            Some("social-posts/final.md")
        );
    }

    #[test]
    fn test_chat_run_observation_ignores_output_file_log_hint_without_explicit_artifact_path() {
        let mut observation = ChatRunObservation::default();
        observation.record_event(
            &RuntimeAgentEvent::ToolEnd {
                tool_id: "tool-1".to_string(),
                result: lime_agent::AgentToolResult {
                    success: true,
                    output: "done".to_string(),
                    error: None,
                    images: None,
                    metadata: Some(HashMap::from([(
                        "output_file".to_string(),
                        serde_json::json!("/tmp/workspace/tasks/task.log"),
                    )])),
                },
            },
            "/tmp/workspace",
            Some(&serde_json::json!({
                "harness": {
                    "theme": "social-media",
                    "gate_key": "write_mode"
                }
            })),
            ProviderContinuationCapability::HistoryReplayOnly,
        );

        assert!(observation.artifact_paths.is_empty());
        assert!(observation.primary_social_artifact.is_none());
    }

    #[test]
    fn test_chat_run_observation_falls_back_to_probable_output_file_artifact_hint() {
        let mut observation = ChatRunObservation::default();
        observation.record_event(
            &RuntimeAgentEvent::ToolEnd {
                tool_id: "tool-1".to_string(),
                result: lime_agent::AgentToolResult {
                    success: true,
                    output: "done".to_string(),
                    error: None,
                    images: None,
                    metadata: Some(HashMap::from([(
                        "output_file".to_string(),
                        serde_json::json!("/tmp/workspace/social-posts/final.md"),
                    )])),
                },
            },
            "/tmp/workspace",
            Some(&serde_json::json!({
                "harness": {
                    "theme": "social-media",
                    "gate_key": "write_mode"
                }
            })),
            ProviderContinuationCapability::HistoryReplayOnly,
        );

        assert_eq!(
            observation.artifact_paths,
            vec!["social-posts/final.md".to_string()]
        );
        assert_eq!(
            observation
                .primary_social_artifact
                .as_ref()
                .map(|artifact| artifact.source_file_name.as_str()),
            Some("social-posts/final.md")
        );
    }

    #[test]
    fn test_chat_run_observation_records_previous_response_id_from_message_event() {
        let mut observation = ChatRunObservation::default();
        observation.record_event(
            &RuntimeAgentEvent::Message {
                message: lime_agent::AgentMessage {
                    id: Some("resp-1".to_string()),
                    role: "assistant".to_string(),
                    content: vec![lime_agent::AgentMessageContent::Text {
                        text: "hello".to_string(),
                    }],
                    timestamp: 0,
                },
            },
            "/tmp/workspace",
            None,
            ProviderContinuationCapability::PreviousResponseId,
        );

        assert_eq!(
            observation.provider_continuation,
            Some(ProviderContinuationState::previous_response_id("resp-1"))
        );
    }

    #[test]
    fn test_chat_run_observation_records_provider_session_token_from_message_event() {
        let mut observation = ChatRunObservation::default();
        observation.record_event(
            &RuntimeAgentEvent::Message {
                message: lime_agent::AgentMessage {
                    id: Some("conv-1".to_string()),
                    role: "assistant".to_string(),
                    content: vec![lime_agent::AgentMessageContent::Text {
                        text: "hello".to_string(),
                    }],
                    timestamp: 0,
                },
            },
            "/tmp/workspace",
            None,
            ProviderContinuationCapability::ProviderSessionToken,
        );

        assert_eq!(
            observation.provider_continuation,
            Some(ProviderContinuationState::provider_session_token("conv-1"))
        );
    }

    #[test]
    fn test_build_chat_run_finish_metadata_includes_provider_continuation() {
        let mut observation = ChatRunObservation::default();
        observation.provider_continuation =
            Some(ProviderContinuationState::previous_response_id("resp-1"));

        let metadata = build_chat_run_finish_metadata(&serde_json::Map::new(), &observation);

        assert_eq!(
            metadata.get("provider_continuation"),
            Some(&serde_json::json!({
                "kind": "previous_response_id",
                "previous_response_id": "resp-1"
            }))
        );
        assert_eq!(
            metadata
                .get("provider_continuation_kind")
                .and_then(serde_json::Value::as_str),
            Some("previous_response_id")
        );
    }

    #[test]
    fn test_provider_routing_matches_current_allows_missing_selector_on_historical_run() {
        let previous = TurnProviderRoutingSnapshot {
            provider_name: "OpenAI".to_string(),
            provider_selector: None,
            model_name: "o3-mini".to_string(),
            credential_uuid: None,
            configured_from_request: false,
            used_inline_api_key: false,
        };
        let current = TurnProviderRoutingSnapshot {
            provider_name: "openai".to_string(),
            provider_selector: Some("openai".to_string()),
            model_name: "o3-mini".to_string(),
            credential_uuid: Some("cred-1".to_string()),
            configured_from_request: true,
            used_inline_api_key: true,
        };

        assert!(provider_routing_matches_current(&previous, &current));
    }

    #[test]
    fn test_aster_execution_strategy_default_is_auto() {
        assert_eq!(
            AsterExecutionStrategy::default(),
            AsterExecutionStrategy::Auto
        );
    }

    #[test]
    fn test_aster_execution_strategy_from_db_value_none_is_auto() {
        assert_eq!(
            AsterExecutionStrategy::from_db_value(None),
            AsterExecutionStrategy::Auto
        );
    }

    #[test]
    fn test_aster_execution_strategy_from_db_value_unknown_is_auto() {
        assert_eq!(
            AsterExecutionStrategy::from_db_value(Some("unknown")),
            AsterExecutionStrategy::Auto
        );
    }

    #[test]
    fn test_aster_execution_strategy_auto_prefers_react_when_tool_search_explicit() {
        let strategy =
            AsterExecutionStrategy::Auto.effective_for_message("请先调用 tool_search 再继续");
        assert_eq!(strategy, AsterExecutionStrategy::React);
    }

    #[test]
    fn test_aster_execution_strategy_auto_prefers_react_for_generic_web_search() {
        let strategy =
            AsterExecutionStrategy::Auto.effective_for_message("帮我联网搜索今天的 AI 新闻");
        assert_eq!(strategy, AsterExecutionStrategy::React);
    }

    #[test]
    fn test_aster_execution_strategy_auto_defaults_react_for_code_task() {
        let strategy = AsterExecutionStrategy::Auto
            .effective_for_message("请抓取这个仓库并修复 Rust 编译错误，然后给出补丁");
        assert_eq!(strategy, AsterExecutionStrategy::React);
    }

    #[test]
    fn test_aster_execution_strategy_code_orchestrated_still_prefers_react_for_web_search() {
        let strategy = AsterExecutionStrategy::CodeOrchestrated
            .effective_for_message("请使用 WebSearch 工具检索并给出来源");
        assert_eq!(strategy, AsterExecutionStrategy::React);
    }

    #[test]
    fn test_aster_execution_strategy_code_orchestrated_forces_react_for_websearch_instruction() {
        let strategy = AsterExecutionStrategy::CodeOrchestrated
            .effective_for_message("请必须使用 WebSearch 工具检索，不要用已有知识回答");
        assert_eq!(strategy, AsterExecutionStrategy::React);
    }

    #[test]
    fn test_merge_system_prompt_with_request_tool_policy_adds_policy_when_enabled() {
        let policy = resolve_request_tool_policy(Some(true), false);
        let merged =
            merge_system_prompt_with_request_tool_policy(Some("你是助手".to_string()), &policy)
                .expect("should have merged prompt");
        assert!(merged.contains(REQUEST_TOOL_POLICY_MARKER));
        assert!(merged.contains("WebSearch"));
    }

    #[test]
    fn test_merge_system_prompt_with_request_tool_policy_keeps_original_when_disabled() {
        let base = Some("你好".to_string());
        let policy = resolve_request_tool_policy(Some(false), false);
        let merged = merge_system_prompt_with_request_tool_policy(base.clone(), &policy);
        assert_eq!(merged, base);
    }

    #[test]
    fn test_merge_system_prompt_with_request_tool_policy_no_duplicate_marker() {
        let base = Some(format!("{REQUEST_TOOL_POLICY_MARKER}\n已有策略"));
        let policy = resolve_request_tool_policy(Some(true), false);
        let merged = merge_system_prompt_with_request_tool_policy(base.clone(), &policy);
        assert_eq!(merged, base);
    }

    #[test]
    fn test_merge_system_prompt_with_auto_continue_appends_prompt() {
        let config = AutoContinuePayload {
            enabled: true,
            fast_mode_enabled: false,
            continuation_length: 1,
            sensitivity: 55,
            source: Some("theme_workbench_document_auto_continue".to_string()),
        };
        let merged =
            merge_system_prompt_with_auto_continue(Some("你是助手".to_string()), Some(&config))
                .expect("should contain merged prompt");
        assert!(merged.contains(AUTO_CONTINUE_PROMPT_MARKER));
        assert!(merged.contains("续写长度"));
        assert!(merged.contains("theme_workbench_document_auto_continue"));
    }

    #[test]
    fn test_merge_system_prompt_with_auto_continue_skip_when_disabled() {
        let config = AutoContinuePayload {
            enabled: false,
            fast_mode_enabled: false,
            continuation_length: 1,
            sensitivity: 55,
            source: None,
        };
        let base = Some("你是助手".to_string());
        let merged = merge_system_prompt_with_auto_continue(base.clone(), Some(&config));
        assert_eq!(merged, base);
    }

    #[test]
    fn test_merge_system_prompt_with_elicitation_context_appends_prompt() {
        let metadata = serde_json::json!({
            "elicitation_context": {
                "source": "legacy_questionnaire",
                "mode": "compatibility_bridge",
                "entries": [
                    {
                        "label": "目标受众",
                        "summary": "客户"
                    },
                    {
                        "label": "语气偏好",
                        "summary": "友好专业"
                    }
                ]
            }
        });

        let merged = merge_system_prompt_with_elicitation_context(
            Some("你是助手".to_string()),
            Some(&metadata),
        )
        .expect("should contain merged prompt");

        assert!(merged.contains(ELICITATION_CONTEXT_PROMPT_MARKER));
        assert!(merged.contains("目标受众"));
        assert!(merged.contains("友好专业"));
        assert!(merged.contains("legacy_questionnaire"));
    }

    #[test]
    fn test_merge_system_prompt_with_elicitation_context_skips_duplicate_marker() {
        let metadata = serde_json::json!({
            "elicitation_context": {
                "entries": [
                    {
                        "label": "目标受众",
                        "summary": "客户"
                    }
                ]
            }
        });
        let base = Some(format!("{ELICITATION_CONTEXT_PROMPT_MARKER}\n已有信息"));
        let merged = merge_system_prompt_with_elicitation_context(base.clone(), Some(&metadata));
        assert_eq!(merged, base);
    }

    #[test]
    fn test_merge_system_prompt_with_elicitation_context_formats_non_string_values() {
        let metadata = serde_json::json!({
            "elicitation_context": {
                "entries": [
                    {
                        "label": "渠道偏好",
                        "value": ["公众号", "视频号"]
                    },
                    {
                        "label": "是否需要 CTA",
                        "value": true
                    },
                    {
                        "label": "目标轮次",
                        "value": 3
                    }
                ]
            }
        });

        let merged = merge_system_prompt_with_elicitation_context(
            Some("你是助手".to_string()),
            Some(&metadata),
        )
        .expect("should contain merged prompt");

        assert!(merged.contains("渠道偏好"));
        assert!(merged.contains("公众号、视频号"));
        assert!(merged.contains("是否需要 CTA"));
        assert!(merged.contains("是"));
        assert!(merged.contains("目标轮次"));
        assert!(merged.contains("3"));
    }

    #[test]
    fn test_merge_system_prompt_with_service_skill_launch_appends_prompt() {
        let metadata = serde_json::json!({
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

        let merged = merge_system_prompt_with_service_skill_launch(
            Some("你是助手".to_string()),
            Some(&metadata),
        )
        .expect("should contain merged prompt");

        assert!(merged.contains(SERVICE_SKILL_LAUNCH_PROMPT_MARKER));
        assert!(merged.contains("github/search"));
        assert!(merged.contains("\"query\":\"AI Agent\""));
        assert!(merged.contains("profile_key=attached-github"));
        assert!(merged.contains("target_id=tab-github"));
        assert!(merged.contains("mcp__lime-browser__browser_navigate"));
        assert!(merged.contains("严格 JSON 对象"));
        assert!(merged.contains("\"adapter_name\":\"github/search\""));
        assert!(merged.contains("不要再让用户额外确认"));
    }

    #[test]
    fn test_merge_system_prompt_with_service_skill_launch_skips_duplicate_marker() {
        let metadata = serde_json::json!({
            "harness": {
                "service_skill_launch": {
                    "kind": "site_adapter",
                    "adapter_name": "github/search",
                    "args": {
                        "query": "AI Agent"
                    }
                }
            }
        });
        let base = Some(format!(
            "{SERVICE_SKILL_LAUNCH_PROMPT_MARKER}\n已有站点技能上下文"
        ));

        let merged = merge_system_prompt_with_service_skill_launch(base.clone(), Some(&metadata));

        assert_eq!(merged, base);
    }

    #[test]
    fn test_merge_system_prompt_with_service_skill_launch_includes_missing_session_failure_contract(
    ) {
        let metadata = serde_json::json!({
            "harness": {
                "service_skill_launch": {
                    "kind": "site_adapter",
                    "skill_title": "GitHub 仓库线索检索",
                    "adapter_name": "github/search",
                    "args": {
                        "query": "AI Agent"
                    },
                    "launch_readiness": {
                        "status": "attached_session_required",
                        "message": "当前缺少已附着的 GitHub 浏览器上下文。",
                        "report_hint": "请先连接并停留在 github.com。"
                    }
                }
            }
        });

        let merged = merge_system_prompt_with_service_skill_launch(
            Some("你是助手".to_string()),
            Some(&metadata),
        )
        .expect("should contain merged prompt");

        assert!(
            merged.contains("attached_session_required、no_matching_context、登录受限或权限受限")
        );
        assert!(merged.contains("当前缺少可执行的浏览器上下文"));
        assert!(merged.contains("不要再让用户额外确认"));
        assert!(merged.contains("请先连接并停留在 github.com。"));
    }

    #[test]
    fn test_merge_system_prompt_with_service_skill_launch_preload_appends_result_context() {
        let execution = ServiceSkillLaunchPreloadExecution {
            request: RunSiteAdapterRequest {
                adapter_name: "github/search".to_string(),
                args: serde_json::json!({
                    "query": "AI Agent",
                    "limit": 10
                }),
                profile_key: Some("attached-github".to_string()),
                target_id: Some("tab-github".to_string()),
                timeout_ms: None,
                content_id: Some("content-1".to_string()),
                project_id: Some("project-1".to_string()),
                save_title: Some("AI Agent GitHub 结果".to_string()),
                require_attached_session: Some(true),
                skill_title: Some("GitHub 仓库线索检索".to_string()),
            },
            adapter: Some(SiteAdapterDefinition {
                name: "github/search".to_string(),
                domain: "github.com".to_string(),
                description: "按关键词采集 GitHub 仓库搜索结果。".to_string(),
                read_only: true,
                capabilities: vec!["search".to_string()],
                input_schema: serde_json::json!({}),
                example_args: serde_json::json!({"query":"mcp","limit":5}),
                example: "github/search {\"query\":\"mcp\"}".to_string(),
                auth_hint: Some("请先登录 GitHub。".to_string()),
                source_kind: Some("bundled".to_string()),
                source_version: Some("2026-03-25".to_string()),
            }),
            result: SiteAdapterRunResult {
                ok: true,
                adapter: "github/search".to_string(),
                domain: "github.com".to_string(),
                profile_key: "attached-github".to_string(),
                session_id: Some("session-1".to_string()),
                target_id: Some("tab-github".to_string()),
                entry_url: "https://github.com/search?q=AI%20Agent&type=repositories".to_string(),
                source_url: Some(
                    "https://github.com/search?q=AI%20Agent&type=repositories".to_string(),
                ),
                data: Some(serde_json::json!({
                    "items": [
                        {"title": "microsoft/autogen"}
                    ]
                })),
                error_code: None,
                error_message: None,
                auth_hint: None,
                report_hint: None,
                saved_content: None,
                saved_project_id: None,
                saved_by: None,
                save_skipped_project_id: None,
                save_skipped_by: None,
                save_error_message: None,
            },
        };

        let merged = merge_system_prompt_with_service_skill_launch_preload(
            Some("你是助手".to_string()),
            Some(&execution),
        )
        .expect("should contain preload prompt");

        assert!(merged.contains(SERVICE_SKILL_LAUNCH_PRELOAD_PROMPT_MARKER));
        assert!(merged.contains("系统侧预执行成功"));
        assert!(merged.contains("不要再次调用 lime_site_run"));
        assert!(merged.contains("microsoft/autogen"));
        assert!(merged.contains("\"require_attached_session\":true"));
    }

    #[test]
    fn test_merge_system_prompt_with_service_skill_launch_preload_handles_missing_context_failure()
    {
        let execution = ServiceSkillLaunchPreloadExecution {
            request: RunSiteAdapterRequest {
                adapter_name: "github/search".to_string(),
                args: serde_json::json!({
                    "query": "AI Agent"
                }),
                profile_key: Some("attached-github".to_string()),
                target_id: None,
                timeout_ms: None,
                content_id: None,
                project_id: None,
                save_title: None,
                require_attached_session: Some(true),
                skill_title: Some("GitHub 仓库线索检索".to_string()),
            },
            adapter: None,
            result: SiteAdapterRunResult {
                ok: false,
                adapter: "github/search".to_string(),
                domain: "github.com".to_string(),
                profile_key: "attached-github".to_string(),
                session_id: None,
                target_id: None,
                entry_url: "https://github.com/search?q=AI%20Agent&type=repositories".to_string(),
                source_url: None,
                data: None,
                error_code: Some("attached_session_required".to_string()),
                error_message: Some("当前缺少已附着的 GitHub 浏览器上下文。".to_string()),
                auth_hint: None,
                report_hint: Some("请先连接并停留在 github.com。".to_string()),
                saved_content: None,
                saved_project_id: None,
                saved_by: None,
                save_skipped_project_id: None,
                save_skipped_by: None,
                save_error_message: None,
            },
        };

        let merged = merge_system_prompt_with_service_skill_launch_preload(
            Some("你是助手".to_string()),
            Some(&execution),
        )
        .expect("should contain preload prompt");

        assert!(merged.contains("attached_session_required"));
        assert!(merged.contains("先连接并附着到目标站点页面"));
        assert!(merged.contains("不要再次尝试调用 lime_site_run"));
        assert!(merged.contains("请先连接并停留在 github.com。"));
    }

    #[test]
    fn test_should_fallback_to_react_from_code_orchestrated_when_no_event_emitted() {
        let error = ReplyAttemptError {
            message: "Stream error: timeout".to_string(),
            emitted_any: false,
        };
        assert!(should_fallback_to_react_from_code_orchestrated(&error));
    }

    #[test]
    fn test_should_fallback_to_react_from_code_orchestrated_when_unknown_subscript() {
        let error = ReplyAttemptError {
            message: "Agent provider execution failed: Unknown subscript 'web_scraping'"
                .to_string(),
            emitted_any: true,
        };
        assert!(should_fallback_to_react_from_code_orchestrated(&error));
    }

    #[test]
    fn test_should_not_fallback_to_react_from_code_orchestrated_for_general_error() {
        let error = ReplyAttemptError {
            message: "Agent provider execution failed: quota exceeded".to_string(),
            emitted_any: true,
        };
        assert!(!should_fallback_to_react_from_code_orchestrated(&error));
    }

    #[test]
    fn test_validate_elicitation_submission_rejects_empty_session_id() {
        let result = validate_elicitation_submission("   ", "req-1");
        assert_eq!(result, Err("session_id 不能为空".to_string()));
    }

    #[test]
    fn test_validate_elicitation_submission_rejects_empty_request_id() {
        let result = validate_elicitation_submission("session-1", "   ");
        assert_eq!(result, Err("request_id 不能为空".to_string()));
    }

    #[test]
    fn test_validate_elicitation_submission_trims_session_id() {
        let result = validate_elicitation_submission("  session-1  ", "req-1");
        assert_eq!(result, Ok("session-1".to_string()));
    }

    #[test]
    fn test_build_action_resume_runtime_status_contains_resume_copy() {
        let status = build_action_resume_runtime_status();
        assert_eq!(status.phase, "routing");
        assert_eq!(status.title, "已提交补充信息，继续执行中");
        assert!(status.detail.contains("恢复后续步骤"));
        assert_eq!(status.checkpoints.len(), 3);
    }

    #[test]
    fn test_normalize_workspace_tool_permission_behavior_auto_mode_allows_warning() {
        let permission = PermissionCheckResult::ask("需要确认");
        let normalized = normalize_workspace_tool_permission_behavior(permission, true);
        assert_eq!(normalized.behavior, PermissionBehavior::Allow);
        assert!(normalized.message.is_none());
    }

    #[test]
    fn test_normalize_workspace_tool_permission_behavior_non_auto_denies_warning() {
        let permission = PermissionCheckResult::ask("需要确认");
        let normalized = normalize_workspace_tool_permission_behavior(permission, false);
        assert_eq!(normalized.behavior, PermissionBehavior::Deny);
        assert!(normalized
            .message
            .as_deref()
            .unwrap_or_default()
            .contains("当前模式不支持交互确认"));
    }

    #[test]
    fn test_build_workspace_shell_allow_pattern_strict_mode_rejects_python_command() {
        let escaped_root = regex::escape("/tmp/workspace");
        let pattern = build_workspace_shell_allow_pattern(&escaped_root, false);
        let regex = Regex::new(&pattern).unwrap();

        assert!(regex.is_match("rg -n \"foo\" ."));
        assert!(!regex.is_match("python -m pip install playwright"));
    }

    #[test]
    fn test_build_workspace_shell_allow_pattern_auto_mode_allows_common_commands() {
        let escaped_root = regex::escape("/tmp/workspace");
        let pattern = build_workspace_shell_allow_pattern(&escaped_root, true);
        let regex = Regex::new(&pattern).unwrap();

        assert!(regex.is_match("python -m pip install playwright"));
        assert!(regex.is_match("npm install && npm run build"));
        assert!(regex.is_match("python3 <<'EOF'\nprint('hello')\nEOF"));
    }

    #[test]
    fn test_workspace_default_allowed_tool_names_include_subagent_controls() {
        let tool_names = crate::agent_tools::catalog::workspace_default_allowed_tool_names(
            WorkspaceToolSurface::core(),
        );

        for tool_name in [
            "spawn_agent",
            "send_input",
            "wait_agent",
            "resume_agent",
            "close_agent",
        ] {
            assert!(
                tool_names.contains(&tool_name),
                "缺少默认授权工具: {tool_name}"
            );
        }
    }

    #[test]
    fn test_build_team_preference_system_prompt_requires_subagent_mode() {
        let prompt = build_team_preference_system_prompt(
            Some(&serde_json::json!({
                "harness": {
                    "subagent_mode_enabled": true,
                    "preferred_team_preset_id": "code-triage-team",
                }
            })),
            None,
            true,
        )
        .expect("team prompt should exist");

        assert!(prompt.contains(TEAM_PREFERENCE_PROMPT_MARKER));
        assert!(prompt.contains("代码排障团队"));
        assert!(prompt.contains("spawn_agent"));

        let disabled = build_team_preference_system_prompt(
            Some(&serde_json::json!({
                "harness": {
                    "subagent_mode_enabled": false,
                    "preferred_team_preset_id": "code-triage-team",
                }
            })),
            None,
            false,
        );
        assert!(disabled.is_none());
    }

    #[test]
    fn test_build_team_preference_system_prompt_renders_selected_team_details() {
        let prompt = build_team_preference_system_prompt(
            Some(&serde_json::json!({
                "harness": {
                    "subagent_mode_enabled": true,
                    "selected_team_source": "custom",
                    "selected_team_label": "前端联调团队",
                    "selected_team_summary": "分析、实现、验证三段式推进。",
                    "selected_team_roles": [
                        {
                            "label": "分析",
                            "summary": "负责定位问题与影响范围。",
                            "profile_id": "code-explorer",
                            "role_key": "explorer",
                            "skill_ids": ["repo-exploration"]
                        },
                        {
                            "label": "执行",
                            "summary": "负责提交实现与说明改动点。"
                        }
                    ]
                }
            })),
            None,
            true,
        )
        .expect("team prompt should exist");

        assert!(prompt.contains("前端联调团队"));
        assert!(prompt.contains("来源：custom"));
        assert!(prompt.contains("分析、实现、验证三段式推进。"));
        assert!(prompt.contains("分析：负责定位问题与影响范围。"));
        assert!(prompt.contains("profile: code-explorer"));
        assert!(prompt.contains("roleKey: explorer"));
        assert!(prompt.contains("skills: repo-exploration"));
        assert!(prompt.contains("映射到对应结构化字段"));
    }

    #[test]
    fn test_build_team_preference_system_prompt_emphasizes_parent_coordination() {
        let prompt = build_team_preference_system_prompt(
            Some(&serde_json::json!({
                "harness": {
                    "subagent_mode_enabled": true,
                    "selected_team_label": "当前调试 Team",
                    "selected_team_roles": [
                        {
                            "id": "runtime-explorer",
                            "label": "分析",
                            "summary": "负责定位问题。",
                            "profile_id": "code-explorer",
                            "role_key": "explorer",
                            "skill_ids": ["repo-exploration"]
                        }
                    ]
                }
            })),
            None,
            true,
        )
        .expect("team prompt should exist");

        assert!(prompt.contains("当前调试 Team"));
        assert!(prompt.contains("分析：负责定位问题。"));
        assert!(prompt.contains("blueprintRoleId"));
        assert!(prompt.contains("主对话需要承担协调职责"));
        assert!(prompt.contains("主动汇总关键进展、风险和下一步"));
    }

    #[test]
    fn test_build_team_preference_system_prompt_accepts_session_fallback_flag() {
        let prompt = build_team_preference_system_prompt(
            Some(&serde_json::json!({
                "harness": {
                    "preferred_team_preset_id": "code-triage-team",
                }
            })),
            None,
            true,
        )
        .expect("team prompt should exist");

        assert!(prompt.contains("代码排障团队"));
        assert!(prompt.contains("spawn_agent"));
    }

    #[test]
    fn test_build_team_preference_system_prompt_falls_back_to_session_recent_team_selection() {
        let prompt = build_team_preference_system_prompt(
            None,
            Some(&lime_agent::SessionExecutionRuntimeRecentTeamSelection {
                disabled: false,
                theme: Some("general".to_string()),
                preferred_team_preset_id: Some("code-triage-team".to_string()),
                selected_team_id: Some("custom-team-1".to_string()),
                selected_team_source: Some("custom".to_string()),
                selected_team_label: Some("前端联调团队".to_string()),
                selected_team_description: Some("分析、实现、验证三段式推进。".to_string()),
                selected_team_summary: Some("分析、实现、验证三段式推进。".to_string()),
                selected_team_roles: Some(vec![
                    lime_agent::SessionExecutionRuntimeRecentTeamRole {
                        id: "explorer".to_string(),
                        label: "分析".to_string(),
                        summary: "负责定位问题与影响范围。".to_string(),
                        profile_id: Some("code-explorer".to_string()),
                        role_key: Some("explorer".to_string()),
                        skill_ids: vec!["repo-exploration".to_string()],
                    },
                ]),
            }),
            true,
        )
        .expect("team prompt should exist");

        assert!(prompt.contains("代码排障团队"));
        assert!(prompt.contains("前端联调团队"));
        assert!(prompt.contains("来源：custom"));
        assert!(prompt.contains("分析、实现、验证三段式推进。"));
        assert!(prompt.contains("分析：负责定位问题与影响范围。"));
        assert!(prompt.contains("profile: code-explorer"));
        assert!(prompt.contains("roleKey: explorer"));
        assert!(prompt.contains("skills: repo-exploration"));
    }

    #[test]
    fn test_build_team_preference_system_prompt_prefers_request_metadata_over_session_recent_team_selection(
    ) {
        let prompt = build_team_preference_system_prompt(
            Some(&serde_json::json!({
                "harness": {
                    "selected_team_source": "builtin",
                    "selected_team_label": "请求内 Team",
                    "selected_team_summary": "以本次请求为准。",
                }
            })),
            Some(&lime_agent::SessionExecutionRuntimeRecentTeamSelection {
                disabled: false,
                theme: Some("general".to_string()),
                preferred_team_preset_id: Some("research-team".to_string()),
                selected_team_id: Some("runtime-team".to_string()),
                selected_team_source: Some("custom".to_string()),
                selected_team_label: Some("会话 Team".to_string()),
                selected_team_description: Some("旧会话描述".to_string()),
                selected_team_summary: Some("旧会话摘要".to_string()),
                selected_team_roles: None,
            }),
            true,
        )
        .expect("team prompt should exist");

        assert!(prompt.contains("请求内 Team"));
        assert!(prompt.contains("来源：builtin"));
        assert!(prompt.contains("以本次请求为准。"));
        assert!(!prompt.contains("会话 Team"));
        assert!(!prompt.contains("旧会话摘要"));
    }

    #[test]
    fn test_build_subagent_customization_state_applies_profile_defaults() {
        let customization = build_subagent_customization_state(&AgentRuntimeSpawnSubagentRequest {
            parent_session_id: "parent-1".to_string(),
            message: "定位当前 team runtime 差异".to_string(),
            agent_type: Some("Image #1".to_string()),
            model: None,
            reasoning_effort: None,
            fork_context: false,
            blueprint_role_id: Some("runtime-explorer".to_string()),
            blueprint_role_label: Some("分析".to_string()),
            profile_id: Some("code-explorer".to_string()),
            profile_name: None,
            role_key: None,
            skill_ids: vec!["verification-report".to_string()],
            skill_directories: Vec::new(),
            team_preset_id: Some("code-triage-team".to_string()),
            theme: None,
            system_overlay: None,
            output_contract: None,
        })
        .expect("build customization state")
        .expect("customization should exist");

        assert_eq!(
            customization.blueprint_role_id.as_deref(),
            Some("runtime-explorer")
        );
        assert_eq!(customization.blueprint_role_label.as_deref(), Some("分析"));
        assert_eq!(customization.profile_name.as_deref(), Some("代码分析员"));
        assert_eq!(customization.role_key.as_deref(), Some("explorer"));
        assert_eq!(
            customization.team_preset_id.as_deref(),
            Some("code-triage-team")
        );
        assert_eq!(customization.theme.as_deref(), Some("engineering"));
        assert!(customization
            .skill_ids
            .contains(&"repo-exploration".to_string()));
        assert!(customization
            .skill_ids
            .contains(&"source-grounding".to_string()));
        assert!(customization
            .skill_ids
            .contains(&"verification-report".to_string()));
    }

    #[test]
    fn test_build_subagent_customization_system_prompt_renders_builtin_configuration() {
        let prompt =
            build_subagent_customization_system_prompt(Some(&SubagentCustomizationState {
                blueprint_role_id: Some("runtime-explorer".to_string()),
                blueprint_role_label: Some("分析".to_string()),
                profile_id: Some("code-explorer".to_string()),
                profile_name: Some("代码分析员".to_string()),
                role_key: Some("explorer".to_string()),
                team_preset_id: Some("code-triage-team".to_string()),
                theme: Some("engineering".to_string()),
                output_contract: Some("输出问题定位、证据与影响面。".to_string()),
                system_overlay: Some("先读事实源，再给结论。".to_string()),
                skill_ids: vec!["repo-exploration".to_string()],
                skills: vec![SubagentSkillSummary {
                    id: "repo-exploration".to_string(),
                    name: "仓库探索".to_string(),
                    description: Some("优先读事实源".to_string()),
                    source: Some("builtin".to_string()),
                    directory: None,
                }],
            }))
            .expect("prompt build should succeed")
            .expect("prompt should exist");

        assert!(prompt.contains("【Subagent 定制配置】"));
        assert!(prompt.contains("蓝图角色：分析 (runtime-explorer)"));
        assert!(prompt.contains("代码分析员"));
        assert!(prompt.contains("代码排障团队"));
        assert!(prompt.contains("仓库探索"));
        assert!(prompt.contains("输出问题定位、证据与影响面。"));
    }

    #[test]
    fn test_normalize_shell_command_params_accepts_cmd_alias() {
        let input = serde_json::json!({
            "cmd": "echo hello",
            "timeout": 10
        });

        let normalized: serde_json::Value = normalize_shell_command_params(&input);
        assert_eq!(
            normalized
                .get("command")
                .and_then(serde_json::Value::as_str),
            Some("echo hello")
        );
    }

    #[test]
    fn test_normalize_shell_command_params_keeps_existing_command() {
        let input = serde_json::json!({
            "command": "pwd",
            "cmd": "echo should_not_override"
        });

        let normalized: serde_json::Value = normalize_shell_command_params(&input);
        assert_eq!(
            normalized
                .get("command")
                .and_then(serde_json::Value::as_str),
            Some("pwd")
        );
    }

    #[test]
    fn test_normalize_params_for_durable_memory_support_maps_read_path() {
        let _lock = durable_memory_test_lock().lock().expect("lock env");
        let tmp = TempDir::new().expect("create temp dir");
        let _env = DurableMemoryEnvGuard::set(tmp.path());

        let input = serde_json::json!({
            "path": "/memories/preferences.md"
        });
        let normalized: serde_json::Value =
            normalize_params_for_durable_memory_support("read", &input)
                .expect("normalize read params");
        let expected = tmp
            .path()
            .join("preferences.md")
            .to_string_lossy()
            .to_string();

        assert_eq!(
            normalized.get("path").and_then(serde_json::Value::as_str),
            Some(expected.as_str())
        );
    }

    #[test]
    fn test_normalize_params_for_durable_memory_support_rewrites_glob_pattern() {
        let _lock = durable_memory_test_lock().lock().expect("lock env");
        let tmp = TempDir::new().expect("create temp dir");
        let _env = DurableMemoryEnvGuard::set(tmp.path());

        let input = serde_json::json!({
            "pattern": "/memories/**/*.md"
        });
        let normalized: serde_json::Value =
            normalize_params_for_durable_memory_support("glob", &input)
                .expect("normalize glob params");
        let expected_root = tmp.path().to_string_lossy().to_string();

        assert_eq!(
            normalized.get("path").and_then(serde_json::Value::as_str),
            Some(expected_root.as_str())
        );
        assert_eq!(
            normalized
                .get("pattern")
                .and_then(serde_json::Value::as_str),
            Some("**/*.md")
        );
    }

    #[test]
    fn test_normalize_params_for_durable_memory_support_rejects_glob_parent_segments() {
        let _lock = durable_memory_test_lock().lock().expect("lock env");
        let tmp = TempDir::new().expect("create temp dir");
        let _env = DurableMemoryEnvGuard::set(tmp.path());

        let input = serde_json::json!({
            "pattern": "/memories/../escape.md"
        });
        let error = normalize_params_for_durable_memory_support("glob", &input)
            .expect_err("should reject parent path");

        assert!(error.to_string().contains("不允许包含 `..`"));
    }

    #[test]
    fn test_encode_tool_result_for_harness_observability_appends_metadata_block() {
        let result = ToolResult::success("任务已完成")
            .with_metadata("output_file", serde_json::json!("/tmp/task.log"))
            .with_metadata("exit_code", serde_json::json!(0));

        let encoded = encode_tool_result_for_harness_observability(result);
        assert!(encoded.success);
        assert!(encoded
            .output
            .as_deref()
            .unwrap_or_default()
            .contains(LIME_TOOL_METADATA_BEGIN));
        assert!(encoded
            .output
            .as_deref()
            .unwrap_or_default()
            .contains("\"output_file\":\"/tmp/task.log\""));
    }

    #[test]
    fn test_encode_tool_result_for_harness_observability_converts_error_to_success_output() {
        let result =
            ToolResult::error("执行失败").with_metadata("failed_count", serde_json::json!(1));

        let encoded = encode_tool_result_for_harness_observability(result);
        assert!(encoded.success);
        let output = encoded.output.as_deref().unwrap_or_default();
        assert!(output.contains("执行失败"));
        assert!(output.contains(LIME_TOOL_METADATA_BEGIN));
        assert!(output.contains("\"reported_success\":false"));
    }

    #[test]
    fn test_encode_tool_result_for_harness_observability_is_idempotent() {
        let initial = ToolResult::success(format!(
            "ok\n\n{LIME_TOOL_METADATA_BEGIN}\n{{\"reported_success\":false}}\n{LIME_TOOL_METADATA_END}"
        ))
        .with_metadata("reported_success", serde_json::json!(false));

        let encoded = encode_tool_result_for_harness_observability(initial);
        let output = encoded.output.as_deref().unwrap_or_default();
        assert_eq!(output.matches(LIME_TOOL_METADATA_BEGIN).count(), 1);
        assert_eq!(output.matches(LIME_TOOL_METADATA_END).count(), 1);
    }

    #[test]
    fn test_shared_task_manager_returns_same_instance() {
        let first = shared_task_manager();
        let second = shared_task_manager();
        assert!(Arc::ptr_eq(&first, &second));
    }

    #[test]
    fn test_parse_subagent_role_supports_aliases() {
        assert_eq!(
            parse_subagent_role(Some("explore")).unwrap(),
            SubAgentRole::Explorer
        );
        assert_eq!(
            parse_subagent_role(Some("plan")).unwrap(),
            SubAgentRole::Planner
        );
        assert_eq!(
            parse_subagent_role(Some("code")).unwrap(),
            SubAgentRole::Executor
        );
        assert_eq!(parse_subagent_role(None).unwrap(), SubAgentRole::Executor);
    }

    #[test]
    fn test_build_subagent_task_definition_uses_role_defaults() {
        let input = SubAgentTaskToolInput {
            prompt: "分析当前 harness 缺口".to_string(),
            task_type: None,
            description: None,
            role: Some("explorer".to_string()),
            timeout_secs: Some(45),
            model: None,
            return_summary: None,
            allowed_tools: None,
            denied_tools: None,
            max_tokens: None,
        };

        let task = build_subagent_task_definition(&input, SubAgentRole::Explorer).unwrap();
        assert_eq!(task.task_type, "explore");
        assert_eq!(task.timeout.map(|value| value.as_secs()), Some(45));
        assert!(task.return_summary);
    }

    #[test]
    fn test_build_subagent_task_definition_applies_optional_fields() {
        let input = SubAgentTaskToolInput {
            prompt: "实现 harness 面板".to_string(),
            task_type: Some("code".to_string()),
            description: Some("实现前端面板".to_string()),
            role: Some("executor".to_string()),
            timeout_secs: Some(120),
            model: Some("claude-sonnet-4-20250514".to_string()),
            return_summary: Some(false),
            allowed_tools: Some(vec!["read_file".to_string(), "write_file".to_string()]),
            denied_tools: Some(vec!["execute_command".to_string()]),
            max_tokens: Some(4096),
        };

        let task = build_subagent_task_definition(&input, SubAgentRole::Executor).unwrap();
        assert_eq!(task.task_type, "code");
        assert_eq!(task.description.as_deref(), Some("实现前端面板"));
        assert_eq!(task.model.as_deref(), Some("claude-sonnet-4-20250514"));
        assert!(!task.return_summary);
        assert_eq!(
            task.allowed_tools,
            Some(vec!["read_file".to_string(), "write_file".to_string()])
        );
        assert_eq!(task.denied_tools, Some(vec!["execute_command".to_string()]));
        assert_eq!(task.max_tokens, Some(4096));
    }

    #[test]
    fn test_build_subagent_task_runtime_message_includes_soft_constraints() {
        let input = SubAgentTaskToolInput {
            prompt: "探索 team workspace 最佳实践".to_string(),
            task_type: Some("explore".to_string()),
            description: Some("探索 team workspace".to_string()),
            role: Some("explorer".to_string()),
            timeout_secs: None,
            model: None,
            return_summary: None,
            allowed_tools: Some(vec!["read_file".to_string()]),
            denied_tools: Some(vec!["write_file".to_string()]),
            max_tokens: Some(1200),
        };

        let task = build_subagent_task_definition(&input, SubAgentRole::Explorer).unwrap();
        let message = build_subagent_task_runtime_message(&input, &task, SubAgentRole::Explorer);

        assert!(message.contains("任务标题：探索 team workspace"));
        assert!(message.contains("子代理角色：explorer"));
        assert!(message.contains("工具偏好：优先仅使用这些工具：read_file"));
        assert!(message.contains("避免使用这些工具：write_file"));
        assert!(message.contains("输出控制：请尽量将最终输出控制在 1200 tokens 内。"));
        assert!(message.contains("不要再创建新的子代理"));
        assert!(message.contains("任务说明："));
        assert!(message.contains("探索 team workspace 最佳实践"));
    }

    #[test]
    fn test_collect_subagent_task_compat_warnings_marks_soft_constraints() {
        let input = SubAgentTaskToolInput {
            prompt: "探索".to_string(),
            task_type: None,
            description: None,
            role: None,
            timeout_secs: None,
            model: None,
            return_summary: None,
            allowed_tools: Some(vec!["read_file".to_string()]),
            denied_tools: Some(vec!["write_file".to_string()]),
            max_tokens: Some(512),
        };

        let warnings = collect_subagent_task_compat_warnings(&input);
        assert_eq!(warnings.len(), 3);
        assert!(warnings.iter().any(|item| item.contains("allowedTools")));
        assert!(warnings.iter().any(|item| item.contains("deniedTools")));
        assert!(warnings.iter().any(|item| item.contains("maxTokens")));
    }

    #[test]
    fn test_subagent_counts_toward_team_limit_only_counts_active_states() {
        assert!(subagent_counts_toward_team_limit(
            SubagentRuntimeStatusKind::Idle
        ));
        assert!(subagent_counts_toward_team_limit(
            SubagentRuntimeStatusKind::Queued
        ));
        assert!(subagent_counts_toward_team_limit(
            SubagentRuntimeStatusKind::Running
        ));
        assert!(!subagent_counts_toward_team_limit(
            SubagentRuntimeStatusKind::Completed
        ));
        assert!(!subagent_counts_toward_team_limit(
            SubagentRuntimeStatusKind::Failed
        ));
        assert!(!subagent_counts_toward_team_limit(
            SubagentRuntimeStatusKind::Aborted
        ));
        assert!(!subagent_counts_toward_team_limit(
            SubagentRuntimeStatusKind::Closed
        ));
        assert!(!subagent_counts_toward_team_limit(
            SubagentRuntimeStatusKind::NotFound
        ));
    }

    #[test]
    fn test_extract_runtime_subagent_result_text_prefers_assistant_output() {
        let detail = SessionDetail {
            id: "child-1".to_string(),
            name: "子代理".to_string(),
            created_at: 0,
            updated_at: 0,
            thread_id: "thread-1".to_string(),
            model: None,
            working_dir: None,
            workspace_id: None,
            messages: vec![lime_agent::AgentMessage {
                id: None,
                role: "assistant".to_string(),
                content: vec![lime_agent::AgentMessageContent::Text {
                    text: "子代理最终结论".to_string(),
                }],
                timestamp: 0,
            }],
            execution_strategy: None,
            execution_runtime: None,
            turns: vec![],
            items: vec![],
            todo_items: vec![],
            child_subagent_sessions: vec![],
            subagent_parent_context: None,
        };

        assert_eq!(
            extract_runtime_subagent_result_text(&detail).as_deref(),
            Some("子代理最终结论")
        );
    }

    #[test]
    fn test_extract_runtime_subagent_result_text_falls_back_to_turn_error() {
        let detail = SessionDetail {
            id: "child-2".to_string(),
            name: "子代理".to_string(),
            created_at: 0,
            updated_at: 0,
            thread_id: "thread-2".to_string(),
            model: None,
            working_dir: None,
            workspace_id: None,
            messages: vec![],
            execution_strategy: None,
            execution_runtime: None,
            turns: vec![lime_core::database::dao::agent_timeline::AgentThreadTurn {
                id: "turn-1".to_string(),
                thread_id: "thread-2".to_string(),
                prompt_text: "测试".to_string(),
                status: lime_core::database::dao::agent_timeline::AgentThreadTurnStatus::Failed,
                started_at: "2026-03-20T10:00:00Z".to_string(),
                completed_at: Some("2026-03-20T10:00:01Z".to_string()),
                error_message: Some("Provider 错误: Authentication failed".to_string()),
                created_at: "2026-03-20T10:00:00Z".to_string(),
                updated_at: "2026-03-20T10:00:01Z".to_string(),
            }],
            items: vec![],
            todo_items: vec![],
            child_subagent_sessions: vec![],
            subagent_parent_context: None,
        };

        assert_eq!(
            extract_runtime_subagent_result_text(&detail).as_deref(),
            Some("Provider 错误: Authentication failed")
        );
    }

    #[test]
    fn test_tool_search_parse_schema_metadata() {
        let schema = serde_json::json!({
            "x-lime": {
                "deferred_loading": true,
                "always_visible": false,
                "allowed_callers": ["assistant", "code_execution"],
                "input_examples": [{"query":"rust"}],
                "tags": ["mcp", "filesystem"]
            }
        });
        let (deferred, always_visible, allowed_callers, tags, input_examples) =
            ToolSearchBridgeTool::parse_schema_metadata("docs_search", &schema);
        assert!(deferred);
        assert!(!always_visible);
        assert_eq!(
            allowed_callers,
            vec!["assistant".to_string(), "code_execution".to_string()]
        );
        assert_eq!(tags, vec!["mcp".to_string(), "filesystem".to_string()]);
        assert_eq!(input_examples, vec![serde_json::json!({"query":"rust"})]);
    }

    #[test]
    fn test_tool_search_parse_schema_metadata_infers_builtin_input_examples() {
        let schema = serde_json::json!({
            "type": "object",
            "properties": {
                "query": {"type":"string"}
            },
            "required": ["query"]
        });
        let (_, _, _, _, input_examples) =
            ToolSearchBridgeTool::parse_schema_metadata("WebSearch", &schema);
        assert!(!input_examples.is_empty());
        assert!(input_examples[0].get("query").is_some());
    }

    #[test]
    fn test_tool_search_score_match_prefers_exact_name() {
        let exact = ToolSearchBridgeTool::score_match(
            "web_fetch",
            "fetch webpage",
            &["web".to_string()],
            "web_fetch",
        );
        let partial = ToolSearchBridgeTool::score_match(
            "fetch_web",
            "web fetch helper",
            &["web".to_string()],
            "web_fetch",
        );
        assert!(exact > partial);
    }

    #[test]
    fn test_tool_search_extension_tool_status_marks_default_visible_and_loaded_tools() {
        let configs = vec![builtin_extension_config(
            "docs",
            vec!["search_docs", "read_docs"],
            true,
            vec!["search_docs"],
            Some("assistant"),
        )];
        let visible_tool_names = HashSet::from(["docs__read_docs".to_string()]);

        let visible = ToolSearchBridgeTool::extension_tool_status(
            &configs,
            &visible_tool_names,
            "docs__search_docs",
        );
        assert_eq!(visible, ("visible", false, Some("docs".to_string())));

        let loaded = ToolSearchBridgeTool::extension_tool_status(
            &configs,
            &visible_tool_names,
            "docs__read_docs",
        );
        assert_eq!(loaded, ("loaded", false, Some("docs".to_string())));
    }

    #[test]
    fn test_tool_search_extension_tool_status_prefers_longest_extension_name() {
        let configs = vec![
            builtin_extension_config("docs", vec!["search"], true, vec![], Some("assistant")),
            builtin_extension_config(
                "docs__admin",
                vec!["search"],
                true,
                vec![],
                Some("code_execution"),
            ),
        ];

        let status = ToolSearchBridgeTool::extension_tool_status(
            &configs,
            &HashSet::new(),
            "docs__admin__search",
        );
        assert_eq!(status, ("deferred", true, Some("docs__admin".to_string())));
    }

    #[test]
    fn test_social_generate_cover_image_parse_non_empty_string() {
        let params = serde_json::json!({
            "prompt": "  封面图描述  ",
            "size": "   "
        });

        let prompt = SocialGenerateCoverImageTool::parse_non_empty_string(&params, "prompt", None);
        let size = SocialGenerateCoverImageTool::parse_non_empty_string(
            &params,
            "size",
            Some(SOCIAL_IMAGE_DEFAULT_SIZE),
        );

        assert_eq!(prompt, Some("封面图描述".to_string()));
        assert_eq!(size, Some(SOCIAL_IMAGE_DEFAULT_SIZE.to_string()));
    }

    #[test]
    fn test_social_generate_cover_image_extract_first_image_payload() {
        let response = serde_json::json!({
            "data": [
                {
                    "url": "https://example.com/image.png",
                    "revised_prompt": "优化后的提示词"
                }
            ]
        });

        let (image_url, image_b64, revised_prompt) =
            SocialGenerateCoverImageTool::extract_first_image_payload(&response).unwrap();
        assert_eq!(image_url, Some("https://example.com/image.png".to_string()));
        assert_eq!(image_b64, None);
        assert_eq!(revised_prompt, Some("优化后的提示词".to_string()));
    }

    #[test]
    fn test_social_generate_cover_image_extract_first_image_payload_rejects_empty_data() {
        let response = serde_json::json!({ "data": [] });
        let result = SocialGenerateCoverImageTool::extract_first_image_payload(&response);

        assert!(result.is_err());
        assert!(result
            .err()
            .unwrap_or_default()
            .contains("图像接口返回 data 为空"));
    }

    #[test]
    fn test_social_generate_cover_image_normalize_server_host() {
        assert_eq!(
            SocialGenerateCoverImageTool::normalize_server_host("0.0.0.0"),
            "127.0.0.1".to_string()
        );
        assert_eq!(
            SocialGenerateCoverImageTool::normalize_server_host("::"),
            "127.0.0.1".to_string()
        );
        assert_eq!(
            SocialGenerateCoverImageTool::normalize_server_host("  localhost "),
            "localhost".to_string()
        );
    }

    #[tokio::test]
    async fn test_tool_search_bridge_tool_end_to_end_filters_by_caller_and_deferred() {
        let registry = Arc::new(tokio::sync::RwLock::new(aster::tools::ToolRegistry::new()));
        {
            let mut guard = registry.write().await;
            guard.register(Box::new(DummyTool::new(
                "docs_search",
                "Search docs",
                serde_json::json!({
                    "type": "object",
                    "x-lime": {
                        "deferred_loading": true,
                        "allowed_callers": ["assistant"],
                        "tags": ["docs", "search"]
                    }
                }),
            )));
            guard.register(Box::new(DummyTool::new(
                "admin_secret",
                "Admin-only tool",
                serde_json::json!({
                    "type": "object",
                    "x-lime": {
                        "deferred_loading": true,
                        "allowed_callers": ["code_execution"],
                        "tags": ["admin"]
                    }
                }),
            )));
            guard.register(Box::new(DummyTool::new(
                "weather",
                "Weather by city",
                serde_json::json!({
                    "type": "object",
                    "x-lime": {
                        "deferred_loading": false,
                        "tags": ["weather"]
                    }
                }),
            )));
        }

        let tool = ToolSearchBridgeTool::new(registry.clone(), None);
        let context = ToolContext::new(PathBuf::from("."));

        let hidden_result = tool
            .execute(
                serde_json::json!({
                    "query": "search",
                    "caller": "assistant",
                    "include_deferred": false,
                    "include_schema": true
                }),
                &context,
            )
            .await
            .expect("tool_search should succeed");
        let hidden_output = hidden_result.output.expect("tool_search output");
        let hidden_json: serde_json::Value =
            serde_json::from_str(&hidden_output).expect("parse tool_search output");
        assert_eq!(hidden_json["count"], serde_json::json!(0));

        let visible_result = tool
            .execute(
                serde_json::json!({
                    "query": "search",
                    "caller": "assistant",
                    "include_deferred": true,
                    "include_schema": true
                }),
                &context,
            )
            .await
            .expect("tool_search should succeed");
        let visible_output = visible_result.output.expect("tool_search output");
        let visible_json: serde_json::Value =
            serde_json::from_str(&visible_output).expect("parse tool_search output");
        let tools = visible_json["tools"]
            .as_array()
            .expect("tools should be array");

        assert_eq!(visible_json["count"], serde_json::json!(1));
        assert_eq!(tools[0]["name"], serde_json::json!("docs_search"));
        assert_eq!(tools[0]["deferred_loading"], serde_json::json!(true));
        assert!(tools[0].get("input_schema").is_some());
        assert!(tools[0]
            .get("input_examples")
            .and_then(|v| v.as_array())
            .is_some());
        assert!(tools.iter().all(|tool| tool["name"] != "admin_secret"));
    }
}
