use super::*;

pub(crate) fn install(
    store: &PluginStore,
    params: PluginInstallParams,
) -> Result<PluginInstallResponse, String> {
    let (marketplace, index) = resolve_plugin(
        params.marketplace_path.as_deref(),
        params.remote_marketplace_name.as_deref(),
        &params.plugin_name,
    )?;
    let entry = &marketplace.plugins[index];
    if remote::is_marketplace(&entry.id.marketplace) {
        return Err("本地市场不能使用保留的 remote marketplace identity。".into());
    }
    if entry.install_policy == PluginInstallPolicy::NotAvailable {
        return Err(format!("Plugin 不允许安装: {}", entry.id.key()));
    }
    let components = materialize(store, &entry.root, &entry.id, || {
        store.set_enabled(&entry.id, true)
    })?;
    Ok(PluginInstallResponse {
        auth_policy: entry.auth_policy,
        // No hosted connector authorization is established by copying a package.
        apps_needing_auth: components.apps,
    })
}

/// Share staging/commit with cache refresh without changing its enablement config.
pub(super) fn materialize(
    store: &PluginStore,
    source_root: &Path,
    id: &PluginId,
    commit_config: impl FnOnce() -> Result<(), String>,
) -> Result<components::CapabilityDetail, String> {
    prepare_package(store, source_root, id, None, None)?.commit(commit_config)
}

pub(super) struct PreparedPackage {
    staging: tempfile::TempDir,
    base: PathBuf,
    staged_base: PathBuf,
    components: components::CapabilityDetail,
    _lock: fs::File,
}

impl PreparedPackage {
    pub(super) fn stage_dependency(
        &mut self,
        package: &crate::market::package::PreparedResource,
    ) -> Result<(), String> {
        let target = self
            .staged_base
            .join(".dependencies")
            .join(&package.release.id);
        fs::create_dir_all(&target).map_err(io_error("创建 Plugin dependency 失败"))?;
        copy_package_tree(package.root.path(), &target)?;
        crate::market::archive::verify_directory(&target, &package.release)?;
        remote::dependencies::validate_entry(&target, &package.release)?;
        Ok(())
    }
}

pub(super) fn prepare_remote(
    store: &PluginStore,
    source_root: &Path,
    id: &PluginId,
    version: &str,
    metadata: &remote::InstallMetadata,
) -> Result<PreparedPackage, String> {
    prepare_package(store, source_root, id, Some(version), Some(metadata))
}

fn prepare_package(
    store: &PluginStore,
    source_root: &Path,
    id: &PluginId,
    version: Option<&str>,
    metadata: Option<&remote::InstallMetadata>,
) -> Result<PreparedPackage, String> {
    let lock = mutation_lock(store)?;
    let manifest = manifest::read_manifest_with_name(source_root, Some(&id.name))?;
    let version = version
        .map(str::to_string)
        .map(Ok)
        .unwrap_or_else(|| manifest_version(&manifest))?;
    if !store::valid_version(&version) {
        return Err("Plugin cache version 不合法。".into());
    }
    let digest = package_digest(source_root)?;
    let base = store.base_root(id);
    if source_root.starts_with(fs::canonicalize(&store.root).unwrap_or_else(|_| store.root.clone()))
    {
        return Err("Plugin source 不能位于 installed cache 内。".to_string());
    }
    let parent = base.parent().expect("plugin base parent");
    fs::create_dir_all(parent).map_err(io_error("创建 Plugin cache 失败"))?;
    let staging = tempfile::Builder::new()
        .prefix(".plugin-stage-")
        .tempdir_in(parent)
        .map_err(io_error("创建 Plugin staging 失败"))?;
    let staged_base = staging.path().join(&id.name);
    let staged_version = staged_base.join(&version);
    fs::create_dir_all(&staged_version).map_err(io_error("创建 Plugin version 失败"))?;
    copy_package_tree(source_root, &staged_version)?;
    let staged = manifest::read_manifest_with_name(&staged_version, Some(&id.name))?;
    if manifest_name(&staged)? != id.name || package_digest(&staged_version)? != digest {
        return Err("Plugin staging identity 或 digest 不一致。".to_string());
    }
    let components = build_capability_detail(&staged_version, &staged)?;
    if let Some(metadata) = metadata {
        // Provenance belongs to the cache base, outside package-controlled files.
        remote::write_metadata(&staged_base, metadata)?;
    }
    Ok(PreparedPackage {
        staging,
        base,
        staged_base,
        components,
        _lock: lock,
    })
}

