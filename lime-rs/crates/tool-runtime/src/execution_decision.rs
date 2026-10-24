use crate::execution_policy::{
    ToolExecutionPolicyResolution, ToolExecutionSandboxProfile, ToolExecutionWarningPolicy,
};
use crate::execution_policy_service::{ToolExecutionPolicyService, ToolExecutionResolverInput};
use crate::sandbox::{
    command_text, evaluate_sandbox, plan_sandbox_backend, requested_sandbox_policy_label,
    SandboxBackend, SandboxBackendPlan, SandboxBackendPlanInput, SandboxBackendPlatform,
    SandboxEvaluation, SandboxEvaluationInput,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value as JsonValue};
use std::collections::HashMap;
use std::path::Path;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ToolExecutionDecisionKind {
    Allow,
    RequiresApproval,
    Deny,
    SandboxBlocked,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ToolExecutionDecision {
    pub kind: ToolExecutionDecisionKind,
    pub reason_code: String,
    pub reason: String,
    pub policy_resolution: ToolExecutionPolicyResolution,
    pub metadata: HashMap<String, JsonValue>,
}

#[derive(Debug, Clone, Copy)]
pub struct ToolExecutionDecisionInput<'a> {
    pub tool_name: &'a str,
    pub params: &'a JsonValue,
    pub working_directory: &'a Path,
    pub surface: &'a str,
    pub auto_mode: bool,
    pub bypass_restrictions: bool,
    pub approval_policy: Option<&'a str>,
    pub requested_sandbox_policy: Option<&'a str>,
    pub resolver_input: ToolExecutionResolverInput<'a>,
}

#[derive(Debug, Clone, Copy)]
pub struct ToolExecutionPolicyDecisionOptions {
    pub default_policy_for_tool: fn(&str) -> crate::execution_policy::ToolExecutionPolicy,
    pub tool_names_match: fn(&str, &str) -> bool,
}

impl ToolExecutionDecision {
    pub fn allowed(&self) -> bool {
        self.kind == ToolExecutionDecisionKind::Allow
    }

    pub fn requires_approval(&self) -> bool {
        self.kind == ToolExecutionDecisionKind::RequiresApproval
    }

    pub fn workspace_sandbox_backend_enforced(&self) -> bool {
        metadata_bool(&self.metadata, "sandboxBackendEnforced")
    }

    pub fn requires_sandboxed_execution(&self) -> bool {
        metadata_bool(&self.metadata, "sandboxBackendRequired")
            || self.workspace_sandbox_backend_enforced()
    }

    pub fn sandbox_backend(&self) -> Option<SandboxBackend> {
        match self
            .metadata
            .get("sandboxBackend")
            .and_then(JsonValue::as_str)
        {
            Some("seatbelt") => Some(SandboxBackend::Seatbelt),
            Some("linux_sandbox") => Some(SandboxBackend::LinuxSandbox),
            Some("restricted_token") => Some(SandboxBackend::RestrictedToken),
            Some("none") => Some(SandboxBackend::None),
            _ => None,
        }
    }
}

