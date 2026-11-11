//! 精确快照查询与原盘回滚。云 API 受理不能代替用户启动后的应用验证。

use super::*;

fn validate_target(
    resource: &CloudDesktopResource,
    disk: &str,
    snapshot: &str,
) -> Result<(), String> {
    validate_resource(resource)?;
    validate_id(disk)?;
    validate_id(snapshot)?;
    if !snapshot.starts_with("s-")
        || (resource.provider == CloudDesktopProvider::Ecs && !disk.starts_with("d-"))
        || (resource.provider == CloudDesktopProvider::Wuying
            && !["system", "data"].contains(&disk))
    {
        return Err("Invalid snapshot or disk target".into());
    }
    Ok(())
}

fn confirmation(
    action: &str,
    resource: &CloudDesktopResource,
    disk: &str,
    snapshot: &str,
) -> String {
    format!(
        "{action}:{}:{}:{disk}:{snapshot}",
        resource.region_id, resource.resource_id
    )
}

impl CloudDesktopService {
    async fn inspect_snapshot_disk(
        &self,
        resource: &CloudDesktopResource,
        disk: &str,
    ) -> Result<Value, String> {
        let response = self
            .call(
                resource,
                &[
                    "DescribeDisks".into(),
                    "--DiskIds".into(),
                    json!([disk]).to_string(),
                    "--InstanceId".into(),
                    resource.resource_id.clone(),
                ],
            )
            .await?;
        let disks = response
            .pointer("/Disks/Disk")
            .and_then(Value::as_array)
            .ok_or("Invalid ECS disks response")?;
        if disks.len() != 1
            || disks[0]["DiskId"] != disk
            || disks[0]["InstanceId"] != resource.resource_id
            || response
                .get("TotalCount")
                .is_some_and(|count| count.as_u64() != Some(1))
        {
            return Err("Snapshot disk does not belong to the selected instance".into());
        }
        let disk = &disks[0];
        let status = disk["Status"].as_str().ok_or("Missing ECS disk status")?;
        // Reject shared/multi-attachment disks rather than rolling back another desktop's data.
        if disk
            .get("MultiAttach")
            .is_some_and(|value| value != "Disabled")
            || disk
                .get("MountInstanceNum")
                .is_some_and(|value| value.as_u64().is_none_or(|count| count > 1))
            || disk
                .pointer("/Attachments/Attachment")
                .is_some_and(|value| {
                    value.as_array().is_none_or(|items| {
                        items
                            .iter()
                            .any(|item| item["InstanceId"] != resource.resource_id)
                    })
                })
        {
            return Err("Snapshot restore does not support shared disks".into());
        }
        let locked = has_operation_locks(disk, "OperationLock")?;
        Ok(json!({ "diskId": disk["DiskId"], "status": status, "locked": locked }))
    }

