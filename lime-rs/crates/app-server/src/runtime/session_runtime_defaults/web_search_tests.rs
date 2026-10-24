#[test]
fn web_search_snapshots_and_legacy_fallback_do_not_read_global_defaults() {
    use agent_protocol::WebSearchMode;
    for (metadata, expected) in [
        (
            json!({"webSearchMode":"disabled", "sandboxPolicy":"danger-full-access"}),
            WebSearchMode::Disabled,
        ),
        (
            json!({"sandboxPolicy":"danger-full-access"}),
            WebSearchMode::Live,
        ),
        (
            json!({"sandboxPolicy":"workspace-write"}),
            WebSearchMode::Cached,
        ),
        (json!({}), WebSearchMode::Cached),
    ] {
        let request = default_runtime_options_for_session(&session("agent.thread", metadata))
            .unwrap()
            .unwrap()
            .runtime_request
            .unwrap();
        assert_eq!(request.web_search_mode, Some(expected));
    }
    assert!(default_runtime_options_for_session(&session(
        "agent.thread",
        json!({"webSearchMode":"auto"})
    ))
    .is_err());
}

#[test]
fn turn_overrides_cannot_expand_thread_search_access() {
    use agent_protocol::WebSearchMode;
    for (saved, requested, expected) in [
        (
            WebSearchMode::Disabled,
            WebSearchMode::Live,
            WebSearchMode::Disabled,
        ),
        (
            WebSearchMode::Cached,
            WebSearchMode::Live,
            WebSearchMode::Cached,
        ),
        (
            WebSearchMode::Indexed,
            WebSearchMode::Cached,
            WebSearchMode::Cached,
        ),
        (
            WebSearchMode::Live,
            WebSearchMode::Disabled,
            WebSearchMode::Disabled,
        ),
    ] {
        let result = merge_runtime_requests(
            Some(RuntimeRequest {
                web_search_mode: Some(saved),
                ..Default::default()
            }),
            Some(RuntimeRequest {
                web_search_mode: Some(requested),
                web_search: Some(true),
                search_mode: Some(app_server_protocol::RuntimeSearchMode::Required),
                ..Default::default()
            }),
        )
        .unwrap();
        assert_eq!(result.web_search_mode, Some(expected));
        assert_eq!(
            result.search_mode,
            Some(app_server_protocol::RuntimeSearchMode::Required)
        );
    }
}
