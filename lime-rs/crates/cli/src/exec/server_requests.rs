//! Non-interactive clients cannot provide consent or user answers.

use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::{Context, Result};
use app_server_client::RequestHandle;
use app_server_protocol::protocol::v2::{
    CommandExecutionApprovalDecision, CommandExecutionRequestApprovalResponse,
    CurrentTimeReadResponse, FileChangeApprovalDecision, FileChangeRequestApprovalResponse,
    GrantedPermissionProfile, PermissionGrantScope, PermissionsRequestApprovalResponse,
    ServerRequest, ToolRequestUserInputResponse,
};
use app_server_protocol::{JsonRpcError, RequestId};
use serde::Serialize;
use serde_json::Value;

enum ServerResponse {
    Reply { id: RequestId, result: Value },
    Reject { id: RequestId, error: JsonRpcError },
}

pub(super) async fn respond(handle: &RequestHandle, request: ServerRequest) -> Result<()> {
    match response_for(request)? {
        ServerResponse::Reply { id, result } => handle.respond(id, result).await,
        ServerResponse::Reject { id, error } => handle.reject(id, error).await,
    }
    .context("failed to respond to non-interactive App Server request")?;
    Ok(())
}

fn reply(id: RequestId, result: impl Serialize) -> Result<ServerResponse> {
    Ok(ServerResponse::Reply {
        id,
        result: serde_json::to_value(result)?,
    })
}

fn response_for(request: ServerRequest) -> Result<ServerResponse> {
    match request {
        ServerRequest::CurrentTimeRead { id, .. } => {
            let seconds = SystemTime::now().duration_since(UNIX_EPOCH)?.as_secs();
            reply(
                id,
                CurrentTimeReadResponse {
                    current_time_at: i64::try_from(seconds)?,
                },
            )
        }
        ServerRequest::ItemCommandExecutionRequestApproval { id, .. } => reply(
            id,
            CommandExecutionRequestApprovalResponse {
                decision: CommandExecutionApprovalDecision::Cancel,
            },
        ),
        ServerRequest::ItemFileChangeRequestApproval { id, .. } => reply(
            id,
            FileChangeRequestApprovalResponse {
                decision: FileChangeApprovalDecision::Cancel,
            },
        ),
        ServerRequest::ItemPermissionsRequestApproval { id, .. } => reply(
            id,
            PermissionsRequestApprovalResponse {
                permissions: GrantedPermissionProfile::default(),
                scope: PermissionGrantScope::Turn,
                strict_auto_review: None,
            },
        ),
        ServerRequest::ItemToolRequestUserInput { id, .. } => reply(
            id,
            ToolRequestUserInputResponse {
                answers: Default::default(),
            },
        ),
        request => Ok(ServerResponse::Reject {
            id: request.id().clone(),
            error: JsonRpcError::new(
                app_server_protocol::error_codes::METHOD_NOT_FOUND,
                format!(
                    "exec client does not support server request {}",
                    request.method()
                ),
            ),
        }),
    }
}

#[cfg(test)]
#[path = "server_requests_tests.rs"]
mod tests;
