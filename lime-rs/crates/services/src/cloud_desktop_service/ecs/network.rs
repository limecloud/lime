//! 原操作一次提交网络栈；关闭、丢响应及重启后只读恢复。

use super::*;
use sha2::{Digest, Sha256};

#[path = "network_template.rs"]
mod network_template;
use network_template::{stack_name, template};

fn digest(request: &Value) -> Result<String, String> {
    Ok(format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(request).map_err(|_| "Invalid network request")?)
    ))
}

fn plan_spec(receipt: &Value) -> Result<EcsDesktopSpec, String> {
    serde_json::from_value(receipt["request"]["spec"].clone())
        .map_err(|_| "Invalid desktop preparation spec".into())
}

impl CloudDesktopService {
    pub(in crate::cloud_desktop_service) fn validate_ecs_purchase_preparation(
        &self,
        receipt: &Value,
    ) -> Result<(), String> {
        let request = &receipt["request"];
        let spec = plan_spec(receipt)?;
        validate_id(
            request["zoneId"]
                .as_str()
                .ok_or("Missing preparation zone")?,
        )?;
        validate_spec(&EcsDesktopSpec {
            v_switch_id: "vsw-check".into(),
            security_group_id: "sg-check".into(),
            ..spec.clone()
        })?;
        if request["regionId"] != spec.region_id
            || request["profile"] != spec.profile
            || !spec.v_switch_id.is_empty()
            || !spec.security_group_id.is_empty()
            || !spec.key_pair_name.is_empty()
            || spec.system_disk_gib != 80
            || spec.outbound_mbps != 5
            || receipt["requestSha256"] != digest(request)?
            || receipt["stackName"]
                != stack_name(
                    receipt["operationId"]
                        .as_str()
                        .ok_or("Missing preparation ID")?,
                )
            || receipt["createdAt"]
                .as_str()
                .and_then(|time| chrono::DateTime::parse_from_rfc3339(time).ok())
                .is_none()
            || !matches!(
                receipt["outcome"].as_str(),
                Some(
                    "unknown"
                        | "networkPreparing"
                        | "networkReady"
                        | "networkFailed"
                        | "networkRolledBack"
                )
            )
        {
            return Err("Invalid desktop purchase preparation receipt".into());
        }
        if let Some(id) = receipt.get("stackId") {
            validate_id(id.as_str().ok_or("Invalid network stack ID")?)?;
        }
        if receipt["outcome"] != "unknown" && receipt["stackId"].as_str().is_none() {
            return Err("Missing network stack identity".into());
        }
        if receipt["outcome"] == "networkReady" {
            let ready: EcsDesktopSpec = serde_json::from_value(receipt["spec"].clone())
                .map_err(|_| "Invalid ready desktop spec")?;
            validate_spec(&ready)?;
            if (EcsDesktopSpec {
                v_switch_id: String::new(),
                security_group_id: String::new(),
                ..ready
            }) != spec
                || receipt["stackStatus"] != "CREATE_COMPLETE"
                || receipt["requiresInspection"] != false
                || receipt["verifiedAt"]
                    .as_str()
                    .and_then(|time| chrono::DateTime::parse_from_rfc3339(time).ok())
                    .is_none()
            {
                return Err("Missing verified network preparation".into());
            }
        }
        Ok(())
    }

    fn find_ecs_purchase_preparation(
        &self,
        region: &str,
        profile: &str,
    ) -> Result<Option<Value>, String> {
        validate_id(region)?;
        validate_id(profile)?;
        self.ensure_root()?;
        let mut latest: Option<Value> = None;
        for entry in fs::read_dir(&self.root).map_err(|_| "Cannot list desktop preparations")? {
            let entry = entry.map_err(|_| "Cannot read desktop preparation")?;
            let name = entry.file_name();
            let Some(name) = name.to_str() else { continue };
            if !name.ends_with(".json")
                || name.starts_with("quote-")
                || name.starts_with("resource-")
            {
                continue;
            }
            let id = name.trim_end_matches(".json");
            validate_id(id)?;
            let Some(receipt) = self.read_receipt(id)? else {
                continue;
            };
            if receipt["request"]["action"] == "prepareEcsPurchase"
                && receipt["request"]["regionId"] == region
                && receipt["request"]["profile"] == profile
                && latest.as_ref().is_none_or(|current| {
                    receipt["createdAt"].as_str() > current["createdAt"].as_str()
                })
            {
                latest = Some(receipt);
            }
        }
        Ok(latest)
    }

    pub(in crate::cloud_desktop_service) async fn read_ecs_purchase_preparation(
        &self,
        region: &str,
        profile: &str,
    ) -> Result<Value, String> {
        match self.find_ecs_purchase_preparation(region, profile)? {
            Some(receipt) => {
                self.inspect_ecs_purchase_preparation(
                    receipt["operationId"]
                        .as_str()
                        .ok_or("Missing preparation ID")?,
                )
                .await
            }
            None => Ok(json!({ "outcome": "notPrepared" })),
        }
    }