pub fn decide_tool_execution(
    input: ToolExecutionDecisionInput<'_>,
    service_options: ToolExecutionPolicyDecisionOptions,
) -> ToolExecutionDecision {
    let policy_service = ToolExecutionPolicyService::new(
        input.resolver_input,
        crate::execution_policy_service::ToolExecutionPolicyServiceOptions {
            default_policy_for_tool: service_options.default_policy_for_tool,
            tool_names_match: service_options.tool_names_match,
        },
    );
    let resolution = policy_service.resolve(input.tool_name);
    let mut metadata =
        policy_service.metadata_for_resolution(input.tool_name, input.surface, resolution);
    metadata.insert(
        "decisionOwner".to_string(),
        json!("workspace_tool_execution"),
    );
    metadata.insert("decisionKind".to_string(), json!("allow"));
    metadata.insert("reasonCode".to_string(), json!("allowed"));
    metadata.insert("reason".to_string(), json!("tool execution allowed"));
    metadata.insert("platform".to_string(), json!(std::env::consts::OS));
    metadata.insert("arch".to_string(), json!(std::env::consts::ARCH));
    metadata.insert(
        "cwd".to_string(),
        json!(input.working_directory.to_string_lossy().to_string()),
    );

    let command = command_text(input.params);
    if let Some(command) = command.as_deref() {
        if let Some(command_rule) = policy_service.classify_shell_command(command) {
            metadata.insert("commandRuleId".to_string(), json!(command_rule.rule_id));
            metadata.insert(
                "commandRuleSource".to_string(),
                json!(command_rule.source.label()),
            );
            metadata.insert(
                "commandRiskLevel".to_string(),
                json!(command_rule.risk_level.label()),
            );
            metadata.insert(
                "commandRiskReasonCode".to_string(),
                json!(command_rule.reason_code),
            );
            metadata.insert("commandRiskReason".to_string(), json!(command_rule.reason));
        }
        metadata.insert("command".to_string(), json!(command));
    }
    if let Some(network_rule) =
        policy_service.classify_network_access(input.tool_name, input.params, command.as_deref())
    {
        metadata.insert("networkRuleId".to_string(), json!(network_rule.rule_id));
        metadata.insert(
            "networkRuleSource".to_string(),
            json!(network_rule.source.label()),
        );
        metadata.insert(
            "networkRiskLevel".to_string(),
            json!(network_rule.risk_level.label()),
        );
        metadata.insert(
            "networkRiskReasonCode".to_string(),
            json!(network_rule.reason_code),
        );
        metadata.insert("networkRiskReason".to_string(), json!(network_rule.reason));
        metadata.insert(
            "networkRuleTarget".to_string(),
            json!(network_rule.target.label()),
        );
        metadata.insert("networkUrl".to_string(), json!(network_rule.url));
        if let Some(host) = network_rule.host {
            metadata.insert("networkHost".to_string(), json!(host));
        }
    }
    if let Some(approval_policy) = input.approval_policy {
        metadata.insert("approvalPolicy".to_string(), json!(approval_policy));
    }
    if let Some(sandbox_policy) = input.requested_sandbox_policy {
        metadata.insert("requestedSandboxPolicy".to_string(), json!(sandbox_policy));
    }
    let sandbox_backend_plan = plan_sandbox_backend(SandboxBackendPlanInput {
        sandbox_profile: resolution.policy.sandbox_profile,
        requested_policy: input.requested_sandbox_policy,
        request_metadata: input.resolver_input.request_metadata,
        bypass_restrictions: input.bypass_restrictions,
        platform: SandboxBackendPlatform::current(),
    });
    insert_sandbox_backend_metadata(&mut metadata, sandbox_backend_plan);

    if input.bypass_restrictions {
        return build_decision(
            ToolExecutionDecisionKind::Allow,
            "full_access_allowed",
            "full-access 允许工具执行",
            resolution,
            metadata,
        );
    }

    if sandbox_backend_plan.strict_fallback_blocks_execution() {
        metadata.insert(
            "sandboxPolicy".to_string(),
            json!(requested_sandbox_policy_label(
                input.requested_sandbox_policy
            )),
        );
        metadata.insert(
            "sandboxReason".to_string(),
            json!(sandbox_backend_plan.reason),
        );
        return build_decision(
            ToolExecutionDecisionKind::SandboxBlocked,
            "workspace_sandbox_strict_backend_unavailable",
            "workspace sandbox 严格模式要求可执行的沙箱后端",
            resolution,
            metadata,
        );
    }

    if let SandboxEvaluation::Block(block) = evaluate_sandbox(SandboxEvaluationInput {
        sandbox_profile: resolution.policy.sandbox_profile,
        requested_policy: input.requested_sandbox_policy,
        params: input.params,
    }) {
        metadata.insert("sandboxPolicy".to_string(), json!(block.policy.label()));
        metadata.insert("sandboxReason".to_string(), json!(block.diagnostic));
        return build_decision(
            ToolExecutionDecisionKind::SandboxBlocked,
            block.reason_code,
            block.reason,
            resolution,
            metadata,
        );
    }

    if input.auto_mode {
        return build_decision(
            ToolExecutionDecisionKind::Allow,
            "auto_mode_allowed",
            "Auto 模式允许工具执行",
            resolution,
            metadata,
        );
    }

    if should_require_approval(&resolution, input.approval_policy) {
        return build_decision(
            ToolExecutionDecisionKind::RequiresApproval,
            "shell_command_requires_approval",
            "Shell 命令需要人工确认后执行",
            resolution,
            metadata,
        );
    }

    build_decision(
        ToolExecutionDecisionKind::Allow,
        "allowed",
        "工具执行策略允许继续",
        resolution,
        metadata,
    )
}

