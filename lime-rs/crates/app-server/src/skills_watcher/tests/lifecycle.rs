use super::*;

#[tokio::test]
async fn extra_root_replacement_releases_old_paths_and_observes_new_files() {
    let temp = tempfile::tempdir().unwrap();
    let old = temp.path().join("old");
    let new = temp.path().join("new");
    fs::create_dir_all(&old).unwrap();
    fs::create_dir_all(&new).unwrap();
    let server = AppServer::new();
    let mut outbound = server.subscribe_outbound_messages();
    let watcher =
        SkillsWatcher::start(server.event_bridge(), [], Duration::from_millis(20)).unwrap();
    watcher.register_runtime_extra_roots([old.clone()]);
    fs::write(old.join("SKILL.md"), "before").unwrap();
    receive_skills_changed(&mut outbound, Duration::from_secs(3), "original root edit").await;
    watcher.register_runtime_extra_roots([new.clone()]);
    let watched = watcher.state.watched.lock().unwrap().clone();
    assert!(!watched.contains_key(&old.canonicalize().unwrap()));
    assert!(watched.contains_key(&new.canonicalize().unwrap()));
    fs::write(new.join("SKILL.md"), "after").unwrap();
    receive_skills_changed(
        &mut outbound,
        Duration::from_secs(3),
        "replacement root edit",
    )
    .await;
    watcher.register_runtime_extra_roots([]);
    assert!(watcher.state.watched.lock().unwrap().is_empty());
}

#[tokio::test]
async fn overlapping_thread_registrations_keep_shared_root_until_last_owner_releases_it() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("skills");
    fs::create_dir_all(&root).unwrap();
    let server = AppServer::new();
    let mut outbound = server.subscribe_outbound_messages();
    let watcher =
        SkillsWatcher::start(server.event_bridge(), [], Duration::from_millis(20)).unwrap();
    let first = watcher.register_roots([root.clone()]);
    let second = watcher.register_roots([root.clone()]);
    drop(first);
    fs::write(root.join("SKILL.md"), "shared registration still live").unwrap();
    receive_skills_changed(
        &mut outbound,
        Duration::from_secs(3),
        "remaining shared registration",
    )
    .await;
    drop(second);
    assert!(watcher.state.watched.lock().unwrap().is_empty());
}

#[tokio::test]
async fn thread_removal_replacement_and_shutdown_release_their_watch_resources() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("skills");
    let replacement = temp.path().join("replacement");
    fs::create_dir_all(&root).unwrap();
    fs::create_dir_all(&replacement).unwrap();
    let server = AppServer::new();
    let watcher =
        SkillsWatcher::start(server.event_bridge(), [], Duration::from_millis(20)).unwrap();
    let thread = agent_protocol::ThreadId::new("skill-lifecycle");
    server
        .thread_states
        .set_skill_watch(thread.clone(), Some(watcher.register_roots([root.clone()])))
        .await;
    server
        .thread_states
        .set_skill_watch(
            thread.clone(),
            Some(watcher.register_roots([replacement.clone()])),
        )
        .await;
    assert!(!watcher
        .state
        .watched
        .lock()
        .unwrap()
        .contains_key(&root.canonicalize().unwrap()));
    server.thread_states.remove_thread(&thread).await;
    assert!(watcher.state.watched.lock().unwrap().is_empty());
    server
        .thread_states
        .set_skill_watch(thread.clone(), Some(watcher.register_roots([root.clone()])))
        .await;
    server.thread_states.clear_all_listeners().await;
    assert!(watcher.state.watched.lock().unwrap().is_empty());
    server
        .thread_states
        .set_skill_watch(thread, Some(watcher.register_roots([root])))
        .await;
    assert!(
        watcher.state.watched.lock().unwrap().is_empty(),
        "shutdown must reject later registrations"
    );
}

