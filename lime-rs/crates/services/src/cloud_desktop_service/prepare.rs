//! 通过用户自己的 ECS 云助手准备固定桌面依赖；不建立远端 runtime 或凭据代理。

use super::*;
use sha2::{Digest, Sha256};

const SCRIPT: &str = include_str!("prepare/desktop.sh");
const TAG: &str = "lime-cloud-preparation";
const MARKER: &str = "LIME_DESKTOP_PREPARE_V1:";

fn script_sha256() -> String {
    format!("{:x}", Sha256::digest(SCRIPT.as_bytes()))
}

use super::cloud_assistant::invocation_ids;

impl CloudDesktopService {
    pub(super) async fn prepare_ecs_desktop(
        &self,
        resource: CloudDesktopResource,
        operation_id: String,
        confirmation: String,
        install_system_packages: bool,
    ) -> Result<Value, String> {
        validate_resource(&resource)?;
        validate_id(&operation_id)?;
        if resource.provider != CloudDesktopProvider::Ecs
            || !install_system_packages
            || confirmation
                != format!(
                    "prepareEcsDesktop:{}:{}",
                    resource.region_id, resource.resource_id
                )
        {
            return Err(
                "Desktop preparation requires an ECS target and explicit system package consent"
                    .into(),
            );
        }
        self.ensure_root()?;
        let _lock = self.lock_operations()?;
        let request = json!({"action":"prepareEcsDesktop", "resource":resource, "installSystemPackages":true});
        if let Some(existing) = self.read_receipt(&operation_id)? {
            if existing["request"] != request {
                return Err("Operation ID belongs to a different request".into());
            }
            return Ok(existing);
        }
        self.check_change_available(&resource, "prepareEcsDesktop")?;
        let token = format!(
            "{:x}",
            Sha256::digest(
                serde_json::to_vec(&json!([operation_id, request, script_sha256(),]))
                    .map_err(|_| "Cannot encode preparation identity")?
            )
        );
        let mut receipt = json!({
            "operationId":operation_id, "request":request, "createdAt":chrono::Utc::now().to_rfc3339(),
            "scriptSha256":script_sha256(), "clientToken":token,
            "outcome":"unknown", "requiresInspection":true, "desktopReady":false,
            "runtimeInstalled":false, "packagesPrepared":false,
        });
        if let Err(error) = self.preflight_ecs_preparation(&resource).await {
            receipt["outcome"] = json!("notSubmitted");
            receipt["submitted"] = json!(false);
            receipt["requiresInspection"] = json!(false);
            receipt["diagnostic"] = json!(error);
            self.create_receipt(&operation_id, &receipt)?;
            return Ok(receipt);
        }
        self.create_receipt(&operation_id, &receipt)?;
        let response = self
            .submit_ecs_command(
                &resource,
                SCRIPT,
                receipt["clientToken"].as_str().unwrap(),
                TAG,
                "lime-desktop-prepare",
                1800,
            )
            .await;
        match response.and_then(|value| invocation_ids(&value).map(|ids| (value, ids))) {
            Ok((value, (invoke, command))) => {
                receipt["invokeId"] = json!(invoke);
                receipt["commandId"] = json!(command);
                receipt["outcome"] = json!("accepted");
                receipt["requestId"] = value["RequestId"]
                    .as_str()
                    .filter(|s| validate_id(s).is_ok())
                    .into();
            }
            Err(_) => {
                receipt["diagnostic"] = json!(
                "Preparation submission is unknown; inspect the original operation before retrying"
            )
            }
        }
        self.finalize_receipt(&operation_id, &receipt);
        Ok(receipt)
    }

    pub(super) async fn preflight_ecs_preparation(
        &self,
        resource: &CloudDesktopResource,
    ) -> Result<(), String> {
        let observed = self.inspect(resource).await?;
        if observed["status"] != "Running" || observed["operationBlocked"] != false {
            return Err("Desktop preparation requires an unlocked running ECS instance".into());
        }
        let response = self
            .call(
                resource,
                &[
                    "DescribeCloudAssistantStatus".into(),
                    "--InstanceId.1".into(),
                    resource.resource_id.clone(),
                ],
            )
            .await?;
        let agents = response
            .pointer("/InstanceCloudAssistantStatusSet/InstanceCloudAssistantStatus")
            .and_then(Value::as_array)
            .ok_or("Invalid Cloud Assistant status response")?;
        if agents.len() != 1
            || agents[0]["InstanceId"] != resource.resource_id
            || agents[0]["CloudAssistantStatus"] != "true"
            || agents[0]["OSType"] != "Linux"
        {
            return Err("A connected Linux ECS Cloud Assistant is required".into());
        }
        Ok(())
    }

