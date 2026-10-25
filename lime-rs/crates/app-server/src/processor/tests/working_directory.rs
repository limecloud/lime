use super::super::*;
use super::settings_support::{core, run_turn, SettingsBackend};
use super::tests_support::initialize_processor;
use crate::ProjectionStore;
use app_server_protocol::{AgentSessionStartParams, BusinessObjectRef};
use serde_json::{json, Value};
use std::sync::Arc;

async fn request(processor: &RequestProcessor, method: &str, params: Value) -> Value {
    let messages = processor
        .handle_request(JsonRpcRequest::new(
            RequestId::Integer(1),
            method,
            Some(params),
        ))
        .await
        .unwrap();
    messages
        .into_iter()
        .find_map(|message| match message {
            JsonRpcMessage::Response(response) => Some(response.result),
            JsonRpcMessage::Error(error) => panic!("{method}: {error:?}"),
            _ => None,
        })
        .expect("public response")
}

fn seed_legacy_thread(runtime: &crate::RuntimeCore, legacy: Value) {
    let mut metadata =
        json!({"providerSelector":"fixture","modelName":"model", "historyMode":"legacy"});
    metadata
        .as_object_mut()
        .unwrap()
        .extend(legacy.as_object().unwrap().clone());
    runtime
        .start_session(AgentSessionStartParams {
            session_id: Some("settings-session".into()),
            thread_id: Some("settings-thread".into()),
            app_id: "agent-chat".into(),
            workspace_id: None,
            locale: None,
            business_object_ref: Some(BusinessObjectRef {
                kind: "agent.thread".into(),
                id: "settings-thread".into(),
                title: None,
                uri: None,
                metadata: Some(metadata),
            }),
        })
        .unwrap();
}

#[tokio::test]
async fn working_directory_start_resolves_omitted_and_relative_paths_on_the_server() {
    let temp = tempfile::tempdir().unwrap();
    let store =
        Arc::new(ProjectionStore::initialize(temp.path().join("projection.sqlite")).unwrap());
    let backend = Arc::new(SettingsBackend::default());
    let processor = RequestProcessor::new(core(store, backend, &temp.path().join("config.yaml")));
    initialize_processor(&processor).await;
    let server_cwd = std::env::current_dir().unwrap();
    for cwd in [None, Some("server-relative"), server_cwd.to_str()] {
        let mut params = json!({"model":"fixture", "modelProvider":"fixture"});
        if let Some(cwd) = cwd {
            params["cwd"] = json!(cwd);
        }
        let response = request(&processor, "thread/start", params).await;
        let expected = cwd.map_or_else(|| server_cwd.clone(), |cwd| server_cwd.join(cwd));
        assert_eq!(response["cwd"], expected.to_string_lossy().as_ref());
        assert_eq!(response["thread"]["cwd"], response["cwd"]);
        let read = request(
            &processor,
            "thread/read",
            json!({"threadId":response["thread"]["id"]}),
        )
        .await;
        assert_eq!(read["thread"]["cwd"], response["cwd"]);
        assert_eq!(read["thread"]["extra"]["workingDir"], response["cwd"]);
    }
    processor.runtime.shutdown().await.unwrap();
}

