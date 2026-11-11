//! 用户自付 ECS 的生命周期。复用本机 Alibaba CLI profile，不读取或转交云密钥。
//! 先落 unknown 收据再发送变更；崩溃、超时或重发都不能悄悄重复副作用。

use app_server_protocol::protocol::v2::{
    CloudDesktopParams, CloudDesktopProvider, CloudDesktopResource, CloudDesktopResponse,
    CloudDesktopTunnelChannel,
};
use fs2::FileExt;
use serde_json::{json, Value};
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;
use tokio::io::AsyncReadExt;
use tokio::process::Command;

const MAX_PROVIDER_BYTES: u64 = 1024 * 1024;

#[derive(Clone)]
pub struct CloudDesktopService {
    root: PathBuf,
    cli: PathBuf,
}

impl CloudDesktopService {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        let root = root.into();
        let bundled = root
            .parent()
            .unwrap_or(&root)
            .join("tools")
            .join(if cfg!(windows) {
                "aliyun.exe"
            } else {
                "aliyun"
            });
        let managed = auth::cli::installed_path(&root);
        let cli = if managed.is_file() {
            managed
        } else if bundled.is_file() {
            bundled
        } else {
            PathBuf::from("aliyun")
        };
        Self { root, cli }
    }

    pub async fn request(
        &self,
        params: CloudDesktopParams,
    ) -> Result<CloudDesktopResponse, String> {
        let data = match params {
            CloudDesktopParams::ConnectAlibaba { region_id } => self.connect_alibaba(&region_id)?,
            CloudDesktopParams::ReadAlibabaConnection {} => self.read_alibaba_connection()?,
            CloudDesktopParams::ListResources {} => self.list_resources()?,
            CloudDesktopParams::Bind { resource } => {
                validate_resource(&resource)?;
                let state = self.inspect(&resource).await?;
                if state["exists"] == false {
                    return Err(
                        "Cloud desktop does not exist in the selected profile and region".into(),
                    );
                }
                self.remember_resource(&resource)?;
                state
            }
            CloudDesktopParams::QuoteWuying { spec } => self.quote_wuying(spec).await?,
            CloudDesktopParams::QuoteEcs { spec } => self.quote_ecs(spec).await?,
            CloudDesktopParams::ListEcsTemplates { region_id, profile } => {
                self.list_ecs_templates(&region_id, &profile).await?
            }
            CloudDesktopParams::QuoteEcsTemplate {
                region_id,
                profile,
                launch_template_id,
                version,
            } => {
                self.quote_ecs_template(&region_id, &profile, &launch_template_id, version)
                    .await?
            }
            CloudDesktopParams::PurchaseEcs {
                spec,
                desktop_name,
                operation_id,
                quote_id,
                confirmation,
            } => {
                self.purchase_ecs(spec, desktop_name, operation_id, quote_id, confirmation)
                    .await?
            }
            CloudDesktopParams::PurchaseWuying {
                spec,
                desktop_name,
                operation_id,
                quote_id,
                confirmation,
            } => {
                self.purchase_wuying(spec, desktop_name, operation_id, quote_id, confirmation)
                    .await?
            }
            CloudDesktopParams::ExportArchive {
                source_root,
                paths,
                output_path,
                recipient,
                include_credentials,
                work_saved,
            } => tokio::task::spawn_blocking(move || {
                crate::cloud_archive_service::export(
                    Path::new(&source_root),
                    &paths,
                    Path::new(&output_path),
                    &recipient,
                    include_credentials,
                    work_saved,
                )
            })
            .await
            .map_err(|_| "Cloud archive worker failed")??,
            CloudDesktopParams::PrepareArchiveDownload { .. }
            | CloudDesktopParams::ReadArchiveDownload { .. }
            | CloudDesktopParams::CloseArchiveDownload { .. }
            | CloudDesktopParams::BeginArchiveRestore { .. }
            | CloudDesktopParams::WriteArchiveRestore { .. }
            | CloudDesktopParams::FinishArchiveRestore { .. }
            | CloudDesktopParams::CancelArchiveRestore { .. } => {
                return Err("Archive transfers require an authenticated App Server connection".into());
            }
            CloudDesktopParams::RewrapArchiveForRestore { archive_path, identity_file, output_path, expected_sha256, recipient } =>
                tokio::task::spawn_blocking(move || crate::cloud_archive_service::rewrap_for_restore(
                    Path::new(&archive_path), Path::new(&identity_file), Path::new(&output_path), &expected_sha256, &recipient,
                )).await.map_err(|_| "Cloud restore worker failed")??,
            CloudDesktopParams::RestoreArchive {
                archive_path,
                identity_file,
                destination,
                expected_sha256,
                max_bytes,
            } => tokio::task::spawn_blocking(move || {
                crate::cloud_archive_service::restore(
                    Path::new(&archive_path),
                    Path::new(&identity_file),
                    Path::new(&destination),
                    &expected_sha256,
                    max_bytes,
                )
            })
            .await
            .map_err(|_| "Cloud restore worker failed")??,
            CloudDesktopParams::TransferArchive {
                local_path,
                remote,
                upload,
                expected_sha256,
            } => {
                crate::cloud_archive_service::transfer(
                    Path::new(&local_path),
                    &remote,
                    upload,
                    &expected_sha256,
                )
                .await?
            }
            CloudDesktopParams::Inspect { resource } => {
                validate_resource(&resource)?;
                self.inspect(&resource).await?
            }
            CloudDesktopParams::OpenEcsTunnel { resource, channel } => {
                self.open_ecs_tunnel(resource, channel).await?
            }
            CloudDesktopParams::ReadEcsTunnel { resource, channel } => {
                self.read_ecs_tunnel(&resource, channel).await?
            }
            CloudDesktopParams::CloseEcsTunnel { resource, channel } => {
                self.close_ecs_tunnel(&resource, channel).await?
            }
            CloudDesktopParams::PrepareEcsDesktop {
                resource,
                operation_id,
                confirmation,
                install_system_packages,
            } => {
                self.prepare_ecs_desktop(
                    resource,
                    operation_id,
                    confirmation,
                    install_system_packages,
                )
                .await?
            }
            CloudDesktopParams::StartEcsRuntimeInstallation {
                resource,
                operation_id,
                archive_sha256,
                manifest_sha256,
                archive_bytes,
                capability_sha256,
                confirmation,
                create_desktop_user,
            } => {
                self.start_ecs_runtime_installation(
                    resource,
                    operation_id,
                    runtime_install::Artifact {
                        archive_sha256,
                        manifest_sha256,
                        archive_bytes,
                    },
                    capability_sha256,
                    confirmation,
                    create_desktop_user,
                )
                .await?
            }
            CloudDesktopParams::ReadOperation { operation_id } => {
                validate_id(&operation_id)?;
                self.inspect_operation(&operation_id).await?
            }
            CloudDesktopParams::InspectSnapshot {
                resource,
                disk_id,
                snapshot_id,
            } => {
                self.inspect_snapshot(&resource, &disk_id, &snapshot_id)
                    .await?
            }
            CloudDesktopParams::RestoreSnapshot {
                resource,
                disk_id,
                snapshot_id,
                operation_id,
                confirmation,
                work_saved,
                discard_changes,
            } => {
                self.restore_snapshot(
                    resource,
                    disk_id,
                    snapshot_id,
                    operation_id,
                    confirmation,
                    work_saved,
                    discard_changes,
                )
                .await?
            }
            CloudDesktopParams::VerifySnapshotRestore {
                operation_id,
                confirmation,
                applications_validated,
            } => {
                self.verify_snapshot_restore(&operation_id, &confirmation, applications_validated)
                    .await?
            }
            CloudDesktopParams::Start {
                resource,
                operation_id,
                confirmation,
            } => {
                self.mutate(resource, operation_id, confirmation, "start", None, true)
                    .await?
            }
            CloudDesktopParams::Stop {
                resource,
                operation_id,
                confirmation,
                work_saved,
            } => {
                self.mutate(
                    resource,
                    operation_id,
                    confirmation,
                    "stop",
                    None,
                    work_saved,
                )
                .await?
            }
            CloudDesktopParams::Release {
                resource,
                operation_id,
                confirmation,
                work_saved,
                discard_data,
            } => {
                if !discard_data {
                    return Err("Release requires explicit disk data discard".into());
                }
                self.mutate(
                    resource,
                    operation_id,
                    confirmation,
                    "release",
                    None,
                    work_saved,
                )
                .await?
            }
            CloudDesktopParams::Snapshot {
                resource,
                operation_id,
                confirmation,
                disk_id,
                work_saved,
            } => {
                validate_id(&disk_id)?;
                self.mutate(
                    resource,
                    operation_id,
                    confirmation,
                    "snapshot",
                    Some(disk_id),
                    work_saved,
                )
                .await?
            }
        };
        Ok(CloudDesktopResponse { data })
    }

    async fn inspect(&self, resource: &CloudDesktopResource) -> Result<Value, String> {
        if resource.provider == CloudDesktopProvider::Wuying {
            return self.inspect_wuying(resource).await;
        }
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
        let instances = response
            .pointer("/Instances/Instance")
            .and_then(Value::as_array)
            .ok_or("Invalid ECS instance response")?;
        if response
            .get("TotalCount")
            .is_some_and(|count| count.as_u64() != Some(instances.len() as u64))
        {
            return Err("ECS instance response has inconsistent inventory counts".into());
        }
        if instances.is_empty() {
            return Ok(missing_resource(resource));
        }
        if instances.len() != 1 || instances[0]["InstanceId"] != resource.resource_id {
            return Err("ECS resource is missing or does not match the requested instance".into());
        }
        let instance = &instances[0];
        let status = instance["Status"].as_str().ok_or("ECS status is missing")?;
        let mode = instance["StoppedMode"].as_str();
        let operation_blocked = has_operation_locks(instance, "LockReason")?;
        Ok(json!({
            "resource": resource, "name": instance["InstanceName"].as_str(), "status": status, "stoppedMode": mode,
            "instanceChargeType": instance["InstanceChargeType"].as_str(),
            "instanceType": instance["InstanceType"].as_str(),
            "operationBlocked": operation_blocked,
            "computeReleased": status == "Stopped" && mode == Some("StopCharging"),
            "retainedResourcesMayBeCharged": true,
            "desktopReady": false,
        }))
    }

    async fn mutate(
        &self,
        resource: CloudDesktopResource,
        operation_id: String,
        confirmation: String,
        action: &str,
        disk_id: Option<String>,
        work_saved: bool,
    ) -> Result<Value, String> {
        validate_resource(&resource)?;
        validate_id(&operation_id)?;
        if resource.provider == CloudDesktopProvider::Wuying
            && disk_id
                .as_deref()
                .is_some_and(|disk| !["system", "data"].contains(&disk))
        {
            return Err("Wuying snapshot source must be system or data".into());
        }
        let expected = format!(
            "{action}:{}:{}{}",
            resource.region_id,
            resource.resource_id,
            if action == "release" {
                ":discard-data".into()
            } else {
                disk_id
                    .as_ref()
                    .map(|disk| format!(":{disk}"))
                    .unwrap_or_default()
            }
        );
        if confirmation != expected || !work_saved {
            return Err(
                "Explicit resource confirmation and saved/quiesced work are required".into(),
            );
        }
        self.ensure_root()?;
        let _lock = self.lock_operations()?;
        let mut request = json!({ "resource": resource, "action": action, "diskId": disk_id });
        if action == "release" {
            request["discardData"] = json!(true);
        }
        if let Some(existing) = self.read_receipt(&operation_id)? {
            if existing["request"] != request {
                return Err("Operation ID belongs to a different request".into());
            }
            return Ok(existing);
        }
        self.check_change_available(&resource, action)?;
        let observed = self.inspect(&resource).await?;
        let state = observed["status"].as_str().unwrap_or("");
        match action {
            "start" if state != "Stopped" => {
                return Err("Only a stopped cloud desktop can be started".into())
            }
            "stop" if state != "Running" => {
                return Err("Only a running cloud desktop can be stopped".into())
            }
            "snapshot" if state != "Stopped" => {
                return Err("Cold disk snapshots require a stopped, quiesced instance".into())
            }
            "release" if state != "Stopped" || observed["instanceChargeType"] != "PostPaid" => {
                return Err("Only a stopped PostPaid cloud desktop can be released".into())
            }
            _ => {}
        }
        if let Some(disk) = disk_id
            .as_ref()
            .filter(|_| resource.provider == CloudDesktopProvider::Ecs)
        {
            let response = self
                .call(
                    &resource,
                    &[
                        "DescribeDisks".into(),
                        "--DiskIds".into(),
                        json!([disk]).to_string(),
                    ],
                )
                .await?;
            let disks = response
                .pointer("/Disks/Disk")
                .and_then(Value::as_array)
                .ok_or("Invalid ECS disks response")?;
            if disks.len() != 1
                || disks[0]["DiskId"] != *disk
                || disks[0]["InstanceId"] != resource.resource_id
            {
                return Err("Snapshot disk does not belong to the selected instance".into());
            }
        }
        let mut receipt = json!({ "operationId": operation_id, "request": request, "outcome": "unknown",
            "createdAt": chrono::Utc::now().to_rfc3339(), "observedBefore": observed,
            "requiresInspection": true });
        self.create_receipt(&operation_id, &receipt)?;
        let args = if resource.provider == CloudDesktopProvider::Wuying {
            match action {
                "start" => vec![
                    "StartDesktops".into(),
                    "--DesktopId.1".into(),
                    resource.resource_id.clone(),
                ],
                "stop" => vec![
                    "StopDesktops".into(),
                    "--DesktopId.1".into(),
                    resource.resource_id.clone(),
                    "--StoppedMode".into(),
                    "StopCharging".into(),
                ],
                "release" => vec![
                    "DeleteDesktops".into(),
                    "--DesktopId.1".into(),
                    resource.resource_id.clone(),
                ],
                "snapshot" => {
                    let disk = disk_id.as_deref().unwrap_or("");
                    vec![
                        "CreateSnapshot".into(),
                        "--DesktopId".into(),
                        resource.resource_id.clone(),
                        "--SourceDiskType".into(),
                        disk.into(),
                        "--SnapshotName".into(),
                        format!("Lime-{operation_id}"),
                    ]
                }
                _ => unreachable!(),
            }
        } else {
            match action {
                "start" => vec![
                    "StartInstance".into(),
                    "--InstanceId".into(),
                    resource.resource_id.clone(),
                ],
                "stop" => vec![
                    "StopInstance".into(),
                    "--InstanceId".into(),
                    resource.resource_id.clone(),
                    "--StoppedMode".into(),
                    "StopCharging".into(),
                    "--ForceStop".into(),
                    "false".into(),
                ],
                "release" => vec![
                    "DeleteInstance".into(),
                    "--InstanceId".into(),
                    resource.resource_id.clone(),
                    "--Force".into(),
                    "false".into(),
                    "--TerminateSubscription".into(),
                    "false".into(),
                ],
                "snapshot" => vec![
                    "CreateSnapshot".into(),
                    "--DiskId".into(),
                    disk_id.unwrap(),
                    "--ClientToken".into(),
                    operation_id.clone(),
                ],
                _ => unreachable!(),
            }
        };
        match self.call(&resource, &args).await {
            Ok(response) => {
                // API acceptance is not a completed start, compute release or usable snapshot.
                receipt["outcome"] = json!("accepted");
                receipt["requestId"] = json!(response["RequestId"].as_str());
                receipt["snapshotId"] = json!(response["SnapshotId"].as_str());
            }
            Err(error) => receipt["diagnostic"] = json!(error),
        }
        self.finalize_receipt(&operation_id, &receipt);
        Ok(receipt)
    }

    async fn inspect_operation(&self, operation_id: &str) -> Result<Value, String> {
        self.ensure_root()?;
        let receipt = self
            .read_receipt(operation_id)?
            .ok_or("Cloud desktop operation does not exist")?;
        if receipt["request"]["action"] == "purchaseEcs" {
            return self.inspect_ecs_purchase(operation_id).await;
        }
        if receipt["request"]["action"] == "prepareEcsDesktop" {
            return self.inspect_ecs_preparation(operation_id).await;
        }
        if receipt["request"]["action"] == "startEcsRuntimeInstallation" {
            return self.inspect_ecs_runtime_installation(operation_id).await;
        }
        if matches!(
            receipt["request"]["action"].as_str(),
            Some("snapshot" | "restoreSnapshot")
        ) {
            return self.inspect_snapshot_operation(operation_id).await;
        }
        if receipt["request"]["action"] != "release" || receipt["outcome"] == "released" {
            return Ok(receipt);
        }
        self.ensure_root()?;
        let _lock = self.lock_operations()?;
        // Re-read under the lock so another observer cannot be overwritten.
        let mut receipt = self
            .read_receipt(operation_id)?
            .ok_or("Cloud desktop operation does not exist")?;
        let resource: CloudDesktopResource =
            serde_json::from_value(receipt["request"]["resource"].clone())
                .map_err(|_| "Invalid release receipt resource")?;
        validate_resource(&resource)?;
        if receipt["request"]["discardData"] != true {
            return Err("Invalid release receipt confirmation".into());
        }
        let observed = self.inspect(&resource).await?;
        if observed["exists"] == false {
            receipt["outcome"] = json!("released");
            receipt["requiresInspection"] = json!(false);
            receipt["observedAfter"] = observed;
            receipt["verifiedAt"] = json!(chrono::Utc::now().to_rfc3339());
            self.finalize_receipt(operation_id, &receipt);
        }
        Ok(receipt)
    }

    async fn call(
        &self,
        resource: &CloudDesktopResource,
        args: &[String],
    ) -> Result<Value, String> {
        self.call_api(
            resource.provider,
            &resource.region_id,
            &resource.profile,
            args,
        )
        .await
    }

    async fn call_api(
        &self,
        provider: CloudDesktopProvider,
        region: &str,
        profile: &str,
        args: &[String],
    ) -> Result<Value, String> {
        self.call_cli(
            if provider == CloudDesktopProvider::Ecs {
                "ecs"
            } else {
                "ecd"
            },
            if provider == CloudDesktopProvider::Wuying {
                Some("2020-09-30")
            } else {
                None
            },
            region,
            profile,
            args,
        )
        .await
    }

    async fn call_cli(
        &self,
        product: &str,
        version: Option<&str>,
        region: &str,
        profile: &str,
        args: &[String],
    ) -> Result<Value, String> {
        let mut command = Command::new(&self.cli);
        command.arg(product).args(args);
        if let Some(config) = self.alibaba_config(profile)? {
            command.arg("--config-path").arg(config);
            command
                .env_remove("ALIBABA_CLOUD_IGNORE_PROFILE")
                .env_remove("ALIBABACLOUD_IGNORE_PROFILE");
        }
        if let Some(version) = version {
            command.args(["--version", version, "--force"]);
        }
        command
            // OAuth profiles can omit their default region. The CLI validates
            // its global region before forwarding the API's RegionId parameter.
            .args([
                "--region",
                region,
                "--RegionId",
                region,
                "--profile",
                profile,
            ])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        let mut child = command
            .spawn()
            .map_err(|_| "Alibaba CLI unavailable; configure a local least-privilege profile")?;
        let stdout = child
            .stdout
            .take()
            .ok_or("Cannot read Alibaba CLI response")?;
        let stderr = child
            .stderr
            .take()
            .ok_or("Cannot read Alibaba CLI status")?;
        let result = tokio::time::timeout(Duration::from_secs(45), async {
            let mut bytes = Vec::new();
            let mut errors = Vec::new();
            let mut stdout = stdout.take(MAX_PROVIDER_BYTES + 1);
            let mut stderr = stderr.take(16385);
            tokio::try_join!(
                stdout.read_to_end(&mut bytes),
                stderr.read_to_end(&mut errors),
            )
            .map_err(|_| "Cannot read cloud response".to_owned())?;
            if bytes.len() as u64 > MAX_PROVIDER_BYTES || errors.len() > 16384 {
                return Err("Cloud response exceeds size limit".to_owned());
            }
            let status = child
                .wait()
                .await
                .map_err(|_| "Cannot wait for cloud response".to_owned())?;
            if !status.success() {
                return Err(provider_diagnostic(&errors));
            }
            serde_json::from_slice(&bytes).map_err(|_| "Invalid cloud response".to_owned())
        })
        .await
        .map_err(|_| "Cloud request timed out; outcome may be unknown")?;
        result
    }
}

