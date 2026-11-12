use crate::server_request::PendingServerRequest;
use crate::AppServer;
use app_server_protocol::protocol::v2::{
    CommandExecutionApprovalDecision, CommandExecutionRequestApprovalParams,
    CommandExecutionRequestApprovalResponse, FileChangeApprovalDecision,
    FileChangeRequestApprovalParams, FileChangeRequestApprovalResponse, NetworkApprovalContext,
    NetworkApprovalProtocol, ToolRequestUserInputOption, ToolRequestUserInputParams,
    ToolRequestUserInputQuestion, ToolRequestUserInputResponse,
    METHOD_ITEM_COMMAND_EXECUTION_REQUEST_APPROVAL, METHOD_ITEM_FILE_CHANGE_REQUEST_APPROVAL,
    METHOD_ITEM_TOOL_REQUEST_USER_INPUT,
};
use app_server_protocol::{
    AgentEvent, AgentSessionActionRespondParams, AgentSessionActionScope, AgentSessionActionType,
    AgentSessionApprovalDecision,
};
use serde_json::Value;
use std::collections::BTreeMap;
use tool_runtime::execution_approval::APPROVAL_REQUEST_FAILED_METADATA_KEY;

impl AppServer {
    pub(crate) async fn handle_command_approval_request(&self, event: AgentEvent) {
        let request = match action_server_request(&event) {
            Ok(Some(request)) => request,
            Ok(None) => return,
            Err(error) => {
                tracing::warn!(event_id = %event.event_id, %error, "invalid action server request event");
                return;
            }
        };
        let response = match request {
            ActionServerRequest::Command(request) => {
                let CommandApprovalRequest { params, identity } = request;
                let response = self
                    .wait_thread_server_request::<_, CommandExecutionRequestApprovalResponse>(
                        METHOD_ITEM_COMMAND_EXECUTION_REQUEST_APPROVAL,
                        &identity.thread_id,
                        params,
                    )
                    .await;
                let Some(response) = RuntimeActionResponse::from_approval(
                    identity,
                    response.map(|response| approval_decision(response.decision)),
                ) else {
                    return;
                };
                response
            }
            ActionServerRequest::FileChange(request) => {
                let FileChangeApprovalRequest { params, identity } = request;
                let response = self
                    .wait_thread_server_request::<_, FileChangeRequestApprovalResponse>(
                        METHOD_ITEM_FILE_CHANGE_REQUEST_APPROVAL,
                        &identity.thread_id,
                        params,
                    )
                    .await;
                let Some(response) = RuntimeActionResponse::from_approval(
                    identity,
                    response.map(|response| file_approval_decision(response.decision)),
                ) else {
                    return;
                };
                response
            }
            ActionServerRequest::UserInput(request) => {
                let UserInputRequest { params, identity } = request;
                let response = self
                    .wait_thread_server_request::<_, ToolRequestUserInputResponse>(
                        METHOD_ITEM_TOOL_REQUEST_USER_INPUT,
                        &identity.thread_id,
                        params,
                    )
                    .await;
                let response = match response {
                    Ok(response) => response,
                    Err(WaitServerRequestError::Transition) => return,
                    Err(WaitServerRequestError::Failed(error)) => {
                        tracing::warn!(%error, "user-input server request failed closed");
                        ToolRequestUserInputResponse {
                            answers: BTreeMap::new(),
                        }
                    }
                };
                RuntimeActionResponse::user_input(identity, response)
            }
        };

        if let Err(error) = self.respond_to_runtime_action(response).await {
            tracing::warn!(event_id = %event.event_id, %error, "typed server request response rejected by runtime");
        }
    }

    pub(crate) async fn wait_thread_server_request<P, R>(
        &self,
        method: &str,
        thread_id: &str,
        params: P,
    ) -> Result<R, WaitServerRequestError>
    where
        P: serde::Serialize,
        R: serde::de::DeserializeOwned,
    {
        let pending = self
            .begin_thread_server_request(thread_id, method, params)
            .await
            .map_err(|error| WaitServerRequestError::Failed(error.to_string()))?;
        self.finish_server_request(thread_id, pending).await
    }

