use super::*;
use crate::plugin_remote::wire::{Acquisition, Ticket};

pub(super) async fn prepare(
    store: &PluginStore,
    context: &Context<'_>,
    item: &Item,
    id: &PluginId,
    attempt: &str,
) -> Result<install::PreparedPackage, String> {
    let release = &item.release;
    if !release
        .manifest
        .plugin
        .as_ref()
        .ok_or("plugin manifest missing")?
        .dependencies
        .is_empty()
    {
        return Err("plugin_dependencies_require_installation".into());
    }
    let key = |phase: &str| {
        let mut digest = Sha256::new();
        for value in [attempt, item.id.as_str(), phase] {
            digest.update((value.len() as u64).to_be_bytes());
            digest.update(value.as_bytes());
        }
        hex::encode(digest.finalize())
    };
    let task = format!("plugin-install:{attempt}");
    let acquisition:Acquisition=context.command("/market/acquisitions",serde_json::json!({"releaseId":release.id,"host":wire::host(),"expectedItemRevision":item.revision}),&key("acquire"),&task).await.map_err(|e|e.to_string())?;
    if !wire::identifier(&acquisition.id)
        || acquisition.release_id != release.id
        || acquisition.status != "active"
        || acquisition.revision == 0
    {
        return Err("invalid plugin acquisition".into());
    }
    let ticket: Ticket = context
        .command(
            &format!("/market/acquisitions/{}/download-tickets", acquisition.id),
            serde_json::json!({"revision":acquisition.revision}),
            &key("download"),
            &task,
        )
        .await
        .map_err(|e| e.to_string())?;
    if ticket.sha256 != release.archive_sha256 || ticket.size != release.archive_size {
        return Err("plugin ticket digest mismatch".into());
    }
    let download = crate::plugin_remote::bundle::download_ticket(&ticket, &context.account).await?;
    context.ensure_current().map_err(|e| e.to_string())?;
    let metadata = InstallMetadata {
        schema_version: 2,
        remote_plugin_id: item.id.clone(),
        account_id: crate::account::AccountManager::plugin_identity_for(&context.account),
        auth_policy: PluginAuthPolicy::OnInstall,
        release_id: release.id.clone(),
        acquisition_id: acquisition.id,
        archive_sha256: release.archive_sha256.clone(),
    };
    let store = store.clone();
    let id = id.clone();
    let release = release.clone();
    tokio::task::spawn_blocking(move || {
        let archive = fs::read(download.path()).map_err(|_| "plugin archive unavailable")?;
        if archive.len() as u64 != release.archive_size
            || hex::encode(Sha256::digest(&archive)) != release.archive_sha256
        {
            return Err("plugin archive digest mismatch".into());
        }
        let extracted = bundle::extract(download.path())?;
        verify_files(extracted.path(), &release.manifest.files)?;
        let path = manifest::find_manifest_path(extracted.path())?;
        if path
            != extracted.path().join(
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
        let local = manifest::read_manifest_with_name(extracted.path(), Some(&id.name))?;
        if manifest_version(&local)? != release.manifest.version {
            return Err("plugin version mismatch".into());
        }
        install::prepare_remote(
            &store,
            extracted.path(),
            &id,
            &release.manifest.version,
            &metadata,
        )
    })
    .await
    .map_err(|_| "plugin staging task failed".to_string())?
}

fn verify_files(root: &Path, expected: &[wire::File]) -> Result<(), String> {
    let expected = expected
        .iter()
        .map(|v| (v.path.clone(), v))
        .collect::<std::collections::BTreeMap<_, _>>();
    let mut found = std::collections::BTreeSet::new();
    let mut pending = vec![root.to_path_buf()];
    let mut count = 0usize;
    while let Some(dir) = pending.pop() {
        for entry in fs::read_dir(dir).map_err(|_| "plugin file verification failed")? {
            let entry = entry.map_err(|_| "plugin file verification failed")?;
            let info = entry
                .file_type()
                .map_err(|_| "plugin file verification failed")?;
            count += 1;
            if count > 20000 {
                return Err("plugin file limit exceeded".into());
            }
            if info.is_dir() {
                pending.push(entry.path());
                continue;
            }
            if !info.is_file() || info.is_symlink() {
                return Err("plugin files must be regular".into());
            }
            let path = entry.path();
            let name = path
                .strip_prefix(root)
                .map_err(|_| "invalid plugin path")?
                .to_str()
                .ok_or("invalid plugin path")?
                .replace('\\', "/");
            let file = expected.get(&name).ok_or("unlisted plugin file")?;
            if entry
                .metadata()
                .map_err(|_| "plugin metadata unavailable")?
                .len()
                != file.size
            {
                return Err("plugin file size mismatch".into());
            }
            let mut reader = fs::File::open(&path).map_err(|_| "plugin file unavailable")?;
            let mut hash = Sha256::new();
            let mut block = [0u8; 8192];
            let mut total = 0u64;
            loop {
                let n = reader
                    .read(&mut block)
                    .map_err(|_| "plugin file unavailable")?;
                if n == 0 {
                    break;
                }
                total += n as u64;
                if total > file.size {
                    return Err("plugin file size mismatch".into());
                }
                hash.update(&block[..n]);
            }
            if total != file.size || hex::encode(hash.finalize()) != file.sha256 {
                return Err("plugin file digest mismatch".into());
            }
            found.insert(name);
        }
    }
    if found.len() != expected.len() {
        return Err("plugin file missing".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn package_files_must_match_the_complete_signed_set() {
        let root = tempfile::tempdir().unwrap();
        fs::write(root.path().join("plugin.json"), b"original").unwrap();
        let files = [wire::File {
            path: "plugin.json".into(),
            size: 8,
            sha256: hex::encode(Sha256::digest(b"original")),
        }];
        verify_files(root.path(), &files).unwrap();
        fs::write(root.path().join("unlisted.sh"), b"unexpected").unwrap();
        assert!(verify_files(root.path(), &files).is_err());
        fs::remove_file(root.path().join("unlisted.sh")).unwrap();
        fs::write(root.path().join("plugin.json"), b"modified").unwrap();
        assert!(verify_files(root.path(), &files).is_err());
        fs::remove_file(root.path().join("plugin.json")).unwrap();
        assert!(verify_files(root.path(), &files).is_err());
    }
}
