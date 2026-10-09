use super::*;

#[tokio::test]
async fn cold_nested_fork_keeps_canonical_history_without_repairing_shared_turn_ids() {
    for history_mode in ["legacy", "paginated"] {
        let temp = TempDir::new().expect("nested fork temp dir");
        let projection_path = temp.path().join("projection.sqlite");
        let event_log_root = temp.path().join("event-log");
        let backend = Arc::new(HistoryCaptureBackend::default());
        let runtime = || {
            RuntimeCore::with_backend(backend.clone())
                .with_projection_store(Arc::new(
                    ProjectionStore::initialize(&projection_path).expect("nested fork store"),
                ))
                .with_event_log_writer(Arc::new(
                    EventLogWriter::new(&event_log_root).expect("nested fork event log"),
                ))
        };
        let server = AppServer::with_runtime(runtime());
        initialize(&server, 1).await;
        let source = request(
            &server,
            2,
            METHOD_THREAD_START,
            json!({
                "model": "fixture-model", "modelProvider": "fixture-provider",
                "cwd": temp.path(), "historyMode": history_mode
            }),
        )
        .await;
        let source_id = required_string(&source, "/result/thread/id");
        request(
            &server,
            3,
            METHOD_TURN_START,
            json!({
                "threadId": source_id,
                "input": [{ "type": "text", "text": "nested fork source prompt" }]
            }),
        )
        .await;
        wait_for_completed_turn_count(&server, &source_id, 1).await;
        let source = request(
            &server,
            4,
            METHOD_THREAD_READ,
            json!({
                "threadId": source_id, "includeTurns": true
            }),
        )
        .await;
        let inherited = source["result"]["thread"]["turns"].clone();
        let first = request(
            &server,
            5,
            METHOD_THREAD_FORK,
            json!({
                "threadId": source_id, "excludeTurns": true, "deferGoalContinuation": true
            }),
        )
        .await;
        let first_id = required_string(&first, "/result/thread/id");
        assert_ne!(first_id, source_id);
        assert_eq!(backend.calls.load(Ordering::SeqCst), 1);
        drop(server);

        let server = AppServer::with_runtime(runtime());
        initialize(&server, 6).await;
        let nested = request(
            &server,
            7,
            METHOD_THREAD_FORK,
            json!({
                "threadId": first_id, "deferGoalContinuation": true
            }),
        )
        .await;
        let nested_id = required_string(&nested, "/result/thread/id");
        assert_ne!(nested_id, first_id);
        assert_ne!(nested_id, source_id);
        assert_eq!(nested["result"]["thread"]["forkedFromId"], first_id);
        assert_eq!(nested["result"]["thread"]["turns"], inherited);
        assert_eq!(backend.calls.load(Ordering::SeqCst), 1);
        request(
            &server,
            8,
            METHOD_TURN_START,
            json!({
                "threadId": nested_id,
                "input": [{ "type": "text", "text": "continue nested fork" }]
            }),
        )
        .await;
        wait_for_completed_turn_count(&server, &nested_id, 2).await;
        assert_eq!(backend.calls.load(Ordering::SeqCst), 2);
        assert_provider_prefix_once(&backend, 1);
        drop(server);

        let server = AppServer::with_runtime(runtime());
        initialize(&server, 9).await;
        let resumed = request(
            &server,
            10,
            METHOD_THREAD_RESUME,
            json!({
                "threadId": nested_id, "excludeTurns": true
            }),
        )
        .await;
        assert_eq!(resumed["result"]["thread"]["id"], nested_id);
        assert_eq!(resumed["result"]["thread"]["forkedFromId"], first_id);
        request(
            &server,
            11,
            METHOD_TURN_START,
            json!({
                "threadId": nested_id,
                "input": [{ "type": "text", "text": "continue nested fork after restart" }]
            }),
        )
        .await;
        wait_for_completed_turn_count(&server, &nested_id, 3).await;
        assert_eq!(backend.calls.load(Ordering::SeqCst), 3);
        assert_provider_prefix_once(&backend, 2);
        for (id, thread_id) in [(12, &source_id), (13, &first_id)] {
            let unchanged = request(
                &server,
                id,
                METHOD_THREAD_READ,
                json!({
                    "threadId": thread_id, "includeTurns": true
                }),
            )
            .await;
            assert_eq!(unchanged["result"]["thread"]["turns"], inherited);
        }
        let final_read = request(
            &server,
            14,
            METHOD_THREAD_READ,
            json!({
                "threadId": nested_id, "includeTurns": true
            }),
        )
        .await;
        let turns = final_read["result"]["thread"]["turns"].as_array().unwrap();
        assert_eq!(turns.len(), 3);
        assert_eq!(turns[0], inherited[0]);
        assert_ne!(turns[1]["id"], turns[0]["id"]);
        assert_ne!(turns[2]["id"], turns[1]["id"]);
        assert_ne!(turns[2]["id"], turns[0]["id"]);
    }
}

fn assert_provider_prefix_once(backend: &HistoryCaptureBackend, call: usize) {
    let histories = backend
        .histories
        .lock()
        .expect("captured provider histories");
    let messages = &histories[call];
    for (role, text) in [
        (CurrentProviderRole::User, "nested fork source prompt"),
        (CurrentProviderRole::Tool, "source tool output"),
        (CurrentProviderRole::Assistant, "source assistant answer"),
    ] {
        assert_eq!(
            messages
                .iter()
                .filter(|message| {
                    message.role == role
                        && message.content.iter().any(|content| match content {
                            CurrentProviderContent::Text(value) => value == text,
                            CurrentProviderContent::ToolResult(result) => result.output == text,
                            _ => false,
                        })
                })
                .count(),
            1,
            "provider prefix {text} must occur once"
        );
    }
}
