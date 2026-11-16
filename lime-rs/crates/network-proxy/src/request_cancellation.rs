//! Records why a policy request was withdrawn before its decision future is dropped.

use std::sync::Arc;
use std::sync::OnceLock;

/// The controller's first known reason for withdrawing a policy request.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum NetworkRequestCancellationReason {
    /// The process exited and its output streams closed normally.
    ProcessFinished,
    /// The process was explicitly terminated or its handle was abandoned.
    ProcessCancelled,
    /// The connection to the executor was lost.
    ConnectionClosed,
    /// The policy decision deadline expired.
    TimedOut,
}

/// Shared, in-process metadata; recording a reason does not authorize network access.
#[derive(Clone, Debug, Default)]
pub struct NetworkRequestCancellation(Arc<OnceLock<NetworkRequestCancellationReason>>);

impl NetworkRequestCancellation {
    pub fn reason(&self) -> Option<NetworkRequestCancellationReason> {
        self.0.get().copied()
    }

    /// Publish before dropping the decision future. Cleanup cannot replace an earlier cause.
    pub fn record(&self, reason: NetworkRequestCancellationReason) {
        let _ = self.0.set(reason);
    }
}