fn missing_resource(resource: &CloudDesktopResource) -> Value {
    json!({ "resource": resource, "status": "NotFound", "exists": false,
        "desktopReady": false, "retainedResourcesMayBeCharged": true })
}

fn has_operation_locks(value: &Value, field: &str) -> Result<bool, String> {
    let Some(locks) = value.get("OperationLocks") else {
        return Ok(false);
    };
    let locks = locks.as_object().ok_or("Invalid cloud operation locks")?;
    match locks.get(field) {
        None => Ok(false),
        Some(value) => value
            .as_array()
            .map(|locks| !locks.is_empty())
            .ok_or_else(|| "Invalid cloud operation lock entries".into()),
    }
}

fn provider_diagnostic(stderr: &[u8]) -> String {
    // CLI messages may contain signed URLs or credentials. Only fixed metadata
    // fields with a restricted alphabet may cross the control-plane boundary.
    let text = String::from_utf8_lossy(stderr);
    let json = serde_json::from_slice::<Value>(stderr).ok();
    let mut fields = Vec::new();
    for (name, keys) in [
        ("ErrorCode", &["ErrorCode", "Code"][..]),
        ("RequestId", &["RequestId"][..]),
    ] {
        let value = keys
            .iter()
            .find_map(|key| {
                json.as_ref()
                    .and_then(|v| v.get(*key))
                    .and_then(Value::as_str)
            })
            .or_else(|| {
                text.lines().find_map(|line| {
                    keys.iter()
                        .find_map(|key| line.trim().strip_prefix(&format!("{key}:")))
                        .map(str::trim)
                })
            });
        if let Some(value) = value.filter(|value| {
            !value.is_empty()
                && value.len() <= 96
                && value
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || b"._-".contains(&byte))
        }) {
            fields.push(format!("{name}={value}"));
        }
    }
    format!(
        "Cloud request failed{}; inspect resource and operation receipt before retrying",
        if fields.is_empty() {
            String::new()
        } else {
            format!(" ({})", fields.join(", "))
        }
    )
}

