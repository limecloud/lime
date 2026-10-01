//! All v2 thread consumers project the current durable settings, not the creation route.

use super::*;

pub(super) fn current_model_provider(thread: &canonical::Thread) -> &str {
    ["providerSelector", "providerName", "modelProvider"]
        .iter()
        .filter_map(|key| thread.metadata.get(*key).and_then(Value::as_str))
        .map(str::trim)
        .find(|provider| !provider.is_empty())
        .unwrap_or(&thread.model_provider)
}

pub(super) fn project_thread(thread: canonical::Thread) -> Result<v2::Thread, JsonRpcError> {
    let can_accept_direct_input = thread.parent_thread_id.is_none();
    let metadata = thread.metadata.clone();
    let model_provider = current_model_provider(&thread).to_string();
    let cwd = metadata_string(&metadata, &["workingDir", "working_dir", "cwd"]).unwrap_or_default();
    let source = project_session_source(
        metadata_string(&metadata, &["source", "sourceKind", "source_kind"])
            .as_deref()
            .unwrap_or("appServer"),
    );
    let git_info = project_git_info(&metadata);
    let history_mode = match metadata_string(&metadata, &["historyMode", "history_mode"]).as_deref()
    {
        Some("paginated") => v2::ThreadHistoryMode::Paginated,
        _ => v2::ThreadHistoryMode::Legacy,
    };
    let extra = (!metadata.is_null()).then_some(metadata.clone());

    Ok(v2::Thread {
        id: thread.thread_id.as_str().to_string(),
        extra,
        session_id: thread.session_id.as_str().to_string(),
        forked_from_id: thread
            .forked_from_id
            .map(|value| value.as_str().to_string()),
        parent_thread_id: thread
            .parent_thread_id
            .map(|value| value.as_str().to_string()),
        preview: thread.preview,
        ephemeral: metadata_bool(&thread.metadata, &["ephemeral"]).unwrap_or(false),
        section: project_thread_section(&thread.metadata),
        section_entered_at: metadata_i64(&thread.metadata, &["sectionEnteredAt"])
            .map(millis_to_seconds),
        project_id: metadata_string(&metadata, &["projectId", "project_id"]),
        history_mode,
        model_provider,
        created_at: millis_to_seconds(thread.created_at_ms),
        updated_at: millis_to_seconds(thread.updated_at_ms),
        recency_at: thread.recency_at_ms.map(millis_to_seconds),
        status: project_thread_status(thread.status),
        path: metadata_string(&thread.metadata, &["path", "rolloutPath", "rollout_path"])
            .map(PathBuf::from),
        cwd: PathBuf::from(cwd),
        cli_version: metadata_string(&thread.metadata, &["cliVersion", "cli_version"])
            .unwrap_or_else(|| env!("CARGO_PKG_VERSION").to_string()),
        source,
        can_accept_direct_input: Some(can_accept_direct_input),
        thread_source: metadata_string(&thread.metadata, &["threadSource", "thread_source"])
            .map(Into::into),
        agent_nickname: thread.agent_nickname,
        agent_role: thread.agent_role,
        git_info,
        name: thread.name,
        turns: thread
            .turns
            .into_iter()
            .map(project_turn)
            .collect::<Result<Vec<_>, _>>()?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn current_provider_is_shared_by_read_and_list_filter_without_mutating_origin() {
        let mut thread = super::super::tests::canonical_thread(false);
        thread.metadata["providerSelector"] = serde_json::json!("provider-b");
        thread.metadata["providerName"] = serde_json::json!("wire-provider-b");
        let params = v2::ThreadListParams {
            model_providers: Some(vec!["provider-b".into()]),
            ..Default::default()
        };
        assert!(thread_matches_list_filters(&thread, &params));
        let projected = project_thread(thread.clone()).unwrap();
        assert_eq!(projected.model_provider, "provider-b");
        assert_eq!(
            thread.model_provider, "openai",
            "rollout creation fields remain immutable"
        );
        let old = v2::ThreadListParams {
            model_providers: Some(vec!["openai".into()]),
            ..Default::default()
        };
        assert!(!thread_matches_list_filters(&thread, &old));
    }

    #[test]
    fn absent_settings_preserve_creation_provider_and_blank_values_are_not_authority() {
        let mut thread = super::super::tests::canonical_thread(false);
        assert_eq!(current_model_provider(&thread), "openai");
        thread.metadata["providerSelector"] = serde_json::json!("  ");
        thread.metadata["providerName"] = serde_json::json!("provider-b");
        assert_eq!(current_model_provider(&thread), "provider-b");
    }
}