    pub(super) fn validate_preparation_receipt(&self, receipt: &Value) -> Result<(), String> {
        let resource: CloudDesktopResource =
            serde_json::from_value(receipt["request"]["resource"].clone())
                .map_err(|_| "Invalid preparation resource")?;
        validate_resource(&resource)?;
        let token = receipt["clientToken"].as_str().unwrap_or("");
        let sha = receipt["scriptSha256"].as_str().unwrap_or("");
        let hash = |s: &str| s.len() == 64 && s.bytes().all(|c| c.is_ascii_hexdigit());
        let expected_token = format!(
            "{:x}",
            Sha256::digest(
                serde_json::to_vec(&json!([receipt["operationId"], receipt["request"], sha,]))
                    .map_err(|_| "Invalid preparation request identity")?
            )
        );
        let terminal = matches!(
            receipt["outcome"].as_str(),
            Some("dependenciesReady" | "preparationFailed" | "notSubmitted")
        );
        if resource.provider != CloudDesktopProvider::Ecs
            || receipt["request"]["installSystemPackages"] != true
            || !hash(token)
            || !hash(sha)
            || token != expected_token
            || receipt["desktopReady"] != false
            || receipt["runtimeInstalled"] != false
            || !matches!(
                receipt["outcome"].as_str(),
                Some(
                    "notSubmitted"
                        | "unknown"
                        | "accepted"
                        | "preparing"
                        | "dependenciesReady"
                        | "preparationFailed"
                )
            )
            || receipt["packagesPrepared"] != (receipt["outcome"] == "dependenciesReady")
            || receipt["requiresInspection"] != !terminal
            || (!matches!(
                receipt["outcome"].as_str(),
                Some("unknown" | "notSubmitted")
            ) && receipt["invokeId"].is_null())
            || (receipt["outcome"] == "notSubmitted"
                && (receipt["submitted"] != false || !receipt["invokeId"].is_null()))
            || (terminal
                && receipt["outcome"] != "notSubmitted"
                && receipt["verifiedAt"]
                    .as_str()
                    .and_then(|time| chrono::DateTime::parse_from_rfc3339(time).ok())
                    .is_none())
        {
            return Err("Invalid desktop preparation receipt".into());
        }
        if !receipt["invokeId"].is_null() || !receipt["commandId"].is_null() {
            invocation_ids(
                &json!({"InvokeId":receipt["invokeId"], "CommandId":receipt["commandId"]}),
            )?;
        }
        Ok(())
    }

    pub(super) async fn inspect_ecs_preparation(
        &self,
        operation_id: &str,
    ) -> Result<Value, String> {
        let _lock = self.lock_operations()?;
        let mut receipt = self
            .read_receipt(operation_id)?
            .ok_or("Preparation operation is missing")?;
        if matches!(
            receipt["outcome"].as_str(),
            Some("dependenciesReady" | "preparationFailed" | "notSubmitted")
        ) {
            return Ok(receipt);
        }
        let resource: CloudDesktopResource =
            serde_json::from_value(receipt["request"]["resource"].clone())
                .map_err(|_| "Invalid preparation resource")?;
        let Some(entry) = self
            .query_ecs_command_result(
                operation_id,
                &resource,
                &mut receipt,
                TAG,
                "lime-desktop-prepare",
            )
            .await?
        else {
            return Ok(receipt);
        };
        let status = entry["InvocationStatus"]
            .as_str()
            .ok_or("Missing preparation status")?;
        match status {
            "Pending" | "Scheduled" | "Running" | "Stopping" => {
                receipt["outcome"] = json!("preparing")
            }
            "Success" | "Failed" | "Timeout" | "Cancelled" | "Terminated" | "Aborted" | "Error"
            | "Invalid" => {
                let ready = status == "Success"
                    && entry["ExitCode"] == 0
                    && entry["Dropped"] == 0
                    && entry["Output"] == format!("{MARKER}ready\n");
                receipt["outcome"] = json!(if ready {
                    "dependenciesReady"
                } else {
                    "preparationFailed"
                });
                receipt["packagesPrepared"] = json!(ready);
                receipt["requiresInspection"] = json!(false);
                receipt["verifiedAt"] = json!(chrono::Utc::now().to_rfc3339());
                if !ready {
                    let code = entry["Output"]
                        .as_str()
                        .and_then(|s| s.strip_prefix(MARKER))
                        .map(str::trim);
                    receipt["failureCode"] = json!(match code {
                        Some(
                            code @ ("unsupportedSystem"
                            | "requiresRoot"
                            | "insufficientDisk"
                            | "packageInstallFailed"
                            | "dependencyCheckFailed"),
                        ) => code,
                        _ => "preparationFailed",
                    });
                }
            }
            _ => {
                return Err(
                    "Unrecognized preparation status; inspect the original operation".into(),
                )
            }
        }
        self.finalize_receipt(operation_id, &receipt);
        Ok(receipt)
    }
}

#[cfg(all(test, unix))]
#[path = "prepare/tests.rs"]
mod tests;