#[tokio::test]
async fn missing_nested_extra_root_creation_and_atomic_replacement_are_observed() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("missing").join("skills");
    let server = AppServer::new();
    let mut outbound = server.subscribe_outbound_messages();
    let watcher =
        SkillsWatcher::start(server.event_bridge(), [], Duration::from_millis(20)).unwrap();
    watcher.register_runtime_extra_roots([root.clone()]);
    fs::create_dir_all(&root).unwrap();
    fs::write(root.join("SKILL.md"), "created").unwrap();
    receive_skills_changed(
        &mut outbound,
        Duration::from_secs(3),
        "nested root creation",
    )
    .await;
    fs::rename(&root, temp.path().join("retired")).unwrap();
    fs::create_dir_all(&root).unwrap();
    fs::write(root.join("SKILL.md"), "replacement").unwrap();
    receive_skills_changed(
        &mut outbound,
        Duration::from_secs(3),
        "atomic root replacement",
    )
    .await;
    fs::write(root.join("SKILL.md"), "replacement edit").unwrap();
    receive_skills_changed(
        &mut outbound,
        Duration::from_secs(3),
        "edit after atomic replacement",
    )
    .await;
}

#[tokio::test]
async fn successful_config_write_broadcasts_and_failed_write_does_not() {
    let temp = tempfile::tempdir().unwrap();
    let config = temp.path().join("config.yaml");
    let server =
        AppServer::with_runtime(crate::RuntimeCore::default().with_app_config_path(config.clone()));
    let mut outbound = server.subscribe_outbound_messages();
    server
        .handle_message(JsonRpcMessage::Request(crate::JsonRpcRequest::new(
            crate::RequestId::Integer(1),
            "initialize",
            Some(serde_json::json!({
                "clientInfo": {"name": "skills-test", "version": "1"},
                "capabilities": {"experimentalApi": true}
            })),
        )))
        .await
        .unwrap();
    server
        .handle_message(JsonRpcMessage::Notification(
            crate::JsonRpcNotification::new("initialized", None),
        ))
        .await
        .unwrap();
    let reply = server
        .handle_message(JsonRpcMessage::Request(crate::JsonRpcRequest::new(
            crate::RequestId::Integer(2),
            "skills/config/write",
            Some(serde_json::json!({"path":temp.path().join("SKILL.md"),"enabled":false})),
        )))
        .await
        .unwrap();
    assert!(
        matches!(&reply[0], JsonRpcMessage::Response(response) if response.result["effectiveEnabled"] == false)
    );
    receive_skills_changed(
        &mut outbound,
        Duration::from_secs(1),
        "successful config write",
    )
    .await;
    let persisted = fs::read(&config).unwrap();
    let reply = server
        .handle_message(JsonRpcMessage::Request(crate::JsonRpcRequest::new(
            crate::RequestId::Integer(3),
            "skills/config/write",
            Some(serde_json::json!({"path":"relative/SKILL.md","enabled":true})),
        )))
        .await
        .unwrap();
    assert!(matches!(&reply[0], JsonRpcMessage::Error(_)));
    assert_eq!(fs::read(&config).unwrap(), persisted);
    assert!(matches!(
        outbound.try_recv(),
        Err(tokio::sync::broadcast::error::TryRecvError::Empty)
    ));
}

#[tokio::test]
async fn shutdown_releases_native_watcher_before_thread_registrations() {
    let temp = tempfile::tempdir().unwrap();
    let first = temp.path().join("first");
    let second = temp.path().join("second");
    fs::create_dir_all(&first).unwrap();
    fs::create_dir_all(&second).unwrap();
    let server = AppServer::new();
    let watcher =
        SkillsWatcher::start(server.event_bridge(), [], Duration::from_millis(20)).unwrap();
    watcher.register_runtime_extra_roots([first.clone()]);
    let registration = watcher.register_roots([second.clone()]);
    assert!(!watcher.state.watched.lock().unwrap().is_empty());

    watcher.shutdown().await;
    assert!(watcher.state.watcher.lock().unwrap().is_none());
    assert!(watcher.state.watched.lock().unwrap().is_empty());
    drop(registration);
    let _late = watcher.register_roots([first, second]);
    assert!(watcher.state.watcher.lock().unwrap().is_none());
    assert!(watcher.state.watched.lock().unwrap().is_empty());
}
