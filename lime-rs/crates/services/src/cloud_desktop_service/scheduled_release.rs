//! 供应商持久定时释放；先验证镜像并记录意图，不向 guest 下发管理身份。

use super::*;
use chrono::{DateTime, SecondsFormat, Utc};

fn deadline(value: &str) -> Result<DateTime<Utc>, String> {
    let time = DateTime::parse_from_rfc3339(value)
        .map_err(|_| "Invalid ECS release deadline")?
        .with_timezone(&Utc);
    // ECS rounds seconds down. Accept only one canonical whole-minute value.
    if time.timestamp() % 60 != 0
        || time.timestamp_subsec_nanos() != 0
        || time.to_rfc3339_opts(SecondsFormat::Secs, true) != value
    {
        return Err("ECS release deadline must be a whole UTC minute".into());
    }
    Ok(time)
}

pub(super) fn auto_release_time(instance: &Value) -> Result<Option<String>, String> {
    match instance.get("AutoReleaseTime") {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(value)) if value.is_empty() => Ok(None),
        Some(Value::String(value)) => {
            // DescribeInstances documents minute precision (…T04:04Z), while
            // ModifyInstanceAutoReleaseTime takes seconds (…T04:04:00Z).
            let normalized = match value.strip_suffix('Z') {
                Some(minute) if minute.len() == 16 && minute.is_ascii() => format!("{minute}:00Z"),
                _ => value.clone(),
            };
            deadline(&normalized)?;
            Ok(Some(normalized))
        }
        _ => Err("Invalid ECS automatic release state".into()),
    }
}

pub(super) fn require_no_deadline(observed: &Value) -> Result<(), String> {
    if !observed["autoReleaseTime"].is_null() {
        return Err(
            "Cancel and verify the ECS automatic release deadline before using this desktop".into(),
        );
    }
    Ok(())
}

impl CloudDesktopService {
    #[allow(clippy::too_many_arguments)]
    pub(super) async fn schedule_ecs_release(
        &self,
        resource: CloudDesktopResource,
        operation_id: String,
        image_operation_id: String,
        release_at: String,
        confirmation: String,
        work_saved: bool,
        discard_data: bool,
    ) -> Result<Value, String> {
        validate_resource(&resource)?;
        validate_id(&operation_id)?;
        validate_id(&image_operation_id)?;
        let time = deadline(&release_at)?;
        if resource.provider != CloudDesktopProvider::Ecs
            || !work_saved
            || !discard_data
            || confirmation
                != format!(
                    "scheduleEcsRelease:{}:{}:{release_at}:discard-data:image:{image_operation_id}",
                    resource.region_id, resource.resource_id
                )
        {
            return Err("Scheduled release requires exact ECS, deadline, image and data discard confirmation".into());
        }
        self.ensure_root()?;
        let _lock = self.lock_operations()?;
        let request = json!({"action":"scheduleEcsRelease","resource":resource,
            "imageOperationId":image_operation_id,"releaseAt":release_at,"discardData":true});
        if let Some(receipt) = self.read_receipt(&operation_id)? {
            return if receipt["request"] == request {
                Ok(receipt)
            } else {
                Err("Operation ID belongs to a different request".into())
            };
        }
        let preflight = async {
            self.check_change_available(&resource, "scheduleEcsRelease")?;
            let observed = self.inspect(&resource).await?;
            require_no_deadline(&observed)?;
            if observed["status"] != "Stopped"
            || observed["instanceChargeType"] != "PostPaid"
            || observed["operationBlocked"] != false
        {
            return Err(
                "Scheduled release requires an unlocked stopped PostPaid ECS instance".into(),
            );
        }
        let proof = self
            .image_release_proof(&resource, &observed, &image_operation_id)
            .await?;
        // Validate again after network preflight, before creating any intent.
        // A stale confirmation must not become a shorter grace period.
        let remaining = time.signed_duration_since(Utc::now()).num_seconds();
        if !(1800..=2100).contains(&remaining) {
            return Err("ECS release deadline expired; confirm a new deadline between 30 and 35 minutes away".into());
        }
            Ok::<_, String>((observed, proof))
        }.await;
        let (observed, proof) = match preflight {
            Ok(value) => value,
            Err(_) => {
                return Ok(
                    json!({"operationId":operation_id,"request":request,"outcome":"notSubmitted",
                "submitted":false,"requiresInspection":false,"failureCode":"schedulePreflightFailed"}),
                )
            }
        };
        let mut receipt = json!({"operationId":operation_id,"request":request,
            "outcome":"unknown","createdAt":Utc::now().to_rfc3339(),
            "observedBefore":observed,"releaseImage":proof,"requiresInspection":true,
            "retainedResourcesMayBeCharged":true});
        self.create_receipt(&operation_id, &receipt)?;
        self.submit_release_deadline(&resource, &mut receipt, Some(&release_at))
            .await;
        self.finalize_receipt(&operation_id, &receipt);
        Ok(receipt)
    }

