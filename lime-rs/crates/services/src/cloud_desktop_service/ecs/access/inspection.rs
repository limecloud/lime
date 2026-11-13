//! 原栈、实例、专用安全组和已登记规则的独立读回。

use super::*;

impl CloudDesktopService {
    pub(super) async fn connection_network(
        &self,
        resource: &CloudDesktopResource,
    ) -> Result<Option<Value>, String> {
        let response = self
            .call(
                resource,
                &[
                    "DescribeInstances".into(),
                    "--InstanceIds".into(),
                    json!([resource.resource_id]).to_string(),
                ],
            )
            .await?;
        let instance = exact_item(
            &response,
            "/Instances/Instance",
            "InstanceId",
            &resource.resource_id,
        )?;
        scheduled_release::require_no_deadline(
            &json!({"autoReleaseTime":scheduled_release::auto_release_time(instance)?}),
        )?;
        if instance["RegionId"] != resource.region_id
            || instance["Status"] != "Running"
            || has_operation_locks(instance, "LockReason")?
        {
            return Err("Connection preparation requires an unlocked running instance".into());
        }
        let groups = instance
            .pointer("/SecurityGroupIds/SecurityGroupId")
            .and_then(Value::as_array)
            .ok_or("Missing connection instance security groups")?;
        if groups.len() != 1 {
            return Ok(None);
        }
        let mut found = None;
        for entry in
            fs::read_dir(&self.root).map_err(|_| "Cannot find original network operation")?
        {
            let entry = entry.map_err(|_| "Cannot read original network operation")?;
            let name = entry.file_name();
            let Some(id) = name.to_str().and_then(|name| name.strip_suffix(".json")) else {
                continue;
            };
            if id.starts_with("quote-") || id.starts_with("resource-") {
                continue;
            }
            let Some(receipt) = self.read_receipt(id)? else {
                continue;
            };
            if receipt["request"]["action"] == "prepareEcsPurchase"
                && receipt["outcome"] == "networkReady"
                && receipt["request"]["regionId"] == resource.region_id
                && receipt["request"]["profile"] == resource.profile
                && receipt["spec"]["securityGroupId"] == groups[0]
                && instance.pointer("/VpcAttributes/VSwitchId") == receipt["spec"].get("vSwitchId")
            {
                if found.is_some() {
                    return Err("Ambiguous managed connection network".into());
                }
                found = Some(receipt);
            }
        }
        Ok(found)
    }

    pub(super) async fn verify_connection_network(
        &self,
        resource: &CloudDesktopResource,
        network: &Value,
    ) -> Result<Value, String> {
        let id = network["operationId"]
            .as_str()
            .ok_or("Missing network operation ID")?;
        let original = self
            .connection_network(resource)
            .await?
            .ok_or("Connection no longer uses the managed network")?;
        if original["operationId"] != id {
            return Err("Connection network identity changed".into());
        }
        let spec: EcsDesktopSpec = serde_json::from_value(network["spec"].clone())
            .map_err(|_| "Invalid managed connection spec")?;
        let stack = network["stackId"]
            .as_str()
            .ok_or("Missing managed network stack")?;
        let state = self
            .call_cli(
                "ros",
                Some("2019-09-10"),
                &spec.region_id,
                &spec.profile,
                &[
                    "GetStack".into(),
                    "--StackId".into(),
                    stack.into(),
                    "--OutputOption".into(),
                    "Enabled".into(),
                    "--LogOption".into(),
                    "None".into(),
                ],
            )
            .await?;
        if state["StackId"] != stack
            || state["StackName"] != network["stackName"]
            || state["RegionId"] != resource.region_id
            || state["Status"] != "CREATE_COMPLETE"
            || !state["Tags"].as_array().is_some_and(|tags| {
                tags.iter()
                    .any(|tag| tag["Key"] == "lime-operation" && tag["Value"] == id)
            })
        {
            return Err("Managed connection stack identity changed".into());
        }
        for (key, expected) in [
            ("SecurityGroupId", &spec.security_group_id),
            ("VSwitchId", &spec.v_switch_id),
        ] {
            let values: Vec<_> = state["Outputs"]
                .as_array()
                .ok_or("Missing managed connection outputs")?
                .iter()
                .filter(|item| item["OutputKey"] == key)
                .collect();
            if values.len() != 1 || values[0]["OutputValue"] != *expected {
                return Err("Managed connection output identity changed".into());
            }
        }
        let body = self
            .call_cli(
                "ros",
                Some("2019-09-10"),
                &spec.region_id,
                &spec.profile,
                &["GetTemplate".into(), "--StackId".into(), stack.into()],
            )
            .await?;
        let actual: Value = serde_json::from_str(
            body["TemplateBody"]
                .as_str()
                .ok_or("Missing managed connection template")?,
        )
        .map_err(|_| "Invalid managed connection template")?;
        if actual
            != super::super::network::network_template::template(
                network["request"]["zoneId"]
                    .as_str()
                    .ok_or("Missing managed zone")?,
                id,
            )
        {
            return Err("Managed connection template changed".into());
        }
        // The group must be dedicated to the exact target, not another attached instance.
        let attached = self
            .call(
                resource,
                &[
                    "DescribeInstances".into(),
                    "--SecurityGroupId".into(),
                    spec.security_group_id.clone(),
                    "--PageSize".into(),
                    "10".into(),
                ],
            )
            .await?;
        exact_item(
            &attached,
            "/Instances/Instance",
            "InstanceId",
            &resource.resource_id,
        )?;
        if attached["TotalCount"].as_u64() != Some(1) {
            return Err("Cannot verify exclusive connection security group attachment".into());
        }
        let group = self
            .ecs(
                &spec,
                &[
                    "DescribeSecurityGroupAttribute".into(),
                    "--SecurityGroupId".into(),
                    spec.security_group_id.clone(),
                    "--Direction".into(),
                    "all".into(),
                ],
            )
            .await?;
        let vpcs: Vec<_> = state["Outputs"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|item| item["OutputKey"] == "VpcId")
            .collect();
        let vpc = if vpcs.len() == 1 {
            vpcs[0]["OutputValue"].as_str()
        } else {
            None
        }
        .ok_or("Missing managed connection VPC identity")?;
        validate_id(vpc)?;
        if group["SecurityGroupId"] != spec.security_group_id
            || group["RegionId"] != spec.region_id
            || !vpc.starts_with("vpc-")
            || group["VpcId"] != vpc
        {
            return Err("Managed connection security group identity changed".into());
        }
        self.validate_managed_connection_rules(id, &group)?;
        Ok(group)
    }

