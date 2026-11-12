//! 固定普通用户装配入口；只有摘要、公证书和精确资源身份经过云管理边界。
use super::cloud_assistant::invocation_ids;
use super::*;
use base64::Engine;
use bzip2::{write::BzEncoder, Compression};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

const LAUNCHER: &str = include_str!("runtime_install/launch.py");
const INSTALLER: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../electron/native/linux/linux-guest.py"
));
const BOOTSTRAP: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../electron/native/linux/linux-guest-bootstrap.py"
));
const TAG: &str = "lime-guest-installation";
const PREFIX: &str = "lime-runtime-start";
const MARKER: &str = "LIME_GUEST_BOOTSTRAP_V1:";

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Artifact {
    pub archive_sha256: String,
    pub manifest_sha256: String,
    pub archive_bytes: u64,
}

fn hash(s: &str) -> bool {
    s.len() == 64
        && s.bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}

fn source_hash() -> String {
    let mut result = Sha256::new();
    for source in [LAUNCHER, INSTALLER, BOOTSTRAP] {
        result.update(source);
        result.update([0]);
    }
    format!("{:x}", result.finalize())
}

fn validate_request(request: &Value) -> Result<CloudDesktopResource, String> {
    let resource: CloudDesktopResource = serde_json::from_value(request["resource"].clone())
        .map_err(|_| "Invalid runtime installation resource")?;
    validate_resource(&resource)?;
    let reconnect = request["action"] == "reconnectEcsRuntime";
    if reconnect {
        if request["workSaved"] != true || !request["artifact"].is_null() {
            return Err("Runtime reconnection requires saved work and no artifact".into());
        }
    } else {
        let artifact: Artifact = serde_json::from_value(request["artifact"].clone())
            .map_err(|_| "Invalid runtime artifact")?;
        if request["action"] != "startEcsRuntimeInstallation"
            || request["createDesktopUser"] != true
            || !hash(&artifact.archive_sha256)
            || !hash(&artifact.manifest_sha256)
            || !(1..=1024 * 1024 * 1024).contains(&artifact.archive_bytes)
        {
            return Err("Invalid runtime artifact or desktop user consent".into());
        }
    }
    let id = request["operationId"]
        .as_str()
        .ok_or("Missing runtime operation identity")?;
    if resource.provider != CloudDesktopProvider::Ecs
        || uuid::Uuid::parse_str(id)
            .ok()
            .map(|v| v.to_string())
            .as_deref()
            != Some(id)
        || !hash(request["capabilitySha256"].as_str().unwrap_or(""))
    {
        return Err(
            "Runtime installation requires an ECS target, trusted digests and desktop user consent"
                .into(),
        );
    }
    Ok(resource)
}

fn config(receipt: &Value) -> Value {
    let request = &receipt["request"];
    if request["action"] == "reconnectEcsRuntime" {
        return json!({"operationId":receipt["operationId"], "capabilitySha256":request["capabilitySha256"],
            "reconnect":true, "expiresAt":receipt["expiresAt"]});
    }
    json!({"operationId":receipt["operationId"], "capabilitySha256":request["capabilitySha256"],
        "archiveSha256":request["artifact"]["archiveSha256"], "manifestSha256":request["artifact"]["manifestSha256"],
        "archiveBytes":request["artifact"]["archiveBytes"], "expiresAt":receipt["expiresAt"]})
}

fn python_source(source: &str) -> String {
    source
        .lines()
        .filter(|line| !line.trim_start().starts_with('#'))
        .collect::<Vec<_>>()
        .join("\n")
        + "\n"
}

fn command(receipt: &Value) -> Result<String, String> {
    // RunCommand limits the Base64-encoded command to 24 KiB. Omit only
    // standalone comments from these fixed, AST-equivalence-tested sources.
    let bundle = json!({"launcher":python_source(LAUNCHER),"installer":python_source(INSTALLER),"bootstrap":python_source(BOOTSTRAP),"config":config(receipt)});
    let mut encoded = BzEncoder::new(Vec::new(), Compression::best());
    encoded
        .write_all(
            &serde_json::to_vec(&bundle).map_err(|_| "Cannot encode fixed runtime bootstrap")?,
        )
        .map_err(|_| "Cannot compress fixed runtime bootstrap")?;
    let payload = base64::engine::general_purpose::STANDARD.encode(
        encoded
            .finish()
            .map_err(|_| "Cannot finish runtime bootstrap")?,
    );
    let script = format!("#!/bin/sh\nset -eu\nexec /usr/bin/python3 -I - <<'LIME_RUNTIME_INSTALL'\nimport base64,bz2,json,sys\nbundle=json.loads(bz2.decompress(base64.b64decode('{payload}',validate=True)))\nnamespace={{'__name__':'lime_managed_bootstrap'}}\nexec(compile(bundle['launcher'],'lime-managed-bootstrap','exec'),namespace)\nsys.exit(namespace['main'](bundle))\nLIME_RUNTIME_INSTALL\n");
    if base64::encoded_len(script.len(), true).is_none_or(|size| size > 24 * 1024) {
        return Err("Fixed runtime bootstrap exceeds the Cloud Assistant limit".into());
    }
    Ok(script)
}

