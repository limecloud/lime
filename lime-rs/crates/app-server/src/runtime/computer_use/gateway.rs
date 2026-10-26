use super::*;
use crate::runtime::{ExecutionRequest, RuntimeCoreEventAppender};
use async_trait::async_trait;
use std::path::PathBuf;
use tool_runtime::computer_use::{ComputerUseGateway, ComputerUseToolInput, ComputerUseToolScope};

struct TurnGateway {
    runtime: RuntimeCoreEventAppender,
    config_path: PathBuf,
    requirements_path: Option<PathBuf>,
}

impl RuntimeCore {
    pub(crate) fn install_computer_use_gateway(&self) -> Result<(), RuntimeCoreError> {
        self.backend.set_computer_use_gateway(Arc::new(TurnGateway {
            runtime: self.event_appender(),
            config_path: self.app_config_path.clone(),
            requirements_path: self.requirements_path.clone(),
        }))
    }

    pub(in crate::runtime) fn bind_computer_use_turn(
        &self,
        request: &ExecutionRequest,
    ) -> Result<(), RuntimeCoreError> {
        if request.internal_agent_policy.is_none() && request.is_root_agent {
            if let Some(connection) = request.host.connection_id.as_ref() {
                self.computer_use
                    .bind_turn(ComputerUseOwner {
                        connection: connection.clone(),
                        thread_id: request.session.thread_id.clone(),
                        turn_id: request.turn.turn_id.clone(),
                    })
                    .map_err(policy_error)?;
            }
        }
        Ok(())
    }
}

impl TurnGateway {
    fn active_thread(&self, scope: &ComputerUseToolScope<'_>) -> ComputerUseResult<String> {
        let state = self
            .runtime
            .state
            .lock()
            .map_err(|_| ComputerUseError::new("Runtime state is unavailable".into()))?;
        let stored = state
            .sessions
            .get(scope.session_id)
            .filter(|_| !state.shutting_down && !state.closing_sessions.contains(scope.session_id))
            .ok_or_else(|| {
                ComputerUseError::new("Computer Use requires a live canonical session".into())
            })?;
        let active = stored.turns.iter().any(|turn| {
            turn.turn_id == scope.turn_id
                && matches!(
                    turn.status,
                    AgentTurnStatus::Accepted
                        | AgentTurnStatus::Running
                        | AgentTurnStatus::WaitingAction
                )
        });
        if !active || scope.call_id.is_empty() {
            return Err(ComputerUseError::new(
                "Computer Use requires an active canonical turn and call".into(),
            ));
        }
        Ok(stored.session.thread_id.clone())
    }
}

#[async_trait]
impl ComputerUseGateway for TurnGateway {
    async fn execute(
        &self,
        scope: ComputerUseToolScope<'_>,
        input: ComputerUseToolInput,
    ) -> ComputerUseResult<serde_json::Value> {
        let thread_id = self.active_thread(&scope)?;
        let ComputerUseToolInput::Action { target, operation } = input else {
            let status = self
                .runtime
                .computer_use
                .status(
                    ComputerUseStatusParams {
                        adapter: None,
                        target: None,
                    },
                    || load_policy(&self.config_path, self.requirements_path.as_deref()),
                )
                .await?;
            return serde_json::to_value(status)
                .map_err(|error| ComputerUseError::new(error.to_string()));
        };
        self.runtime
            .computer_use
            .execute_for_turn(&thread_id, scope.turn_id, target, operation, || {
                load_policy(&self.config_path, self.requirements_path.as_deref())
            })
            .await
    }
}
