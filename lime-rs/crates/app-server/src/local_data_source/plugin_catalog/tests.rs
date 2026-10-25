use super::*;
use tempfile::TempDir;

fn isolated_store(root: PathBuf, config_path: PathBuf) -> PluginStore {
    let mut store = PluginStore::new(root, config_path);
    store.home = None;
    store.bundled_marketplace = None;
    store
}

fn fixture(root: &Path) {
    fs::create_dir_all(&root).unwrap();
    fs::create_dir_all(root.join("skills/example")).unwrap();
    fs::write(
        root.join("skills/example/SKILL.md"),
        "---\nname: example\ndescription: Example skill\n---\n",
    )
    .unwrap();
    fs::write(
        root.join("plugin.json"),
        r#"{
          "$schema": "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
          "name": "example-plugin",
          "version": "1.2.3",
          "description": "Example"
        }"#,
    )
    .unwrap();
}

fn install_params(source: &Path) -> PluginInstallParams {
    install_params_for_market(source, "test-marketplace")
}

fn install_params_for_market(source: &Path, market: &str) -> PluginInstallParams {
    let manifest = read_manifest(source).unwrap();
    let plugin_name = manifest_name(&manifest).unwrap();
    let path = source
        .parent()
        .unwrap()
        .join(".agents/plugins/marketplace.json");
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    let mut value = fs::read(&path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
        .filter(|value| value["name"] == market)
        .unwrap_or_else(|| serde_json::json!({"name": market, "plugins": []}));
    let entries = value["plugins"].as_array_mut().unwrap();
    entries.retain(|entry| entry["name"] != plugin_name);
    entries.push(serde_json::json!({
        "name": plugin_name,
        "source": {"source": "local", "path": format!("./{}", source.file_name().unwrap().to_string_lossy())}
    }));
    fs::write(&path, serde_json::to_vec(&value).unwrap()).unwrap();
    PluginInstallParams {
        marketplace_path: Some(path),
        remote_marketplace_name: None,
        plugin_name,
        install_attempt_id: None,
    }
}

fn read_params(source: &Path) -> PluginReadParams {
    let params = install_params(source);
    PluginReadParams {
        marketplace_path: params.marketplace_path,
        remote_marketplace_name: None,
        plugin_name: params.plugin_name,
    }
}

#[test]
fn native_omitted_name_keeps_install_identity_after_cache_copy() {
    let temp = TempDir::new().unwrap();
    let source = temp.path().join("source-name");
    fs::create_dir_all(source.join(".lime-plugin")).unwrap();
    fs::create_dir_all(source.join("skills/write")).unwrap();
    fs::write(
        source.join(".lime-plugin/plugin.json"),
        r#"{"skills":"./skills"}"#,
    )
    .unwrap();
    fs::write(
        source.join("skills/write/SKILL.md"),
        "---\nname: write\ndescription: Write text\n---\nBody",
    )
    .unwrap();
    let store = isolated_store(temp.path().join("plugins"), temp.path().join("config.yaml"));
    install(&store, install_params(&source)).unwrap();
    assert_eq!(
        store.installed().unwrap()["source-name@test-marketplace"].version,
        "local"
    );
    let cold = isolated_store(store.root.clone(), store.config_path.clone());
    let detail = read(&cold, read_params(&source)).unwrap();
    assert_eq!(detail.plugin.skills[0].name, "source-name:write");
    let snapshot = enabled_plugin_turn_snapshots(&cold).unwrap();
    assert_eq!(snapshot[0].id, "source-name");
    assert_eq!(
        snapshot[0].skills[0].skill_id,
        "plugin:source-name@test-marketplace:write"
    );
    assert_eq!(
        fs::read_to_string(source.join(".lime-plugin/plugin.json")).unwrap(),
        r#"{"skills":"./skills"}"#
    );
}

#[test]
fn installs_standard_manifest_into_lime_cache() {
    let temp = TempDir::new().unwrap();
    let source = temp.path().join("source");
    fixture(&source);
    let data_root = isolated_store(temp.path().join("plugins"), temp.path().join("config.yaml"));
    let response = install(&data_root, install_params(&source)).unwrap();
    assert_eq!(response.auth_policy, PluginAuthPolicy::OnUse);
    assert!(response.apps_needing_auth.is_empty());
    assert!(data_root
        .installed()
        .unwrap()
        .contains_key("example-plugin@test-marketplace"));
    let detail = read(&data_root, read_params(&source)).unwrap();
    assert_eq!(detail.plugin.skills.len(), 1);
    let snapshots = enabled_plugin_turn_snapshots(&data_root).unwrap();
    assert_eq!(snapshots.len(), 1);
    assert_eq!(snapshots[0].id, "example-plugin");
    assert_eq!(snapshots[0].config_name, "example-plugin@test-marketplace");
    assert_eq!(snapshots[0].display_name, "example-plugin");
    assert_eq!(
        snapshots[0]
            .skills
            .iter()
            .map(|skill| skill.name.as_str())
            .collect::<Vec<_>>(),
        vec!["example-plugin:example"]
    );
    assert_eq!(
        installed(
            &data_root,
            PluginInstalledParams {
                cwds: Some(vec![temp.path().to_path_buf()]),
                ..Default::default()
            }
        )
        .unwrap()
        .marketplaces[0]
            .plugins
            .len(),
        1
    );
    data_root
        .set_enabled(
            &PluginId::parse("example-plugin@test-marketplace").unwrap(),
            false,
        )
        .unwrap();
    assert!(!data_root.installed().unwrap()["example-plugin@test-marketplace"].enabled);
    assert!(enabled_plugin_turn_snapshots(&data_root)
        .unwrap()
        .is_empty());
    uninstall(
        &data_root,
        PluginUninstallParams {
            plugin_id: "example-plugin@test-marketplace".to_string(),
        },
    )
    .unwrap();
    assert!(data_root.installed().unwrap().is_empty());
}

#[test]
fn repeated_install_atomically_replaces_same_version() {
    let temp = TempDir::new().unwrap();
    let source = temp.path().join("source");
    fixture(&source);
    let data_root = isolated_store(temp.path().join("plugins"), temp.path().join("config.yaml"));
    install(&data_root, install_params(&source)).unwrap();
    let cache = data_root.installed().unwrap()["example-plugin@test-marketplace"]
        .root
        .clone();
    let original = package_digest(&cache).unwrap();
    install(&data_root, install_params(&source)).unwrap();
    assert_eq!(original, package_digest(&cache).unwrap());
    fs::write(source.join("skills/example/SKILL.md"), "changed").unwrap();
    install(&data_root, install_params(&source)).unwrap();
    assert_ne!(original, package_digest(&cache).unwrap());
}

#[test]
fn optional_version_is_valid() {
    let temp = TempDir::new().unwrap();
    let source = temp.path().join("source");
    fixture(&source);
    fs::write(
        source.join("plugin.json"),
        r#"{"$schema":"https://agent-plugins.org/schemas/1.0.0/plugin.schema.json","name":"example-plugin","version":"1.2"}"#,
    )
    .unwrap();
    assert_eq!(
        manifest_version(&read_manifest(&source).unwrap()).unwrap(),
        "1.2"
    );
}

#[test]
fn rejects_manifest_without_standard_schema_and_parent_paths() {
    let temp = TempDir::new().unwrap();
    let root = temp.path().join("source");
    fs::create_dir_all(&root).unwrap();
    fs::write(
        root.join("plugin.json"),
        r#"{"name":"example-plugin","version":"1.0.0","schemaVersion":"lime.plugin.package.v1"}"#,
    )
    .unwrap();
    assert!(read_manifest(&root).is_err());
    assert!(resource_path(&root, "../outside").is_err());
}

#[test]
fn native_manifest_is_discoverable_and_standard_skills_are_direct_children() {
    let temp = TempDir::new().unwrap();
    let root = temp.path().join("source");
    fs::create_dir_all(root.join(".lime-plugin")).unwrap();
    fs::write(
        root.join(".lime-plugin/plugin.json"),
        r#"{"name":"legacy","version":"1.0.0"}"#,
    )
    .unwrap();
    assert_eq!(
        manifest_name(&read_manifest(&root).unwrap()).unwrap(),
        "legacy"
    );

    fixture(&root);
    fs::create_dir_all(root.join("skills/group/nested")).unwrap();
    fs::write(root.join("skills/group/nested/SKILL.md"), "nested").unwrap();
    let capabilities = skill_capabilities(&root, &read_manifest(&root).unwrap()).unwrap();
    assert_eq!(capabilities.len(), 1);
    assert_eq!(capabilities[0].name, "example-plugin:example");
}

#[test]
fn manifest_matches_lime_agent_plugin_validation_and_extension_precedence() {
    let temp = TempDir::new().unwrap();
    let root = temp.path().join("source");
    fs::create_dir_all(root.join(".lime-plugin")).unwrap();
    fs::write(
        root.join(".lime-plugin/plugin.json"),
        r#"{"interface":{"displayName":"Legacy Lime"}}"#,
    )
    .unwrap();
    fs::write(
        root.join("plugin.json"),
        r#"{
          "$schema":"https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
          "name":"acme.tools",
          "futureField":true,
          "extensions":{
            "com.lime":{"interface":{"displayName":"Inline Lime"}},
            "com.example.unimplemented":{"future":true}
          }
        }"#,
    )
    .unwrap();

    let manifest = read_manifest(&root).unwrap();
    assert_eq!(manifest_name(&manifest).unwrap(), "acme.tools");
    assert!(manifest.get("futureField").is_none());
    assert_eq!(
        interface_string(&manifest, "displayName").as_deref(),
        Some("Inline Lime")
    );

    fs::write(
        root.join("plugin.json"),
        r#"{"$schema":"https://agent-plugins.org/schemas/1.0.0/plugin.schema.json","name":"acme.tools","extensions":false}"#,
    )
    .unwrap();
    let manifest = read_manifest(&root).unwrap();
    assert_eq!(
        interface_string(&manifest, "displayName").as_deref(),
        Some("Legacy Lime")
    );
}