fn upload(value: &Value, receipt: &Value) -> Result<Value, String> {
    let certificate = value["certificate"]
        .as_str()
        .filter(|s| s.len() <= 8192)
        .ok_or("Missing bootstrap public certificate")?;
    let pem = regex::Regex::new(
        r"\A-----BEGIN CERTIFICATE-----\n[A-Za-z0-9+/=\n]+-----END CERTIFICATE-----\n\z",
    )
    .unwrap();
    if value.as_object().map(|o| o.len()) != Some(4)
        || value["operationId"] != receipt["operationId"]
        || value["expiresAt"] != receipt["expiresAt"]
        || value["phase"] != "uploadReady"
        || !pem.is_match(certificate)
    {
        return Err("Bootstrap public identity does not match the original operation".into());
    }
    Ok(value.clone())
}

impl CloudDesktopService {
    pub(super) async fn start_ecs_runtime_installation(
        &self,
        resource: CloudDesktopResource,
        operation_id: String,
        artifact: Artifact,
        capability_sha256: String,
        confirmation: String,
        create_desktop_user: bool,
    ) -> Result<Value, String> {
        let request = json!({"action":"startEcsRuntimeInstallation", "resource":resource,
            "operationId":operation_id,"artifact":artifact,"capabilitySha256":capability_sha256,"createDesktopUser":create_desktop_user});
        self.launch_ecs_runtime(request, confirmation).await
    }

    pub(super) async fn reconnect_ecs_runtime(
        &self,
        resource: CloudDesktopResource,
        operation_id: String,
        capability_sha256: String,
        confirmation: String,
        work_saved: bool,
    ) -> Result<Value, String> {
        let request = json!({"action":"reconnectEcsRuntime", "resource":resource,
            "operationId":operation_id,"capabilitySha256":capability_sha256,"workSaved":work_saved});
        self.launch_ecs_runtime(request, confirmation).await
    }

    async fn launch_ecs_runtime(
        &self,
        request: Value,
        confirmation: String,
    ) -> Result<Value, String> {
        let resource = validate_request(&request)?;
        let operation_id = request["operationId"].as_str().unwrap();
        let action = if request["action"] == "reconnectEcsRuntime" {
            "reconnectRuntime"
        } else {
            "installRuntime"
        };
        if confirmation != format!("{action}:{}:{}", resource.region_id, resource.resource_id) {
            return Err("Explicit runtime installation confirmation is required".into());
        }
        self.ensure_root()?;
        let _lock = self.lock_operations()?;
        if let Some(existing) = self.read_receipt(&operation_id)? {
            if existing["request"] != request {
                return Err("Operation ID belongs to a different request".into());
            }
            return Ok(existing);
        }
        self.check_change_available(&resource, request["action"].as_str().unwrap())?;
        let source = source_hash();
        let token = format!(
            "{:x}",
            Sha256::digest(
                serde_json::to_vec(&json!([operation_id, request, source]))
                    .map_err(|_| "Cannot encode runtime operation")?
            )
        );
        let mut receipt = json!({"operationId":operation_id,"request":request,"createdAt":chrono::Utc::now().to_rfc3339(),
            "sourceSha256":source,"clientToken":token,"outcome":"unknown","requiresInspection":true,
            "runtimeInstalled":false,"desktopReady":false});
        if self.preflight_ecs_preparation(&resource).await.is_err() {
            receipt["outcome"] = json!("notSubmitted");
            receipt["submitted"] = json!(false);
            receipt["requiresInspection"] = json!(false);
            receipt["failureCode"] = json!("runtimePreflightFailed");
            self.create_receipt(&operation_id, &receipt)?;
            return Ok(receipt);
        }
        receipt["expiresAt"] = json!(chrono::Utc::now().timestamp() + 1800);
        let script = command(&receipt)?;
        receipt["commandSha256"] = json!(format!("{:x}", Sha256::digest(script.as_bytes())));
        self.create_receipt(&operation_id, &receipt)?;
        match self
            .submit_ecs_command(&resource, &script, &token, TAG, PREFIX, 120)
            .await
            .and_then(|value| invocation_ids(&value).map(|ids| (value, ids)))
        {
            Ok((value, (invoke, command))) => {
                receipt["invokeId"] = json!(invoke);
                receipt["commandId"] = json!(command);
                receipt["outcome"] = json!("accepted");
                receipt["requestId"] = value["RequestId"]
                    .as_str()
                    .filter(|s| validate_id(s).is_ok())
                    .into();
            }
            Err(_) => receipt["failureCode"] = json!("runtimeLaunchUnknown"),
        }
        self.finalize_receipt(&operation_id, &receipt);
        Ok(receipt)
    }

