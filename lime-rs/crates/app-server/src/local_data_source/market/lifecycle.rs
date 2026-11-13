use super::attempts::{valid_attempt_id, Attempt};
use super::*;

impl MarketStore {
    pub async fn install(
        &self,
        params: MarketInstallParams,
    ) -> Result<MarketInstallResponse, String> {
        let context = self.context()?.ok_or("account_login_required")?;
        let account_root = self.account_root(&context)?;
        let _lock = io::lock(&account_root)?;
        let base = self.base(&context, params.kind, &params.item_id)?;
        if !valid_attempt_id(&params.install_attempt_id) {
            return Err("invalid_market_install_attempt".into());
        }
        let attempt_path = self.attempt_path(&context, params.kind, &params.item_id)?;
        let attempt: Attempt = match std::fs::symlink_metadata(&attempt_path) {
            Ok(_) => io::read_json(&attempt_path)?,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                let selection = context
                    .select_item(&params.item_id, Some(&params.release))
                    .await
                    .map_err(|e| e.to_string())?;
                validate_selection(&selection, &params)?;
                let attempt = Attempt {
                    id: params.install_attempt_id.clone(),
                    selection,
                };
                context.ensure_current().map_err(|e| e.to_string())?;
                io::write_json(&attempt_path, &attempt)?;
                attempt
            }
            Err(_) => return Err("market_install_attempt_unavailable".into()),
        };
        if !valid_attempt_id(&attempt.id) {
            return Err("invalid_market_install_attempt".into());
        }
        validate_selection(&attempt.selection, &params)?;
        let Account::Cloud { environment, .. } = &context.account;
        if attempt.selection.item.environment != *environment {
            return Err("invalid_market_install_attempt".into());
        }
        let release: market::wire::Release = context
            .get(&format!(
                "/market/releases/{}",
                attempt.selection.release.id
            ))
            .await
            .map_err(|e| e.to_string())?;
        release.validate().map_err(|e| e.to_string())?;
        if release.reference() != attempt.selection.release.reference()
            || release.item_id != params.item_id
            || release.archive_size != attempt.selection.release.archive_size
        {
            return Err("market_release_changed".into());
        }
        let task = format!("market-install:{}", attempt.id);
        let prepared =
            market::package::prepare(&context, &attempt.selection, &attempt.id, &task).await?;
        components::validate(prepared.root.path(), &prepared.release)?;
        let record = Installation {
            schema_version: 1,
            account_id: AccountManager::plugin_identity_for(&context.account),
            selection: attempt.selection,
            acquisition_id: prepared.acquisition.id,
            enabled: true,
        };
        let parent = base.parent().ok_or("invalid_market_directory")?;
        let staging = tempfile::Builder::new()
            .prefix(".market-stage-")
            .tempdir_in(parent)
            .map_err(|_| "market_store_unavailable")?;
        let staged = staging.path().join("installation");
        io::directory(&staged)?;
        let package = staged.join("package");
        io::directory(&package)?;
        for file in &record.selection.release.manifest.files {
            let target = package.join(&file.path);
            std::fs::create_dir_all(target.parent().ok_or("invalid_market_path")?)
                .map_err(|_| "market_store_unavailable")?;
            std::fs::copy(prepared.root.path().join(&file.path), &target)
                .map_err(|_| "market_store_unavailable")?;
        }
        market::archive::verify_directory(&package, &record.selection.release)?;
        components::validate(&package, &record.selection.release)?;
        io::write_json(&staged.join("installation.json"), &record)?;
        context.ensure_current().map_err(|e| e.to_string())?;
        let backup = staging.path().join("backup");
        let previous = match std::fs::symlink_metadata(&base) {
            Ok(_) => {
                io::existing_directory(&base)?;
                std::fs::rename(&base, &backup).map_err(|_| "market_commit_failed")?;
                true
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => false,
            Err(_) => return Err("market_store_unavailable".into()),
        };
        let commit = std::fs::rename(&staged, &base)
            .map_err(|_| "market_commit_failed".to_string())
            .and_then(|_| context.ensure_current().map_err(|e| e.to_string()));
        if let Err(error) = commit {
            if base.exists() {
                std::fs::remove_dir_all(&base).map_err(|_| "market_rollback_failed")?;
            }
            if previous {
                std::fs::rename(&backup, &base).map_err(|_| "market_rollback_failed")?;
            }
            return Err(error);
        }
        // A retained attempt after interrupted cleanup recovers the same receipt.
        if std::fs::remove_file(attempt_path).is_err() {
            tracing::warn!("市场安装完成，原尝试清理失败，保留原操作恢复");
        }
        Ok(MarketInstallResponse {
            resource: self.summary(&context, &record)?,
        })
    }

    pub fn set_enabled(
        &self,
        params: MarketEnabledSetParams,
    ) -> Result<MarketEnabledSetResponse, String> {
        let context = self.context()?.ok_or("account_login_required")?;
        let _lock = io::lock(&self.account_root(&context)?)?;
        let mut record = self.read(&context, params.kind, &params.item_id)?;
        record.enabled = params.enabled;
        context.ensure_current().map_err(|e| e.to_string())?;
        io::write_json(
            &self
                .base(&context, params.kind, &params.item_id)?
                .join("installation.json"),
            &record,
        )?;
        context.ensure_current().map_err(|e| e.to_string())?;
        Ok(MarketEnabledSetResponse {
            resource: self.summary(&context, &record)?,
        })
    }

    pub fn uninstall(
        &self,
        params: MarketUninstallParams,
    ) -> Result<MarketUninstallResponse, String> {
        let context = self.context()?.ok_or("account_login_required")?;
        let _lock = io::lock(&self.account_root(&context)?)?;
        let base = self.base(&context, params.kind, &params.item_id)?;
        match std::fs::symlink_metadata(&base) {
            Ok(_) => {
                io::existing_directory(&base)?;
                context.ensure_current().map_err(|e| e.to_string())?;
                std::fs::remove_dir_all(base).map_err(|_| "market_uninstall_failed")?;
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return Err("market_store_unavailable".into()),
        }
        context.ensure_current().map_err(|e| e.to_string())?;
        Ok(MarketUninstallResponse {})
    }
}

fn validate_selection(selection: &Selection, params: &MarketInstallParams) -> Result<(), String> {
    selection.validate().map_err(|e| e.to_string())?;
    if components::kind(selection)? != params.kind || selection.item.id != params.item_id {
        return Err("market_resource_type_mismatch".into());
    }
    if selection.release.reference() != params.release {
        return Err("market_install_pending_other_release".into());
    }
    if !selection.compatible() {
        return Err("market_host_unsupported".into());
    }
    Ok(())
}
