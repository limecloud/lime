//! 私有操作收据、资源绑定与释放核验记录。

use super::*;

pub(super) struct OperationLock(File);

impl OperationLock {
    pub(super) fn new(file: File) -> Self {
        Self(file)
    }
}

impl Drop for OperationLock {
    fn drop(&mut self) {
        // Explicitly release the lock even if a spawned process briefly holds a
        // duplicated descriptor before exec closes it.
        let _ = FileExt::unlock(&self.0);
    }
}

#[cfg(all(test, unix))]
#[test]
fn completed_operation_unlocks_while_a_duplicate_descriptor_is_alive() {
    let directory = tempfile::tempdir().unwrap();
    let service = CloudDesktopService {
        root: directory.path().join("receipts"),
        cli: "aliyun".into(),
    };
    service.ensure_root().unwrap();
    let lock = service.lock_operations().unwrap();
    let inherited = lock.0.try_clone().unwrap();
    assert!(service.lock_operations().is_err());
    drop(lock);
    let next = service.lock_operations().unwrap();
    drop(inherited);
    assert!(service.lock_operations().is_err());
    drop(next);
    assert!(service.lock_operations().is_ok());
}

impl CloudDesktopService {
    pub(super) fn lock_operations(&self) -> Result<OperationLock, String> {
        let file = private_open(&self.root.join("operations.lock"), false)?;
        file.try_lock_exclusive()
            .map_err(|_| "Another cloud desktop change is in progress; inspect before retrying")?;
        Ok(OperationLock(file))
    }

    pub(super) fn create_receipt(&self, operation_id: &str, receipt: &Value) -> Result<(), String> {
        // Persist unknown before the provider request, including across processes.
        let mut file = private_open(&self.root.join(format!("{operation_id}.json")), true)?;
        file.write_all(
            &serde_json::to_vec(receipt).map_err(|_| "Cannot encode operation receipt")?,
        )
        .and_then(|_| file.sync_all())
        .map_err(|_| "Cannot persist operation receipt")?;
        #[cfg(unix)]
        File::open(&self.root)
            .and_then(|directory| directory.sync_all())
            .map_err(|_| "Cannot sync operation directory")?;
        Ok(())
    }

    pub(super) fn check_change_available(
        &self,
        resource: &CloudDesktopResource,
        action: &str,
    ) -> Result<(), String> {
        // Scan durable history rather than the truncated recent-operations view.
        for entry in fs::read_dir(&self.root).map_err(|_| "Cannot list cloud operations")? {
            let entry = entry.map_err(|_| "Cannot read cloud operation")?;
            let name = entry.file_name();
            let Some(name) = name.to_str() else { continue };
            if !name.ends_with(".json")
                || name.starts_with("resource-")
                || name.starts_with("quote-")
            {
                continue;
            }
            let id = name.trim_end_matches(".json");
            validate_id(id)?;
            if let Some(receipt) = self.read_receipt(id)? {
                let target = &receipt["request"]["resource"];
                // A second CLI profile may be an alias of the same cloud account.
                // It must not bypass an unresolved operation on the same resource.
                if target["provider"] != serde_json::to_value(resource.provider).unwrap()
                    || target["regionId"] != resource.region_id
                    || target["resourceId"] != resource.resource_id
                {
                    continue;
                }
                if receipt["request"]["action"] == "release" && receipt["outcome"] != "released" {
                    return Err(format!(
                        "Cloud desktop release is unresolved; inspect operation {id} before another change"
                    ));
                }
                if receipt["request"]["action"] == "restoreSnapshot"
                    && receipt["outcome"] != "verified"
                    && !matches!(action, "start" | "stop")
                {
                    return Err(format!(
                        "Snapshot restore is unresolved; inspect and verify operation {id} before another destructive change"
                    ));
                }
                if matches!(
                    receipt["request"]["action"].as_str(),
                    Some("prepareEcsDesktop" | "startEcsRuntimeInstallation")
                ) && !matches!(
                    receipt["outcome"].as_str(),
                    Some(
                        "dependenciesReady"
                            | "preparationFailed"
                            | "notSubmitted"
                            | "runtimeUploadReady"
                            | "runtimeLaunchFailed"
                    )
                ) {
                    return Err(format!(
                        "Desktop preparation is unresolved; inspect operation {id} before another change"
                    ));
                }
            }
        }
        Ok(())
    }

