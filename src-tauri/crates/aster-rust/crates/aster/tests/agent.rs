use std::sync::Arc;

use anyhow::Result;
use aster::agents::{Agent, AgentEvent};
use futures::StreamExt;

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(test)]
    mod schedule_tool_tests {
        use super::*;
        use aster::scheduler::{ScheduledJob, SchedulerError};
        use aster::scheduler_trait::SchedulerTrait;
        use aster::session::Session;
        use async_trait::async_trait;
        use chrono::{DateTime, Utc};
        use std::path::PathBuf;
        use std::sync::Arc;

        const CRON_CREATE_TOOL_NAME: &str = "CronCreate";
        const CRON_LIST_TOOL_NAME: &str = "CronList";
        const CRON_DELETE_TOOL_NAME: &str = "CronDelete";

        struct MockScheduler {
            jobs: tokio::sync::Mutex<Vec<ScheduledJob>>,
        }

        impl MockScheduler {
            fn new() -> Self {
                Self {
                    jobs: tokio::sync::Mutex::new(Vec::new()),
                }
            }
        }

        #[async_trait]
        impl SchedulerTrait for MockScheduler {
            async fn add_scheduled_job(
                &self,
                job: ScheduledJob,
                _copy: bool,
            ) -> Result<(), SchedulerError> {
                let mut jobs = self.jobs.lock().await;
                jobs.push(job);
                Ok(())
            }

            async fn schedule_recipe(
                &self,
                _recipe_path: PathBuf,
                _cron_schedule: Option<String>,
            ) -> Result<(), SchedulerError> {
                Ok(())
            }

            async fn list_scheduled_jobs(&self) -> Vec<ScheduledJob> {
                let jobs = self.jobs.lock().await;
                jobs.clone()
            }

            async fn remove_scheduled_job(
                &self,
                id: &str,
                _remove: bool,
            ) -> Result<(), SchedulerError> {
                let mut jobs = self.jobs.lock().await;
                if let Some(pos) = jobs.iter().position(|job| job.id == id) {
                    jobs.remove(pos);
                    Ok(())
                } else {
                    Err(SchedulerError::JobNotFound(id.to_string()))
                }
            }

            async fn pause_schedule(&self, _id: &str) -> Result<(), SchedulerError> {
                Ok(())
            }

            async fn unpause_schedule(&self, _id: &str) -> Result<(), SchedulerError> {
                Ok(())
            }

            async fn run_now(&self, _id: &str) -> Result<String, SchedulerError> {
                Ok("test_session_123".to_string())
            }

            async fn sessions(
                &self,
                _sched_id: &str,
                _limit: usize,
            ) -> Result<Vec<(String, Session)>, SchedulerError> {
                Ok(vec![])
            }

            async fn update_schedule(
                &self,
                _sched_id: &str,
                _new_cron: String,
            ) -> Result<(), SchedulerError> {
                Ok(())
            }

            async fn kill_running_job(&self, _sched_id: &str) -> Result<(), SchedulerError> {
                Ok(())
            }

            async fn get_running_job_info(
                &self,
                _sched_id: &str,
            ) -> Result<Option<(String, DateTime<Utc>)>, SchedulerError> {
                Ok(None)
            }
        }

        #[tokio::test]
        async fn test_schedule_management_tool_list() {
            let agent = Agent::new();
            let mock_scheduler = Arc::new(MockScheduler::new());
            agent.set_scheduler(mock_scheduler.clone()).await;

            // Test that the current cron tools are available in the tools list
            let tools = agent.list_tools(None).await;
            let create_tool = tools.iter().find(|tool| tool.name == CRON_CREATE_TOOL_NAME);
            let list_tool = tools.iter().find(|tool| tool.name == CRON_LIST_TOOL_NAME);
            let delete_tool = tools.iter().find(|tool| tool.name == CRON_DELETE_TOOL_NAME);

            assert!(create_tool.is_some());
            assert!(list_tool.is_some());
            assert!(delete_tool.is_some());

            assert!(create_tool
                .unwrap()
                .description
                .clone()
                .unwrap_or_default()
                .contains("Schedule a prompt to run"));
            assert!(list_tool
                .unwrap()
                .description
                .clone()
                .unwrap_or_default()
                .contains("List scheduled cron jobs"));
            assert!(delete_tool
                .unwrap()
                .description
                .clone()
                .unwrap_or_default()
                .contains("Cancel a scheduled cron job"));
        }

        #[tokio::test]
        async fn test_schedule_management_tool_no_scheduler() {
            let agent = Agent::new();
            // Don't set scheduler - verify the current cron tools are NOT available without scheduler
            // This is the expected behavior: these tools require scheduler service

            let tools = agent.list_tools(None).await;
            assert!(
                tools.iter().all(|tool| {
                    tool.name != CRON_CREATE_TOOL_NAME
                        && tool.name != CRON_LIST_TOOL_NAME
                        && tool.name != CRON_DELETE_TOOL_NAME
                }),
                "Current cron tools should NOT be available without scheduler"
            );
        }

        #[tokio::test]
        async fn test_schedule_management_tool_in_current_surface() {
            let agent = Agent::new();
            let mock_scheduler = Arc::new(MockScheduler::new());
            agent.set_scheduler(mock_scheduler.clone()).await;

            let tools = agent.list_tools(None).await;

            // Check that the current cron create tool is included in the current surface
            let create_tool = tools.iter().find(|tool| tool.name == CRON_CREATE_TOOL_NAME);
            assert!(create_tool.is_some());

            let tool = create_tool.unwrap();
            assert!(tool
                .description
                .clone()
                .unwrap_or_default()
                .contains("Schedule a prompt to run"));

            // Verify the create schema exposes the expected fields
            if let Some(properties) = tool.input_schema.get("properties") {
                assert!(properties.get("cron").is_some());
                assert!(properties.get("prompt").is_some());
                assert!(properties.get("recurring").is_some());
                assert!(properties.get("durable").is_some());
            }
        }

        #[tokio::test]
        async fn test_schedule_management_tool_schema_validation() {
            let agent = Agent::new();
            let mock_scheduler = Arc::new(MockScheduler::new());
            agent.set_scheduler(mock_scheduler.clone()).await;

            let tools = agent.list_tools(None).await;
            let delete_tool = tools.iter().find(|tool| tool.name == CRON_DELETE_TOOL_NAME);
            assert!(delete_tool.is_some());

            let tool = delete_tool.unwrap();

            // Verify the delete schema requires an id parameter
            if let Some(properties) = tool.input_schema.get("properties") {
                assert!(properties.get("id").is_some());

                if let Some(id_prop) = properties.get("id") {
                    assert_eq!(id_prop.get("type").unwrap().as_str().unwrap(), "string");
                    assert!(id_prop
                        .get("description")
                        .unwrap()
                        .as_str()
                        .unwrap()
                        .contains("Job ID returned by CronCreate"));
                }
            }
        }
    }

    #[cfg(test)]
    mod retry_tests {
        use super::*;
        use aster::agents::types::{RetryConfig, SuccessCheck};

        #[tokio::test]
        async fn test_retry_success_check_execution() -> Result<()> {
            use aster::agents::retry::execute_success_checks;

            let retry_config = RetryConfig {
                max_retries: 3,
                checks: vec![],
                on_failure: None,
                timeout_seconds: Some(30),
                on_failure_timeout_seconds: Some(60),
            };

            let success_checks = vec![SuccessCheck::Shell {
                command: "echo 'test'".to_string(),
            }];

            let result = execute_success_checks(&success_checks, &retry_config).await;
            assert!(result.is_ok(), "Success check should pass");
            assert!(result.unwrap(), "Command should succeed");

            let fail_checks = vec![SuccessCheck::Shell {
                command: "false".to_string(),
            }];

            let result = execute_success_checks(&fail_checks, &retry_config).await;
            assert!(result.is_ok(), "Success check execution should not error");
            assert!(!result.unwrap(), "Command should fail");

            Ok(())
        }

        #[tokio::test]
        async fn test_retry_logic_with_validation_errors() -> Result<()> {
            let invalid_retry_config = RetryConfig {
                max_retries: 0,
                checks: vec![],
                on_failure: None,
                timeout_seconds: Some(0),
                on_failure_timeout_seconds: None,
            };

            let validation_result = invalid_retry_config.validate();
            assert!(
                validation_result.is_err(),
                "Should validate max_retries > 0"
            );
            assert!(validation_result
                .unwrap_err()
                .contains("max_retries must be greater than 0"));

            Ok(())
        }

        #[tokio::test]
        async fn test_retry_attempts_counter_reset() -> Result<()> {
            let agent = Agent::new();

            agent.reset_retry_attempts().await;
            let initial_attempts = agent.get_retry_attempts().await;
            assert_eq!(initial_attempts, 0);

            let new_attempts = agent.increment_retry_attempts().await;
            assert_eq!(new_attempts, 1);

            agent.reset_retry_attempts().await;
            let reset_attempts = agent.get_retry_attempts().await;
            assert_eq!(reset_attempts, 0);

            Ok(())
        }
    }

    #[cfg(test)]
    mod max_turns_tests {
        use super::*;
        use aster::agents::SessionConfig;
        use aster::conversation::message::{Message, MessageContent};
        use aster::model::ModelConfig;
        use aster::providers::base::{Provider, ProviderMetadata, ProviderUsage, Usage};
        use aster::providers::errors::ProviderError;
        use aster::session::session_manager::SessionType;
        use aster::session::SessionManager;
        use async_trait::async_trait;
        use rmcp::model::{CallToolRequestParam, Tool};
        use rmcp::object;
        use std::path::PathBuf;

        struct MockToolProvider {}

        impl MockToolProvider {
            fn new() -> Self {
                Self {}
            }
        }

        #[async_trait]
        impl Provider for MockToolProvider {
            async fn complete(
                &self,
                _system_prompt: &str,
                _messages: &[Message],
                _tools: &[Tool],
            ) -> Result<(Message, ProviderUsage), ProviderError> {
                let tool_call = CallToolRequestParam {
                    name: "test_tool".into(),
                    arguments: Some(object!({"param": "value"})),
                };
                let message = Message::assistant().with_tool_request("call_123", Ok(tool_call));

                let usage = ProviderUsage::new(
                    "mock-model".to_string(),
                    Usage::new(Some(10), Some(5), Some(15)),
                );

                Ok((message, usage))
            }

            async fn complete_with_model(
                &self,
                _model_config: &ModelConfig,
                system_prompt: &str,
                messages: &[Message],
                tools: &[Tool],
            ) -> anyhow::Result<(Message, ProviderUsage), ProviderError> {
                self.complete(system_prompt, messages, tools).await
            }

            fn get_model_config(&self) -> ModelConfig {
                ModelConfig::new("mock-model").unwrap()
            }

            fn metadata() -> ProviderMetadata {
                ProviderMetadata {
                    name: "mock".to_string(),
                    display_name: "Mock Provider".to_string(),
                    description: "Mock provider for testing".to_string(),
                    default_model: "mock-model".to_string(),
                    known_models: vec![],
                    model_doc_link: "".to_string(),
                    config_keys: vec![],
                }
            }

            fn get_name(&self) -> &str {
                "mock-test"
            }
        }

        #[tokio::test]
        async fn test_max_turns_limit() -> Result<()> {
            let agent = Agent::new();
            let provider = Arc::new(MockToolProvider::new());
            let user_message = Message::user().with_text("Hello");

            let session = SessionManager::create_session(
                PathBuf::default(),
                "max-turn-test".to_string(),
                SessionType::Hidden,
            )
            .await?;

            agent.update_provider(provider, &session.id).await?;

            let session_config = SessionConfig {
                id: session.id,
                thread_id: None,
                turn_id: None,
                schedule_id: None,
                max_turns: Some(1),
                retry_config: None,
                system_prompt: None,
                include_context_trace: None,
                turn_context: None,
            };

            let reply_stream = agent.reply(user_message, session_config, None).await?;
            tokio::pin!(reply_stream);

            let mut responses = Vec::new();
            while let Some(response_result) = reply_stream.next().await {
                match response_result {
                    Ok(AgentEvent::TurnStarted { .. })
                    | Ok(AgentEvent::ItemStarted { .. })
                    | Ok(AgentEvent::ItemUpdated { .. })
                    | Ok(AgentEvent::ItemCompleted { .. })
                    | Ok(AgentEvent::ContextCompactionStarted { .. })
                    | Ok(AgentEvent::ContextCompactionCompleted { .. })
                    | Ok(AgentEvent::ContextCompactionWarning { .. }) => {}
                    Ok(AgentEvent::Message(response)) => {
                        if let Some(MessageContent::ActionRequired(action)) =
                            response.content.first()
                        {
                            if let aster::conversation::message::ActionRequiredData::ToolConfirmation { id, .. } = &action.data {
                                agent.handle_confirmation(
                                    id.clone(),
                                    aster::permission::PermissionConfirmation {
                                        principal_type: aster::permission::permission_confirmation::PrincipalType::Tool,
                                        permission: aster::permission::Permission::AllowOnce,
                                    }
                                ).await;
                            }
                        }
                        responses.push(response);
                    }
                    Ok(AgentEvent::McpNotification(_)) => {}
                    Ok(AgentEvent::ModelChange { .. }) => {}
                    Ok(AgentEvent::HistoryReplaced(_updated_conversation)) => {
                        // We should update the conversation here, but we're not reading it
                    }
                    Ok(AgentEvent::ContextTrace { .. }) => {}
                    Err(e) => {
                        return Err(e);
                    }
                }
            }

            assert!(
                !responses.is_empty(),
                "Expected at least 1 response, got {}",
                responses.len()
            );

            // Look for the max turns message as the last response
            let last_response = responses.last().unwrap();
            let last_content = last_response.content.first().unwrap();
            if let MessageContent::Text(text_content) = last_content {
                assert!(text_content.text.contains(
                    "I've reached the maximum number of actions I can do without user input"
                ));
            } else {
                panic!("Expected text content in last message");
            }
            Ok(())
        }
    }

    #[cfg(test)]
    mod extension_manager_tests {
        use super::*;
        use aster::agents::extension::{ExtensionConfig, PlatformExtensionContext};
        use aster::agents::extension_manager_extension::{
            MANAGE_EXTENSIONS_TOOL_NAME, SEARCH_AVAILABLE_EXTENSIONS_TOOL_NAME,
        };

        async fn setup_agent_with_extension_manager() -> Agent {
            let agent = Agent::new();

            agent
                .extension_manager
                .set_context(PlatformExtensionContext {
                    session_id: Some("test_session".to_string()),
                    extension_manager: Some(Arc::downgrade(&agent.extension_manager)),
                })
                .await;

            // Now add the extension manager platform extension
            let ext_config = ExtensionConfig::Platform {
                name: "extensionmanager".to_string(),
                description: "Extension Manager".to_string(),
                bundled: Some(true),
                available_tools: vec![],
                deferred_loading: false,
                always_expose_tools: vec![],
                allowed_caller: None,
            };

            agent
                .add_extension(ext_config)
                .await
                .expect("Failed to add extension manager");
            agent
        }

        #[tokio::test]
        async fn test_extension_manager_tools_available() {
            let agent = setup_agent_with_extension_manager().await;
            let tools = agent.list_tools(None).await;

            // Note: Tool names are prefixed with the normalized extension name "extensionmanager"
            // not the display name "Extension Manager"
            let search_tool = tools.iter().find(|tool| {
                tool.name == format!("extensionmanager__{SEARCH_AVAILABLE_EXTENSIONS_TOOL_NAME}")
            });
            assert!(
                search_tool.is_some(),
                "search_available_extensions tool should be available"
            );

            let manage_tool = tools.iter().find(|tool| {
                tool.name == format!("extensionmanager__{MANAGE_EXTENSIONS_TOOL_NAME}")
            });
            assert!(
                manage_tool.is_some(),
                "manage_extensions tool should be available"
            );
        }
    }
}