impl PreparedPackage {
    pub(super) fn commit(
        self,
        commit_config: impl FnOnce() -> Result<(), String>,
    ) -> Result<components::CapabilityDetail, String> {
        let Self {
            staging,
            base,
            staged_base,
            components,
            _lock,
        } = self;
        let backup = staging.path().join("backup");
        let had_previous = base.exists();
        if had_previous {
            fs::rename(&base, &backup).map_err(io_error("暂存 Plugin cache 失败"))?;
        }
        if let Err(error) = fs::rename(&staged_base, &base) {
            if had_previous {
                fs::rename(&backup, &base).map_err(|rollback| {
                    format!("Plugin cache 提交失败: {error}; 回滚失败: {rollback}")
                })?;
            }
            return Err(format!("提交 Plugin cache 失败: {error}"));
        }
        if let Err(error) = commit_config() {
            fs::remove_dir_all(&base).map_err(io_error("回滚 Plugin cache 失败"))?;
            if had_previous {
                fs::rename(&backup, &base).map_err(io_error("恢复 Plugin cache 失败"))?;
            }
            return Err(error);
        }
        Ok(components)
    }
}

pub(crate) fn uninstall(
    store: &PluginStore,
    params: PluginUninstallParams,
) -> Result<PluginUninstallResponse, String> {
    let id = PluginId::parse(&params.plugin_id)?;
    remove(store, &id, || Ok(()))
}

pub(super) fn remove(
    store: &PluginStore,
    id: &PluginId,
    ensure_current: impl FnOnce() -> Result<(), String>,
) -> Result<PluginUninstallResponse, String> {
    let _lock = mutation_lock(store)?;
    ensure_current()?;
    if remote::is_marketplace(&id.marketplace) {
        let metadata = remote::metadata(&store.base_root(&id))?;
        let identity = store.remote_identity()?;
        if metadata
            .as_ref()
            .is_some_and(|metadata| Some(&metadata.account_id) != identity.as_ref())
        {
            return Err("不能卸载另一账号的 Remote Plugin。".into());
        }
    }
    let base = store.base_root(&id);
    // Keep the previous package available until the shared config is committed.
    let staging = if base.exists() {
        let staging = tempfile::Builder::new()
            .prefix(".plugin-remove-")
            .tempdir_in(base.parent().expect("plugin base parent"))
            .map_err(io_error("创建 Plugin uninstall staging 失败"))?;
        fs::rename(&base, staging.path().join("backup"))
            .map_err(io_error("暂存 Plugin cache 失败"))?;
        Some(staging)
    } else {
        None
    };
    let result = store.clear_config(id);
    if let Err(error) = result {
        if let Some(staging) = staging {
            fs::rename(staging.path().join("backup"), &base).map_err(|rollback| {
                format!("Plugin config 清理失败: {error}; cache 回滚失败: {rollback}")
            })?;
        }
        return Err(error);
    }
    Ok(PluginUninstallResponse {})
}

pub(super) fn mutation_lock(store: &PluginStore) -> Result<fs::File, String> {
    fs::create_dir_all(&store.root).map_err(io_error("创建 Plugin store 失败"))?;
    let file = fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(store.root.join(".mutation.lock"))
        .map_err(io_error("打开 Plugin mutation lock 失败"))?;
    fs2::FileExt::lock_exclusive(&file).map_err(io_error("锁定 Plugin mutation 失败"))?;
    Ok(file)
}
