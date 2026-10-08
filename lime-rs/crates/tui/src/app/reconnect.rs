//! App Server reconnection lifecycle for the TUI app.
//!
//! The reconnect owner lives under `app/` to match Codex. Transport creation remains delegated
//! to the shared runtime boundary; this module only restores the canonical thread session and
//! its server-backed settings.

use std::path::PathBuf;
use std::time::Duration;

use anyhow::{bail, Result};
use app_server_protocol::protocol::v2::Thread;

use crate::app_server_session::{AppServerSession, InitialHistoryPage, ThreadSettingsPatch};
use crate::runtime::{connect_session, TuiOptions};

const RECONNECT_DELAYS: [Duration; 4] = [
    Duration::ZERO,
    Duration::from_millis(100),
    Duration::from_millis(300),
    Duration::from_secs(1),
];

/// A successfully reattached App Server session and its canonical thread snapshot.
pub(crate) struct ReconnectedSession {
    pub(crate) session: AppServerSession,
    pub(crate) thread: Thread,
    pub(crate) cwd: PathBuf,
    pub(crate) history_page: InitialHistoryPage,
    pub(crate) scrollback_has_older_history: bool,
    pub(crate) permission_profiles: Vec<String>,
}

pub(crate) async fn reconnect_session(
    options: TuiOptions,
    thread_id: String,
    settings: ThreadSettingsPatch,
) -> Result<ReconnectedSession> {
    let mut last_error = None;
    for delay in RECONNECT_DELAYS {
        if !delay.is_zero() {
            tokio::time::sleep(delay).await;
        }
        let mut candidate = match connect_session(&options).await {
            Ok(session) => session,
            Err(error) => {
                last_error = Some(error);
                continue;
            }
        };
        match candidate.resume_thread(thread_id.clone()).await {
            Ok(response) => {
                let cwd = PathBuf::from(&response.cwd);
                let thread_id_for_history = response.thread.id.clone();
                let history_page = match candidate
                    .hydrate_initial_thread_history(
                        thread_id_for_history.clone(),
                        response.items_backwards_cursor.clone(),
                    )
                    .await
                {
                    Ok(page) => page,
                    Err(error) => {
                        let _ = candidate.shutdown().await;
                        last_error = Some(error);
                        continue;
                    }
                };
                let scrollback_has_older_history =
                    candidate.has_older_history(&thread_id_for_history);
                let permission_profiles = candidate
                    .list_permission_profiles(Some(response.cwd.clone()))
                    .await;
                let permission_profiles = match permission_profiles {
                    Ok(response) => response,
                    Err(error) => {
                        let _ = candidate.shutdown().await;
                        last_error = Some(error);
                        continue;
                    }
                };
                if let Err(error) = candidate
                    .update_settings_with_policy(settings.clone())
                    .await
                {
                    let _ = candidate.shutdown().await;
                    last_error = Some(error);
                    continue;
                }
                return Ok(ReconnectedSession {
                    session: candidate,
                    thread: response.thread,
                    cwd,
                    history_page,
                    scrollback_has_older_history,
                    permission_profiles: permission_profiles
                        .data
                        .into_iter()
                        .filter(|profile| profile.allowed)
                        .map(|profile| profile.id)
                        .collect(),
                });
            }
            Err(error) => {
                let _ = candidate.shutdown().await;
                last_error = Some(error);
            }
        }
    }
    let _ = last_error;
    bail!("server connection could not be restored")
}
