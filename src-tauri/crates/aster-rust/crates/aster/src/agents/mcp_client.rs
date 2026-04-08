use crate::action_required_manager::ActionRequiredManager;
use crate::agents::types::SharedProvider;
use crate::conversation::message::ActionRequiredScope;
use crate::session_context::SESSION_ID_HEADER;
use rmcp::model::{
    Content, CreateElicitationRequestParam, CreateElicitationResult, ElicitationAction, ErrorCode,
    JsonObject,
};
/// MCP client implementation for Aster
use rmcp::{
    model::{
        CallToolRequest, CallToolRequestParam, CallToolResult, CancelledNotification,
        CancelledNotificationMethod, CancelledNotificationParam, ClientCapabilities, ClientInfo,
        ClientRequest, CreateMessageRequestParam, CreateMessageResult, GetPromptRequest,
        GetPromptRequestParam, GetPromptResult, Implementation, InitializeResult,
        ListPromptsRequest, ListPromptsResult, ListResourcesRequest, ListResourcesResult,
        ListToolsRequest, ListToolsResult, LoggingMessageNotification,
        LoggingMessageNotificationMethod, PaginatedRequestParam, ProgressNotification,
        ProgressNotificationMethod, ProtocolVersion, ReadResourceRequest, ReadResourceRequestParam,
        ReadResourceResult, RequestId, Role, SamplingMessage, ServerNotification, ServerResult,
    },
    service::{
        ClientInitializeError, PeerRequestOptions, RequestContext, RequestHandle, RunningService,
        ServiceRole,
    },
    transport::IntoTransport,
    ClientHandler, ErrorData, Peer, RoleClient, ServiceError, ServiceExt,
};
use serde_json::Value;
use std::{sync::Arc, time::Duration};
use tokio::sync::{
    mpsc::{self, Sender},
    Mutex,
};
use tokio_util::sync::CancellationToken;

pub type BoxError = Box<dyn std::error::Error + Sync + Send>;

pub type Error = rmcp::ServiceError;

#[async_trait::async_trait]
pub trait McpClientTrait: Send + Sync {
    async fn list_resources(
        &self,
        next_cursor: Option<String>,
        cancel_token: CancellationToken,
    ) -> Result<ListResourcesResult, Error>;

    async fn read_resource(
        &self,
        uri: &str,
        cancel_token: CancellationToken,
    ) -> Result<ReadResourceResult, Error>;

    async fn list_tools(
        &self,
        next_cursor: Option<String>,
        cancel_token: CancellationToken,
    ) -> Result<ListToolsResult, Error>;

    async fn call_tool(
        &self,
        name: &str,
        arguments: Option<JsonObject>,
        cancel_token: CancellationToken,
    ) -> Result<CallToolResult, Error>;

    async fn list_prompts(
        &self,
        next_cursor: Option<String>,
        cancel_token: CancellationToken,
    ) -> Result<ListPromptsResult, Error>;

    async fn get_prompt(
        &self,
        name: &str,
        arguments: Value,
        cancel_token: CancellationToken,
    ) -> Result<GetPromptResult, Error>;

    async fn subscribe(&self) -> mpsc::Receiver<ServerNotification>;

    fn get_info(&self) -> Option<&InitializeResult>;

    async fn get_moim(&self) -> Option<String> {
        None
    }
}

pub struct AsterClient {
    notification_handlers: Arc<Mutex<Vec<Sender<ServerNotification>>>>,
    provider: SharedProvider,
}

impl AsterClient {
    pub fn new(
        handlers: Arc<Mutex<Vec<Sender<ServerNotification>>>>,
        provider: SharedProvider,
    ) -> Self {
        AsterClient {
            notification_handlers: handlers,
            provider,
        }
    }
}

impl ClientHandler for AsterClient {
    async fn on_progress(
        &self,
        params: rmcp::model::ProgressNotificationParam,
        context: rmcp::service::NotificationContext<rmcp::RoleClient>,
    ) {
        self.notification_handlers
            .lock()
            .await
            .iter()
            .for_each(|handler| {
                let _ = handler.try_send(ServerNotification::ProgressNotification(
                    ProgressNotification {
                        params: params.clone(),
                        method: ProgressNotificationMethod,
                        extensions: context.extensions.clone(),
                    },
                ));
            });
    }