#[test]
fn portable_apps_extension_is_metadata_without_enabling_apps() {
    let temp = TempDir::new().unwrap();
    let root = temp.path().join("source");
    fs::create_dir_all(root.join(".lime-plugin")).unwrap();
    fs::write(
        root.join("plugin.json"),
        r#"{
          "$schema":"https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
          "name":"acme.tools",
          "extensions":{
            "com.lime":{"apps":"./apps.json"}
          }
        }"#,
    )
    .unwrap();
    fs::write(
        root.join(".lime-plugin/plugin.json"),
        r#"{"apps":"./legacy-apps.json"}"#,
    )
    .unwrap();
    fs::write(
        root.join("apps.json"),
        r#"{"apps":{"Calendar":{"id":"calendar","category":"productivity"}}}"#,
    )
    .unwrap();
    fs::write(
        root.join("legacy-apps.json"),
        r#"{"apps":{"Legacy":{"id":"legacy"}}}"#,
    )
    .unwrap();

    let manifest = read_manifest(&root).unwrap();
    let detail = build_capability_detail(&root, &manifest).unwrap();
    assert_eq!(manifest["apps"], "./apps.json");
    assert!(detail.apps.is_empty());

    fs::write(root.join("apps.json"), r#"{"apps":{"Broken":{}}}"#).unwrap();
    let manifest = read_manifest(&root).unwrap();
    assert!(build_capability_detail(&root, &manifest)
        .unwrap()
        .apps
        .is_empty());

    fs::write(
        root.join("plugin.json"),
        r#"{
          "$schema":"https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
          "name":"acme.tools",
          "extensions":{"com.lime":{"apps":"apps.json"}}
        }"#,
    )
    .unwrap();
    let manifest = read_manifest(&root).unwrap();
    assert!(build_capability_detail(&root, &manifest)
        .unwrap()
        .apps
        .is_empty());

    fs::write(
        root.join("plugin.json"),
        r#"{
          "$schema":"https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
          "name":"acme.tools",
          "extensions":{"com.lime":{"apps":{"inline":true}}}
        }"#,
    )
    .unwrap();
    assert!(read_manifest(&root)
        .unwrap_err()
        .contains("apps 必须是包内相对路径"));
}

