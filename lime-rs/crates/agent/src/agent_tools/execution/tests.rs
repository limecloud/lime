use super::policy::*;
use super::{
    decide_tool_execution, ToolExecutionDecisionInput, ToolExecutionDecisionKind,
    ToolExecutionPolicyService,
};
use crate::agent_tools::catalog::tool_catalog_entry;
use lime_core::config::{
    ToolExecutionCommandRiskLevelConfig as ConfigToolExecutionCommandRiskLevelConfig,
    ToolExecutionCommandRuleConfig as ConfigToolExecutionCommandRuleConfig,
    ToolExecutionCommandRuleMatchTypeConfig as ConfigToolExecutionCommandRuleMatchTypeConfig,
    ToolExecutionOverrideConfig as ConfigToolExecutionOverrideConfig,
    ToolExecutionPolicyConfig as ConfigToolExecutionPolicyConfig,
    ToolExecutionRestrictionProfileConfig as ConfigToolExecutionRestrictionProfileConfig,
    ToolExecutionSandboxProfileConfig as ConfigToolExecutionSandboxProfileConfig,
    ToolExecutionWarningPolicyConfig as ConfigToolExecutionWarningPolicyConfig,
};
use serde_json::json;
use std::collections::{HashMap, HashSet};
use std::path::Path;

#[test]
fn test_tool_execution_policy_marks_exec_command_as_sandboxed_shell_risk() {
    let policy = tool_execution_policy("exec_command");
    assert_eq!(
        policy.warning_policy,
        ToolExecutionWarningPolicy::ShellCommandRisk
    );
    assert_eq!(
        policy.restriction_profile,
        ToolExecutionRestrictionProfile::WorkspaceShellCommand
    );
    assert_eq!(
        policy.sandbox_profile,
        ToolExecutionSandboxProfile::WorkspaceCommand
    );
}

#[test]
fn test_tool_policy_rule_catalog_uses_registered_canonical_tool_names() {
    let mut seen_tool_names = HashSet::new();

    for rule in super::rules::tool_policy_rules() {
        assert!(
            !rule.tool_names.is_empty(),
            "policy rule should target at least one tool"
        );
        for tool_name in rule.tool_names {
            let catalog_entry = tool_catalog_entry(tool_name)
                .unwrap_or_else(|| panic!("policy rule tool should exist: {tool_name}"));
            assert_eq!(catalog_entry.name, *tool_name);
            assert!(
                seen_tool_names.insert(*tool_name),
                "tool should have one default policy rule: {tool_name}"
            );
        }
    }
}

#[test]
fn test_shell_command_classifier_reports_highest_risk_segment() {
    let rule_match = tool_runtime::execution_rules::classify_shell_command_with_rules(
        "git status && rm -rf target/tmp",
        &[],
    )
    .expect("shell command should match a policy rule");

    assert_eq!(rule_match.rule_id, "destructive_remove");
    assert_eq!(rule_match.risk_level.label(), "high");
    assert_eq!(rule_match.reason_code, "destructive_remove_command");
}

#[test]
fn test_shell_command_classifier_does_not_treat_file_paths_as_rm_flags() {
    assert!(
        tool_runtime::execution_rules::classify_shell_command_with_rules("rm feature.txt", &[])
            .is_none()
    );

    let rule_match =
        tool_runtime::execution_rules::classify_shell_command_with_rules("rm -Rf target/tmp", &[])
            .expect("recursive force remove should match policy rule");
    assert_eq!(rule_match.rule_id, "destructive_remove");
}

#[test]
fn test_tool_execution_policy_marks_view_image_as_workspace_path_tool() {
    let policy = tool_execution_policy("view_image");
    assert_eq!(
        policy.restriction_profile,
        ToolExecutionRestrictionProfile::WorkspacePathRequired
    );
    assert_eq!(policy.warning_policy, ToolExecutionWarningPolicy::None);
    assert_eq!(policy.sandbox_profile, ToolExecutionSandboxProfile::None);
}