    async fn on_logging_message(
        &self,
        params: rmcp::model::LoggingMessageNotificationParam,
        context: rmcp::service::NotificationContext<rmcp::RoleClient>,
    ) {
        self.notification_handlers
            .lock()
            .await
            .iter()
            .for_each(|handler| {
                let _ = handler.try_send(ServerNotification::LoggingMessageNotification(
                    LoggingMessageNotification {
                        params: params.clone(),
                        method: LoggingMessageNotificationMethod,
                        extensions: context.extensions.clone(),
                    },
                ));
            });
    }

    async fn create_message(
        &self,
        params: CreateMessageRequestParam,
        _context: RequestContext<RoleClient>,
    ) -> Result<CreateMessageResult, ErrorData> {
        let provider = self
            .provider
            .lock()
            .await
            .as_ref()
            .ok_or(ErrorData::new(
                ErrorCode::INTERNAL_ERROR,
                "Could not use provider",
                None,
            ))?
            .clone();

        let provider_ready_messages: Vec<crate::conversation::message::Message> = params
            .messages
            .iter()
            .map(|msg| {
                let base = match msg.role {
                    Role::User => crate::conversation::message::Message::user(),
                    Role::Assistant => crate::conversation::message::Message::assistant(),
                };

                match msg.content.as_text() {
                    Some(text) => base.with_text(&text.text),
                    None => base.with_content(msg.content.clone().into()),
                }
            })
            .collect();

        let system_prompt = params
            .system_prompt
            .as_deref()
            .unwrap_or("You are a general-purpose AI agent called aster");

        // Build model config with sampling parameters
        let mut model_config = provider.get_model_config();

        // Apply model preferences if provided
        // MCP model preferences include hints (model name patterns) and priority scores
        if let Some(prefs) = &params.model_preferences {
            // Try to find a matching model from hints
            if let Some(hints) = &prefs.hints {
                for hint in hints {
                    if let Some(name) = &hint.name {
                        // Use the hint name as the model name if it looks like a valid model
                        // The hint name can be a full model name or a pattern
                        if !name.is_empty() {
                            model_config = model_config
                                .rebuild_with_model_name(name)
                                .unwrap_or_else(|_| model_config.with_model_name(name.clone()));
                            break;
                        }
                    }
                }
            }
        }

        // Apply maxTokens from the request (required field in MCP sampling)
        model_config = model_config.with_max_tokens(Some(params.max_tokens as i32));

        // Apply temperature if provided in the request
        if let Some(temperature) = params.temperature {
            model_config = model_config.with_temperature(Some(temperature));
        }

        // Use complete_with_model to apply the custom model config
        let (response, usage) = provider
            .complete_with_model(&model_config, system_prompt, &provider_ready_messages, &[])
            .await
            .map_err(|e| {
                ErrorData::new(
                    ErrorCode::INTERNAL_ERROR,
                    "Unexpected error while completing the prompt",
                    Some(Value::from(e.to_string())),
                )
            })?;

        Ok(CreateMessageResult {
            model: usage.model,
            stop_reason: Some(CreateMessageResult::STOP_REASON_END_TURN.to_string()),
            message: SamplingMessage {
                role: Role::Assistant,
                // TODO(alexhancock): MCP sampling currently only supports one content on each SamplingMessage
                // https://modelcontextprotocol.io/specification/draft/client/sampling#messages
                // This doesn't mesh well with aster's approach which has Vec<MessageContent>
                // There is a proposal to MCP which is agreed to go in the next version to have SamplingMessages support multiple content parts
                // https://github.com/modelcontextprotocol/modelcontextprotocol/pull/198
                // Until that is formalized, we can take the first message content from the provider and use it
                content: if let Some(content) = response.content.first() {
                    match content {
                        crate::conversation::message::MessageContent::Text(text) => {
                            Content::text(&text.text)
                        }
                        crate::conversation::message::MessageContent::Image(img) => {
                            Content::image(&img.data, &img.mime_type)
                        }
                        // TODO(alexhancock) - Content::Audio? aster's messages don't currently have it
                        _ => Content::text(""),
                    }
                } else {
                    Content::text("")
                },
            },
        })
    }

