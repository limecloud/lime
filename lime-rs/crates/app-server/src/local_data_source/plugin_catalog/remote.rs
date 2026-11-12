use super::*;
use crate::plugin_remote::{
    Context,
    wire::{self, Item},
};
use app_server_protocol::protocol::v2::{Account, GetAccountParams};
use serde::{Deserialize, Serialize};

const METADATA_FILE: &str = ".lime-remote-plugin-install.json";
const MAX_METADATA_BYTES: u64 = 16 * 1024;
mod attempt;
pub(super) mod gate;
mod mutation;
mod package;
mod reconcile;
pub(crate) use mutation::uninstall;
pub(crate) use reconcile::reconcile;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct InstallMetadata {
    pub schema_version: u32,
    pub remote_plugin_id: String,
    pub account_id: String,
    pub auth_policy: PluginAuthPolicy,
    pub release_id: String,
    pub acquisition_id: String,
    pub archive_sha256: String,
}

pub(super) fn is_marketplace(name: &str) -> bool {
    wire::is_marketplace(name)
}
pub(super) fn metadata(base: &Path) -> Result<Option<InstallMetadata>, String> {
    let path = base.join(METADATA_FILE);
    let info = match fs::symlink_metadata(&path) {
        Ok(v) => v,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("plugin provenance unavailable".into()),
    };
    if !info.is_file() || info.file_type().is_symlink() || info.len() > MAX_METADATA_BYTES {
        return Err("invalid plugin provenance".into());
    }
    let mut bytes = Vec::new();
    fs::File::open(&path)
        .map_err(|_| "plugin provenance unavailable")?
        .take(MAX_METADATA_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "plugin provenance unavailable")?;
    if bytes.len() as u64 > MAX_METADATA_BYTES {
        return Err("invalid plugin provenance".into());
    }
    let value: InstallMetadata =
        serde_json::from_slice(&bytes).map_err(|_| "invalid plugin provenance")?;
    if value.schema_version != 2
        || !wire::identifier(&value.remote_plugin_id)
        || !wire::identifier(&value.release_id)
        || !wire::identifier(&value.acquisition_id)
        || !wire::digest(&value.account_id)
        || !wire::digest(&value.archive_sha256)
    {
        return Err("invalid plugin provenance".into());
    }
    Ok(Some(value))
}
pub(super) fn write_metadata(base: &Path, value: &InstallMetadata) -> Result<(), String> {
    fs::write(
        base.join(METADATA_FILE),
        serde_json::to_vec(value).map_err(|_| "invalid plugin provenance")?,
    )
    .map_err(|_| "plugin provenance unavailable".into())
}

pub(crate) async fn install(
    store: &PluginStore,
    params: PluginInstallParams,
) -> Result<PluginInstallResponse, String> {
    let _gate = gate::acquire(store).await?;
    wire::validate_remote_id(&params.plugin_name).map_err(|e| e.to_string())?;
    let context = Context::current(store.account.as_deref(), &store.config_path)
        .map_err(|e| e.to_string())?
        .ok_or("account_login_required")?;
    let (item, attempt) = attempt::load_or_create(store, &context, &params).await?;
    let id = PluginId::new(&item.release.manifest.name, &item.marketplace())?;
    if let Some(previous) = metadata(&store.base_root(&id))? {
        if previous.remote_plugin_id != item.id
            || previous.account_id
                != crate::account::AccountManager::plugin_identity_for(&context.account)
        {
            return Err("plugin installation identity conflict".into());
        }
    }
    let prepared = package::prepare(store, &context, &item, &id, &attempt).await?;
    let account = context.account.clone();
    let store = store.clone();
    let remote_id = item.id.clone();
    tokio::task::spawn_blocking(move || {
        let components = prepared.commit(|| {
            ensure_account(&store, &account)?;
            store.set_enabled(&id, true)
        })?;
        attempt::complete(&store, &account, &remote_id, &attempt)?;
        Ok(PluginInstallResponse {
            auth_policy: PluginAuthPolicy::OnInstall,
            apps_needing_auth: components.apps,
        })
    })
    .await
    .map_err(|_| "plugin commit task failed".to_string())?
}

pub(super) fn ensure_account(store: &PluginStore, expected: &Account) -> Result<(), String> {
    let current = store
        .account
        .as_ref()
        .ok_or("account storage unavailable")?
        .read(GetAccountParams::default())?
        .account
        .ok_or("account_changed")?;
    let Account::Cloud { generation: a, .. } = &current;
    let Account::Cloud { generation: b, .. } = expected;
    if a != b
        || crate::account::AccountManager::plugin_identity_for(&current)
            != crate::account::AccountManager::plugin_identity_for(expected)
    {
        return Err("account_changed".into());
    }
    Ok(())
}

pub(super) fn installed_summary(record: &Installation) -> Result<PluginSummary, String> {
    let remote = record.remote.as_ref().ok_or("plugin provenance missing")?;
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
        .find(|r| {
            Some(&r.id.marketplace) == params.remote_marketplace_name.as_ref()
                && r.remote
                    .as_ref()
                    .is_some_and(|m| m.remote_plugin_id == params.plugin_name)
        })
        .ok_or("plugin is not installed for current account")?;
    let manifest = manifest::read_manifest_with_name(&record.root, Some(&record.id.name))?;
    let detail = build_capability_detail(&record.root, &manifest)?;
    Ok(PluginReadResponse {
        plugin: PluginDetail {
            marketplace_name: record.id.marketplace.clone(),
            marketplace_path: None,
            summary: installed_summary(record)?,
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
