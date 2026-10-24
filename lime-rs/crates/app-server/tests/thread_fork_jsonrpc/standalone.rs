use super::*;

async fn standalone_history(source_wire: Wire, wire: Wire) {
    let source_home = TempDir::new().unwrap();
    let destination = TempDir::new().unwrap();
    let workspace = TempDir::new().unwrap();
    let source_provider = Provider::start_with_receipts(source_wire, true, true).await;
    let target_provider = if std::mem::discriminant(&source_wire) == std::mem::discriminant(&wire) {
        None
    } else {
        Some(Provider::start(wire, false).await)
    };
    let target_provider = target_provider.as_ref().unwrap_or(&source_provider);
    let root = source_home.path().join("agent");
    let db = source_home.path().join("projection.sqlite");
    let server = AppServer::with_runtime(
        support::runtime_core_with_chat_providers_at(
            &source_home,
            &[(
                "final-provider",
                "final-model",
                source_wire.provider_type(),
                &source_provider.url,
                "final-fixture-key",
            )],
        )
        .with_projection_store(Arc::new(
            ProjectionStore::initialize_with_agent_root(&db, &root).unwrap(),
        ))
        .with_event_log_writer(Arc::new(
            EventLogWriter::new(source_home.path().join("events")).unwrap(),
        )),
    );
    initialize(&server, 1).await;
    let started = request(
        &server,
        2,
        METHOD_THREAD_START,
        json!({
            "cwd":workspace.path(), "modelProvider":"final-provider", "model":"final-model"
        }),
    )
    .await;
    let source = required_string(&started, "/result/thread/id");
    start_and_complete(
        &server,
        &source,
        json!([{"type":"text","text":"standalone source"}]),
    )
    .await;
    // Direct requests bypass transport teardown. Stop the source session and
    // flush its writers before taking a standalone copy or deleting its home.
    app_server::run_json_lines(server, tokio::io::empty(), tokio::io::sink())
        .await
        .unwrap();
    let relative: String = Connection::open(&db)
        .unwrap()
        .query_row(
            "SELECT rollout_path FROM canonical_threads WHERE thread_id=?1",
            [&source],
            |row| row.get(0),
        )
        .unwrap();
    let bytes = std::fs::read(root.join(&relative)).unwrap();
    let plain = destination.path().join("copied.jsonl");
    let compressed = destination.path().join("compressed.jsonl.zst");
    std::fs::write(&plain, &bytes).unwrap();
    std::fs::write(
        &compressed,
        zstd::stream::encode_all(bytes.as_slice(), 3).unwrap(),
    )
    .unwrap();
    // Drop the entire source tree: no database, EventLog, sidecar or loaded session is reachable.
    source_home.close().unwrap();

    let make_runtime = || {
        support::runtime_core_with_chat_providers_at(
            &destination,
            &[(
                "final-provider",
                "final-model",
                wire.provider_type(),
                &target_provider.url,
                "final-fixture-key",
            )],
        )
        .with_projection_store(Arc::new(
            ProjectionStore::initialize_with_agent_root(
                destination.path().join("projection.sqlite"),
                destination.path().join("agent"),
            )
            .unwrap(),
        ))
    };
    for (path, ephemeral) in [(&plain, true), (&compressed, false)] {
        let server = AppServer::with_runtime(make_runtime());
        initialize(&server, 3).await;
        let fork = fork_with_started_notification(
            &server,
            json!({"threadId":"", "path":path, "ephemeral":ephemeral}),
            Some(14),
        )
        .await;
        let target = required_string(&fork, "/result/thread/id");
        assert_eq!(fork["result"]["thread"]["forkedFromId"], source);
        // Durable targets must retain receipts across a second cold load, without an EventLog.
        let server = if ephemeral {
            (server, target)
        } else {
            app_server::run_json_lines(server, tokio::io::empty(), tokio::io::sink())
                .await
                .unwrap();
            let server = AppServer::with_runtime(make_runtime());
            initialize(&server, 5).await;
            request(&server, 6, METHOD_THREAD_RESUME, json!({"threadId":target})).await;
            (server, target)
        };
        start_and_complete(
            &server.0,
            &server.1,
            json!([{"type":"text","text":"continue standalone"}]),
        )
        .await;
        assert_history(target_provider, source_wire, wire);
    }
    // The same rollout also rebuilds its original thread in a fresh index, without an EventLog.
    let recovered = TempDir::new().unwrap();
    let path = recovered.path().join("agent").join(relative);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, bytes).unwrap();
    let server = AppServer::with_runtime(
        support::runtime_core_with_chat_providers_at(
            &recovered,
            &[(
                "final-provider",
                "final-model",
                wire.provider_type(),
                &target_provider.url,
                "final-fixture-key",
            )],
        )
        .with_projection_store(Arc::new(
            ProjectionStore::initialize_with_agent_root(
                recovered.path().join("projection.sqlite"),
                recovered.path().join("agent"),
            )
            .unwrap(),
        )),
    );
    initialize(&server, 10).await;
    request(
        &server,
        11,
        METHOD_THREAD_RESUME,
        json!({"threadId":source}),
    )
    .await;
    start_and_complete(
        &server,
        &source,
        json!([{"type":"text","text":"continue standalone"}]),
    )
    .await;
    assert_history(target_provider, source_wire, wire);
}