#[tokio::test]
async fn working_directory_legacy_resume_migrates_once_and_survives_cold_reopen() {
    let server_cwd = std::env::current_dir().unwrap();
    for legacy in [
        json!({}),
        json!({"workingDir":null}),
        json!({"workingDir":""}),
        json!({"workingDir":"legacy-relative","runtimeWorkspaceRoots":["legacy-relative"]}),
        json!({"cwd":server_cwd}),
        json!({"workingDir":server_cwd,"cwd":"stale-relative"}),
    ] {
        let temp = tempfile::tempdir().unwrap();
        let store =
            Arc::new(ProjectionStore::initialize(temp.path().join("projection.sqlite")).unwrap());
        let backend = Arc::new(SettingsBackend::default());
        let runtime = core(
            store.clone(),
            backend.clone(),
            &temp.path().join("config.yaml"),
        );
        seed_legacy_thread(&runtime, legacy.clone());
        let processor = RequestProcessor::new(runtime);
        initialize_processor(&processor).await;
        let first = request(
            &processor,
            "thread/resume",
            json!({"threadId":"settings-thread"}),
        )
        .await;
        let expected = if legacy["workingDir"] == "legacy-relative" {
            server_cwd.join("legacy-relative")
        } else {
            server_cwd.clone()
        };
        assert_eq!(
            first["cwd"],
            expected.to_string_lossy().as_ref(),
            "legacy={legacy}"
        );
        assert_eq!(first["thread"]["extra"]["workingDir"], first["cwd"]);
        assert!(first["thread"]["extra"].get("cwd").is_none());
        if legacy.get("runtimeWorkspaceRoots").is_some() {
            assert_eq!(first["runtimeWorkspaceRoots"], json!([expected]));
        }
        let conn = rusqlite::Connection::open(store.path()).unwrap();
        conn.execute_batch("CREATE TRIGGER resume_no_rewrite BEFORE UPDATE ON canonical_threads BEGIN SELECT RAISE(ABORT, 'repeat resume must not write'); END;").unwrap();
        let second = request(
            &processor,
            "thread/resume",
            json!({"threadId":"settings-thread"}),
        )
        .await;
        assert_eq!(
            second["thread"]["updatedAt"], first["thread"]["updatedAt"],
            "repeat resume must not rewrite metadata"
        );
        conn.execute_batch("DROP TRIGGER resume_no_rewrite")
            .unwrap();
        let runtime_request = run_turn(&processor, &backend, json!({}), 1).await;
        assert_eq!(
            runtime_request.working_dir.as_deref(),
            Some(expected.to_string_lossy().as_ref())
        );
        processor.runtime.shutdown().await.unwrap();
        drop(processor);
        let reopened =
            RequestProcessor::new(core(store, backend, &temp.path().join("config.yaml")));
        initialize_processor(&reopened).await;
        let cold = request(
            &reopened,
            "thread/resume",
            json!({"threadId":"settings-thread"}),
        )
        .await;
        assert_eq!(cold["cwd"], first["cwd"]);
        assert_eq!(cold["thread"]["extra"]["workingDir"], first["cwd"]);
        reopened.runtime.shutdown().await.unwrap();
    }
}

