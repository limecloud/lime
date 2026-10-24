use super::*;

fn setup() -> (TempDir, std::path::PathBuf, std::path::PathBuf, AppServer) {
    let temp = TempDir::new().unwrap();
    let root = temp.path().canonicalize().unwrap().join("repo");
    std::fs::create_dir_all(root.join(".git")).unwrap();
    let user = temp.path().join("config.yaml");
    let mut config = lime_core::config::Config::default();
    config.projects.insert(
        root.to_string_lossy().into_owned(),
        lime_core::config::layers::ProjectConfig {
            trust_level: Some(lime_core::config::layers::TrustLevel::Trusted),
        },
    );
    ConfigManager::with_config(config, user.clone())
        .save()
        .unwrap();
    let server = AppServer::with_runtime(
        RuntimeCore::with_backend(Arc::new(MockBackend))
            .with_projection_store(Arc::new(
                app_server::ProjectionStore::initialize(temp.path().join("projection.sqlite"))
                    .unwrap(),
            ))
            .with_app_config_path(user.clone()),
    );
    (temp, root, user, server)
}

fn write(root: &std::path::Path, source: &str) -> std::path::PathBuf {
    let file = root.join(".lime/config.toml");
    lime_core::config::layers::save_project(&file, source).unwrap();
    file
}

#[tokio::test]
async fn read_projects_reports_effective_config_explicit_layers_origins_and_independent_revisions()
{
    let (_temp, root, _user, server) = setup();
    let child = root.join("child");
    std::fs::create_dir(&child).unwrap();
    write(
        &root,
        "model_verbosity = 'high'\napproval_policy = 'never'\n",
    );
    write(&child, "model_verbosity = 'low'\n");
    initialize(&server).await;
    let read = request(
        &server,
        2,
        METHOD_CONFIG_READ,
        json!({"cwd":child,"includeLayers":true}),
    )
    .await;
    assert_eq!(read["result"]["config"]["model_verbosity"], "low");
    assert_eq!(read["result"]["config"]["approval_policy"], "never");
    let layers = read["result"]["layers"].as_array().unwrap();
    assert_eq!(layers.len(), 3);
    assert_eq!(layers[1]["config"]["model_verbosity"], "high");
    assert!(layers[2]["config"].get("approval_policy").is_none());
    assert_eq!(
        read["result"]["origins"]["approval_policy"]["name"],
        layers[1]["name"]
    );
    assert_eq!(
        read["result"]["origins"]["model_verbosity"]["name"],
        layers[2]["name"]
    );
    assert_ne!(layers[0]["version"], layers[1]["version"]);
    let global = request(&server, 3, METHOD_CONFIG_READ, json!({})).await;
    assert!(global["result"]["config"].get("model_verbosity").is_none());
    assert_eq!(global["result"]["config"]["approval_policy"], "on-request");
}

#[tokio::test]
async fn project_writes_preserve_comments_and_user_bytes_and_reject_comment_only_conflicts() {
    let (_temp, root, user, server) = setup();
    let file = write(
        &root,
        "# heading\nmodel_verbosity = 'high' # explanation\n\n[unrelated]\nname = 'untouched'\n",
    );
    let user_before = std::fs::read(&user).unwrap();
    initialize(&server).await;
    let read = request(
        &server,
        2,
        METHOD_CONFIG_READ,
        json!({"cwd":root,"includeLayers":true}),
    )
    .await;
    let version = read["result"]["layers"][1]["version"].clone();
    let params = json!({"filePath":file,"keyPath":"model_verbosity","value":"low","mergeStrategy":"upsert","expectedVersion":version});
    request(&server, 3, METHOD_CONFIG_VALUE_WRITE, params.clone()).await;
    let saved = std::fs::read_to_string(&file).unwrap();
    assert!(saved.starts_with("# heading\n"));
    assert!(saved.contains("# explanation\n\n[unrelated]\nname = 'untouched'\n"));
    assert_eq!(std::fs::read(&user).unwrap(), user_before);
    let stale = request_error(&server, 4, METHOD_CONFIG_VALUE_WRITE, params).await;
    assert_eq!(
        stale["error"]["data"]["config_write_error_code"],
        "configVersionConflict"
    );
    let read = request(
        &server,
        5,
        METHOD_CONFIG_READ,
        json!({"cwd":root,"includeLayers":true}),
    )
    .await;
    std::fs::write(&file, format!("{saved}# external comment\n")).unwrap();
    let external = std::fs::read(&file).unwrap();
    let conflict = request_error(&server, 6, METHOD_CONFIG_VALUE_WRITE, json!({"filePath":file,"keyPath":"model_verbosity","value":"medium","mergeStrategy":"upsert","expectedVersion":read["result"]["layers"][1]["version"]})).await;
    assert_eq!(
        conflict["error"]["data"]["config_write_error_code"],
        "configVersionConflict"
    );
    assert_eq!(std::fs::read(&file).unwrap(), external);
}