    async fn create_elicitation(
        &self,
        request: CreateElicitationRequestParam,
        _context: RequestContext<RoleClient>,
    ) -> Result<CreateElicitationResult, ErrorData> {
        let schema_value = serde_json::to_value(&request.requested_schema).map_err(|e| {
            ErrorData::new(
                ErrorCode::INTERNAL_ERROR,
                format!("Failed to serialize elicitation schema: {}", e),
                None,
            )
        })?;

        let scope = crate::session_context::current_action_scope().unwrap_or_else(|| {
            let session_id = crate::session_context::current_session_id();
            ActionRequiredScope {
                session_id: session_id.clone(),
                thread_id: session_id,
                turn_id: None,
            }
        });

        ActionRequiredManager::global()
            .request_and_wait_scoped(
                scope,
                request.message.clone(),
                schema_value,
                Duration::from_secs(300),
            )
            .await
            .map(|user_data| CreateElicitationResult {
                action: ElicitationAction::Accept,
                content: Some(user_data),
            })
            .map_err(|e| {
                ErrorData::new(
                    ErrorCode::INTERNAL_ERROR,
                    format!("Elicitation request timed out or failed: {}", e),
                    None,
                )
            })
    }

    fn get_info(&self) -> ClientInfo {
        ClientInfo {
            protocol_version: ProtocolVersion::V_2025_03_26,
            capabilities: ClientCapabilities::builder()
                .enable_sampling()
                .enable_elicitation()
                .build(),
            client_info: Implementation {
                name: "aster".to_string(),
                version: std::env::var("ASTER_MCP_CLIENT_VERSION")
                    .unwrap_or(env!("CARGO_PKG_VERSION").to_owned()),
                icons: None,
                title: None,
                website_url: None,
            },
        }
    }
}

/// The MCP client is the interface for MCP operations.
pub struct McpClient {
    client: Mutex<RunningService<RoleClient, AsterClient>>,
    notification_subscribers: Arc<Mutex<Vec<mpsc::Sender<ServerNotification>>>>,
    server_info: Option<InitializeResult>,
    timeout: std::time::Duration,
}

impl McpClient {
    pub async fn connect<T, E, A>(
        transport: T,
        timeout: std::time::Duration,
        provider: SharedProvider,
    ) -> Result<Self, ClientInitializeError>
    where
        T: IntoTransport<RoleClient, E, A>,
        E: std::error::Error + From<std::io::Error> + Send + Sync + 'static,
    {
        let notification_subscribers =
            Arc::new(Mutex::new(Vec::<mpsc::Sender<ServerNotification>>::new()));

        let client = AsterClient::new(notification_subscribers.clone(), provider);
        let client: rmcp::service::RunningService<rmcp::RoleClient, AsterClient> =
            client.serve(transport).await?;
        let server_info = client.peer_info().cloned();

        Ok(Self {
            client: Mutex::new(client),
            notification_subscribers,
            server_info,
            timeout,
        })
    }

    async fn send_request(
        &self,
        request: ClientRequest,
        cancel_token: CancellationToken,
    ) -> Result<ServerResult, Error> {
        let handle = self
            .client
            .lock()
            .await
            .send_cancellable_request(request, PeerRequestOptions::no_options())
            .await?;

        await_response(handle, self.timeout, &cancel_token).await
    }
}

async fn await_response(
    handle: RequestHandle<RoleClient>,
    timeout: Duration,
    cancel_token: &CancellationToken,
) -> Result<<RoleClient as ServiceRole>::PeerResp, ServiceError> {
    let receiver = handle.rx;
    let peer = handle.peer;
    let request_id = handle.id;
    tokio::select! {
        result = receiver => {
            result.map_err(|_e| ServiceError::TransportClosed)?
        }
        _ = tokio::time::sleep(timeout) => {
            send_cancel_message(&peer, request_id, Some("timed out".to_owned())).await?;
            Err(ServiceError::Timeout{timeout})
        }
        _ = cancel_token.cancelled() => {
            send_cancel_message(&peer, request_id, Some("operation cancelled".to_owned())).await?;
            Err(ServiceError::Cancelled { reason: None })
        }
    }
}

