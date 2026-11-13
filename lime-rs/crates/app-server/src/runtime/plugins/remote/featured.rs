use super::*;
use app_server_protocol::protocol::v2::PluginSearchResult;
use serde::Deserialize;

#[derive(Deserialize)]
struct Featured {
    revision: u64,
    items: Vec<wire::Release>,
}

pub(crate) async fn list(
    runtime: &RuntimeCore,
    params: &PluginListParams,
) -> Result<Vec<PluginSearchResult>, RuntimeCoreError> {
    if params
        .marketplace_kinds
        .as_ref()
        .is_some_and(|kinds| !kinds.contains(&PluginListMarketplaceKind::Cloud))
    {
        return Ok(Vec::new());
    }
    let Some(context) =
        Context::current(runtime.account_manager.as_deref(), &runtime.app_config_path)?
    else {
        return Ok(Vec::new());
    };
    let featured: Featured = context.get("/market/featured").await?;
    if featured.items.len() > 20 || featured.revision == 0 && !featured.items.is_empty() {
        return Err(invalid());
    }
    let installed = runtime
        .app_data_source
        .list_installed_plugins(Default::default())
        .await?;
    let mut seen = BTreeSet::new();
    let mut results = Vec::new();
    for release in featured.items {
        if !seen.insert(release.item_id.clone()) {
            return Err(invalid());
        }
        if release.manifest.kind != "plugin" {
            continue;
        }
        release.validate()?;
        // Core selects the version; current Cloud visibility supplies its publisher and item revision.
        wire::validate_remote_id(&release.item_id)?;
        let item: wire::Item = context
            .get(&format!(
                "/market/items/{}?{}",
                release.item_id,
                wire::host_query()
            ))
            .await?;
        let selection = Selection { item, release };
        selection.validate_plugin()?;
        let mut plugin = selection.summary(&context.language);
        if let Some(local) = installed
            .marketplaces
            .iter()
            .flat_map(|m| &m.plugins)
            .find(|p| p.id == plugin.id && p.remote_plugin_id == plugin.remote_plugin_id)
        {
            plugin.installed = true;
            plugin.enabled = local.enabled;
            plugin.installed_at = local.installed_at;
            plugin.local_version = local.local_version.clone();
            plugin.local_release = local.local_release.clone();
        }
        results.push(PluginSearchResult {
            plugin,
            marketplace_name: selection.item.marketplace(),
            marketplace_path: None,
        });
    }
    context.ensure_current()?;
    Ok(results)
}
