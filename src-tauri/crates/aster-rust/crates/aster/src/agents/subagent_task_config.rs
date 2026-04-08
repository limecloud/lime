use crate::agents::ExtensionConfig;
use crate::providers::base::Provider;
use crate::session::TurnContextOverride;
use std::env;
use std::fmt;
use std::path::{Path, PathBuf};
use std::sync::Arc;

/// Default maximum number of turns for task execution
pub const DEFAULT_SUBAGENT_MAX_TURNS: usize = 25;

/// Environment variable name for configuring max turns
pub const ASTER_SUBAGENT_MAX_TURNS_ENV_VAR: &str = "ASTER_SUBAGENT_MAX_TURNS";

/// Configuration for task execution with all necessary dependencies
#[derive(Clone)]
pub struct TaskConfig {
    pub provider: Arc<dyn Provider>,
    pub parent_session_id: String,
    pub parent_working_dir: PathBuf,
    pub extensions: Vec<ExtensionConfig>,
    pub max_turns: Option<usize>,
    pub turn_context: Option<TurnContextOverride>,
}

impl fmt::Debug for TaskConfig {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("TaskConfig")
            .field("provider", &"<dyn Provider>")
            .field("parent_session_id", &self.parent_session_id)
            .field("parent_working_dir", &self.parent_working_dir)
            .field("max_turns", &self.max_turns)
            .field("extensions", &self.extensions)
            .field("turn_context", &self.turn_context)
            .finish()
    }
}

impl TaskConfig {
    fn inherited_subagent_turn_context() -> Option<TurnContextOverride> {
        let mut turn_context = crate::session_context::current_turn_context()?;
        turn_context.output_schema = None;
        turn_context.output_schema_source = None;
        turn_context.metadata.clear();

        if turn_context.cwd.is_none()
            && turn_context.model.is_none()
            && turn_context.effort.is_none()
            && turn_context.approval_policy.is_none()
            && turn_context.sandbox_policy.is_none()
            && turn_context.collaboration_mode.is_none()
        {
            None
        } else {
            Some(turn_context)
        }
    }

    pub fn new(
        provider: Arc<dyn Provider>,
        parent_session_id: &str,
        parent_working_dir: &Path,
        extensions: Vec<ExtensionConfig>,
    ) -> Self {
        Self {
            provider,
            parent_session_id: parent_session_id.to_owned(),
            parent_working_dir: parent_working_dir.to_owned(),
            extensions,
            max_turns: Some(
                env::var(ASTER_SUBAGENT_MAX_TURNS_ENV_VAR)
                    .ok()
                    .and_then(|val| val.parse::<usize>().ok())
                    .unwrap_or(DEFAULT_SUBAGENT_MAX_TURNS),
            ),
            turn_context: Self::inherited_subagent_turn_context(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::providers::testprovider::TestProvider;
    use serde_json::json;

    #[tokio::test]
    async fn task_config_inherits_parent_turn_context_without_output_contract() {
        let provider = Arc::new(
            TestProvider::new_replaying("/tmp/aster-subagent-task-config.json").expect("provider"),
        );
        let parent_turn_context = TurnContextOverride {
            cwd: Some(PathBuf::from("/tmp/workspace/subdir")),
            model: Some("gpt-5.4".to_string()),
            effort: Some("high".to_string()),
            approval_policy: Some("never".to_string()),
            sandbox_policy: Some("workspace-write".to_string()),
            collaboration_mode: Some("plan".to_string()),
            output_schema: Some(json!({
                "type": "object",
                "properties": {
                    "answer": {"type": "string"}
                }
            })),
            metadata: std::collections::HashMap::from([(
                "provider_continuation".to_string(),
                json!({"previous_response_id": "resp-1"}),
            )]),
            ..TurnContextOverride::default()
        };

        let task_config =
            crate::session_context::with_turn_context(Some(parent_turn_context), async move {
                TaskConfig::new(
                    provider,
                    "parent-session-1",
                    Path::new("/tmp/workspace"),
                    Vec::new(),
                )
            })
            .await;

        let inherited = task_config
            .turn_context
            .expect("expected inherited turn context");
        assert_eq!(inherited.cwd, Some(PathBuf::from("/tmp/workspace/subdir")));
        assert_eq!(inherited.model.as_deref(), Some("gpt-5.4"));
        assert_eq!(inherited.effort.as_deref(), Some("high"));
        assert_eq!(inherited.approval_policy.as_deref(), Some("never"));
        assert_eq!(inherited.sandbox_policy.as_deref(), Some("workspace-write"));
        assert_eq!(inherited.collaboration_mode.as_deref(), Some("plan"));
        assert!(inherited.output_schema.is_none());
        assert!(inherited.output_schema_source.is_none());
        assert!(inherited.metadata.is_empty());
    }
}
