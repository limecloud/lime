//! 用户私有系统镜像。只保存已确认的加密冷快照，不共享、导出或重放创建请求。

use super::*;
use sha2::{Digest, Sha256};
use std::collections::HashSet;

const PURPOSE: &str = "lime-system-image";
const OPERATION: &str = "lime-operation";

#[cfg(all(test, unix))]
mod tests;

fn digest(request: &Value) -> Result<String, String> {
    Ok(format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(request).map_err(|_| "Invalid system image request")?)
    ))
}

fn items<'a>(response: &'a Value, path: &str) -> Result<&'a Vec<Value>, String> {
    let items = response
        .pointer(path)
        .and_then(Value::as_array)
        .ok_or("Invalid system image inventory")?;
    if items.len() > 100
        || response["TotalCount"].as_u64() != Some(items.len() as u64)
        || response
            .get("NextToken")
            .is_some_and(|value| !value.is_null() && value != "")
    {
        return Err("System image inventory is incomplete or exceeds 100 entries".into());
    }
    Ok(items)
}

fn source_snapshot(item: &Value, snapshot: &str, disk: Option<&str>) -> Result<Value, String> {
    let source_disk = item["SourceDiskId"]
        .as_str()
        .ok_or("Missing system snapshot disk")?;
    validate_id(source_disk)?;
    let size = item["SourceDiskSize"].as_u64().or_else(|| {
        item["SourceDiskSize"]
            .as_str()
            .and_then(|value| value.parse::<u64>().ok())
    });
    if item["SnapshotId"] != snapshot
        || !source_disk.starts_with("d-")
        || disk.is_some_and(|disk| disk != source_disk)
        || item["SourceDiskType"] != "system"
        || item["Encrypted"] != true
        || item["Status"] != "accomplished"
        || item["Available"] != true
        || size.is_none_or(|value| !(60..=500).contains(&value))
    {
        return Err("System image requires an exact available encrypted system snapshot".into());
    }
    Ok(
        json!({"snapshotId": snapshot, "diskId": source_disk, "encrypted": true,
        "systemDiskGiB": size, "ready": true}),
    )
}

fn tag<'a>(image: &'a Value, key: &str) -> Result<&'a str, String> {
    let tags = image
        .pointer("/Tags/Tag")
        .and_then(Value::as_array)
        .ok_or("Missing system image tags")?;
    let mut found = None;
    for tag in tags {
        // The official Tag structure exposes both spellings. Conflicting pairs
        // must never be used to recover a different operation.
        let short = tag
            .get("Key")
            .filter(|value| value.as_str().is_some_and(|key| !key.is_empty()));
        let long = tag
            .get("TagKey")
            .filter(|value| value.as_str().is_some_and(|key| !key.is_empty()));
        if short.is_some() && long.is_some() && (short != long || tag["Value"] != tag["TagValue"]) {
            return Err("Conflicting system image tags".into());
        }
        if short.or(long).and_then(Value::as_str) == Some(key) {
            if found.is_some() {
                return Err("Duplicate system image tag".into());
            }
            found = tag[if short.is_some() { "Value" } else { "TagValue" }].as_str();
            if found.is_none() {
                return Err("Invalid system image tag".into());
            }
        }
    }
    found.ok_or_else(|| "System image tag does not match".into())
}

fn image_snapshot(image: &Value) -> Result<&str, String> {
    let mappings = image
        .pointer("/DiskDeviceMappings/DiskDeviceMapping")
        .and_then(Value::as_array)
        .ok_or("Missing system image disk mapping")?;
    if mappings.len() != 1 || mappings[0]["Type"] != "system" {
        return Err("System image must contain exactly one system disk".into());
    }
    let id = mappings[0]["SnapshotId"]
        .as_str()
        .ok_or("Missing system image snapshot")?;
    validate_id(id)?;
    if !id.starts_with("s-") {
        return Err("Invalid system image snapshot".into());
    }
    Ok(id)
}

