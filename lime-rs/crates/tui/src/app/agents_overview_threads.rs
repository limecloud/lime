//! App Server thread refresh for Agents Overview.

use super::App;
use crate::app_server_session::AppServerSession;
use anyhow::{Context, Result};
use app_server_protocol::protocol::v2::{
    ServerNotification, SortDirection, ThreadListParams, ThreadSortKey, ThreadStatus,
};

impl App {
    pub(crate) fn track_agents_overview_notification(&mut self, notification: &ServerNotification) {
        let primary = self.primary_thread_id.clone();
        let Some(overview) = self.agents_overview.as_mut() else {
            return;
        };
        let thread_id = match notification {
            ServerNotification::ThreadStarted(params) => Some(params.thread.id.as_str()),
            ServerNotification::ThreadArchived(params) => Some(params.thread_id.as_str()),
            ServerNotification::ThreadDeleted(params) => Some(params.thread_id.as_str()),
            ServerNotification::ThreadClosed(params) => Some(params.thread_id.as_str()),
            ServerNotification::ThreadStatusChanged(params) => Some(params.thread_id.as_str()),
            ServerNotification::ThreadNameUpdated(params) => Some(params.thread_id.as_str()),
            _ => None,
        };
        match notification {
            ServerNotification::ThreadStarted(params) if !params.thread.ephemeral => {
                if let Some(existing) = overview
                    .threads
                    .iter_mut()
                    .find(|thread| thread.id == params.thread.id)
                {
                    *existing = params.thread.clone();
                } else {
                    overview.threads.push(params.thread.clone());
                }
            }
            ServerNotification::ThreadArchived(params) => {
                overview
                    .threads
                    .retain(|thread| thread.id != params.thread_id);
            }
            ServerNotification::ThreadDeleted(params) => {
                overview
                    .threads
                    .retain(|thread| thread.id != params.thread_id);
            }
            ServerNotification::ThreadClosed(params) => {
                if let Some(thread) = overview
                    .threads
                    .iter_mut()
                    .find(|thread| thread.id == params.thread_id)
                {
                    thread.status = ThreadStatus::NotLoaded;
                }
            }
            ServerNotification::ThreadStatusChanged(params) => {
                if let Some(thread) = overview
                    .threads
                    .iter_mut()
                    .find(|thread| thread.id == params.thread_id)
                {
                    thread.status = params.status.clone();
                }
            }
            ServerNotification::ThreadNameUpdated(params) => {
                if let Some(thread) = overview
                    .threads
                    .iter_mut()
                    .find(|thread| thread.id == params.thread_id)
                {
                    thread.name = params.thread_name.clone();
                }
            }
            _ => return,
        }
        if let Some(thread_id) = thread_id.filter(|_| overview.refreshing || overview.loading_more)
        {
            let pending = overview
                .refresh_notifications
                .entry(thread_id.to_string())
                .or_default();
            pending.retain(|previous| {
                std::mem::discriminant(previous) != std::mem::discriminant(notification)
            });
            pending.push(notification.clone());
        }
        overview
            .view
            .update_rows(super::agents_overview::build_rows(
                &overview.threads,
                primary.as_deref(),
            ));
    }