async fn send_cancel_message(
    peer: &Peer<RoleClient>,
    request_id: RequestId,
    reason: Option<String>,
) -> Result<(), ServiceError> {
    peer.send_notification(
        CancelledNotification {
            params: CancelledNotificationParam { request_id, reason },
            method: CancelledNotificationMethod,
            extensions: Default::default(),
        }
        .into(),
    )
    .await
}

#[async_trait::async_trait]
impl McpClientTrait for McpClient {
    fn get_info(&self) -> Option<&InitializeResult> {
        self.server_info.as_ref()
    }

    async fn list_resources(
        &self,
        cursor: Option<String>,
        cancel_token: CancellationToken,
    ) -> Result<ListResourcesResult, Error> {
        let res = self
            .send_request(
                ClientRequest::ListResourcesRequest(ListResourcesRequest {
                    params: Some(PaginatedRequestParam { cursor }),
                    method: Default::default(),
                    extensions: inject_session_into_extensions(Default::default()),
                }),
                cancel_token,
            )
            .await?;

        match res {
            ServerResult::ListResourcesResult(result) => Ok(result),
            _ => Err(ServiceError::UnexpectedResponse),
        }
    }

    async fn read_resource(
        &self,
        uri: &str,
        cancel_token: CancellationToken,
    ) -> Result<ReadResourceResult, Error> {
        let res = self
            .send_request(
                ClientRequest::ReadResourceRequest(ReadResourceRequest {
                    params: ReadResourceRequestParam {
                        uri: uri.to_string(),
                    },
                    method: Default::default(),
                    extensions: inject_session_into_extensions(Default::default()),
                }),
                cancel_token,
            )
            .await?;

        match res {
            ServerResult::ReadResourceResult(result) => Ok(result),
            _ => Err(ServiceError::UnexpectedResponse),
        }
    }

    async fn list_tools(
        &self,
        cursor: Option<String>,
        cancel_token: CancellationToken,
    ) -> Result<ListToolsResult, Error> {
        let res = self
            .send_request(
                ClientRequest::ListToolsRequest(ListToolsRequest {
                    params: Some(PaginatedRequestParam { cursor }),
                    method: Default::default(),
                    extensions: inject_session_into_extensions(Default::default()),
                }),
                cancel_token,
            )
            .await?;

        match res {
            ServerResult::ListToolsResult(result) => Ok(result),
            _ => Err(ServiceError::UnexpectedResponse),
        }
    }

    async fn call_tool(
        &self,
        name: &str,
        arguments: Option<JsonObject>,
        cancel_token: CancellationToken,
    ) -> Result<CallToolResult, Error> {
        let res = self
            .send_request(
                ClientRequest::CallToolRequest(CallToolRequest {
                    params: CallToolRequestParam {
                        name: name.to_string().into(),
                        arguments,
                    },
                    method: Default::default(),
                    extensions: inject_session_into_extensions(Default::default()),
                }),
                cancel_token,
            )
            .await?;

        match res {
            ServerResult::CallToolResult(result) => Ok(result),
            _ => Err(ServiceError::UnexpectedResponse),
        }
    }

    async fn list_prompts(
        &self,
        cursor: Option<String>,
        cancel_token: CancellationToken,
    ) -> Result<ListPromptsResult, Error> {
        let res = self
            .send_request(
                ClientRequest::ListPromptsRequest(ListPromptsRequest {
                    params: Some(PaginatedRequestParam { cursor }),
                    method: Default::default(),
                    extensions: inject_session_into_extensions(Default::default()),
                }),
                cancel_token,
            )
            .await?;

        match res {
            ServerResult::ListPromptsResult(result) => Ok(result),
            _ => Err(ServiceError::UnexpectedResponse),
        }
    }

