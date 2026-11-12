//! 启停、冷快照与释放；同一收据先持久化再提交供应商变更。

use super::*;

pub(super) enum LifecycleChange {
    Start,
    Stop,
    Snapshot(String),
    Release(Option<String>),
}

impl CloudDesktopService {
    pub(super) async fn mutate(
        &self,
        resource: CloudDesktopResource,
        operation_id: String,
        confirmation: String,
        change: LifecycleChange,
        work_saved: bool,
    ) -> Result<Value, String> {
        let (action, disk_id, image_operation_id) = match change {
            LifecycleChange::Start => ("start", None, None),
            LifecycleChange::Stop => ("stop", None, None),
            LifecycleChange::Snapshot(disk) => ("snapshot", Some(disk), None),
            LifecycleChange::Release(image) => ("release", None, image),
        };
        if let Some(id) = &image_operation_id {
            validate_id(id)?;
            if resource.provider != CloudDesktopProvider::Ecs {
                return Err("Private system images can only protect ECS releases".into());
            }
        }
        validate_resource(&resource)?;
        validate_id(&operation_id)?;
        if resource.provider == CloudDesktopProvider::Wuying
            && disk_id
                .as_deref()
                .is_some_and(|disk| !["system", "data"].contains(&disk))
        {
            return Err("Wuying snapshot source must be system or data".into());
        }
        let expected = format!(
            "{action}:{}:{}{}",
            resource.region_id,
            resource.resource_id,
            if action == "release" {
                match &image_operation_id {
                    Some(id) => format!(":discard-data:image:{id}"),
                    None => ":discard-data".into(),
                }
            } else {
                disk_id
                    .as_ref()
                    .map(|disk| format!(":{disk}"))
                    .unwrap_or_default()
            }
        );
        if confirmation != expected || !work_saved {
            return Err(
                "Explicit resource confirmation and saved/quiesced work are required".into(),
            );
        }
        self.ensure_root()?;
        let _lock = self.lock_operations()?;
        let mut request = json!({ "resource": resource, "action": action, "diskId": disk_id });
        if action == "release" {
            request["discardData"] = json!(true);
            if let Some(id) = &image_operation_id {
                request["imageOperationId"] = json!(id);
            }
        }
        if let Some(existing) = self.read_receipt(&operation_id)? {
            if existing["request"] != request {
                return Err("Operation ID belongs to a different request".into());
            }
            return Ok(existing);
        }
        self.check_change_available(&resource, action)?;
        let observed = self.inspect(&resource).await?;
        let state = observed["status"].as_str().unwrap_or("");
        if action == "start" && resource.provider == CloudDesktopProvider::Ecs {
            scheduled_release::require_no_deadline(&observed)?;
        }
        match action {
            "start" if state != "Stopped" => {
                return Err("Only a stopped cloud desktop can be started".into())
            }
            "stop" if state != "Running" => {
                return Err("Only a running cloud desktop can be stopped".into())
            }
            "snapshot" if state != "Stopped" => {
                return Err("Cold disk snapshots require a stopped, quiesced instance".into())
            }
            "release" if state != "Stopped" || observed["instanceChargeType"] != "PostPaid" => {
                return Err("Only a stopped PostPaid cloud desktop can be released".into())
            }
            _ => {}
        }
        if let Some(disk) = disk_id
            .as_ref()
            .filter(|_| resource.provider == CloudDesktopProvider::Ecs)
        {
            let response = self
                .call(
                    &resource,
                    &[
                        "DescribeDisks".into(),
                        "--DiskIds".into(),
                        json!([disk]).to_string(),
                    ],
                )
                .await?;
            let disks = response
                .pointer("/Disks/Disk")
                .and_then(Value::as_array)
                .ok_or("Invalid ECS disks response")?;
            if disks.len() != 1
                || disks[0]["DiskId"] != *disk
                || disks[0]["InstanceId"] != resource.resource_id
            {
                return Err("Snapshot disk does not belong to the selected instance".into());
            }
        }
        let mut receipt = json!({ "operationId": operation_id, "request": request, "outcome": "unknown",
            "createdAt": chrono::Utc::now().to_rfc3339(), "observedBefore": observed,
            "requiresInspection": true });
        if let Some(id) = &image_operation_id {
            match self.image_release_proof(&resource, &observed, id).await {
                Ok(proof) => receipt["releaseImage"] = proof,
                Err(_) => {
                    return Ok(json!({"operationId":operation_id,"request":request,
                    "outcome":"notSubmitted","submitted":false,"requiresInspection":false,
                    "failureCode":"imageVerificationFailed"}))
                }
            }
        }
        self.create_receipt(&operation_id, &receipt)?;
        let args = if resource.provider == CloudDesktopProvider::Wuying {
            match action {
                "start" => vec![
                    "StartDesktops".into(),
                    "--DesktopId.1".into(),
                    resource.resource_id.clone(),
                ],
                "stop" => vec![
                    "StopDesktops".into(),
                    "--DesktopId.1".into(),
                    resource.resource_id.clone(),
                    "--StoppedMode".into(),
                    "StopCharging".into(),
                ],
                "release" => vec![
                    "DeleteDesktops".into(),
                    "--DesktopId.1".into(),
                    resource.resource_id.clone(),
                ],
                "snapshot" => {
                    let disk = disk_id.as_deref().unwrap_or("");
                    vec![
                        "CreateSnapshot".into(),
                        "--DesktopId".into(),
                        resource.resource_id.clone(),
                        "--SourceDiskType".into(),
                        disk.into(),
                        "--SnapshotName".into(),
                        format!("Lime-{operation_id}"),
                    ]
                }
                _ => unreachable!(),
            }
        } else {
            match action {
                "start" => vec![
                    "StartInstance".into(),
                    "--InstanceId".into(),
                    resource.resource_id.clone(),
                ],
                "stop" => vec![
                    "StopInstance".into(),
                    "--InstanceId".into(),
                    resource.resource_id.clone(),
                    "--StoppedMode".into(),
                    "StopCharging".into(),
                    "--ForceStop".into(),
                    "false".into(),
                ],
                "release" => vec![
                    "DeleteInstance".into(),
                    "--InstanceId".into(),
                    resource.resource_id.clone(),
                    "--Force".into(),
                    "false".into(),
                    "--TerminateSubscription".into(),
                    "false".into(),
                ],
                "snapshot" => vec![
                    "CreateSnapshot".into(),
                    "--DiskId".into(),
                    disk_id.unwrap(),
                    "--ClientToken".into(),
                    operation_id.clone(),
                ],
                _ => unreachable!(),
            }
        };
        match self.call(&resource, &args).await {
            Ok(response) => {
                // API acceptance is not a completed start, compute release or usable snapshot.
                receipt["outcome"] = json!("accepted");
                receipt["requestId"] = json!(response["RequestId"].as_str());
                receipt["snapshotId"] = json!(response["SnapshotId"].as_str());
            }
            Err(error) => receipt["diagnostic"] = json!(error),
        }
        self.finalize_receipt(&operation_id, &receipt);
        Ok(receipt)
    }
}
