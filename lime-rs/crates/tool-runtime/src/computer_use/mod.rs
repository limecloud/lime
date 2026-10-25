//! Shared adapter admission. Private upstream native implementations are unavailable;
//! this module adapts the observed contract to Lime's existing tool owner.

mod action;
mod broker;
mod document_host;
mod executor;
mod extension;
mod extension_host;
mod installation;
mod mailbox;
mod native;
mod native_host;
mod native_resources;
mod office;
mod policy;
mod state;
#[cfg(test)]
mod tests;
mod tool_schema;

pub use action::{ComputerUseAction, MouseButton, TabMark};
use app_server_protocol::protocol::v2::*;
use async_trait::async_trait;
pub use document_host::run_document_host;
pub use executor::{
    computer_use_tool_definition, runtime_computer_use_executor_handle, ComputerUseGateway,
    ComputerUseToolInput, ComputerUseToolScope, COMPUTER_USE_TOOL_NAME,
};
pub use extension::ExtensionAdapter;
pub use extension_host::{run_native_messaging_host, CHROME_EXTENSION_ORIGIN};
pub use native::NativeAdapter;
pub use office::OfficeAdapter;
pub use policy::{ComputerUsePolicy, NativeAppIdentity};
pub use state::{ComputerUseLease, ComputerUseService};

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ComputerUseTarget {
    pub identity: ComputerUseTargetIdentity,
    pub native_app: Option<NativeAppIdentity>,
    pub capabilities: Vec<ComputerUseCapability>,
    pub locked: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ComputerUseSnapshot {
    /// Must advance on reconnect, existing-document changes or consent expiry.
    /// Chrome may discover additional targets within a stable generation.
    pub generation: u64,
    pub readiness: ComputerUseReadiness,
    pub targets: Vec<ComputerUseTarget>,
    pub reason: Option<String>,
    pub setup_steps: Vec<String>,
}

#[derive(Clone, Debug, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ComputerUseSetupOutcome {
    pub accepted: bool,
    /// Adapter-observed consent; a client request is never evidence of approval.
    pub approved_target: Option<ComputerUseTargetIdentity>,
    pub generation: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ComputerUseOwner {
    pub connection: String,
    pub thread_id: String,
    pub turn_id: String,
}

#[derive(Debug, Clone)]
pub struct ComputerUseError(pub String);

impl std::fmt::Display for ComputerUseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}
impl std::error::Error for ComputerUseError {}

#[async_trait]
pub trait ComputerUseAdapter: Send + Sync {
    fn kind(&self) -> ComputerUseAdapterKind;
    /// Trusted terminal hook. This releases task presentation state, never grants access.
    fn finish_turn(&self, _owner: &ComputerUseOwner) {}
    async fn snapshot(&self) -> Result<ComputerUseSnapshot, ComputerUseError>;
    async fn setup(
        &self,
        params: &ComputerUseSetupParams,
    ) -> Result<ComputerUseSetupOutcome, ComputerUseError>;
    async fn execute(
        &self,
        _lease: &ComputerUseLease,
        _action: ComputerUseAction,
        _cancel: tokio_util::sync::CancellationToken,
    ) -> ComputerUseResult<serde_json::Value> {
        Err(denied("This adapter does not implement action execution"))
    }
}

// A stable generation certifies that no existing approved document navigated or
// reloaded. Additions never confer authority on the newly discovered targets.
fn chrome_target_addition(previous: &ComputerUseSnapshot, next: &ComputerUseSnapshot) -> bool {
    previous.generation == next.generation
        && previous.readiness == ComputerUseReadiness::Ready
        && next.readiness == ComputerUseReadiness::Ready
        && previous.reason == next.reason
        && previous.setup_steps == next.setup_steps
        && next.targets.len() > previous.targets.len()
        && previous
            .targets
            .iter()
            .all(|target| next.targets.contains(target))
        && next.targets.iter().enumerate().all(|(index, target)| {
            matches!(target.identity, ComputerUseTargetIdentity::Chrome { .. })
                && !next.targets[..index]
                    .iter()
                    .any(|other| same_target(&target.identity, &other.identity))
        })
}

pub type ComputerUseResult<T> = Result<T, ComputerUseError>;

fn denied(message: impl Into<String>) -> ComputerUseError {
    ComputerUseError(message.into())
}

fn same_target(left: &ComputerUseTargetIdentity, right: &ComputerUseTargetIdentity) -> bool {
    match (left, right) {
        (
            ComputerUseTargetIdentity::Native {
                app_id: a,
                process_id: p,
                window_id: w,
                ..
            },
            ComputerUseTargetIdentity::Native {
                app_id: b,
                process_id: q,
                window_id: x,
                ..
            },
        ) => {
            a == b
                && p == q
                && w == x
                && !a.is_empty()
                && p.is_some_and(|id| id > 0)
                && w.as_ref().is_some_and(|id| !id.is_empty())
        }
        (
            ComputerUseTargetIdentity::Chrome {
                origin: a,
                profile_id: p,
                tab_id: t,
                ..
            },
            ComputerUseTargetIdentity::Chrome {
                origin: b,
                profile_id: q,
                tab_id: u,
                ..
            },
        ) => a == b && p == q && t == u && !a.is_empty() && !p.is_empty() && !t.is_empty(),
        (
            ComputerUseTargetIdentity::Office {
                host: a,
                workbook_id: w,
                session_id: s,
                ..
            },
            ComputerUseTargetIdentity::Office {
                host: b,
                workbook_id: x,
                session_id: t,
                ..
            },
        ) => a == b && w == x && s == t && !a.is_empty() && !w.is_empty() && !s.is_empty(),
        _ => false,
    }
}
