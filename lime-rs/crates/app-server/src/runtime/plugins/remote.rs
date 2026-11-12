use super::{RuntimeCore, RuntimeCoreError};
use crate::plugin_remote::{wire, Context};
use app_server_protocol::protocol::v2::{
    MarketplaceInterface, PluginListMarketplaceKind, PluginListParams, PluginMarketplaceEntry,
    PluginReadParams, PluginReadResponse,
};
use std::collections::{BTreeMap, BTreeSet};
mod projection;
mod skill;
pub(super) use skill::read as read_skill;

pub(super) async fn list(
    runtime: &RuntimeCore,
    params: &PluginListParams,
) -> Result<Vec<PluginMarketplaceEntry>, RuntimeCoreError> {
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
        return if params.marketplace_kinds.is_some() {
            Err(RuntimeCoreError::InvalidRequest(
                "account_login_required".into(),
            ))
        } else {
            Ok(Vec::new())
        };
    };
    let installed = runtime
        .app_data_source
        .list_installed_plugins(Default::default())
        .await?
        .marketplaces
        .into_iter()
        .flat_map(|m| m.plugins)
        .map(|p| (p.id.clone(), p))
        .collect::<BTreeMap<_, _>>();
    let mut groups = BTreeMap::<String, Vec<_>>::new();
    let mut cursor = String::new();
    let mut cursors = BTreeSet::new();
    let mut ids = BTreeSet::new();
    for _ in 0..100 {
        let path = {
        let mut query = url::form_urlencoded::Serializer::new(String::new());
        query
            .append_pair("kind", "plugin")
            .append_pair("limit", "50")
            .append_pair("hostId", "lime")
            .append_pair("hostVersion", env!("CARGO_PKG_VERSION"));
        for capability in wire::CAPABILITIES {
            query.append_pair("capability", capability);
        }
        if !cursor.is_empty() {
            query.append_pair("cursor", &cursor);
        }
        format!("/market/items?{}", query.finish())
        };
        let page: wire::Directory = context.get(&path).await?;
        if page.items.len() > 50 {
            return Err(invalid());
        }
        for item in page.items {
            item.validate()?;
            if !ids.insert(item.id.clone()) || ids.len() > 5000 {
                return Err(invalid());
            }
            let mut summary = item.summary(&context.language);
            if let Some(local) = installed
                .get(&summary.id)
                .filter(|local| local.remote_plugin_id.as_deref() == Some(&item.id))
            {
                summary.installed = true;
                summary.enabled = local.enabled;
                summary.local_version = local.local_version.clone();
                summary.installed_at = local.installed_at;
            }
            groups.entry(item.marketplace()).or_default().push(summary);
        }
        if page.next_cursor.is_empty() {
            context.ensure_current()?;
            return Ok(groups
                .into_iter()
                .map(|(name, plugins)| PluginMarketplaceEntry {
                    name,
                    path: None,
                    interface: Some(MarketplaceInterface {
                        display_name: Some("Lime Cloud".into()),
                    }),
                    plugins,
                })
                .collect());
        }
        if page.next_cursor.len() > 1024 || !cursors.insert(page.next_cursor.clone()) {
            return Err(invalid());
        }
        cursor = page.next_cursor;
    }
    Err(invalid())
}

pub(super) async fn read(
    runtime: &RuntimeCore,
    params: PluginReadParams,
) -> Result<PluginReadResponse, RuntimeCoreError> {
    wire::validate_remote_id(&params.plugin_name)?;
    let context =
        Context::current(runtime.account_manager.as_deref(), &runtime.app_config_path)?
            .ok_or_else(|| RuntimeCoreError::InvalidRequest("account_login_required".into()))?;
    let item: wire::Item = context
        .get(&format!("/market/items/{}", params.plugin_name))
        .await?;
    item.validate()?;
    if item.id != params.plugin_name
        || params.remote_marketplace_name.as_deref() != Some(&item.marketplace())
    {
        return Err(invalid());
    }
    let mut detail = item.detail(&context.language);
    let installed = runtime
        .app_data_source
        .list_installed_plugins(Default::default())
        .await?;
    if installed
        .marketplaces
        .iter()
        .flat_map(|m| &m.plugins)
        .any(|p| p.id == detail.summary.id && p.remote_plugin_id.as_deref() == Some(&item.id))
    {
        let local = runtime.app_data_source.read_plugin(params).await?;
        detail = local.plugin;
    }
    context.ensure_current()?;
    Ok(PluginReadResponse { plugin: detail })
}
fn invalid() -> RuntimeCoreError {
    RuntimeCoreError::Backend("invalid shared plugin catalog".into())
}
