//! Thread targeting helpers for app-server requests and notifications.

use app_server_protocol::protocol::v2::{ServerNotification, ServerRequest};

pub(crate) fn server_request_thread_id(request: &ServerRequest) -> Option<&str> {
    match request {
        ServerRequest::AccountAuthorize { params, .. } => Some(params.thread_id.as_str()),
        ServerRequest::ConnectionAuthorize { params, .. } => Some(params.thread_id.as_str()),
        ServerRequest::CurrentTimeRead { params, .. } => Some(params.thread_id.as_str()),
        ServerRequest::McpServerElicitationRequest { params, .. } => {
            Some(params.thread_id.as_str())
        }
        ServerRequest::ItemCommandExecutionRequestApproval { params, .. } => {
            Some(params.thread_id.as_str())
        }
        ServerRequest::ItemFileChangeRequestApproval { params, .. } => {
            Some(params.thread_id.as_str())
        }
        ServerRequest::ItemPermissionsRequestApproval { params, .. } => {
            Some(params.thread_id.as_str())
        }
        ServerRequest::DynamicToolCall { params, .. } => Some(params.thread_id.as_str()),
        ServerRequest::ItemToolRequestUserInput { params, .. } => Some(params.thread_id.as_str()),
    }
}

#[derive(Debug, PartialEq, Eq)]
pub(super) enum ServerNotificationThreadTarget {
    Thread(String),
    InvalidThreadId(String),
    AppScoped,
    Global,
}

pub(super) fn server_notification_thread_target(
    notification: &ServerNotification,
) -> ServerNotificationThreadTarget {
    let thread_id = match notification {
        ServerNotification::Warning(notification) => notification.thread_id.as_deref(),
        ServerNotification::GuardianWarning(notification) => Some(notification.thread_id.as_str()),
        ServerNotification::StrictReviewRequired(notification) => {
            Some(notification.thread_id.as_str())
        }
        ServerNotification::Error(notification) => Some(notification.thread_id.as_str()),
        ServerNotification::McpServerOauthLoginCompleted(notification) => {
            notification.thread_id.as_deref()
        }
        ServerNotification::McpServerStatusUpdated(notification) => {
            let Some(thread_id) = notification.thread_id.as_deref() else {
                return ServerNotificationThreadTarget::AppScoped;
            };
            Some(thread_id)
        }
        ServerNotification::EnvironmentConnected(notification)
        | ServerNotification::EnvironmentDisconnected(notification) => {
            Some(notification.thread_id.as_str())
        }
        ServerNotification::ScheduledTaskRunUpdated(notification) => {
            notification.thread_id.as_deref()
        }
        ServerNotification::HookStarted(notification) => Some(notification.thread_id.as_str()),
        ServerNotification::HookCompleted(notification) => Some(notification.thread_id.as_str()),
        ServerNotification::ThreadStarted(notification) => Some(notification.thread.id.as_str()),
        ServerNotification::ThreadArchived(notification) => Some(notification.thread_id.as_str()),
        ServerNotification::ThreadDeleted(notification) => Some(notification.thread_id.as_str()),
        ServerNotification::ThreadUnarchived(notification) => Some(notification.thread_id.as_str()),
        ServerNotification::ThreadClosed(notification) => Some(notification.thread_id.as_str()),
        ServerNotification::ThreadReverted(notification) => Some(notification.thread_id.as_str()),
        ServerNotification::ThreadNameUpdated(notification) => {
            Some(notification.thread_id.as_str())
        }
        ServerNotification::ThreadStatusChanged(notification) => {
            Some(notification.thread_id.as_str())
        }
        ServerNotification::TurnStarted(notification) => Some(notification.thread_id.as_str()),
        ServerNotification::TurnCompleted(notification) => Some(notification.thread_id.as_str()),
        ServerNotification::TurnDiffUpdated(notification) => Some(notification.thread_id.as_str()),
        ServerNotification::TurnPlanUpdated(notification) => Some(notification.thread_id.as_str()),
        ServerNotification::ItemStarted(notification) => Some(notification.thread_id.as_str()),
        ServerNotification::ItemCompleted(notification) => Some(notification.thread_id.as_str()),
        ServerNotification::ItemAutoApprovalReviewStarted(notification) => {
            Some(notification.thread_id.as_str())
        }
        ServerNotification::ItemAutoApprovalReviewCompleted(notification) => {
            Some(notification.thread_id.as_str())
        }
        ServerNotification::AgentMessageDelta(notification) => {
            Some(notification.thread_id.as_str())
        }
        ServerNotification::CommandExecutionOutputDelta(notification) => {
            Some(notification.thread_id.as_str())
        }
        ServerNotification::CommandExecutionTerminalInteraction(notification) => {
            Some(notification.thread_id.as_str())
        }
        ServerNotification::FileChangePatchUpdated(notification) => {
            Some(notification.thread_id.as_str())
        }
        ServerNotification::PlanDelta(notification) => Some(notification.thread_id.as_str()),
        ServerNotification::McpToolCallProgress(notification) => {
            Some(notification.thread_id.as_str())
        }
        ServerNotification::ReasoningSummaryTextDelta(notification) => {
            Some(notification.thread_id.as_str())
        }
        ServerNotification::ReasoningSummaryPartAdded(notification) => {
            Some(notification.thread_id.as_str())
        }
        ServerNotification::ReasoningTextDelta(notification) => {
            Some(notification.thread_id.as_str())
        }
        ServerNotification::ModelRerouted(notification) => Some(notification.thread_id.as_str()),
        ServerNotification::ModelVerification(notification) => {
            Some(notification.thread_id.as_str())
        }
        ServerNotification::TurnModerationMetadata(notification) => {
            Some(notification.thread_id.as_str())
        }
        ServerNotification::ModelSafetyBufferingUpdated(notification) => {
            Some(notification.thread_id.as_str())
        }
        ServerNotification::ThreadSettingsUpdated(notification) => {
            Some(notification.thread_id.as_str())
        }
        ServerNotification::ThreadTokenUsageUpdated(notification) => {
            Some(notification.thread_id.as_str())
        }
        ServerNotification::ThreadGoalUpdated(notification) => {
            Some(notification.thread_id.as_str())
        }
        ServerNotification::ThreadGoalCleared(notification) => {
            Some(notification.thread_id.as_str())
        }
        ServerNotification::ThreadQueueChanged(notification) => {
            Some(notification.thread_id.as_str())
        }
        ServerNotification::ThreadProjectUpdated(notification) => {
            Some(notification.thread_id.as_str())
        }
        ServerNotification::ServerRequestResolved(notification) => {
            Some(notification.thread_id.as_str())
        }
        ServerNotification::ConfigWarning(_)
        | ServerNotification::AccountUpdated(_)
        | ServerNotification::SkillsChanged(_)
        | ServerNotification::McpServerEventStream(_)
        | ServerNotification::AppListUpdated(_)
        | ServerNotification::ScheduledTaskChanged(_)
        | ServerNotification::ModelListUpdated(_)
        | ServerNotification::FsChanged(_)
        | ServerNotification::ProcessOutputDelta(_)
        | ServerNotification::ProcessExited(_)
        | ServerNotification::CommandExecOutputDelta(_)
        | ServerNotification::ProjectChanged(_)
        | ServerNotification::WindowsWorldWritableWarning(_)
        | ServerNotification::WindowsSandboxSetupCompleted(_) => None,
    };

    match thread_id {
        Some(thread_id) if thread_id.trim().is_empty() => {
            ServerNotificationThreadTarget::InvalidThreadId(thread_id.to_string())
        }
        Some(thread_id) => ServerNotificationThreadTarget::Thread(thread_id.to_string()),
        None => ServerNotificationThreadTarget::Global,
    }
}

