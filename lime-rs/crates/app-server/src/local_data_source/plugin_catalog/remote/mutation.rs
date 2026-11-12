use super::*;

pub(crate) async fn uninstall(
    store: &PluginStore,
    params: PluginUninstallParams,
) -> Result<PluginUninstallResponse, String> {
    let id = PluginId::parse(&params.plugin_id)?;
    if !is_marketplace(&id.marketplace) {
        return install::uninstall(store, params);
    }
    let _gate = gate::acquire(store).await?;
    // Uninstall changes local files and settings. It never revokes the Cloud acquisition.
    let context = Context::current(store.account.as_deref(), &store.config_path)
        .map_err(|e| e.to_string())?
        .ok_or("account_login_required")?;
    let account = context.account.clone();
    let store = store.clone();
    tokio::task::spawn_blocking(move || {
        install::remove(&store, &id, || ensure_account(&store, &account))
    })
    .await
    .map_err(|_| "plugin removal task failed".to_string())?
}