    pub(super) fn finalize_receipt(&self, operation_id: &str, receipt: &Value) {
        // Never remove the original durable unknown receipt on a write failure.
        // A file left by an interrupted writer must not block later inspection.
        let pending = self
            .root
            .join(format!("{operation_id}-{}.pending", uuid::Uuid::new_v4()));
        if let Ok(mut output) = private_open(&pending, true) {
            if serde_json::to_writer(&mut output, receipt).is_ok() && output.sync_all().is_ok() {
                if fs::rename(pending, self.root.join(format!("{operation_id}.json"))).is_ok() {
                    #[cfg(unix)]
                    let _ = File::open(&self.root).and_then(|directory| directory.sync_all());
                }
            }
        }
    }

    pub(super) fn ensure_root(&self) -> Result<(), String> {
        let mut builder = fs::DirBuilder::new();
        builder.recursive(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            builder.mode(0o700);
        }
        builder
            .create(&self.root)
            .map_err(|_| "Cannot create private cloud operation directory")?;
        let metadata =
            fs::symlink_metadata(&self.root).map_err(|_| "Cannot inspect operation directory")?;
        if !metadata.is_dir() || metadata.file_type().is_symlink() {
            return Err("Cloud operation directory must be private and regular".into());
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            if metadata.mode() & 0o077 != 0 || metadata.uid() != unsafe { libc::geteuid() } {
                return Err("Cloud operation directory is not private".into());
            }
        }
        Ok(())
    }

    pub(super) fn remember_resource(&self, resource: &CloudDesktopResource) -> Result<(), String> {
        use sha2::{Digest, Sha256};
        self.ensure_root()?;
        let bytes = serde_json::to_vec(resource).map_err(|_| "Cannot encode resource binding")?;
        let path = self
            .root
            .join(format!("resource-{:x}.json", Sha256::digest(&bytes)));
        if path
            .try_exists()
            .map_err(|_| "Cannot inspect resource binding")?
        {
            let existing: CloudDesktopResource =
                serde_json::from_reader(private_open(&path, false)?)
                    .map_err(|_| "Invalid resource binding")?;
            return if existing == *resource {
                Ok(())
            } else {
                Err("Resource binding mismatch".into())
            };
        }
        let mut file = private_open(&path, true)?;
        file.write_all(&bytes)
            .and_then(|_| file.sync_all())
            .map_err(|_| "Cannot persist resource binding")?;
        #[cfg(unix)]
        File::open(&self.root)
            .and_then(|directory| directory.sync_all())
            .map_err(|_| "Cannot sync resource binding")?;
        Ok(())
    }

