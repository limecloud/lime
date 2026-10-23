//! Canonical memory preferences govern use and generation independently.
use super::{RuntimeCore, RuntimeCoreError};
use agent_protocol::thread::ThreadItemPayload;
use async_trait::async_trait;
use lime_core::config::{ConfigManager, MemoryConfig};

impl RuntimeCore {
    pub(super) fn memory_config(&self) -> Option<MemoryConfig> {
        match ConfigManager::load(&self.app_config_path) {
            Ok(manager) => Some(manager.config().memory.clone()),
            Err(error) => {
                tracing::warn!(%error, "memory preferences unavailable; disabling memory");
                None
            }
        }
    }

    pub(super) fn session_memory_generation_enabled(&self, session_id: &str) -> bool {
        self.session_memory_enabled(session_id)
            && self
                .memory_config()
                .is_some_and(|config| config.auto.enabled)
    }
}

#[async_trait]
impl crate::memory_store::MemorySourcePolicy for RuntimeCore {
    async fn source_eligible(
        &self,
        source_thread_id: Option<&str>,
    ) -> Result<bool, RuntimeCoreError> {
        let Some(config) = self.memory_config() else {
            return Ok(false);
        };
        if !config.enabled || !config.auto.enabled {
            return Ok(false);
        }
        let Some(thread_id) = source_thread_id else {
            // Unattributed imported candidates cannot establish tool eligibility.
            return Ok(!config.disable_on_external_context);
        };
        let read = match self
            .read_thread(app_server_protocol::ThreadReadParams {
                thread_id: thread_id.into(),
                turns_view: agent_protocol::ThreadTurnsView::Full,
            })
            .await
        {
            Ok(read) => read,
            Err(error) => {
                tracing::debug!(%thread_id, %error, "unavailable source thread excluded from memory");
                return Ok(false);
            }
        };
        if read
            .thread
            .metadata
            .get("memoryMode")
            .or_else(|| read.thread.metadata.get("memory_mode"))
            .and_then(serde_json::Value::as_str)
            .is_some_and(|mode| matches!(mode, "disabled" | "polluted"))
        {
            return Ok(false);
        }
        Ok(!config.disable_on_external_context
            || !read
                .thread
                .turns
                .iter()
                .flat_map(|turn| &turn.items)
                .any(|item| uses_external_context(&item.payload)))
    }
}

fn uses_external_context(payload: &ThreadItemPayload) -> bool {
    match payload {
        ThreadItemPayload::McpToolCall { .. } => true,
        ThreadItemPayload::Tool { name, .. } => {
            name.starts_with("mcp__")
                || matches!(
                    name.as_str(),
                    "web_search" | "webSearch" | "search_query" | "WebSearch" | "WebSearchTool"
                )
        }
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn local_tools_are_not_external_context() {
        for (name, expected) in [
            ("shell", false),
            ("read_file", false),
            ("web_search", true),
            ("mcp__browser__read", true),
        ] {
            assert_eq!(
                uses_external_context(&ThreadItemPayload::Tool {
                    call_id: "call".into(),
                    name: name.into(),
                    arguments: vec![],
                    output: None,
                }),
                expected
            );
        }
    }
}