#[tokio::test]
async fn working_directory_migration_failure_preserves_memory_and_store_then_retries() {
    let temp = tempfile::tempdir().unwrap();
    let agent_root = temp.path().join("agent");
    let store = Arc::new(
        ProjectionStore::initialize_with_agent_root(
            temp.path().join("projection.sqlite"),
            &agent_root,
        )
        .unwrap(),
    );
    let runtime = core(
        store.clone(),
        Arc::new(SettingsBackend::default()),
        &temp.path().join("config.yaml"),
    );
    seed_legacy_thread(&runtime, json!({"cwd":"legacy-relative"}));
    let processor = RequestProcessor::new(runtime);
    initialize_processor(&processor).await;
    let before = request(
        &processor,
        "thread/read",
        json!({"threadId":"settings-thread"}),
    )
    .await;
    let conn = rusqlite::Connection::open(store.path()).unwrap();
    conn.execute_batch("CREATE TRIGGER cwd_write_failure BEFORE UPDATE ON canonical_threads BEGIN SELECT RAISE(ABORT, 'cwd fixture write failure'); END;").unwrap();
    let failed = processor
        .handle_request(JsonRpcRequest::new(
            RequestId::Integer(3),
            "thread/resume",
            Some(json!({"threadId":"settings-thread"})),
        ))
        .await
        .unwrap();
    assert!(failed.iter().any(|message| matches!(message, JsonRpcMessage::Error(error) if error.error.message.contains("cwd fixture write failure"))), "{failed:?}");
    let after = request(
        &processor,
        "thread/read",
        json!({"threadId":"settings-thread"}),
    )
    .await;
    assert_eq!(
        after, before,
        "failed migration must not change canonical metadata"
    );
    let memory = processor
        .runtime
        .read_session(app_server_protocol::AgentSessionReadParams {
            session_id: "settings-session".into(),
            history_limit: None,
            history_offset: None,
            history_before_message_id: None,
        })
        .unwrap();
    assert_eq!(
        memory
            .session
            .business_object_ref
            .unwrap()
            .metadata
            .unwrap()["cwd"],
        "legacy-relative"
    );
    conn.execute_batch("DROP TRIGGER cwd_write_failure;")
        .unwrap();
    let retried = request(
        &processor,
        "thread/resume",
        json!({"threadId":"settings-thread"}),
    )
    .await;
    assert_eq!(
        retried["cwd"],
        json!(std::env::current_dir().unwrap().join("legacy-relative"))
    );
    assert!(retried["thread"]["extra"].get("cwd").is_none());
    processor.runtime.shutdown().await.unwrap();
    drop(processor);
    let rebuilt = Arc::new(
        ProjectionStore::initialize_with_agent_root(
            temp.path().join("rebuilt.sqlite"),
            &agent_root,
        )
        .unwrap(),
    );
    let reopened = RequestProcessor::new(core(
        rebuilt,
        Arc::new(SettingsBackend::default()),
        &temp.path().join("config.yaml"),
    ));
    initialize_processor(&reopened).await;
    let cold = request(
        &reopened,
        "thread/resume",
        json!({"threadId":"settings-thread"}),
    )
    .await;
    assert_eq!(
        cold["cwd"], retried["cwd"],
        "rollout rebuild must retain the migrated directory"
    );
    assert!(cold["thread"]["extra"].get("cwd").is_none());
    reopened.runtime.shutdown().await.unwrap();
}

#[tokio::test]
async fn working_directory_archived_resume_does_not_migrate_and_fork_only_normalizes_target() {
    let temp = tempfile::tempdir().unwrap();
    let store =
        Arc::new(ProjectionStore::initialize(temp.path().join("projection.sqlite")).unwrap());
    let runtime = core(
        store,
        Arc::new(SettingsBackend::default()),
        &temp.path().join("config.yaml"),
    );
    seed_legacy_thread(&runtime, json!({"cwd":"legacy-relative"}));
    let processor = RequestProcessor::new(runtime);
    initialize_processor(&processor).await;
    let before = request(
        &processor,
        "thread/read",
        json!({"threadId":"settings-thread"}),
    )
    .await;
    let fork = request(&processor, "thread/fork", json!({"threadId":"settings-thread","cwd":"fork-relative","runtimeWorkspaceRoots":["fork-relative"],"deferGoalContinuation":true})).await;
    assert_eq!(
        fork["cwd"],
        json!(std::env::current_dir().unwrap().join("fork-relative"))
    );
    assert_eq!(fork["thread"]["cwd"], fork["cwd"]);
    assert_eq!(fork["runtimeWorkspaceRoots"], json!([fork["cwd"]]));
    let after = request(
        &processor,
        "thread/read",
        json!({"threadId":"settings-thread"}),
    )
    .await;
    assert_eq!(after, before, "fork must not migrate its source");
    request(
        &processor,
        "thread/archive",
        json!({"threadId":"settings-thread"}),
    )
    .await;
    let archived = request(
        &processor,
        "thread/read",
        json!({"threadId":"settings-thread"}),
    )
    .await;
    let _ = processor
        .handle_request(JsonRpcRequest::new(
            RequestId::Integer(4),
            "thread/resume",
            Some(json!({"threadId":"settings-thread"})),
        ))
        .await
        .unwrap();
    let after_resume = request(
        &processor,
        "thread/read",
        json!({"threadId":"settings-thread"}),
    )
    .await;
    assert_eq!(
        after_resume, archived,
        "archived resume must not rewrite metadata"
    );
    assert_eq!(after_resume["thread"]["extra"]["cwd"], "legacy-relative");
    processor.runtime.shutdown().await.unwrap();
}