#[cfg(test)]
mod tests {
    use super::{
        server_notification_thread_target, server_request_thread_id, ServerNotificationThreadTarget,
    };
    use app_server_protocol::protocol::v2::{
        AccountUpdatedNotification, AgentMessageDeltaNotification, CurrentTimeReadParams,
        McpServerStartupState, McpServerStatusUpdatedNotification, ServerNotification,
        ServerRequest, WarningNotification,
    };
    use app_server_protocol::RequestId;

    #[test]
    fn warning_notifications_without_threads_are_global() {
        let notification = ServerNotification::Warning(WarningNotification {
            thread_id: None,
            message: "warning".to_string(),
            code: None,
        });

        assert_eq!(
            server_notification_thread_target(&notification),
            ServerNotificationThreadTarget::Global
        );
    }

    #[test]
    fn account_updates_are_global_with_or_without_an_authenticated_account() {
        for auth_mode in [None, Some("cloud".to_string())] {
            let notification = ServerNotification::AccountUpdated(AccountUpdatedNotification {
                auth_mode,
                plan_type: None,
            });
            assert_eq!(
                server_notification_thread_target(&notification),
                ServerNotificationThreadTarget::Global
            );
        }
    }

    #[test]
    fn thread_notifications_route_to_their_thread() {
        let notification = ServerNotification::AgentMessageDelta(AgentMessageDeltaNotification {
            thread_id: "thread-1".to_string(),
            turn_id: "turn-1".to_string(),
            item_id: "item-1".to_string(),
            delta: "answer".to_string(),
        });

        assert_eq!(
            server_notification_thread_target(&notification),
            ServerNotificationThreadTarget::Thread("thread-1".to_string())
        );
    }

    #[test]
    fn mcp_startup_notifications_without_threads_are_app_scoped() {
        let notification =
            ServerNotification::McpServerStatusUpdated(McpServerStatusUpdatedNotification {
                thread_id: None,
                name: "server".to_string(),
                status: McpServerStartupState::Failed,
                error: Some("not available".to_string()),
                failure_reason: None,
            });

        assert_eq!(
            server_notification_thread_target(&notification),
            ServerNotificationThreadTarget::AppScoped
        );
    }

    #[test]
    fn server_requests_expose_their_thread_target() {
        let request = ServerRequest::CurrentTimeRead {
            id: RequestId::Integer(1),
            params: CurrentTimeReadParams {
                thread_id: "thread-1".to_string(),
            },
        };

        assert_eq!(server_request_thread_id(&request), Some("thread-1"));
    }
}
