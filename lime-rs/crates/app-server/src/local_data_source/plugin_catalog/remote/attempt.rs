use super::*;
use crate::market::selection::Selection;
use std::io::Write;

/// A pending install keeps its original release and operation keys across restarts.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Attempt {
    id: String,
    selection: Selection,
    #[serde(default)]
    dependencies: Vec<Selection>,
}

fn path(store: &PluginStore, account: &Account, item: &str) -> Result<PathBuf, String> {
    if !wire::identifier(item) {
        return Err("invalid plugin identity".into());
    }
    let parent = store
        .root
        .join("install-attempts")
        .join(crate::account::AccountManager::plugin_identity_for(account));
    for directory in [&store.root, &store.root.join("install-attempts"), &parent] {
        match fs::symlink_metadata(directory) {
            Ok(info) if info.is_dir() && !info.file_type().is_symlink() => {}
            Ok(_) => return Err("invalid plugin install directory".into()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                fs::create_dir_all(directory)
                    .map_err(|_| "plugin install directory unavailable")?;
            }
            Err(_) => return Err("plugin install directory unavailable".into()),
        }
    }
    Ok(parent.join(format!("{item}.json")))
}

fn read(path: &Path) -> Result<Option<Attempt>, String> {
    match fs::symlink_metadata(path) {
        Ok(info)
            if !info.is_file() || info.file_type().is_symlink() || info.len() > 4 * 1024 * 1024 =>
        {
            return Err("invalid plugin install attempt".into());
        }
        Ok(_) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("plugin install attempt unavailable".into()),
    };
    let mut bytes = Vec::new();
    fs::File::open(path)
        .map_err(|_| "plugin install attempt unavailable")?
        .take(4 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "plugin install attempt unavailable")?;
    if bytes.len() > 4 * 1024 * 1024 {
        return Err("invalid plugin install attempt".into());
    }
    serde_json::from_slice(&bytes)
        .map(Some)
        .map_err(|_| "invalid plugin install attempt".into())
}

pub(super) async fn load_or_create(
    store: &PluginStore,
    context: &Context<'_>,
    params: &PluginInstallParams,
) -> Result<(Selection, String, Vec<Selection>), String> {
    let path = path(store, &context.account, &params.plugin_name)?;
    let saved = read(&path)?;
    let attempt = if let Some(saved) = saved {
        saved
    } else {
        let id = params
            .install_attempt_id
            .as_deref()
            .filter(|v| valid_id(v))
            .ok_or("install_attempt_id_required")?;
        let reference = params
            .remote_release
            .as_ref()
            .ok_or("plugin_release_required")?;
        let selection = context
            .select(
                &params.plugin_name,
                params.remote_marketplace_name.as_deref(),
                Some(reference),
            )
            .await
            .map_err(|e| e.to_string())?;
        validate(&selection, params)?;
        context.ensure_current().map_err(|e| e.to_string())?;
        let dependencies = context
            .select_dependencies(&selection)
            .await
            .map_err(|e| e.to_string())?;
        let attempt = Attempt {
            id: id.into(),
            selection,
            dependencies,
        };
        let bytes = serde_json::to_vec(&attempt).map_err(|_| "invalid plugin install attempt")?;
        if bytes.len() > 4 * 1024 * 1024 {
            return Err("invalid plugin install attempt".into());
        }
        let mut pending =
            tempfile::NamedTempFile::new_in(path.parent().ok_or("invalid plugin install path")?)
                .map_err(|_| "plugin install attempt unavailable")?;
        pending
            .write_all(&bytes)
            .and_then(|_| pending.as_file().sync_all())
            .map_err(|_| "plugin install attempt unavailable")?;
        pending
            .persist(&path)
            .map_err(|_| "plugin install attempt unavailable")?;
        attempt
    };
    if !valid_id(&attempt.id) {
        return Err("invalid plugin install attempt".into());
    }
    validate(&attempt.selection, params)?;
    crate::market::selection::validate_dependencies(&attempt.selection, &attempt.dependencies)
        .map_err(|e| e.to_string())?;
    // Read the exact release again, never replace it with a new published version.
    for selection in std::iter::once(&attempt.selection).chain(&attempt.dependencies) {
        let release: wire::Release = context
            .get(&format!("/market/releases/{}", selection.release.id))
            .await
            .map_err(|e| e.to_string())?;
        release.validate().map_err(|e| e.to_string())?;
        if release.reference() != selection.release.reference()
            || release.item_id != selection.item.id
            || release.archive_size != selection.release.archive_size
        {
            return Err("plugin release changed".into());
        }
    }
    Ok((attempt.selection, attempt.id, attempt.dependencies))
}

fn validate(selection: &Selection, params: &PluginInstallParams) -> Result<(), String> {
    selection.validate_plugin().map_err(|e| e.to_string())?;
    let item = &selection.item;
    if item.id != params.plugin_name
        || params.remote_marketplace_name.as_deref() != Some(&item.marketplace())
    {
        return Err("shared plugin identity mismatch".into());
    }
    if params
        .remote_release
        .as_ref()
        .is_some_and(|reference| *reference != selection.release.reference())
    {
        return Err("plugin_install_pending_other_release".into());
    }
    if !selection.compatible() {
        return Err("plugin_host_unsupported".into());
    }
    Ok(())
}

fn valid_id(value: &str) -> bool {
    (16..=128).contains(&value.len())
        && value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
}

pub(super) fn complete(
    store: &PluginStore,
    account: &Account,
    item: &str,
    id: &str,
) -> Result<(), String> {
    let path = path(store, account, item)?;
    if let Some(saved) = read(&path)? {
        if saved.id != id {
            return Err("plugin install attempt changed".into());
        }
        fs::remove_file(path).map_err(|_| "plugin install attempt unavailable")?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn incomplete_attempt_preserves_original_release_and_key() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("attempt.json");
        let raw: serde_json::Value = serde_json::from_str(include_str!(
            "../../../market/testdata/market-releases.json"
        ))
        .unwrap();
        let raw = &raw[2];
        let item = serde_json::json!({
            "id": "item_plugin", "publisherApplicationId": "publisher", "environment": "sandbox",
            "kind": "plugin", "name": "Fixture", "publishedReleaseId": "rel_plugin", "revision": 1,
            "compatibility": {"status": "supported", "reasons": []},
            "release": {
                "id": raw["id"], "itemId": raw["item_id"], "manifest": raw["manifest"],
                "manifestSha256": raw["manifest_sha256"], "archiveSha256": raw["archive_sha256"],
                "archiveSize": raw["archive_size"], "status": raw["status"], "revision": raw["revision"],
            }
        });
        let original = serde_json::json!({"id":"original-install-attempt","selection":{"release":item["release"],"item":item}});
        fs::write(&path, serde_json::to_vec(&original).unwrap()).unwrap();
        let saved = read(&path).unwrap().unwrap();
        assert_eq!(saved.id, "original-install-attempt");
        assert_eq!(saved.selection.release.id, "rel_plugin");
        saved.selection.validate().unwrap();
        assert_eq!(saved.selection.item.revision, 1);
        fs::write(&path, b"{invalid}").unwrap();
        assert!(read(&path).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn attempt_read_rejects_symlink() {
        let root = tempfile::tempdir().unwrap();
        let real = root.path().join("real.json");
        let link = root.path().join("link.json");
        fs::write(&real, b"{}").unwrap();
        std::os::unix::fs::symlink(real, &link).unwrap();
        assert!(read(&link).is_err());
    }
}
