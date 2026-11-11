//! 单台购买和原操作恢复。只重查，不重发可能已经产生费用的请求。

use super::*;
use sha2::{Digest, Sha256};

const OPERATION_TAG: &str = "lime-operation";

fn request_digest(request: &Value) -> Result<String, String> {
    Ok(format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(request).map_err(|_| "Invalid ECS purchase request")?)
    ))
}

fn instances(response: &Value) -> Result<&Vec<Value>, String> {
    let items = response
        .pointer("/Instances/Instance")
        .and_then(Value::as_array)
        .ok_or("Invalid ECS purchase inventory")?;
    if response["TotalCount"].as_u64() != Some(items.len() as u64)
        || response
            .get("NextToken")
            .is_some_and(|value| !value.is_null() && value != "")
    {
        return Err("ECS purchase inventory is incomplete or inconsistent".into());
    }
    Ok(items)
}

impl CloudDesktopService {
    pub(in crate::cloud_desktop_service) fn validate_ecs_purchase_receipt(
        &self,
        receipt: &Value,
    ) -> Result<(), String> {
        let request = &receipt["request"];
        let spec: EcsDesktopSpec = serde_json::from_value(request["spec"].clone())
            .map_err(|_| "Invalid ECS purchase receipt specification")?;
        validate_spec(&spec)?;
        let name = request["desktopName"]
            .as_str()
            .ok_or("Invalid ECS purchase receipt name")?;
        let quote_id = request["quoteId"]
            .as_str()
            .ok_or("Invalid ECS purchase receipt quote")?;
        super::super::purchase::validate_confirmation(
            "ecs",
            &spec.region_id,
            name,
            quote_id,
            &format!("purchase:ecs:{}:{name}:{quote_id}", spec.region_id),
        )?;
        if receipt["requestSha256"] != request_digest(request)?
            || !matches!(
                receipt["outcome"].as_str(),
                Some("unknown" | "accepted" | "provisioned")
            )
            || receipt["createdAt"]
                .as_str()
                .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok())
                .is_none()
        {
            return Err("Invalid ECS purchase receipt integrity or state".into());
        }
        if let Some(id) = receipt.get("instanceId") {
            let resource = CloudDesktopResource {
                provider: CloudDesktopProvider::Ecs,
                region_id: spec.region_id.clone(),
                profile: spec.profile.clone(),
                resource_id: id.as_str().ok_or("Invalid purchased instance ID")?.into(),
            };
            validate_resource(&resource)?;
        } else if receipt["outcome"] != "unknown" {
            return Err("ECS purchase receipt is missing the instance ID".into());
        }
        if receipt["outcome"] == "provisioned" {
            let observed = &receipt["observedAfter"];
            if receipt["requiresInspection"] != false
                || observed["systemDiskEncrypted"] != true
                || observed["instanceId"] != receipt["instanceId"]
                || observed["spec"] != request["spec"]
                || observed["desktopName"] != request["desktopName"]
                || observed["operationId"] != receipt["operationId"]
                || observed["chargeType"] != "PostPaid"
                || receipt["verifiedAt"]
                    .as_str()
                    .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok())
                    .is_none()
            {
                return Err(
                    "Provisioned ECS receipt is missing exact encrypted instance verification"
                        .into(),
                );
            }
        } else if receipt["requiresInspection"] != true {
            return Err("Unresolved ECS purchase requires inspection".into());
        }
        Ok(())
    }

    pub(in crate::cloud_desktop_service) async fn purchase_ecs(
        &self,
        spec: EcsDesktopSpec,
        desktop_name: String,
        operation_id: String,
        quote_id: String,
        confirmation: String,
    ) -> Result<Value, String> {
        validate_spec(&spec)?;
        validate_id(&operation_id)?;
        super::super::purchase::validate_confirmation(
            "ecs",
            &spec.region_id,
            &desktop_name,
            &quote_id,
            &confirmation,
        )?;
        self.ensure_root()?;
        let _lock = self.lock_operations()?;
        let request = json!({ "action": "purchaseEcs", "spec": spec, "desktopName": desktop_name, "quoteId": quote_id });
        if let Some(existing) = self.read_receipt(&operation_id)? {
            if existing["request"] != request {
                return Err("Operation ID belongs to another request".into());
            }
            return Ok(existing);
        }
        self.check_purchase_available("purchaseEcs", &spec.region_id, &desktop_name, &quote_id)?;
        // This block holds the operation lock and contains only read-only calls.
        // Failure here is an explicit non-submission, never an unknown purchase.
        let preflight: Result<Value, String> = async {
            let quote = self.approved_quote(&request["spec"], &quote_id)?;
            let network = self.validate_ecs_inventory(&spec).await?;
            if self
                .ecs_price(
                    &spec,
                    network["zoneId"].as_str().ok_or("Missing switch zone")?,
                )
                .await?
                != quote["price"]
            {
                return Err("Price changed; obtain and approve a new quote".into());
            }
            let inventory = self
                .ecs(
                    &spec,
                    &[
                        "DescribeInstances".into(),
                        "--InstanceName".into(),
                        desktop_name.clone(),
                    ],
                )
                .await?;
            if !instances(&inventory)?.is_empty() {
                return Err("Desktop name already exists; reconcile before purchasing".into());
            }
            // Read-only preflight can take time; an approval must still be current
            // immediately before recording and sending the paid request.
            self.approved_quote(&request["spec"], &quote_id)?;
            Ok(quote)
        }
        .await;
        let quote = match preflight {
            Ok(quote) => quote,
            Err(diagnostic) => {
                return Ok(json!({ "operationId": operation_id,
                "outcome": "notSubmitted", "submitted": false, "requiresInspection": false,
                "diagnostic": diagnostic }))
            }
        };
        let mut receipt = json!({ "operationId": operation_id, "request": request,
            "requestSha256": request_digest(&request)?, "outcome": "unknown", "requiresInspection": true,
            "createdAt": chrono::Utc::now().to_rfc3339(), "quote": quote["price"] });
        self.create_receipt(&operation_id, &receipt)?;
        // Fixed API version: Encrypted is an official flat SystemDisk member that
        // older CLI metadata does not expand. --force bypasses only CLI metadata.
        let result = self
            .call_cli(
                "ecs",
                Some("2014-05-26"),
                &spec.region_id,
                &spec.profile,
                &[
                    "RunInstances".into(),
                    "--ClientToken".into(),
                    operation_id.clone(),
                    "--Amount".into(),
                    "1".into(),
                    "--MinAmount".into(),
                    "1".into(),
                    "--InstanceName".into(),
                    desktop_name,
                    "--InstanceChargeType".into(),
                    "PostPaid".into(),
                    "--AutoRenew".into(),
                    "false".into(),
                    "--InstanceType".into(),
                    spec.instance_type.clone(),
                    "--ImageId".into(),
                    spec.image_id.clone(),
                    "--VSwitchId".into(),
                    spec.v_switch_id.clone(),
                    "--SecurityGroupId".into(),
                    spec.security_group_id.clone(),
                    "--KeyPairName".into(),
                    spec.key_pair_name.clone(),
                    "--IoOptimized".into(),
                    "optimized".into(),
                    "--SystemDisk.Category".into(),
                    "cloud_essd".into(),
                    "--SystemDisk.PerformanceLevel".into(),
                    "PL1".into(),
                    "--SystemDisk.Size".into(),
                    spec.system_disk_gib.to_string(),
                    "--SystemDisk.Encrypted".into(),
                    "true".into(),
                    "--InternetChargeType".into(),
                    "PayByTraffic".into(),
                    "--InternetMaxBandwidthOut".into(),
                    spec.outbound_mbps.to_string(),
                    "--Tag.1.Key".into(),
                    OPERATION_TAG.into(),
                    "--Tag.1.Value".into(),
                    operation_id.clone(),
                ],
            )
            .await;
        match result {
            Ok(response) => {
                let id = response
                    .pointer("/InstanceIdSets/InstanceIdSet")
                    .and_then(Value::as_array)
                    .filter(|ids| ids.len() == 1)
                    .and_then(|ids| ids[0].as_str())
                    .filter(|id| id.starts_with("i-") && validate_id(id).is_ok());
                if let Some(id) = id {
                    receipt["instanceId"] = json!(id);
                    receipt["outcome"] = json!("accepted");
                } else {
                    receipt["diagnostic"] = json!("Purchase response did not identify exactly one instance; inspect the original operation");
                }
            }
            Err(error) => receipt["diagnostic"] = json!(error),
        }
        self.finalize_receipt(&operation_id, &receipt);
        // Acceptance alone does not authorize binding or claim encryption/readiness.
        // Preserve the durable operation even if verification or binding fails.
        match self.reconcile_ecs_purchase(receipt.clone()).await {
            Ok(value) => receipt = value,
            Err(error) => receipt["diagnostic"] = json!(error),
        }
        self.finalize_receipt(&operation_id, &receipt);
        Ok(receipt)
    }

    pub(in crate::cloud_desktop_service) async fn inspect_ecs_purchase(
        &self,
        operation_id: &str,
    ) -> Result<Value, String> {
        let _lock = self.lock_operations()?;
        let receipt = self
            .read_receipt(operation_id)?
            .ok_or("Cloud desktop operation does not exist")?;
        let receipt = self.reconcile_ecs_purchase(receipt).await?;
        self.finalize_receipt(operation_id, &receipt);
        Ok(receipt)
    }

    async fn reconcile_ecs_purchase(&self, mut receipt: Value) -> Result<Value, String> {
        self.validate_ecs_purchase_receipt(&receipt)?;
        let operation_id = receipt["operationId"]
            .as_str()
            .ok_or("Missing operation ID")?
            .to_owned();
        let spec: EcsDesktopSpec = serde_json::from_value(receipt["request"]["spec"].clone())
            .map_err(|_| "Invalid ECS receipt")?;
        let mut args = vec![
            "DescribeInstances".into(),
            "--Tag.1.Key".into(),
            OPERATION_TAG.into(),
            "--Tag.1.Value".into(),
            operation_id.clone(),
        ];
        if let Some(id) = receipt["instanceId"].as_str() {
            args.extend(["--InstanceIds".into(), json!([id]).to_string()]);
        }
        let inventory = self.ecs(&spec, &args).await?;
        let items = instances(&inventory)?;
        if items.is_empty() {
            return Ok(receipt);
        } // Absence is never permission to repurchase.
        if items.len() != 1 {
            return Err(
                "Purchase operation matched multiple instances; reconcile in Alibaba Cloud".into(),
            );
        }
        let instance = &items[0];
        let id = instance["InstanceId"]
            .as_str()
            .ok_or("Missing purchased instance ID")?;
        let resource = CloudDesktopResource {
            provider: CloudDesktopProvider::Ecs,
            region_id: spec.region_id.clone(),
            profile: spec.profile.clone(),
            resource_id: id.into(),
        };
        validate_resource(&resource)?;
        let tags = instance
            .pointer("/Tags/Tag")
            .and_then(Value::as_array)
            .ok_or("Missing purchase operation tag")?;
        let operation_tags: Vec<_> = tags
            .iter()
            .filter(|tag| tag["TagKey"] == OPERATION_TAG)
            .collect();
        if operation_tags.len() != 1
            || operation_tags[0]["TagValue"] != operation_id
            || receipt
                .get("instanceId")
                .is_some_and(|expected| expected != id)
            || instance["RegionId"] != spec.region_id
            || instance["InstanceName"] != receipt["request"]["desktopName"]
            || instance["ImageId"] != spec.image_id
            || instance["InstanceType"] != spec.instance_type
            || instance["KeyPairName"] != spec.key_pair_name
            || instance["InstanceChargeType"] != "PostPaid"
            || instance["InternetChargeType"] != "PayByTraffic"
            || instance["InternetMaxBandwidthOut"].as_u64() != Some(u64::from(spec.outbound_mbps))
            || instance.pointer("/VpcAttributes/VSwitchId") != Some(&json!(spec.v_switch_id))
            || instance.pointer("/SecurityGroupIds/SecurityGroupId")
                != Some(&json!([spec.security_group_id]))
        {
            return Err("Purchased instance does not match the original operation and approved specification".into());
        }
        let disks = self
            .ecs(
                &spec,
                &[
                    "DescribeDisks".into(),
                    "--InstanceId".into(),
                    id.into(),
                    "--DiskType".into(),
                    "system".into(),
                ],
            )
            .await?;
        let disks = exact_item(&disks, "/Disks/Disk", "InstanceId", id)?;
        let disk_id = disks["DiskId"]
            .as_str()
            .ok_or("Missing purchased system disk")?;
        validate_id(disk_id)?;
        if !disk_id.starts_with("d-")
            || disks["Type"] != "system"
            || disks["Encrypted"] != true
            || disks["Category"] != "cloud_essd"
            || disks["PerformanceLevel"] != "PL1"
            || disks["Size"].as_u64() != Some(u64::from(spec.system_disk_gib))
        {
            return Err(
                "Purchased system disk encryption or specification could not be verified".into(),
            );
        }
        self.remember_resource(&resource)?;
        receipt["instanceId"] = json!(id);
        receipt["outcome"] = json!("provisioned");
        receipt["requiresInspection"] = json!(false);
        receipt["verifiedAt"] = json!(chrono::Utc::now().to_rfc3339());
        receipt["desktopReady"] = json!(false);
        receipt["observedAfter"] = json!({ "instanceId": id, "systemDiskId": disk_id,
            "systemDiskEncrypted": true, "spec": spec, "desktopName": receipt["request"]["desktopName"],
            "operationId": operation_id, "chargeType": "PostPaid" });
        receipt.as_object_mut().unwrap().remove("diagnostic");
        Ok(receipt)
    }
}