#[test]
fn test_decide_tool_execution_requires_approval_for_shell_on_request_policy() {
    let params = json!({ "command": "cargo test" });
    let decision = decide_tool_execution(ToolExecutionDecisionInput {
        tool_name: "exec_command",
        params: &params,
        working_directory: Path::new("/tmp/workspace"),
        surface: "runtime_tool",
        auto_mode: false,
        bypass_restrictions: false,
        approval_policy: Some("on_request"),
        requested_sandbox_policy: Some("workspace-write"),
        resolver_input: ToolExecutionResolverInput::default(),
    });

    assert_eq!(decision.kind, ToolExecutionDecisionKind::RequiresApproval);
    assert!(decision.requires_approval());
    assert_eq!(decision.reason_code, "shell_command_requires_approval");
    assert_eq!(
        decision.metadata.get("decisionOwner"),
        Some(&json!("workspace_tool_execution"))
    );
    assert_eq!(
        decision.metadata.get("approvalPolicy"),
        Some(&json!("on_request"))
    );
    assert_eq!(decision.metadata.get("command"), Some(&json!("cargo test")));
    assert!(decision.requires_sandboxed_execution());
    assert!(decision.workspace_sandbox_backend_enforced());
    assert_eq!(
        decision.metadata.get("sandboxBackendStatus"),
        Some(&json!("ready"))
    );
}

#[test]
fn test_decide_tool_execution_adds_shell_command_rule_metadata() {
    let params = json!({ "command": "git push origin main" });
    let decision = decide_tool_execution(ToolExecutionDecisionInput {
        tool_name: "exec_command",
        params: &params,
        working_directory: Path::new("/tmp/workspace"),
        surface: "runtime_tool",
        auto_mode: false,
        bypass_restrictions: false,
        approval_policy: Some("on_request"),
        requested_sandbox_policy: Some("workspace-write"),
        resolver_input: ToolExecutionResolverInput::default(),
    });

    assert_eq!(decision.kind, ToolExecutionDecisionKind::RequiresApproval);
    assert_eq!(
        decision.metadata.get("commandRuleId"),
        Some(&json!("git_state_mutation"))
    );
    assert_eq!(
        decision.metadata.get("commandRiskLevel"),
        Some(&json!("medium"))
    );
    assert_eq!(
        decision.metadata.get("commandRiskReasonCode"),
        Some(&json!("git_state_mutation_command"))
    );
    assert_eq!(
        decision.metadata.get("commandRuleSource"),
        Some(&json!("default"))
    );
}

#[test]
fn test_decide_tool_execution_uses_runtime_shell_command_rule_metadata() {
    let request_metadata = json!({
        "harness": {
            "executionPolicy": {
                "shellCommandRules": [
                    {
                        "ruleId": "runtime_git_push",
                        "pattern": "\\bgit\\s+push\\b",
                        "riskLevel": "high",
                        "reasonCode": "runtime_blocks_git_push",
                        "reason": "请求级策略要求人工确认 git push"
                    }
                ]
            }
        }
    });
    let params = json!({ "command": "git push origin main" });
    let decision = decide_tool_execution(ToolExecutionDecisionInput {
        tool_name: "exec_command",
        params: &params,
        working_directory: Path::new("/tmp/workspace"),
        surface: "runtime_tool",
        auto_mode: false,
        bypass_restrictions: false,
        approval_policy: Some("on_request"),
        requested_sandbox_policy: Some("workspace-write"),
        resolver_input: ToolExecutionResolverInput {
            persisted_policy: None,
            request_metadata: Some(&request_metadata),
        },
    });

    assert_eq!(decision.kind, ToolExecutionDecisionKind::RequiresApproval);
    assert_eq!(
        decision.metadata.get("commandRuleId"),
        Some(&json!("runtime_git_push"))
    );
    assert_eq!(
        decision.metadata.get("commandRuleSource"),
        Some(&json!("runtime"))
    );
    assert_eq!(
        decision.metadata.get("commandRiskLevel"),
        Some(&json!("high"))
    );
    assert_eq!(
        decision.metadata.get("commandRiskReasonCode"),
        Some(&json!("runtime_blocks_git_push"))
    );
}

#[test]
fn test_decide_tool_execution_allows_shell_when_approval_policy_never() {
    let params = json!({ "command": "cargo test" });
    let decision = decide_tool_execution(ToolExecutionDecisionInput {
        tool_name: "exec_command",
        params: &params,
        working_directory: Path::new("/tmp/workspace"),
        surface: "runtime_tool",
        auto_mode: false,
        bypass_restrictions: false,
        approval_policy: Some("never"),
        requested_sandbox_policy: Some("workspace-write"),
        resolver_input: ToolExecutionResolverInput::default(),
    });

    assert_eq!(decision.kind, ToolExecutionDecisionKind::Allow);
    assert!(decision.allowed());
    assert_eq!(decision.reason_code, "allowed");
    assert_eq!(
        decision.metadata.get("approvalPolicy"),
        Some(&json!("never"))
    );
    assert_eq!(
        decision.metadata.get("requestedSandboxPolicy"),
        Some(&json!("workspace-write"))
    );
}

