//! Drains asynchronous authentication before releasing its context and lifecycle lock.

use crate::UserVerificationError;
use crate::UserVerificationFailureReason;
use crate::UserVerificationRequestGuard;
use std::sync::mpsc;
use std::time::Duration;

pub(crate) fn wait_with_cancellation<T>(
    guard: &UserVerificationRequestGuard,
    completion: mpsc::Receiver<Result<T, UserVerificationError>>,
    cancel: impl FnOnce(),
) -> Result<T, UserVerificationError> {
    let result = loop {
        match completion.recv_timeout(Duration::from_millis(/*millis*/ 50)) {
            Ok(result) => break result,
            Err(mpsc::RecvTimeoutError::Timeout) => {
                if !guard.is_active() {
                    cancel();
                    // Invalidation is asynchronous. Keep the lifecycle lock until the
                    // authentication callback completes, then reject any late success.
                    break completion
                        .recv()
                        .unwrap_or_else(|_| Err(completion_error()));
                }
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => break Err(completion_error()),
        }
    };
    guard.check()?;
    result
}

fn completion_error() -> UserVerificationError {
    UserVerificationError::Failed {
        reason: UserVerificationFailureReason::ProviderError,
        message: "the user-verification authorization could not complete".to_string(),
    }
}

#[cfg(test)]
#[path = "native_operation_tests.rs"]
mod tests;