    pub(super) async fn cancel_ecs_release(
        &self,
        resource: CloudDesktopResource,
        operation_id: String,
        release_at: String,
        confirmation: String,
    ) -> Result<Value, String> {
        validate_resource(&resource)?;
        validate_id(&operation_id)?;
        deadline(&release_at)?;
        if resource.provider != CloudDesktopProvider::Ecs
            || confirmation
                != format!(
                    "cancelEcsRelease:{}:{}:{release_at}",
                    resource.region_id, resource.resource_id
                )
        {
            return Err(
                "Cancellation requires the exact ECS resource and observed release deadline".into(),
            );
        }
        self.ensure_root()?;
        let _lock = self.lock_operations()?;
        let request =
            json!({"action":"cancelEcsRelease","resource":resource,"releaseAt":release_at});
        if let Some(receipt) = self.read_receipt(&operation_id)? {
            return if receipt["request"] == request {
                Ok(receipt)
            } else {
                Err("Operation ID belongs to a different request".into())
            };
        }
        let preflight = async {
            self.check_change_available(&resource, "cancelEcsRelease")?;
            let observed = self.inspect(&resource).await?;
            if observed["exists"] == false || observed["autoReleaseTime"] != release_at {
                return Err("ECS release deadline changed; refresh before cancelling".to_string());
            }
            Ok(observed)
        }
        .await;
        let observed = match preflight {
            Ok(value) => value,
            Err(_) => {
                return Ok(
                    json!({"operationId":operation_id,"request":request,"outcome":"notSubmitted",
                "submitted":false,"requiresInspection":false,"failureCode":"schedulePreflightFailed"}),
                )
            }
        };
        let mut receipt = json!({"operationId":operation_id,"request":request,
            "outcome":"unknown","createdAt":Utc::now().to_rfc3339(),
            "observedBefore":observed,"requiresInspection":true});
        self.create_receipt(&operation_id, &receipt)?;
        // Per the official API, omitting AutoReleaseTime cancels the deadline.
        self.submit_release_deadline(&resource, &mut receipt, None)
            .await;
        self.finalize_receipt(&operation_id, &receipt);
        Ok(receipt)
    }

    async fn submit_release_deadline(
        &self,
        resource: &CloudDesktopResource,
        receipt: &mut Value,
        time: Option<&str>,
    ) {
        let mut args = vec![
            "ModifyInstanceAutoReleaseTime".into(),
            "--InstanceId".into(),
            resource.resource_id.clone(),
        ];
        if let Some(time) = time {
            args.extend(["--AutoReleaseTime".into(), time.into()]);
        }
        match self.call(resource, &args).await {
            Ok(response) => {
                receipt["outcome"] = json!("accepted");
                receipt["requestId"] = json!(response["RequestId"].as_str());
            }
            Err(error) => receipt["diagnostic"] = json!(error),
        }
    }