#[tokio::test]
async fn working_directory_turn_persists_scope_for_later_turns_and_cold_resume() {
    let temp = tempfile::tempdir().unwrap();
    let store =
        Arc::new(ProjectionStore::initialize(temp.path().join("projection.sqlite")).unwrap());
    let backend = Arc::new(SettingsBackend::default());
    let runtime = core(
        store.clone(),
        backend.clone(),
        &temp.path().join("config.yaml"),
    );
    seed_legacy_thread(&runtime, json!({"workingDir":temp.path()}));
    let processor = RequestProcessor::new(runtime);
    initialize_processor(&processor).await;
    let runtime_request = run_turn(
        &processor,
        &backend,
        json!({"cwd":"turn-relative","runtimeWorkspaceRoots":["turn-relative"]}),
        1,
    )
    .await;
    let expected = std::env::current_dir().unwrap().join("turn-relative");
    assert_eq!(runtime_request.working_dir.as_deref(), expected.to_str());
    assert_eq!(runtime_request.workspace_root.as_deref(), expected.to_str());
    let read = request(
        &processor,
        "thread/read",
        json!({"threadId":"settings-thread"}),
    )
    .await;
    assert_eq!(read["thread"]["cwd"], json!(expected));
    assert_eq!(
        read["thread"]["extra"]["runtimeWorkspaceRoots"],
        json!([expected])
    );
    let inherited = run_turn(&processor, &backend, json!({}), 2).await;
    assert_eq!(inherited.working_dir.as_deref(), expected.to_str());
    assert_eq!(inherited.workspace_root.as_deref(), expected.to_str());
    processor.runtime.shutdown().await.unwrap();
    drop(processor);
    let reopened = RequestProcessor::new(core(
        store,
        backend.clone(),
        &temp.path().join("config.yaml"),
    ));
    initialize_processor(&reopened).await;
    let cold = request(
        &reopened,
        "thread/resume",
        json!({"threadId":"settings-thread"}),
    )
    .await;
    assert_eq!(cold["cwd"], json!(expected));
    assert_eq!(cold["runtimeWorkspaceRoots"], json!([expected]));
    let inherited = run_turn(&reopened, &backend, json!({}), 3).await;
    assert_eq!(inherited.working_dir.as_deref(), expected.to_str());
    assert_eq!(inherited.workspace_root.as_deref(), expected.to_str());
    reopened.runtime.shutdown().await.unwrap();
}

#[tokio::test]
async fn working_directory_turn_accepts_roots_only_and_explicitly_clears_roots() {
    let temp = tempfile::tempdir().unwrap();
    let store =
        Arc::new(ProjectionStore::initialize(temp.path().join("projection.sqlite")).unwrap());
    let backend = Arc::new(SettingsBackend::default());
    let runtime = core(store, backend.clone(), &temp.path().join("config.yaml"));
    seed_legacy_thread(&runtime, json!({"workingDir":temp.path()}));
    let processor = RequestProcessor::new(runtime);
    initialize_processor(&processor).await;
    let expected = std::env::current_dir().unwrap().join("turn-project");
    let selected = run_turn(
        &processor,
        &backend,
        json!({"runtimeWorkspaceRoots":["turn-project"]}),
        1,
    )
    .await;
    assert_eq!(selected.working_dir.as_deref(), temp.path().to_str());
    assert_eq!(selected.workspace_root.as_deref(), expected.to_str());
    let inherited = run_turn(&processor, &backend, json!({}), 2).await;
    assert_eq!(inherited.workspace_root.as_deref(), expected.to_str());
    let cleared = run_turn(&processor, &backend, json!({"runtimeWorkspaceRoots":[]}), 3).await;
    assert_eq!(cleared.workspace_root, None);
    assert_eq!(cleared.project_root.as_deref(), temp.path().to_str());
    let inherited = run_turn(&processor, &backend, json!({}), 4).await;
    assert_eq!(inherited.workspace_root, None);
    let read = request(
        &processor,
        "thread/read",
        json!({"threadId":"settings-thread"}),
    )
    .await;
    assert_eq!(read["thread"]["cwd"], json!(temp.path()));
    assert_eq!(read["thread"]["extra"]["runtimeWorkspaceRoots"], json!([]));
    processor.runtime.shutdown().await.unwrap();
}

