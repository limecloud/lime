//! 安装授权下配置专用连接规则；云身份不离开本机，未知提交不得重发。

use super::*;
use sha2::{Digest, Sha256};

mod inspection;
mod rules;
use rules::*;

pub(super) async fn check_network() -> Result<(), String> {
    public_ipv4().await.map(|_| ())
}

fn request_digest(request: &Value) -> Result<String, String> {
    Ok(format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(request).map_err(|_| "Invalid connection request")?)
    ))
}

impl CloudDesktopService {
    pub(in crate::cloud_desktop_service) fn validate_ecs_connection_receipt(
        &self,
        value: &Value,
    ) -> Result<(), String> {
        let request = &value["request"];
        let resource: CloudDesktopResource = serde_json::from_value(request["resource"].clone())
            .map_err(|_| "Invalid connection resource")?;
        validate_resource(&resource)?;
        if let Some(observed) = value.get("observedResource") {
            let observed: CloudDesktopResource = serde_json::from_value(observed.clone())
                .map_err(|_| "Invalid observed connection resource")?;
            validate_connection_scope(&resource, &observed)?;
        }
        for field in ["networkOperationId", "securityGroupId"] {
            validate_id(
                request[field]
                    .as_str()
                    .ok_or("Missing connection network identity")?,
            )?;
        }
        validate_cidr(
            request["sourceCidr"]
                .as_str()
                .ok_or("Missing connection source")?,
        )?;
        let phase = value["phase"].as_str().ok_or("Missing connection phase")?;
        if resource.provider != CloudDesktopProvider::Ecs
            || value["requestSha256"] != request_digest(request)?
            || !matches!(
                phase,
                "authorizing" | "readyToRevoke" | "revoking" | "complete"
            )
            || value["outcome"]
                != if phase == "complete" {
                    "connectionReady"
                } else {
                    "connectionPreparing"
                }
            || value["requiresInspection"] != (phase != "complete")
            || value["createdAt"]
                .as_str()
                .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
                .is_none()
        {
            return Err("Invalid connection preparation receipt".into());
        }
        for field in ["rules", "previousRules"] {
            let entries = value[field]
                .as_array()
                .ok_or("Missing registered connection rules")?;
            if !matches!(entries.len(), 0 | 2) {
                return Err("Invalid registered connection rule count".into());
            }
            for entry in entries {
                validate_registered_rule(entry)?;
            }
            if entries.len() == 2
                && (entries[0]["port"] == entries[1]["port"]
                    || entries[0]["id"] == entries[1]["id"])
            {
                return Err("Duplicate registered connection rule".into());
            }
        }
        if phase != "authorizing" && value["rules"].as_array().unwrap().len() != 2 {
            return Err("Missing verified connection rules".into());
        }
        if phase == "complete"
            && value["verifiedAt"]
                .as_str()
                .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
                .is_none()
        {
            return Err("Missing connection verification".into());
        }
        Ok(())
    }

    fn latest_ecs_connection(&self, network: &str) -> Result<Option<Value>, String> {
        let mut latest: Option<Value> = None;
        for entry in fs::read_dir(&self.root).map_err(|_| "Cannot list connection operations")? {
            let entry = entry.map_err(|_| "Cannot read connection operation")?;
            let name = entry.file_name();
            let Some(id) = name.to_str().and_then(|name| name.strip_suffix(".json")) else {
                continue;
            };
            if id.starts_with("quote-") || id.starts_with("resource-") {
                continue;
            }
            let Some(value) = self.read_receipt(id)? else {
                continue;
            };
            if value["request"]["action"] == "prepareEcsConnection"
                && value["request"]["networkOperationId"] == network
            {
                if latest
                    .as_ref()
                    .is_none_or(|old| value["createdAt"].as_str() > old["createdAt"].as_str())
                {
                    latest = Some(value);
                }
            }
        }
        Ok(latest)
    }

