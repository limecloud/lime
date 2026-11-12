use super::*;
use app_server::{AppServerRuntimeFactory, EventLogWriter, ProjectionStore};
use std::{
    sync::{Arc, Mutex},
    time::Duration,
};

#[path = "../turn_final_completion_jsonrpc/provider.rs"]
mod provider;
#[path = "../support/mod.rs"]
mod support;

#[tokio::test]
async fn installed_cloud_skill_reaches_current_turn_and_disable_removes_it_from_new_turns() {
    let temp = TempDir::new().unwrap();
    let f = Fixture::start().await;
    package::configure(&f);
    let model = provider::Provider::start_with_receipts(provider::Wire::Chat, false, true).await;
    let writer = Arc::new(EventLogWriter::new(temp.path().join("events")).unwrap());
    let db = rusqlite::Connection::open_in_memory().unwrap();
    lime_core::database::schema::create_tables(&db).unwrap();
    let db = Arc::new(Mutex::new(db));
    support::seed_chat_providers(
        &db,
        &[(
            "final-provider",
            "final-model",
            provider::Wire::Chat.provider_type(),
            &model.url,
            "final-fixture-key",
        )],
        false,
    );
    let runtime = AppServerRuntimeFactory::runtime_backend_core_with_db(db.clone())
        .with_projection_store(Arc::new(
            ProjectionStore::initialize(temp.path().join("projection.sqlite")).unwrap(),
        ))
        .with_event_log_writer(writer.clone());
    let server = issuer::server_with_runtime(temp.path(), runtime, db).await;
    login(&f, &server).await;
    rpc(&server, "plugin/install", install()).await;
    let skills = rpc(
        &server,
        "skills/list",
        json!({"cwds":[temp.path()],"forceReload":true}),
    )
    .await;
    let skill = skills["data"][0]["skills"]
        .as_array()
        .unwrap()
        .iter()
        .find(|skill| skill["name"] == "research:research")
        .expect("installed skill is available to the runtime");
    let input = json!([
        {"type":"text","text":"Follow the selected research skill."},
        {"type":"skill","name":skill["name"],"path":skill["path"]}
    ]);
    run_turn(&server, temp.path(), input).await;
    let requests = model.requests();
    assert_eq!(requests.len(), 1);
    provider::Wire::Chat.assert_route(&requests[0]);
    assert!(requests[0]
        .body
        .to_string()
        .contains("Research instructions"));
    assert!(!requests[0].body.to_string().contains("access-market"));
    rpc(&server, "config/batchWrite", json!({"edits":[{
        "keyPath":format!("plugins.\"{PLUGIN}\".enabled"),"value":false,"mergeStrategy":"replace"
    }]})).await;
    let skills = rpc(
        &server,
        "skills/list",
        json!({"cwds":[temp.path()],"forceReload":true}),
    )
    .await;
    assert!(!skills["data"][0]["skills"]
        .as_array()
        .unwrap()
        .iter()
        .any(|s| s["name"] == "research:research"));
    run_turn(
        &server,
        temp.path(),
        json!([{"type":"text","text":"Start a separate task."}]),
    )
    .await;
    let requests = model.requests();
    assert_eq!(requests.len(), 2);
    assert!(!requests[1]
        .body
        .to_string()
        .contains("Research instructions"));
    assert_eq!(f.count("/market/acquisitions"), 1);
}

async fn run_turn(server: &app_server::AppServer, cwd: &std::path::Path, input: Value) {
    let thread = rpc(
        server,
        "thread/start",
        json!({"cwd":cwd,"modelProvider":"final-provider","model":"final-model"}),
    )
    .await;
    let thread_id = thread["thread"]["id"].as_str().unwrap();
    let mut events = server.subscribe_outbound_messages();
    let turn = rpc(
        server,
        "turn/start",
        json!({"threadId":thread_id,"input":input}),
    )
    .await;
    let id = turn["turn"]["id"].as_str().unwrap();
    let completed = tokio::time::timeout(Duration::from_secs(40), async {
        loop {
            let event = serde_json::to_value(events.recv().await.unwrap()).unwrap();
            if event["method"] == "turn/completed" && event["params"]["turn"]["id"] == id {
                break event;
            }
        }
    })
    .await
    .expect("current runtime completes the turn");
    assert_eq!(
        completed["params"]["turn"]["status"], "completed",
        "{completed}"
    );
}
