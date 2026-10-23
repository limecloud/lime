use super::*;
use app_server_protocol::protocol::v2::ThreadSettingsUpdateParams;

impl RequestProcessor {
    pub(super) async fn apply_turn_settings(
        &self,
        params: &TurnStartParams,
    ) -> Result<Option<JsonRpcNotification>, JsonRpcError> {
        if params.service_tier.is_none()
            && params.summary.is_none()
            && params.approvals_reviewer.is_none()
            && params.cwd.is_none()
            && params.runtime_workspace_roots.is_none()
        {
            return Ok(None);
        }
        // Validate the tier together with this turn's model selection through
        // the existing actor and durable settings owner.
        let thread_settings = self
            .runtime
            .update_thread_context(
                ThreadSettingsUpdateParams {
                    thread_id: params.thread_id.clone(),
                    cwd: params.cwd.clone(),
                    model: params.model.clone(),
                    effort: params.effort.clone(),
                    collaboration_mode: params.collaboration_mode.clone(),
                    service_tier: params.service_tier.clone(),
                    summary: params.summary.clone().map(Value::String),
                    approvals_reviewer: params.approvals_reviewer,
                    ..ThreadSettingsUpdateParams::default()
                },
                params.runtime_workspace_roots.clone(),
            )
            .await
            .map_err(to_jsonrpc_error)?;
        self.refresh_thread_skill_watch(&params.thread_id).await;
        Ok(Some(
            V2ServerNotification::ThreadSettingsUpdated(ThreadSettingsUpdatedNotification {
                thread_id: params.thread_id.clone(),
                thread_settings,
            })
            .into(),
        ))
    }
}
