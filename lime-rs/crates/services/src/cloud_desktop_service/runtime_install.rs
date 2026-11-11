//! 固定普通用户装配入口；只有摘要、公证书和精确资源身份经过云管理边界。
use super::cloud_assistant::invocation_ids;
use super::*;
use base64::Engine;
use flate2::{write::ZlibEncoder, Compression};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::net::Ipv4Addr;

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
    let artifact: Artifact = serde_json::from_value(request["artifact"].clone())
        .map_err(|_| "Invalid runtime artifact")?;
    let id = request["operationId"]
        .as_str()
        .ok_or("Missing runtime operation identity")?;
    if resource.provider != CloudDesktopProvider::Ecs
        || request["createDesktopUser"] != true
        || uuid::Uuid::parse_str(id)
            .ok()
            .map(|v| v.to_string())
            .as_deref()
            != Some(id)
        || !hash(&artifact.archive_sha256)
        || !hash(&artifact.manifest_sha256)
        || !(1..=1024 * 1024 * 1024).contains(&artifact.archive_bytes)
        || !hash(request["capabilitySha256"].as_str().unwrap_or(""))
    {
        return Err(
            "Runtime installation requires an ECS target, trusted digests and desktop user consent"
                .into(),
        );
    }
    Ok(resource)
}

fn valid_address(s: &str, private: bool) -> bool {
    let Ok(ip) = s.parse::<Ipv4Addr>() else {
        return false;
    };
    let [a, b, _, _] = ip.octets();
    ip.to_string() == s
        && !ip.is_loopback()
        && !ip.is_link_local()
        && !ip.is_multicast()
        && !ip.is_unspecified()
        && !ip.is_broadcast()
        && !ip.is_documentation()
        && if private {
            ip.is_private()
        } else {
            !ip.is_private()
                && a != 0
                && a < 224
                && !(a == 100 && (64..=127).contains(&b))
                && !(a == 198 && (18..=19).contains(&b))
                && !(a == 192 && b == 0)
        }
}

fn addresses(
    response: &Value,
    resource: &CloudDesktopResource,
) -> Result<(String, String), String> {
    let instances = response
        .pointer("/Instances/Instance")
        .and_then(Value::as_array)
        .ok_or("Missing ECS network identity")?;
    if instances.len() != 1
        || instances[0]["InstanceId"] != resource.resource_id
        || response
            .get("TotalCount")
            .is_some_and(|v| v.as_u64() != Some(1))
    {
        return Err("ECS network identity does not match the exact instance".into());
    }
    let instance = &instances[0];
    let private = instance
        .pointer("/VpcAttributes/PrivateIpAddress/IpAddress")
        .and_then(Value::as_array)
        .filter(|v| v.len() == 1)
        .and_then(|v| v[0].as_str())
        .filter(|v| valid_address(v, true))
        .ok_or("A single primary private ECS IPv4 address is required")?;
    let mut public = Vec::new();
    if let Some(values) = instance
        .pointer("/PublicIpAddress/IpAddress")
        .and_then(Value::as_array)
    {
        for value in values {
            public.push(value.as_str().ok_or("Invalid public ECS address")?);
        }
    }
    if let Some(value) = instance
        .pointer("/EipAddress/IpAddress")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
    {
        public.push(value);
    }
    public.sort_unstable();
    public.dedup();
    if public.len() != 1 || !valid_address(public[0], false) {
        return Err("A single public ECS IPv4 address is required for runtime upload".into());
    }
    Ok((private.into(), public[0].into()))
}

fn config(receipt: &Value) -> Value {
    let request = &receipt["request"];
    json!({"operationId":receipt["operationId"], "capabilitySha256":request["capabilitySha256"],
        "archiveSha256":request["artifact"]["archiveSha256"], "manifestSha256":request["artifact"]["manifestSha256"],
        "archiveBytes":request["artifact"]["archiveBytes"], "bindAddress":receipt["bindAddress"],
        "publicAddress":receipt["publicAddress"], "expiresAt":receipt["expiresAt"]})
}

fn command(receipt: &Value) -> Result<String, String> {
    let bundle = json!({"launcher":LAUNCHER,"installer":INSTALLER,"bootstrap":BOOTSTRAP,"config":config(receipt)});
    let mut encoded = ZlibEncoder::new(Vec::new(), Compression::best());
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
    let script = format!("#!/bin/sh\nset -eu\nexec /usr/bin/python3 -I - <<'LIME_RUNTIME_INSTALL'\nimport base64,json,sys,zlib\nbundle=json.loads(zlib.decompress(base64.b64decode('{payload}',validate=True)))\nnamespace={{'__name__':'lime_managed_bootstrap'}}\nexec(compile(bundle['launcher'],'lime-managed-bootstrap','exec'),namespace)\nsys.exit(namespace['main'](bundle))\nLIME_RUNTIME_INSTALL\n");
    if script.len() > 24 * 1024 {
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
    if value.as_object().map(|o| o.len()) != Some(5)
        || value["operationId"] != receipt["operationId"]
        || value["expiresAt"] != receipt["expiresAt"]
        || value["publicAddress"] != receipt["publicAddress"]
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
        validate_request(&request)?;
        if confirmation
            != format!(
                "installRuntime:{}:{}",
                resource.region_id, resource.resource_id
            )
        {
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
        self.check_change_available(&resource, "startEcsRuntimeInstallation")?;
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
        let preflight = async {
            self.preflight_ecs_preparation(&resource).await?;
            let network = self
                .call(
                    &resource,
                    &[
                        "DescribeInstances".into(),
                        "--InstanceIds".into(),
                        json!([resource.resource_id]).to_string(),
                    ],
                )
                .await?;
            addresses(&network, &resource)
        }
        .await;
        let (private, public) = match preflight {
            Ok(value) => value,
            Err(_) => {
                receipt["outcome"] = json!("notSubmitted");
                receipt["submitted"] = json!(false);
                receipt["requiresInspection"] = json!(false);
                receipt["failureCode"] = json!("runtimePreflightFailed");
                self.create_receipt(&operation_id, &receipt)?;
                return Ok(receipt);
            }
        };
        receipt["bindAddress"] = json!(private);
        receipt["publicAddress"] = json!(public);
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
                || !valid_address(receipt["bindAddress"].as_str().unwrap_or(""), true)
                || !valid_address(receipt["publicAddress"].as_str().unwrap_or(""), false)
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
