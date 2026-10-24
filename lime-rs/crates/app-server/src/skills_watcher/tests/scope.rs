use super::*;
use app_server_protocol::{AgentSessionStartParams, BusinessObjectRef, JsonRpcRequest, RequestId};
use serde_json::{json, Value};

async fn request(processor: &crate::RequestProcessor, method: &str, params: Value) -> Value {
    processor
        .handle_request(JsonRpcRequest::new(
            RequestId::Integer(1),
            method,
            Some(params),
        ))
        .await
        .unwrap()
        .into_iter()
        .find_map(|message| match message {
            JsonRpcMessage::Response(response) => Some(response.result),
            JsonRpcMessage::Error(error) => panic!("{method}: {error:?}"),
            _ => None,
        })
        .expect("public response")
}

#[tokio::test]
async fn durable_cwd_updates_replace_watch_roots_and_keep_the_runtime_project_root() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().canonicalize().unwrap();
    let before = root.join("before");
    let after = root.join("after");
    let project = root.join("project");
    let server = AppServer::new();
    let watcher =
        SkillsWatcher::start(server.event_bridge(), [], Duration::from_millis(20)).unwrap();
    let runtime = crate::RuntimeCore::default()
        .with_projection_store(Arc::new(
            crate::ProjectionStore::initialize(temp.path().join("projection.sqlite")).unwrap(),
        ))
        .with_event_log_writer(Arc::new(
            crate::EventLogWriter::new(temp.path().join("event-log")).unwrap(),
        ))
        .with_app_config_path(temp.path().join("config.yaml"));
    runtime
        .start_session(AgentSessionStartParams {
            session_id: Some("watch-session".into()),
            thread_id: Some("watch-thread".into()),
            app_id: "agent-chat".into(),
            workspace_id: None,
            locale: None,
            business_object_ref: Some(BusinessObjectRef {
                kind: "agent.thread".into(),
                id: "watch-thread".into(),
                title: None,
                uri: None,
                metadata: Some(json!({
                    "providerSelector":"fixture", "modelName":"model", "historyMode":"legacy",
                    "workingDir":before, "runtimeWorkspaceRoots":[project],
                })),
            }),
        })
        .unwrap();
    let processor =
        crate::RequestProcessor::new(runtime).with_skills_watcher(Some(watcher.clone()));
    request(&processor, "initialize", json!({"clientInfo":{"name":"skills-scope","version":"1"},"capabilities":{"experimentalApi":true}})).await;
    processor.handle_notification(app_server_protocol::JsonRpcNotification::new(
        "initialized",
        Some(json!({})),
    ));
    request(
        &processor,
        "thread/resume",
        json!({"threadId":"watch-thread"}),
    )
    .await;
    let roots = watcher.state.roots.lock().unwrap().paths();
    assert!(roots.contains(&before.join(".agents/skills")));
    assert!(roots.contains(&project.join(".agents/skills")));
    let user_roots = lime_skills::default_agent_skill_roots()
        .into_iter()
        .filter(|root| root.scope == lime_skills::AgentSkillScope::User)
        .map(|root| root.path)
        .collect::<Vec<_>>();
    assert!(!user_roots.is_empty());
    assert!(
        user_roots.iter().all(|root| roots.contains(root)),
        "a loaded thread must watch its effective user Skill catalog"
    );
    request(
        &processor,
        "thread/settings/update",
        json!({"threadId":"watch-thread","cwd":after}),
    )
    .await;
    let roots = watcher.state.roots.lock().unwrap().paths();
    assert!(!roots.contains(&before.join(".agents/skills")));
    assert!(roots.contains(&after.join(".agents/skills")));
    assert!(roots.contains(&project.join(".agents/skills")));
}