#[test]
fn test_decide_tool_execution_blocks_write_shell_in_read_only_sandbox() {
    let params = json!({ "command": "cargo test" });
    let decision = decide_tool_execution(ToolExecutionDecisionInput {
        tool_name: "exec_command",
        params: &params,
        working_directory: Path::new("/tmp/workspace"),
        surface: "runtime_tool",
        auto_mode: false,
        bypass_restrictions: false,
        approval_policy: Some("never"),
        requested_sandbox_policy: Some("read-only"),
        resolver_input: ToolExecutionResolverInput::default(),
    });

    assert_eq!(decision.kind, ToolExecutionDecisionKind::SandboxBlocked);
    assert_eq!(
        decision.reason_code,
        "read_only_sandbox_blocks_shell_command"
    );
    assert_eq!(
        decision.metadata.get("sandboxPolicy"),
        Some(&json!("read-only"))
    );
    assert_eq!(decision.metadata.get("command"), Some(&json!("cargo test")));
}

#[test]
fn test_decide_tool_execution_allows_read_only_shell_in_read_only_sandbox() {
    let params = json!({ "command": "pwd && rg coding internal/roadmap/coding" });
    let decision = decide_tool_execution(ToolExecutionDecisionInput {
        tool_name: "exec_command",
        params: &params,
        working_directory: Path::new("/tmp/workspace"),
        surface: "runtime_tool",
        auto_mode: false,
        bypass_restrictions: false,
        approval_policy: Some("never"),
        requested_sandbox_policy: Some("read_only"),
        resolver_input: ToolExecutionResolverInput::default(),
    });

    assert_eq!(decision.kind, ToolExecutionDecisionKind::Allow);
    assert_eq!(decision.reason_code, "allowed");
}

#[test]
fn test_decide_tool_execution_blocks_ambiguous_shell_in_read_only_sandbox() {
    for command in ["git branch new-branch", "find . -name '*.tmp' -delete"] {
        let params = json!({ "command": command });
        let decision = decide_tool_execution(ToolExecutionDecisionInput {
            tool_name: "exec_command",
            params: &params,
            working_directory: Path::new("/tmp/workspace"),
            surface: "runtime_tool",
            auto_mode: false,
            bypass_restrictions: false,
            approval_policy: Some("never"),
            requested_sandbox_policy: Some("read-only"),
            resolver_input: ToolExecutionResolverInput::default(),
        });

        assert_eq!(
            decision.kind,
            ToolExecutionDecisionKind::SandboxBlocked,
            "{command} should be blocked"
        );
    }
}

#[test]
fn test_resolve_tool_execution_policy_allows_persisted_override_to_replace_default() {
    let persisted_policy = ConfigToolExecutionPolicyConfig {
        tool_overrides: HashMap::from([(
            "exec_command".to_string(),
            ConfigToolExecutionOverrideConfig {
                warning_policy: Some(ConfigToolExecutionWarningPolicyConfig::None),
                restriction_profile: Some(
                    ConfigToolExecutionRestrictionProfileConfig::WorkspacePathRequired,
                ),
                sandbox_profile: Some(ConfigToolExecutionSandboxProfileConfig::None),
            },
        )]),
        ..Default::default()
    };

    let policy = resolve_tool_execution_policy(
        "exec_command",
        ToolExecutionResolverInput {
            persisted_policy: Some(&persisted_policy),
            request_metadata: None,
        },
    );

    assert_eq!(policy.warning_policy, ToolExecutionWarningPolicy::None);
    assert_eq!(
        policy.restriction_profile,
        ToolExecutionRestrictionProfile::WorkspacePathRequired
    );
    assert_eq!(policy.sandbox_profile, ToolExecutionSandboxProfile::None);
}