fn image_state(image: &Value, source: &Value, operation: Option<&str>) -> Result<Value, String> {
    let id = image["ImageId"].as_str().ok_or("Missing system image ID")?;
    validate_id(id)?;
    let op = tag(image, OPERATION)?;
    validate_id(op)?;
    if !id.starts_with("m-")
        || tag(image, PURPOSE)? != "true"
        || operation.is_some_and(|expected| expected != op)
        || image["ImageOwnerAlias"] != "self"
        || image["IsPublic"] != false
        || !image["IsSelfShared"]
            .as_str()
            .is_some_and(|value| value.eq_ignore_ascii_case("false"))
        || image["Platform"] != "Ubuntu"
        || image["Architecture"] != "x86_64"
        || image["OSType"] != "linux"
        || image_snapshot(image)? != source["snapshotId"]
        || image["Size"] != source["systemDiskGiB"]
        || !matches!(
            image["Status"].as_str(),
            Some(
                "Creating"
                    | "Waiting"
                    | "Available"
                    | "UnAvailable"
                    | "CreateFailed"
                    | "Deprecated"
            )
        )
    {
        return Err(
            "System image is not an exact private Ubuntu x86_64 image from the encrypted snapshot"
                .into(),
        );
    }
    let name = image["ImageName"]
        .as_str()
        .filter(|name| !name.is_empty() && name.len() <= 128 && !name.chars().any(char::is_control))
        .ok_or("Invalid system image name")?;
    Ok(json!({"imageId": id, "name": name, "operationId": op,
        "snapshotId": source["snapshotId"], "diskId": source["diskId"],
        "systemDiskGiB": source["systemDiskGiB"], "encrypted": true, "private": true,
        "status": image["Status"], "ready": image["Status"] == "Available",
        "createdAt": image["CreationTime"].as_str(), "retainedResourcesMayBeCharged": true}))
}

impl CloudDesktopService {
    /// Called under the lifecycle operation lock, immediately before the durable release intent.
    pub(super) async fn image_release_proof(
        &self,
        resource: &CloudDesktopResource,
        instance: &Value,
        operation: &str,
    ) -> Result<Value, String> {
        let receipt = self
            .read_receipt(operation)?
            .ok_or("System image operation does not exist")?;
        let request = &receipt["request"];
        if request["action"] != "createEcsImage"
            || request["resource"] != serde_json::to_value(resource).unwrap()
            || receipt["outcome"] != "imageReady"
            || resource.provider != CloudDesktopProvider::Ecs
            || instance["status"] != "Stopped"
        {
            return Err("Release requires a ready system image from this exact desktop".into());
        }
        let disk = request["diskId"]
            .as_str()
            .ok_or("Missing system image disk")?;
        let response = self
            .call(
                resource,
                &[
                    "DescribeDisks".into(),
                    "--InstanceId".into(),
                    resource.resource_id.clone(),
                    "--PageSize".into(),
                    "100".into(),
                ],
            )
            .await?;
        let disks = items(&response, "/Disks/Disk")?;
        if disks.len() != 1
            || disks[0]["DiskId"] != disk
            || disks[0]["InstanceId"] != resource.resource_id
            || disks[0]["Type"] != "system"
            || disks[0]["Encrypted"] != true
        {
            return Err("System image release requires exactly the original encrypted system disk and no additional attached disks".into());
        }
        let source = self
            .image_snapshot_source(
                resource,
                request["snapshotId"]
                    .as_str()
                    .ok_or("Missing system image snapshot")?,
                Some(disk),
            )
            .await?;
        let response = self
            .call(
                resource,
                &[
                    "DescribeImages".into(),
                    "--ImageId".into(),
                    receipt["imageId"]
                        .as_str()
                        .ok_or("Missing system image ID")?
                        .into(),
                    "--ImageOwnerAlias".into(),
                    "self".into(),
                    "--PageSize".into(),
                    "100".into(),
                ],
            )
            .await?;
        let images = items(&response, "/Images/Image")?;
        if images.len() != 1 {
            return Err("Retained system image is missing or ambiguous".into());
        }
        let image = image_state(&images[0], &source, Some(operation))?;
        if image["imageId"] != receipt["imageId"] || image["ready"] != true {
            return Err("Retained system image is no longer available".into());
        }
        Ok(json!({"operationId":operation,"imageId":image["imageId"],
            "snapshotId":source["snapshotId"],"diskId":disk,"ready":true,
            "private":true,"encrypted":true,"inspectedAt":chrono::Utc::now().to_rfc3339(),
            "requiresApplicationValidation":true,"retainedResourcesMayBeCharged":true}))
    }

