use super::*;

/// Prepare one authenticated release with the same tar/manifest/store owner as explicit installs.
pub(super) async fn prepare(
    store: &PluginStore,
    context: &Context<'_>,
    item: Item,
    id: &PluginId,
) -> Result<install::PreparedPackage, String> {
    let version = item
        .release
        .version
        .as_deref()
        .map(str::trim)
        .filter(|version| !version.is_empty())
        .ok_or("remote plugin release version is missing")?
        .to_string();
    if !store::valid_version(&version) {
        return Err("invalid remote plugin release version".into());
    }
    let location = item
        .release
        .bundle_download_url
        .as_deref()
        .filter(|url| !url.is_empty())
        .ok_or("remote plugin bundle URL is missing")?;
    let download = crate::plugin_remote::bundle::download(location, &context.account).await?;
    context
        .ensure_current()
        .map_err(|error| error.to_string())?;
    let metadata = InstallMetadata {
        schema_version: 1,
        remote_plugin_id: item.id,
        account_id: crate::account::AccountManager::plugin_identity_for(&context.account),
        auth_policy: item.authentication_policy,
    };
    let store = store.clone();
    let id = id.clone();
    tokio::task::spawn_blocking(move || {
        let extracted = bundle::extract(download.path())?;
        preparation::prepare(
            extracted.path(),
            item.scope,
            &id.name,
            &version,
            &item.release,
        )?;
        // Root discovery deliberately matches Lime: nested package roots are rejected.
        manifest::read_manifest_with_name(extracted.path(), Some(&id.name))?;
        install::prepare_remote(&store, extracted.path(), &id, &version, &metadata)
    })
    .await
    .map_err(|_| "remote plugin staging task failed".to_string())?
}
