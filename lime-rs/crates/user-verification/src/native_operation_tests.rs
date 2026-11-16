//! Exercises cancellation completion and late-result rejection without biometric hardware.

use super::*;
use crate::UserVerificationCancellationReason;
use pretty_assertions::assert_eq;
use std::sync::atomic::AtomicBool;
use std::sync::atomic::Ordering;

#[test]
fn cancellation_waits_for_completion_on_the_context_owner_thread() {
    let guard = UserVerificationRequestGuard::default();
    let queued = guard.clone();
    let (done_tx, done_rx) = mpsc::sync_channel(0);
    let (cancelled_tx, cancelled_rx) = mpsc::channel();
    let owner = std::thread::spawn(move || {
        let owner_thread = std::thread::current().id();
        wait_with_cancellation(&queued, done_rx, || {
            assert_eq!(std::thread::current().id(), owner_thread);
            cancelled_tx.send(()).expect("dismiss authentication");
        })
    });
    guard.cancel();
    cancelled_rx
        .recv_timeout(Duration::from_secs(/*secs*/ 5))
        .expect("authentication invalidated");
    assert!(!owner.is_finished());
    done_tx
        .send(Ok("late authorization"))
        .expect("complete authentication");
    assert_eq!(
        owner.join().expect("owner returned"),
        Err(UserVerificationError::Cancelled {
            reason: UserVerificationCancellationReason::Interrupted,
            message: "the verification operation is no longer active".to_string(),
        })
    );
}

#[test]
fn completed_operation_does_not_cancel_its_context() {
    let cancelled = AtomicBool::new(/*v*/ false);
    let (done_tx, done_rx) = mpsc::channel();
    done_tx
        .send(Ok("authorization"))
        .expect("complete authentication");
    assert_eq!(
        wait_with_cancellation(&UserVerificationRequestGuard::default(), done_rx, || {
            cancelled.store(/*val*/ true, Ordering::Release)
        },),
        Ok("authorization")
    );
    assert!(!cancelled.load(Ordering::Acquire));
}

#[test]
fn cancellation_rejects_already_completed_authorization() {
    let guard = UserVerificationRequestGuard::default();
    let (done_tx, done_rx) = mpsc::channel();
    done_tx.send(Ok(())).expect("complete authentication");
    guard.cancel();
    assert_eq!(
        wait_with_cancellation(&guard, done_rx, || panic!(
            "authentication already completed"
        )),
        Err(UserVerificationError::Cancelled {
            reason: UserVerificationCancellationReason::Interrupted,
            message: "the verification operation is no longer active".to_string(),
        })
    );
}
