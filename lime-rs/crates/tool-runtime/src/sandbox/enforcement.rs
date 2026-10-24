use super::{
    parse_requested_sandbox_policy, RequestedSandboxPolicy, SandboxBackendConfigSource,
    ToolExecutionSandboxProfile, WorkspaceSandboxRuntimeConfig,
};

pub(super) fn require_requested_sandbox(
    config: &mut WorkspaceSandboxRuntimeConfig,
    profile: ToolExecutionSandboxProfile,
    requested: Option<&str>,
) {
    if profile == ToolExecutionSandboxProfile::WorkspaceCommand
        && matches!(
            parse_requested_sandbox_policy(requested),
            Some(RequestedSandboxPolicy::ReadOnly | RequestedSandboxPolicy::WorkspaceWrite)
        )
    {
        config.enabled = true;
        config.strict = true;
        config.source = SandboxBackendConfigSource::SandboxPolicy;
    }
}

#[cfg(test)]
mod tests {
    use super::super::*;
    use serde_json::json;

    #[test]
    fn explicit_restricted_policy_cannot_be_disabled_and_unavailable_backend_blocks() {
        let disabled = json!({"workspaceSandbox":{"enabled":false,"strict":false}});
        for policy in ["read-only", "workspace-write"] {
            let plan = plan_sandbox_backend(SandboxBackendPlanInput {
                sandbox_profile: ToolExecutionSandboxProfile::WorkspaceCommand,
                requested_policy: Some(policy),
                request_metadata: Some(&disabled),
                bypass_restrictions: false,
                platform: SandboxBackendPlatform::Unsupported,
            });
            assert_eq!(plan.status, SandboxBackendStatus::Unavailable);
            assert!(plan.required && plan.config.enabled && plan.config.strict);
            assert!(!plan.can_run_with_backend());
            assert!(plan.strict_fallback_blocks_execution());
            assert_eq!(
                plan.config.source,
                SandboxBackendConfigSource::SandboxPolicy
            );
        }
    }
}