    pub(in crate::cloud_desktop_service) fn validate_managed_connection_rules(
        &self,
        network: &str,
        group: &Value,
    ) -> Result<(), String> {
        let latest = self.latest_ecs_connection(network)?;
        let rules = ingress(group)?;
        for rule in rules {
            let Some(receipt) = &latest else {
                return Err("Prepared security group has unregistered inbound rules".into());
            };
            let new = ["8787", "6080"]
                .into_iter()
                .any(|port| matches_expected(rule, receipt, port));
            let old = receipt["phase"] != "complete"
                && receipt["previousRules"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|entry| matches_registered(rule, entry));
            if !new && !old {
                return Err("Prepared security group has unregistered inbound rules".into());
            }
        }
        Ok(())
    }

    pub(in crate::cloud_desktop_service) async fn prepare_ecs_connection(
        &self,
        resource: CloudDesktopResource,
        operation: String,
        confirmation: String,
    ) -> Result<Value, String> {
        validate_connection_request(&resource, &operation, &confirmation)?;
        self.ensure_root()?;
        // Reconcile pending work before discovering a new address, including after restart.
        if let Some(network) = self.connection_network(&resource).await? {
            if let Some(existing) =
                self.latest_ecs_connection(network["operationId"].as_str().unwrap())?
            {
                if existing["phase"] != "complete" {
                    let observed = self
                        .resume_ecs_connection(existing["operationId"].as_str().unwrap(), &resource)
                        .await?;
                    if observed["phase"] != "complete" {
                        return Ok(observed);
                    }
                }
            }
        } else {
            return Ok(json!({"outcome":"unmanagedNetwork"}));
        }
        let cidr = public_ipv4().await?;
        self.prepare_ecs_connection_at(resource, operation, confirmation, cidr)
            .await
    }

    async fn prepare_ecs_connection_at(
        &self,
        resource: CloudDesktopResource,
        operation: String,
        confirmation: String,
        cidr: String,
    ) -> Result<Value, String> {
        validate_connection_request(&resource, &operation, &confirmation)?;
        validate_cidr(&cidr)?;
        self.ensure_root()?;
        let _lock = self.lock_operations()?;
        if let Some(existing) = self.read_receipt(&operation)? {
            if existing["request"]["action"] != "prepareEcsConnection"
                || existing["request"]["resource"] != serde_json::to_value(&resource).unwrap()
            {
                return Err("Connection operation identity mismatch".into());
            }
            if existing["phase"] == "complete" && existing["request"]["sourceCidr"] != cidr {
                return Err("Current network changed; authorize a new connection operation".into());
            }
            drop(_lock);
            return self.resume_ecs_connection(&operation, &resource).await;
        }
        self.check_change_available(&resource, "prepareEcsConnection")?;
        let Some(network) = self.connection_network(&resource).await? else {
            return Ok(json!({"outcome":"unmanagedNetwork"}));
        };
        let network_id = network["operationId"]
            .as_str()
            .ok_or("Missing original network operation")?;
        let previous = self.latest_ecs_connection(network_id)?;
        if let Some(previous) = &previous {
            if previous["phase"] != "complete" || previous["request"]["sourceCidr"] == cidr {
                let id = previous["operationId"].as_str().unwrap().to_owned();
                drop(_lock);
                return self.resume_ecs_connection(&id, &resource).await;
            }
        }
        let spec: EcsDesktopSpec = serde_json::from_value(network["spec"].clone())
            .map_err(|_| "Invalid connection network spec")?;
        let group = self.verify_connection_network(&resource, &network).await?;
        self.validate_managed_connection_rules(network_id, &group)?;
        let previous_rules = previous
            .map(|value| value["rules"].clone())
            .unwrap_or(json!([]));
        // All registered old rules must still exist exactly before any write.
        if !previous_rules.as_array().unwrap().iter().all(|old| {
            ingress(&group)
                .is_ok_and(|rules| rules.iter().any(|rule| matches_registered(rule, old)))
        }) {
            return Err("Registered connection rules changed; inspect before authorization".into());
        }
        let request = json!({"action":"prepareEcsConnection", "resource":resource, "networkOperationId":network_id, "securityGroupId":spec.security_group_id, "sourceCidr":cidr});
        let receipt = json!({"operationId":operation,"requestSha256":request_digest(&request)?,"request":request,"createdAt":chrono::Utc::now().to_rfc3339(),"phase":"authorizing","outcome":"connectionPreparing","requiresInspection":true,"rules":[],"previousRules":previous_rules});
        self.create_receipt(&operation, &receipt)?;
        let mut args = vec![
            "AuthorizeSecurityGroup".into(),
            "--SecurityGroupId".into(),
            spec.security_group_id,
            "--ClientToken".into(),
            token(&operation, "authorize"),
        ];
        for (index, port) in ["8787", "6080"].iter().enumerate() {
            for (field, value) in [
                ("IpProtocol", "tcp".to_owned()),
                ("PortRange", format!("{port}/{port}")),
                ("SourceCidrIp", cidr.clone()),
                ("Policy", "accept".into()),
                ("Priority", "1".into()),
                ("NicType", "intranet".into()),
                ("Description", description(&operation, port)),
            ] {
                args.extend([format!("--Permissions.{}.{field}", index + 1), value]);
            }
        }
        let _ = self.call(&resource, &args).await;
        drop(_lock);
        self.resume_ecs_connection(&operation, &resource).await
    }

