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
    exercise_cloud_skill(Installation::Plugin).await;
}

#[cfg(unix)]
#[tokio::test]
async fn exact_dependency_skill_and_mcp_reach_the_existing_turn_runtime() {
    exercise_cloud_skill(Installation::Dependencies).await;
}

#[cfg(unix)]
#[tokio::test]
async fn independent_skill_and_mcp_use_the_current_turn_without_a_plugin() {
    exercise_cloud_skill(Installation::Standalone).await;
}

enum Installation {
    Plugin,
    Dependencies,
    Standalone,
}

async fn exercise_cloud_skill(installation: Installation) {
    let with_dependencies = matches!(installation, Installation::Dependencies);
    let standalone = matches!(installation, Installation::Standalone);
    let with_mcp = with_dependencies || standalone;
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
    if standalone {
        resources::install_runtime_resources(&f, &server).await;
    } else if with_dependencies {
        dependencies::install_cloud_dependencies(&f, &server).await;
    } else {
        rpc(&server, "plugin/install", install()).await;
    }
    let mcp_name = if standalone {
        let installed = rpc(&server, "market/installed", json!({"kind":"mcp"})).await;
        installed["resources"][0]["installation"]["mcpServerName"].clone()
    } else if with_dependencies {
        let detail = rpc(
            &server,
            "plugin/read",
            json!({"remoteMarketplaceName":MARKET,"pluginName":"item_research_plugin"}),
        )
        .await;
        detail["plugin"]["mcpServers"][0].clone()
    } else {
        Value::Null
    };
    let skill_name = if standalone {
        "research"
    } else {
        "research:research"
    };
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
        .find(|skill| {
            if standalone {
                resources::is_installed_skill(skill, temp.path())
            } else {
                skill["name"] == skill_name
            }
        })
        .expect("installed skill is available to the runtime");
    let input = json!([
        {"type":"text","text":"Follow the selected research skill."},
        {"type":"skill","name":skill["name"],"path":skill["path"]}
    ]);
    let thread_id = run_turn(&server, temp.path(), input).await;
    let requests = model.requests();
    assert_eq!(requests.len(), 1);
    provider::Wire::Chat.assert_route(&requests[0]);
    assert!(requests[0]
        .body
        .to_string()
        .contains("Research instructions"));
    assert!(!requests[0].body.to_string().contains("access-market"));
    if with_mcp {
        let name = &mcp_name;
        let result = rpc(&server, "mcpServer/tool/call", json!({
            "threadId":thread_id,"server":name,"tool":"search","arguments":{"query":"dependency-proof"}
        })).await;
        assert_eq!(result["content"][0]["text"], "research:dependency-proof");
        assert!(result["isError"] == false || result["isError"].is_null());
    }
    if standalone {
        for (item, kind) in [
            ("item_research_skill", "skill"),
            ("item_research_stdio", "mcp"),
        ] {
            rpc(
                &server,
                "market/enabled/set",
                json!({"itemId":item,"kind":kind,"enabled":false}),
            )
            .await;
        }
    } else {
        rpc(&server, "config/batchWrite", json!({"edits":[{
            "keyPath":format!("plugins.\"{PLUGIN}\".enabled"),"value":false,"mergeStrategy":"replace"
        }]})).await;
    }
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
        .any(|s| if standalone {
            resources::is_installed_skill(s, temp.path())
        } else {
            s["name"] == skill_name
        }));
    let disabled_thread = run_turn(
        &server,
        temp.path(),
        json!([{"type":"text","text":"Start a separate task."}]),
    )
    .await;
    if with_mcp {
        let name = &mcp_name;
        assert!(raw(&server, "mcpServer/tool/call", json!({
            "threadId":disabled_thread,"server":name,"tool":"search","arguments":{"query":"must-not-run"}
        })).await.get("error").is_some());
    }
    let requests = model.requests();
    assert_eq!(requests.len(), 2);
    assert!(!requests[1]
        .body
        .to_string()
        .contains("Research instructions"));
    assert_eq!(
        f.count("/market/acquisitions"),
        if standalone {
            2
        } else if with_dependencies {
            3
        } else {
            1
        }
    );
}

async fn run_turn(server: &app_server::AppServer, cwd: &std::path::Path, input: Value) -> String {
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
    thread_id.to_string()
}