    pub(super) async fn inspect_ecs_release_schedule(
        &self,
        operation_id: &str,
    ) -> Result<Value, String> {
        self.ensure_root()?;
        let _lock = self.lock_operations()?;
        let mut receipt = self
            .read_receipt(operation_id)?
            .ok_or("Release schedule does not exist")?;
        let request = &receipt["request"];
        let resource: CloudDesktopResource = serde_json::from_value(request["resource"].clone())
            .map_err(|_| "Invalid release schedule resource")?;
        validate_resource(&resource)?;
        let time = request["releaseAt"]
            .as_str()
            .ok_or("Missing release deadline")?;
        deadline(time)?;
        let cancelling = request["action"] == "cancelEcsRelease";
        if resource.provider != CloudDesktopProvider::Ecs
            || (!cancelling
                && (request["action"] != "scheduleEcsRelease" || request["discardData"] != true))
        {
            return Err("Invalid release schedule receipt".into());
        }
        if matches!(
            receipt["outcome"].as_str(),
            Some("released" | "releaseCancelled" | "scheduleCancelled")
        ) {
            return Ok(receipt);
        }
        let observed = self.inspect(&resource).await?;
        let outcome = if observed["exists"] == false {
            "released"
        } else if observed["autoReleaseTime"].is_null() {
            if cancelling {
                "releaseCancelled"
            } else if receipt["outcome"] == "scheduled" {
                "scheduleCancelled"
            } else {
                "unknown"
            }
        } else if observed["autoReleaseTime"] == time {
            if cancelling {
                "unknown"
            } else {
                "scheduled"
            }
        } else {
            "scheduleChanged"
        };
        receipt["outcome"] = json!(outcome);
        receipt["requiresInspection"] = json!(!matches!(
            outcome,
            "released" | "releaseCancelled" | "scheduleCancelled"
        ));
        receipt["observedAfter"] = observed;
        receipt["verifiedAt"] = json!(Utc::now().to_rfc3339());
        if outcome == "releaseCancelled" {
            // A verified cancellation resolves the original schedule as well;
            // otherwise its durable unknown intent would block reuse forever.
            for entry in fs::read_dir(&self.root).map_err(|_| "Cannot list release schedules")? {
                let entry = entry.map_err(|_| "Cannot read release schedule")?;
                let name = entry.file_name();
                let Some(name) = name.to_str() else { continue };
                let Some(id) = name.strip_suffix(".json") else {
                    continue;
                };
                if name.starts_with("resource-") || name.starts_with("quote-") {
                    continue;
                }
                validate_id(id)?;
                let Some(mut original) = self.read_receipt(id)? else {
                    continue;
                };
                let target = &original["request"]["resource"];
                if original["request"]["action"] == "scheduleEcsRelease"
                    && original["request"]["releaseAt"] == receipt["request"]["releaseAt"]
                    && target["provider"] == "ecs"
                    && target["regionId"] == resource.region_id
                    && target["resourceId"] == resource.resource_id
                    && target["profile"] == resource.profile
                    && original["outcome"] != "released"
                {
                    original["outcome"] = json!("scheduleCancelled");
                    original["requiresInspection"] = json!(false);
                    original["cancellationOperationId"] = json!(operation_id);
                    original["verifiedAt"] = receipt["verifiedAt"].clone();
                    original["observedAfter"] = receipt["observedAfter"].clone();
                    self.finalize_receipt(id, &original);
                }
            }
        }
        self.finalize_receipt(operation_id, &receipt);
        Ok(receipt)
    }

    pub(super) fn validate_release_schedule_receipt(&self, receipt: &Value) -> Result<(), String> {
        let request = &receipt["request"];
        let resource: CloudDesktopResource = serde_json::from_value(request["resource"].clone())
            .map_err(|_| "Invalid release schedule resource")?;
        validate_resource(&resource)?;
        let release_at = request["releaseAt"]
            .as_str()
            .ok_or("Missing release deadline")?;
        deadline(release_at)?;
        let schedule = request["action"] == "scheduleEcsRelease";
        let outcome = receipt["outcome"]
            .as_str()
            .ok_or("Missing release schedule state")?;
        let terminal = matches!(
            outcome,
            "released" | "releaseCancelled" | "scheduleCancelled"
        );
        if resource.provider != CloudDesktopProvider::Ecs
            || receipt["observedBefore"]["resource"] != request["resource"]
            || receipt["createdAt"]
                .as_str()
                .and_then(|t| DateTime::parse_from_rfc3339(t).ok())
                .is_none()
            || receipt["requiresInspection"] != !terminal
            || !matches!(
                outcome,
                "unknown"
                    | "accepted"
                    | "scheduled"
                    | "released"
                    | "releaseCancelled"
                    | "scheduleCancelled"
                    | "scheduleChanged"
            )
            || (schedule
                && (request["discardData"] != true
                    || receipt["observedBefore"]["status"] != "Stopped"
                    || receipt["observedBefore"]["instanceChargeType"] != "PostPaid"
                    || receipt["releaseImage"]["operationId"] != request["imageOperationId"]
                    || receipt["releaseImage"]["ready"] != true
                    || receipt["releaseImage"]["encrypted"] != true
                    || receipt["releaseImage"]["private"] != true))
            || (!schedule && receipt["observedBefore"]["autoReleaseTime"] != release_at)
            || (terminal
                && (receipt["observedAfter"]["resource"] != request["resource"]
                    || receipt["verifiedAt"]
                        .as_str()
                        .and_then(|t| DateTime::parse_from_rfc3339(t).ok())
                        .is_none()))
            || (outcome == "released"
                && (receipt["observedAfter"]["exists"] != false
                    || receipt["observedAfter"]["status"] != "NotFound"))
            || (matches!(outcome, "releaseCancelled" | "scheduleCancelled")
                && !receipt["observedAfter"]["autoReleaseTime"].is_null())
        {
            return Err(
                "Invalid release schedule receipt; reconcile before changing this desktop".into(),
            );
        }
        Ok(())
    }
}

#[cfg(all(test, unix))]
mod tests;