    pub(super) fn validate_runtime_installation_receipt(
        &self,
        receipt: &Value,
    ) -> Result<(), String> {
        validate_request(&receipt["request"])?;
        let terminal = matches!(
            receipt["outcome"].as_str(),
            Some("notSubmitted" | "runtimeUploadReady" | "runtimeLaunchFailed")
        );
        let source = receipt["sourceSha256"].as_str().unwrap_or("");
        let expected = format!(
            "{:x}",
            Sha256::digest(
                serde_json::to_vec(&json!([receipt["operationId"], receipt["request"], source]))
                    .map_err(|_| "Invalid runtime request identity")?
            )
        );
        if receipt["operationId"] != receipt["request"]["operationId"]
            || !hash(source)
            || receipt["clientToken"] != expected
            || receipt["runtimeInstalled"] != false
            || receipt["desktopReady"] != false
            || receipt["requiresInspection"] != !terminal
            || !matches!(
                receipt["outcome"].as_str(),
                Some(
                    "unknown"
                        | "accepted"
                        | "runtimeStarting"
                        | "notSubmitted"
                        | "runtimeUploadReady"
                        | "runtimeLaunchFailed"
                )
            )
        {
            return Err("Invalid runtime installation receipt".into());
        }
        if receipt["outcome"] == "notSubmitted" {
            if receipt["submitted"] != false
                || !receipt["invokeId"].is_null()
                || !receipt["commandSha256"].is_null()
            {
                return Err("Invalid unsubmitted runtime receipt".into());
            }
        } else {
            if !hash(receipt["commandSha256"].as_str().unwrap_or(""))
                || receipt.get("bindAddress").is_some()
                || receipt.get("publicAddress").is_some()
                || receipt["expiresAt"].as_i64().is_none()
            {
                return Err("Invalid runtime upload identity".into());
            }
            if receipt["outcome"] != "unknown" || !receipt["invokeId"].is_null() {
                invocation_ids(
                    &json!({"InvokeId":receipt["invokeId"],"CommandId":receipt["commandId"]}),
                )?;
            }
        }
        if receipt["outcome"] == "runtimeUploadReady" {
            upload(&receipt["upload"], receipt)?;
        }
        Ok(())
    }

    pub(super) async fn inspect_ecs_runtime_installation(
        &self,
        operation_id: &str,
    ) -> Result<Value, String> {
        let _lock = self.lock_operations()?;
        let mut receipt = self
            .read_receipt(operation_id)?
            .ok_or("Runtime installation operation is missing")?;
        if matches!(
            receipt["outcome"].as_str(),
            Some("notSubmitted" | "runtimeUploadReady" | "runtimeLaunchFailed")
        ) {
            return Ok(receipt);
        }
        let resource = validate_request(&receipt["request"])?;
        let Some(entry) = self
            .query_ecs_command_result(operation_id, &resource, &mut receipt, TAG, PREFIX)
            .await?
        else {
            return Ok(receipt);
        };
        let status = entry["InvocationStatus"]
            .as_str()
            .ok_or("Missing runtime installation status")?;
        match status {
            "Pending" | "Scheduled" | "Running" | "Stopping" => {
                receipt["outcome"] = json!("runtimeStarting")
            }
            "Success" | "Failed" | "Timeout" | "Cancelled" | "Terminated" | "Aborted" | "Error"
            | "Invalid" => {
                let value = entry["Output"]
                    .as_str()
                    .and_then(|s| s.strip_prefix(MARKER))
                    .and_then(|s| serde_json::from_str::<Value>(s).ok());
                let ready =
                    if status == "Success" && entry["ExitCode"] == 0 && entry["Dropped"] == 0 {
                        value.as_ref().and_then(|v| upload(v, &receipt).ok())
                    } else {
                        None
                    };
                if let Some(value) = ready {
                    receipt["upload"] = value;
                    receipt["outcome"] = json!("runtimeUploadReady");
                } else {
                    receipt["outcome"] = json!("runtimeLaunchFailed");
                    let code = value
                        .as_ref()
                        .filter(|v| v["phase"] == "failed")
                        .and_then(|v| v["code"].as_str());
                    receipt["failureCode"] = json!(match code {
                        Some(
                            code @ ("requiresRoot"
                            | "unsupportedSystem"
                            | "invalidConfiguration"
                            | "dependenciesNotReady"
                            | "privateStateInvalid"
                            | "userConflict"
                            | "managerNotReady"),
                        ) => code,
                        _ => "bootstrapFailed",
                    });
                }
                receipt["requiresInspection"] = json!(false);
                receipt["verifiedAt"] = json!(chrono::Utc::now().to_rfc3339());
            }
            _ => {
                return Err(
                    "Unrecognized runtime installation status; inspect the original operation"
                        .into(),
                )
            }
        }
        self.finalize_receipt(operation_id, &receipt);
        Ok(receipt)
    }
}

#[cfg(all(test, unix))]
#[path = "runtime_install/tests.rs"]
mod tests;
