use super::*;
use crate::plugin_remote::{
    wire::{Item, Scope},
    Context,
};
use app_server_protocol::protocol::v2::{Account, GetAccountParams};
use serde::{Deserialize, Serialize};

const METADATA_FILE: &str = ".lime-remote-plugin-install.json";
const MAX_METADATA_BYTES: u64 = 16 * 1024;

pub(super) mod gate;
mod mutation;
mod package;
mod preparation;
mod reconcile;
pub(super) mod state;
pub(crate) use mutation::uninstall;
pub(crate) use reconcile::reconcile;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(super) struct InstallMetadata {
    pub schema_version: u32,
    pub remote_plugin_id: String,
    pub account_id: String,
    pub auth_policy: PluginAuthPolicy,
}

pub(super) fn is_marketplace(name: &str) -> bool {
    Scope::from_marketplace(name).is_ok()
}

pub(super) fn metadata(base: &Path) -> Result<Option<InstallMetadata>, String> {
    let path = base.join(METADATA_FILE);
    let file = match fs::File::open(&path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("读取 Plugin provenance 失败: {error}")),
    };
    if fs::symlink_metadata(path)
        .map_err(io_error("读取 Plugin provenance 元数据失败"))?
        .file_type()
        .is_symlink()
    {
        return Err("Plugin provenance 禁止符号链接。".into());
    }
    let mut bytes = Vec::new();
    file.take(MAX_METADATA_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(io_error("读取 Plugin provenance 失败"))?;
    if bytes.len() as u64 > MAX_METADATA_BYTES {
        return Err("Plugin provenance 超过大小限制。".into());
    }
    let value: InstallMetadata =
        serde_json::from_slice(&bytes).map_err(|_| "Plugin provenance 不合法。")?;
    if value.schema_version != 1
        || crate::plugin_remote::wire::validate_remote_id(&value.remote_plugin_id).is_err()
        || value.account_id.len() != 64
        || !value
            .account_id
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit())
    {
        return Err("Plugin provenance identity 不合法。".into());
    }
    Ok(Some(value))
}

pub(super) fn write_metadata(base: &Path, metadata: &InstallMetadata) -> Result<(), String> {
    let bytes = serde_json::to_vec(metadata).map_err(|_| "序列化 Plugin provenance 失败。")?;
    if bytes.len() as u64 > MAX_METADATA_BYTES {
        return Err("Plugin provenance 超过大小限制。".into());
    }
    fs::write(base.join(METADATA_FILE), bytes).map_err(io_error("暂存 Plugin provenance 失败"))
}

pub(crate) async fn install(
    store: &PluginStore,
    params: PluginInstallParams,
) -> Result<PluginInstallResponse, String> {
    let _gate = gate::acquire(store).await?;
    if params.remote_marketplace_name.is_none() {
        return Err("remote marketplace required".into());
    }
    crate::plugin_remote::wire::validate_remote_id(&params.plugin_name)
        .map_err(|error| error.to_string())?;
    let context = Context::current(store.account.as_deref())
        .map_err(|error| error.to_string())?
        .ok_or("authentication required for remote plugin install")?;
    let item: Item = context
        .get(&format!("{}?includeDownloadUrls=true", params.plugin_name))
        .await
        .map_err(|error| error.to_string())?;
    item.validate(None).map_err(|error| error.to_string())?;
    if item.id != params.plugin_name {
        return Err("remote plugin detail identity does not match request".into());
    }
    if item.installation_policy == PluginInstallPolicy::NotAvailable
        || item.status != PluginAvailability::Available
    {
        return Err("remote plugin is not available for installation".into());
    }
    let id = PluginId::new(&item.name, item.marketplace())?;
    let auth_policy = item.authentication_policy;
    let mut summary = item.summary();
    summary.installed = true;
    summary.enabled = true;
    let prepared = package::prepare(store, &context, item, &id).await?;
    // A malformed or unmaterializable bundle must not create a backend installation.
    let needing_auth = context
        .install(&params.plugin_name, params.install_attempt_id.as_deref())
        .await
        .map_err(|error| error.to_string())?;
    let account = context.account.clone();
    let store = store.clone();
    tokio::task::spawn_blocking(move || {
        let mut components = prepared.commit(|| {
            ensure_account(&store, &account)?;
            state::edit(
                &store,
                &crate::account::AccountManager::plugin_identity_for(&account),
                &id,
                Some(summary),
                || store.set_enabled(&id, true),
            )
        })?;
        if let Some(ids) = needing_auth {
            components.apps.retain(|app| ids.contains(&app.id));
        }
        Ok(PluginInstallResponse {
            auth_policy,
            apps_needing_auth: components.apps,
        })
    })
    .await
    .map_err(|_| "remote plugin commit task failed".to_string())?
}

pub(super) fn ensure_account(store: &PluginStore, expected: &Account) -> Result<(), String> {
    let current = store
        .account
        .as_ref()
        .ok_or("account storage unavailable")?
        .read(GetAccountParams::default())?
        .account;
    if current.as_ref() != Some(expected) || store.remote_identity()?.is_none() {
        return Err("account changed while changing remote plugins".into());
    }
    Ok(())
}

pub(super) fn installed_summary(record: &Installation) -> Result<PluginSummary, String> {
    let remote = record.remote.as_ref().ok_or("remote provenance missing")?;
    let mut summary = catalog::build_summary(
        &record.root,
        &record.id,
        Some(record),
        PluginInstallPolicy::Available,
        remote.auth_policy,
    )?;
    summary.source = PluginSource::Remote;
    summary.remote_plugin_id = Some(remote.remote_plugin_id.clone());
    summary.version = Some(record.version.clone());
    Ok(summary)
}

pub(super) fn read(
    store: &PluginStore,
    params: &PluginReadParams,
) -> Result<PluginReadResponse, String> {
    let records = store.installed()?;
    let record = records
        .values()
        .find(|record| {
            Some(&record.id.marketplace) == params.remote_marketplace_name.as_ref()
                && record
                    .remote
                    .as_ref()
                    .is_some_and(|metadata| metadata.remote_plugin_id == params.plugin_name)
        })
        .ok_or("remote plugin is not installed for current account")?;
    let manifest = manifest::read_manifest_with_name(&record.root, Some(&record.id.name))?;
    let detail = build_capability_detail(&record.root, &manifest)?;
    Ok(PluginReadResponse {
        plugin: PluginDetail {
            marketplace_name: record.id.marketplace.clone(),
            marketplace_path: None,
            summary: installed_summary(record)?,
            share_url: None,
            description: manifest_string(&manifest, "description"),
            skills: detail
                .skills
                .into_iter()
                .map(|mut skill| {
                    skill.enabled = record.enabled;
                    skill
                })
                .collect(),
            onboarding_skill: None,
            hooks: hooks::declarations(store, &record.root, &record.id, &manifest),
            apps: detail.apps,
            app_templates: Vec::new(),
            mcp_servers: detail.mcp_servers,
            scheduled_tasks: None,
        },
    })
}