    pub(super) fn validate_release_image_receipt(&self, receipt: &Value) -> Result<(), String> {
        let Some(operation) = receipt["request"].get("imageOperationId") else {
            if receipt.get("releaseImage").is_some() {
                return Err("Unexpected retained image proof".into());
            }
            return Ok(());
        };
        let operation = operation
            .as_str()
            .ok_or("Invalid retained image operation")?;
        validate_id(operation)?;
        let proof = &receipt["releaseImage"];
        for (key, prefix) in [("imageId", "m-"), ("snapshotId", "s-"), ("diskId", "d-")] {
            let id = proof[key].as_str().ok_or("Missing retained image proof")?;
            validate_id(id)?;
            if !id.starts_with(prefix) {
                return Err("Invalid retained image target".into());
            }
        }
        if receipt["request"]["resource"]["provider"] != "ecs"
            || proof["operationId"] != operation
            || proof["ready"] != true
            || proof["private"] != true
            || proof["encrypted"] != true
            || proof["requiresApplicationValidation"] != true
            || proof["retainedResourcesMayBeCharged"] != true
            || proof["inspectedAt"]
                .as_str()
                .and_then(|time| chrono::DateTime::parse_from_rfc3339(time).ok())
                .is_none()
        {
            return Err("Invalid retained private image proof".into());
        }
        Ok(())
    }

    async fn image_snapshot_source(
        &self,
        resource: &CloudDesktopResource,
        snapshot: &str,
        disk: Option<&str>,
    ) -> Result<Value, String> {
        let response = self
            .call(
                resource,
                &[
                    "DescribeSnapshots".into(),
                    "--SnapshotIds".into(),
                    json!([snapshot]).to_string(),
                ],
            )
            .await?;
        let inventory = items(&response, "/Snapshots/Snapshot")?;
        if inventory.len() != 1 {
            return Err("System snapshot is missing or ambiguous".into());
        }
        source_snapshot(&inventory[0], snapshot, disk)
    }

    pub(super) async fn create_ecs_image(
        &self,
        snapshot_operation: &str,
        id: &str,
        confirmation: &str,
        include_credentials: bool,
    ) -> Result<Value, String> {
        self.create_ecs_image_for_hibernation(
            snapshot_operation,
            id,
            confirmation,
            include_credentials,
            None,
        )
        .await
    }

    pub(super) async fn create_ecs_image_for_hibernation(
        &self,
        snapshot_operation: &str,
        id: &str,
        confirmation: &str,
        include_credentials: bool,
        parent: Option<&str>,
    ) -> Result<Value, String> {
        validate_id(snapshot_operation)?;
        validate_id(id)?;
        if !include_credentials || confirmation != format!("createEcsImage:{snapshot_operation}") {
            return Err("System image requires explicit consent to preserve the entire disk including credentials".into());
        }
        self.ensure_root()?;
        let _lock = self.lock_operations()?;
        if let Some(receipt) = self.read_receipt(id)? {
            if receipt["request"]["action"] != "createEcsImage"
                || receipt["request"]["snapshotOperationId"] != snapshot_operation
            {
                return Err("Operation ID belongs to another request".into());
            }
            return Ok(receipt);
        }
        let original = self
            .read_receipt(snapshot_operation)?
            .ok_or("Cold snapshot operation does not exist")?;
        let request = &original["request"];
        let resource: CloudDesktopResource = serde_json::from_value(request["resource"].clone())
            .map_err(|_| "Invalid cold snapshot resource")?;
        validate_resource(&resource)?;
        let disk = request["diskId"]
            .as_str()
            .ok_or("Missing cold snapshot disk")?;
        let snapshot = original["snapshotId"]
            .as_str()
            .ok_or("Missing cold snapshot ID")?;
        validate_id(disk)?;
        validate_id(snapshot)?;
        let recorded = &original["snapshotObserved"];
        if resource.provider != CloudDesktopProvider::Ecs
            || request["action"] != "snapshot"
            || original["outcome"] != "snapshotReady"
            || original["requiresInspection"] != false
            || original["observedBefore"]["status"] != "Stopped"
            || original["observedBefore"]["resource"] != request["resource"]
            || recorded["resource"] != request["resource"]
            || recorded["snapshotId"] != snapshot
            || recorded["diskId"] != disk
            || recorded["encrypted"] != true
            || recorded["ready"] != true
            || !disk.starts_with("d-")
            || !snapshot.starts_with("s-")
        {
            return Err("Select a verified encrypted cold ECS snapshot operation".into());
        }
        self.check_change_available_for_hibernation(&resource, "createEcsImage", id, parent)?;
        // Do not inspect the old VM or disk: both may already have been released.
        let source = self
            .image_snapshot_source(&resource, snapshot, Some(disk))
            .await?;
        let request = json!({"action":"createEcsImage", "resource":resource,
            "snapshotOperationId":snapshot_operation, "snapshotId":snapshot,
            "diskId":disk, "includeCredentials":true});
        let request_hash = digest(&request)?;
        let mut receipt = json!({"operationId":id,"request":request,"requestSha256":request_hash,
            "snapshotBefore":source,"outcome":"unknown","requiresInspection":true,
            "createdAt":chrono::Utc::now().to_rfc3339(),"requiresApplicationValidation":true});
        self.create_receipt(id, &receipt)?;
        let token = format!("{:x}", Sha256::digest(id.as_bytes()));
        let response = self
            .call(
                &resource,
                &[
                    "CreateImage".into(),
                    "--SnapshotId".into(),
                    snapshot.into(),
                    "--ImageName".into(),
                    format!("Lime-system-{}", &token[..32]),
                    "--ClientToken".into(),
                    token,
                    "--Tag.1.Key".into(),
                    OPERATION.into(),
                    "--Tag.1.Value".into(),
                    id.into(),
                    "--Tag.2.Key".into(),
                    PURPOSE.into(),
                    "--Tag.2.Value".into(),
                    "true".into(),
                ],
            )
            .await;
        if let Ok(response) = response {
            if let Some(image) = response["ImageId"]
                .as_str()
                .filter(|id| id.starts_with("m-") && validate_id(id).is_ok())
            {
                receipt["imageId"] = json!(image);
                receipt["outcome"] = json!("accepted");
            }
        }
        if receipt["outcome"] == "unknown" {
            receipt["diagnostic"] = json!("Inspect this operation; the image creation result is unknown and will not be submitted again");
        }
        self.finalize_receipt(id, &receipt);
        Ok(receipt)
    }