fn insert_sandbox_backend_metadata(
    metadata: &mut HashMap<String, JsonValue>,
    plan: SandboxBackendPlan,
) {
    metadata.insert("sandboxBackend".to_string(), json!(plan.backend.label()));
    metadata.insert(
        "sandboxBackendStatus".to_string(),
        json!(plan.status.label()),
    );
    metadata.insert("sandboxBackendEnforced".to_string(), json!(plan.enforced));
    metadata.insert("sandboxBackendRequired".to_string(), json!(plan.required));
    metadata.insert(
        "sandboxBackendReasonCode".to_string(),
        json!(plan.reason_code),
    );
    metadata.insert("sandboxBackendReason".to_string(), json!(plan.reason));
    metadata.insert(
        "sandboxBackendPlatform".to_string(),
        json!(plan.platform.label()),
    );
    metadata.insert(
        "workspaceSandboxEnabled".to_string(),
        json!(plan.config.enabled),
    );
    metadata.insert(
        "workspaceSandboxStrict".to_string(),
        json!(plan.config.strict),
    );
    metadata.insert(
        "workspaceSandboxNotifyOnFallback".to_string(),
        json!(plan.config.notify_on_fallback),
    );
    metadata.insert(
        "workspaceSandboxConfigSource".to_string(),
        json!(plan.config.source.label()),
    );
}

fn build_decision(
    kind: ToolExecutionDecisionKind,
    reason_code: &str,
    reason: &str,
    policy_resolution: ToolExecutionPolicyResolution,
    mut metadata: HashMap<String, JsonValue>,
) -> ToolExecutionDecision {
    metadata.insert("decisionKind".to_string(), json!(kind));
    metadata.insert("reasonCode".to_string(), json!(reason_code));
    metadata.insert("reason".to_string(), json!(reason));

    ToolExecutionDecision {
        kind,
        reason_code: reason_code.to_string(),
        reason: reason.to_string(),
        policy_resolution,
        metadata,
    }
}

fn metadata_bool(metadata: &HashMap<String, JsonValue>, key: &str) -> bool {
    metadata.get(key).and_then(JsonValue::as_bool) == Some(true)
}

fn should_require_approval(
    resolution: &ToolExecutionPolicyResolution,
    approval_policy: Option<&str>,
) -> bool {
    resolution.policy.warning_policy == ToolExecutionWarningPolicy::ShellCommandRisk
        && resolution.policy.sandbox_profile == ToolExecutionSandboxProfile::WorkspaceCommand
        && matches!(
            normalize_policy_label(approval_policy).as_deref(),
            Some(
                "on_request"
                    | "on-request"
                    | "unless_trusted"
                    | "unless-trusted"
                    | "untrusted"
                    | "granular"
            )
        )
}

fn normalize_policy_label(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_ascii_lowercase())
}
