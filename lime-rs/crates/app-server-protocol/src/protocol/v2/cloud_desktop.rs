use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// User-owned ECS resource. Credentials stay in the local Alibaba CLI profile.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CloudDesktopResource {
    pub provider: CloudDesktopProvider,
    pub region_id: String,
    pub resource_id: String,
    pub profile: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum CloudDesktopProvider {
    Ecs,
    Wuying,
}

/// Fixed loopback services in the user's persistent Linux desktop.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum CloudDesktopTunnelChannel {
    AppServer,
    Desktop,
    Installation,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WuyingDesktopSpec {
    pub region_id: String,
    pub profile: String,
    pub office_site_id: String,
    pub end_user_id: String,
    pub policy_group_id: String,
    pub desktop_type: String,
    pub image_id: String,
    pub system_disk_gib: u32,
    pub data_disk_gib: u32,
}

/// One user-paid Linux VM. Network may be prepared by Lime; SSH keypair is optional.
/// Purchase always requests an encrypted ESSD system disk; no private key is sent.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EcsDesktopSpec {
    pub region_id: String,
    pub profile: String,
    pub v_switch_id: String,
    pub security_group_id: String,
    pub key_pair_name: String,
    pub instance_type: String,
    pub image_id: String,
    pub system_disk_gib: u32,
    pub outbound_mbps: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(
    tag = "action",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum CloudDesktopParams {
    ConnectAlibaba {
        region_id: String,
    },
    ReadAlibabaConnection {},
    ListResources {},
    Bind {
        resource: CloudDesktopResource,
    },
    QuoteWuying {
        spec: WuyingDesktopSpec,
    },
    PurchaseWuying {
        spec: WuyingDesktopSpec,
        desktop_name: String,
        operation_id: String,
        quote_id: String,
        confirmation: String,
    },
    QuoteEcs {
        spec: EcsDesktopSpec,
    },
    /// Read the original preparation, or explicitly authorize a network-only ROS stack.
    /// No compute purchase occurs here. Unknown submissions are only inspected.
    PrepareEcsPurchase {
        region_id: String,
        profile: String,
        operation_id: String,
        confirmation: String,
    },
    /// Find and inspect the durable preparation for this account profile and region.
    ReadEcsPurchasePreparation {
        region_id: String,
        profile: String,
    },
    ListEcsTemplates {
        region_id: String,
        profile: String,
    },
    QuoteEcsTemplate {
        region_id: String,
        profile: String,
        launch_template_id: String,
        version: u32,
    },
    PurchaseEcs {
        spec: EcsDesktopSpec,
        desktop_name: String,
        operation_id: String,
        quote_id: String,
        confirmation: String,
    },
    ExportArchive {
        source_root: String,
        paths: Vec<String>,
        output_path: String,
        recipient: String,
        include_credentials: bool,
        work_saved: bool,
    },
    /// Stage selected files as age ciphertext for this authenticated connection.
    PrepareArchiveDownload {
        source_root: String,
        paths: Vec<String>,
        recipient: String,
        include_credentials: bool,
        work_saved: bool,
    },
    ReadArchiveDownload {
        archive_id: String,
        offset: u64,
    },
    CloseArchiveDownload {
        archive_id: String,
    },
    /// Generate a short-lived recipient on the destination desktop.
    BeginArchiveRestore {
        folder_name: String,
    },
    WriteArchiveRestore {
        archive_id: String,
        offset: u64,
        data: String,
    },
    FinishArchiveRestore {
        archive_id: String,
        sha256: String,
        bytes: u64,
    },
    CancelArchiveRestore {
        archive_id: String,
    },
    /// Local control only; writes a new private file and returns only its public recipient.
    CreateArchiveIdentity {
        identity_file: String,
    },
    /// Local control only; the source recovery key never crosses the desktop connection.
    RewrapArchiveForRestore {
        archive_path: String,
        identity_file: String,
        output_path: String,
        expected_sha256: String,
        recipient: String,
    },
    /// Restore only into a new directory. Identity is read locally, never sent as JSON.
    RestoreArchive {
        archive_path: String,
        identity_file: String,
        destination: String,
        expected_sha256: String,
        max_bytes: u64,
    },
    TransferArchive {
        local_path: String,
        remote: String,
        upload: bool,
        expected_sha256: String,
    },
    /// Local control only; reuses the user's managed Alibaba browser identity.
    ListOssBuckets {
        profile: String,
        region_id: String,
    },
    TransferOssArchive {
        profile: String,
        region_id: String,
        bucket: String,
        object_key: String,
        local_path: String,
        upload: bool,
        expected_sha256: String,
    },
    Inspect {
        resource: CloudDesktopResource,
    },
    /// Start an in-memory loopback tunnel; no supplier session credential is returned.
    OpenEcsTunnel {
        resource: CloudDesktopResource,
        channel: CloudDesktopTunnelChannel,
    },
    ReadEcsTunnel {
        resource: CloudDesktopResource,
        channel: CloudDesktopTunnelChannel,
    },
    CloseEcsTunnel {
        resource: CloudDesktopResource,
        channel: CloudDesktopTunnelChannel,
    },
    /// Install fixed desktop dependencies through the user's ECS Cloud Assistant.
    /// This does not install the Lime runtime or expose a remote listener.
    PrepareEcsDesktop {
        resource: CloudDesktopResource,
        operation_id: String,
        confirmation: String,
        install_system_packages: bool,
    },
    /// Start a bounded, unprivileged runtime upload service using fixed Cloud Assistant code.
    /// Only capability and artifact digests cross this management boundary.
    StartEcsRuntimeInstallation {
        resource: CloudDesktopResource,
        operation_id: String,
        archive_sha256: String,
        manifest_sha256: String,
        archive_bytes: u64,
        capability_sha256: String,
        confirmation: String,
        create_desktop_user: bool,
    },
    /// Rebuild credentials for an existing managed guest without uploading a runtime.
    /// Credentials remain on the pinned TLS channel, never the management receipt.
    ReconnectEcsRuntime {
        resource: CloudDesktopResource,
        operation_id: String,
        capability_sha256: String,
        confirmation: String,
        work_saved: bool,
    },
    Start {
        resource: CloudDesktopResource,
        operation_id: String,
        confirmation: String,
    },
    /// StopCharging requests compute release; inspect must verify the actual mode.
    Stop {
        resource: CloudDesktopResource,
        operation_id: String,
        confirmation: String,
        work_saved: bool,
    },
    /// User-confirmed provider deadline, protected by an exact private image.
    /// The provider executes even when Lime is closed or the instance is running.
    ScheduleEcsRelease {
        resource: CloudDesktopResource,
        operation_id: String,
        image_operation_id: String,
        release_at: String,
        confirmation: String,
        work_saved: bool,
        discard_data: bool,
    },
    /// Cancel only the exact observed deadline, then inspect the original receipt.
    CancelEcsRelease {
        resource: CloudDesktopResource,
        operation_id: String,
        release_at: String,
        confirmation: String,
    },
    /// Release a stopped PostPaid desktop; disks follow the provider's deletion policy.
    Release {
        resource: CloudDesktopResource,
        operation_id: String,
        confirmation: String,
        work_saved: bool,
        discard_data: bool,
        /// Retain and freshly verify this exact private system image before releasing the source.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        image_operation_id: Option<String>,
    },
    Snapshot {
        resource: CloudDesktopResource,
        operation_id: String,
        confirmation: String,
        disk_id: String,
        work_saved: bool,
    },
    InspectSnapshot {
        resource: CloudDesktopResource,
        disk_id: String,
        snapshot_id: String,
    },
    /// Preserve the entire encrypted system snapshot, including login state, as a private image.
    /// The source must be a completed local cold-snapshot operation.
    CreateEcsImage {
        snapshot_operation_id: String,
        operation_id: String,
        confirmation: String,
        include_credentials: bool,
    },
    /// Local control only; lists owned system images without requiring the original VM or disk.
    ListEcsImages {
        region_id: String,
        profile: String,
    },
    /// Roll back the original disk of a stopped desktop; later writes are lost.
    RestoreSnapshot {
        resource: CloudDesktopResource,
        disk_id: String,
        snapshot_id: String,
        operation_id: String,
        confirmation: String,
        work_saved: bool,
        discard_changes: bool,
    },
    /// Records explicit user validation after restarting and checking applications.
    VerifySnapshotRestore {
        operation_id: String,
        confirmation: String,
        applications_validated: bool,
    },
    ReadOperation {
        operation_id: String,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CloudDesktopResponse {
    /// Sanitized provider state or a durable operation receipt; never CLI credentials.
    pub data: serde_json::Value,
}
