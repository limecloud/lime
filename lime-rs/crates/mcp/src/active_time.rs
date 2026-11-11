//! Connection-local active-time accounting for MCP operations.
//!
//! Adapted from upstream commit `68a1d82a413630892b64258fd3e79786fc419312`
//! (`fix(mcp) pause timer for elicitations (#17566)`).

use std::future::Future;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use tokio::sync::watch;
use tokio::time;

#[derive(Clone)]
pub(crate) struct ElicitationPauseState {
    active_count: Arc<AtomicUsize>,
    paused: watch::Sender<bool>,
}

impl ElicitationPauseState {
    pub(crate) fn new() -> Self {
        let (paused, _receiver) = watch::channel(false);
        Self {
            active_count: Arc::new(AtomicUsize::new(0)),
            paused,
        }
    }

    pub(crate) fn enter(&self) -> ElicitationPauseGuard {
        if self.active_count.fetch_add(1, Ordering::AcqRel) == 0 {
            self.paused.send_replace(true);
        }
        ElicitationPauseGuard {
            pause_state: self.clone(),
        }
    }

    pub(crate) fn subscribe(&self) -> watch::Receiver<bool> {
        self.paused.subscribe()
    }
}

pub(crate) struct ElicitationPauseGuard {
    pause_state: ElicitationPauseState,
}

impl Drop for ElicitationPauseGuard {
    fn drop(&mut self) {
        if self.pause_state.active_count.fetch_sub(1, Ordering::AcqRel) == 1 {
            self.pause_state.paused.send_replace(false);
        }
    }
}

pub(crate) async fn active_time_timeout<T, Fut>(
    duration: Duration,
    mut pause_state: watch::Receiver<bool>,
    operation: Fut,
) -> Result<T, ()>
where
    Fut: Future<Output = T>,
{
    let mut remaining = duration;
    tokio::pin!(operation);

    loop {
        if *pause_state.borrow_and_update() {
            tokio::select! {
                result = &mut operation => return Ok(result),
                changed = pause_state.changed() => {
                    if changed.is_err() {
                        return time::timeout(remaining, operation).await.map_err(|_| ());
                    }
                    let _paused = *pause_state.borrow_and_update();
                }
            }
            continue;
        }

        let active_start = Instant::now();
        tokio::select! {
            result = &mut operation => return Ok(result),
            _ = time::sleep(remaining) => return Err(()),
            changed = pause_state.changed() => {
                if changed.is_err() {
                    return time::timeout(remaining, operation).await.map_err(|_| ());
                }
                if *pause_state.borrow_and_update() {
                    remaining = remaining.saturating_sub(active_start.elapsed());
                    if remaining.is_zero() {
                        return Err(());
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn active_time_timeout_pauses_while_elicitation_is_pending() {
        let pause_state = ElicitationPauseState::new();
        let pause = pause_state.enter();
        tokio::spawn(async move {
            time::sleep(Duration::from_millis(75)).await;
            drop(pause);
        });

        let result =
            active_time_timeout(Duration::from_millis(50), pause_state.subscribe(), async {
                time::sleep(Duration::from_millis(90)).await;
                "done"
            })
            .await;

        assert_eq!(Ok("done"), result);
    }

    #[tokio::test]
    async fn overlapping_elicitations_keep_active_time_paused_until_all_finish() {
        let pause_state = ElicitationPauseState::new();
        let first = pause_state.enter();
        let second = pause_state.enter();
        let mut paused = pause_state.subscribe();

        assert!(*paused.borrow_and_update());
        drop(first);
        assert!(*paused.borrow_and_update());
        drop(second);
        paused.changed().await.expect("pause state remains open");
        assert!(!*paused.borrow_and_update());
    }

    #[tokio::test]
    async fn active_time_timeout_resumes_with_remaining_budget() {
        let pause_state = ElicitationPauseState::new();
        let controller = pause_state.clone();
        tokio::spawn(async move {
            time::sleep(Duration::from_millis(20)).await;
            let pause = controller.enter();
            time::sleep(Duration::from_millis(80)).await;
            drop(pause);
        });

        let started = Instant::now();
        let result = active_time_timeout(
            Duration::from_millis(60),
            pause_state.subscribe(),
            std::future::pending::<()>(),
        )
        .await;

        assert_eq!(Err(()), result);
        assert!(started.elapsed() >= Duration::from_millis(120));
    }
}
