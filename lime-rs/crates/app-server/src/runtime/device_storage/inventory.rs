use super::*;
use agent_protocol::{SortDirection, Thread};
use std::collections::BTreeMap;
use thread_store::{ListThreadsParams, PageRequest};

impl RuntimeCore {
    pub(super) async fn storage_inventory(
        &self,
    ) -> Result<BTreeMap<String, Thread>, RuntimeCoreError> {
        let store = self.canonical_thread_store()?;
        let mut cursor = None;
        let mut seen_cursors = std::collections::HashSet::new();
        let mut result = BTreeMap::new();
        loop {
            let page = store
                .list_threads(ListThreadsParams {
                    include_archived: true,
                    page: PageRequest {
                        cursor,
                        limit: 100,
                        sort_direction: SortDirection::Asc,
                    },
                    section: None,
                    project: None,
                    sort_by_section_position: false,
                })
                .await
                .map_err(|e| RuntimeCoreError::Backend(e.to_string()))?;
            for thread in page.data {
                if result
                    .insert(thread.thread_id.to_string(), thread)
                    .is_some()
                {
                    return Err(RuntimeCoreError::Backend(
                        "storage thread inventory changed during pagination".into(),
                    ));
                }
            }
            match page.next_cursor {
                Some(next) if seen_cursors.insert(next.to_string()) => cursor = Some(next),
                Some(_) => {
                    return Err(RuntimeCoreError::Backend(
                        "storage thread pagination did not advance".into(),
                    ))
                }
                None => break,
            }
        }
        Ok(result)
    }
}

pub(super) fn local_source(thread: &Thread) -> bool {
    let source = ["source", "sourceKind", "source_kind"]
        .iter()
        .find_map(|key| {
            thread
                .metadata
                .get(*key)
                .and_then(serde_json::Value::as_str)
        })
        .unwrap_or("appServer");
    matches!(
        source,
        "appServer"
            | "app-server"
            | "app_server"
            | "mcp"
            | "cli"
            | "exec"
            | "vscode"
            | "subAgent"
            | "subagent"
            | "subAgentReview"
            | "subAgentCompact"
            | "subAgentThreadSpawn"
            | "subAgentOther"
    ) && !thread
        .metadata
        .get("threadSource")
        .and_then(serde_json::Value::as_str)
        .is_some_and(|source| matches!(source, "cloud" | "cloud_threads.create"))
}

pub(super) fn reviewable_root(thread: &Thread) -> bool {
    let source = thread
        .metadata
        .get("threadSource")
        .or_else(|| thread.metadata.get("thread_source"));
    match source {
        None | Some(serde_json::Value::Null) => true,
        Some(serde_json::Value::String(source)) => matches!(
            source.as_str(),
            "user"
                | "page_comment"
                | "agent_created_thread"
                | "agent_forked_thread"
                | "ambient_suggestion_task"
                | "avatar_quick_chat"
                | "chatgpt_handoff"
                | "code_review"
                | "codex_replay"
                | "conversation_digest"
                | "implement_todo"
                | "local_environment_configuration"
                | "mcp_app_follow_up"
                | "onboarding_checklist"
                | "security_remediation"
                | "security_scan"
                | "voice_chat"
        ),
        _ => false,
    }
}
