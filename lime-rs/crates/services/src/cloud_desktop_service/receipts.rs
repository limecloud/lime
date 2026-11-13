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
        self.try_lock_operations()?.ok_or_else(|| {
            "Another cloud desktop change is in progress; inspect before retrying".into()
        })
    }

    pub(super) fn try_lock_operations(&self) -> Result<Option<OperationLock>, String> {
        let file = private_open(&self.root.join("operations.lock"), false)?;
        match file.try_lock_exclusive() {
            Ok(()) => Ok(Some(OperationLock(file))),
            Err(error) if error.raw_os_error() == fs2::lock_contended_error().raw_os_error() => {
                Ok(None)
            }
            Err(_) => Err("Cannot lock cloud desktop operations".into()),
        }
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
        self.check_change_available_for_hibernation(resource, action, "", None)
    }

    pub(super) fn check_change_available_for_hibernation(
        &self,
        resource: &CloudDesktopResource,
        action: &str,
        operation_id: &str,
        parent: Option<&str>,
    ) -> Result<(), String> {
        if let Some(parent) = parent {
            self.require_hibernation_step(parent, resource, action, operation_id)?;
        }
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
                if matches!(
                    receipt["request"]["action"].as_str(),
                    Some("start" | "stop")
                ) && receipt["outcome"] != "lifecycleVerified"
                {
                    return Err(format!(
                        "Cloud desktop lifecycle is unresolved; inspect operation {id} before another change"
                    ));
                }
                if receipt["request"]["action"] == "hibernateEcs"
                    && !hibernation::terminal(&receipt)
                    && parent != Some(id)
                {
                    return Err(format!("Environment preservation is unresolved; inspect or cancel operation {id} before another change"));
                }
                if receipt["request"]["action"] == "release" && receipt["outcome"] != "released" {
                    return Err(format!(
                        "Cloud desktop release is unresolved; inspect operation {id} before another change"
                    ));
                }
                if matches!(
                    receipt["request"]["action"].as_str(),
                    Some("scheduleEcsRelease" | "cancelEcsRelease")
                ) && !matches!(
                    receipt["outcome"].as_str(),
                    Some("released" | "releaseCancelled" | "scheduleCancelled")
                ) && (action != "cancelEcsRelease"
                    || receipt["request"]["action"] == "cancelEcsRelease")
                {
                    return Err(format!("Cloud desktop release schedule is unresolved; inspect or cancel operation {id} before another change"));
                }
                if receipt["request"]["action"] == "restoreSnapshot"
                    && receipt["outcome"] != "verified"
                    && !matches!(action, "start" | "stop")
                {
                    return Err(format!(
                        "Snapshot restore is unresolved; inspect and verify operation {id} before another destructive change"
                    ));
                }
                if receipt["request"]["action"] == "createEcsImage"
                    && !matches!(
                        receipt["outcome"].as_str(),
                        Some("imageReady" | "imageFailed")
                    )
                {
                    return Err(format!(
                        "System image is unresolved; inspect operation {id} before another change"
                    ));
                }
                if matches!(
                    receipt["request"]["action"].as_str(),
                    Some(
                        "prepareEcsDesktop" | "startEcsRuntimeInstallation" | "reconnectEcsRuntime"
                    )
                ) && !matches!(
                    receipt["outcome"].as_str(),
                    Some(
                        "waitingForAgent"
                            | "dependenciesReady"
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
        let _ = self.replace_receipt(operation_id, receipt);
    }

    pub(super) fn replace_receipt(
        &self,
        operation_id: &str,
        receipt: &Value,
    ) -> Result<(), String> {
        // Never remove the original durable unknown receipt on a write failure.
        // A file left by an interrupted writer must not block later inspection.
        let pending = self
            .root
            .join(format!("{operation_id}-{}.pending", uuid::Uuid::new_v4()));
        let mut output = private_open(&pending, true)?;
        serde_json::to_writer(&mut output, receipt)
            .map_err(|_| "Cannot encode operation receipt")?;
        output
            .sync_all()
            .map_err(|_| "Cannot persist operation receipt")?;
        fs::rename(pending, self.root.join(format!("{operation_id}.json")))
            .map_err(|_| "Cannot replace operation receipt")?;
        #[cfg(unix)]
        File::open(&self.root)
            .and_then(|directory| directory.sync_all())
            .map_err(|_| "Cannot sync operation directory")?;
        Ok(())
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
                        "resource": receipt["request"]["resource"],
                        "releaseAt": receipt["request"]["releaseAt"] }),
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
                matches!(
                    operation["action"].as_str(),
                    Some("release" | "scheduleEcsRelease" | "cancelEcsRelease")
                ) && operation["outcome"] == "released"
                    && operation["resource"] == serde_json::to_value(resource).unwrap()
            })
        });
        operations.sort_by(|a, b| b["createdAt"].as_str().cmp(&a["createdAt"].as_str()));
        let pending_operations: Vec<_> = operations
            .iter()
            .filter(|operation| {
                (operation["action"] == "hibernateEcs"
                    && !matches!(
                        operation["outcome"].as_str(),
                        Some("hibernated" | "cancelled")
                    ))
                    || (matches!(operation["action"].as_str(), Some("start" | "stop"))
                        && operation["outcome"] != "lifecycleVerified")
            })
            .cloned()
            .collect();
        operations.truncate(50);
        // Interrupted work must remain discoverable without typing its ID.
        for pending in pending_operations {
            if !operations
                .iter()
                .any(|operation| operation["operationId"] == pending["operationId"])
            {
                operations.push(pending);
            }
        }
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
        if matches!(value["request"]["action"].as_str(), Some("start" | "stop")) {
            self.validate_lifecycle_receipt(&value)?;
        }
        if value["request"]["action"] == "release" {
            self.validate_release_image_receipt(&value)?;
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
        if matches!(
            value["request"]["action"].as_str(),
            Some("scheduleEcsRelease" | "cancelEcsRelease")
        ) {
            self.validate_release_schedule_receipt(&value)?;
        }
        if value["request"]["action"] == "createEcsImage" {
            self.validate_ecs_image_receipt(&value)?;
        }
        if value["request"]["action"] == "hibernateEcs" {
            self.validate_hibernation_receipt(&value)?;
        }
        if value["request"]["action"] == "purchaseEcs" {
            self.validate_ecs_purchase_receipt(&value)?;
        }
        if value["request"]["action"] == "prepareEcsPurchase" {
            self.validate_ecs_purchase_preparation(&value)?;
        }
        if value["request"]["action"] == "prepareEcsConnection" {
            self.validate_ecs_connection_receipt(&value)?;
        }
        if value["request"]["action"] == "prepareEcsDesktop" {
            self.validate_preparation_receipt(&value)?;
        }
        if matches!(
            value["request"]["action"].as_str(),
            Some("startEcsRuntimeInstallation" | "reconnectEcsRuntime")
        ) {
            self.validate_runtime_installation_receipt(&value)?;
        }
        Ok(Some(value))
    }
}