#[test]
fn test_resolve_tool_execution_policy_runtime_override_beats_persisted_policy() {
    let persisted_policy = ConfigToolExecutionPolicyConfig {
        tool_overrides: HashMap::from([(
            "exec_command".to_string(),
            ConfigToolExecutionOverrideConfig {
                warning_policy: Some(ConfigToolExecutionWarningPolicyConfig::None),
                restriction_profile: Some(
                    ConfigToolExecutionRestrictionProfileConfig::WorkspacePathRequired,
                ),
                sandbox_profile: Some(ConfigToolExecutionSandboxProfileConfig::None),
            },
        )]),
        ..Default::default()
    };
    let request_metadata = json!({
        "harness": {
            "executionPolicy": {
                "toolOverrides": {
                    "EXEC_COMMAND": {
                        "warningPolicy": "shell_command_risk",
                        "restrictionProfile": "workspace_shell_command",
                        "sandboxProfile": "workspace_command"
                    }
                }
            }
        }
    });

    let policy = resolve_tool_execution_policy(
        "exec_command",
        ToolExecutionResolverInput {
            persisted_policy: Some(&persisted_policy),
            request_metadata: Some(&request_metadata),
        },
    );

    assert_eq!(
        policy.warning_policy,
        ToolExecutionWarningPolicy::ShellCommandRisk
    );
    assert_eq!(
        policy.restriction_profile,
        ToolExecutionRestrictionProfile::WorkspaceShellCommand
    );
    assert_eq!(
        policy.sandbox_profile,
        ToolExecutionSandboxProfile::WorkspaceCommand
    );
}

#[test]
fn test_tool_execution_policy_service_resolves_metadata_sources() {
    let persisted_policy = ConfigToolExecutionPolicyConfig {
        tool_overrides: HashMap::from([(
            "exec_command".to_string(),
            ConfigToolExecutionOverrideConfig {
                warning_policy: Some(ConfigToolExecutionWarningPolicyConfig::None),
                restriction_profile: None,
                sandbox_profile: None,
            },
        )]),
        ..Default::default()
    };
    let request_metadata = json!({
        "harness": {
            "executionPolicy": {
                "toolOverrides": {
                    "exec_command": {
                        "sandboxProfile": "none"
                    }
                }
            }
        }
    });
    let service = ToolExecutionPolicyService::new(ToolExecutionResolverInput {
        persisted_policy: Some(&persisted_policy),
        request_metadata: Some(&request_metadata),
    });

    let metadata = service.metadata("exec_command", "core");

    assert_eq!(
        metadata.get("policyName"),
        Some(&json!("workspace_tool_execution"))
    );
    assert_eq!(metadata.get("warningPolicy"), Some(&json!("none")));
    assert_eq!(
        metadata.get("warningPolicySource"),
        Some(&json!("persisted"))
    );
    assert_eq!(metadata.get("sandboxPolicy"), Some(&json!("none")));
    assert_eq!(metadata.get("sandboxPolicySource"), Some(&json!("runtime")));
}

#[test]
fn test_tool_execution_policy_service_merges_shell_command_rules() {
    let persisted_policy = ConfigToolExecutionPolicyConfig {
        shell_command_rules: vec![ConfigToolExecutionCommandRuleConfig {
            rule_id: "persisted_publish".to_string(),
            match_type: ConfigToolExecutionCommandRuleMatchTypeConfig::Regex,
            pattern: r"\bcargo\s+publish\b".to_string(),
            risk_level: ConfigToolExecutionCommandRiskLevelConfig::Medium,
            reason_code: "persisted_publish_command".to_string(),
            reason: "持久化策略标记发布命令".to_string(),
        }],
        ..Default::default()
    };
    let request_metadata = json!({
        "runtimeOptions": {
            "harness": {
                "executionPolicy": {
                    "shellCommandRules": [
                        {
                            "ruleId": "runtime_publish",
                            "pattern": "\\bcargo\\s+publish\\b",
                            "riskLevel": "high",
                            "reasonCode": "runtime_publish_command",
                            "reason": "请求级策略标记发布命令"
                        }
                    ]
                }
            }
        }
    });
    let service = ToolExecutionPolicyService::new(ToolExecutionResolverInput {
        persisted_policy: Some(&persisted_policy),
        request_metadata: Some(&request_metadata),
    });

    let rule_match = service
        .classify_shell_command("cargo publish --dry-run")
        .expect("shell command should match merged rules");

    assert_eq!(rule_match.rule_id, "runtime_publish");
    assert_eq!(rule_match.source.label(), "runtime");
    assert_eq!(rule_match.risk_level.label(), "high");
    assert_eq!(rule_match.reason_code, "runtime_publish_command");
}