#[tokio::test]
async fn invalid_batch_and_untrusted_arbitrary_paths_never_partially_write() {
    let (_temp, root, user, server) = setup();
    let file = write(
        &root,
        "model_verbosity = 'high'\nsandbox_workspace_write = { network_access = false }\n",
    );
    initialize(&server).await;
    let before = std::fs::read(&file).unwrap();
    for edits in [
        json!([{"keyPath":"model_verbosity","value":"low","mergeStrategy":"replace"},{"keyPath":"sandbox_workspace_write.network_access","value":true,"mergeStrategy":"replace"}]),
        json!([{"keyPath":"sandbox_mode","value":"invalid","mergeStrategy":"replace"}]),
        json!([{"keyPath":"desktop.enabled-reasoning-efforts","value":[],"mergeStrategy":"replace"}]),
    ] {
        let result = request_error(
            &server,
            2,
            METHOD_CONFIG_BATCH_WRITE,
            json!({"filePath":file,"edits":edits}),
        )
        .await;
        assert!(result.get("error").is_some(), "{result}");
        assert_eq!(std::fs::read(&file).unwrap(), before);
    }
    let outside = root.parent().unwrap().join("untrusted");
    std::fs::create_dir(&outside).unwrap();
    for path in [
        outside.join(".lime/config.toml"),
        outside.join("arbitrary.toml"),
        root.join(".lime/../.lime/config.toml"),
    ] {
        let result = request_error(&server, 3, METHOD_CONFIG_VALUE_WRITE, json!({"filePath":path,"keyPath":"approval_policy","value":"never","mergeStrategy":"replace"})).await;
        assert!(result.get("error").is_some(), "{result}");
    }
    let mut config = ConfigManager::load(&user).unwrap().config().clone();
    config.projects.clear();
    ConfigManager::with_config(config, user).save().unwrap();
    let result = request_error(&server, 4, METHOD_CONFIG_VALUE_WRITE, json!({"filePath":file,"keyPath":"approval_policy","value":"never","mergeStrategy":"replace"})).await;
    assert_eq!(
        result["error"]["data"]["config_write_error_code"],
        "configLayerReadonly"
    );
    assert_eq!(std::fs::read(&file).unwrap(), before);
}

#[tokio::test]
async fn new_threads_freeze_project_defaults_and_explicit_request_overrides_remain_authoritative() {
    let (_temp, root, _user, server) = setup();
    write(&root, "model_verbosity = 'high'\nweb_search = 'disabled'\napproval_policy = 'never'\nsandbox_mode = 'workspace-write'\n[sandbox_workspace_write]\nnetwork_access = true\n");
    initialize(&server).await;
    let first = request(
        &server,
        2,
        "thread/start",
        json!({"cwd":root,"model":"fixture-model","modelProvider":"fixture-provider"}),
    )
    .await;
    let id = first["result"]["thread"]["id"].clone();
    assert_eq!(first["result"]["approvalPolicy"], "never");
    assert_eq!(
        first["result"]["thread"]["extra"]["sandboxPolicy"],
        "workspace-write"
    );
    assert_eq!(
        first["result"]["thread"]["extra"]["sandboxNetworkAccess"],
        true
    );
    assert_eq!(first["result"]["thread"]["extra"]["modelVerbosity"], "high");
    assert_eq!(
        first["result"]["thread"]["extra"]["webSearchMode"],
        "disabled"
    );
    write(
        &root,
        "model_verbosity = 'low'\napproval_policy = 'on-request'\n",
    );
    let old = request(
        &server,
        3,
        "thread/read",
        json!({"threadId":id,"includeTurns":true}),
    )
    .await;
    assert_eq!(old["result"]["thread"]["extra"]["modelVerbosity"], "high");
    assert_eq!(
        old["result"]["thread"]["extra"]["webSearchMode"],
        "disabled"
    );
    let next = request(
        &server,
        4,
        "thread/start",
        json!({"cwd":root,"model":"fixture-model","modelProvider":"fixture-provider","config":{"model_verbosity":"medium"},"approvalPolicy":"never"}),
    )
    .await;
    assert_eq!(
        next["result"]["thread"]["extra"]["modelVerbosity"],
        "medium"
    );
    assert_eq!(next["result"]["approvalPolicy"], "never");
}
