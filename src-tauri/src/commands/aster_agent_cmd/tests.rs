#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::aster_agent_cmd::action_runtime::{
        build_runtime_action_scope, build_runtime_action_session_config,
    };
    use crate::commands::aster_agent_cmd::dto::AgentRuntimeActionScope;
    use crate::commands::aster_agent_cmd::service_skill_launch::build_service_skill_preload_tool_projection;
    use crate::commands::aster_agent_cmd::tool_runtime::{
        append_fast_chat_request_tool_policy_session_permissions,
        prune_fast_chat_request_tool_policy_tools_from_registry,
    };
    use crate::services::site_capability_service::{
        RunSiteAdapterRequest, SavedSiteAdapterContent, SiteAdapterDefinition, SiteAdapterRunResult,
    };
    use crate::tests::runtime_test_support::shared_aster_runtime_test_root;
    use async_trait::async_trait;
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    use lime_agent::request_tool_policy::resolve_request_tool_policy;
    use lime_agent::AgentEvent as RuntimeAgentEvent;
    use regex::Regex;
    use std::collections::HashSet;
    use std::ffi::OsString;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::sync::{Arc, Mutex, OnceLock};
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

    fn collect_rust_files(root: &Path, files: &mut Vec<PathBuf>) {
        let entries = fs::read_dir(root).expect("应能读取目录");
        for entry in entries {
            let path = entry.expect("应能读取目录项").path();
            if path.is_dir() {
                collect_rust_files(&path, files);
                continue;
            }
            if path.extension().and_then(|ext| ext.to_str()) == Some("rs") {
                files.push(path);
            }
        }
    }

    fn collect_markdown_files(root: &Path, files: &mut Vec<PathBuf>) {
        let entries = fs::read_dir(root).expect("应能读取目录");
        for entry in entries {
            let path = entry.expect("应能读取目录项").path();
            if path.is_dir() {
                collect_markdown_files(&path, files);
                continue;
            }
            let extension = path.extension().and_then(|ext| ext.to_str());
            let file_name = path
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("");
            if extension == Some("md") || file_name.starts_with("README") {
                files.push(path);
            }
        }
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
                    "theme": "general",
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
            Some("general")
        );
    }

    #[test]
    fn test_resolve_runtime_chat_mode_prefers_explicit_chat_mode() {
        let metadata = serde_json::json!({
            "harness": {
                "theme": "general",
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
                "theme": "general"
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
            RuntimeChatMode::Workbench
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
    fn test_should_enable_model_skill_tool_allows_general_workbench() {
        let metadata = serde_json::json!({
            "harness": {
                "theme": "general",
                "session_mode": "general_workbench"
            }
        });

        assert!(should_enable_model_skill_tool(Some(&metadata)));
    }

    #[test]
    fn test_should_enable_model_skill_tool_respects_explicit_override() {
        let metadata = serde_json::json!({
            "harness": {
                "theme": "general",
                "session_mode": "general_workbench",
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
            false,
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
            false,
        ));
    }

    #[test]
    fn test_should_not_auto_launch_managed_browser_when_observer_profile_selected() {
        let session_hint = BrowserAssistRuntimeHint {
            profile_key: "general_browser_assist".to_string(),
            preferred_backend: Some(BrowserBackendType::CdpDirect),
            auto_launch: true,
            launch_url: Some("https://github.com/search?q=ai+agent".to_string()),
        };

        assert!(!LimeBrowserMcpTool::should_auto_launch_managed_browser(
            Some(BrowserBackendType::LimeExtensionBridge),
            Some(&session_hint),
            Some(
                lime_core::database::dao::browser_profile::BrowserProfileTransportKind::ManagedCdp
            ),
            true,
        ));
    }

    #[test]
    fn test_select_attached_existing_session_profile_prefers_matching_launch_domain() {
        let sessions = vec![
            crate::commands::webview_cmd::ChromeProfileSessionInfo {
                profile_key: "attached-weibo".to_string(),
                browser_source: "system".to_string(),
                browser_path: String::new(),
                profile_dir: String::new(),
                remote_debugging_port: 13001,
                pid: 1,
                started_at: "2026-03-31T00:00:00Z".to_string(),
                last_url: "https://weibo.com/home".to_string(),
            },
            crate::commands::webview_cmd::ChromeProfileSessionInfo {
                profile_key: "attached-github".to_string(),
                browser_source: "system".to_string(),
                browser_path: String::new(),
                profile_dir: String::new(),
                remote_debugging_port: 13002,
                pid: 2,
                started_at: "2026-03-31T00:00:00Z".to_string(),
                last_url: "https://github.com/trending".to_string(),
            },
        ];
        let existing_session_profile_keys =
            HashSet::from(["attached-weibo".to_string(), "attached-github".to_string()]);

        assert_eq!(
            LimeBrowserMcpTool::select_attached_existing_session_profile(
                &sessions,
                &existing_session_profile_keys,
                Some("https://github.com/search?q=ai+agent"),
            ),
            Some("attached-github".to_string())
        );
    }

    #[test]
    fn test_select_attached_existing_session_profile_falls_back_to_first_existing_session() {
        let sessions = vec![
            crate::commands::webview_cmd::ChromeProfileSessionInfo {
                profile_key: "attached-github".to_string(),
                browser_source: "system".to_string(),
                browser_path: String::new(),
                profile_dir: String::new(),
                remote_debugging_port: 13002,
                pid: 2,
                started_at: "2026-03-31T00:00:00Z".to_string(),
                last_url: "https://github.com/trending".to_string(),
            },
            crate::commands::webview_cmd::ChromeProfileSessionInfo {
                profile_key: "managed-research".to_string(),
                browser_source: "lime".to_string(),
                browser_path: String::new(),
                profile_dir: String::new(),
                remote_debugging_port: 13003,
                pid: 3,
                started_at: "2026-03-31T00:00:00Z".to_string(),
                last_url: "https://www.google.com/".to_string(),
            },
        ];
        let existing_session_profile_keys = HashSet::from(["attached-github".to_string()]);

        assert_eq!(
            LimeBrowserMcpTool::select_attached_existing_session_profile(
                &sessions,
                &existing_session_profile_keys,
                None,
            ),
            Some("attached-github".to_string())
        );
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
    fn test_append_fast_chat_request_tool_policy_session_permissions_blocks_web_tools_when_disabled(
    ) {
        let policy = resolve_request_tool_policy(Some(false), false);
        let mut permissions = Vec::new();

        append_fast_chat_request_tool_policy_session_permissions(
            &mut permissions,
            "session-fast-chat-1",
            TurnExecutionProfile::FastChat,
            &policy,
        );

        let web_search_rule = permissions
            .iter()
            .find(|permission| permission.tool == "WebSearch")
            .expect("should add fast chat web search deny rule");
        assert!(!web_search_rule.allowed);
        assert_eq!(web_search_rule.priority, 1236);
        assert_eq!(web_search_rule.conditions.len(), 1);
        assert_eq!(
            web_search_rule.conditions[0].field.as_deref(),
            Some("session_id")
        );
        assert_eq!(
            web_search_rule.conditions[0].value,
            serde_json::json!("session-fast-chat-1")
        );
        assert!(permissions
            .iter()
            .any(|permission| permission.tool == "WebFetch" && !permission.allowed));
    }

    #[test]
    fn test_append_fast_chat_request_tool_policy_session_permissions_only_applies_to_disabled_fast_chat(
    ) {
        let disabled_policy = resolve_request_tool_policy(Some(false), false);
        let allowed_policy = resolve_request_tool_policy(Some(true), false);
        let mut permissions = Vec::new();

        append_fast_chat_request_tool_policy_session_permissions(
            &mut permissions,
            "session-fast-chat-2",
            TurnExecutionProfile::FullRuntime,
            &disabled_policy,
        );
        append_fast_chat_request_tool_policy_session_permissions(
            &mut permissions,
            "session-fast-chat-2",
            TurnExecutionProfile::FastChat,
            &allowed_policy,
        );

        assert!(permissions.is_empty());
    }

    #[test]
    fn test_prune_fast_chat_request_tool_policy_tools_from_registry_hides_web_tools_when_disabled()
    {
        let policy = resolve_request_tool_policy(Some(false), false);
        let mut registry = aster::tools::ToolRegistry::new();
        registry.register(Box::new(DummyTool::new(
            "WebSearch",
            "Web search",
            serde_json::json!({"type": "object"}),
        )));
        registry.register(Box::new(DummyTool::new(
            "WebFetch",
            "Web fetch",
            serde_json::json!({"type": "object"}),
        )));
        registry.register(Box::new(DummyTool::new(
            "Read",
            "Read file",
            serde_json::json!({"type": "object"}),
        )));

        prune_fast_chat_request_tool_policy_tools_from_registry(
            &mut registry,
            TurnExecutionProfile::FastChat,
            &policy,
        );

        assert!(!registry.contains("WebSearch"));
        assert!(!registry.contains("WebFetch"));
        assert!(registry.contains("Read"));
    }

    #[test]
    fn test_prune_fast_chat_request_tool_policy_tools_from_registry_keeps_web_tools_for_non_fast_chat_or_enabled_search(
    ) {
        let disabled_policy = resolve_request_tool_policy(Some(false), false);
        let allowed_policy = resolve_request_tool_policy(Some(true), false);

        let mut full_runtime_registry = aster::tools::ToolRegistry::new();
        full_runtime_registry.register(Box::new(DummyTool::new(
            "WebSearch",
            "Web search",
            serde_json::json!({"type": "object"}),
        )));
        prune_fast_chat_request_tool_policy_tools_from_registry(
            &mut full_runtime_registry,
            TurnExecutionProfile::FullRuntime,
            &disabled_policy,
        );
        assert!(full_runtime_registry.contains("WebSearch"));

        let mut allowed_registry = aster::tools::ToolRegistry::new();
        allowed_registry.register(Box::new(DummyTool::new(
            "WebSearch",
            "Web search",
            serde_json::json!({"type": "object"}),
        )));
        prune_fast_chat_request_tool_policy_tools_from_registry(
            &mut allowed_registry,
            TurnExecutionProfile::FastChat,
            &allowed_policy,
        );
        assert!(allowed_registry.contains("WebSearch"));
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

        let site_run_rule = permissions
            .iter()
            .find(|permission| permission.tool == "lime_site_run")
            .expect("should add site run deny rule");
        assert!(!site_run_rule.allowed);
        assert_eq!(site_run_rule.priority, 1250);
        assert_eq!(site_run_rule.conditions.len(), 1);
        assert_eq!(
            site_run_rule.conditions[0].value,
            serde_json::json!("session-service-skill-1")
        );
    }

    #[test]
    fn test_append_image_skill_launch_session_permissions_blocks_detour_tools() {
        let metadata = serde_json::json!({
            "harness": {
                "image_skill_launch": {
                    "kind": "image_task",
                    "skill_name": "image_generate",
                    "image_task": {
                        "prompt": "生成一张夏日青柠汽水插图"
                    }
                }
            }
        });
        let mut permissions = Vec::new();

        append_image_skill_launch_session_permissions(
            &mut permissions,
            "session-image-skill-1",
            Some(&metadata),
        );

        let tool_search_rule = permissions
            .iter()
            .find(|permission| permission.tool == TOOL_SEARCH_TOOL_NAME)
            .expect("should add ToolSearch deny rule");
        assert!(!tool_search_rule.allowed);
        assert_eq!(tool_search_rule.priority, 1240);
        assert_eq!(tool_search_rule.conditions.len(), 1);
        assert_eq!(
            tool_search_rule.conditions[0].value,
            serde_json::json!("session-image-skill-1")
        );

        assert!(permissions
            .iter()
            .any(|permission| permission.tool == "Read" && !permission.allowed));
        assert!(permissions
            .iter()
            .any(|permission| permission.tool == "Glob" && !permission.allowed));
        assert!(permissions
            .iter()
            .any(|permission| permission.tool == "Grep" && !permission.allowed));
    }

    #[test]
    fn test_prune_image_skill_launch_detour_tools_from_registry_hides_tool_search_and_fs_tools() {
        let metadata = serde_json::json!({
            "harness": {
                "image_skill_launch": {
                    "kind": "image_task",
                    "skill_name": "image_generate",
                    "image_task": {
                        "prompt": "生成一张夏日青柠汽水插图"
                    }
                }
            }
        });
        let mut registry = aster::tools::ToolRegistry::new();
        registry.register(Box::new(DummyTool::new(
            TOOL_SEARCH_TOOL_NAME,
            "Search tools",
            serde_json::json!({"type": "object"}),
        )));
        registry.register(Box::new(DummyTool::new(
            "Read",
            "Read file",
            serde_json::json!({"type": "object"}),
        )));
        registry.register(Box::new(DummyTool::new(
            "Glob",
            "Glob file",
            serde_json::json!({"type": "object"}),
        )));
        registry.register(Box::new(DummyTool::new(
            "Skill",
            "Run skill",
            serde_json::json!({"type": "object"}),
        )));

        prune_image_skill_launch_detour_tools_from_registry(&mut registry, Some(&metadata));

        assert!(!registry.contains(TOOL_SEARCH_TOOL_NAME));
        assert!(!registry.contains("Read"));
        assert!(!registry.contains("Glob"));
        assert!(registry.contains("Skill"));
    }

    #[test]
    fn test_append_cover_skill_launch_session_permissions_blocks_detour_tools() {
        let metadata = serde_json::json!({
            "harness": {
                "cover_skill_launch": {
                    "kind": "cover_task",
                    "skill_name": "cover_generate",
                    "cover_task": {
                        "prompt": "生成一张夏日青柠新品封面"
                    }
                }
            }
        });
        let mut permissions = Vec::new();

        append_cover_skill_launch_session_permissions(
            &mut permissions,
            "session-cover-skill-1",
            Some(&metadata),
        );

        let tool_search_rule = permissions
            .iter()
            .find(|permission| permission.tool == TOOL_SEARCH_TOOL_NAME)
            .expect("should add ToolSearch deny rule");
        assert!(!tool_search_rule.allowed);
        assert_eq!(tool_search_rule.priority, 1238);
        assert_eq!(tool_search_rule.conditions.len(), 1);
        assert_eq!(
            tool_search_rule.conditions[0].value,
            serde_json::json!("session-cover-skill-1")
        );

        assert!(permissions
            .iter()
            .any(|permission| permission.tool == "Read" && !permission.allowed));
        assert!(permissions
            .iter()
            .any(|permission| permission.tool == "Glob" && !permission.allowed));
        assert!(permissions
            .iter()
            .any(|permission| permission.tool == "Grep" && !permission.allowed));
    }

    #[test]
    fn test_prune_cover_skill_launch_detour_tools_from_registry_hides_tool_search_and_fs_tools() {
        let metadata = serde_json::json!({
            "harness": {
                "cover_skill_launch": {
                    "kind": "cover_task",
                    "skill_name": "cover_generate",
                    "cover_task": {
                        "prompt": "生成一张夏日青柠新品封面"
                    }
                }
            }
        });
        let mut registry = aster::tools::ToolRegistry::new();
        registry.register(Box::new(DummyTool::new(
            TOOL_SEARCH_TOOL_NAME,
            "Search tools",
            serde_json::json!({"type": "object"}),
        )));
        registry.register(Box::new(DummyTool::new(
            "Read",
            "Read file",
            serde_json::json!({"type": "object"}),
        )));
        registry.register(Box::new(DummyTool::new(
            "Glob",
            "Glob file",
            serde_json::json!({"type": "object"}),
        )));
        registry.register(Box::new(DummyTool::new(
            "Skill",
            "Run skill",
            serde_json::json!({"type": "object"}),
        )));

        prune_cover_skill_launch_detour_tools_from_registry(&mut registry, Some(&metadata));

        assert!(!registry.contains(TOOL_SEARCH_TOOL_NAME));
        assert!(!registry.contains("Read"));
        assert!(!registry.contains("Glob"));
        assert!(registry.contains("Skill"));
    }

    #[test]
    fn test_append_video_skill_launch_session_permissions_blocks_detour_tools() {
        let metadata = serde_json::json!({
            "harness": {
                "video_skill_launch": {
                    "kind": "video_task",
                    "skill_name": "video_generate",
                    "video_task": {
                        "prompt": "生成一条夏日青柠新品短视频"
                    }
                }
            }
        });
        let mut permissions = Vec::new();

        append_video_skill_launch_session_permissions(
            &mut permissions,
            "session-video-skill-1",
            Some(&metadata),
        );

        let tool_search_rule = permissions
            .iter()
            .find(|permission| permission.tool == TOOL_SEARCH_TOOL_NAME)
            .expect("should add ToolSearch deny rule");
        assert!(!tool_search_rule.allowed);
        assert_eq!(tool_search_rule.priority, 1237);
        assert_eq!(tool_search_rule.conditions.len(), 1);
        assert_eq!(
            tool_search_rule.conditions[0].value,
            serde_json::json!("session-video-skill-1")
        );

        assert!(permissions
            .iter()
            .any(|permission| permission.tool == "Read" && !permission.allowed));
        assert!(permissions
            .iter()
            .any(|permission| permission.tool == "Glob" && !permission.allowed));
        assert!(permissions
            .iter()
            .any(|permission| permission.tool == "Grep" && !permission.allowed));
    }

    #[test]
    fn test_prune_video_skill_launch_detour_tools_from_registry_hides_tool_search_and_fs_tools() {
        let metadata = serde_json::json!({
            "harness": {
                "video_skill_launch": {
                    "kind": "video_task",
                    "skill_name": "video_generate",
                    "video_task": {
                        "prompt": "生成一条夏日青柠新品短视频"
                    }
                }
            }
        });
        let mut registry = aster::tools::ToolRegistry::new();
        registry.register(Box::new(DummyTool::new(
            TOOL_SEARCH_TOOL_NAME,
            "Search tools",
            serde_json::json!({"type": "object"}),
        )));
        registry.register(Box::new(DummyTool::new(
            "Read",
            "Read file",
            serde_json::json!({"type": "object"}),
        )));
        registry.register(Box::new(DummyTool::new(
            "Glob",
            "Glob file",
            serde_json::json!({"type": "object"}),
        )));
        registry.register(Box::new(DummyTool::new(
            "Skill",
            "Run skill",
            serde_json::json!({"type": "object"}),
        )));

        prune_video_skill_launch_detour_tools_from_registry(&mut registry, Some(&metadata));

        assert!(!registry.contains(TOOL_SEARCH_TOOL_NAME));
        assert!(!registry.contains("Read"));
        assert!(!registry.contains("Glob"));
        assert!(registry.contains("Skill"));
    }

    #[test]
    fn test_append_broadcast_skill_launch_session_permissions_blocks_detour_tools() {
        let metadata = serde_json::json!({
            "harness": {
                "broadcast_skill_launch": {
                    "kind": "broadcast_task",
                    "skill_name": "broadcast_generate",
                    "broadcast_task": {
                        "prompt": "把新品发布稿整理成适合口播的文案"
                    }
                }
            }
        });
        let mut permissions = Vec::new();

        append_broadcast_skill_launch_session_permissions(
            &mut permissions,
            "session-broadcast-skill-1",
            Some(&metadata),
        );

        let tool_search_rule = permissions
            .iter()
            .find(|permission| permission.tool == TOOL_SEARCH_TOOL_NAME)
            .expect("should add ToolSearch deny rule");
        assert!(!tool_search_rule.allowed);
        assert_eq!(tool_search_rule.priority, 1236);
        assert_eq!(tool_search_rule.conditions.len(), 1);
        assert_eq!(
            tool_search_rule.conditions[0].value,
            serde_json::json!("session-broadcast-skill-1")
        );

        assert!(permissions
            .iter()
            .any(|permission| permission.tool == "Read" && !permission.allowed));
        assert!(permissions
            .iter()
            .any(|permission| permission.tool == "Glob" && !permission.allowed));
        assert!(permissions
            .iter()
            .any(|permission| permission.tool == "Grep" && !permission.allowed));
    }

    #[test]
    fn test_prune_broadcast_skill_launch_detour_tools_from_registry_hides_tool_search_and_fs_tools()
    {
        let metadata = serde_json::json!({
            "harness": {
                "broadcast_skill_launch": {
                    "kind": "broadcast_task",
                    "skill_name": "broadcast_generate",
                    "broadcast_task": {
                        "prompt": "把新品发布稿整理成适合口播的文案"
                    }
                }
            }
        });
        let mut registry = aster::tools::ToolRegistry::new();
        registry.register(Box::new(DummyTool::new(
            TOOL_SEARCH_TOOL_NAME,
            "Search tools",
            serde_json::json!({"type": "object"}),
        )));
        registry.register(Box::new(DummyTool::new(
            "Read",
            "Read file",
            serde_json::json!({"type": "object"}),
        )));
        registry.register(Box::new(DummyTool::new(
            "Glob",
            "Glob file",
            serde_json::json!({"type": "object"}),
        )));
        registry.register(Box::new(DummyTool::new(
            "Skill",
            "Run skill",
            serde_json::json!({"type": "object"}),
        )));

        prune_broadcast_skill_launch_detour_tools_from_registry(&mut registry, Some(&metadata));

        assert!(!registry.contains(TOOL_SEARCH_TOOL_NAME));
        assert!(!registry.contains("Read"));
        assert!(!registry.contains("Glob"));
        assert!(registry.contains("Skill"));
    }

    #[test]
    fn test_append_resource_search_skill_launch_session_permissions_blocks_detour_tools() {
        let metadata = serde_json::json!({
            "harness": {
                "resource_search_skill_launch": {
                    "kind": "resource_search_task",
                    "skill_name": "modal_resource_search",
                    "resource_search_task": {
                        "resource_type": "image",
                        "query": "咖啡馆木桌背景"
                    }
                }
            }
        });
        let mut permissions = Vec::new();

        append_resource_search_skill_launch_session_permissions(
            &mut permissions,
            "session-resource-search-skill-1",
            Some(&metadata),
        );

        let tool_search_rule = permissions
            .iter()
            .find(|permission| permission.tool == TOOL_SEARCH_TOOL_NAME)
            .expect("should add ToolSearch deny rule");
        assert!(!tool_search_rule.allowed);
        assert_eq!(tool_search_rule.priority, 1235);
        assert_eq!(tool_search_rule.conditions.len(), 1);
        assert_eq!(
            tool_search_rule.conditions[0].value,
            serde_json::json!("session-resource-search-skill-1")
        );

        assert!(permissions
            .iter()
            .any(|permission| permission.tool == "Read" && !permission.allowed));
        assert!(permissions
            .iter()
            .any(|permission| permission.tool == "Glob" && !permission.allowed));
        assert!(permissions
            .iter()
            .any(|permission| permission.tool == "Grep" && !permission.allowed));
    }

    #[test]
    fn test_prune_resource_search_skill_launch_detour_tools_from_registry_hides_tool_search_and_fs_tools(
    ) {
        let metadata = serde_json::json!({
            "harness": {
                "resource_search_skill_launch": {
                    "kind": "resource_search_task",
                    "skill_name": "modal_resource_search",
                    "resource_search_task": {
                        "resource_type": "image",
                        "query": "咖啡馆木桌背景"
                    }
                }
            }
        });
        let mut registry = aster::tools::ToolRegistry::new();
        registry.register(Box::new(DummyTool::new(
            TOOL_SEARCH_TOOL_NAME,
            "Search tools",
            serde_json::json!({"type": "object"}),
        )));
        registry.register(Box::new(DummyTool::new(
            "Read",
            "Read file",
            serde_json::json!({"type": "object"}),
        )));
        registry.register(Box::new(DummyTool::new(
            "Glob",
            "Glob file",
            serde_json::json!({"type": "object"}),
        )));
        registry.register(Box::new(DummyTool::new(
            "Skill",
            "Run skill",
            serde_json::json!({"type": "object"}),
        )));

        prune_resource_search_skill_launch_detour_tools_from_registry(
            &mut registry,
            Some(&metadata),
        );

        assert!(!registry.contains(TOOL_SEARCH_TOOL_NAME));
        assert!(!registry.contains("Read"));
        assert!(!registry.contains("Glob"));
        assert!(registry.contains("Skill"));
    }

    #[test]
    fn test_append_research_skill_launch_session_permissions_blocks_detour_tools() {
        let metadata = serde_json::json!({
            "harness": {
                "research_skill_launch": {
                    "kind": "research_request",
                    "skill_name": "research",
                    "research_request": {
                        "query": "AI Agent 融资"
                    }
                }
            }
        });
        let mut permissions = Vec::new();

        append_research_skill_launch_session_permissions(
            &mut permissions,
            "session-research-skill-1",
            Some(&metadata),
        );

        let tool_search_rule = permissions
            .iter()
            .find(|permission| permission.tool == TOOL_SEARCH_TOOL_NAME)
            .expect("should add ToolSearch deny rule");
        assert!(!tool_search_rule.allowed);
        assert_eq!(tool_search_rule.priority, 1234);
        assert_eq!(tool_search_rule.conditions.len(), 1);
        assert_eq!(
            tool_search_rule.conditions[0].value,
            serde_json::json!("session-research-skill-1")
        );

        assert!(permissions
            .iter()
            .any(|permission| permission.tool == "Read" && !permission.allowed));
        assert!(permissions
            .iter()
            .any(|permission| permission.tool == "Glob" && !permission.allowed));
        assert!(permissions
            .iter()
            .any(|permission| permission.tool == "Grep" && !permission.allowed));
    }

    #[test]
    fn test_prune_research_skill_launch_detour_tools_from_registry_hides_tool_search_and_fs_tools()
    {
        let metadata = serde_json::json!({
            "harness": {
                "research_skill_launch": {
                    "kind": "research_request",
                    "skill_name": "research",
                    "research_request": {
                        "query": "AI Agent 融资"
                    }
                }
            }
        });
        let mut registry = aster::tools::ToolRegistry::new();
        registry.register(Box::new(DummyTool::new(
            TOOL_SEARCH_TOOL_NAME,
            "Search tools",
            serde_json::json!({"type": "object"}),
        )));
        registry.register(Box::new(DummyTool::new(
            "Read",
            "Read file",
            serde_json::json!({"type": "object"}),
        )));
        registry.register(Box::new(DummyTool::new(
            "Glob",
            "Glob file",
            serde_json::json!({"type": "object"}),
        )));
        registry.register(Box::new(DummyTool::new(
            "WebSearch",
            "Web search",
            serde_json::json!({"type": "object"}),
        )));
        registry.register(Box::new(DummyTool::new(
            "Skill",
            "Run skill",
            serde_json::json!({"type": "object"}),
        )));

        prune_research_skill_launch_detour_tools_from_registry(&mut registry, Some(&metadata));

        assert!(!registry.contains(TOOL_SEARCH_TOOL_NAME));
        assert!(!registry.contains("Read"));
        assert!(!registry.contains("Glob"));
        assert!(registry.contains("WebSearch"));
        assert!(registry.contains("Skill"));
    }

    #[test]
    fn test_append_deep_search_skill_launch_session_permissions_blocks_detour_tools() {
        let metadata = serde_json::json!({
            "harness": {
                "deep_search_skill_launch": {
                    "kind": "deep_search_request",
                    "skill_name": "research",
                    "deep_search_request": {
                        "query": "AI Agent 融资"
                    }
                }
            }
        });
        let mut permissions = Vec::new();

        append_deep_search_skill_launch_session_permissions(
            &mut permissions,
            "session-deep-search-skill-1",
            Some(&metadata),
        );

        let tool_search_rule = permissions
            .iter()
            .find(|permission| permission.tool == TOOL_SEARCH_TOOL_NAME)
            .expect("should add ToolSearch deny rule");
        assert!(!tool_search_rule.allowed);
        assert_eq!(tool_search_rule.priority, 1233);
        assert_eq!(tool_search_rule.conditions.len(), 1);
        assert_eq!(
            tool_search_rule.conditions[0].value,
            serde_json::json!("session-deep-search-skill-1")
        );

        assert!(permissions
            .iter()
            .any(|permission| permission.tool == "Read" && !permission.allowed));
        assert!(permissions
            .iter()
            .any(|permission| permission.tool == "Glob" && !permission.allowed));
        assert!(permissions
            .iter()
            .any(|permission| permission.tool == "Grep" && !permission.allowed));
    }

    #[test]
    fn test_prune_deep_search_skill_launch_detour_tools_from_registry_hides_tool_search_and_fs_tools(
    ) {
        let metadata = serde_json::json!({
            "harness": {
                "deep_search_skill_launch": {
                    "kind": "deep_search_request",
                    "skill_name": "research",
                    "deep_search_request": {
                        "query": "AI Agent 融资"
                    }
                }
            }
        });
        let mut registry = aster::tools::ToolRegistry::new();
        registry.register(Box::new(DummyTool::new(
            TOOL_SEARCH_TOOL_NAME,
            "Search tools",
            serde_json::json!({"type": "object"}),
        )));
        registry.register(Box::new(DummyTool::new(
            "Read",
            "Read file",
            serde_json::json!({"type": "object"}),
        )));
        registry.register(Box::new(DummyTool::new(
            "Glob",
            "Glob file",
            serde_json::json!({"type": "object"}),
        )));
        registry.register(Box::new(DummyTool::new(
            "WebSearch",
            "Web search",
            serde_json::json!({"type": "object"}),
        )));
        registry.register(Box::new(DummyTool::new(
            "Skill",
            "Run skill",
            serde_json::json!({"type": "object"}),
        )));

        prune_deep_search_skill_launch_detour_tools_from_registry(&mut registry, Some(&metadata));

        assert!(!registry.contains(TOOL_SEARCH_TOOL_NAME));
        assert!(!registry.contains("Read"));
        assert!(!registry.contains("Glob"));
        assert!(registry.contains("WebSearch"));
        assert!(registry.contains("Skill"));
    }

    #[test]
    fn test_append_report_skill_launch_session_permissions_blocks_detour_tools() {
        let metadata = serde_json::json!({
            "harness": {
                "report_skill_launch": {
                    "kind": "report_request",
                    "skill_name": "report_generate",
                    "report_request": {
                        "query": "AI Agent 融资"
                    }
                }
            }
        });
        let mut permissions = Vec::new();

        append_report_skill_launch_session_permissions(
            &mut permissions,
            "session-report-skill-1",
            Some(&metadata),
        );

        let tool_search_rule = permissions
            .iter()
            .find(|permission| permission.tool == TOOL_SEARCH_TOOL_NAME)
            .expect("should add ToolSearch deny rule");
        assert!(!tool_search_rule.allowed);
        assert_eq!(tool_search_rule.priority, 1232);
        assert_eq!(tool_search_rule.conditions.len(), 1);
        assert_eq!(
            tool_search_rule.conditions[0].value,
            serde_json::json!("session-report-skill-1")
        );

        assert!(permissions
            .iter()
            .any(|permission| permission.tool == "Read" && !permission.allowed));
        assert!(permissions
            .iter()
            .any(|permission| permission.tool == "Glob" && !permission.allowed));
        assert!(permissions
            .iter()
            .any(|permission| permission.tool == "Grep" && !permission.allowed));
    }

    #[test]
    fn test_prune_report_skill_launch_detour_tools_from_registry_hides_tool_search_and_fs_tools() {
        let metadata = serde_json::json!({
            "harness": {
                "report_skill_launch": {
                    "kind": "report_request",
                    "skill_name": "report_generate",
                    "report_request": {
                        "query": "AI Agent 融资"
                    }
                }
            }
        });
        let mut registry = aster::tools::ToolRegistry::new();
        registry.register(Box::new(DummyTool::new(
            TOOL_SEARCH_TOOL_NAME,
            "Search tools",
            serde_json::json!({"type": "object"}),
        )));
        registry.register(Box::new(DummyTool::new(
            "Read",
            "Read file",
            serde_json::json!({"type": "object"}),
        )));
        registry.register(Box::new(DummyTool::new(
            "Glob",
            "Glob file",
            serde_json::json!({"type": "object"}),
        )));
        registry.register(Box::new(DummyTool::new(
            "WebSearch",
            "Web search",
            serde_json::json!({"type": "object"}),
        )));
        registry.register(Box::new(DummyTool::new(
            "Skill",
            "Run skill",
            serde_json::json!({"type": "object"}),
        )));

        prune_report_skill_launch_detour_tools_from_registry(&mut registry, Some(&metadata));

        assert!(!registry.contains(TOOL_SEARCH_TOOL_NAME));
        assert!(!registry.contains("Read"));
        assert!(!registry.contains("Glob"));
        assert!(registry.contains("WebSearch"));
        assert!(registry.contains("Skill"));
    }

    #[test]
    fn test_append_site_search_skill_launch_session_permissions_blocks_detour_tools() {
        let metadata = serde_json::json!({
            "harness": {
                "site_search_skill_launch": {
                    "kind": "site_search_request",
                    "skill_name": "site_search",
                    "site_search_request": {
                        "site": "GitHub",
                        "query": "openai agents sdk issue"
                    }
                }
            }
        });
        let mut permissions = Vec::new();

        append_site_search_skill_launch_session_permissions(
            &mut permissions,
            "session-site-search-skill-1",
            Some(&metadata),
        );

        let tool_search_rule = permissions
            .iter()
            .find(|permission| permission.tool == TOOL_SEARCH_TOOL_NAME)
            .expect("should add ToolSearch deny rule");
        assert!(!tool_search_rule.allowed);
        assert_eq!(tool_search_rule.priority, 1231);
        assert_eq!(tool_search_rule.conditions.len(), 1);
        assert_eq!(
            tool_search_rule.conditions[0].value,
            serde_json::json!("session-site-search-skill-1")
        );

        let browser_deny_rule = permissions
            .iter()
            .find(|permission| permission.tool == "mcp__lime-browser__*")
            .expect("should add browser compat deny rule");
        assert!(!browser_deny_rule.allowed);

        assert!(permissions
            .iter()
            .any(|permission| permission.tool == "WebSearch" && !permission.allowed));
        assert!(permissions
            .iter()
            .any(|permission| permission.tool == "Read" && !permission.allowed));
        assert!(permissions
            .iter()
            .any(|permission| permission.tool == "Glob" && !permission.allowed));
        assert!(permissions
            .iter()
            .any(|permission| permission.tool == "Grep" && !permission.allowed));
    }

    #[test]
    fn test_prune_site_search_skill_launch_detour_tools_from_registry_hides_tool_search_and_fs_tools(
    ) {
        let metadata = serde_json::json!({
            "harness": {
                "site_search_skill_launch": {
                    "kind": "site_search_request",
                    "skill_name": "site_search",
                    "site_search_request": {
                        "site": "GitHub",
                        "query": "openai agents sdk issue"
                    }
                }
            }
        });
        let mut registry = aster::tools::ToolRegistry::new();
        registry.register(Box::new(DummyTool::new(
            TOOL_SEARCH_TOOL_NAME,
            "Search tools",
            serde_json::json!({"type": "object"}),
        )));
        registry.register(Box::new(DummyTool::new(
            "WebSearch",
            "Web search",
            serde_json::json!({"type": "object"}),
        )));
        registry.register(Box::new(DummyTool::new(
            "Read",
            "Read file",
            serde_json::json!({"type": "object"}),
        )));
        registry.register(Box::new(DummyTool::new(
            "Glob",
            "Glob file",
            serde_json::json!({"type": "object"}),
        )));
        registry.register(Box::new(DummyTool::new(
            "lime_site_run",
            "Run site adapter",
            serde_json::json!({"type": "object"}),
        )));
        registry.register(Box::new(DummyTool::new(
            "Skill",
            "Run skill",
            serde_json::json!({"type": "object"}),
        )));

        prune_site_search_skill_launch_detour_tools_from_registry(&mut registry, Some(&metadata));

        assert!(!registry.contains(TOOL_SEARCH_TOOL_NAME));
        assert!(!registry.contains("WebSearch"));
        assert!(!registry.contains("Read"));
        assert!(!registry.contains("Glob"));
        assert!(registry.contains("lime_site_run"));
        assert!(registry.contains("Skill"));
    }

    #[test]
    fn test_append_pdf_read_skill_launch_session_permissions_blocks_detour_tools() {
        let metadata = serde_json::json!({
            "harness": {
                "pdf_read_skill_launch": {
                    "kind": "pdf_read_request",
                    "skill_name": "pdf_read",
                    "pdf_read_request": {
                        "source_path": "/tmp/agent-report.pdf"
                    }
                }
            }
        });
        let mut permissions = Vec::new();

        append_pdf_read_skill_launch_session_permissions(
            &mut permissions,
            "session-pdf-read-skill-1",
            Some(&metadata),
        );

        let tool_search_rule = permissions
            .iter()
            .find(|permission| permission.tool == TOOL_SEARCH_TOOL_NAME)
            .expect("should add ToolSearch deny rule");
        assert!(!tool_search_rule.allowed);
        assert_eq!(tool_search_rule.priority, 1230);
        assert_eq!(tool_search_rule.conditions.len(), 1);
        assert_eq!(
            tool_search_rule.conditions[0].value,
            serde_json::json!("session-pdf-read-skill-1")
        );

        assert!(permissions
            .iter()
            .any(|permission| permission.tool == "WebSearch" && !permission.allowed));
        assert!(permissions
            .iter()
            .any(|permission| permission.tool == "Grep" && !permission.allowed));
        assert!(!permissions
            .iter()
            .any(|permission| permission.tool == "Read" && !permission.allowed));
        assert!(!permissions
            .iter()
            .any(|permission| permission.tool == "Glob" && !permission.allowed));
    }

    #[test]
    fn test_prune_pdf_read_skill_launch_detour_tools_from_registry_keeps_read_and_glob_tools() {
        let metadata = serde_json::json!({
            "harness": {
                "pdf_read_skill_launch": {
                    "kind": "pdf_read_request",
                    "skill_name": "pdf_read",
                    "pdf_read_request": {
                        "source_path": "/tmp/agent-report.pdf"
                    }
                }
            }
        });
        let mut registry = aster::tools::ToolRegistry::new();
        registry.register(Box::new(DummyTool::new(
            TOOL_SEARCH_TOOL_NAME,
            "Search tools",
            serde_json::json!({"type": "object"}),
        )));
        registry.register(Box::new(DummyTool::new(
            "WebSearch",
            "Web search",
            serde_json::json!({"type": "object"}),
        )));
        registry.register(Box::new(DummyTool::new(
            "Grep",
            "Grep file",
            serde_json::json!({"type": "object"}),
        )));
        registry.register(Box::new(DummyTool::new(
            "Read",
            "Read file",
            serde_json::json!({"type": "object"}),
        )));
        registry.register(Box::new(DummyTool::new(
            "Glob",
            "Glob file",
            serde_json::json!({"type": "object"}),
        )));
        registry.register(Box::new(DummyTool::new(
            "Skill",
            "Run skill",
            serde_json::json!({"type": "object"}),
        )));

        prune_pdf_read_skill_launch_detour_tools_from_registry(&mut registry, Some(&metadata));

        assert!(!registry.contains(TOOL_SEARCH_TOOL_NAME));
        assert!(!registry.contains("WebSearch"));
        assert!(!registry.contains("Grep"));
        assert!(registry.contains("Read"));
        assert!(registry.contains("Glob"));
        assert!(registry.contains("Skill"));
    }

    #[test]
    fn test_append_summary_skill_launch_session_permissions_blocks_detour_tools() {
        let metadata = serde_json::json!({
            "harness": {
                "summary_skill_launch": {
                    "kind": "summary_request",
                    "skill_name": "summary",
                    "summary_request": {
                        "prompt": "请总结这篇长文的三点要点",
                        "content": "这是一篇关于 AI Agent 融资的长文"
                    }
                }
            }
        });
        let mut permissions = Vec::new();

        append_summary_skill_launch_session_permissions(
            &mut permissions,
            "session-summary-skill-1",
            Some(&metadata),
        );

        let tool_search_rule = permissions
            .iter()
            .find(|permission| permission.tool == TOOL_SEARCH_TOOL_NAME)
            .expect("should add ToolSearch deny rule");
        assert!(!tool_search_rule.allowed);
        assert_eq!(tool_search_rule.priority, 1229);
        assert_eq!(tool_search_rule.conditions.len(), 1);
        assert_eq!(
            tool_search_rule.conditions[0].value,
            serde_json::json!("session-summary-skill-1")
        );

        assert!(permissions
            .iter()
            .any(|permission| permission.tool == "WebSearch" && !permission.allowed));
        assert!(permissions
            .iter()
            .any(|permission| permission.tool == "Grep" && !permission.allowed));
        assert!(!permissions
            .iter()
            .any(|permission| permission.tool == "Read" && !permission.allowed));
        assert!(!permissions
            .iter()
            .any(|permission| permission.tool == "Glob" && !permission.allowed));
    }

    #[test]
    fn test_prune_summary_skill_launch_detour_tools_from_registry_keeps_read_and_glob_tools() {
        let metadata = serde_json::json!({
            "harness": {
                "summary_skill_launch": {
                    "kind": "summary_request",
                    "skill_name": "summary",
                    "summary_request": {
                        "prompt": "请总结这篇长文的三点要点",
                        "content": "这是一篇关于 AI Agent 融资的长文"
                    }
                }
            }
        });
        let mut registry = aster::tools::ToolRegistry::new();
        registry.register(Box::new(DummyTool::new(
            TOOL_SEARCH_TOOL_NAME,
            "Search tools",
            serde_json::json!({"type": "object"}),
        )));
        registry.register(Box::new(DummyTool::new(
            "WebSearch",
            "Web search",
            serde_json::json!({"type": "object"}),
        )));
        registry.register(Box::new(DummyTool::new(
            "Grep",
            "Grep file",
            serde_json::json!({"type": "object"}),
        )));
        registry.register(Box::new(DummyTool::new(
            "Read",
            "Read file",
            serde_json::json!({"type": "object"}),
        )));
        registry.register(Box::new(DummyTool::new(
            "Glob",
            "Glob file",
            serde_json::json!({"type": "object"}),
        )));
        registry.register(Box::new(DummyTool::new(
            "Skill",
            "Run skill",
            serde_json::json!({"type": "object"}),
        )));

        prune_summary_skill_launch_detour_tools_from_registry(&mut registry, Some(&metadata));

        assert!(!registry.contains(TOOL_SEARCH_TOOL_NAME));
        assert!(!registry.contains("WebSearch"));
        assert!(!registry.contains("Grep"));
        assert!(registry.contains("Read"));
        assert!(registry.contains("Glob"));
        assert!(registry.contains("Skill"));
    }

    #[test]
    fn test_append_translation_skill_launch_session_permissions_blocks_detour_tools() {
        let metadata = serde_json::json!({
            "harness": {
                "translation_skill_launch": {
                    "kind": "translation_request",
                    "skill_name": "translation",
                    "translation_request": {
                        "prompt": "将 hello world 翻译成中文",
                        "content": "hello world"
                    }
                }
            }
        });
        let mut permissions = Vec::new();

        append_translation_skill_launch_session_permissions(
            &mut permissions,
            "session-translation-skill-1",
            Some(&metadata),
        );

        let tool_search_rule = permissions
            .iter()
            .find(|permission| permission.tool == TOOL_SEARCH_TOOL_NAME)
            .expect("should add ToolSearch deny rule");
        assert!(!tool_search_rule.allowed);
        assert_eq!(tool_search_rule.priority, 1228);
        assert_eq!(tool_search_rule.conditions.len(), 1);
        assert_eq!(
            tool_search_rule.conditions[0].value,
            serde_json::json!("session-translation-skill-1")
        );

        assert!(permissions
            .iter()
            .any(|permission| permission.tool == "WebSearch" && !permission.allowed));
        assert!(permissions
            .iter()
            .any(|permission| permission.tool == "Grep" && !permission.allowed));
        assert!(!permissions
            .iter()
            .any(|permission| permission.tool == "Read" && !permission.allowed));
        assert!(!permissions
            .iter()
            .any(|permission| permission.tool == "Glob" && !permission.allowed));
    }

    #[test]
    fn test_prune_translation_skill_launch_detour_tools_from_registry_keeps_read_and_glob_tools() {
        let metadata = serde_json::json!({
            "harness": {
                "translation_skill_launch": {
                    "kind": "translation_request",
                    "skill_name": "translation",
                    "translation_request": {
                        "prompt": "将 hello world 翻译成中文",
                        "content": "hello world"
                    }
                }
            }
        });
        let mut registry = aster::tools::ToolRegistry::new();
        registry.register(Box::new(DummyTool::new(
            TOOL_SEARCH_TOOL_NAME,
            "Search tools",
            serde_json::json!({"type": "object"}),
        )));
        registry.register(Box::new(DummyTool::new(
            "WebSearch",
            "Web search",
            serde_json::json!({"type": "object"}),
        )));
        registry.register(Box::new(DummyTool::new(
            "Grep",
            "Grep file",
            serde_json::json!({"type": "object"}),
        )));
        registry.register(Box::new(DummyTool::new(
            "Read",
            "Read file",
            serde_json::json!({"type": "object"}),
        )));
        registry.register(Box::new(DummyTool::new(
            "Glob",
            "Glob file",
            serde_json::json!({"type": "object"}),
        )));
        registry.register(Box::new(DummyTool::new(
            "Skill",
            "Run skill",
            serde_json::json!({"type": "object"}),
        )));

        prune_translation_skill_launch_detour_tools_from_registry(&mut registry, Some(&metadata));

        assert!(!registry.contains(TOOL_SEARCH_TOOL_NAME));
        assert!(!registry.contains("WebSearch"));
        assert!(!registry.contains("Grep"));
        assert!(registry.contains("Read"));
        assert!(registry.contains("Glob"));
        assert!(registry.contains("Skill"));
    }

    #[test]
    fn test_append_analysis_skill_launch_session_permissions_blocks_detour_tools() {
        let metadata = serde_json::json!({
            "harness": {
                "analysis_skill_launch": {
                    "kind": "analysis_request",
                    "skill_name": "analysis",
                    "analysis_request": {
                        "prompt": "判断 OpenAI 新模型发布的商业影响",
                        "content": "OpenAI 发布新模型"
                    }
                }
            }
        });
        let mut permissions = Vec::new();

        append_analysis_skill_launch_session_permissions(
            &mut permissions,
            "session-analysis-skill-1",
            Some(&metadata),
        );

        let tool_search_rule = permissions
            .iter()
            .find(|permission| permission.tool == TOOL_SEARCH_TOOL_NAME)
            .expect("should add ToolSearch deny rule");
        assert!(!tool_search_rule.allowed);
        assert_eq!(tool_search_rule.priority, 1227);
        assert_eq!(tool_search_rule.conditions.len(), 1);
        assert_eq!(
            tool_search_rule.conditions[0].value,
            serde_json::json!("session-analysis-skill-1")
        );

        assert!(permissions
            .iter()
            .any(|permission| permission.tool == "WebSearch" && !permission.allowed));
        assert!(permissions
            .iter()
            .any(|permission| permission.tool == "Grep" && !permission.allowed));
        assert!(!permissions
            .iter()
            .any(|permission| permission.tool == "Read" && !permission.allowed));
        assert!(!permissions
            .iter()
            .any(|permission| permission.tool == "Glob" && !permission.allowed));
    }

    #[test]
    fn test_prune_analysis_skill_launch_detour_tools_from_registry_keeps_read_and_glob_tools() {
        let metadata = serde_json::json!({
            "harness": {
                "analysis_skill_launch": {
                    "kind": "analysis_request",
                    "skill_name": "analysis",
                    "analysis_request": {
                        "prompt": "判断 OpenAI 新模型发布的商业影响",
                        "content": "OpenAI 发布新模型"
                    }
                }
            }
        });
        let mut registry = aster::tools::ToolRegistry::new();
        registry.register(Box::new(DummyTool::new(
            TOOL_SEARCH_TOOL_NAME,
            "Search tools",
            serde_json::json!({"type": "object"}),
        )));
        registry.register(Box::new(DummyTool::new(
            "WebSearch",
            "Web search",
            serde_json::json!({"type": "object"}),
        )));
        registry.register(Box::new(DummyTool::new(
            "Grep",
            "Grep file",
            serde_json::json!({"type": "object"}),
        )));
        registry.register(Box::new(DummyTool::new(
            "Read",
            "Read file",
            serde_json::json!({"type": "object"}),
        )));
        registry.register(Box::new(DummyTool::new(
            "Glob",
            "Glob file",
            serde_json::json!({"type": "object"}),
        )));
        registry.register(Box::new(DummyTool::new(
            "Skill",
            "Run skill",
            serde_json::json!({"type": "object"}),
        )));

        prune_analysis_skill_launch_detour_tools_from_registry(&mut registry, Some(&metadata));

        assert!(!registry.contains(TOOL_SEARCH_TOOL_NAME));
        assert!(!registry.contains("WebSearch"));
        assert!(!registry.contains("Grep"));
        assert!(registry.contains("Read"));
        assert!(registry.contains("Glob"));
        assert!(registry.contains("Skill"));
    }

    #[test]
    fn test_append_transcription_skill_launch_session_permissions_blocks_detour_tools() {
        let metadata = serde_json::json!({
            "harness": {
                "transcription_skill_launch": {
                    "kind": "transcription_task",
                    "skill_name": "transcription_generate",
                    "transcription_task": {
                        "prompt": "生成逐字稿",
                        "source_url": "https://example.com/interview.mp4"
                    }
                }
            }
        });
        let mut permissions = Vec::new();

        append_transcription_skill_launch_session_permissions(
            &mut permissions,
            "session-transcription-skill-1",
            Some(&metadata),
        );

        let tool_search_rule = permissions
            .iter()
            .find(|permission| permission.tool == TOOL_SEARCH_TOOL_NAME)
            .expect("should add ToolSearch deny rule");
        assert!(!tool_search_rule.allowed);
        assert_eq!(tool_search_rule.priority, 1226);
        assert_eq!(tool_search_rule.conditions.len(), 1);
        assert_eq!(
            tool_search_rule.conditions[0].value,
            serde_json::json!("session-transcription-skill-1")
        );

        assert!(permissions
            .iter()
            .any(|permission| permission.tool == "WebSearch" && !permission.allowed));
        assert!(permissions
            .iter()
            .any(|permission| permission.tool == "Read" && !permission.allowed));
        assert!(permissions
            .iter()
            .any(|permission| permission.tool == "Glob" && !permission.allowed));
        assert!(permissions
            .iter()
            .any(|permission| permission.tool == "Grep" && !permission.allowed));
    }

    #[test]
    fn test_prune_transcription_skill_launch_detour_tools_from_registry_hides_tool_search_and_fs_tools(
    ) {
        let metadata = serde_json::json!({
            "harness": {
                "transcription_skill_launch": {
                    "kind": "transcription_task",
                    "skill_name": "transcription_generate",
                    "transcription_task": {
                        "prompt": "生成逐字稿",
                        "source_url": "https://example.com/interview.mp4"
                    }
                }
            }
        });
        let mut registry = aster::tools::ToolRegistry::new();
        registry.register(Box::new(DummyTool::new(
            TOOL_SEARCH_TOOL_NAME,
            "Search tools",
            serde_json::json!({"type": "object"}),
        )));
        registry.register(Box::new(DummyTool::new(
            "WebSearch",
            "Web search",
            serde_json::json!({"type": "object"}),
        )));
        registry.register(Box::new(DummyTool::new(
            "Read",
            "Read file",
            serde_json::json!({"type": "object"}),
        )));
        registry.register(Box::new(DummyTool::new(
            "Glob",
            "Glob file",
            serde_json::json!({"type": "object"}),
        )));
        registry.register(Box::new(DummyTool::new(
            "Grep",
            "Grep file",
            serde_json::json!({"type": "object"}),
        )));
        registry.register(Box::new(DummyTool::new(
            "Skill",
            "Run skill",
            serde_json::json!({"type": "object"}),
        )));

        prune_transcription_skill_launch_detour_tools_from_registry(&mut registry, Some(&metadata));

        assert!(!registry.contains(TOOL_SEARCH_TOOL_NAME));
        assert!(!registry.contains("WebSearch"));
        assert!(!registry.contains("Read"));
        assert!(!registry.contains("Glob"));
        assert!(!registry.contains("Grep"));
        assert!(registry.contains("Skill"));
    }

    #[test]
    fn test_append_url_parse_skill_launch_session_permissions_blocks_detour_tools() {
        let metadata = serde_json::json!({
            "harness": {
                "url_parse_skill_launch": {
                    "kind": "url_parse_task",
                    "skill_name": "url_parse",
                    "url_parse_task": {
                        "prompt": "提取要点并整理成投资人可读摘要",
                        "url": "https://example.com/agent"
                    }
                }
            }
        });
        let mut permissions = Vec::new();

        append_url_parse_skill_launch_session_permissions(
            &mut permissions,
            "session-url-parse-skill-1",
            Some(&metadata),
        );

        let tool_search_rule = permissions
            .iter()
            .find(|permission| permission.tool == TOOL_SEARCH_TOOL_NAME)
            .expect("should add ToolSearch deny rule");
        assert!(!tool_search_rule.allowed);
        assert_eq!(tool_search_rule.priority, 1225);
        assert_eq!(tool_search_rule.conditions.len(), 1);
        assert_eq!(
            tool_search_rule.conditions[0].value,
            serde_json::json!("session-url-parse-skill-1")
        );

        assert!(permissions
            .iter()
            .any(|permission| permission.tool == "WebSearch" && !permission.allowed));
        assert!(permissions
            .iter()
            .any(|permission| permission.tool == "Read" && !permission.allowed));
        assert!(permissions
            .iter()
            .any(|permission| permission.tool == "Glob" && !permission.allowed));
        assert!(permissions
            .iter()
            .any(|permission| permission.tool == "Grep" && !permission.allowed));
    }

    #[test]
    fn test_prune_url_parse_skill_launch_detour_tools_from_registry_hides_tool_search_and_fs_tools()
    {
        let metadata = serde_json::json!({
            "harness": {
                "url_parse_skill_launch": {
                    "kind": "url_parse_task",
                    "skill_name": "url_parse",
                    "url_parse_task": {
                        "prompt": "提取要点并整理成投资人可读摘要",
                        "url": "https://example.com/agent"
                    }
                }
            }
        });
        let mut registry = aster::tools::ToolRegistry::new();
        registry.register(Box::new(DummyTool::new(
            TOOL_SEARCH_TOOL_NAME,
            "Search tools",
            serde_json::json!({"type": "object"}),
        )));
        registry.register(Box::new(DummyTool::new(
            "WebSearch",
            "Web search",
            serde_json::json!({"type": "object"}),
        )));
        registry.register(Box::new(DummyTool::new(
            "Read",
            "Read file",
            serde_json::json!({"type": "object"}),
        )));
        registry.register(Box::new(DummyTool::new(
            "Glob",
            "Glob file",
            serde_json::json!({"type": "object"}),
        )));
        registry.register(Box::new(DummyTool::new(
            "Grep",
            "Grep file",
            serde_json::json!({"type": "object"}),
        )));
        registry.register(Box::new(DummyTool::new(
            "Skill",
            "Run skill",
            serde_json::json!({"type": "object"}),
        )));

        prune_url_parse_skill_launch_detour_tools_from_registry(&mut registry, Some(&metadata));

        assert!(!registry.contains(TOOL_SEARCH_TOOL_NAME));
        assert!(!registry.contains("WebSearch"));
        assert!(!registry.contains("Read"));
        assert!(!registry.contains("Glob"));
        assert!(!registry.contains("Grep"));
        assert!(registry.contains("Skill"));
    }

    #[test]
    fn test_append_typesetting_skill_launch_session_permissions_blocks_detour_tools() {
        let metadata = serde_json::json!({
            "harness": {
                "typesetting_skill_launch": {
                    "kind": "typesetting_task",
                    "skill_name": "typesetting",
                    "typesetting_task": {
                        "prompt": "整理成更适合小红书阅读的短句节奏",
                        "content": "这是一段待排版正文",
                        "target_platform": "小红书"
                    }
                }
            }
        });
        let mut permissions = Vec::new();

        append_typesetting_skill_launch_session_permissions(
            &mut permissions,
            "session-typesetting-skill-1",
            Some(&metadata),
        );

        let tool_search_rule = permissions
            .iter()
            .find(|permission| permission.tool == TOOL_SEARCH_TOOL_NAME)
            .expect("should add ToolSearch deny rule");
        assert!(!tool_search_rule.allowed);
        assert_eq!(tool_search_rule.priority, 1224);
        assert_eq!(tool_search_rule.conditions.len(), 1);
        assert_eq!(
            tool_search_rule.conditions[0].value,
            serde_json::json!("session-typesetting-skill-1")
        );

        assert!(permissions
            .iter()
            .any(|permission| permission.tool == "WebSearch" && !permission.allowed));
        assert!(permissions
            .iter()
            .any(|permission| permission.tool == "Read" && !permission.allowed));
        assert!(permissions
            .iter()
            .any(|permission| permission.tool == "Glob" && !permission.allowed));
        assert!(permissions
            .iter()
            .any(|permission| permission.tool == "Grep" && !permission.allowed));
    }

    #[test]
    fn test_prune_typesetting_skill_launch_detour_tools_from_registry_hides_tool_search_and_fs_tools(
    ) {
        let metadata = serde_json::json!({
            "harness": {
                "typesetting_skill_launch": {
                    "kind": "typesetting_task",
                    "skill_name": "typesetting",
                    "typesetting_task": {
                        "prompt": "整理成更适合小红书阅读的短句节奏",
                        "content": "这是一段待排版正文",
                        "target_platform": "小红书"
                    }
                }
            }
        });
        let mut registry = aster::tools::ToolRegistry::new();
        registry.register(Box::new(DummyTool::new(
            TOOL_SEARCH_TOOL_NAME,
            "Search tools",
            serde_json::json!({"type": "object"}),
        )));
        registry.register(Box::new(DummyTool::new(
            "WebSearch",
            "Web search",
            serde_json::json!({"type": "object"}),
        )));
        registry.register(Box::new(DummyTool::new(
            "Read",
            "Read file",
            serde_json::json!({"type": "object"}),
        )));
        registry.register(Box::new(DummyTool::new(
            "Glob",
            "Glob file",
            serde_json::json!({"type": "object"}),
        )));
        registry.register(Box::new(DummyTool::new(
            "Grep",
            "Grep file",
            serde_json::json!({"type": "object"}),
        )));
        registry.register(Box::new(DummyTool::new(
            "Skill",
            "Run skill",
            serde_json::json!({"type": "object"}),
        )));

        prune_typesetting_skill_launch_detour_tools_from_registry(&mut registry, Some(&metadata));

        assert!(!registry.contains(TOOL_SEARCH_TOOL_NAME));
        assert!(!registry.contains("WebSearch"));
        assert!(!registry.contains("Read"));
        assert!(!registry.contains("Glob"));
        assert!(!registry.contains("Grep"));
        assert!(registry.contains("Skill"));
    }

    #[test]
    fn test_append_presentation_skill_launch_session_permissions_blocks_detour_tools() {
        let metadata = serde_json::json!({
            "harness": {
                "presentation_skill_launch": {
                    "kind": "presentation_request",
                    "skill_name": "presentation_generate",
                    "presentation_request": {
                        "prompt": "帮我做一个 AI 助手创业项目融资演示稿",
                        "content": "类型:路演PPT 风格:极简科技 受众:投资人 页数:10",
                        "deck_type": "pitch_deck",
                        "style": "极简科技",
                        "audience": "投资人",
                        "slide_count": 10
                    }
                }
            }
        });
        let mut permissions = Vec::new();

        append_presentation_skill_launch_session_permissions(
            &mut permissions,
            "session-presentation-skill-1",
            Some(&metadata),
        );

        let tool_search_rule = permissions
            .iter()
            .find(|permission| permission.tool == TOOL_SEARCH_TOOL_NAME)
            .expect("should add ToolSearch deny rule");
        assert!(!tool_search_rule.allowed);
        assert_eq!(tool_search_rule.priority, 1224);
        assert_eq!(tool_search_rule.conditions.len(), 1);
        assert_eq!(
            tool_search_rule.conditions[0].value,
            serde_json::json!("session-presentation-skill-1")
        );

        assert!(permissions
            .iter()
            .any(|permission| permission.tool == "WebSearch" && !permission.allowed));
        assert!(permissions
            .iter()
            .any(|permission| permission.tool == "Read" && !permission.allowed));
        assert!(permissions
            .iter()
            .any(|permission| permission.tool == "Glob" && !permission.allowed));
        assert!(permissions
            .iter()
            .any(|permission| permission.tool == "Grep" && !permission.allowed));
    }

    #[test]
    fn test_prune_presentation_skill_launch_detour_tools_from_registry_hides_tool_search_and_fs_tools(
    ) {
        let metadata = serde_json::json!({
            "harness": {
                "presentation_skill_launch": {
                    "kind": "presentation_request",
                    "skill_name": "presentation_generate",
                    "presentation_request": {
                        "prompt": "帮我做一个 AI 助手创业项目融资演示稿",
                        "deck_type": "pitch_deck"
                    }
                }
            }
        });
        let mut registry = aster::tools::ToolRegistry::new();
        registry.register(Box::new(DummyTool::new(
            TOOL_SEARCH_TOOL_NAME,
            "Search tools",
            serde_json::json!({"type": "object"}),
        )));
        registry.register(Box::new(DummyTool::new(
            "WebSearch",
            "Web search",
            serde_json::json!({"type": "object"}),
        )));
        registry.register(Box::new(DummyTool::new(
            "Read",
            "Read file",
            serde_json::json!({"type": "object"}),
        )));
        registry.register(Box::new(DummyTool::new(
            "Glob",
            "Glob file",
            serde_json::json!({"type": "object"}),
        )));
        registry.register(Box::new(DummyTool::new(
            "Grep",
            "Grep file",
            serde_json::json!({"type": "object"}),
        )));
        registry.register(Box::new(DummyTool::new(
            "Skill",
            "Run skill",
            serde_json::json!({"type": "object"}),
        )));

        prune_presentation_skill_launch_detour_tools_from_registry(&mut registry, Some(&metadata));

        assert!(!registry.contains(TOOL_SEARCH_TOOL_NAME));
        assert!(!registry.contains("WebSearch"));
        assert!(!registry.contains("Read"));
        assert!(!registry.contains("Glob"));
        assert!(!registry.contains("Grep"));
        assert!(registry.contains("Skill"));
    }

    #[test]
    fn test_append_form_skill_launch_session_permissions_blocks_detour_tools() {
        let metadata = serde_json::json!({
            "harness": {
                "form_skill_launch": {
                    "kind": "form_request",
                    "skill_name": "form_generate",
                    "form_request": {
                        "prompt": "帮我做一个 AI Workshop 报名表",
                        "content": "类型:报名表单 风格:简洁专业 受众:活动嘉宾 字段数:8",
                        "form_type": "registration_form",
                        "style": "简洁专业",
                        "audience": "活动嘉宾",
                        "field_count": 8
                    }
                }
            }
        });
        let mut permissions = Vec::new();

        append_form_skill_launch_session_permissions(
            &mut permissions,
            "session-form-skill-1",
            Some(&metadata),
        );

        let tool_search_rule = permissions
            .iter()
            .find(|permission| permission.tool == TOOL_SEARCH_TOOL_NAME)
            .expect("should add ToolSearch deny rule");
        assert!(!tool_search_rule.allowed);
        assert_eq!(tool_search_rule.priority, 1225);
        assert_eq!(tool_search_rule.conditions.len(), 1);
        assert_eq!(
            tool_search_rule.conditions[0].value,
            serde_json::json!("session-form-skill-1")
        );

        assert!(permissions
            .iter()
            .any(|permission| permission.tool == "WebSearch" && !permission.allowed));
        assert!(permissions
            .iter()
            .any(|permission| permission.tool == "Read" && !permission.allowed));
        assert!(permissions
            .iter()
            .any(|permission| permission.tool == "Glob" && !permission.allowed));
        assert!(permissions
            .iter()
            .any(|permission| permission.tool == "Grep" && !permission.allowed));
    }

    #[test]
    fn test_prune_form_skill_launch_detour_tools_from_registry_hides_tool_search_and_fs_tools() {
        let metadata = serde_json::json!({
            "harness": {
                "form_skill_launch": {
                    "kind": "form_request",
                    "skill_name": "form_generate",
                    "form_request": {
                        "prompt": "帮我做一个用户调研问卷"
                    }
                }
            }
        });
        let mut registry = aster::tools::ToolRegistry::new();
        registry.register(Box::new(DummyTool::new(
            TOOL_SEARCH_TOOL_NAME,
            "Search tools",
            serde_json::json!({"type": "object"}),
        )));
        registry.register(Box::new(DummyTool::new(
            "WebSearch",
            "Web search",
            serde_json::json!({"type": "object"}),
        )));
        registry.register(Box::new(DummyTool::new(
            "Read",
            "Read file",
            serde_json::json!({"type": "object"}),
        )));
        registry.register(Box::new(DummyTool::new(
            "Glob",
            "Glob file",
            serde_json::json!({"type": "object"}),
        )));
        registry.register(Box::new(DummyTool::new(
            "Grep",
            "Grep file",
            serde_json::json!({"type": "object"}),
        )));
        registry.register(Box::new(DummyTool::new(
            "Skill",
            "Run skill",
            serde_json::json!({"type": "object"}),
        )));

        prune_form_skill_launch_detour_tools_from_registry(&mut registry, Some(&metadata));

        assert!(!registry.contains(TOOL_SEARCH_TOOL_NAME));
        assert!(!registry.contains("WebSearch"));
        assert!(!registry.contains("Read"));
        assert!(!registry.contains("Glob"));
        assert!(!registry.contains("Grep"));
        assert!(registry.contains("Skill"));
    }

    #[test]
    fn test_append_webpage_skill_launch_session_permissions_blocks_detour_tools() {
        let metadata = serde_json::json!({
            "harness": {
                "webpage_skill_launch": {
                    "kind": "webpage_request",
                    "skill_name": "webpage_generate",
                    "webpage_request": {
                        "prompt": "帮我做一个 AI 代码助手官网",
                        "content": "类型:落地页 风格:未来感",
                        "page_type": "landing_page",
                        "style": "未来感",
                        "tech_stack": "原生 HTML"
                    }
                }
            }
        });
        let mut permissions = Vec::new();

        append_webpage_skill_launch_session_permissions(
            &mut permissions,
            "session-webpage-skill-1",
            Some(&metadata),
        );

        let tool_search_rule = permissions
            .iter()
            .find(|permission| permission.tool == TOOL_SEARCH_TOOL_NAME)
            .expect("should add ToolSearch deny rule");
        assert!(!tool_search_rule.allowed);
        assert_eq!(tool_search_rule.priority, 1223);
        assert_eq!(tool_search_rule.conditions.len(), 1);
        assert_eq!(
            tool_search_rule.conditions[0].value,
            serde_json::json!("session-webpage-skill-1")
        );

        assert!(permissions
            .iter()
            .any(|permission| permission.tool == "WebSearch" && !permission.allowed));
        assert!(permissions
            .iter()
            .any(|permission| permission.tool == "Read" && !permission.allowed));
        assert!(permissions
            .iter()
            .any(|permission| permission.tool == "Glob" && !permission.allowed));
        assert!(permissions
            .iter()
            .any(|permission| permission.tool == "Grep" && !permission.allowed));
    }

    #[test]
    fn test_prune_webpage_skill_launch_detour_tools_from_registry_hides_tool_search_and_fs_tools() {
        let metadata = serde_json::json!({
            "harness": {
                "webpage_skill_launch": {
                    "kind": "webpage_request",
                    "skill_name": "webpage_generate",
                    "webpage_request": {
                        "prompt": "帮我做一个 AI 代码助手官网",
                        "page_type": "landing_page"
                    }
                }
            }
        });
        let mut registry = aster::tools::ToolRegistry::new();
        registry.register(Box::new(DummyTool::new(
            TOOL_SEARCH_TOOL_NAME,
            "Search tools",
            serde_json::json!({"type": "object"}),
        )));
        registry.register(Box::new(DummyTool::new(
            "WebSearch",
            "Web search",
            serde_json::json!({"type": "object"}),
        )));
        registry.register(Box::new(DummyTool::new(
            "Read",
            "Read file",
            serde_json::json!({"type": "object"}),
        )));
        registry.register(Box::new(DummyTool::new(
            "Glob",
            "Glob file",
            serde_json::json!({"type": "object"}),
        )));
        registry.register(Box::new(DummyTool::new(
            "Grep",
            "Grep file",
            serde_json::json!({"type": "object"}),
        )));
        registry.register(Box::new(DummyTool::new(
            "Skill",
            "Run skill",
            serde_json::json!({"type": "object"}),
        )));

        prune_webpage_skill_launch_detour_tools_from_registry(&mut registry, Some(&metadata));

        assert!(!registry.contains(TOOL_SEARCH_TOOL_NAME));
        assert!(!registry.contains("WebSearch"));
        assert!(!registry.contains("Read"));
        assert!(!registry.contains("Glob"));
        assert!(!registry.contains("Grep"));
        assert!(registry.contains("Skill"));
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
    fn test_build_runtime_action_session_config_injects_auto_compact_override() {
        let session_config = build_runtime_action_session_config(
            "session-1",
            None,
            &lime_core::workspace::WorkspaceSettings {
                auto_compact: false,
                ..lime_core::workspace::WorkspaceSettings::default()
            },
        );

        assert_eq!(
            session_config
                .turn_context
                .as_ref()
                .and_then(|context| context.metadata.get("lime_runtime"))
                .and_then(|value| value.get("auto_compact"))
                .and_then(serde_json::Value::as_bool),
            Some(false)
        );
    }

    #[test]
    fn test_build_runtime_action_session_config_keeps_auto_compact_enabled_default() {
        let session_config = build_runtime_action_session_config(
            "session-1",
            None,
            &lime_core::workspace::WorkspaceSettings::default(),
        );

        assert!(session_config.turn_context.is_none());
    }

    #[test]
    fn test_build_runtime_action_session_config_reuses_turn_context_snapshot() {
        let metadata = serde_json::json!({
            "artifact": {
                "artifact_mode": "draft",
                "artifact_stage": "stage2",
                "artifact_kind": "analysis"
            },
            "harness": {
                "theme": "analysis"
            }
        });
        let session_config = build_runtime_action_session_config(
            "session-1",
            Some(&metadata),
            &lime_core::workspace::WorkspaceSettings::default(),
        );
        let turn_context = session_config.turn_context.as_ref().expect("turn context");

        assert_eq!(
            turn_context
                .metadata
                .get("harness")
                .and_then(|value| value.get("theme"))
                .and_then(serde_json::Value::as_str),
            Some("analysis")
        );
        assert!(turn_context.output_schema.is_some());
        assert_eq!(
            turn_context.output_schema_source,
            Some(aster::session::TurnOutputSchemaSource::Turn)
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
    fn test_agent_runtime_update_session_request_deserializes_recent_access_mode_aliases() {
        let request: AgentRuntimeUpdateSessionRequest = serde_json::from_value(serde_json::json!({
            "sessionId": "session-1",
            "recentAccessMode": "full-access"
        }))
        .expect("request should deserialize");

        assert_eq!(request.session_id, "session-1");
        assert_eq!(
            request.recent_access_mode,
            Some(lime_agent::SessionExecutionRuntimeAccessMode::FullAccess)
        );

        let legacy_request: AgentRuntimeUpdateSessionRequest =
            serde_json::from_value(serde_json::json!({
                "sessionId": "session-1",
                "recentAccessMode": "full_access"
            }))
            .expect("legacy request should deserialize");

        assert_eq!(
            legacy_request.recent_access_mode,
            Some(lime_agent::SessionExecutionRuntimeAccessMode::FullAccess)
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
            Some(r##"{"path":"content-posts/demo.md","content":"# 标题"}"##),
            "/tmp/workspace",
        );

        assert_eq!(path.as_deref(), Some("content-posts/demo.md"));
    }

    #[test]
    fn test_extract_artifact_path_from_tool_start_reads_nested_artifact_protocol_path() {
        let path = extract_artifact_path_from_tool_start(
            "write_file",
            Some(r##"{"payload":{"artifact_paths":["content-posts\\nested.md"]}}"##),
            "/tmp/workspace",
        );

        assert_eq!(path.as_deref(), Some("content-posts/nested.md"));
    }

    #[test]
    fn test_resolve_social_run_artifact_descriptor_matches_social_draft() {
        let descriptor = resolve_social_run_artifact_descriptor(
            "content-posts/draft.md",
            Some("write_mode"),
            Some("社媒初稿"),
        );

        assert_eq!(descriptor.artifact_type, "draft");
        assert_eq!(descriptor.stage, "drafting");
        assert_eq!(descriptor.version_label, "工作台初稿");
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
                        "theme": "general",
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
            "content-posts/draft.md".to_string(),
            Some(&serde_json::json!({
                "harness": {
                    "theme": "general",
                    "gate_key": "write_mode"
                }
            })),
        );

        let metadata = build_chat_run_finish_metadata(&base, &observation);

        assert_eq!(
            metadata
                .get("artifact_paths")
                .and_then(serde_json::Value::as_array),
            Some(&vec![serde_json::json!("content-posts/draft.md")])
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
            Some("artifact:content-posts/draft.md")
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
    fn test_apply_site_search_skill_launch_to_request_tool_policy_forces_web_search_off() {
        let metadata = serde_json::json!({
            "harness": {
                "site_search_skill_launch": {
                    "skill_name": "site_search",
                    "kind": "site_search_request",
                    "site_search_request": {
                        "site": "GitHub",
                        "query": "openai agents sdk issue",
                    }
                }
            }
        });

        let (request_web_search, request_search_mode) =
            apply_site_search_skill_launch_to_request_tool_policy(
                Some(&metadata),
                Some(true),
                Some(RequestToolPolicyMode::Required),
            );

        assert_eq!(request_web_search, Some(false));
        assert_eq!(request_search_mode, Some(RequestToolPolicyMode::Disabled));
    }

    #[test]
    fn test_apply_site_search_skill_launch_to_request_tool_policy_preserves_other_turns() {
        let metadata = serde_json::json!({
            "harness": {
                "preferences": {
                    "web_search": true
                }
            }
        });

        let (request_web_search, request_search_mode) =
            apply_site_search_skill_launch_to_request_tool_policy(
                Some(&metadata),
                Some(true),
                Some(RequestToolPolicyMode::Required),
            );

        assert_eq!(request_web_search, Some(true));
        assert_eq!(request_search_mode, Some(RequestToolPolicyMode::Required));
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
    fn test_build_chat_run_metadata_base_flattens_team_memory_shadow() {
        let metadata = build_chat_run_metadata_base(
            &AsterChatRequest {
                message: "hello".to_string(),
                session_id: "session-team-shadow".to_string(),
                event_name: "event-team-shadow".to_string(),
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
                        "team_memory_shadow": {
                            "repo_scope": "/tmp/repo",
                            "entries": [
                                {
                                    "key": "team.selection",
                                    "content": "Team：前端联调团队",
                                    "updated_at": 1
                                }
                            ]
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
            metadata.get("team_memory_shadow"),
            Some(&serde_json::json!({
                "repo_scope": "/tmp/repo",
                "entries": [
                    {
                        "key": "team.selection",
                        "content": "Team：前端联调团队",
                        "updated_at": 1
                    }
                ]
            }))
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
                            "artifact_paths": [" /tmp/workspace/content-posts\\final.md "]
                        }),
                    )])),
                },
            },
            "/tmp/workspace",
            Some(&serde_json::json!({
                "harness": {
                    "theme": "general",
                    "gate_key": "write_mode"
                }
            })),
            ProviderContinuationCapability::HistoryReplayOnly,
        );

        assert_eq!(
            observation.artifact_paths,
            vec!["content-posts/final.md".to_string()]
        );
        assert_eq!(
            observation
                .primary_social_artifact
                .as_ref()
                .map(|artifact| artifact.source_file_name.as_str()),
            Some("content-posts/final.md")
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
                    "theme": "general",
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
                        serde_json::json!("/tmp/workspace/content-posts/final.md"),
                    )])),
                },
            },
            "/tmp/workspace",
            Some(&serde_json::json!({
                "harness": {
                    "theme": "general",
                    "gate_key": "write_mode"
                }
            })),
            ProviderContinuationCapability::HistoryReplayOnly,
        );

        assert_eq!(
            observation.artifact_paths,
            vec!["content-posts/final.md".to_string()]
        );
        assert_eq!(
            observation
                .primary_social_artifact
                .as_ref()
                .map(|artifact| artifact.source_file_name.as_str()),
            Some("content-posts/final.md")
        );
    }

    #[test]
    fn test_build_chat_run_finish_metadata_includes_browser_runtime_ref() {
        let mut observation = ChatRunObservation::default();
        observation.record_event(
            &RuntimeAgentEvent::ToolEnd {
                tool_id: "tool-browser".to_string(),
                result: lime_agent::AgentToolResult {
                    success: true,
                    output: "done".to_string(),
                    error: None,
                    images: None,
                    metadata: Some(HashMap::from([(
                        "browser_session".to_string(),
                        serde_json::json!({
                            "profile_key": "general_browser_assist",
                            "session_id": "browser-session-1",
                            "target_id": "target-1"
                        }),
                    )])),
                },
            },
            "/tmp/workspace",
            None,
            ProviderContinuationCapability::HistoryReplayOnly,
        );

        let metadata = build_chat_run_finish_metadata(&serde_json::Map::new(), &observation);

        assert_eq!(
            metadata.get("browser_runtime_ref"),
            Some(&serde_json::json!({
                "profile_key": "general_browser_assist",
                "session_id": "browser-session-1",
                "target_id": "target-1"
            }))
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
                    usage: None,
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
                    usage: None,
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
            AsterExecutionStrategy::Auto.effective_for_message("请先调用 ToolSearch 再继续");
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
            source: Some("general_workbench_document_auto_continue".to_string()),
        };
        let merged =
            merge_system_prompt_with_auto_continue(Some("你是助手".to_string()), Some(&config))
                .expect("should contain merged prompt");
        assert!(merged.contains(AUTO_CONTINUE_PROMPT_MARKER));
        assert!(merged.contains("续写长度"));
        assert!(merged.contains("general_workbench_document_auto_continue"));
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
                "source": "runtime_action_required",
                "mode": "runtime_metadata",
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
        assert!(merged.contains("runtime_action_required"));
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
    fn test_merge_system_prompt_with_service_scene_launch_appends_runtime_tool_contract() {
        let metadata = serde_json::json!({
            "harness": {
                "service_scene_launch": {
                    "kind": "cloud_scene",
                    "service_scene_run": {
                        "skill_id": "skill-scene-1",
                        "skill_title": "趋势赛题日报",
                        "skill_summary": "拉取热点赛题并整理成日报摘要。",
                        "scene_key": "daily-trend-brief",
                        "command_prefix": "/daily-trend-brief",
                        "user_input": "帮我输出今天的小红书趋势赛题",
                        "entry_source": "slash_scene_command",
                        "project_id": "project-1",
                        "content_id": "content-1",
                        "oem_runtime": {
                            "scene_base_url": "https://example.com/scene-api",
                            "session_token": "session-token-demo"
                        }
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
        assert!(merged.contains("第一优先工具调用必须是 lime_run_service_skill"));
        assert!(merged.contains("不要把 scene metadata 里的 session_token"));
        assert!(merged.contains("当前服务型技能 ID：skill-scene-1"));
        assert!(merged.contains("当前 scene_key：daily-trend-brief"));
        assert!(merged.contains("当前回合已绑定 OEM Session Token"));
    }

    #[test]
    fn test_merge_system_prompt_with_image_skill_launch_appends_prompt() {
        let metadata = serde_json::json!({
            "harness": {
                "allow_model_skills": true,
                "image_skill_launch": {
                    "skill_name": "image_generate",
                    "kind": "image_task",
                    "image_task": {
                        "mode": "edit",
                        "prompt": "把这张海报改成更清爽的青柠风格",
                        "raw_text": "@修图 #img-2 把这张海报改成更清爽的青柠风格",
                        "size": "1024x1024",
                        "reference_images": [
                            "/tmp/lime/turn-inputs/session-1/turn-1/input-1.png"
                        ]
                    }
                }
            }
        });

        let merged = merge_system_prompt_with_image_skill_launch(
            Some("你是助手".to_string()),
            Some(&metadata),
        )
        .expect("should contain merged prompt");

        assert!(merged.contains(super::image_skill_launch::IMAGE_SKILL_LAUNCH_PROMPT_MARKER));
        assert!(merged.contains("第一优先工具调用必须是 Skill"));
        assert!(merged.contains("skill=\"image_generate\""));
        assert!(merged.contains("Skill.args 的 JSON"));
        assert!(merged.contains("第一工具调用示例(Skill 参数 JSON)"));
        assert!(merged.contains("\"image_task\":"));
        assert!(merged.contains("不要为了确认技能名、工具名或命令名再去调用 ToolSearch"));
        assert!(merged.contains("不要先走 ToolSearch / WebSearch / Read / Glob / Grep"));
        assert!(merged.contains("应立即改为直调 Skill(image_generate)"));
        assert!(merged.contains("lime media image generate --json"));
        assert!(merged.contains("不要伪造“图片已生成完成”"));
        assert!(merged.contains("当前任务已经显式进入图片技能主链"));
    }

    #[test]
    fn test_merge_system_prompt_with_cover_skill_launch_appends_prompt() {
        let metadata = serde_json::json!({
            "harness": {
                "allow_model_skills": true,
                "cover_skill_launch": {
                    "skill_name": "cover_generate",
                    "kind": "cover_task",
                    "cover_task": {
                        "prompt": "春日咖啡市集封面",
                        "raw_text": "@封面 小红书 标题: 春日咖啡快闪 风格: 清新插画, 1:1 春日咖啡市集封面",
                        "title": "春日咖啡快闪",
                        "platform": "小红书",
                        "size": "1:1",
                        "style": "清新插画",
                        "project_id": "project-1",
                        "content_id": "content-1"
                    }
                }
            }
        });

        let merged = merge_system_prompt_with_cover_skill_launch(
            Some("你是助手".to_string()),
            Some(&metadata),
        )
        .expect("should contain merged prompt");

        assert!(merged.contains("<<LIME_COVER_SKILL_LAUNCH_HINT>>"));
        assert!(merged.contains("第一优先工具调用必须是 Skill"));
        assert!(merged.contains("skill=\"cover_generate\""));
        assert!(merged.contains("Skill.args 的 JSON"));
        assert!(merged.contains("第一工具调用示例(Skill 参数 JSON)"));
        assert!(merged.contains("\"cover_task\":"));
        assert!(merged.contains("不要为了确认技能名、工具名或命令名再去调用 ToolSearch"));
        assert!(merged.contains("不要先走 ToolSearch / WebSearch / Read / Glob / Grep"));
        assert!(merged.contains("应立即改为直调 Skill(cover_generate)"));
        assert!(merged.contains("lime task create cover --json"));
        assert!(merged.contains("不要把封面任务退化成普通配图"));
        assert!(merged.contains("当前任务已经显式进入封面技能主链"));
    }

    #[test]
    fn test_merge_system_prompt_with_video_skill_launch_appends_prompt() {
        let metadata = serde_json::json!({
            "harness": {
                "allow_model_skills": true,
                "video_skill_launch": {
                    "skill_name": "video_generate",
                    "kind": "video_task",
                    "video_task": {
                        "prompt": "15 秒新品发布短视频",
                        "raw_text": "@视频 15秒 新品发布短视频，16:9，720p",
                        "duration": 15,
                        "aspect_ratio": "16:9",
                        "resolution": "720p"
                    }
                }
            }
        });

        let merged = merge_system_prompt_with_video_skill_launch(
            Some("你是助手".to_string()),
            Some(&metadata),
        )
        .expect("should contain merged prompt");

        assert!(merged.contains("<<LIME_VIDEO_SKILL_LAUNCH_HINT>>"));
        assert!(merged.contains("第一优先工具调用必须是 Skill"));
        assert!(merged.contains("skill=\"video_generate\""));
        assert!(merged.contains("Skill.args 的 JSON"));
        assert!(merged.contains("第一工具调用示例(Skill 参数 JSON)"));
        assert!(merged.contains("\"video_task\":"));
        assert!(merged.contains("不要为了确认技能名、工具名或命令名再去调用 ToolSearch"));
        assert!(merged.contains("不要先走 ToolSearch / WebSearch / Read / Glob / Grep"));
        assert!(merged.contains("应立即改为直调 Skill(video_generate)"));
        assert!(merged.contains("lime media video generate --json"));
        assert!(merged.contains("不要伪造“视频已生成完成”"));
        assert!(merged.contains("当前任务已经显式进入视频技能主链"));
    }

    #[test]
    fn test_merge_system_prompt_with_transcription_skill_launch_appends_prompt() {
        let metadata = serde_json::json!({
            "harness": {
                "allow_model_skills": true,
                "transcription_skill_launch": {
                    "skill_name": "transcription_generate",
                    "kind": "transcription_task",
                    "transcription_task": {
                        "prompt": "生成逐字稿",
                        "raw_text": "@转写 https://example.com/interview.mp4 生成逐字稿 导出 srt",
                        "source_url": "https://example.com/interview.mp4",
                        "output_format": "srt",
                        "timestamps": true,
                        "speaker_labels": true
                    }
                }
            }
        });

        let merged = merge_system_prompt_with_transcription_skill_launch(
            Some("你是助手".to_string()),
            Some(&metadata),
        )
        .expect("should contain merged prompt");

        assert!(merged.contains("<<LIME_TRANSCRIPTION_SKILL_LAUNCH_HINT>>"));
        assert!(merged.contains("第一优先工具调用必须是 Skill"));
        assert!(merged.contains("skill=\"transcription_generate\""));
        assert!(merged.contains("Skill.args 的 JSON"));
        assert!(merged.contains("第一工具调用示例(Skill 参数 JSON)"));
        assert!(merged.contains("\"transcription_task\":"));
        assert!(merged.contains("不要为了确认技能名、工具名或命令名再去调用 ToolSearch"));
        assert!(merged.contains("不要先走 ToolSearch / WebSearch / Read / Glob / Grep"));
        assert!(merged.contains("应立即改为直调 Skill(transcription_generate)"));
        assert!(merged.contains("不要伪造“转写已完成”"));
        assert!(merged.contains("当前任务已经显式进入转写技能主链"));
    }

    #[test]
    fn test_merge_system_prompt_with_broadcast_skill_launch_appends_prompt() {
        let metadata = serde_json::json!({
            "harness": {
                "allow_model_skills": true,
                "broadcast_skill_launch": {
                    "skill_name": "broadcast_generate",
                    "kind": "broadcast_task",
                    "broadcast_task": {
                        "prompt": "整理成 5 分钟创始人口播",
                        "raw_text": "@播报 标题: 创始人周报 听众: 创业者 语气: 口语化 时长: 5分钟 把下面文章整理成播报文本",
                        "content": "今天我们重点讨论 AI Agent 产品化的三个观察。",
                        "title": "创始人周报",
                        "audience": "创业者",
                        "tone": "口语化",
                        "duration_hint_minutes": 5
                    }
                }
            }
        });

        let merged = merge_system_prompt_with_broadcast_skill_launch(
            Some("你是助手".to_string()),
            Some(&metadata),
        )
        .expect("should contain merged prompt");

        assert!(merged.contains("<<LIME_BROADCAST_SKILL_LAUNCH_HINT>>"));
        assert!(merged.contains("第一优先工具调用必须是 Skill"));
        assert!(merged.contains("skill=\"broadcast_generate\""));
        assert!(merged.contains("Skill.args 的 JSON"));
        assert!(merged.contains("第一工具调用示例(Skill 参数 JSON)"));
        assert!(merged.contains("\"broadcast_task\":"));
        assert!(merged.contains("不要为了确认技能名、工具名或命令名再去调用 ToolSearch"));
        assert!(merged.contains("不要先走 ToolSearch / WebSearch / Read / Glob / Grep"));
        assert!(merged.contains("应立即改为直调 Skill(broadcast_generate)"));
        assert!(merged.contains("lime task create broadcast --json"));
        assert!(merged.contains("不要伪造“播报已完成”"));
        assert!(merged.contains("当前任务已经显式进入播报技能主链"));
    }

    #[test]
    fn test_merge_system_prompt_with_resource_search_skill_launch_appends_prompt() {
        let metadata = serde_json::json!({
            "harness": {
                "allow_model_skills": true,
                "resource_search_skill_launch": {
                    "skill_name": "modal_resource_search",
                    "kind": "resource_search_task",
                    "resource_search_task": {
                        "prompt": "咖啡馆木桌背景 公众号头图",
                        "raw_text": "@素材 类型:图片 关键词:咖啡馆木桌背景 用途:公众号头图 数量:8",
                        "resource_type": "image",
                        "query": "咖啡馆木桌背景",
                        "usage": "公众号头图",
                        "count": 8
                    }
                }
            }
        });

        let merged = merge_system_prompt_with_resource_search_skill_launch(
            Some("你是助手".to_string()),
            Some(&metadata),
        )
        .expect("should contain merged prompt");

        assert!(merged.contains("<<LIME_RESOURCE_SEARCH_SKILL_LAUNCH_HINT>>"));
        assert!(merged.contains("第一优先工具调用必须是 Skill"));
        assert!(merged.contains("skill=\"modal_resource_search\""));
        assert!(merged.contains("Skill.args 的 JSON"));
        assert!(merged.contains("第一工具调用示例(Skill 参数 JSON)"));
        assert!(merged.contains("\"resource_search_task\":"));
        assert!(merged.contains("lime_search_web_images"));
        assert!(merged.contains("不要为了确认技能名、工具名或命令名再去调用 ToolSearch"));
        assert!(merged.contains("不要先走 ToolSearch / WebSearch / Read / Glob / Grep"));
        assert!(merged.contains("应立即改为直调 Skill(modal_resource_search)"));
        assert!(merged.contains("当前任务已经显式进入素材检索技能主链"));
    }

    #[test]
    fn test_merge_system_prompt_with_research_skill_launch_appends_prompt() {
        let metadata = serde_json::json!({
            "harness": {
                "allow_model_skills": true,
                "research_skill_launch": {
                    "skill_name": "research",
                    "kind": "research_request",
                    "research_request": {
                        "prompt": "AI Agent 融资 36Kr 近30天 融资额与产品发布",
                        "raw_text": "@搜索 关键词:AI Agent 融资 站点:36Kr 时间:近30天 深度:深度 重点:融资额与产品发布 输出:要点",
                        "query": "AI Agent 融资",
                        "site": "36Kr",
                        "time_range": "近30天",
                        "depth": "deep",
                        "focus": "融资额与产品发布",
                        "output_format": "要点"
                    }
                }
            }
        });

        let merged = merge_system_prompt_with_research_skill_launch(
            Some("你是助手".to_string()),
            Some(&metadata),
        )
        .expect("should contain merged prompt");

        assert!(merged.contains("<<LIME_RESEARCH_SKILL_LAUNCH_HINT>>"));
        assert!(merged.contains("第一优先工具调用必须是 Skill"));
        assert!(merged.contains("skill=\"research\""));
        assert!(merged.contains("Skill.args 的 JSON"));
        assert!(merged.contains("第一工具调用示例(Skill 参数 JSON)"));
        assert!(merged.contains("\"research_request\":"));
        assert!(merged.contains("不要为了确认技能名、工具名或命令名再去调用 ToolSearch"));
        assert!(merged.contains("不要先走 ToolSearch / Read / Glob / Grep"));
        assert!(merged.contains("应立即改为直调 Skill(research)"));
        assert!(merged.contains("research skill 内部必须真正执行联网检索"));
        assert!(merged.contains("当前任务已经显式进入搜索技能主链"));
    }

    #[test]
    fn test_merge_system_prompt_with_deep_search_skill_launch_appends_prompt() {
        let metadata = serde_json::json!({
            "harness": {
                "allow_model_skills": true,
                "deep_search_skill_launch": {
                    "skill_name": "research",
                    "kind": "deep_search_request",
                    "deep_search_request": {
                        "prompt": "AI Agent 融资 36Kr 近30天 融资额与产品发布",
                        "raw_text": "@深搜 关键词:AI Agent 融资 站点:36Kr 时间:近30天 重点:融资额与产品发布 输出:对比表",
                        "query": "AI Agent 融资",
                        "site": "36Kr",
                        "time_range": "近30天",
                        "depth": "deep",
                        "focus": "融资额与产品发布",
                        "output_format": "对比表"
                    }
                }
            }
        });

        let merged = merge_system_prompt_with_deep_search_skill_launch(
            Some("你是助手".to_string()),
            Some(&metadata),
        )
        .expect("should contain merged prompt");

        assert!(merged.contains("<<LIME_DEEP_SEARCH_SKILL_LAUNCH_HINT>>"));
        assert!(merged.contains("第一优先工具调用必须是 Skill"));
        assert!(merged.contains("skill=\"research\""));
        assert!(merged.contains("Skill.args 的 JSON"));
        assert!(merged.contains("第一工具调用示例(Skill 参数 JSON)"));
        assert!(merged.contains("\"deep_search_request\":"));
        assert!(merged.contains("不要为了确认技能名、工具名或命令名再去调用 ToolSearch"));
        assert!(merged.contains("不要先走 ToolSearch / Read / Glob / Grep"));
        assert!(merged.contains("应立即改为直调 Skill(research)"));
        assert!(merged.contains("深搜至少执行 2 轮以上扩搜"));
        assert!(merged.contains("已确认事实"));
        assert!(merged.contains("当前任务已经显式进入深搜技能主链"));
    }

    #[test]
    fn test_merge_system_prompt_with_report_skill_launch_appends_prompt() {
        let metadata = serde_json::json!({
            "harness": {
                "allow_model_skills": true,
                "report_skill_launch": {
                    "skill_name": "report_generate",
                    "kind": "report_request",
                    "report_request": {
                        "prompt": "AI Agent 融资 36Kr 近30天 融资额与代表产品 投资人研报",
                        "raw_text": "@研报 关键词:AI Agent 融资 站点:36Kr 时间:近30天 重点:融资额与代表产品 输出:投资人研报",
                        "query": "AI Agent 融资",
                        "site": "36Kr",
                        "time_range": "近30天",
                        "depth": "deep",
                        "focus": "融资额与代表产品",
                        "output_format": "投资人研报"
                    }
                }
            }
        });

        let merged = merge_system_prompt_with_report_skill_launch(
            Some("你是助手".to_string()),
            Some(&metadata),
        )
        .expect("should contain merged prompt");

        assert!(merged.contains("<<LIME_REPORT_SKILL_LAUNCH_HINT>>"));
        assert!(merged.contains("第一优先工具调用必须是 Skill"));
        assert!(merged.contains("skill=\"report_generate\""));
        assert!(merged.contains("Skill.args 的 JSON"));
        assert!(merged.contains("第一工具调用示例(Skill 参数 JSON)"));
        assert!(merged.contains("\"report_request\":"));
        assert!(merged.contains("不要为了确认技能名、工具名或命令名再去调用 ToolSearch"));
        assert!(merged.contains("不要先走 ToolSearch / Read / Glob / Grep"));
        assert!(merged.contains("应立即改为直调 Skill(report_generate)"));
        assert!(merged.contains("report_generate skill 内部必须先执行真实联网检索"));
        assert!(merged.contains("核心结论、关键证据、风险/待确认项与建议动作"));
        assert!(merged.contains("当前任务已经显式进入研报技能主链"));
    }

    #[test]
    fn test_merge_system_prompt_with_site_search_skill_launch_appends_prompt() {
        let metadata = serde_json::json!({
            "harness": {
                "allow_model_skills": true,
                "site_search_skill_launch": {
                    "skill_name": "site_search",
                    "kind": "site_search_request",
                    "site_search_request": {
                        "prompt": "openai agents sdk issue",
                        "raw_text": "@站点搜索 站点:GitHub 关键词:openai agents sdk issue 数量:8",
                        "site": "GitHub",
                        "query": "openai agents sdk issue",
                        "limit": 8
                    }
                }
            }
        });

        let merged = merge_system_prompt_with_site_search_skill_launch(
            Some("你是助手".to_string()),
            Some(&metadata),
        )
        .expect("should contain merged prompt");

        assert!(merged.contains("<<LIME_SITE_SEARCH_SKILL_LAUNCH_HINT>>"));
        assert!(merged.contains("第一优先工具调用必须是 Skill"));
        assert!(merged.contains("skill=\"site_search\""));
        assert!(merged.contains("Skill.args 的 JSON"));
        assert!(merged.contains("第一工具调用示例(Skill 参数 JSON)"));
        assert!(merged.contains("\"site_search_request\":"));
        assert!(merged.contains("不要为了确认技能名、工具名或命令名再去调用 ToolSearch"));
        assert!(merged.contains("不要先走 ToolSearch / WebSearch / Read / Glob / Grep"));
        assert!(merged.contains("应立即改为直调 Skill(site_search)"));
        assert!(merged.contains("不要先改用 WebSearch、research"));
        assert!(merged.contains("当前任务已经显式进入站点搜索技能主链"));
    }

    #[test]
    fn test_merge_system_prompt_with_pdf_read_skill_launch_appends_prompt() {
        let metadata = serde_json::json!({
            "harness": {
                "allow_model_skills": true,
                "pdf_read_skill_launch": {
                    "skill_name": "pdf_read",
                    "kind": "pdf_read_request",
                    "pdf_read_request": {
                        "prompt": "提炼三点结论并标注关键证据",
                        "raw_text": "@读PDF /tmp/agent-report.pdf 提炼三点结论并标注关键证据",
                        "source_path": "/tmp/agent-report.pdf",
                        "focus": "融资数据",
                        "output_format": "投资人摘要"
                    }
                }
            }
        });

        let merged = merge_system_prompt_with_pdf_read_skill_launch(
            Some("你是助手".to_string()),
            Some(&metadata),
        )
        .expect("should contain merged prompt");

        assert!(merged.contains("<<LIME_PDF_READ_SKILL_LAUNCH_HINT>>"));
        assert!(merged.contains("第一优先工具调用必须是 Skill"));
        assert!(merged.contains("skill=\"pdf_read\""));
        assert!(merged.contains("Skill.args 的 JSON"));
        assert!(merged.contains("第一工具调用示例(Skill 参数 JSON)"));
        assert!(merged.contains("\"pdf_read_request\":"));
        assert!(merged.contains("不要为了确认技能名、工具名或命令名再去调用 ToolSearch"));
        assert!(merged.contains("不要先走 ToolSearch / WebSearch / Grep"));
        assert!(merged.contains("应立即改为直调 Skill(pdf_read)"));
        assert!(merged.contains("list_directory / read_file"));
        assert!(merged.contains("当前任务已经显式提供 PDF 路径"));
    }

    #[test]
    fn test_merge_system_prompt_with_summary_skill_launch_appends_prompt() {
        let metadata = serde_json::json!({
            "harness": {
                "allow_model_skills": true,
                "summary_skill_launch": {
                    "skill_name": "summary",
                    "kind": "summary_request",
                    "summary_request": {
                        "prompt": "请总结这篇长文的三点要点",
                        "raw_text": "@总结 内容:这是一篇关于 AI Agent 融资的长文 重点:融资额与发布时间 长度:简短 风格:投资人简报 输出:三点要点",
                        "content": "这是一篇关于 AI Agent 融资的长文",
                        "focus": "融资额与发布时间",
                        "length": "short",
                        "style": "投资人简报",
                        "output_format": "三点要点"
                    }
                }
            }
        });

        let merged = merge_system_prompt_with_summary_skill_launch(
            Some("你是助手".to_string()),
            Some(&metadata),
        )
        .expect("should contain merged prompt");

        assert!(merged.contains("<<LIME_SUMMARY_SKILL_LAUNCH_HINT>>"));
        assert!(merged.contains("第一优先工具调用必须是 Skill"));
        assert!(merged.contains("Skill.args 的 JSON"));
        assert!(merged.contains("第一工具调用示例(Skill 参数 JSON)"));
        assert!(merged.contains("skill=\"summary\""));
        assert!(merged.contains("\"summary_request\":"));
        assert!(merged.contains("不要为了确认技能名、工具名或命令名再去调用 ToolSearch"));
        assert!(merged.contains("不要先走 ToolSearch / WebSearch / Grep"));
        assert!(merged.contains("应立即改为直调 Skill(summary)"));
        assert!(merged.contains("Read / Glob"));
        assert!(merged.contains("结果必须忠于原文"));
        assert!(merged.contains("当前任务已经显式进入总结技能主链"));
    }

    #[test]
    fn test_merge_system_prompt_with_translation_skill_launch_appends_prompt() {
        let metadata = serde_json::json!({
            "harness": {
                "allow_model_skills": true,
                "translation_skill_launch": {
                    "skill_name": "translation",
                    "kind": "translation_request",
                    "translation_request": {
                        "prompt": "将 hello world 翻译成中文",
                        "raw_text": "@翻译 内容:hello world 原语言:英语 目标语言:中文 风格:产品文案 输出:只输出译文",
                        "content": "hello world",
                        "source_language": "英语",
                        "target_language": "中文",
                        "style": "产品文案",
                        "output_format": "只输出译文"
                    }
                }
            }
        });

        let merged = merge_system_prompt_with_translation_skill_launch(
            Some("你是助手".to_string()),
            Some(&metadata),
        )
        .expect("should contain merged prompt");

        assert!(merged.contains("<<LIME_TRANSLATION_SKILL_LAUNCH_HINT>>"));
        assert!(merged.contains("第一优先工具调用必须是 Skill"));
        assert!(merged.contains("Skill.args 的 JSON"));
        assert!(merged.contains("第一工具调用示例(Skill 参数 JSON)"));
        assert!(merged.contains("skill=\"translation\""));
        assert!(merged.contains("\"translation_request\":"));
        assert!(merged.contains("不要为了确认技能名、工具名或命令名再去调用 ToolSearch"));
        assert!(merged.contains("不要先走 ToolSearch / WebSearch / Grep"));
        assert!(merged.contains("应立即改为直调 Skill(translation)"));
        assert!(merged.contains("Read / Glob"));
        assert!(merged.contains("译文必须忠于原文"));
        assert!(merged.contains("当前任务已经显式进入翻译技能主链"));
    }

    #[test]
    fn test_merge_system_prompt_with_analysis_skill_launch_appends_prompt() {
        let metadata = serde_json::json!({
            "harness": {
                "allow_model_skills": true,
                "analysis_skill_launch": {
                    "skill_name": "analysis",
                    "kind": "analysis_request",
                    "analysis_request": {
                        "prompt": "判断 OpenAI 新模型发布的商业影响",
                        "raw_text": "@分析 内容:OpenAI 发布新模型 重点:商业影响 风格:投资备忘 输出:三点判断",
                        "content": "OpenAI 发布新模型",
                        "focus": "商业影响",
                        "style": "投资备忘",
                        "output_format": "三点判断"
                    }
                }
            }
        });

        let merged = merge_system_prompt_with_analysis_skill_launch(
            Some("你是助手".to_string()),
            Some(&metadata),
        )
        .expect("should contain merged prompt");

        assert!(merged.contains("<<LIME_ANALYSIS_SKILL_LAUNCH_HINT>>"));
        assert!(merged.contains("第一优先工具调用必须是 Skill"));
        assert!(merged.contains("Skill.args 的 JSON"));
        assert!(merged.contains("第一工具调用示例(Skill 参数 JSON)"));
        assert!(merged.contains("skill=\"analysis\""));
        assert!(merged.contains("\"analysis_request\":"));
        assert!(merged.contains("不要为了确认技能名、工具名或命令名再去调用 ToolSearch"));
        assert!(merged.contains("不要先走 ToolSearch / WebSearch / Grep"));
        assert!(merged.contains("应立即改为直调 Skill(analysis)"));
        assert!(merged.contains("Read / Glob"));
        assert!(merged.contains("分析结果必须区分原文事实、你的判断与待确认项"));
        assert!(merged.contains("当前任务已经显式进入分析技能主链"));
    }

    #[test]
    fn test_prepare_broadcast_skill_launch_request_metadata_sets_workbench_chat_mode() {
        let metadata = serde_json::json!({
            "harness": {
                "broadcast_skill_launch": {
                    "skill_name": "broadcast_generate",
                    "kind": "broadcast_task",
                    "broadcast_task": {
                        "content": "待整理原文"
                    }
                }
            }
        });

        let prepared = prepare_broadcast_skill_launch_request_metadata(Some(&metadata))
            .expect("prepared metadata");

        let harness = prepared
            .get("harness")
            .and_then(serde_json::Value::as_object)
            .expect("harness");
        assert_eq!(
            harness.get("chat_mode").and_then(serde_json::Value::as_str),
            Some("workbench")
        );
    }

    #[test]
    fn test_prepare_resource_search_skill_launch_request_metadata_sets_workbench_chat_mode() {
        let metadata = serde_json::json!({
            "harness": {
                "resource_search_skill_launch": {
                    "skill_name": "modal_resource_search",
                    "kind": "resource_search_task",
                    "resource_search_task": {
                        "resource_type": "image",
                        "query": "咖啡馆木桌背景"
                    }
                }
            }
        });

        let prepared = prepare_resource_search_skill_launch_request_metadata(Some(&metadata))
            .expect("prepared metadata");

        let harness = prepared
            .get("harness")
            .and_then(serde_json::Value::as_object)
            .expect("harness");
        assert_eq!(
            harness.get("chat_mode").and_then(serde_json::Value::as_str),
            Some("workbench")
        );
    }

    #[test]
    fn test_prepare_site_search_skill_launch_request_metadata_sets_workbench_chat_mode() {
        let metadata = serde_json::json!({
            "harness": {
                "site_search_skill_launch": {
                    "skill_name": "site_search",
                    "kind": "site_search_request",
                    "site_search_request": {
                        "site": "GitHub",
                        "query": "openai agents sdk issue"
                    }
                }
            }
        });

        let prepared = prepare_site_search_skill_launch_request_metadata(Some(&metadata))
            .expect("prepared metadata");

        let harness = prepared
            .get("harness")
            .and_then(serde_json::Value::as_object)
            .expect("harness");
        assert_eq!(
            harness.get("chat_mode").and_then(serde_json::Value::as_str),
            Some("workbench")
        );
    }

    #[test]
    fn test_prepare_pdf_read_skill_launch_request_metadata_sets_workbench_chat_mode() {
        let metadata = serde_json::json!({
            "harness": {
                "pdf_read_skill_launch": {
                    "skill_name": "pdf_read",
                    "kind": "pdf_read_request",
                    "pdf_read_request": {
                        "source_path": "/tmp/agent-report.pdf"
                    }
                }
            }
        });

        let prepared = prepare_pdf_read_skill_launch_request_metadata(Some(&metadata))
            .expect("prepared metadata");

        let harness = prepared
            .get("harness")
            .and_then(serde_json::Value::as_object)
            .expect("harness");
        assert_eq!(
            harness.get("chat_mode").and_then(serde_json::Value::as_str),
            Some("workbench")
        );
    }

    #[test]
    fn test_prepare_research_skill_launch_request_metadata_sets_workbench_chat_mode() {
        let metadata = serde_json::json!({
            "harness": {
                "research_skill_launch": {
                    "skill_name": "research",
                    "kind": "research_request",
                    "research_request": {
                        "query": "AI Agent 融资"
                    }
                }
            }
        });

        let prepared = prepare_research_skill_launch_request_metadata(Some(&metadata))
            .expect("prepared metadata");

        let harness = prepared
            .get("harness")
            .and_then(serde_json::Value::as_object)
            .expect("harness");
        assert_eq!(
            harness.get("chat_mode").and_then(serde_json::Value::as_str),
            Some("workbench")
        );
    }

    #[test]
    fn test_prepare_deep_search_skill_launch_request_metadata_sets_workbench_chat_mode() {
        let metadata = serde_json::json!({
            "harness": {
                "deep_search_skill_launch": {
                    "skill_name": "research",
                    "kind": "deep_search_request",
                    "deep_search_request": {
                        "query": "AI Agent 融资"
                    }
                }
            }
        });

        let prepared = prepare_deep_search_skill_launch_request_metadata(Some(&metadata))
            .expect("prepared metadata");

        let harness = prepared
            .get("harness")
            .and_then(serde_json::Value::as_object)
            .expect("harness");
        assert_eq!(
            harness.get("chat_mode").and_then(serde_json::Value::as_str),
            Some("workbench")
        );
    }

    #[test]
    fn test_prepare_report_skill_launch_request_metadata_sets_workbench_chat_mode() {
        let metadata = serde_json::json!({
            "harness": {
                "report_skill_launch": {
                    "skill_name": "report_generate",
                    "kind": "report_request",
                    "report_request": {
                        "query": "AI Agent 融资"
                    }
                }
            }
        });

        let prepared = prepare_report_skill_launch_request_metadata(Some(&metadata))
            .expect("prepared metadata");

        let harness = prepared
            .get("harness")
            .and_then(serde_json::Value::as_object)
            .expect("harness");
        assert_eq!(
            harness.get("chat_mode").and_then(serde_json::Value::as_str),
            Some("workbench")
        );
    }

    #[test]
    fn test_prepare_summary_skill_launch_request_metadata_sets_workbench_chat_mode() {
        let metadata = serde_json::json!({
            "harness": {
                "summary_skill_launch": {
                    "skill_name": "summary",
                    "kind": "summary_request",
                    "summary_request": {
                        "prompt": "请总结当前对话"
                    }
                }
            }
        });

        let prepared = prepare_summary_skill_launch_request_metadata(Some(&metadata))
            .expect("prepared metadata");

        let harness = prepared
            .get("harness")
            .and_then(serde_json::Value::as_object)
            .expect("harness");
        assert_eq!(
            harness.get("chat_mode").and_then(serde_json::Value::as_str),
            Some("workbench")
        );
    }

    #[test]
    fn test_prepare_translation_skill_launch_request_metadata_sets_workbench_chat_mode() {
        let metadata = serde_json::json!({
            "harness": {
                "translation_skill_launch": {
                    "skill_name": "translation",
                    "kind": "translation_request",
                    "translation_request": {
                        "prompt": "请把当前对话翻译成英文"
                    }
                }
            }
        });

        let prepared = prepare_translation_skill_launch_request_metadata(Some(&metadata))
            .expect("prepared metadata");

        let harness = prepared
            .get("harness")
            .and_then(serde_json::Value::as_object)
            .expect("harness");
        assert_eq!(
            harness.get("chat_mode").and_then(serde_json::Value::as_str),
            Some("workbench")
        );
    }

    #[test]
    fn test_prepare_analysis_skill_launch_request_metadata_sets_workbench_chat_mode() {
        let metadata = serde_json::json!({
            "harness": {
                "analysis_skill_launch": {
                    "skill_name": "analysis",
                    "kind": "analysis_request",
                    "analysis_request": {
                        "prompt": "请分析当前对话"
                    }
                }
            }
        });

        let prepared = prepare_analysis_skill_launch_request_metadata(Some(&metadata))
            .expect("prepared metadata");

        let harness = prepared
            .get("harness")
            .and_then(serde_json::Value::as_object)
            .expect("harness");
        assert_eq!(
            harness.get("chat_mode").and_then(serde_json::Value::as_str),
            Some("workbench")
        );
    }

    #[test]
    fn test_merge_system_prompt_with_url_parse_skill_launch_appends_prompt() {
        let metadata = serde_json::json!({
            "harness": {
                "allow_model_skills": true,
                "url_parse_skill_launch": {
                    "skill_name": "url_parse",
                    "kind": "url_parse_task",
                    "url_parse_task": {
                        "prompt": "整理成投资人可读摘要",
                        "raw_text": "@链接解析 https://example.com/agent 提取要点 并整理成投资人可读摘要",
                        "url": "https://example.com/agent",
                        "extract_goal": "key_points"
                    }
                }
            }
        });

        let merged = merge_system_prompt_with_url_parse_skill_launch(
            Some("你是助手".to_string()),
            Some(&metadata),
        )
        .expect("should contain merged prompt");

        assert!(merged.contains("<<LIME_URL_PARSE_SKILL_LAUNCH_HINT>>"));
        assert!(merged.contains("第一优先工具调用必须是 Skill"));
        assert!(merged.contains("skill=\"url_parse\""));
        assert!(merged.contains("Skill.args 的 JSON"));
        assert!(merged.contains("第一工具调用示例(Skill 参数 JSON)"));
        assert!(merged.contains("\"url_parse_task\":"));
        assert!(merged.contains("不要为了确认技能名、工具名或命令名再去调用 ToolSearch"));
        assert!(merged.contains("不要先走 ToolSearch / WebSearch / Read / Glob / Grep"));
        assert!(merged.contains("应立即改为直调 Skill(url_parse)"));
        assert!(merged.contains("extractStatus 设为 pending_extract"));
        assert!(merged.contains("当前任务已经显式进入链接解析技能主链"));
    }

    #[test]
    fn test_merge_system_prompt_with_typesetting_skill_launch_appends_prompt() {
        let metadata = serde_json::json!({
            "harness": {
                "allow_model_skills": true,
                "typesetting_skill_launch": {
                    "skill_name": "typesetting",
                    "kind": "typesetting_task",
                    "typesetting_task": {
                        "prompt": "整理成更适合小红书阅读的短句节奏",
                        "raw_text": "@排版 平台:小红书 帮我把下面文案整理成短句节奏",
                        "content": "平台:小红书 帮我把下面文案整理成短句节奏",
                        "target_platform": "小红书"
                    }
                }
            }
        });

        let merged = merge_system_prompt_with_typesetting_skill_launch(
            Some("你是助手".to_string()),
            Some(&metadata),
        )
        .expect("should contain merged prompt");

        assert!(merged.contains("<<LIME_TYPESETTING_SKILL_LAUNCH_HINT>>"));
        assert!(merged.contains("第一优先工具调用必须是 Skill"));
        assert!(merged.contains("skill=\"typesetting\""));
        assert!(merged.contains("Skill.args 的 JSON"));
        assert!(merged.contains("第一工具调用示例(Skill 参数 JSON)"));
        assert!(merged.contains("\"typesetting_task\":"));
        assert!(merged.contains("不要为了确认技能名、工具名或命令名再去调用 ToolSearch"));
        assert!(merged.contains("不要先走 ToolSearch / WebSearch / Read / Glob / Grep"));
        assert!(merged.contains("应立即改为直调 Skill(typesetting)"));
        assert!(merged.contains("不要伪造“排版已完成”"));
        assert!(merged.contains("当前任务已经显式进入排版技能主链"));
    }

    #[test]
    fn test_prepare_typesetting_skill_launch_request_metadata_sets_workbench_chat_mode() {
        let metadata = serde_json::json!({
            "harness": {
                "typesetting_skill_launch": {
                    "skill_name": "typesetting",
                    "kind": "typesetting_task",
                    "typesetting_task": {
                        "content": "待排版正文"
                    }
                }
            }
        });

        let prepared = prepare_typesetting_skill_launch_request_metadata(Some(&metadata))
            .expect("prepared metadata");

        let harness = prepared
            .get("harness")
            .and_then(serde_json::Value::as_object)
            .expect("harness");
        assert_eq!(
            harness.get("chat_mode").and_then(serde_json::Value::as_str),
            Some("workbench")
        );
    }

    #[test]
    fn test_merge_system_prompt_with_presentation_skill_launch_appends_prompt() {
        let metadata = serde_json::json!({
            "harness": {
                "allow_model_skills": true,
                "presentation_skill_launch": {
                    "skill_name": "presentation_generate",
                    "kind": "presentation_request",
                    "presentation_request": {
                        "prompt": "帮我做一个 AI 助手创业项目融资演示稿",
                        "raw_text": "@PPT 类型:路演PPT 风格:极简科技 受众:投资人 页数:10 帮我做一个 AI 助手创业项目融资演示稿",
                        "content": "类型:路演PPT 风格:极简科技 受众:投资人 页数:10 帮我做一个 AI 助手创业项目融资演示稿",
                        "deck_type": "pitch_deck",
                        "style": "极简科技",
                        "audience": "投资人",
                        "slide_count": 10
                    }
                }
            }
        });

        let merged = merge_system_prompt_with_presentation_skill_launch(
            Some("你是助手".to_string()),
            Some(&metadata),
        )
        .expect("should contain merged prompt");

        assert!(merged.contains("<<LIME_PRESENTATION_SKILL_LAUNCH_HINT>>"));
        assert!(merged.contains("第一优先工具调用必须是 Skill"));
        assert!(merged.contains("skill=\"presentation_generate\""));
        assert!(merged.contains("Skill.args 的 JSON"));
        assert!(merged.contains("第一工具调用示例(Skill 参数 JSON)"));
        assert!(merged.contains("\"presentation_request\":"));
        assert!(merged.contains("不要为了确认技能名、工具名或命令名再去调用 ToolSearch"));
        assert!(merged.contains("不要先走 ToolSearch / WebSearch / Read / Glob / Grep"));
        assert!(merged.contains("应立即改为直调 Skill(presentation_generate)"));
        assert!(merged.contains("必须产出一个可预览、可继续导出的单文件演示稿"));
        assert!(merged.contains("当前任务已经显式进入演示稿生成技能主链"));
    }

    #[test]
    fn test_prepare_presentation_skill_launch_request_metadata_sets_workbench_chat_mode() {
        let metadata = serde_json::json!({
            "harness": {
                "presentation_skill_launch": {
                    "skill_name": "presentation_generate",
                    "kind": "presentation_request",
                    "presentation_request": {
                        "prompt": "帮我做一版融资路演演示稿"
                    }
                }
            }
        });

        let prepared = prepare_presentation_skill_launch_request_metadata(Some(&metadata))
            .expect("prepared metadata");

        let harness = prepared
            .get("harness")
            .and_then(serde_json::Value::as_object)
            .expect("harness");
        assert_eq!(
            harness.get("chat_mode").and_then(serde_json::Value::as_str),
            Some("workbench")
        );
    }

    #[test]
    fn test_merge_system_prompt_with_webpage_skill_launch_appends_prompt() {
        let metadata = serde_json::json!({
            "harness": {
                "allow_model_skills": true,
                "webpage_skill_launch": {
                    "skill_name": "webpage_generate",
                    "kind": "webpage_request",
                    "webpage_request": {
                        "prompt": "帮我做一个 AI 代码助手官网",
                        "raw_text": "@网页 类型:落地页 风格:未来感 帮我做一个 AI 代码助手官网",
                        "content": "类型:落地页 风格:未来感 帮我做一个 AI 代码助手官网",
                        "page_type": "landing_page",
                        "style": "未来感",
                        "tech_stack": "原生 HTML"
                    }
                }
            }
        });

        let merged = merge_system_prompt_with_webpage_skill_launch(
            Some("你是助手".to_string()),
            Some(&metadata),
        )
        .expect("should contain merged prompt");

        assert!(merged.contains("<<LIME_WEBPAGE_SKILL_LAUNCH_HINT>>"));
        assert!(merged.contains("第一优先工具调用必须是 Skill"));
        assert!(merged.contains("skill=\"webpage_generate\""));
        assert!(merged.contains("Skill.args 的 JSON"));
        assert!(merged.contains("第一工具调用示例(Skill 参数 JSON)"));
        assert!(merged.contains("\"webpage_request\":"));
        assert!(merged.contains("不要为了确认技能名、工具名或命令名再去调用 ToolSearch"));
        assert!(merged.contains("不要先走 ToolSearch / WebSearch / Read / Glob / Grep"));
        assert!(merged.contains("应立即改为直调 Skill(webpage_generate)"));
        assert!(merged.contains("必须产出一个可预览的单文件 HTML"));
        assert!(merged.contains("当前任务已经显式进入网页生成技能主链"));
    }

    #[test]
    fn test_merge_system_prompt_with_form_skill_launch_appends_prompt() {
        let metadata = serde_json::json!({
            "harness": {
                "allow_model_skills": true,
                "form_skill_launch": {
                    "skill_name": "form_generate",
                    "kind": "form_request",
                    "form_request": {
                        "prompt": "帮我做一个 AI Workshop 报名表",
                        "raw_text": "@表单 类型:报名表单 风格:简洁专业 受众:活动嘉宾 字段数:8 帮我做一个 AI Workshop 报名表",
                        "content": "类型:报名表单 风格:简洁专业 受众:活动嘉宾 字段数:8 帮我做一个 AI Workshop 报名表",
                        "form_type": "registration_form",
                        "style": "简洁专业",
                        "audience": "活动嘉宾",
                        "field_count": 8
                    }
                }
            }
        });

        let merged = merge_system_prompt_with_form_skill_launch(
            Some("你是助手".to_string()),
            Some(&metadata),
        )
        .expect("should contain merged prompt");

        assert!(merged.contains("<<LIME_FORM_SKILL_LAUNCH_HINT>>"));
        assert!(merged.contains("第一优先工具调用必须是 Skill"));
        assert!(merged.contains("skill=\"form_generate\""));
        assert!(merged.contains("Skill.args 的 JSON"));
        assert!(merged.contains("第一工具调用示例(Skill 参数 JSON)"));
        assert!(merged.contains("\"form_request\":"));
        assert!(merged.contains("不要为了确认技能名、工具名或命令名再去调用 ToolSearch"));
        assert!(merged.contains("不要先走 ToolSearch / WebSearch / Read / Glob / Grep"));
        assert!(merged.contains("目标是复用 Lime 现有 A2UI 协议输出一份真实可渲染的表单"));
        assert!(merged.contains("最终结果必须输出一个 ```a2ui 代码块"));
        assert!(merged
            .contains("字段类型只允许使用 simple form 已支持的 choice / text / slider / checkbox"));
    }

    #[test]
    fn test_prepare_form_skill_launch_request_metadata_sets_workbench_chat_mode() {
        let metadata = serde_json::json!({
            "harness": {
                "form_skill_launch": {
                    "skill_name": "form_generate",
                    "kind": "form_request",
                    "form_request": {
                        "prompt": "帮我做一个活动报名表"
                    }
                }
            }
        });

        let prepared =
            prepare_form_skill_launch_request_metadata(Some(&metadata)).expect("prepared metadata");

        let harness = prepared
            .get("harness")
            .and_then(serde_json::Value::as_object)
            .expect("harness");
        assert_eq!(
            harness.get("chat_mode").and_then(serde_json::Value::as_str),
            Some("workbench")
        );
    }

    #[test]
    fn test_prepare_webpage_skill_launch_request_metadata_sets_workbench_chat_mode() {
        let metadata = serde_json::json!({
            "harness": {
                "webpage_skill_launch": {
                    "skill_name": "webpage_generate",
                    "kind": "webpage_request",
                    "webpage_request": {
                        "prompt": "帮我做一个产品落地页"
                    }
                }
            }
        });

        let prepared = prepare_webpage_skill_launch_request_metadata(Some(&metadata))
            .expect("prepared metadata");

        let harness = prepared
            .get("harness")
            .and_then(serde_json::Value::as_object)
            .expect("harness");
        assert_eq!(
            harness.get("chat_mode").and_then(serde_json::Value::as_str),
            Some("workbench")
        );
    }

    #[test]
    fn test_prepare_image_skill_launch_request_metadata_materializes_input_refs() {
        let temp_dir = TempDir::new().expect("temp dir");
        let metadata = serde_json::json!({
            "harness": {
                "image_skill_launch": {
                    "skill_name": "image_generate",
                    "kind": "image_task",
                    "image_task": {
                        "prompt": "青柠主视觉",
                        "reference_images": ["skill-input-image://1"],
                        "skill_input_images": [
                            {
                                "ref": "skill-input-image://1",
                                "media_type": "image/png",
                                "source": "attachment"
                            }
                        ]
                    }
                }
            }
        });
        let images = [ImageInput {
            data: STANDARD.encode("hello-image"),
            media_type: "image/png".to_string(),
        }];

        let prepared = prepare_image_skill_launch_request_metadata(
            temp_dir.path(),
            "session-image",
            "turn-image",
            Some(&metadata),
            Some(&images),
        )
        .expect("prepared metadata");

        let harness = prepared
            .get("harness")
            .and_then(serde_json::Value::as_object)
            .expect("harness");
        assert_eq!(
            harness.get("chat_mode").and_then(serde_json::Value::as_str),
            Some("workbench")
        );
        let launch = harness
            .get("image_skill_launch")
            .and_then(serde_json::Value::as_object)
            .expect("image skill launch");
        let image_task = launch
            .get("image_task")
            .and_then(serde_json::Value::as_object)
            .expect("image task");
        let reference_image_path = image_task
            .get("reference_images")
            .and_then(serde_json::Value::as_array)
            .and_then(|items| items.first())
            .and_then(serde_json::Value::as_str)
            .expect("reference image path");
        let skill_input_ref = image_task
            .get("skill_input_images")
            .and_then(serde_json::Value::as_array)
            .and_then(|items| items.first())
            .and_then(serde_json::Value::as_object)
            .and_then(|item| item.get("ref"))
            .and_then(serde_json::Value::as_str)
            .expect("skill input ref");

        assert_eq!(reference_image_path, skill_input_ref);
        assert!(reference_image_path.ends_with("input-1.png"));
        assert!(Path::new(reference_image_path).exists());
    }

    #[test]
    fn test_prepare_image_skill_launch_request_metadata_sets_workbench_chat_mode_without_images() {
        let metadata = serde_json::json!({
            "harness": {
                "image_skill_launch": {
                    "skill_name": "image_generate",
                    "kind": "image_task",
                    "image_task": {
                        "prompt": "青柠主视觉"
                    }
                }
            }
        });

        let prepared = prepare_image_skill_launch_request_metadata(
            Path::new("/tmp"),
            "session-image",
            "turn-image",
            Some(&metadata),
            None,
        )
        .expect("prepared metadata");

        let harness = prepared
            .get("harness")
            .and_then(serde_json::Value::as_object)
            .expect("harness");
        assert_eq!(
            harness.get("chat_mode").and_then(serde_json::Value::as_str),
            Some("workbench")
        );
    }

    #[test]
    fn test_prepare_service_scene_launch_request_metadata_sets_workbench_chat_mode() {
        let metadata = serde_json::json!({
            "harness": {
                "service_scene_launch": {
                    "kind": "cloud_scene",
                    "service_scene_run": {
                        "skill_id": "skill-scene-1",
                        "scene_key": "daily-trend-brief"
                    }
                }
            }
        });

        let prepared = prepare_service_scene_launch_request_metadata(Some(&metadata))
            .expect("prepared metadata");

        let harness = prepared
            .get("harness")
            .and_then(serde_json::Value::as_object)
            .expect("harness");
        assert_eq!(
            harness.get("chat_mode").and_then(serde_json::Value::as_str),
            Some("workbench")
        );
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

    fn sample_service_skill_launch_preload_execution() -> ServiceSkillLaunchPreloadExecution {
        ServiceSkillLaunchPreloadExecution {
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
        }
    }

    #[test]
    fn test_runtime_turn_source_keeps_prompt_strategy_entry_order_contract() {
        let source = runtime_turn_source();
        let strategy_slice = source_slice(
            &source,
            "turn_input_builder.set_base_system_prompt(system_prompt_source, resolved_prompt.clone());",
            "let requested_strategy = request.execution_strategy.unwrap_or(persisted_strategy);",
        );

        assert_markers_in_order(
            strategy_slice,
            &[
                "TurnPromptAugmentationStageKind::RuntimeAgents",
                "TurnPromptAugmentationStageKind::ExplicitLocalPathFocus",
                "build_full_runtime_system_prompt(",
                "build_fast_chat_system_prompt(",
            ],
        );
    }

    #[test]
    fn test_runtime_turn_source_keeps_full_runtime_prompt_stage_order_contract() {
        let source = runtime_turn_source();
        let full_runtime_slice = source_slice(
            &source,
            "fn build_full_runtime_system_prompt(",
            "fn build_fast_chat_system_prompt(",
        );

        assert_markers_in_order(
            full_runtime_slice,
            &[
                "TurnPromptAugmentationStageKind::Memory",
                "TurnPromptAugmentationStageKind::WebSearch",
                "TurnPromptAugmentationStageKind::RequestToolPolicy",
                "TurnPromptAugmentationStageKind::Artifact",
                "TurnPromptAugmentationStageKind::ImageSkillLaunch",
                "TurnPromptAugmentationStageKind::CoverSkillLaunch",
                "TurnPromptAugmentationStageKind::VideoSkillLaunch",
                "TurnPromptAugmentationStageKind::BroadcastSkillLaunch",
                "TurnPromptAugmentationStageKind::ResourceSearchSkillLaunch",
                "TurnPromptAugmentationStageKind::ResearchSkillLaunch",
                "TurnPromptAugmentationStageKind::ReportSkillLaunch",
                "TurnPromptAugmentationStageKind::DeepSearchSkillLaunch",
                "TurnPromptAugmentationStageKind::SiteSearchSkillLaunch",
                "TurnPromptAugmentationStageKind::PdfReadSkillLaunch",
                "TurnPromptAugmentationStageKind::PresentationSkillLaunch",
                "TurnPromptAugmentationStageKind::FormSkillLaunch",
                "TurnPromptAugmentationStageKind::SummarySkillLaunch",
                "TurnPromptAugmentationStageKind::TranslationSkillLaunch",
                "TurnPromptAugmentationStageKind::AnalysisSkillLaunch",
                "TurnPromptAugmentationStageKind::TranscriptionSkillLaunch",
                "TurnPromptAugmentationStageKind::UrlParseSkillLaunch",
                "TurnPromptAugmentationStageKind::TypesettingSkillLaunch",
                "TurnPromptAugmentationStageKind::WebpageSkillLaunch",
                "TurnPromptAugmentationStageKind::ServiceSkillLaunch",
                "TurnPromptAugmentationStageKind::Elicitation",
                "TurnPromptAugmentationStageKind::TeamPreference",
                "TurnPromptAugmentationStageKind::AutoContinue",
            ],
        );
    }

    #[test]
    fn test_runtime_turn_source_keeps_service_skill_preload_as_full_runtime_tail_stage() {
        let source = runtime_turn_source();
        let preload_stage_slice = source_slice(
            &source,
            "fn apply_service_skill_preload_prompt_stage(",
            "#[allow(clippy::too_many_arguments)]",
        );
        let prepare_slice = source_slice(
            &source,
            "let service_skill_preload = if matches!(execution_profile, TurnExecutionProfile::FullRuntime) {",
            "let runtime_turn_artifacts = build_runtime_turn_artifacts(",
        );

        assert_markers_in_order(
            preload_stage_slice,
            &[
                "if !matches!(execution_profile, TurnExecutionProfile::FullRuntime) {",
                "merge_system_prompt_with_service_skill_launch_preload",
                "TurnPromptAugmentationStageKind::ServiceSkillLaunchPreload",
            ],
        );
        assert_markers_in_order(
            prepare_slice,
            &[
                "preload_service_skill_launch_execution",
                "apply_service_skill_preload_prompt_stage(",
            ],
        );
    }

    #[test]
    fn test_merge_system_prompt_with_service_skill_launch_preload_appends_result_context() {
        let execution = sample_service_skill_launch_preload_execution();

        let merged = merge_system_prompt_with_service_skill_launch_preload(
            Some("你是助手".to_string()),
            Some(&execution),
        )
        .expect("should contain preload prompt");

        assert!(merged.contains(SERVICE_SKILL_LAUNCH_PRELOAD_PROMPT_MARKER));
        assert!(merged.contains("系统侧预执行成功"));
        assert!(merged.contains("不要再次调用 lime_site_run"));
        assert!(merged.contains("不要回退到"));
        assert!(merged.contains("WebSearch"));
        assert!(merged.contains("microsoft/autogen"));
        assert!(merged.contains("\"require_attached_session\":true"));
    }

    fn runtime_turn_source() -> String {
        fs::read_to_string(
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("src/commands/aster_agent_cmd/runtime_turn.rs"),
        )
        .expect("应能读取 runtime_turn.rs")
    }

    fn source_slice<'a>(source: &'a str, start_marker: &str, end_marker: &str) -> &'a str {
        let start = source
            .find(start_marker)
            .unwrap_or_else(|| panic!("未找到起始标记: {start_marker}"));
        let end = source[start..]
            .find(end_marker)
            .map(|offset| start + offset)
            .unwrap_or_else(|| panic!("未找到结束标记: {end_marker}"));
        &source[start..end]
    }

    fn assert_markers_in_order(source: &str, markers: &[&str]) {
        let mut cursor = 0usize;
        for marker in markers {
            let offset = source[cursor..]
                .find(marker)
                .unwrap_or_else(|| panic!("未按顺序找到标记: {marker}"));
            cursor += offset + marker.len();
        }
    }

    #[test]
    fn test_merge_system_prompt_with_service_skill_launch_preload_adds_markdown_bundle_translation_contract(
    ) {
        let execution = ServiceSkillLaunchPreloadExecution {
            request: RunSiteAdapterRequest {
                adapter_name: "x/article-export".to_string(),
                args: serde_json::json!({
                    "url": "https://x.com/GoogleCloudTech/article/2033953579824758855",
                    "target_language": "中文"
                }),
                profile_key: Some("attached-x".to_string()),
                target_id: Some("tab-x".to_string()),
                timeout_ms: None,
                content_id: Some("content-1".to_string()),
                project_id: Some("project-1".to_string()),
                save_title: Some("Google Cloud Tech 文章转存".to_string()),
                require_attached_session: Some(true),
                skill_title: Some("X 文章转存".to_string()),
            },
            adapter: Some(SiteAdapterDefinition {
                name: "x/article-export".to_string(),
                domain: "x.com".to_string(),
                description: "导出 X 文章为 Markdown。".to_string(),
                read_only: true,
                capabilities: vec!["export".to_string()],
                input_schema: serde_json::json!({}),
                example_args: serde_json::json!({
                    "url": "https://x.com/example/article/1"
                }),
                example: "x/article-export {\"url\":\"https://x.com/example/article/1\"}"
                    .to_string(),
                auth_hint: None,
                source_kind: Some("server_synced".to_string()),
                source_version: Some("2026-04-07".to_string()),
            }),
            result: SiteAdapterRunResult {
                ok: true,
                adapter: "x/article-export".to_string(),
                domain: "x.com".to_string(),
                profile_key: "attached-x".to_string(),
                session_id: Some("session-1".to_string()),
                target_id: Some("tab-x".to_string()),
                entry_url: "https://x.com/GoogleCloudTech/article/2033953579824758855".to_string(),
                source_url: Some(
                    "https://x.com/GoogleCloudTech/article/2033953579824758855".to_string(),
                ),
                data: Some(serde_json::json!({
                    "export_kind": "markdown_bundle",
                    "title": "Google Cloud Tech",
                    "markdown": "# Example\n\n![封面图](images/cover.png)\n\nHello world"
                })),
                error_code: None,
                error_message: None,
                auth_hint: None,
                report_hint: None,
                saved_content: Some(SavedSiteAdapterContent {
                    content_id: "content-1".to_string(),
                    project_id: "project-1".to_string(),
                    title: "Google Cloud Tech 文章转存".to_string(),
                    project_root_path: Some("/tmp/project".to_string()),
                    bundle_relative_dir: Some("saved/x-article-export".to_string()),
                    markdown_relative_path: Some("saved/x-article-export/index.md".to_string()),
                    images_relative_dir: Some("saved/x-article-export/images".to_string()),
                    meta_relative_path: Some("saved/x-article-export/meta.json".to_string()),
                    image_count: Some(1),
                }),
                saved_project_id: Some("project-1".to_string()),
                saved_by: Some("context_project".to_string()),
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

        assert!(merged.contains("这个 bundle 是系统侧采集得到的源材料"));
        assert!(merged.contains("不默认等于用户要的最终交付结果"));
        assert!(merged.contains("必须先基于这份已保存的 Markdown 继续完成原任务"));
        assert!(merged.contains("不要把保存路径、图片数量或采集摘要原样复述后就停止"));
        assert!(merged.contains("不要把 exports 下的源 bundle 直接当成最终结果目录"));
        assert!(merged.contains("Markdown 正文翻译成中文"));
        assert!(merged.contains("/tmp/project/saved/x-article-export/index.md"));
        assert!(merged.contains("只允许新增 Read / Write / Edit"));
        assert!(merged.contains("必须先用 Read 读取"));
        assert!(merged.contains("必须用 Write 覆写同一路径"));
        assert!(merged.contains("代码块、内联代码、URL、图片路径"));
        assert!(merged.contains("不要破坏这些相对图片引用"));
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
        assert!(merged.contains("webReader"));
        assert!(merged.contains("请先连接并停留在 github.com。"));
    }

    #[test]
    fn test_build_service_skill_preload_tool_projection_emits_site_metadata() {
        let execution = ServiceSkillLaunchPreloadExecution {
            request: RunSiteAdapterRequest {
                adapter_name: "x/article-export".to_string(),
                args: serde_json::json!({
                    "url": "https://x.com/GoogleCloudTech/article/2033953579824758855"
                }),
                profile_key: Some("attached-x".to_string()),
                target_id: Some("tab-x".to_string()),
                timeout_ms: None,
                content_id: Some("content-1".to_string()),
                project_id: Some("project-1".to_string()),
                save_title: Some("Google Cloud Tech 文章转存".to_string()),
                require_attached_session: Some(true),
                skill_title: Some("X 文章转存".to_string()),
            },
            adapter: Some(SiteAdapterDefinition {
                name: "x/article-export".to_string(),
                domain: "x.com".to_string(),
                description: "导出 X 文章为 Markdown。".to_string(),
                read_only: true,
                capabilities: vec!["export".to_string()],
                input_schema: serde_json::json!({}),
                example_args: serde_json::json!({
                    "url": "https://x.com/example/article/1"
                }),
                example: "x/article-export {\"url\":\"https://x.com/example/article/1\"}"
                    .to_string(),
                auth_hint: None,
                source_kind: Some("server_synced".to_string()),
                source_version: Some("2026-04-07".to_string()),
            }),
            result: SiteAdapterRunResult {
                ok: true,
                adapter: "x/article-export".to_string(),
                domain: "x.com".to_string(),
                profile_key: "attached-x".to_string(),
                session_id: Some("session-1".to_string()),
                target_id: Some("tab-x".to_string()),
                entry_url: "https://x.com/GoogleCloudTech/article/2033953579824758855".to_string(),
                source_url: Some(
                    "https://x.com/GoogleCloudTech/article/2033953579824758855".to_string(),
                ),
                data: Some(serde_json::json!({
                    "title": "Google Cloud Tech"
                })),
                error_code: None,
                error_message: None,
                auth_hint: None,
                report_hint: None,
                saved_content: Some(SavedSiteAdapterContent {
                    content_id: "content-1".to_string(),
                    project_id: "project-1".to_string(),
                    title: "Google Cloud Tech 文章转存".to_string(),
                    project_root_path: Some("/tmp/project".to_string()),
                    bundle_relative_dir: Some("saved/x-article-export".to_string()),
                    markdown_relative_path: Some("saved/x-article-export/article.md".to_string()),
                    images_relative_dir: Some("saved/x-article-export/images".to_string()),
                    meta_relative_path: Some("saved/x-article-export/meta.json".to_string()),
                    image_count: Some(2),
                }),
                saved_project_id: Some("project-1".to_string()),
                saved_by: Some("context_project".to_string()),
                save_skipped_project_id: None,
                save_skipped_by: None,
                save_error_message: None,
            },
        };

        let projection = build_service_skill_preload_tool_projection(&execution)
            .expect("should build preload projection");

        assert_eq!(projection.tool_name, "lime_site_run");
        assert!(projection.tool_id.starts_with("service-skill-preload:"));
        assert!(projection
            .arguments
            .contains("\"execution_origin\":\"preload\""));
        assert!(projection
            .arguments
            .contains("\"skill_title\":\"X 文章转存\""));
        assert!(projection.result.success);
        assert!(projection.result.output.contains("已完成站点技能预执行"));
        assert!(projection.result.output.contains("图片资源：2 张"));

        let metadata = projection.result.metadata.expect("metadata should exist");
        assert_eq!(
            metadata.get("tool_family"),
            Some(&serde_json::json!("site"))
        );
        assert_eq!(
            metadata.get("execution_origin"),
            Some(&serde_json::json!("preload"))
        );
        assert_eq!(
            metadata.get("adapter_source_kind"),
            Some(&serde_json::json!("server_synced"))
        );
        assert_eq!(
            metadata.get("adapter_source_version"),
            Some(&serde_json::json!("2026-04-07"))
        );
        let result = metadata
            .get("result")
            .and_then(serde_json::Value::as_object)
            .expect("result metadata should exist");
        let saved_content = result
            .get("saved_content")
            .and_then(serde_json::Value::as_object)
            .expect("saved content should exist");
        assert_eq!(
            saved_content.get("markdown_relative_path"),
            Some(&serde_json::json!("saved/x-article-export/article.md"))
        );
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
    fn test_command_layer_raw_execution_surfaces_are_explicitly_bounded() {
        let commands_root = Path::new(env!("CARGO_MANIFEST_DIR")).join("src/commands");
        let crate_root = Path::new(env!("CARGO_MANIFEST_DIR"));
        let expected: HashSet<String> = [
            "src/commands/aster_agent_cmd/action_runtime.rs",
            "src/commands/persona_cmd.rs",
            "src/commands/theme_context_cmd.rs",
        ]
        .into_iter()
        .map(ToString::to_string)
        .collect();

        let mut rust_files = Vec::new();
        collect_rust_files(&commands_root, &mut rust_files);

        let actual: HashSet<String> = rust_files
            .into_iter()
            .filter_map(|path| {
                let content = fs::read_to_string(&path).expect("应能读取源码");
                let relative_path = path
                    .strip_prefix(crate_root)
                    .expect("commands 文件应位于 crate 根下")
                    .to_string_lossy()
                    .replace('\\', "/");
                if relative_path.ends_with("/tests.rs") {
                    return None;
                }
                if content.contains(".reply(") || content.contains("stream_reply_with_policy(") {
                    Some(relative_path)
                } else {
                    None
                }
            })
            .collect();

        assert_eq!(
            actual, expected,
            "Tauri 命令层新增了未分类的原始执行旁路，请先完成 current/compat/deprecated 归类"
        );
    }

    #[test]
    fn test_non_command_rust_raw_execution_surfaces_remain_empty() {
        let src_root = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let crate_root = Path::new(env!("CARGO_MANIFEST_DIR"));

        let mut rust_files = Vec::new();
        collect_rust_files(&src_root, &mut rust_files);

        let actual: HashSet<String> = rust_files
            .into_iter()
            .filter_map(|path| {
                let content = fs::read_to_string(&path).expect("应能读取源码");
                let relative_path = path
                    .strip_prefix(crate_root)
                    .expect("src 文件应位于 crate 根下")
                    .to_string_lossy()
                    .replace('\\', "/");
                if relative_path.starts_with("src/commands/")
                    || relative_path.ends_with("/tests.rs")
                {
                    return None;
                }
                if content.contains(".reply(") || content.contains("stream_reply_with_policy(") {
                    Some(relative_path)
                } else {
                    None
                }
            })
            .collect();

        assert!(
            actual.is_empty(),
            "非命令层 Rust 源码新增了原始执行旁路，请先完成 current/compat/deprecated 归类: {actual:?}"
        );
    }

    #[test]
    fn test_non_command_readme_raw_execution_examples_are_explicitly_bounded() {
        let src_root = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let crate_root = Path::new(env!("CARGO_MANIFEST_DIR"));
        let expected: HashSet<String> = ["src/agent/README.md"]
            .into_iter()
            .map(ToString::to_string)
            .collect();

        let mut markdown_files = Vec::new();
        collect_markdown_files(&src_root, &mut markdown_files);

        let actual: HashSet<String> = markdown_files
            .into_iter()
            .filter_map(|path| {
                let content = fs::read_to_string(&path).expect("应能读取文档");
                let relative_path = path
                    .strip_prefix(crate_root)
                    .expect("markdown 文件应位于 crate 根下")
                    .to_string_lossy()
                    .replace('\\', "/");
                if content.contains("agent.reply(") || content.contains("stream_reply_with_policy(")
                {
                    Some(relative_path)
                } else {
                    None
                }
            })
            .collect();

        assert_eq!(
            actual, expected,
            "README/示例面新增了未分类的原始执行示例，请先完成 current/compat/deprecated 归类"
        );
    }

    #[test]
    fn test_workspace_default_allowed_tool_names_include_subagent_controls() {
        let tool_names = crate::agent_tools::catalog::workspace_default_allowed_tool_names(
            WorkspaceToolSurface::core(),
        );

        for tool_name in [
            "Agent",
            "SendUserMessage",
            "SendMessage",
            "TeamCreate",
            "TeamDelete",
            "ListPeers",
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
        assert!(prompt.contains("Agent"));

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
    fn test_build_team_preference_system_prompt_renders_repo_scoped_team_memory_shadow() {
        let prompt = build_team_preference_system_prompt(
            Some(&serde_json::json!({
                "harness": {
                    "subagent_mode_enabled": true,
                    "team_memory_shadow": {
                        "repo_scope": "/tmp/repo",
                        "entries": [
                            {
                                "key": "team.selection",
                                "content": "主题：general\nTeam：前端联调团队\n角色：\n- 分析：负责定位问题。",
                                "updated_at": 1
                            },
                            {
                                "key": "team.subagents",
                                "content": "会话：session-1\n子代理：\n- 分析 [running] 负责定位问题",
                                "updated_at": 2
                            }
                        ]
                    }
                }
            })),
            None,
            true,
        )
        .expect("team prompt should exist");

        assert!(prompt.contains("repo-scoped Team 协作记忆"));
        assert!(prompt.contains("repoScope: /tmp/repo"));
        assert!(prompt.contains("team.selection / updatedAt: 1"));
        assert!(
            prompt.contains("主题：general | Team：前端联调团队 | 角色： | - 分析：负责定位问题。")
        );
        assert!(prompt.contains("team.subagents / updatedAt: 2"));
        assert!(prompt.contains("会话：session-1 | 子代理： | - 分析 [running] 负责定位问题"));
        assert!(prompt.contains("如与本次显式 selected Team"));
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
        assert!(prompt.contains("Agent"));
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
            name: None,
            team_name: None,
            agent_type: Some("Image #1".to_string()),
            model: None,
            run_in_background: false,
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
            mode: None,
            isolation: None,
            cwd: None,
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
                usage: None,
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
    fn test_tool_search_parse_select_query_supports_multiple_names() {
        let parsed = ToolSearchBridgeTool::parse_select_query("select:Read, mcp__docs__search");
        assert_eq!(
            parsed,
            Some(vec!["Read".to_string(), "mcp__docs__search".to_string()])
        );
    }

    #[test]
    fn test_tool_search_select_match_rank_supports_native_aliases() {
        let requested = vec!["read_file".to_string(), "Write".to_string()];
        let read_rank = ToolSearchBridgeTool::select_match_rank(&requested, "Read");
        let write_rank = ToolSearchBridgeTool::select_match_rank(&requested, "Write");
        assert_eq!(read_rank, Some(100_000));
        assert_eq!(write_rank, Some(99_999));
    }

    #[test]
    fn test_tool_search_extension_tool_status_marks_default_visible_and_loaded_tools() {
        let configs = vec![builtin_extension_config(
            "mcp__docs",
            vec!["search_docs", "read_docs"],
            true,
            vec!["search_docs"],
            Some("assistant"),
        )];
        let visible_tool_names = HashSet::from(["mcp__docs__read_docs".to_string()]);

        let visible = ToolSearchBridgeTool::extension_tool_status(
            &configs,
            &visible_tool_names,
            "mcp__docs__search_docs",
        );
        assert_eq!(visible, ("visible", false, Some("mcp__docs".to_string())));

        let loaded = ToolSearchBridgeTool::extension_tool_status(
            &configs,
            &visible_tool_names,
            "mcp__docs__read_docs",
        );
        assert_eq!(loaded, ("loaded", false, Some("mcp__docs".to_string())));
    }

    #[test]
    fn test_tool_search_extension_tool_status_prefers_longest_extension_name() {
        let configs = vec![
            builtin_extension_config("mcp__docs", vec!["search"], true, vec![], Some("assistant")),
            builtin_extension_config(
                "mcp__docs__admin",
                vec!["search"],
                true,
                vec![],
                Some("code_execution"),
            ),
        ];

        let status = ToolSearchBridgeTool::extension_tool_status(
            &configs,
            &HashSet::new(),
            "mcp__docs__admin__search",
        );
        assert_eq!(
            status,
            ("deferred", true, Some("mcp__docs__admin".to_string()))
        );
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
            .expect("ToolSearch should succeed");
        let hidden_output = hidden_result.output.expect("ToolSearch output");
        let hidden_json: serde_json::Value =
            serde_json::from_str(&hidden_output).expect("parse ToolSearch output");
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
            .expect("ToolSearch should succeed");
        let visible_output = visible_result.output.expect("ToolSearch output");
        let visible_json: serde_json::Value =
            serde_json::from_str(&visible_output).expect("parse ToolSearch output");
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

    #[tokio::test]
    async fn test_tool_search_bridge_registration_replaces_legacy_tool_search() {
        let registry = Arc::new(tokio::sync::RwLock::new(aster::tools::ToolRegistry::new()));
        let mut guard = registry.write().await;

        guard.register(Box::new(aster::tools::ToolSearchTool::new(
            std::sync::Weak::new(),
        )));
        assert!(guard
            .get("ToolSearch")
            .expect("legacy ToolSearch should exist")
            .description()
            .contains("Fetches full schema definitions"));

        super::tool_runtime::register_tool_search_tool_to_registry(
            &mut guard,
            registry.clone(),
            None,
            None,
        );

        let tool = guard
            .get("ToolSearch")
            .expect("bridge ToolSearch should replace legacy implementation");
        assert!(tool.description().contains("统一搜索当前会话工具面"));
        assert!(tool.input_schema()["properties"].get("caller").is_some());
    }

    #[test]
    fn test_list_current_surface_tool_definitions_includes_agent_tool() {
        let db: DbConnection = Arc::new(Mutex::new(
            rusqlite::Connection::open_in_memory().expect("open in-memory db"),
        ));
        {
            let conn = db.lock().expect("db lock");
            lime_core::database::schema::create_tables(&conn).expect("create schema");
        }
        std::env::set_var(
            "LIME_ASTER_ROOT",
            shared_aster_runtime_test_root()
                .to_string_lossy()
                .to_string(),
        );
        lime_agent::initialize_aster_runtime(db.clone()).expect("runtime dirs should initialize");

        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("build tokio runtime");
        runtime.block_on(async {
            let state = AsterAgentState::new();
            state
                .init_agent_with_db(&db)
                .await
                .expect("agent state should initialize");

            let definitions =
                super::tool_runtime::list_current_surface_tool_definitions(&state).await;

            assert!(definitions
                .iter()
                .any(|definition| definition.name == "Agent"));
        });
    }

    #[test]
    fn test_tool_search_bridge_includes_current_surface_agent_tool() {
        let db: DbConnection = Arc::new(Mutex::new(
            rusqlite::Connection::open_in_memory().expect("open in-memory db"),
        ));
        {
            let conn = db.lock().expect("db lock");
            lime_core::database::schema::create_tables(&conn).expect("create schema");
        }
        std::env::set_var(
            "LIME_ASTER_ROOT",
            shared_aster_runtime_test_root()
                .to_string_lossy()
                .to_string(),
        );
        lime_agent::initialize_aster_runtime(db.clone()).expect("runtime dirs should initialize");

        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("build tokio runtime");
        runtime.block_on(async {
            let state = AsterAgentState::new();
            state
                .init_agent_with_db(&db)
                .await
                .expect("agent state should initialize");

            let agent_arc = state.get_agent_arc();
            let guard = agent_arc.read().await;
            let agent = guard.as_ref().expect("agent should exist");
            let registry = agent.tool_registry().clone();
            drop(guard);

            let tool = ToolSearchBridgeTool::new(registry, None).with_state(state.clone());
            let result = tool
                .execute(
                    serde_json::json!({
                        "query": "agent",
                        "caller": "assistant",
                        "include_deferred": true,
                        "include_schema": false
                    }),
                    &ToolContext::new(PathBuf::from(".")),
                )
                .await
                .expect("ToolSearch should succeed");
            let output = result.output.expect("ToolSearch output");
            let payload: serde_json::Value =
                serde_json::from_str(&output).expect("parse ToolSearch output");
            let tools = payload["tools"].as_array().expect("tools should be array");

            assert!(tools.iter().any(|tool| tool["name"] == "Agent"));
        });
    }
}
