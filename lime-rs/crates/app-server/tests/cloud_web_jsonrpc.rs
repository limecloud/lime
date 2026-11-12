//! The current runtime executes Cloud web tools over explicit HTTP test dependencies.
#[path = "account_jsonrpc/issuer.rs"]
mod issuer;
#[path = "thread_compact_jsonrpc/model_fixture.rs"]
#[allow(dead_code)]
mod provider;
mod support;

use app_server::{AppServerRuntimeFactory, EventLogWriter, ProjectionStore};
use app_server_protocol::protocol::v2::METHOD_THREAD_ARCHIVE;
use issuer::{rpc, Fixture};
use provider::{ModelFixture, Wire};
use serde_json::{json, Value};
use std::{
    sync::{Arc, Mutex},
    time::Duration,
};

#[tokio::test]
async fn web_search_and_page_results_reach_the_same_canonical_runtime() {
    web_tool_turn(false, false, false).await;
}

#[tokio::test]
async fn unknown_search_recovers_in_a_later_tool_call_without_a_second_search() {
    web_tool_turn(true, true, false).await;
}

#[tokio::test]
async fn invalid_original_response_keeps_the_key_in_the_model_history() {
    web_tool_turn(true, false, false).await;
}

#[tokio::test]
async fn new_model_call_id_without_a_recovery_key_reads_the_pending_operation() {
    web_tool_turn(true, true, true).await;
}

async fn web_tool_turn(unknown: bool, missing_original: bool, recover_without_key: bool) {
    let root = tempfile::tempdir().unwrap();
    let cloud = Fixture::start().await;
    let search_result = json!({
        "id":"web_search_runtime","kind":"search","status":"completed",
        "search":{"items":[{"title":"Rust release","url":"https://blog.rust-lang.org/","summary":"runtime-search-evidence","retrievedAt":"2026-11-12T00:00:00Z"}],"truncated":false}
    });
    cloud.respond(
        "/api/v1/client/web/searches",
        if unknown { 502 } else { 200 },
        if unknown {
            json!({"error":"outcome_unknown"})
        } else {
            search_result.clone()
        },
    );
    cloud.state.lock().unwrap().web_operation_missing = missing_original;
    cloud.respond("/api/v1/client/web/pages", 200, json!({
        "id":"web_page_runtime","kind":"page","status":"completed",
        "page":{"url":"https://blog.rust-lang.org/","finalUrl":"https://blog.rust-lang.org/","title":"Rust release","text":"runtime-page-evidence","retrievedAt":"2026-11-12T00:00:00Z","truncated":false}
    }));
    let mut step = 0;
    let cloud_state = cloud.state.clone();
    let model = ModelFixture::start_with_script(Wire::Chat, json!({"data":[]}), move |capture| {
        let call = if step == 0 {
            Some(("search-call", "WebSearch", json!({"query":"Rust release"})))
        } else if unknown && step == 1 {
            let previous = capture
                .history()
                .as_array()
                .unwrap()
                .iter()
                .rev()
                .find(|message| message["role"] == "tool")
                .unwrap();
            let previous: Value =
                serde_json::from_str(previous["content"].as_str().unwrap()).unwrap();
            assert_eq!(previous["status"], "outcome_unknown");
            let key = previous["operationKey"].as_str().unwrap();
            cloud_state.lock().unwrap().responses.insert(
                format!("/api/v1/client/web/operations/{key}"),
                (200, serde_json::to_vec(&search_result).unwrap()),
            );
            let arguments = if recover_without_key {
                json!({"query":"Rust release"})
            } else {
                json!({"query":"Rust release","operation_key":key})
            };
            Some(("recover-search", "WebSearch", arguments))
        } else if step == 1 + usize::from(unknown) {
            Some((
                "page-call",
                "WebFetch",
                json!({"url":"https://blog.rust-lang.org/","prompt":"release"}),
            ))
        } else {
            None
        };
        step += 1;
        call.map(|(id, name, args)| (id.into(), name.into(), args))
    })
    .await;
    let db = rusqlite::Connection::open_in_memory().unwrap();
    lime_core::database::schema::create_tables(&db).unwrap();
    let db = Arc::new(Mutex::new(db));
    support::seed_chat_providers(
        &db,
        &[(
            "cloud-web-provider",
            Wire::Chat.model(),
            Wire::Chat.provider_type(),
            &model.url,
            Wire::Chat.credential(),
        )],
        false,
    );
    let writer = Arc::new(EventLogWriter::new(root.path().join("events")).unwrap());
    let runtime = AppServerRuntimeFactory::runtime_backend_core_with_db(db.clone())
        .with_projection_store(Arc::new(
            ProjectionStore::initialize(root.path().join("projection.sqlite")).unwrap(),
        ))
        .with_event_log_writer(writer.clone());
    let server = issuer::server_with_runtime(root.path(), runtime, db).await;
    cloud.authorize(&server, "default").await;
    cloud.authorize(&server, "web").await;
    let started = rpc(
        &server,
        "thread/start",
        json!({
            "cwd":root.path(),"modelProvider":"cloud-web-provider","model":Wire::Chat.model(),
            "config":{"web_search":"live","approval_policy":"never"}
        }),
    )
    .await;
    let thread = started["thread"]["id"].as_str().unwrap();
    let session = started["thread"]["sessionId"].as_str().unwrap();
    let mut events = server.subscribe_outbound_messages();
    let started = rpc(&server, "turn/start", json!({"threadId":thread,"input":[{"type":"text","text":"Search for the current Rust release and read its source page."}]})).await;
    let turn = started["turn"]["id"].as_str().unwrap();
    let complete = tokio::time::timeout(Duration::from_secs(45), async {
        loop {
            let event = serde_json::to_value(events.recv().await.unwrap()).unwrap();
            if event["method"] == "turn/completed" && event["params"]["turn"]["id"] == turn {
                break event;
            }
        }
    })
    .await
    .expect("Cloud tool turn completes");
    assert_eq!(
        complete["params"]["turn"]["status"], "completed",
        "{complete}"
    );
    let captured = model.last_request();
    let history = captured.history().to_string();
    assert!(history.contains("runtime-search-evidence"), "{history}");
    assert!(history.contains("runtime-page-evidence"), "{history}");
    assert!(history.contains("https://blog.rust-lang.org/"));
    assert!(!captured.body.to_string().contains("access-web"));
    assert_eq!(cloud.count("/web/searches"), 1);
    assert_eq!(cloud.count("/web/pages"), 1);
    assert_eq!(model.request_count(), 3 + usize::from(unknown));
    let records = writer.read_session_events(session).unwrap();
    let records = serde_json::to_string(
        &records
            .iter()
            .map(|record| &record.event)
            .collect::<Vec<_>>(),
    )
    .unwrap();
    assert!(records.contains("runtime-search-evidence"));
    assert!(records.contains("runtime-page-evidence"));
    assert!(!records.contains("access-web"));
    let read = rpc(
        &server,
        "thread/read",
        json!({"threadId":thread,"includeTurns":true}),
    )
    .await;
    assert!(read["thread"]["turns"]
        .as_array()
        .unwrap()
        .iter()
        .any(|t| t["id"] == turn));
    rpc(&server, METHOD_THREAD_ARCHIVE, json!({"threadId":thread})).await;
}
