use super::{
    current_agent_runtime_config_metadata, model_route_contract,
    request_context::{
        request_tool_policy_from_request, runtime_request_from_request,
        session_config_from_request_with_plugins_and_orchestrator, session_scope_from_request,
    },
    RuntimeBackend,
};
use crate::{ExecutionRequest, ProviderTurnHistory, RuntimeCoreError};
use model_provider::current_client::{
    CurrentProviderContent, CurrentProviderMessage, CurrentProviderRequest,
    CurrentProviderRequestMetadata,
};
use tokio_util::sync::CancellationToken;

impl RuntimeBackend {
    pub(super) async fn summarize_context(
        &self,
        request: ExecutionRequest,
        history: ProviderTurnHistory,
        cancellation: CancellationToken,
    ) -> Result<String, RuntimeCoreError> {
        let route = self.resolve_turn_route(&request).await?;
        if let Some(failure) = route.resolution.resolved_route.failure.as_ref() {
            return Err(super::runtime_error_from_route_failure(
                &request.session.session_id,
                &route.selection,
                failure,
            ));
        }
        let host_request = runtime_request_from_request(&request);
        let scope = session_scope_from_request(&request)?;
        let policy = request_tool_policy_from_request(host_request.as_ref());
        let config = session_config_from_request_with_plugins_and_orchestrator(
            &request,
            host_request.as_ref(),
            &scope,
            &route.selection,
            &policy,
            super::merge_route_model_metadata(
                current_agent_runtime_config_metadata(),
                route.resolution.decision_payload.get("modelRegistry"),
            ),
            &self.current_plugin_turn_snapshots().await?,
            &self.current_market_skills().await?,
        );
        let configuration = model_route_contract::provider_configuration_from_runtime(
            &route.selection,
            &route.resolution.resolved_route,
            route.resolution.decision_payload.get("modelRegistry"),
            route.direct_provider_config,
            host_request
                .as_ref()
                .and_then(|request| request.service_tier.clone()),
        );
        let mut messages =
            history.messages_for_route(&route.selection.provider, &route.selection.model);
        messages.push(CurrentProviderMessage::user(vec![
            CurrentProviderContent::Text(lime_agent::SUMMARIZATION_PROMPT.to_string()),
        ]));
        let metadata = CurrentProviderRequestMetadata::new(
            &request.session.session_id,
            &request.session.thread_id,
            &request.turn.turn_id,
            request.forked_from_thread_id,
        );
        let model_request_policy = lime_agent::runtime_reply_model_request_policy_from_turn_context(
            config.turn_context.as_ref(),
        );
        lime_agent::run_context_compaction_with_db(
            &self.agent_state,
            &route.db,
            configuration,
            CurrentProviderRequest::new(messages)
                .with_system_prompt(config.system_prompt)
                .with_model_request_policy(model_request_policy)
                .with_metadata(metadata),
            cancellation,
        )
        .await
        .map_err(RuntimeCoreError::Backend)
    }
}