    pub(crate) async fn finish_server_request<R>(
        &self,
        thread_id: &str,
        mut pending: PendingServerRequest,
    ) -> Result<R, WaitServerRequestError>
    where
        R: serde::de::DeserializeOwned,
    {
        let request_id = pending.id().clone();
        let terminal = pending.wait_terminal().await;
        if !terminal.resolved_in_listener {
            if let Err(error) = self
                .publish_server_request_resolved(thread_id, request_id, terminal.owner)
                .await
            {
                tracing::warn!(%thread_id, %error, "failed to publish typed server-request terminal notification");
            }
        }
        if terminal.turn_transition {
            return Err(WaitServerRequestError::Transition);
        }
        let value = match terminal.result {
            Ok(value) => value,
            Err(error) => return Err(WaitServerRequestError::Failed(error.to_string())),
        };
        serde_json::from_value(value)
            .map_err(|error| WaitServerRequestError::Failed(error.to_string()))
    }

    async fn respond_to_runtime_action(
        &self,
        response: RuntimeActionResponse,
    ) -> Result<(), String> {
        let params = AgentSessionActionRespondParams {
            session_id: response.identity.session_id.clone(),
            request_id: response.identity.request_id,
            action_type: response.action_type,
            decision: response.decision,
            confirmed: response.confirmed,
            response: None,
            user_data: response.user_data,
            metadata: response.metadata,
            event_name: None,
            action_scope: Some(AgentSessionActionScope {
                session_id: Some(response.identity.session_id),
                thread_id: Some(response.identity.thread_id.clone()),
                turn_id: Some(response.identity.turn_id),
            }),
        };
        let output = self
            .processor
            .runtime()
            .respond_action(params, crate::RuntimeHostContext::default())
            .await
            .map_err(|error| error.to_string())?;
        let bridge = self.event_bridge();
        let thread_id = agent_protocol::ThreadId::new(response.identity.thread_id);
        for event in output.events {
            bridge
                .send_thread_command(
                    thread_id.clone(),
                    crate::thread_state::ThreadListenerCommand::PublishRuntimeEvent {
                        event,
                        completion_tx: None,
                    },
                )
                .await
                .map_err(|error| error.to_string())?;
        }
        Ok(())
    }
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum WaitServerRequestError {
    Transition,
    Failed(String),
}

enum ActionServerRequest {
    Command(CommandApprovalRequest),
    FileChange(FileChangeApprovalRequest),
    UserInput(UserInputRequest),
}

struct RuntimeActionIdentity {
    request_id: String,
    session_id: String,
    thread_id: String,
    turn_id: String,
}

struct RuntimeActionResponse {
    identity: RuntimeActionIdentity,
    action_type: AgentSessionActionType,
    decision: Option<AgentSessionApprovalDecision>,
    confirmed: Option<bool>,
    user_data: Option<Value>,
    metadata: Option<Value>,
}

impl RuntimeActionResponse {
    fn from_approval(
        identity: RuntimeActionIdentity,
        decision: Result<AgentSessionApprovalDecision, WaitServerRequestError>,
    ) -> Option<Self> {
        match decision {
            Ok(decision) => Some(Self::approval(identity, decision)),
            Err(WaitServerRequestError::Transition) => None,
            Err(WaitServerRequestError::Failed(error)) => {
                tracing::warn!(%error, "approval server request failed closed");
                let mut response = Self::approval(identity, AgentSessionApprovalDecision::Decline);
                response.metadata = Some(serde_json::json!({
                    (APPROVAL_REQUEST_FAILED_METADATA_KEY): true,
                }));
                Some(response)
            }
        }
    }

    fn approval(identity: RuntimeActionIdentity, decision: AgentSessionApprovalDecision) -> Self {
        Self {
            identity,
            action_type: AgentSessionActionType::ToolConfirmation,
            decision: Some(decision),
            confirmed: None,
            user_data: None,
            metadata: None,
        }
    }