    pub(super) async fn inspect_ecs_image_operation(&self, id: &str) -> Result<Value, String> {
        let _lock = self.lock_operations()?;
        let mut receipt = self
            .read_receipt(id)?
            .ok_or("System image operation does not exist")?;
        let request = &receipt["request"];
        let resource: CloudDesktopResource = serde_json::from_value(request["resource"].clone())
            .map_err(|_| "Invalid system image resource")?;
        let mut args = vec![
            "DescribeImages".into(),
            "--ImageOwnerAlias".into(),
            "self".into(),
            "--Tag.1.Key".into(),
            OPERATION.into(),
            "--Tag.1.Value".into(),
            id.into(),
            "--PageSize".into(),
            "100".into(),
        ];
        if let Some(image) = receipt["imageId"].as_str() {
            args.extend(["--ImageId".into(), image.into()]);
        }
        let response = self.call(&resource, &args).await?;
        let images = items(&response, "/Images/Image")?;
        if images.is_empty() {
            // Absence or eventual consistency cannot authorize creating another image.
            return Err("System image not observed; keep the original operation and reconcile without resubmitting".into());
        }
        if images.len() != 1
            || receipt["imageId"]
                .as_str()
                .is_some_and(|id| images[0]["ImageId"] != id)
        {
            return Err("System image operation is ambiguous or mismatched".into());
        }
        let source = self
            .image_snapshot_source(
                &resource,
                request["snapshotId"].as_str().unwrap(),
                request["diskId"].as_str(),
            )
            .await?;
        let observed = image_state(&images[0], &source, Some(id))?;
        if observed["snapshotId"] != request["snapshotId"] {
            return Err("System image source changed".into());
        }
        receipt["imageId"] = observed["imageId"].clone();
        receipt["outcome"] = json!(if observed["ready"] == true {
            "imageReady"
        } else if observed["status"] == "CreateFailed" {
            "imageFailed"
        } else {
            "accepted"
        });
        receipt["requiresInspection"] = json!(receipt["outcome"] == "accepted");
        receipt["imageObserved"] = observed;
        receipt["inspectedAt"] = json!(chrono::Utc::now().to_rfc3339());
        receipt.as_object_mut().unwrap().remove("diagnostic");
        self.finalize_receipt(id, &receipt);
        Ok(receipt)
    }

