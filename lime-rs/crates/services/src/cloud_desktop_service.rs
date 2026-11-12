//! 用户自付云电脑的生命周期；管理身份保留在本机，OSS 仅向私有传输工具交付短期 STS。
//! 先落 unknown 收据再发送变更；崩溃、超时或重发都不能悄悄重复副作用。

use app_server_protocol::protocol::v2::{
    CloudDesktopParams, CloudDesktopProvider, CloudDesktopResource, CloudDesktopResponse,
    CloudDesktopTunnelChannel,
};
use fs2::FileExt;
use lifecycle::LifecycleChange;
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
            CloudDesktopParams::PrepareEcsPurchase {
                region_id,
                profile,
                operation_id,
                confirmation,
            } => {
                self.prepare_ecs_purchase(&region_id, &profile, &operation_id, &confirmation)
                    .await?
            }
            CloudDesktopParams::ReadEcsPurchasePreparation { region_id, profile } => {
                self.read_ecs_purchase_preparation(&region_id, &profile)
                    .await?
            }
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
                return Err(
                    "Archive transfers require an authenticated App Server connection".into(),
                );
            }
            CloudDesktopParams::CreateArchiveIdentity { identity_file } => {
                tokio::task::spawn_blocking(move || {
                    crate::cloud_archive_service::create_identity(Path::new(&identity_file))
                })
                .await
                .map_err(|_| "Recovery identity worker failed")??
            }
            CloudDesktopParams::RewrapArchiveForRestore {
                archive_path,
                identity_file,
                output_path,
                expected_sha256,
                recipient,
            } => tokio::task::spawn_blocking(move || {
                crate::cloud_archive_service::rewrap_for_restore(
                    Path::new(&archive_path),
                    Path::new(&identity_file),
                    Path::new(&output_path),
                    &expected_sha256,
                    &recipient,
                )
            })
            .await
            .map_err(|_| "Cloud restore worker failed")??,
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
            CloudDesktopParams::ListOssBuckets { profile, region_id } => {
                self.list_oss_buckets(&profile, &region_id).await?
            }
            CloudDesktopParams::TransferOssArchive {
                profile,
                region_id,
                bucket,
                object_key,
                local_path,
                upload,
                expected_sha256,
            } => {
                self.transfer_oss_archive(
                    &profile,
                    &region_id,
                    &bucket,
                    &object_key,
                    Path::new(&local_path),
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
            CloudDesktopParams::ReconnectEcsRuntime {
                resource,
                operation_id,
                capability_sha256,
                confirmation,
                work_saved,
            } => {
                self.reconnect_ecs_runtime(
                    resource,
                    operation_id,
                    capability_sha256,
                    confirmation,
                    work_saved,
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
            CloudDesktopParams::CreateEcsImage {
                snapshot_operation_id,
                operation_id,
                confirmation,
                include_credentials,
            } => {
                self.create_ecs_image(
                    &snapshot_operation_id,
                    &operation_id,
                    &confirmation,
                    include_credentials,
                )
                .await?
            }
            CloudDesktopParams::ListEcsImages { region_id, profile } => {
                self.list_ecs_images(&region_id, &profile).await?
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
                self.mutate(
                    resource,
                    operation_id,
                    confirmation,
                    LifecycleChange::Start,
                    true,
                )
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
                    LifecycleChange::Stop,
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
                image_operation_id,
            } => {
                if !discard_data {
                    return Err("Release requires explicit disk data discard".into());
                }
                self.mutate(
                    resource,
                    operation_id,
                    confirmation,
                    LifecycleChange::Release(image_operation_id),
                    work_saved,
                )
                .await?
            }
            CloudDesktopParams::ScheduleEcsRelease {
                resource,
                operation_id,
                image_operation_id,
                release_at,
                confirmation,
                work_saved,
                discard_data,
            } => {
                self.schedule_ecs_release(
                    resource,
                    operation_id,
                    image_operation_id,
                    release_at,
                    confirmation,
                    work_saved,
                    discard_data,
                )
                .await?
            }
            CloudDesktopParams::CancelEcsRelease {
                resource,
                operation_id,
                release_at,
                confirmation,
            } => {
                self.cancel_ecs_release(resource, operation_id, release_at, confirmation)
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
                    LifecycleChange::Snapshot(disk_id),
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
        let auto_release_time = scheduled_release::auto_release_time(instance)?;
        Ok(json!({
            "resource": resource, "name": instance["InstanceName"].as_str(), "status": status, "stoppedMode": mode,
            "instanceChargeType": instance["InstanceChargeType"].as_str(),
            "instanceType": instance["InstanceType"].as_str(),
            "operationBlocked": operation_blocked,
            "autoReleaseTime": auto_release_time,
            "computeReleased": status == "Stopped" && mode == Some("StopCharging"),
            "retainedResourcesMayBeCharged": true,
            "desktopReady": false,
        }))
    }

    async fn inspect_operation(&self, operation_id: &str) -> Result<Value, String> {
        self.ensure_root()?;
        let receipt = self
            .read_receipt(operation_id)?
            .ok_or("Cloud desktop operation does not exist")?;
        if matches!(
            receipt["request"]["action"].as_str(),
            Some("scheduleEcsRelease" | "cancelEcsRelease")
        ) {
            return self.inspect_ecs_release_schedule(operation_id).await;
        }
        if receipt["request"]["action"] == "createEcsImage" {
            return self.inspect_ecs_image_operation(operation_id).await;
        }
        if receipt["request"]["action"] == "purchaseEcs" {
            return self.inspect_ecs_purchase(operation_id).await;
        }
        if receipt["request"]["action"] == "prepareEcsPurchase" {
            return self.inspect_ecs_purchase_preparation(operation_id).await;
        }
        if receipt["request"]["action"] == "prepareEcsDesktop" {
            return self.inspect_ecs_preparation(operation_id).await;
        }
        if matches!(
            receipt["request"]["action"].as_str(),
            Some("startEcsRuntimeInstallation" | "reconnectEcsRuntime")
        ) {
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
        self.execute_cli(
            product,
            version,
            region,
            profile,
            args,
            self.alibaba_config(profile)?,
        )
        .await
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
        ("ErrorCode", &["ErrorCode", "Code", "error_code"][..]),
        ("RequestId", &["RequestId", "request_id"][..]),
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
mod images;
mod lifecycle;
mod oss;
mod prepare;
mod purchase;
mod receipts;
mod runtime_install;
mod scheduled_release;
mod snapshots;
mod tunnel;
mod wuying;

#[cfg(test)]
mod tests;
