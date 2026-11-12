use super::*;
use app_server_protocol::protocol::v2::{PluginSkillReadParams, PluginSkillReadResponse};
use tokio::io::AsyncReadExt;

pub(crate) async fn read(
    runtime: &RuntimeCore,
    params: PluginSkillReadParams,
) -> Result<PluginSkillReadResponse, RuntimeCoreError> {
    if !wire::is_marketplace(&params.remote_marketplace_name) {
        return Err(invalid());
    }
    let context =
        Context::current(runtime.account_manager.as_deref(), &runtime.app_config_path)?
            .ok_or_else(|| RuntimeCoreError::InvalidRequest("account_login_required".into()))?;
    let detail = runtime
        .app_data_source
        .read_plugin(PluginReadParams {
            marketplace_path: None,
            remote_marketplace_name: Some(params.remote_marketplace_name),
            plugin_name: params.remote_plugin_id,
        })
        .await?;
    let path = detail
        .plugin
        .skills
        .iter()
        .find(|s| s.name == params.skill_name)
        .and_then(|s| s.path.as_ref())
        .ok_or_else(|| RuntimeCoreError::InvalidRequest("installed skill not found".into()))?;
    let mut bytes = Vec::new();
    tokio::fs::File::open(path)
        .await
        .map_err(|_| invalid())?
        .take(2 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .await
        .map_err(|_| invalid())?;
    if bytes.len() > 2 * 1024 * 1024 {
        return Err(invalid());
    }
    context.ensure_current()?;
    Ok(PluginSkillReadResponse {
        contents: Some(String::from_utf8(bytes).map_err(|_| invalid())?),
    })
}
