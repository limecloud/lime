//! One administrator authority for config projections, settings and turn admission.

use super::{RuntimeCore, RuntimeCoreError};
use agent_protocol::WebSearchMode;
use app_server_protocol::{protocol::v2::ThreadSettingsUpdateParams, RuntimeOptions};
use lime_core::config::{
    layers::ConfigLayers,
    requirements::{system_requirements_path, ConfigRequirements},
    ApprovalPolicy, SandboxMode,
};
use serde_json::Value;
use std::path::Path;

impl RuntimeCore {
    pub(crate) fn read_config_requirements(
        &self,
    ) -> Result<Option<ConfigRequirements>, RuntimeCoreError> {
        read_config_requirements_at(self.requirements_path.as_deref())
    }

    pub(crate) fn validate_requirement_values(
        &self,
        approval: Option<&Value>,
        sandbox: Option<&Value>,
        search: Option<WebSearchMode>,
    ) -> Result<(), RuntimeCoreError> {
        let Some(requirements) = self.read_config_requirements()? else {
            return Ok(());
        };
        check_values(&requirements, approval, sandbox, search)
    }

    pub(crate) fn validate_metadata_requirements(
        &self,
        metadata: &Value,
    ) -> Result<(), RuntimeCoreError> {
        let Some(requirements) = self.read_config_requirements()? else {
            return Ok(());
        };
        let search = metadata
            .get("webSearchMode")
            .cloned()
            .map(serde_json::from_value)
            .transpose()
            .map_err(policy_error)?;
        check_values(
            &requirements,
            metadata.get("approvalPolicy"),
            metadata.get("sandboxPolicy"),
            search,
        )
    }

    pub(crate) fn validate_settings_requirements(
        &self,
        params: &ThreadSettingsUpdateParams,
    ) -> Result<(), RuntimeCoreError> {
        self.validate_requirement_values(
            params.approval_policy.as_ref(),
            params.sandbox_policy.as_ref(),
            None,
        )
    }

    pub(crate) fn enforce_command_requirements(
        &self,
        params: &mut app_server_protocol::protocol::v2::CommandExecParams,
    ) -> Result<(), RuntimeCoreError> {
        let Some(requirements) = self.read_config_requirements()? else {
            return Ok(());
        };
        if requirements.allowed_sandbox_modes.is_none() {
            return Ok(());
        }
        if params.sandbox_policy.is_none() {
            let mut config = lime_core::config::Config {
                sandbox_mode: SandboxMode::WorkspaceWrite,
                ..Default::default()
            };
            requirements.constrain_defaults(&mut config);
            params.sandbox_policy = Some(
                tool_runtime::sandbox::sandbox_policy_from_label(Some(
                    config.sandbox_mode.as_str(),
                ))
                .map_err(policy_error)?,
            );
        }
        let label = params
            .sandbox_policy
            .as_ref()
            .map(tool_runtime::sandbox::sandbox_policy_label)
            .unwrap_or("workspace-write");
        let mode: SandboxMode =
            serde_json::from_value(Value::String(label.into())).map_err(policy_error)?;
        requirements.check_sandbox(mode).map_err(policy_error)
    }

    pub(in crate::runtime) fn enforce_turn_requirements(
        &self,
        options: &mut Option<RuntimeOptions>,
    ) -> Result<(), RuntimeCoreError> {
        let Some(requirements) = self.read_config_requirements()? else {
            return Ok(());
        };
        let request = options.get_or_insert_default().runtime_request_mut();
        let cwd = request
            .working_dir
            .as_deref()
            .map(Path::new)
            .filter(|cwd| cwd.is_dir());
        let mut config = ConfigLayers::load(&self.app_config_path, cwd)
            .map_err(policy_error)?
            .effective;
        requirements.constrain_defaults(&mut config);
        if requirements.allowed_approval_policies.is_some() {
            request
                .approval_policy
                .get_or_insert_with(|| config.approval_policy.as_str().into());
        }
        if requirements.allowed_sandbox_modes.is_some() {
            request
                .sandbox_policy
                .get_or_insert_with(|| config.sandbox_mode.as_str().into());
        }
        if requirements.allowed_web_search_modes.is_some() {
            request.web_search_mode.get_or_insert_with(|| {
                config.web_search.unwrap_or_else(|| {
                    WebSearchMode::for_sandbox(request.sandbox_policy.as_deref())
                })
            });
        }
        check_values(
            &requirements,
            request
                .approval_policy
                .as_ref()
                .map(|value| Value::String(value.clone()))
                .as_ref(),
            request
                .sandbox_policy
                .as_ref()
                .map(|value| Value::String(value.clone()))
                .as_ref(),
            request.web_search_mode,
        )
    }
}

pub(super) fn read_config_requirements_at(
    path: Option<&Path>,
) -> Result<Option<ConfigRequirements>, RuntimeCoreError> {
    let path = path
        .map(|path| Ok(path.to_path_buf()))
        .unwrap_or_else(system_requirements_path)
        .map_err(policy_error)?;
    lime_core::config::managed::read_requirements(&path).map_err(policy_error)
}

fn check_values(
    requirements: &ConfigRequirements,
    approval: Option<&Value>,
    sandbox: Option<&Value>,
    search: Option<WebSearchMode>,
) -> Result<(), RuntimeCoreError> {
    if let Some(value) = approval.filter(|_| requirements.allowed_approval_policies.is_some()) {
        let value: ApprovalPolicy = serde_json::from_value(value.clone()).map_err(policy_error)?;
        requirements.check_approval(value).map_err(policy_error)?;
    }
    if let Some(value) = sandbox.filter(|_| requirements.allowed_sandbox_modes.is_some()) {
        let value: SandboxMode = serde_json::from_value(value.clone()).map_err(policy_error)?;
        requirements.check_sandbox(value).map_err(policy_error)?;
    }
    if let Some(value) = search {
        requirements.check_web_search(value).map_err(policy_error)?;
    }
    Ok(())
}

fn policy_error(error: impl std::fmt::Display) -> RuntimeCoreError {
    RuntimeCoreError::InvalidRequest(format!("Admin policy: {error}"))
}