    fn user_input(identity: RuntimeActionIdentity, response: ToolRequestUserInputResponse) -> Self {
        let answered = !response.answers.is_empty();
        let answers = response
            .answers
            .into_iter()
            .map(|(id, answer)| {
                let value = match answer.answers.as_slice() {
                    [answer] => Value::String(answer.clone()),
                    answers => serde_json::json!(answers),
                };
                (id, value)
            })
            .collect::<serde_json::Map<_, _>>();
        Self {
            identity,
            action_type: AgentSessionActionType::AskUser,
            decision: None,
            confirmed: Some(answered),
            user_data: Some(Value::Object(answers)),
            metadata: None,
        }
    }
}

struct CommandApprovalRequest {
    params: CommandExecutionRequestApprovalParams,
    identity: RuntimeActionIdentity,
}

struct FileChangeApprovalRequest {
    params: FileChangeRequestApprovalParams,
    identity: RuntimeActionIdentity,
}

struct UserInputRequest {
    params: ToolRequestUserInputParams,
    identity: RuntimeActionIdentity,
}

fn action_server_request(event: &AgentEvent) -> Result<Option<ActionServerRequest>, String> {
    if let Some(request) = user_input_request(event)? {
        return Ok(Some(ActionServerRequest::UserInput(request)));
    }
    if let Some(request) = file_change_approval_request(event)? {
        return Ok(Some(ActionServerRequest::FileChange(request)));
    }
    command_approval_request(event).map(|request| request.map(ActionServerRequest::Command))
}

fn command_approval_request(event: &AgentEvent) -> Result<Option<CommandApprovalRequest>, String> {
    if event.event_type != "action.required" {
        return Ok(None);
    }
    let action_type = payload_string(&event.payload, &["actionType", "action_type"]);
    if action_type.as_deref() != Some("tool_confirmation") {
        return Ok(None);
    }
    let session_id = required_id(&event.session_id, "sessionId")?;
    let thread_id = required_optional_id(event.thread_id.as_deref(), "threadId")?;
    let turn_id = required_optional_id(event.turn_id.as_deref(), "turnId")?;
    let request_id = payload_string(
        &event.payload,
        &["requestId", "request_id", "actionId", "action_id"],
    )
    .ok_or_else(|| "action.required tool_confirmation has no request id".to_string())?;
    let item_id = payload_string(&event.payload, &["toolCallId", "tool_call_id"])
        .unwrap_or_else(|| request_id.clone());
    let network_approval_context = network_approval_context(&event.payload)?;
    let command = payload_value(&event.payload, &["arguments"])
        .and_then(Value::as_object)
        .and_then(|arguments| arguments.get("command"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|command| !command.is_empty())
        .map(str::to_string);
    let available_decisions = payload_value(
        &event.payload,
        &["availableDecisions", "available_decisions"],
    )
    .and_then(Value::as_array)
    .map(|values| {
        values
            .iter()
            .map(Value::as_str)
            .map(|value| match value {
                Some("allow_once") => Ok(CommandExecutionApprovalDecision::Accept),
                Some("allow_for_session") => Ok(CommandExecutionApprovalDecision::AcceptForSession),
                Some("decline") => Ok(CommandExecutionApprovalDecision::Decline),
                Some("cancel") => Ok(CommandExecutionApprovalDecision::Cancel),
                _ => Err("action.required has unsupported approval decision".to_string()),
            })
            .collect::<Result<Vec<_>, _>>()
    })
    .transpose()?;
    Ok(Some(CommandApprovalRequest {
        params: CommandExecutionRequestApprovalParams {
            thread_id: thread_id.clone(),
            turn_id: turn_id.clone(),
            item_id,
            started_at_ms: timestamp_millis(&event.timestamp)?,
            approval_id: Some(request_id.clone()),
            reason: payload_string(&event.payload, &["prompt", "message"]),
            command: network_approval_context
                .is_none()
                .then_some(command)
                .flatten(),
            cwd: network_approval_context
                .is_none()
                .then(|| payload_string(&event.payload, &["cwd"]))
                .flatten(),
            network_approval_context,
            available_decisions,
        },
        identity: RuntimeActionIdentity {
            request_id,
            session_id,
            thread_id,
            turn_id,
        },
    }))
}

fn network_approval_context(payload: &Value) -> Result<Option<NetworkApprovalContext>, String> {
    let managed_network = payload_string(payload, &["denialKind", "denial_kind"])
        .is_some_and(|kind| kind == "managed_network");
    let Some(scope) =
        payload_value(payload, &["approvalScope", "approval_scope"]).and_then(Value::as_object)
    else {
        return if managed_network {
            Err("action.required managed-network approval context is incomplete".to_string())
        } else {
            Ok(None)
        };
    };
    let host = ["networkHost", "network_host"]
        .iter()
        .find_map(|key| scope.get(*key))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let protocol = ["networkProtocol", "network_protocol"]
        .iter()
        .find_map(|key| scope.get(*key))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    match (host, protocol) {
        (Some(host), Some(protocol)) => Ok(Some(NetworkApprovalContext {
            host,
            protocol: parse_network_approval_protocol(&protocol)?,
        })),
        _ if managed_network => {
            Err("action.required managed-network approval context is incomplete".to_string())
        }
        _ => Ok(None),
    }
}

fn parse_network_approval_protocol(value: &str) -> Result<NetworkApprovalProtocol, String> {
    match value {
        "http" => Ok(NetworkApprovalProtocol::Http),
        "https" => Ok(NetworkApprovalProtocol::Https),
        "socks5Tcp" => Ok(NetworkApprovalProtocol::Socks5Tcp),
        "socks5Udp" => Ok(NetworkApprovalProtocol::Socks5Udp),
        _ => Err(format!(
            "action.required has unsupported network approval protocol: {value}"
        )),
    }
}

fn file_change_approval_request(
    event: &AgentEvent,
) -> Result<Option<FileChangeApprovalRequest>, String> {
    if event.event_type != "action.required"
        || payload_string(&event.payload, &["actionType", "action_type"]).as_deref()
            != Some("tool_confirmation")
        || payload_string(&event.payload, &["toolName", "tool_name"]).as_deref()
            != Some("apply_patch")
    {
        return Ok(None);
    }
    let identity = action_identity(event)?;
    let item_id = required_payload_id(&event.payload, &["toolCallId", "tool_call_id"], "itemId")?;
    Ok(Some(FileChangeApprovalRequest {
        params: FileChangeRequestApprovalParams {
            thread_id: identity.thread_id.clone(),
            turn_id: identity.turn_id.clone(),
            item_id,
            started_at_ms: payload_i64(&event.payload, &["createdAtMs", "created_at_ms"])
                .unwrap_or(timestamp_millis(&event.timestamp)?),
            reason: payload_string(&event.payload, &["prompt", "message"]),
            grant_root: payload_string(&event.payload, &["grantRoot", "grant_root"]),
            destinations: patch_destinations(&event.payload),
        },
        identity,
    }))
}

fn patch_destinations(payload: &Value) -> Vec<String> {
    let Some(patch) = payload
        .get("arguments")
        .and_then(|arguments| arguments.get("patch").or_else(|| arguments.get("input")))
        .and_then(Value::as_str)
    else {
        return Vec::new();
    };
    let Ok(parsed) = patch_apply::parse_patch(patch) else {
        return Vec::new();
    };
    let cwd = payload_string(payload, &["cwd"]).map(std::path::PathBuf::from);
    let absolute = |path: &std::path::Path| {
        if path.is_relative() {
            cwd.as_ref()
                .map(|cwd| cwd.join(path))
                .unwrap_or_else(|| path.to_path_buf())
        } else {
            path.to_path_buf()
        }
    };
    let mut destinations = Vec::new();
    for hunk in &parsed.hunks {
        if let patch_apply::Hunk::UpdateFile {
            path, move_path, ..
        } = hunk
        {
            destinations.push(absolute(path).display().to_string());
            if let Some(move_path) = move_path {
                destinations.push(absolute(move_path).display().to_string());
            }
        } else {
            destinations.push(absolute(hunk.path()).display().to_string());
        }
    }
    destinations.sort();
    destinations.dedup();
    destinations
}

fn user_input_request(event: &AgentEvent) -> Result<Option<UserInputRequest>, String> {
    if event.event_type != "action.required"
        || payload_string(&event.payload, &["actionType", "action_type"]).as_deref()
            != Some("ask_user")
    {
        return Ok(None);
    }
    let identity = action_identity(event)?;
    let item_id = required_payload_id(&event.payload, &["toolCallId", "tool_call_id"], "itemId")?;
    let questions = payload_value(&event.payload, &["questions"])
        .and_then(Value::as_array)
        .ok_or_else(|| "action.required ask_user has no questions".to_string())?
        .iter()
        .map(tool_request_user_input_question)
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Some(UserInputRequest {
        params: ToolRequestUserInputParams {
            thread_id: identity.thread_id.clone(),
            turn_id: identity.turn_id.clone(),
            item_id,
            questions,
            is_blocking: payload_value(&event.payload, &["isBlocking", "is_blocking"])
                .and_then(Value::as_bool)
                .unwrap_or(true),
            auto_resolution_ms: payload_value(
                &event.payload,
                &["autoResolutionMs", "auto_resolution_ms"],
            )
            .and_then(Value::as_u64),
        },
        identity,
    }))
}

fn action_identity(event: &AgentEvent) -> Result<RuntimeActionIdentity, String> {
    Ok(RuntimeActionIdentity {
        request_id: required_payload_id(
            &event.payload,
            &["requestId", "request_id", "actionId", "action_id"],
            "requestId",
        )?,
        session_id: required_id(&event.session_id, "sessionId")?,
        thread_id: required_optional_id(event.thread_id.as_deref(), "threadId")?,
        turn_id: required_optional_id(event.turn_id.as_deref(), "turnId")?,
    })
}

fn tool_request_user_input_question(value: &Value) -> Result<ToolRequestUserInputQuestion, String> {
    let id = required_payload_id(value, &["id"], "question.id")?;
    let header = required_payload_id(value, &["header"], "question.header")?;
    let question = required_payload_id(value, &["question"], "question.question")?;
    let options = value
        .get("options")
        .and_then(Value::as_array)
        .map(|options| {
            options
                .iter()
                .map(|option| {
                    let label = payload_string(option, &["label", "value"])
                        .ok_or_else(|| "request_user_input option has no label".to_string())?;
                    Ok(ToolRequestUserInputOption {
                        label,
                        description: payload_string(option, &["description"]).unwrap_or_default(),
                    })
                })
                .collect::<Result<Vec<_>, String>>()
        })
        .transpose()?;
    Ok(ToolRequestUserInputQuestion {
        id,
        header,
        question,
        is_other: value
            .get("isOther")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        is_secret: value
            .get("isSecret")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        options,
    })
}

fn approval_decision(decision: CommandExecutionApprovalDecision) -> AgentSessionApprovalDecision {
    match decision {
        CommandExecutionApprovalDecision::Accept => AgentSessionApprovalDecision::AllowOnce,
        CommandExecutionApprovalDecision::AcceptForSession => {
            AgentSessionApprovalDecision::AllowForSession
        }
        CommandExecutionApprovalDecision::Decline => AgentSessionApprovalDecision::Decline,
        CommandExecutionApprovalDecision::Cancel => AgentSessionApprovalDecision::Cancel,
    }
}

fn file_approval_decision(decision: FileChangeApprovalDecision) -> AgentSessionApprovalDecision {
    match decision {
        FileChangeApprovalDecision::Accept => AgentSessionApprovalDecision::AllowOnce,
        FileChangeApprovalDecision::AcceptForSession => {
            AgentSessionApprovalDecision::AllowForSession
        }
        FileChangeApprovalDecision::Decline => AgentSessionApprovalDecision::Decline,
        FileChangeApprovalDecision::Cancel => AgentSessionApprovalDecision::Cancel,
    }
}

fn required_id(value: &str, field: &str) -> Result<String, String> {
    let value = value.trim();
    (!value.is_empty())
        .then(|| value.to_string())
        .ok_or_else(|| format!("action.required has no {field}"))
}

fn required_optional_id(value: Option<&str>, field: &str) -> Result<String, String> {
    value
        .map(|value| required_id(value, field))
        .transpose()?
        .ok_or_else(|| format!("action.required has no {field}"))
}

fn payload_string(payload: &Value, keys: &[&str]) -> Option<String> {
    payload_value(payload, keys).and_then(|value| {
        value
            .as_str()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    })
}

fn payload_value<'a>(payload: &'a Value, keys: &[&str]) -> Option<&'a Value> {
    keys.iter().find_map(|key| {
        payload
            .get(key)
            .or_else(|| payload.get("data").and_then(|data| data.get(key)))
    })
}

fn payload_i64(payload: &Value, keys: &[&str]) -> Option<i64> {
    payload_value(payload, keys).and_then(Value::as_i64)
}

fn required_payload_id(payload: &Value, keys: &[&str], field: &str) -> Result<String, String> {
    payload_string(payload, keys).ok_or_else(|| format!("action.required has no {field}"))
}

fn timestamp_millis(value: &str) -> Result<i64, String> {
    chrono::DateTime::parse_from_rfc3339(value)
        .map(|value| value.timestamp_millis())
        .map_err(|error| format!("action.required timestamp is invalid: {error}"))
}

#[cfg(test)]
mod tests;