    async fn resume_ecs_connection(
        &self,
        operation: &str,
        resource: &CloudDesktopResource,
    ) -> Result<Value, String> {
        let _lock = self.lock_operations()?;
        let mut receipt = self
            .observe_ecs_connection(operation, Some(resource))
            .await?;
        if receipt["phase"] == "readyToRevoke" {
            receipt["phase"] = json!("revoking");
            self.replace_receipt(operation, &receipt)?;
            let mut args = vec![
                "RevokeSecurityGroup".into(),
                "--SecurityGroupId".into(),
                receipt["request"]["securityGroupId"]
                    .as_str()
                    .unwrap()
                    .into(),
                "--ClientToken".into(),
                token(operation, "revoke"),
            ];
            for (index, rule) in receipt["previousRules"]
                .as_array()
                .unwrap()
                .iter()
                .enumerate()
            {
                args.extend([
                    format!("--SecurityGroupRuleId.{}", index + 1),
                    rule["id"].as_str().unwrap().into(),
                ]);
            }
            let _ = self.call(resource, &args).await;
            receipt = self
                .observe_ecs_connection(operation, Some(resource))
                .await?;
        }
        Ok(receipt)
    }

    pub(in crate::cloud_desktop_service) async fn inspect_ecs_connection(
        &self,
        operation: &str,
    ) -> Result<Value, String> {
        self.ensure_root()?;
        let _lock = self.lock_operations()?;
        self.observe_ecs_connection(operation, None).await
    }
}

fn validate_connection_request(
    resource: &CloudDesktopResource,
    operation: &str,
    confirmation: &str,
) -> Result<(), String> {
    validate_resource(resource)?;
    validate_id(operation)?;
    if resource.provider != CloudDesktopProvider::Ecs
        || confirmation
            != format!(
                "prepareEcsConnection:{}:{}",
                resource.region_id, resource.resource_id
            )
    {
        return Err("Explicit connection network authorization is required".into());
    }
    Ok(())
}

fn validate_connection_scope(
    original: &CloudDesktopResource,
    observed: &CloudDesktopResource,
) -> Result<(), String> {
    validate_resource(observed)?;
    if observed.provider != original.provider
        || observed.profile != original.profile
        || observed.region_id != original.region_id
    {
        return Err("Connection resource scope changed".into());
    }
    Ok(())
}

fn token(operation: &str, phase: &str) -> String {
    format!(
        "{:x}",
        Sha256::digest(format!("{operation}:{phase}").as_bytes())
    )
}

#[cfg(all(test, unix))]
mod tests;