    pub(in crate::cloud_desktop_service) async fn prepare_ecs_purchase(
        &self,
        region: &str,
        profile: &str,
        operation: &str,
        confirmation: &str,
    ) -> Result<Value, String> {
        for id in [region, profile, operation] {
            validate_id(id)?;
        }
        if confirmation != format!("prepareEcsPurchase:{region}:{profile}:{operation}") {
            return Err("Explicit network preparation confirmation is required".into());
        }
        self.ensure_root()?;
        {
            let _lock = self.lock_operations()?;
            if let Some(existing) = self.read_receipt(operation)? {
                if existing["request"]["action"] != "prepareEcsPurchase"
                    || existing["request"]["regionId"] != region
                    || existing["request"]["profile"] != profile
                {
                    return Err("Cloud preparation operation identity mismatch".into());
                }
                drop(_lock);
                return self.inspect_ecs_purchase_preparation(operation).await;
            }
            if let Some(existing) = self.find_ecs_purchase_preparation(region, profile)? {
                // A new intent is allowed only after ROS confirmed rollback of its own new resources.
                if existing["outcome"] != "networkRolledBack" {
                    let id = existing["operationId"]
                        .as_str()
                        .ok_or("Missing preparation ID")?
                        .to_owned();
                    drop(_lock);
                    return self.inspect_ecs_purchase_preparation(&id).await;
                }
            }
        }
        let plan = tokio::time::timeout(
            Duration::from_secs(240),
            self.recommend_ecs_purchase(region, profile),
        )
        .await
        .map_err(|_| "Desktop recommendation timed out before any network submission")??;
        let _lock = self.lock_operations()?;
        // Recheck after read-only discovery; another process may already have submitted.
        if let Some(existing) = self.find_ecs_purchase_preparation(region, profile)? {
            if existing["outcome"] != "networkRolledBack" {
                return Ok(existing);
            }
        }
        let request = json!({ "action": "prepareEcsPurchase", "regionId": region, "profile": profile, "zoneId": plan["zoneId"], "spec": plan["spec"] });
        let mut receipt = json!({ "operationId": operation, "requestSha256": digest(&request)?, "request": request,
            "createdAt": chrono::Utc::now().to_rfc3339(), "outcome": "unknown", "requiresInspection": true,
            "stackName": stack_name(operation), "estimatedPrice": plan["price"] });
        self.create_receipt(operation, &receipt)?;
        let zone = plan["zoneId"].as_str().ok_or("Missing recommended zone")?;
        let result = self
            .call_cli(
                "ros",
                Some("2019-09-10"),
                region,
                profile,
                &[
                    "CreateStack".into(),
                    "--StackName".into(),
                    stack_name(operation),
                    "--ClientToken".into(),
                    operation.into(),
                    "--DisableRollback".into(),
                    "false".into(),
                    "--TimeoutInMinutes".into(),
                    "10".into(),
                    "--TemplateBody".into(),
                    template(zone, operation).to_string(),
                    "--Tags.1.Key".into(),
                    "lime-operation".into(),
                    "--Tags.1.Value".into(),
                    operation.into(),
                ],
            )
            .await;
        if let Ok(response) = result {
            if let Some(id) = response["StackId"]
                .as_str()
                .filter(|id| validate_id(id).is_ok())
            {
                receipt["stackId"] = json!(id);
                receipt["outcome"] = json!("networkPreparing");
                self.replace_receipt(operation, &receipt)?;
            }
        }
        // Even an API error can be a lost response. Only inspect the original stack.
        Ok(receipt)
    }