#[test]
fn test_tool_execution_policy_service_applies_organization_user_request_layers() {
    let request_metadata = json!({
        "harness": {
            "organizationExecutionPolicy": {
                "toolOverrides": {
                    "exec_command": {
                        "warningPolicy": "none",
                        "sandboxProfile": "none"
                    }
                }
            },
            "userExecutionPolicy": {
                "toolOverrides": {
                    "exec_command": {
                        "warningPolicy": "shell_command_risk"
                    }
                }
            },
            "executionPolicy": {
                "toolOverrides": {
                    "exec_command": {
                        "restrictionProfile": "workspace_path_required"
                    }
                }
            },
            "requestExecutionPolicy": {
                "toolOverrides": {
                    "exec_command": {
                        "sandboxProfile": "workspace_command"
                    }
                }
            }
        }
    });
    let resolution = resolve_tool_execution_policy_resolution(
        "exec_command",
        ToolExecutionResolverInput {
            persisted_policy: None,
            request_metadata: Some(&request_metadata),
        },
    );

    assert_eq!(
        resolution.policy.warning_policy,
        ToolExecutionWarningPolicy::ShellCommandRisk
    );
    assert_eq!(
        resolution.warning_policy_source,
        ToolExecutionPolicySource::User
    );
    assert_eq!(
        resolution.policy.restriction_profile,
        ToolExecutionRestrictionProfile::WorkspacePathRequired
    );
    assert_eq!(
        resolution.restriction_profile_source,
        ToolExecutionPolicySource::Runtime
    );
    assert_eq!(
        resolution.policy.sandbox_profile,
        ToolExecutionSandboxProfile::WorkspaceCommand
    );
    assert_eq!(
        resolution.sandbox_profile_source,
        ToolExecutionPolicySource::Request
    );
}

#[test]
fn test_tool_execution_policy_service_request_shell_rule_overrides_runtime_rule() {
    let request_metadata = json!({
        "harness": {
            "executionPolicy": {
                "shellCommandRules": [
                    {
                        "ruleId": "runtime_git_push",
                        "pattern": "\\bgit\\s+push\\b",
                        "riskLevel": "high",
                        "reasonCode": "runtime_git_push_command",
                        "reason": "运行时策略标记 git push"
                    }
                ]
            },
            "requestExecutionPolicy": {
                "shellCommandRules": [
                    {
                        "ruleId": "request_git_push",
                        "pattern": "\\bgit\\s+push\\b",
                        "riskLevel": "high",
                        "reasonCode": "request_git_push_command",
                        "reason": "请求策略标记 git push"
                    }
                ]
            }
        }
    });
    let service = ToolExecutionPolicyService::new(ToolExecutionResolverInput {
        persisted_policy: None,
        request_metadata: Some(&request_metadata),
    });

    let rule_match = service
        .classify_shell_command("git push origin main")
        .expect("shell command should match request rule");

    assert_eq!(rule_match.rule_id, "request_git_push");
    assert_eq!(rule_match.source.label(), "request");
    assert_eq!(rule_match.reason_code, "request_git_push_command");
}

#[test]
fn test_tool_execution_policy_service_supports_prefix_and_exact_shell_rules() {
    let persisted_policy = ConfigToolExecutionPolicyConfig {
        shell_command_rules: vec![
            ConfigToolExecutionCommandRuleConfig {
                rule_id: "prefix_npm_publish".to_string(),
                match_type: ConfigToolExecutionCommandRuleMatchTypeConfig::Prefix,
                pattern: "npm publish".to_string(),
                risk_level: ConfigToolExecutionCommandRiskLevelConfig::High,
                reason_code: "prefix_npm_publish_command".to_string(),
                reason: "前缀策略标记 npm publish".to_string(),
            },
            ConfigToolExecutionCommandRuleConfig {
                rule_id: "exact_cargo_test".to_string(),
                match_type: ConfigToolExecutionCommandRuleMatchTypeConfig::Exact,
                pattern: "cargo test".to_string(),
                risk_level: ConfigToolExecutionCommandRiskLevelConfig::Low,
                reason_code: "exact_cargo_test_command".to_string(),
                reason: "精确策略标记 cargo test".to_string(),
            },
        ],
        ..Default::default()
    };
    let service = ToolExecutionPolicyService::new(ToolExecutionResolverInput {
        persisted_policy: Some(&persisted_policy),
        request_metadata: None,
    });

    let prefix_match = service
        .classify_shell_command(" npm publish --dry-run")
        .expect("prefix rule should match");
    assert_eq!(prefix_match.rule_id, "prefix_npm_publish");
    assert_eq!(prefix_match.risk_level.label(), "high");

    let exact_match = service
        .classify_shell_command(" cargo test ")
        .expect("exact rule should match");
    assert_eq!(exact_match.rule_id, "exact_cargo_test");
    assert!(service
        .classify_shell_command("cargo test --workspace")
        .is_none());
}

