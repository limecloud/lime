use super::AgentRuntimeState;
use std::sync::Arc;
use tool_runtime::computer_use::ComputerUseGateway;

impl AgentRuntimeState {
    pub async fn register_computer_use_tools(
        &self,
        gateway: Arc<dyn ComputerUseGateway>,
    ) -> Result<(), String> {
        for registration in crate::native_tools::create_computer_use_tools(gateway) {
            self.register_native_tool(registration).await?;
        }
        Ok(())
    }
}