fn assert_history(target_provider: &Provider, source_wire: Wire, wire: Wire) {
    let captures = target_provider.requests();
    let capture = captures.last().unwrap();
    wire.assert_route(capture);
    let history = wire.history(&capture.body).to_string();
    assert_eq!(history.matches("standalone source").count(), 1, "{history}");
    assert!(history.contains("continue standalone"), "{history}");
    assert_eq!(
        history.matches(provider::PORTABLE_ANSWER).count(),
        1,
        "{history}"
    );
    if matches!((source_wire, wire), (Wire::Anthropic, Wire::Anthropic)) {
        assert!(
            history.contains("final-fixture-signature"),
            "opaque receipt was lost: {history}"
        );
    }
    for (same_protocol, receipt) in [
        (
            matches!((source_wire, wire), (Wire::Responses, Wire::Responses)),
            "portable-responses-encrypted",
        ),
        (
            matches!((source_wire, wire), (Wire::Gemini, Wire::Gemini)),
            "portable-gemini-signature",
        ),
        (
            matches!((source_wire, wire), (Wire::Gemini, Wire::Gemini)),
            "portable-gemini-text-signature",
        ),
    ] {
        assert_eq!(
            history.contains(receipt),
            same_protocol,
            "receipt replay scope: {history}"
        );
    }
    if !matches!(wire, Wire::Anthropic) {
        assert!(
            !history.contains("final-fixture-signature"),
            "foreign signature leaked: {history}"
        );
    }
    assert_eq!(
        history.matches(REASONING).count(),
        // Responses accepts authoritative native reasoning, not display deltas
        // synthesized into a foreign reasoning item. The visible answer survives.
        usize::from(
            (!matches!(source_wire, Wire::Responses) && !matches!(wire, Wire::Responses))
                || matches!((source_wire, wire), (Wire::Responses, Wire::Responses))
        ),
        "{history}"
    );
}

#[tokio::test]
async fn standalone_chat_history() {
    standalone_history(Wire::Chat, Wire::Chat).await;
}
#[tokio::test]
async fn standalone_responses_history() {
    standalone_history(Wire::Responses, Wire::Responses).await;
}
#[tokio::test]
async fn standalone_anthropic_history() {
    standalone_history(Wire::Anthropic, Wire::Anthropic).await;
}
#[tokio::test]
async fn standalone_gemini_history() {
    standalone_history(Wire::Gemini, Wire::Gemini).await;
}

#[tokio::test]
async fn standalone_anthropic_to_chat_history() {
    standalone_history(Wire::Anthropic, Wire::Chat).await;
}

#[tokio::test]
async fn standalone_responses_to_chat_history() {
    standalone_history(Wire::Responses, Wire::Chat).await;
}

#[tokio::test]
async fn standalone_gemini_to_anthropic_history() {
    standalone_history(Wire::Gemini, Wire::Anthropic).await;
}

macro_rules! cross_protocol {
    ($($name:ident: $source:ident => $target:ident),+ $(,)?) => {$(
        #[tokio::test]
        async fn $name() { standalone_history(Wire::$source, Wire::$target).await; }
    )+};
}

cross_protocol! {
    standalone_chat_to_responses_history: Chat => Responses,
    standalone_chat_to_anthropic_history: Chat => Anthropic,
    standalone_chat_to_gemini_history: Chat => Gemini,
    standalone_responses_to_anthropic_history: Responses => Anthropic,
    standalone_responses_to_gemini_history: Responses => Gemini,
    standalone_anthropic_to_responses_history: Anthropic => Responses,
    standalone_anthropic_to_gemini_history: Anthropic => Gemini,
    standalone_gemini_to_chat_history: Gemini => Chat,
    standalone_gemini_to_responses_history: Gemini => Responses,
}