    pub(in crate::cloud_desktop_service) async fn inspect_ecs_purchase_preparation(
        &self,
        operation: &str,
    ) -> Result<Value, String> {
        self.ensure_root()?;
        let _lock = self.lock_operations()?;
        let mut receipt = self
            .read_receipt(operation)?
            .ok_or("Missing purchase preparation")?;
        if receipt["request"]["action"] != "prepareEcsPurchase" {
            return Err("Invalid preparation action".into());
        }
        let mut spec = plan_spec(&receipt)?;
        let region = spec.region_id.clone();
        let profile = spec.profile.clone();
        if receipt["stackId"].is_null() {
            let result = self
                .call_cli(
                    "ros",
                    Some("2019-09-10"),
                    &region,
                    &profile,
                    &[
                        "ListStacks".into(),
                        "--StackName.1".into(),
                        stack_name(operation),
                        "--PageSize".into(),
                        "50".into(),
                        "--PageNumber".into(),
                        "1".into(),
                    ],
                )
                .await?;
            let stacks = result["Stacks"]
                .as_array()
                .ok_or("Invalid network stack inventory")?;
            if result["TotalCount"].as_u64() != Some(stacks.len() as u64) || stacks.len() > 1 {
                return Err("Ambiguous network stack inventory; inspect original operation".into());
            }
            if stacks.is_empty() {
                return Ok(receipt);
            }
            if stacks[0]["StackName"] != stack_name(operation) || stacks[0]["RegionId"] != region {
                return Err("Network stack does not match the original intent".into());
            }
            let id = stacks[0]["StackId"]
                .as_str()
                .ok_or("Missing original stack ID")?;
            validate_id(id)?;
            receipt["stackId"] = json!(id);
        }
        let result = self
            .call_cli(
                "ros",
                Some("2019-09-10"),
                &region,
                &profile,
                &[
                    "GetStack".into(),
                    "--StackId".into(),
                    receipt["stackId"]
                        .as_str()
                        .ok_or("Missing stack ID")?
                        .into(),
                    "--OutputOption".into(),
                    "Enabled".into(),
                    "--LogOption".into(),
                    "None".into(),
                ],
            )
            .await?;
        if result["StackId"] != receipt["stackId"]
            || result["StackName"] != receipt["stackName"]
            || result["RegionId"] != region
            || !result["Tags"].as_array().is_some_and(|tags| {
                tags.iter()
                    .any(|tag| tag["Key"] == "lime-operation" && tag["Value"] == operation)
            })
        {
            return Err("Network stack ownership does not match the original intent".into());
        }
        let status = result["Status"]
            .as_str()
            .ok_or("Missing network stack status")?;
        let outcome = match status {
            "CREATE_IN_PROGRESS" | "CREATE_ROLLBACK_IN_PROGRESS" => "networkPreparing",
            "CREATE_FAILED" | "CREATE_ROLLBACK_FAILED" => "networkFailed",
            "CREATE_ROLLBACK_COMPLETE" => "networkRolledBack",
            "CREATE_COMPLETE" => {
                let body = self
                    .call_cli(
                        "ros",
                        Some("2019-09-10"),
                        &region,
                        &profile,
                        &[
                            "GetTemplate".into(),
                            "--StackId".into(),
                            receipt["stackId"].as_str().unwrap().into(),
                        ],
                    )
                    .await?;
                let actual: Value = serde_json::from_str(
                    body["TemplateBody"]
                        .as_str()
                        .ok_or("Missing original network template")?,
                )
                .map_err(|_| "Invalid original network template")?;
                let zone = receipt["request"]["zoneId"]
                    .as_str()
                    .ok_or("Missing original zone")?;
                if actual != template(zone, operation) {
                    return Err("Network template changed; inspect before purchase".into());
                }
                let outputs = result["Outputs"]
                    .as_array()
                    .ok_or("Missing network outputs")?;
                let output = |key: &str| -> Result<String, String> {
                    let values: Vec<_> = outputs
                        .iter()
                        .filter(|item| item["OutputKey"] == key)
                        .collect();
                    if values.len() != 1 {
                        return Err("Invalid network output identity".into());
                    }
                    let id = values[0]["OutputValue"]
                        .as_str()
                        .ok_or("Invalid network output ID")?;
                    validate_id(id)?;
                    Ok(id.into())
                };
                spec.v_switch_id = output("VSwitchId")?;
                spec.security_group_id = output("SecurityGroupId")?;
                let network = self.validate_ecs_inventory(&spec).await?;
                if network["vpcId"] != output("VpcId")? || network["zoneId"] != zone {
                    return Err("Prepared network zone or VPC mismatch".into());
                }
                let group = self
                    .ecs(
                        &spec,
                        &[
                            "DescribeSecurityGroupAttribute".into(),
                            "--SecurityGroupId".into(),
                            spec.security_group_id.clone(),
                        ],
                    )
                    .await?;
                let rules = group
                    .pointer("/Permissions/Permission")
                    .and_then(Value::as_array)
                    .ok_or("Missing prepared security group permissions")?;
                if rules.iter().any(|rule| rule["Direction"] != "egress") {
                    return Err(
                        "Prepared security group has inbound rules; purchase is blocked".into(),
                    );
                }
                receipt["spec"] =
                    serde_json::to_value(&spec).map_err(|_| "Invalid prepared spec")?;
                receipt["verifiedAt"] = json!(chrono::Utc::now().to_rfc3339());
                "networkReady"
            }
            _ => return Err("Network stack was changed or deleted; inspect original stack".into()),
        };
        receipt["outcome"] = json!(outcome);
        receipt["stackStatus"] = json!(status);
        receipt["requiresInspection"] =
            json!(!matches!(outcome, "networkReady" | "networkRolledBack"));
        self.replace_receipt(operation, &receipt)?;
        Ok(receipt)
    }
}

#[cfg(all(test, unix))]
mod tests;
