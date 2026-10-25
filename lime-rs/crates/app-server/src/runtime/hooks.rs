use super::{RuntimeCore, RuntimeCoreError};
use app_server_protocol::protocol::v2::{
    HookErrorInfo, HookMetadata, HooksListEntry, HooksListParams, HooksListResponse,
};
use std::path::PathBuf;
use tool_runtime::hook_discovery::{discover_hooks, HookDiscoveryInput};

impl RuntimeCore {
    pub async fn list_hooks(
        &self,
        params: HooksListParams,
    ) -> Result<HooksListResponse, RuntimeCoreError> {
        let lime_home = lime_core::app_paths::resolve_lime_home_dir()
            .ok_or_else(|| RuntimeCoreError::Backend("cannot resolve LIME_HOME".to_string()))?;
        let cwds = if params.cwds.is_empty() {
            vec![std::env::current_dir().map_err(|error| {
                RuntimeCoreError::Backend(format!("cannot resolve current directory: {error}"))
            })?]
        } else {
            params.cwds
        };
        let plugins = self.app_data_source.load_plugin_hooks().await?;

        let data = cwds
            .into_iter()
            .map(|cwd| list_hooks_for_cwd(lime_home.clone(), cwd, &plugins))
            .collect();
        Ok(HooksListResponse { data })
    }
}

fn list_hooks_for_cwd(
    lime_home: PathBuf,
    cwd: PathBuf,
    plugins: &tool_runtime::hook_source::PluginHookLoadOutcome,
) -> HooksListEntry {
    let mut report = discover_hooks(&HookDiscoveryInput {
        lime_home,
        cwd: cwd.clone(),
        plugins: plugins.sources.clone(),
    });
    report.warnings.extend(plugins.warnings.iter().cloned());
    HooksListEntry {
        cwd,
        hooks: report
            .hooks
            .iter()
            .map(|hook| HookMetadata::from(&hook.snapshot))
            .collect(),
        warnings: report.warnings,
        errors: report
            .errors
            .into_iter()
            .map(|error| HookErrorInfo {
                path: error.path,
                message: error.message,
            })
            .collect(),
    }
}