    pub(super) async fn list_ecs_images(
        &self,
        region: &str,
        profile: &str,
    ) -> Result<Value, String> {
        validate_id(region)?;
        validate_id(profile)?;
        let response = self
            .call_api(
                CloudDesktopProvider::Ecs,
                region,
                profile,
                &[
                    "DescribeImages".into(),
                    "--ImageOwnerAlias".into(),
                    "self".into(),
                    "--Tag.1.Key".into(),
                    PURPOSE.into(),
                    "--Tag.1.Value".into(),
                    "true".into(),
                    "--PageSize".into(),
                    "100".into(),
                ],
            )
            .await?;
        let inventory = items(&response, "/Images/Image")?;
        let mut snapshots = HashSet::new();
        for image in inventory {
            snapshots.insert(image_snapshot(image)?.to_owned());
        }
        let mut ids: Vec<_> = snapshots.into_iter().collect();
        ids.sort();
        let sources = if ids.is_empty() {
            json!({"TotalCount":0,"Snapshots":{"Snapshot":[]}})
        } else {
            self.call_api(
                CloudDesktopProvider::Ecs,
                region,
                profile,
                &[
                    "DescribeSnapshots".into(),
                    "--SnapshotIds".into(),
                    json!(ids).to_string(),
                    "--PageSize".into(),
                    "100".into(),
                ],
            )
            .await?
        };
        let sources = items(&sources, "/Snapshots/Snapshot")?;
        if sources.len() != ids.len() {
            return Err("System image source inventory is incomplete".into());
        }
        let mut seen = HashSet::new();
        let mut images = Vec::new();
        for image in inventory {
            let snapshot = image_snapshot(image)?;
            let matches: Vec<_> = sources
                .iter()
                .filter(|source| source["SnapshotId"] == snapshot)
                .collect();
            if matches.len() != 1 {
                return Err("System image source is missing or ambiguous".into());
            }
            let source = source_snapshot(matches[0], snapshot, None)?;
            let observed = image_state(image, &source, None)?;
            if !seen.insert(observed["imageId"].clone().to_string()) {
                return Err("Duplicate system image identity".into());
            }
            images.push(observed);
        }
        Ok(json!({"regionId":region,"profile":profile,"images":images}))
    }

    pub(super) fn validate_ecs_image_receipt(&self, receipt: &Value) -> Result<(), String> {
        let request = &receipt["request"];
        let resource: CloudDesktopResource = serde_json::from_value(request["resource"].clone())
            .map_err(|_| "Invalid system image receipt resource")?;
        validate_resource(&resource)?;
        for key in ["snapshotOperationId", "snapshotId", "diskId"] {
            validate_id(
                request[key]
                    .as_str()
                    .ok_or("Missing system image receipt target")?,
            )?;
        }
        let source = &receipt["snapshotBefore"];
        if resource.provider != CloudDesktopProvider::Ecs
            || request["includeCredentials"] != true
            || source["snapshotId"] != request["snapshotId"]
            || source["diskId"] != request["diskId"]
            || source["encrypted"] != true
            || source["ready"] != true
            || source["systemDiskGiB"]
                .as_u64()
                .is_none_or(|size| !(60..=500).contains(&size))
            || receipt["requestSha256"] != digest(request)?
            || !matches!(
                receipt["outcome"].as_str(),
                Some("unknown" | "accepted" | "imageReady" | "imageFailed")
            )
            || receipt["createdAt"]
                .as_str()
                .and_then(|date| chrono::DateTime::parse_from_rfc3339(date).ok())
                .is_none()
        {
            return Err("Invalid system image receipt".into());
        }
        if let Some(id) = receipt.get("imageId") {
            let id = id.as_str().ok_or("Invalid system image receipt ID")?;
            validate_id(id)?;
            if !id.starts_with("m-") {
                return Err("Invalid system image receipt ID".into());
            }
        } else if receipt["outcome"] != "unknown" {
            return Err("Missing system image receipt ID".into());
        }
        let terminal = matches!(
            receipt["outcome"].as_str(),
            Some("imageReady" | "imageFailed")
        );
        if receipt["requiresInspection"] != !terminal
            || receipt["requiresApplicationValidation"] != true
        {
            return Err("Invalid system image inspection state".into());
        }
        if terminal {
            let observed = &receipt["imageObserved"];
            if observed["imageId"] != receipt["imageId"]
                || observed["operationId"] != receipt["operationId"]
                || observed["snapshotId"] != request["snapshotId"]
                || observed["diskId"] != request["diskId"]
                || observed["encrypted"] != true
                || observed["private"] != true
                || observed["systemDiskGiB"] != source["systemDiskGiB"]
                || (receipt["outcome"] == "imageReady"
                    && (observed["ready"] != true || observed["status"] != "Available"))
                || (receipt["outcome"] == "imageFailed"
                    && (observed["ready"] != false || observed["status"] != "CreateFailed"))
                || receipt["inspectedAt"]
                    .as_str()
                    .and_then(|date| chrono::DateTime::parse_from_rfc3339(date).ok())
                    .is_none()
            {
                return Err("System image receipt lacks exact source verification".into());
            }
        }
        Ok(())
    }
}