    async fn get_prompt(
        &self,
        name: &str,
        arguments: Value,
        cancel_token: CancellationToken,
    ) -> Result<GetPromptResult, Error> {
        let arguments = match arguments {
            Value::Object(map) => Some(map),
            _ => None,
        };
        let res = self
            .send_request(
                ClientRequest::GetPromptRequest(GetPromptRequest {
                    params: GetPromptRequestParam {
                        name: name.to_string(),
                        arguments,
                    },
                    method: Default::default(),
                    extensions: inject_session_into_extensions(Default::default()),
                }),
                cancel_token,
            )
            .await?;

        match res {
            ServerResult::GetPromptResult(result) => Ok(result),
            _ => Err(ServiceError::UnexpectedResponse),
        }
    }

    async fn subscribe(&self) -> mpsc::Receiver<ServerNotification> {
        let (tx, rx) = mpsc::channel(16);
        self.notification_subscribers.lock().await.push(tx);
        rx
    }
}

/// Replaces session ID, case-insensitively, in Extensions._meta.
fn inject_session_into_extensions(
    mut extensions: rmcp::model::Extensions,
) -> rmcp::model::Extensions {
    use rmcp::model::Meta;

    if let Some(session_id) = crate::session_context::current_session_id() {
        let mut meta_map = extensions
            .get::<Meta>()
            .map(|meta| meta.0.clone())
            .unwrap_or_default();

        // JsonObject is case-sensitive, so we use retain for case-insensitive removal
        meta_map.retain(|k, _| !k.eq_ignore_ascii_case(SESSION_ID_HEADER));

        meta_map.insert(SESSION_ID_HEADER.to_string(), Value::String(session_id));

        extensions.insert(Meta(meta_map));
    }

    extensions
}

#[cfg(test)]
mod tests {
    use super::*;
    use rmcp::model::Meta;

    #[tokio::test]
    async fn test_session_id_in_mcp_meta() {
        use serde_json::json;

        let session_id = "test-session-789";
        crate::session_context::with_session_id(Some(session_id.to_string()), async {
            let extensions = inject_session_into_extensions(Default::default());
            let meta = extensions.get::<Meta>().unwrap();

            assert_eq!(
                &meta.0,
                json!({
                    SESSION_ID_HEADER: session_id
                })
                .as_object()
                .unwrap()
            );
        })
        .await;
    }

    #[tokio::test]
    async fn test_no_session_id_in_mcp_when_absent() {
        let extensions = inject_session_into_extensions(Default::default());
        let meta = extensions.get::<Meta>();

        assert!(meta.is_none());
    }

    #[tokio::test]
    async fn test_all_mcp_operations_include_session() {
        use serde_json::json;

        let session_id = "consistent-session-id";
        crate::session_context::with_session_id(Some(session_id.to_string()), async {
            let ext1 = inject_session_into_extensions(Default::default());
            let ext2 = inject_session_into_extensions(Default::default());
            let ext3 = inject_session_into_extensions(Default::default());

            for ext in [&ext1, &ext2, &ext3] {
                assert_eq!(
                    &ext.get::<Meta>().unwrap().0,
                    json!({
                        SESSION_ID_HEADER: session_id
                    })
                    .as_object()
                    .unwrap()
                );
            }
        })
        .await;
    }

    #[tokio::test]
    async fn test_session_id_case_insensitive_replacement() {
        use rmcp::model::{Extensions, Meta};
        use serde_json::{from_value, json};

        let session_id = "new-session-id";
        crate::session_context::with_session_id(Some(session_id.to_string()), async {
            let mut extensions = Extensions::new();
            extensions.insert(
                from_value::<Meta>(json!({
                    "ASTER-SESSION-ID": "old-session-1",
                    "Aster-Session-Id": "old-session-2",
                    "other-key": "preserve-me"
                }))
                .unwrap(),
            );

            let extensions = inject_session_into_extensions(extensions);
            let meta = extensions.get::<Meta>().unwrap();

            assert_eq!(
                &meta.0,
                json!({
                    SESSION_ID_HEADER: session_id,
                    "other-key": "preserve-me"
                })
                .as_object()
                .unwrap()
            );
        })
        .await;
    }
}
