use super::*;
use crate::market::selection::Selection;

pub(super) async fn prepare(
    store: &PluginStore,
    context: &Context<'_>,
    selection: &Selection,
    dependencies: &[Selection],
    id: &PluginId,
    attempt: &str,
) -> Result<install::PreparedPackage, String> {
    crate::market::selection::validate_dependencies(selection, dependencies)
        .map_err(|e| e.to_string())?;
    let task = format!("plugin-install:{attempt}");
    let package = crate::market::package::prepare(context, selection, attempt, &task).await?;
    let mut packages = Vec::new();
    for dependency in dependencies {
        // Two exact releases of one item must never share an operation key.
        let key = format!("{attempt}:{}", dependency.release.id);
        packages.push(crate::market::package::prepare(context, dependency, &key, &task).await?);
    }
    context.ensure_current().map_err(|e| e.to_string())?;
    let metadata = InstallMetadata {
        schema_version: 3,
        remote_plugin_id: selection.item.id.clone(),
        account_id: crate::account::AccountManager::plugin_identity_for(&context.account),
        auth_policy: PluginAuthPolicy::OnInstall,
        release_id: package.release.id.clone(),
        acquisition_id: package.acquisition.id,
        archive_sha256: package.release.archive_sha256.clone(),
        manifest_sha256: package.release.manifest_sha256.clone(),
        dependencies: packages
            .iter()
            .map(|package| dependencies::InstalledDependency {
                release: package.release.clone(),
                acquisition_id: package.acquisition.id.clone(),
            })
            .collect(),
    };
    let store = store.clone();
    let id = id.clone();
    tokio::task::spawn_blocking(move || {
        let root = package.root.path();
        let release = &package.release;
        if manifest::find_manifest_path(root)?
            != root.join(
                &release
                    .manifest
                    .plugin
                    .as_ref()
                    .ok_or("plugin manifest missing")?
                    .entry,
            )
        {
            return Err("plugin entry mismatch".into());
        }
        let local = manifest::read_manifest_with_name(root, Some(&id.name))?;
        if manifest_version(&local)? != release.manifest.version {
            return Err("plugin version mismatch".into());
        }
        let mut prepared =
            install::prepare_remote(&store, root, &id, &release.manifest.version, &metadata)?;
        for dependency in &packages {
            prepared.stage_dependency(dependency)?;
        }
        Ok(prepared)
    })
    .await
    .map_err(|_| "plugin staging task failed".to_string())?
}
