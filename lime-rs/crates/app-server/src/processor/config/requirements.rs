use super::*;
use app_server_protocol::protocol::v2::{
    AllowDenyRequirement, BrowserUseAccessApprovalLifetime, BrowserUseExtensionRequirements,
    BrowserUseOriginPolicy, BrowserUseRequirements, ConfigRequirements,
    ConfigRequirementsReadParams, ConfigRequirementsReadResponse, InAppBrowserRequirements,
    RequestHeader,
};

impl RequestProcessor {
    pub(in crate::processor) async fn handle_config_requirements_read_impl(
        &self,
        params: Option<Value>,
    ) -> Result<RpcDispatch, JsonRpcError> {
        self.ensure_initialized()?;
        let _: ConfigRequirementsReadParams = parse_params(params)?;
        let requirements = self
            .runtime
            .read_config_requirements()
            .map_err(super::super::to_jsonrpc_error)?
            .map(|requirements| ConfigRequirements {
                allowed_approval_policies: requirements.allowed_approval_policies.map(|values| {
                    values
                        .into_iter()
                        .map(|value| value.as_str().to_owned())
                        .collect()
                }),
                allowed_sandbox_modes: requirements.allowed_sandbox_modes.map(|values| {
                    values
                        .into_iter()
                        .map(|value| value.as_str().to_owned())
                        .collect()
                }),
                allowed_web_search_modes: requirements.allowed_web_search_modes.map(|values| {
                    values
                        .into_iter()
                        .map(|value| {
                            match value {
                                agent_protocol::WebSearchMode::Disabled => "disabled",
                                agent_protocol::WebSearchMode::Cached => "cached",
                                agent_protocol::WebSearchMode::Indexed => "indexed",
                                agent_protocol::WebSearchMode::Live => "live",
                            }
                            .to_owned()
                        })
                        .collect()
                }),
                allow_browser_and_computer_use: requirements.allow_browser_and_computer_use,
                browser_use: requirements
                    .browser_use
                    .map(|browser| BrowserUseRequirements {
                        extension: browser.extension.map(|extension| {
                            BrowserUseExtensionRequirements {
                                request_headers: extension.request_headers.map(|headers| {
                                    headers
                                        .into_iter()
                                        .map(|header| RequestHeader {
                                            name: header.name,
                                            value: header.value,
                                        })
                                        .collect()
                                }),
                            }
                        }),
                        allow_webmcp: browser.allow_webmcp,
                        allow_history_access: browser.allow_history_access,
                        disable_auto_review: browser.disable_auto_review,
                        allow_global_persistent_approval: browser.allow_global_persistent_approval,
                        default_origin_policy: browser.default_origin_policy.map(browser_origin),
                        origins: browser.origins.map(|origins| {
                            origins
                                .into_iter()
                                .map(|(pattern, policy)| (pattern, browser_origin(policy)))
                                .collect()
                        }),
                    }),
                in_app_browser: requirements.in_app_browser.map(|requirements| {
                    InAppBrowserRequirements {
                        allow_external_browser_settings_import: requirements
                            .allow_external_browser_settings_import,
                    }
                }),
            });
        dispatch_result(ConfigRequirementsReadResponse { requirements })
    }
}

fn browser_origin(policy: lime_core::config::BrowserUseOriginPolicyToml) -> BrowserUseOriginPolicy {
    use lime_core::config::{
        AllowDenyRequirementToml as D, BrowserUseAccessApprovalLifetimeToml as L,
    };
    let decision = |value| match value {
        D::Allow => AllowDenyRequirement::Allow,
        D::Deny => AllowDenyRequirement::Deny,
    };
    BrowserUseOriginPolicy {
        access: policy.access.map(decision),
        downloads: policy.downloads.map(decision),
        uploads: policy.uploads.map(decision),
        full_cdp_access: policy.full_cdp_access.map(decision),
        auto_review: policy.auto_review.map(decision),
        persistent_approval: policy.persistent_approval,
        access_approval_lifetime: policy.access_approval_lifetime.map(|value| match value {
            L::Turn => BrowserUseAccessApprovalLifetime::Turn,
            L::Thread => BrowserUseAccessApprovalLifetime::Thread,
        }),
    }
}

pub(super) fn check_edits(
    requirements: Option<&lime_core::config::requirements::ConfigRequirements>,
    edits: &[ConfigEdit],
) -> Result<(), JsonRpcError> {
    let Some(requirements) = requirements else {
        return Ok(());
    };
    let check = || -> Result<(), String> {
        for edit in edits {
            // Null removes a local override; inherited defaults are constrained at read/admission.
            if edit.value.is_null() {
                continue;
            }
            match edit.key_path.as_str() {
                "approval_policy" => requirements
                    .check_approval(
                        serde_json::from_value(edit.value.clone())
                            .map_err(|error| error.to_string())?,
                    )
                    .map_err(|error| error.to_string())?,
                "sandbox_mode" => requirements
                    .check_sandbox(
                        serde_json::from_value(edit.value.clone())
                            .map_err(|error| error.to_string())?,
                    )
                    .map_err(|error| error.to_string())?,
                "web_search" => requirements
                    .check_web_search(
                        serde_json::from_value(edit.value.clone())
                            .map_err(|error| error.to_string())?,
                    )
                    .map_err(|error| error.to_string())?,
                _ => {}
            }
        }
        Ok(())
    };
    check()
        .map_err(|error| config_write_error(ConfigWriteErrorCode::ConfigRequirementReadonly, error))
}