#[tokio::test]
async fn working_directory_turn_write_failure_preserves_scope_and_does_not_admit_turn() {
    let temp = tempfile::tempdir().unwrap();
    let store =
        Arc::new(ProjectionStore::initialize(temp.path().join("projection.sqlite")).unwrap());
    let backend = Arc::new(SettingsBackend::default());
    let runtime = core(
        store.clone(),
        backend.clone(),
        &temp.path().join("config.yaml"),
    );
    seed_legacy_thread(
        &runtime,
        json!({"workingDir":temp.path(), "runtimeWorkspaceRoots":[temp.path()]}),
    );
    let processor = RequestProcessor::new(runtime);
    initialize_processor(&processor).await;
    let before = request(
        &processor,
        "thread/read",
        json!({"threadId":"settings-thread"}),
    )
    .await;
    let conn = rusqlite::Connection::open(store.path()).unwrap();
    conn.execute_batch("CREATE TRIGGER scope_write_failure BEFORE UPDATE ON canonical_threads BEGIN SELECT RAISE(ABORT, 'scope fixture write failure'); END;").unwrap();
    let params = json!({"threadId":"settings-thread", "input":[{"type":"text", "text":"continue"}], "cwd":"next-cwd", "runtimeWorkspaceRoots":["next-root"]});
    let failed = processor
        .handle_request(JsonRpcRequest::new(
            RequestId::Integer(2),
            "turn/start",
            Some(params),
        ))
        .await
        .unwrap();
    assert!(failed.iter().any(|message| matches!(message, JsonRpcMessage::Error(error) if error.error.message.contains("scope fixture write failure"))), "{failed:?}");
    assert!(backend.requests.lock().unwrap().is_empty());
    let after = request(
        &processor,
        "thread/read",
        json!({"threadId":"settings-thread"}),
    )
    .await;
    assert_eq!(after, before);
    let memory = processor
        .runtime
        .read_session(app_server_protocol::AgentSessionReadParams {
            session_id: "settings-session".into(),
            history_limit: None,
            history_offset: None,
            history_before_message_id: None,
        })
        .unwrap();
    let metadata = memory
        .session
        .business_object_ref
        .unwrap()
        .metadata
        .unwrap();
    assert_eq!(metadata["workingDir"], json!(temp.path()));
    assert_eq!(metadata["runtimeWorkspaceRoots"], json!([temp.path()]));
    assert!(memory.turns.is_empty());
    conn.execute_batch("DROP TRIGGER scope_write_failure;")
        .unwrap();
    let retried = run_turn(
        &processor,
        &backend,
        json!({"cwd":"next-cwd", "runtimeWorkspaceRoots":["next-root"]}),
        1,
    )
    .await;
    assert_eq!(
        retried.working_dir.as_deref(),
        std::env::current_dir().unwrap().join("next-cwd").to_str()
    );
    assert_eq!(
        retried.workspace_root.as_deref(),
        std::env::current_dir().unwrap().join("next-root").to_str()
    );
    processor.runtime.shutdown().await.unwrap();
}
