//! 一次授权保存环境并释放；父收据保留固定子操作，读取状态不启动云端变更。

use super::*;
use receipts::OperationLock;
use sha2::{Digest, Sha256};

#[cfg(all(test, unix))]
mod tests;
mod worker;

pub(super) fn terminal(receipt: &Value) -> bool {
    matches!(
        receipt["outcome"].as_str(),
        Some("hibernated" | "cancelled")
    )
}

fn digest(request: &Value, disk: &str) -> Result<String, String> {
    let mut payload = json!({"request":request,"diskId":disk});
    // 不让 serde_json 的 preserve_order 特性改变持久收据的摘要。
    payload.sort_all_objects();
    Ok(format!(
        "{:x}",
        Sha256::digest(
            serde_json::to_vec(&payload).map_err(|_| "Invalid environment preservation request")?
        )
    ))
}

fn children(id: &str) -> Value {
    let mut result = json!({});
    for action in ["stop", "snapshot", "createEcsImage", "release"] {
        let hash = format!("{:x}", Sha256::digest(format!("{id}:{action}").as_bytes()));
        result[action] = json!(format!("hib-{}", &hash[..48]));
    }
    result
}

impl CloudDesktopService {
    fn hibernation_lease(&self, id: &str) -> Result<Option<OperationLock>, String> {
        validate_id(id)?;
        let file = private_open(&self.root.join(format!("{id}.worker.lock")), false)?;
        match file.try_lock_exclusive() {
            Ok(()) => Ok(Some(OperationLock::new(file))),
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => Ok(None),
            Err(_) => Err("Cannot inspect environment preservation worker".into()),
        }
    }

    pub(super) fn hibernation_status(&self, mut receipt: Value) -> Result<Value, String> {
        let id = receipt["operationId"]
            .as_str()
            .ok_or("Missing preservation operation")?;
        let active = !terminal(&receipt) && self.hibernation_lease(id)?.is_none();
        receipt["workerActive"] = json!(active);
        receipt["canResume"] = json!(!terminal(&receipt) && !active);
        receipt["canCancel"] =
            json!(!terminal(&receipt) && !self.hibernation_release_started(&receipt)?);
        Ok(receipt)
    }

    pub(super) async fn hibernate_ecs(
        &self,
        resource: CloudDesktopResource,
        id: String,
        confirmation: String,
        work_saved: bool,
        include_credentials: bool,
        discard_data: bool,
    ) -> Result<Value, String> {
        validate_resource(&resource)?;
        validate_id(&id)?;
        if resource.provider != CloudDesktopProvider::Ecs
            || !work_saved
            || !include_credentials
            || !discard_data
            || confirmation
                != format!(
                    "hibernateEcs:{}:{}:private-image:discard-data",
                    resource.region_id, resource.resource_id
                )
        {
            return Err("Saving an ECS environment requires explicit consent to stop work, preserve credentials and release the original disk".into());
        }
        self.ensure_root()?;
        let request = json!({"action":"hibernateEcs","resource":resource,"workSaved":true,
            "includeCredentials":true,"discardData":true});
        let receipt = {
            let _lock = self.lock_operations()?;
            if let Some(existing) = self.read_receipt(&id)? {
                if existing["request"] != request {
                    return Err("Operation ID belongs to a different request".into());
                }
                existing
            } else {
                self.check_change_available(&resource, "hibernateEcs")?;
                let observed = self.inspect(&resource).await?;
                if !matches!(observed["status"].as_str(), Some("Running" | "Stopped"))
                    || observed["instanceChargeType"] != "PostPaid"
                    || observed["operationBlocked"] != false
                {
                    return Err("Environment preservation requires a running or stopped unlocked PostPaid ECS desktop".into());
                }
                scheduled_release::require_no_deadline(&observed)?;
                let disk = self.hibernation_disk(&resource, None).await?;
                let child_ids = children(&id);
                for child in child_ids.as_object().unwrap().values() {
                    if self.read_receipt(child.as_str().unwrap())?.is_some() {
                        return Err(
                            "Environment preservation child operation already exists".into()
                        );
                    }
                }
                let receipt = json!({"operationId":id,"requestSha256":digest(&request,&disk)?,"request":request,
                    "diskId":disk,"children":child_ids,"outcome":"running",
                    "phase":if observed["status"] == "Running" {"stopping"} else {"snapshotting"},
                    "createdAt":chrono::Utc::now().to_rfc3339(),"observedBefore":observed,
                    "requiresInspection":true,"requiresApplicationValidation":true,
                    "retainedResourcesMayBeCharged":true});
                self.create_receipt(&id, &receipt)?;
                receipt
            }
        };
        if terminal(&receipt) {
            return self.hibernation_status(receipt);
        }
        if let Some(lease) = self.hibernation_lease(&id)? {
            let service = self.clone();
            let worker_id = id.clone();
            tokio::spawn(async move {
                let _lease = lease;
                service.run_hibernation(&worker_id).await;
            });
        }
        self.hibernation_status(
            self.read_receipt(&id)?
                .ok_or("Missing preservation operation")?,
        )
    }