    pub(super) async fn observe_ecs_connection(
        &self,
        operation: &str,
        current_resource: Option<&CloudDesktopResource>,
    ) -> Result<Value, String> {
        let mut receipt = self
            .read_receipt(operation)?
            .ok_or("Missing connection operation")?;
        if receipt["request"]["action"] != "prepareEcsConnection" {
            return Err("Invalid connection operation action".into());
        }
        let original: CloudDesktopResource =
            serde_json::from_value(receipt["request"]["resource"].clone())
                .map_err(|_| "Invalid connection resource")?;
        // An explicitly selected replacement may reuse the original dedicated network.
        // Keep the authorization request immutable and verify the current instance independently.
        let resource = current_resource.unwrap_or(&original);
        validate_connection_scope(&original, resource)?;
        let network = self
            .read_receipt(receipt["request"]["networkOperationId"].as_str().unwrap())?
            .ok_or("Missing original connection network")?;
        if network["spec"]["securityGroupId"] != receipt["request"]["securityGroupId"] {
            return Err("Connection operation group identity mismatch".into());
        }
        let group = self.verify_connection_network(resource, &network).await?;
        receipt["observedResource"] =
            serde_json::to_value(resource).map_err(|_| "Invalid observed connection resource")?;
        let rules = ingress(&group)?;
        let mut registered = Vec::new();
        for port in ["8787", "6080"] {
            let matches: Vec<_> = rules
                .iter()
                .filter(|rule| matches_expected(rule, &receipt, port))
                .collect();
            if matches.len() > 1 {
                return Err("Ambiguous connection rule identity".into());
            }
            if let Some(rule) = matches.first() {
                registered.push(registered_rule(rule, port));
            }
        }
        if registered.len() != 2 {
            if receipt["phase"] != "authorizing" {
                return Err("Verified connection rules changed; no rules were resubmitted".into());
            }
            self.replace_receipt(operation, &receipt)?;
            return Ok(receipt);
        }
        let previous = receipt["previousRules"].as_array().unwrap();
        let remaining = previous
            .iter()
            .filter(|old| rules.iter().any(|rule| matches_registered(rule, old)))
            .count();
        if remaining != 0 && remaining != previous.len() && receipt["phase"] == "authorizing" {
            return Err("Previous connection rules changed before cleanup".into());
        }
        receipt["rules"] = json!(registered);
        receipt["phase"] = json!(if remaining == 0 {
            "complete"
        } else if receipt["phase"] == "revoking" {
            "revoking"
        } else {
            "readyToRevoke"
        });
        let complete = receipt["phase"] == "complete";
        receipt["outcome"] = json!(if complete {
            "connectionReady"
        } else {
            "connectionPreparing"
        });
        receipt["requiresInspection"] = json!(!complete);
        if complete {
            receipt["verifiedAt"] = json!(chrono::Utc::now().to_rfc3339());
        }
        self.replace_receipt(operation, &receipt)?;
        Ok(receipt)
    }
}
