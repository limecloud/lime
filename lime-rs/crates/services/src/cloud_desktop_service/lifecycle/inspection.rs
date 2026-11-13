//! 原启停操作的只读核验；供应商状态与持久收据分别确认。

use super::*;

impl CloudDesktopService {
    pub(in crate::cloud_desktop_service) async fn inspect_resource_with_lifecycle(
        &self,
        resource: &CloudDesktopResource,
    ) -> Result<Value, String> {
        self.ensure_root()?;
        let history = self.list_resources()?;
        let original = json!(resource);
        let pending: Vec<_> = history["operations"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|entry| {
                entry["resource"] == original
                    && matches!(entry["action"].as_str(), Some("start" | "stop"))
                    && entry["outcome"] != "lifecycleVerified"
            })
            .filter_map(|entry| entry["operationId"].as_str().map(str::to_owned))
            .collect();
        if pending.is_empty() {
            return self.inspect(resource).await;
        }
        let lock = self.try_lock_operations()?;
        let observed = self.inspect(resource).await?;
        if lock.is_none() {
            return Ok(observed);
        }
        for id in pending {
            let receipt = self
                .read_receipt(&id)?
                .ok_or("Original lifecycle operation does not exist")?;
            self.record_lifecycle_observation(&id, receipt, &observed)?;
        }
        Ok(observed)
    }

    pub(in crate::cloud_desktop_service) async fn inspect_lifecycle_operation(
        &self,
        id: &str,
    ) -> Result<Value, String> {
        self.ensure_root()?;
        let lock = self.try_lock_operations()?;
        let receipt = self
            .read_receipt(id)?
            .ok_or("Cloud desktop operation does not exist")?;
        self.validate_lifecycle_receipt(&receipt)?;
        if receipt["outcome"] == "lifecycleVerified" || lock.is_none() {
            return Ok(receipt);
        }
        let resource: CloudDesktopResource =
            serde_json::from_value(receipt["request"]["resource"].clone())
                .map_err(|_| "Invalid lifecycle resource")?;
        let observed = self.inspect(&resource).await?;
        self.record_lifecycle_observation(id, receipt, &observed)
    }

    fn record_lifecycle_observation(
        &self,
        id: &str,
        mut receipt: Value,
        observed: &Value,
    ) -> Result<Value, String> {
        if receipt["outcome"] == "lifecycleVerified" {
            return Ok(receipt);
        }
        let expected = if receipt["request"]["action"] == "start" {
            "Running"
        } else {
            "Stopped"
        };
        if observed["resource"] == receipt["request"]["resource"]
            && observed["status"] == expected
            && observed["exists"] != false
        {
            // Stopped proves the machine state, not that every charge stopped.
            // Keep the provider's independent computeReleased value unchanged.
            receipt["outcome"] = json!("lifecycleVerified");
            receipt["requiresInspection"] = json!(false);
            receipt["observedAfter"] = observed.clone();
            receipt["verifiedAt"] = json!(chrono::Utc::now().to_rfc3339());
            self.replace_receipt(id, &receipt)?;
        }
        Ok(receipt)
    }

    pub(in crate::cloud_desktop_service) fn validate_lifecycle_receipt(
        &self,
        receipt: &Value,
    ) -> Result<(), String> {
        let request = &receipt["request"];
        let resource: CloudDesktopResource = serde_json::from_value(request["resource"].clone())
            .map_err(|_| "Invalid lifecycle resource")?;
        validate_resource(&resource)?;
        let action = request["action"]
            .as_str()
            .ok_or("Missing lifecycle action")?;
        let (before, after) = match action {
            "start" => ("Stopped", "Running"),
            "stop" => ("Running", "Stopped"),
            _ => return Err("Invalid lifecycle action".into()),
        };
        let verified = receipt["outcome"] == "lifecycleVerified";
        let valid_time = |key: &str| {
            receipt[key]
                .as_str()
                .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok())
                .is_some()
        };
        if !request["diskId"].is_null()
            || receipt["observedBefore"]["resource"] != request["resource"]
            || receipt["observedBefore"]["status"] != before
            || !valid_time("createdAt")
            || !matches!(
                receipt["outcome"].as_str(),
                Some("unknown" | "accepted" | "lifecycleVerified")
            )
            || receipt["requiresInspection"] != !verified
            || (verified
                && (!valid_time("verifiedAt")
                    || receipt["observedAfter"]["resource"] != request["resource"]
                    || receipt["observedAfter"]["status"] != after
                    || receipt["observedAfter"]["exists"] == false))
        {
            return Err("Invalid lifecycle receipt; inspect the original resource".into());
        }
        Ok(())
    }
}