#[test]
fn manifest_rejects_invalid_declared_metadata_types() {
    let temp = TempDir::new().unwrap();
    let root = temp.path().join("source");
    fs::create_dir_all(&root).unwrap();

    for invalid in [
        r#"{"$schema":"https://agent-plugins.org/schemas/1.0.0/plugin.schema.json","name":"demo","version":null}"#,
        r#"{"$schema":"https://agent-plugins.org/schemas/1.0.0/plugin.schema.json","name":"demo","homepage":42}"#,
        r#"{"$schema":"https://agent-plugins.org/schemas/1.0.0/plugin.schema.json","name":"demo","author":{"name":null}}"#,
        r#"{"$schema":"https://agent-plugins.org/schemas/1.0.0/plugin.schema.json","name":"demo","author":{"future":"value"}}"#,
        r#"{"$schema":"https://agent-plugins.org/schemas/1.0.0/plugin.schema.json","name":"demo","keywords":["valid",1]}"#,
    ] {
        fs::write(root.join("plugin.json"), invalid).unwrap();
        assert!(read_manifest(&root).is_err(), "accepted {invalid}");
    }
}

#[cfg(unix)]
#[test]
fn manifest_rejects_symlinked_root_file() {
    use std::os::unix::fs::symlink;

    let temp = TempDir::new().unwrap();
    let root = temp.path().join("source");
    fs::create_dir_all(&root).unwrap();
    let target = temp.path().join("plugin.json");
    fs::write(
        &target,
        r#"{"$schema":"https://agent-plugins.org/schemas/1.0.0/plugin.schema.json","name":"demo"}"#,
    )
    .unwrap();
    symlink(target, root.join("plugin.json")).unwrap();

    assert!(read_manifest(&root).is_err());
}

