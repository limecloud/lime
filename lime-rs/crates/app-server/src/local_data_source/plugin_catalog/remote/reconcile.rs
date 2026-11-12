use super::*;
use app_server_protocol::protocol::v2::PluginReconcileResponse;

pub(crate) async fn reconcile(store: &PluginStore) -> Result<PluginReconcileResponse, String> {
    let Some(context) = Context::current(store.account.as_deref(), &store.config_path)
        .map_err(|e| e.to_string())?
    else {
        return Ok(Default::default());
    };
    let records = store.installed()?;
    let mut response = PluginReconcileResponse::default();
    // The local installation list is authoritative. Acquisition status is checked
    // without installing, enabling or removing packages on the user's behalf.
    for record in records.values() {
        let Some(metadata) = &record.remote else {
            continue;
        };
        let acquisition = context
            .get::<wire::Acquisition>(&format!("/market/acquisitions/{}", metadata.acquisition_id))
            .await;
        if !acquisition.is_ok_and(|a| {
            a.id == metadata.acquisition_id
                && a.release_id == metadata.release_id
                && a.status == "active"
                && a.revision > 0
        }) {
            response
                .failed_remote_plugin_ids
                .push(metadata.remote_plugin_id.clone());
        }
    }
    context.ensure_current().map_err(|e| e.to_string())?;
    Ok(response)
}