    pub(super) fn list_resources(&self) -> Result<Value, String> {
        if !self
            .root
            .try_exists()
            .map_err(|_| "Cannot inspect cloud directory")?
        {
            return Ok(json!({ "resources": [], "operations": [] }));
        }
        self.ensure_root()?;
        let mut resources = Vec::new();
        let mut operations = Vec::new();
        for entry in fs::read_dir(&self.root).map_err(|_| "Cannot list resource bindings")? {
            let entry = entry.map_err(|_| "Cannot read resource binding")?;
            let name = entry.file_name();
            let Some(name) = name.to_str() else { continue };
            if !name.ends_with(".json") || name.starts_with("quote-") {
                continue;
            }
            if !name.starts_with("resource-") {
                let id = name.trim_end_matches(".json");
                validate_id(id)?;
                if operations.len() >= 4096 {
                    return Err("Too many cloud operation receipts".into());
                }
                if let Some(receipt) = self.read_receipt(id)? {
                    if receipt["operationId"] != id {
                        return Err("Cloud receipt identity mismatch".into());
                    }
                    operations.push(
                        json!({ "operationId": id, "action": receipt["request"]["action"],
                        "outcome": receipt["outcome"], "createdAt": receipt["createdAt"],
                        "resource": receipt["request"]["resource"] }),
                    );
                }
                continue;
            }
            if resources.len() >= 512 {
                return Err("Too many resource bindings".into());
            }
            let file = private_open(&entry.path(), false)?;
            if file
                .metadata()
                .map_err(|_| "Cannot inspect resource binding")?
                .len()
                > 4096
            {
                return Err("Invalid resource binding size".into());
            }
            let resource: CloudDesktopResource =
                serde_json::from_reader(file).map_err(|_| "Invalid resource binding")?;
            validate_resource(&resource)?;
            resources.push(resource);
        }
        resources.sort_by(|a, b| {
            (&a.region_id, &a.resource_id, &a.profile).cmp(&(
                &b.region_id,
                &b.resource_id,
                &b.profile,
            ))
        });
        // Preserve the binding and receipt on disk as history; only hide a
        // resource after its exact release has been observed, before truncation.
        resources.retain(|resource| {
            !operations.iter().any(|operation| {
                operation["action"] == "release"
                    && operation["outcome"] == "released"
                    && operation["resource"] == serde_json::to_value(resource).unwrap()
            })
        });
        operations.sort_by(|a, b| b["createdAt"].as_str().cmp(&a["createdAt"].as_str()));
        operations.truncate(50);
        Ok(json!({ "resources": resources, "operations": operations }))
    }

    pub(super) fn read_receipt(&self, id: &str) -> Result<Option<Value>, String> {
        let path = self.root.join(format!("{id}.json"));
        if !path
            .try_exists()
            .map_err(|_| "Cannot inspect operation receipt")?
        {
            return Ok(None);
        }
        let file = private_open(&path, false)?;
        if file
            .metadata()
            .map_err(|_| "Cannot inspect operation receipt")?
            .len()
            > MAX_PROVIDER_BYTES
        {
            return Err("Invalid operation receipt size".into());
        }
        let value: Value = serde_json::from_reader(file).map_err(|_| {
            "Invalid operation receipt; reconcile the instance before another change"
        })?;
        if value["operationId"] != id {
            return Err("Cloud receipt identity mismatch".into());
        }
        if value["request"]["action"] == "release" {
            let resource: CloudDesktopResource =
                serde_json::from_value(value["request"]["resource"].clone())
                    .map_err(|_| "Invalid release receipt resource")?;
            validate_resource(&resource)?;
            if value["request"]["discardData"] != true
                || value["observedBefore"]["resource"] != value["request"]["resource"]
                || value["observedBefore"]["status"] != "Stopped"
                || value["observedBefore"]["instanceChargeType"] != "PostPaid"
                || !matches!(
                    value["outcome"].as_str(),
                    Some("unknown" | "accepted" | "released")
                )
            {
                return Err("Invalid release receipt".into());
            }
            if value["outcome"] == "released"
                && (value["requiresInspection"] != false
                    || value["observedAfter"]["exists"] != false
                    || value["observedAfter"]["status"] != "NotFound"
                    || value["observedAfter"]["resource"] != value["request"]["resource"]
                    || value["verifiedAt"]
                        .as_str()
                        .and_then(|time| chrono::DateTime::parse_from_rfc3339(time).ok())
                        .is_none())
            {
                return Err(
                    "Released receipt is missing verified absence of the exact resource".into(),
                );
            }
        }
        if value["request"]["action"] == "restoreSnapshot" {
            self.validate_restore_receipt(&value)?;
        }
        if value["request"]["action"] == "purchaseEcs" {
            self.validate_ecs_purchase_receipt(&value)?;
        }
        if value["request"]["action"] == "prepareEcsDesktop" {
            self.validate_preparation_receipt(&value)?;
        }
        if value["request"]["action"] == "startEcsRuntimeInstallation" {
            self.validate_runtime_installation_receipt(&value)?;
        }
        Ok(Some(value))
    }
}