    pub(super) async fn inspect_snapshot(
        &self,
        resource: &CloudDesktopResource,
        disk: &str,
        snapshot: &str,
    ) -> Result<Value, String> {
        validate_target(resource, disk, snapshot)?;
        let ecs = resource.provider == CloudDesktopProvider::Ecs;
        let disk_state = if ecs {
            self.inspect_snapshot_disk(resource, disk).await?
        } else {
            Value::Null
        };
        let args = if ecs {
            vec![
                "DescribeSnapshots".into(),
                "--SnapshotIds".into(),
                json!([snapshot]).to_string(),
                "--DiskId".into(),
                disk.into(),
                "--InstanceId".into(),
                resource.resource_id.clone(),
            ]
        } else {
            vec![
                "DescribeSnapshots".into(),
                "--SnapshotId".into(),
                snapshot.into(),
                "--DesktopId".into(),
                resource.resource_id.clone(),
                "--SourceDiskType".into(),
                disk.into(),
            ]
        };
        let response = self.call(resource, &args).await?;
        let items = if ecs {
            response.pointer("/Snapshots/Snapshot")
        } else {
            response.get("Snapshots")
        }
        .and_then(Value::as_array)
        .ok_or("Invalid snapshot response")?;
        if response
            .get("TotalCount")
            .is_some_and(|count| count.as_u64() != Some(items.len() as u64))
            || response
                .get("NextToken")
                .is_some_and(|token| !token.is_null() && token != "")
            || items.len() != 1
            || items[0]["SnapshotId"] != snapshot
        {
            return Err("Snapshot is missing or does not match the exact target".into());
        }
        let item = &items[0];
        if (ecs && item["SourceDiskId"] != disk)
            || (!ecs
                && (item["DesktopId"] != resource.resource_id
                    || item["SourceDiskType"] != disk.to_ascii_uppercase()))
        {
            return Err("Snapshot does not belong to the selected desktop and disk".into());
        }
        let status = item["Status"].as_str().ok_or("Missing snapshot status")?;
        let ready = if ecs {
            status == "accomplished"
                && item["Available"] == true
                && disk_state["status"] == "In_use"
                && disk_state["locked"] == false
        } else {
            status == "ACCOMPLISHED" && item["DiskStatus"] == "Available"
        };
        Ok(
            json!({ "resource": resource, "diskId": disk, "snapshotId": snapshot,
            "status": status, "ready": ready, "progress": item["Progress"].as_str(),
            "encrypted": item[if ecs { "Encrypted" } else { "VolumeEncryptionEnabled" }].as_bool(),
            "createdAt": item["CreationTime"].as_str(), "disk": disk_state,
            "retainedResourcesMayBeCharged": true }),
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) async fn restore_snapshot(
        &self,
        resource: CloudDesktopResource,
        disk: String,
        snapshot: String,
        operation_id: String,
        consent: String,
        work_saved: bool,
        discard_changes: bool,
    ) -> Result<Value, String> {
        validate_target(&resource, &disk, &snapshot)?;
        validate_id(&operation_id)?;
        if !work_saved
            || !discard_changes
            || consent != confirmation("restoreSnapshot", &resource, &disk, &snapshot)
        {
            return Err("Snapshot restore requires exact target confirmation and explicit loss of later changes".into());
        }
        self.ensure_root()?;
        let _lock = self.lock_operations()?;
        let request = json!({ "action": "restoreSnapshot", "resource": resource,
            "diskId": disk, "snapshotId": snapshot, "discardChanges": true });
        if let Some(receipt) = self.read_receipt(&operation_id)? {
            if receipt["request"] != request {
                return Err("Operation ID belongs to a different request".into());
            }
            return Ok(receipt);
        }
        self.check_change_available(&resource, "restoreSnapshot")?;
        let observed = self.inspect(&resource).await?;
        if observed["status"] != "Stopped" || observed["operationBlocked"] == true {
            return Err("Snapshot restore requires a stopped, unlocked desktop".into());
        }
        let source = self.inspect_snapshot(&resource, &disk, &snapshot).await?;
        if source["ready"] != true {
            return Err("Snapshot is not available for restore".into());
        }
        let mut receipt = json!({ "operationId": operation_id, "request": request,
            "outcome": "unknown", "createdAt": chrono::Utc::now().to_rfc3339(),
            "observedBefore": observed, "snapshotBefore": source, "snapshotId": snapshot,
            "requiresInspection": true, "requiresApplicationValidation": true });
        self.create_receipt(&operation_id, &receipt)?;
        let args = if resource.provider == CloudDesktopProvider::Ecs {
            vec![
                "ResetDisk".into(),
                "--DiskId".into(),
                disk,
                "--SnapshotId".into(),
                snapshot,
            ]
        } else {
            // Do not implicitly stop a running desktop or rebuild from an unrelated image.
            vec![
                "ResetSnapshot".into(),
                "--SnapshotId".into(),
                snapshot,
                "--StopDesktop".into(),
                "false".into(),
            ]
        };
        match self.call(&resource, &args).await {
            Ok(response)
                if response["RequestId"]
                    .as_str()
                    .is_some_and(|id| !id.is_empty()) =>
            {
                receipt["outcome"] = json!("accepted");
                receipt["requestId"] = json!(response["RequestId"].as_str());
            }
            Ok(_) => {
                receipt["diagnostic"] =
                    json!("Missing provider request ID; restore outcome remains unknown")
            }
            Err(error) => receipt["diagnostic"] = json!(error),
        }
        self.finalize_receipt(&operation_id, &receipt);
        Ok(receipt)
    }

    pub(super) async fn inspect_snapshot_operation(&self, id: &str) -> Result<Value, String> {
        let _lock = self.lock_operations()?;
        let mut receipt = self
            .read_receipt(id)?
            .ok_or("Cloud desktop operation does not exist")?;
        if receipt["outcome"] == "verified" {
            return Ok(receipt);
        }
        let request = &receipt["request"];
        let resource: CloudDesktopResource = serde_json::from_value(request["resource"].clone())
            .map_err(|_| "Invalid snapshot receipt resource")?;
        let disk = request["diskId"]
            .as_str()
            .ok_or("Missing snapshot receipt disk")?;
        let snapshot = if request["action"] == "snapshot" {
            &receipt["snapshotId"]
        } else {
            &request["snapshotId"]
        }
        .as_str()
        .ok_or("Snapshot ID unavailable; reconcile in the provider console without resubmitting")?;
        let source = self.inspect_snapshot(&resource, disk, snapshot).await?;
        if request["action"] == "snapshot" {
            if source["ready"] == true {
                receipt["outcome"] = json!("snapshotReady");
                receipt["requiresInspection"] = json!(false);
            }
        } else {
            receipt["observedAfter"] = self.inspect(&resource).await?;
        }
        receipt["snapshotObserved"] = source;
        receipt["inspectedAt"] = json!(chrono::Utc::now().to_rfc3339());
        self.finalize_receipt(id, &receipt);
        Ok(receipt)
    }

    pub(super) async fn verify_snapshot_restore(
        &self,
        id: &str,
        consent: &str,
        validated: bool,
    ) -> Result<Value, String> {
        validate_id(id)?;
        self.ensure_root()?;
        let _lock = self.lock_operations()?;
        let mut receipt = self
            .read_receipt(id)?
            .ok_or("Cloud desktop operation does not exist")?;
        if receipt["request"]["action"] != "restoreSnapshot" {
            return Err("Operation is not a snapshot restore".into());
        }
        let request = &receipt["request"];
        let resource: CloudDesktopResource = serde_json::from_value(request["resource"].clone())
            .map_err(|_| "Invalid snapshot receipt resource")?;
        let disk = request["diskId"].as_str().ok_or("Missing restore disk")?;
        let snapshot = request["snapshotId"]
            .as_str()
            .ok_or("Missing restore snapshot")?;
        if !validated || consent != confirmation("verifyRestore", &resource, disk, snapshot) {
            return Err(
                "Explicit verification of restored files and applications is required".into(),
            );
        }
        if receipt["outcome"] == "verified" {
            return Ok(receipt);
        }
        let observed = self.inspect(&resource).await?;
        if observed["status"] != "Running" {
            return Err("Start the desktop and verify restored applications first".into());
        }
        receipt["observedAfter"] = observed;
        receipt["outcome"] = json!("verified");
        receipt["verification"] = json!("userConfirmed");
        receipt["verifiedAt"] = json!(chrono::Utc::now().to_rfc3339());
        receipt["requiresInspection"] = json!(false);
        receipt["requiresApplicationValidation"] = json!(false);
        self.finalize_receipt(id, &receipt);
        Ok(receipt)
    }

    pub(super) fn validate_restore_receipt(&self, receipt: &Value) -> Result<(), String> {
        let request = &receipt["request"];
        let resource: CloudDesktopResource = serde_json::from_value(request["resource"].clone())
            .map_err(|_| "Invalid restore receipt resource")?;
        validate_target(
            &resource,
            request["diskId"].as_str().unwrap_or(""),
            request["snapshotId"].as_str().unwrap_or(""),
        )?;
        if request["discardChanges"] != true
            || receipt["observedBefore"]["resource"] != request["resource"]
            || receipt["observedBefore"]["status"] != "Stopped"
            || receipt["snapshotBefore"]["ready"] != true
            || receipt["snapshotBefore"]["resource"] != request["resource"]
            || receipt["snapshotBefore"]["diskId"] != request["diskId"]
            || receipt["snapshotBefore"]["snapshotId"] != request["snapshotId"]
            || !matches!(
                receipt["outcome"].as_str(),
                Some("unknown" | "accepted" | "verified")
            )
        {
            return Err("Invalid snapshot restore receipt".into());
        }
        if receipt["outcome"] == "verified"
            && (receipt["verification"] != "userConfirmed"
                || receipt["observedAfter"]["status"] != "Running"
                || receipt["observedAfter"]["resource"] != request["resource"]
                || receipt["requiresInspection"] != false
                || receipt["requiresApplicationValidation"] != false
                || receipt["verifiedAt"]
                    .as_str()
                    .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
                    .is_none())
        {
            return Err("Snapshot restore receipt is missing user application validation".into());
        }
        Ok(())
    }
}