    pub(super) fn cancel_ecs_hibernation(&self, id: &str, consent: &str) -> Result<Value, String> {
        validate_id(id)?;
        if consent != format!("cancelEcsHibernation:{id}") {
            return Err("Explicit environment preservation cancellation is required".into());
        }
        self.ensure_root()?;
        let _lock = self.lock_operations()?;
        let mut receipt = self
            .read_receipt(id)?
            .ok_or("Environment preservation operation does not exist")?;
        if receipt["request"]["action"] != "hibernateEcs" {
            return Err("Operation is not environment preservation".into());
        }
        if !terminal(&receipt) {
            if self.hibernation_release_started(&receipt)? {
                return Err("Release may already be submitted; inspect the original operation instead of cancelling".into());
            }
            receipt["outcome"] = json!("cancelled");
            receipt["requiresInspection"] = json!(false);
            receipt["cancelledAt"] = json!(chrono::Utc::now().to_rfc3339());
            self.replace_receipt(id, &receipt)?;
        }
        self.hibernation_status(receipt)
    }

    fn hibernation_release_started(&self, receipt: &Value) -> Result<bool, String> {
        Ok(receipt["phase"] == "releasing"
            && self
                .read_receipt(
                    receipt["children"]["release"]
                        .as_str()
                        .ok_or("Missing preservation release identity")?,
                )?
                .is_some())
    }

    /// Called under the operation lock; only an exact durable child may use this reservation.
    pub(super) fn require_hibernation_step(
        &self,
        id: &str,
        resource: &CloudDesktopResource,
        action: &str,
        child: &str,
    ) -> Result<(), String> {
        let receipt = self
            .read_receipt(id)?
            .ok_or("Missing environment preservation reservation")?;
        let phase = match action {
            "stop" => "stopping",
            "snapshot" => "snapshotting",
            "createEcsImage" => "imaging",
            "release" => "releasing",
            _ => return Err("Invalid environment preservation step".into()),
        };
        if receipt["request"]["action"] != "hibernateEcs"
            || terminal(&receipt)
            || receipt["phase"] != phase
            || receipt["children"][action] != child
            || receipt["request"]["resource"] != serde_json::to_value(resource).unwrap()
        {
            return Err(
                "Environment preservation step does not match its active reservation".into(),
            );
        }
        Ok(())
    }