#[test]
fn resolves_lime_marketplace_sources_from_marketplace_root() {
    let temp = TempDir::new().unwrap();
    let marketplace_root = temp.path().join("openai-bundled");
    let package_root = marketplace_root.join("plugins/browser");
    fixture(&package_root);
    let marketplace_path = marketplace_root.join(".agents/plugins/marketplace.json");
    fs::create_dir_all(marketplace_path.parent().unwrap()).unwrap();
    fs::write(
        &marketplace_path,
        r#"{
          "name": "openai-bundled",
          "plugins": [{
            "name": "example-plugin",
            "source": {"source": "local", "path": "./plugins/browser"}
          }]
        }"#,
    )
    .unwrap();

    let response = list(
        &isolated_store(temp.path().join("plugins"), temp.path().join("config.yaml")),
        PluginListParams {
            cwds: Some(vec![marketplace_root.clone()]),
            ..Default::default()
        },
    )
    .unwrap();

    let marketplace = response
        .marketplaces
        .iter()
        .find(|market| market.name == "openai-bundled")
        .unwrap();
    assert_eq!(marketplace.plugins.len(), 1);
    assert_eq!(marketplace.plugins[0].id, "example-plugin@openai-bundled");
    assert_eq!(
        marketplace.path.as_deref(),
        Some(fs::canonicalize(&marketplace_path).unwrap().as_path())
    );
}

#[test]
fn rejects_marketplace_local_source_outside_marketplace_root() {
    let temp = TempDir::new().unwrap();
    let marketplace_root = temp.path().join("marketplace");
    let outside = temp.path().join("outside");
    fixture(&outside);
    let marketplace_path = marketplace_root.join(".agents/plugins/marketplace.json");
    fs::create_dir_all(marketplace_path.parent().unwrap()).unwrap();
    fs::write(
        &marketplace_path,
        r#"{
          "name": "invalid-local-source",
          "plugins": [{
            "name": "example-plugin",
            "source": {"source": "local", "path": "../outside"}
          }]
        }"#,
    )
    .unwrap();

    let error = load_marketplace(&marketplace_path).err().unwrap();
    assert!(error.contains("local source 不合法"), "{error}");
}

#[test]
fn config_failure_restores_previous_install_and_uninstall_cache() {
    let temp = TempDir::new().unwrap();
    let source = temp.path().join("source");
    fixture(&source);
    let store = isolated_store(temp.path().join("plugins"), temp.path().join("config.yaml"));
    install(&store, install_params(&source)).unwrap();
    let id = PluginId::parse("example-plugin@test-marketplace").unwrap();
    let original = package_digest(&store.installed().unwrap()[&id.key()].root).unwrap();
    let original_config = fs::read(&store.config_path).unwrap();
    let blocker = temp.path().join("not-a-directory");
    fs::write(&blocker, "preserve").unwrap();
    let broken = isolated_store(store.root.clone(), blocker.join("config.yaml"));
    fs::write(source.join("skills/example/SKILL.md"), "changed").unwrap();
    assert!(install(&broken, install_params(&source)).is_err());
    assert_eq!(
        package_digest(&store.installed().unwrap()[&id.key()].root).unwrap(),
        original
    );
    assert!(uninstall(
        &broken,
        PluginUninstallParams {
            plugin_id: id.key()
        }
    )
    .is_err());
    assert_eq!(
        package_digest(&store.installed().unwrap()[&id.key()].root).unwrap(),
        original
    );
    assert_eq!(fs::read(&store.config_path).unwrap(), original_config);
    assert_eq!(fs::read_to_string(blocker).unwrap(), "preserve");
    assert!(fs::read_dir(store.base_root(&id).parent().unwrap())
        .unwrap()
        .all(|entry| !entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with(".plugin-")));
}

mod catalog;
mod components;