#[test]
fn test_resolve_tool_execution_policy_reads_runtime_override_from_nested_runtime_options() {
    let request_metadata = json!({
        "runtime_options": {
            "harness": {
                "executionPolicy": {
                    "toolOverrides": {
                        "exec_command": {
                            "warningPolicy": "none",
                            "sandboxProfile": "none"
                        }
                    }
                }
            }
        }
    });

    let resolution = resolve_tool_execution_policy_resolution(
        "exec_command",
        ToolExecutionResolverInput {
            persisted_policy: None,
            request_metadata: Some(&request_metadata),
        },
    );

    assert_eq!(
        resolution.policy.warning_policy,
        ToolExecutionWarningPolicy::None
    );
    assert_eq!(
        resolution.policy.sandbox_profile,
        ToolExecutionSandboxProfile::None
    );
    assert_eq!(
        resolution.warning_policy_source,
        ToolExecutionPolicySource::Runtime
    );
    assert_eq!(
        resolution.sandbox_profile_source,
        ToolExecutionPolicySource::Runtime
    );
}

#[test]
fn test_persisted_tool_execution_policy_from_metadata_reads_agent_config_shape() {
    let request_metadata = json!({
        "config": {
            "agent": {
                "toolExecution": {
                    "toolOverrides": {
                        "exec_command": {
                            "warningPolicy": "none",
                            "sandboxProfile": "none"
                        }
                    }
                }
            }
        }
    });

    let persisted_policy = persisted_tool_execution_policy_from_metadata(Some(&request_metadata))
        .expect("persisted tool execution policy");
    let resolution = resolve_tool_execution_policy_resolution(
        "exec_command",
        ToolExecutionResolverInput {
            persisted_policy: Some(&persisted_policy),
            request_metadata: None,
        },
    );

    assert_eq!(
        resolution.policy.warning_policy,
        ToolExecutionWarningPolicy::None
    );
    assert_eq!(
        resolution.policy.sandbox_profile,
        ToolExecutionSandboxProfile::None
    );
    assert_eq!(
        resolution.warning_policy_source,
        ToolExecutionPolicySource::Persisted
    );
    assert_eq!(
        resolution.sandbox_profile_source,
        ToolExecutionPolicySource::Persisted
    );
}

#[test]
fn test_resolve_tool_execution_policy_resolution_tracks_mixed_sources_per_field() {
    let persisted_policy = ConfigToolExecutionPolicyConfig {
        tool_overrides: HashMap::from([(
            "exec_command".to_string(),
            ConfigToolExecutionOverrideConfig {
                warning_policy: Some(ConfigToolExecutionWarningPolicyConfig::None),
                restriction_profile: None,
                sandbox_profile: None,
            },
        )]),
        ..Default::default()
    };
    let request_metadata = json!({
        "harness": {
            "executionPolicy": {
                "toolOverrides": {
                    "exec_command": {
                        "sandboxProfile": "none"
                    }
                }
            }
        }
    });

    let resolution = resolve_tool_execution_policy_resolution(
        "exec_command",
        ToolExecutionResolverInput {
            persisted_policy: Some(&persisted_policy),
            request_metadata: Some(&request_metadata),
        },
    );

    assert_eq!(
        resolution.policy.warning_policy,
        ToolExecutionWarningPolicy::None
    );
    assert_eq!(
        resolution.policy.restriction_profile,
        ToolExecutionRestrictionProfile::WorkspaceShellCommand
    );
    assert_eq!(
        resolution.policy.sandbox_profile,
        ToolExecutionSandboxProfile::None
    );
    assert_eq!(
        resolution.warning_policy_source,
        ToolExecutionPolicySource::Persisted
    );
    assert_eq!(
        resolution.restriction_profile_source,
        ToolExecutionPolicySource::Default
    );
    assert_eq!(
        resolution.sandbox_profile_source,
        ToolExecutionPolicySource::Runtime
    );
}