    async fn hibernation_disk(
        &self,
        resource: &CloudDesktopResource,
        expected: Option<&str>,
    ) -> Result<String, String> {
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
        let disks = response
            .pointer("/Disks/Disk")
            .and_then(Value::as_array)
            .ok_or("Invalid environment disk inventory")?;
        if response["TotalCount"].as_u64() != Some(1)
            || disks.len() != 1
            || response
                .get("NextToken")
                .is_some_and(|v| !v.is_null() && v != "")
            || disks[0]["InstanceId"] != resource.resource_id
            || disks[0]["Type"] != "system"
            || disks[0]["Encrypted"] != true
            || disks[0]["Status"] != "In_use"
            || disks[0].get("MultiAttach").is_some_and(|v| v != "Disabled")
        {
            return Err("Environment preservation requires exactly one encrypted attached system disk and no data disks".into());
        }
        let disk = disks[0]["DiskId"]
            .as_str()
            .ok_or("Missing system disk ID")?;
        validate_id(disk)?;
        if !disk.starts_with("d-") || expected.is_some_and(|id| disk != id) {
            return Err("Environment preservation system disk changed".into());
        }
        Ok(disk.into())
    }

    pub(super) fn validate_hibernation_receipt(&self, receipt: &Value) -> Result<(), String> {
        let request = &receipt["request"];
        let resource: CloudDesktopResource = serde_json::from_value(request["resource"].clone())
            .map_err(|_| "Invalid environment preservation resource")?;
        validate_resource(&resource)?;
        let id = receipt["operationId"]
            .as_str()
            .ok_or("Missing preservation identity")?;
        validate_id(id)?;
        let disk = receipt["diskId"]
            .as_str()
            .ok_or("Missing preserved system disk")?;
        validate_id(disk)?;
        let valid_time = |key: &str| {
            receipt[key]
                .as_str()
                .and_then(|v| chrono::DateTime::parse_from_rfc3339(v).ok())
                .is_some()
        };
        if resource.provider != CloudDesktopProvider::Ecs
            || !disk.starts_with("d-")
            || request["workSaved"] != true
            || request["includeCredentials"] != true
            || request["discardData"] != true
            || receipt["requestSha256"] != digest(request, disk)?
            || receipt["children"] != children(id)
            || !valid_time("createdAt")
            || receipt["observedBefore"]["resource"] != request["resource"]
            || receipt["observedBefore"]["instanceChargeType"] != "PostPaid"
            || !matches!(
                receipt["observedBefore"]["status"].as_str(),
                Some("Running" | "Stopped")
            )
            || !matches!(
                receipt["phase"].as_str(),
                Some("stopping" | "snapshotting" | "imaging" | "releasing")
            )
            || !matches!(
                receipt["outcome"].as_str(),
                Some("running" | "paused" | "hibernated" | "cancelled")
            )
            || receipt["requiresInspection"] != !terminal(receipt)
            || receipt["requiresApplicationValidation"] != true
            || receipt["retainedResourcesMayBeCharged"] != true
        {
            return Err("Invalid environment preservation receipt".into());
        }
        if receipt["outcome"] == "cancelled"
            && (!valid_time("cancelledAt") || self.hibernation_release_started(receipt)?)
        {
            return Err("Invalid environment preservation cancellation".into());
        }
        if receipt["outcome"] == "hibernated" {
            let proof = &receipt["releaseImage"];
            let release = self
                .read_receipt(receipt["children"]["release"].as_str().unwrap())?
                .ok_or("Missing original release verification")?;
            self.validate_release_image_receipt(&json!({"request":{"resource":resource,"imageOperationId":receipt["children"]["createEcsImage"]},"releaseImage":proof}))?;
            if receipt["phase"] != "releasing"
                || !valid_time("verifiedAt")
                || release["request"]["action"] != "release"
                || release["request"]["resource"] != request["resource"]
                || release["outcome"] != "released"
                || release["releaseImage"] != *proof
                || release["observedAfter"] != receipt["observedAfter"]
                || release["verifiedAt"] != receipt["verifiedAt"]
                || proof["diskId"] != disk
                || receipt["observedAfter"]["resource"] != request["resource"]
                || receipt["observedAfter"]["exists"] != false
                || receipt["observedAfter"]["status"] != "NotFound"
            {
                return Err(
                    "Preserved environment lacks exact backup and release verification".into(),
                );
            }
        }
        Ok(())
    }
}
