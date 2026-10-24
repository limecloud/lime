use super::*;

pub(super) fn orchestrated_sandbox(
    attempt: &RuntimeToolExecutionAttempt,
    runtime_metadata: Option<&serde_json::Value>,
) -> Result<Option<LocalExecutionSandbox>, ExecutionProcessError> {
    if let Some(policy) = attempt.internal_agent_policy() {
        use app_server_protocol::protocol::v2::SandboxPolicy;
        if matches!(
            policy.sandbox(),
            SandboxPolicy::DangerFullAccess | SandboxPolicy::ExternalSandbox { .. }
        ) {
            return Ok(None);
        }
        let backend = match std::env::consts::OS {
            "macos" => tool_runtime::sandbox::SandboxBackend::Seatbelt,
            "linux" => tool_runtime::sandbox::SandboxBackend::LinuxSandbox,
            "windows" => tool_runtime::sandbox::SandboxBackend::RestrictedToken,
            _ => {
                return Err(ExecutionProcessError::Sandbox(
                    "memory sandbox unavailable".to_string(),
                ))
            }
        };
        return Ok(Some(LocalExecutionSandbox {
            backend,
            policy: policy.sandbox().clone(),
            granted_permissions: None,
            windows_mode: None,
        }));
    }
    let effective_policy = attempt.effective_sandbox_policy();
    if matches!(
        effective_policy,
        RuntimeToolSandboxPolicy::None | RuntimeToolSandboxPolicy::DangerFullAccess
    ) {
        return Ok(None);
    }
    let plan = plan_sandbox_backend(SandboxBackendPlanInput {
        sandbox_profile: ToolExecutionSandboxProfile::WorkspaceCommand,
        requested_policy: effective_policy.label(),
        request_metadata: runtime_metadata,
        bypass_restrictions: false,
        platform: SandboxBackendPlatform::current(),
    });
    if plan.strict_fallback_blocks_execution() {
        return Err(ExecutionProcessError::SandboxDenied {
            reason_code: plan.reason_code.to_string(),
            message: plan.reason.to_string(),
        });
    }
    if let Some(host) = attempt.managed_network_host() {
        let network_granted = attempt
            .granted_permissions()
            .network
            .as_ref()
            .and_then(|network| network.enabled)
            .unwrap_or(false);
        if !network_granted {
            return Err(ExecutionProcessError::ManagedNetworkDenied {
                reason_code: "managed_network_denied".to_string(),
                message: format!("network access to '{host}' is blocked by managed policy"),
                host: Some(host.to_string()),
            });
        }
    }
    if !plan.can_run_with_backend() {
        return Ok(None);
    }
    Ok(Some(LocalExecutionSandbox {
        backend: plan.backend,
        policy: {
            let mut policy =
                tool_runtime::sandbox::sandbox_policy_from_label(effective_policy.label())
                    .map_err(|error| ExecutionProcessError::Sandbox(error.to_string()))?;
            if let app_server_protocol::protocol::v2::SandboxPolicy::WorkspaceWrite {
                network_access,
                ..
            } = &mut policy
            {
                *network_access = attempt.sandbox_network_access();
            }
            policy
        },
        granted_permissions: Some(attempt.granted_permissions().clone()),
        windows_mode: plan.config.windows_mode,
    }))
}