    pub(crate) async fn refresh_agents_overview_threads(
        &mut self,
        app_server: &AppServerSession,
    ) -> Result<()> {
        let Some(overview) = self.agents_overview.as_mut() else {
            return Ok(());
        };
        if overview.refreshing || overview.loading_more {
            overview.refresh_pending = true;
            return Ok(());
        }
        let generation = overview.begin_refresh();
        overview.sync_pagination();
        let result = async {
            let page = app_server
                .thread_list(ThreadListParams {
                    cursor: None,
                    limit: Some(100),
                    sort_key: Some(ThreadSortKey::RecencyAt),
                    sort_direction: Some(SortDirection::Desc),
                    archived: Some(false),
                    ..ThreadListParams::default()
                })
                .await
                .context("failed to refresh agents overview threads")?;
            Ok::<_, anyhow::Error>((page.data, page.next_cursor))
        }
        .await;
        match result {
            Ok((threads, next_cursor)) => {
                let primary = self.primary_thread_id.clone();
                if let Some(overview) = self.agents_overview.as_mut() {
                    overview.apply_refresh_page(
                        generation,
                        threads,
                        next_cursor,
                        primary.as_deref(),
                    );
                }
                let buffered = self
                    .agents_overview
                    .as_mut()
                    .map(|overview| {
                        overview
                            .refresh_notifications
                            .drain()
                            .flat_map(|(_, notifications)| notifications)
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default();
                for notification in buffered {
                    self.track_agents_overview_notification(&notification);
                }
                let refresh_pending = self
                    .agents_overview
                    .as_mut()
                    .is_some_and(|overview| overview.take_refresh_pending());
                self.projection.set_status("agents overview refreshed");
                if refresh_pending {
                    Box::pin(self.refresh_agents_overview_threads(app_server)).await?;
                }
                Ok(())
            }
            Err(error) => {
                if let Some(overview) = self.agents_overview.as_mut() {
                    overview.refreshing = false;
                    overview.sync_pagination();
                }
                self.projection
                    .set_status(format!("agents overview unavailable: {error}"));
                Err(error)
            }
        }
    }

    pub(crate) async fn load_more_agents_overview_threads(
        &mut self,
        app_server: &AppServerSession,
    ) -> Result<()> {
        let Some(overview) = self.agents_overview.as_mut() else {
            return Ok(());
        };
        let Some(cursor) = overview.begin_load_more() else {
            return Ok(());
        };
        let result = app_server
            .thread_list(ThreadListParams {
                cursor: Some(cursor.clone()),
                limit: Some(100),
                sort_key: Some(ThreadSortKey::RecencyAt),
                sort_direction: Some(SortDirection::Desc),
                archived: Some(false),
                ..ThreadListParams::default()
            })
            .await
            .context("failed to load more agents overview threads");
        match result {
            Ok(page) => {
                let repeated_cursor = self.agents_overview.as_ref().is_some_and(|overview| {
                    overview.next_cursor_is_repeated(page.next_cursor.as_deref())
                });
                if repeated_cursor {
                    let error =
                        anyhow::anyhow!("agents overview thread list repeated cursor {cursor}");
                    if let Some(overview) = self.agents_overview.as_mut() {
                        overview.fail_load_more();
                    }
                    self.projection
                        .set_status(format!("agents overview unavailable: {error}"));
                    return Err(error);
                }
                let primary = self.primary_thread_id.clone();
                if let Some(overview) = self.agents_overview.as_mut() {
                    overview.apply_load_more(page.data, page.next_cursor, primary.as_deref());
                }
                let buffered = self
                    .agents_overview
                    .as_mut()
                    .map(|overview| {
                        overview
                            .refresh_notifications
                            .drain()
                            .flat_map(|(_, notifications)| notifications)
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default();
                for notification in buffered {
                    self.track_agents_overview_notification(&notification);
                }
                let refresh_pending = self
                    .agents_overview
                    .as_mut()
                    .is_some_and(|overview| overview.take_refresh_pending());
                self.projection.set_status("agents overview loaded more");
                if refresh_pending {
                    Box::pin(self.refresh_agents_overview_threads(app_server)).await?;
                }
                Ok(())
            }
            Err(error) => {
                if let Some(overview) = self.agents_overview.as_mut() {
                    overview.fail_load_more();
                }
                let refresh_pending = self
                    .agents_overview
                    .as_mut()
                    .is_some_and(|overview| overview.take_refresh_pending());
                self.projection
                    .set_status(format!("agents overview unavailable: {error}"));
                if refresh_pending {
                    Box::pin(self.refresh_agents_overview_threads(app_server)).await?;
                }
                Err(error)
            }
        }
    }
}