fn validate_id(value: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > 64
        || !value.as_bytes()[0].is_ascii_alphanumeric()
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"-_".contains(&byte))
    {
        return Err("Invalid cloud resource or operation identifier".into());
    }
    Ok(())
}

fn validate_resource(resource: &CloudDesktopResource) -> Result<(), String> {
    for id in [
        &resource.region_id,
        &resource.resource_id,
        &resource.profile,
    ] {
        validate_id(id)?;
    }
    let prefix = if resource.provider == CloudDesktopProvider::Ecs {
        "i-"
    } else {
        "ecd-"
    };
    if !resource.resource_id.starts_with(prefix) {
        return Err("Unexpected cloud resource ID for provider".into());
    }
    Ok(())
}

fn private_open(path: &Path, create_new: bool) -> Result<File, String> {
    if let Ok(metadata) = fs::symlink_metadata(path) {
        if !metadata.is_file() || metadata.file_type().is_symlink() {
            return Err("Cloud operation path must be a private regular file".into());
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            if metadata.mode() & 0o077 != 0 || metadata.nlink() != 1 {
                return Err("Cloud operation file is not private".into());
            }
        }
    }
    let mut options = OpenOptions::new();
    options
        .read(true)
        .write(true)
        .create(!create_new)
        .create_new(create_new);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options
            .mode(0o600)
            .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK | libc::O_CLOEXEC);
    }
    let file = options
        .open(path)
        .map_err(|_| "Cannot open private cloud operation file")?;
    let metadata = file
        .metadata()
        .map_err(|_| "Cannot inspect opened cloud operation file")?;
    if !metadata.is_file() {
        return Err("Cloud operation file must be regular".into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if metadata.mode() & 0o077 != 0
            || metadata.nlink() != 1
            || metadata.uid() != unsafe { libc::geteuid() }
        {
            return Err("Opened cloud operation file is not private".into());
        }
    }
    Ok(file)
}

mod auth;
mod cloud_assistant;
mod ecs;
mod prepare;
mod purchase;
mod receipts;
mod runtime_install;
mod snapshots;
mod tunnel;
mod wuying;

#[cfg(test)]
mod tests;
