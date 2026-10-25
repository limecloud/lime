use super::{RuntimeCore, RuntimeCoreError, RuntimeHostContext, TurnStartRequest};
use app_server_protocol::{
    AgentSessionReadParams, AgentSessionStartParams, BusinessObjectRef, RuntimeOptions,
    RuntimeRequest,
};
use async_trait::async_trait;
use lime_gateway::agent_runner::{
    GatewayAgentRunRequest, GatewayAgentRunResponse, GatewayAgentRunner,
};
use serde_json::json;
use std::sync::Arc;

pub struct RuntimeGatewayAgentRunner {
    runtime: Arc<RuntimeCore>,
}

impl RuntimeGatewayAgentRunner {
    pub fn new(runtime: Arc<RuntimeCore>) -> Self {
        Self { runtime }
    }
}

#[async_trait]
impl GatewayAgentRunner for RuntimeGatewayAgentRunner {
    async fn run_agent_turn(
        &self,
        request: GatewayAgentRunRequest,
    ) -> Result<GatewayAgentRunResponse, String> {
        let runtime = self.runtime.clone();
        ensure_gateway_session(&runtime, &request)?;
        let output = runtime
            .start_turn(
                TurnStartRequest {
                    session_id: request.session_id.clone(),
                    turn_id: None,
                    input: vec![agent_protocol::AgentInput::text(request.input_text.clone())],
                    runtime_options: Some(RuntimeOptions {
                        stream: false,
                        runtime_request: Some(RuntimeRequest {
                            provider_preference: request.provider_preference.clone(),
                            model_preference: request.model_preference.clone(),
                            metadata: Some(request.metadata.clone()),
                            ..RuntimeRequest::default()
                        }),
                        ..RuntimeOptions::default()
                    }),
                    queue_if_busy: true,
                    skip_pre_submit_resume: false,
                },
                RuntimeHostContext {
                    connection_id: None,
                    client_name: Some(format!("gateway-{}", request.channel)),
                    client_version: None,
                },
            )
            .await
            .map_err(runtime_error_message)?;
        let read = runtime
            .read_session_current(AgentSessionReadParams {
                session_id: request.session_id.clone(),
                history_limit: None,
                history_offset: None,
                history_before_message_id: None,
            })
            .await
            .map_err(runtime_error_message)?;
        Ok(GatewayAgentRunResponse {
            session_id: request.session_id,
            turn_id: output.response.turn.turn_id,
            reply_text: latest_assistant_text(read.detail.as_ref()).unwrap_or_default(),
        })
    }
}

fn ensure_gateway_session(
    runtime: &RuntimeCore,
    request: &GatewayAgentRunRequest,
) -> Result<(), String> {
    match runtime.start_session(AgentSessionStartParams {
        session_id: Some(request.session_id.clone()),
        thread_id: Some(format!("thread:{}", request.session_id)),
        app_id: "gateway-channel".to_string(),
        workspace_id: None,
        business_object_ref: Some(BusinessObjectRef {
            kind: "gateway.channel.session".to_string(),
            id: request.session_id.clone(),
            title: Some(format!("{} {}", request.channel, request.account_id)),
            uri: None,
            metadata: Some(json!({
                "source": "gateway_channel",
                "channel": request.channel,
                "accountId": request.account_id,
                "hiddenFromUserRecents": false,
            })),
        }),
        locale: None,
    }) {
        Ok(_) | Err(RuntimeCoreError::SessionAlreadyExists(_)) => Ok(()),
        Err(error) => Err(runtime_error_message(error)),
    }
}

fn latest_assistant_text(detail: Option<&serde_json::Value>) -> Option<String> {
    let messages = detail?.get("messages")?.as_array()?;
    messages.iter().rev().find_map(|message| {
        if message.get("role").and_then(serde_json::Value::as_str) != Some("assistant") {
            return None;
        }
        let content = message.get("content")?.as_array()?;
        let text = content
            .iter()
            .filter(|item| item.get("type").and_then(serde_json::Value::as_str) == Some("text"))
            .filter_map(|item| item.get("text").and_then(serde_json::Value::as_str))
            .collect::<String>();
        let text = text.trim();
        if text.is_empty() {
            None
        } else {
            Some(text.to_string())
        }
    })
}

fn runtime_error_message(error: RuntimeCoreError) -> String {
    error.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn latest_assistant_text_reads_last_assistant_message() {
        let detail = json!({
            "messages": [
                {"role": "assistant", "content": [{"type": "text", "text": "old"}]},
                {"role": "user", "content": [{"type": "text", "text": "question"}]},
                {"role": "assistant", "content": [{"type": "text", "text": "new"}]}
            ]
        });
        assert_eq!(latest_assistant_text(Some(&detail)).as_deref(), Some("new"));
    }

    #[test]
    fn latest_assistant_text_ignores_blank_messages() {
        let detail = json!({
            "messages": [
                {"role": "assistant", "content": [{"type": "text", "text": "  "}]}
            ]
        });
        assert_eq!(latest_assistant_text(Some(&detail)), None);
    }
}
