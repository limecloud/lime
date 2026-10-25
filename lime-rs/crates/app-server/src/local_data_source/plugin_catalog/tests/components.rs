use super::*;

#[test]
fn loads_default_mcp_file_and_resolves_cwd_to_installed_package_root() {
    let temp = TempDir::new().unwrap();
    let source = temp.path().join("source");
    fixture(&source);
    fs::create_dir_all(source.join("scripts")).unwrap();
    fs::write(
        source.join("mcp.json"),
        r#"{
          "$schema": "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
          "mcpServers": {
            "demo": {"type": "stdio", "command": "demo-mcp", "cwd": "./scripts"}
          }
        }"#,
    )
    .unwrap();
    let data_root = isolated_store(temp.path().join("plugins"), temp.path().join("config.yaml"));
    install(&data_root, install_params(&source)).unwrap();

    let specs = list_plugin_mcp_runtime_server_specs(&data_root).unwrap();
    assert_eq!(specs.len(), 1);
    assert_eq!(specs[0].name, "demo");
    assert_eq!(
        specs[0].plugin_id.as_deref(),
        Some("example-plugin@test-marketplace")
    );
    assert!(data_root
        .data_root(
            &PluginId::parse("example-plugin@test-marketplace").unwrap(),
            true
        )
        .unwrap()
        .is_dir());
    assert_eq!(
        specs[0].config.sanitized_cwd(),
        Some(
            fs::canonicalize(
                data_root
                    .root
                    .join("cache/test-marketplace/example-plugin/1.2.3/scripts")
            )
            .unwrap()
        )
    );
    let snapshots = enabled_plugin_turn_snapshots(&data_root).unwrap();
    assert_eq!(snapshots[0].mcp_server_names, vec!["demo"]);
}

#[test]
fn does_not_create_plugin_data_for_http_only_servers() {
    let temp = TempDir::new().unwrap();
    let source = temp.path().join("source");
    fixture(&source);
    fs::write(
        source.join("mcp.json"),
        r#"{
          "$schema": "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
          "mcpServers": {
            "remote": {"type": "streamable-http", "url": "https://example.com/mcp"}
          }
        }"#,
    )
    .unwrap();
    let data_root = isolated_store(temp.path().join("plugins"), temp.path().join("config.yaml"));
    install(&data_root, install_params(&source)).unwrap();

    let specs = list_plugin_mcp_runtime_server_specs(&data_root).unwrap();

    assert_eq!(specs.len(), 1);
    assert!(!data_root
        .data_root(
            &PluginId::parse("example-plugin@test-marketplace").unwrap(),
            true
        )
        .unwrap()
        .exists());
}

#[test]
fn ignores_manifest_mcp_declarations_and_reads_only_root_file() {
    let temp = TempDir::new().unwrap();
    let inline_source = temp.path().join("inline");
    fixture(&inline_source);
    fs::write(
        inline_source.join("plugin.json"),
        r#"{
          "$schema": "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
          "name": "inline-plugin",
          "version": "1.0.0"
        }"#,
    )
    .unwrap();

    let file_source = temp.path().join("file");
    fixture(&file_source);
    fs::write(
        file_source.join("plugin.json"),
        r#"{
          "$schema": "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
          "name": "file-plugin",
          "version": "1.0.0"
        }"#,
    )
    .unwrap();
    fs::create_dir_all(file_source.join("config")).unwrap();
    fs::write(
        file_source.join("mcp.json"),
        r#"{"$schema":"https://agent-plugins.org/schemas/1.0.0/mcp.schema.json","mcpServers":{"file":{"type":"stdio","command":"file-mcp"}}}"#,
    )
    .unwrap();

    let data_root = isolated_store(temp.path().join("plugins"), temp.path().join("config.yaml"));
    install(&data_root, install_params(&inline_source)).unwrap();
    install(&data_root, install_params(&file_source)).unwrap();
    let specs = list_plugin_mcp_runtime_server_specs(&data_root).unwrap();
    assert_eq!(
        specs
            .iter()
            .map(|spec| spec.name.as_str())
            .collect::<Vec<_>>(),
        vec!["file"]
    );
}

#[test]
fn disabled_plugin_and_invalid_mcp_siblings_are_fail_closed() {
    let temp = TempDir::new().unwrap();
    let source = temp.path().join("source");
    fixture(&source);
    fs::create_dir_all(temp.path().join("outside")).unwrap();
    fs::write(
        source.join("mcp.json"),
        r#"{
          "$schema": "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
          "mcpServers": {
            "valid": {"type": "stdio", "command": "valid-mcp"},
            "invalid": {"type": "streamable-http", "url": "ftp://not-supported"},
            "escape": {"type": "stdio", "command": "escape-mcp", "cwd": "./../outside"}
          }
        }"#,
    )
    .unwrap();
    let data_root = isolated_store(temp.path().join("plugins"), temp.path().join("config.yaml"));
    install(&data_root, install_params(&source)).unwrap();

    let specs = list_plugin_mcp_runtime_server_specs(&data_root).unwrap();
    assert_eq!(specs.len(), 1);
    assert_eq!(specs[0].name, "valid");

    data_root
        .set_enabled(
            &PluginId::parse("example-plugin@test-marketplace").unwrap(),
            false,
        )
        .unwrap();
    assert!(list_plugin_mcp_runtime_server_specs(&data_root)
        .unwrap()
        .is_empty());
}

#[test]
fn same_name_in_two_marketplaces_has_independent_cache_and_enablement() {
    let temp = TempDir::new().unwrap();
    let source = temp.path().join("source");
    fixture(&source);
    let store = isolated_store(temp.path().join("plugins"), temp.path().join("config.yaml"));
    for marketplace in ["first", "second"] {
        install(&store, install_params_for_market(&source, marketplace)).unwrap();
    }
    assert_eq!(store.installed().unwrap().len(), 2);
    store
        .set_enabled(&PluginId::parse("example-plugin@first").unwrap(), false)
        .unwrap();
    let reloaded = isolated_store(store.root.clone(), store.config_path.clone());
    let snapshots = enabled_plugin_turn_snapshots(&reloaded).unwrap();
    assert_eq!(snapshots.len(), 1);
    assert_eq!(snapshots[0].config_name, "example-plugin@second");
    assert!(snapshots[0].skills[0]
        .skill_id
        .contains("example-plugin@second"));
    let first = PluginId::parse("example-plugin@first").unwrap();
    let second = PluginId::parse("example-plugin@second").unwrap();
    for id in [&first, &second] {
        let data = store.data_root(id, true).unwrap();
        fs::create_dir_all(&data).unwrap();
        fs::write(data.join("state.json"), id.key()).unwrap();
    }
    uninstall(
        &store,
        PluginUninstallParams {
            plugin_id: "example-plugin@first".to_string(),
        },
    )
    .unwrap();
    assert_eq!(store.installed().unwrap().len(), 1);
    assert!(store
        .root
        .join("cache/second/example-plugin/1.2.3")
        .is_dir());
    let config = lime_core::config::ConfigManager::load(&store.config_path).unwrap();
    assert!(!config.config().plugins.plugins.contains_key(&first.key()));
    assert_eq!(
        config.config().plugins.plugins[&second.key()].enabled,
        Some(true)
    );
    for id in [&first, &second] {
        assert_eq!(
            fs::read_to_string(store.data_root(id, true).unwrap().join("state.json")).unwrap(),
            id.key()
        );
    }
    assert!(!store.root.join("v3").exists());
}

#[test]
fn native_plugin_resources_and_namespace_reach_the_turn_snapshot() {
    let temp = TempDir::new().unwrap();
    let source = temp.path().join("native");
    fs::create_dir_all(source.join(".lime-plugin")).unwrap();
    fs::write(
        source.join(".lime-plugin/plugin.json"),
        r#"{
        "name":"native-tools", "skills":["./instructions","./more"],
        "mcpServers":{"native":{"command":"node","args":["server.js"]}}
    }"#,
    )
    .unwrap();
    for relative in ["instructions/group/writer", "more/reviewer"] {
        fs::create_dir_all(source.join(relative)).unwrap();
        fs::write(
            source.join(relative).join("SKILL.md"),
            "---\nname: example\ndescription: Native instructions\n---\nBody",
        )
        .unwrap();
    }
    let store = isolated_store(temp.path().join("plugins"), temp.path().join("config.yaml"));
    install(&store, install_params(&source)).unwrap();
    let snapshots = enabled_plugin_turn_snapshots(&store).unwrap();
    assert_eq!(snapshots[0].skills.len(), 2);
    assert_eq!(snapshots[0].skill_roots.len(), 2);
    assert!(snapshots[0]
        .skills
        .iter()
        .all(|skill| skill.name.starts_with("native-tools:")));
    let specs = list_plugin_mcp_runtime_server_specs(&store).unwrap();
    assert_eq!(specs[0].name, "native");
    assert_eq!(
        specs[0].plugin_id.as_deref(),
        Some("native-tools@test-marketplace")
    );
    assert!(store
        .root
        .join("cache/test-marketplace/native-tools/local")
        .is_dir());
}

#[test]
fn unsupported_standard_manifest_never_falls_back_to_native() {
    let temp = TempDir::new().unwrap();
    let root = temp.path();
    fs::create_dir_all(root.join(".lime-plugin")).unwrap();
    fs::write(
        root.join(".lime-plugin/plugin.json"),
        r#"{"name":"native"}"#,
    )
    .unwrap();
    fs::write(root.join("plugin.json"), r#"{"name":"unrelated"}"#).unwrap();
    assert_eq!(
        manifest_name(&read_manifest(root).unwrap()).unwrap(),
        "native"
    );
    fs::write(root.join("plugin.json"), r#"{"$schema":"https://agent-plugins.org/schemas/2.0.0/plugin.schema.json","name":"unsupported"}"#).unwrap();
    assert!(read_manifest(root).is_err());
}

#[test]
fn cache_version_selection_and_default_enablement_ignore_retired_records() {
    let temp = TempDir::new().unwrap();
    let store = isolated_store(temp.path().join("plugins"), temp.path().join("config.yaml"));
    for version in ["1.2.0", "1.10.0", "local"] {
        fixture(&store.root.join("cache/market/example-plugin").join(version));
    }
    fs::create_dir_all(store.root.join("v3/installed")).unwrap();
    fs::write(store.root.join("v3/installed/old.json"), "not valid JSON").unwrap();
    fs::write(
        &store.config_path,
        "plugins:\n  _default:\n    enabled: false\n  example-plugin@market:\n    enabled: true\n",
    )
    .unwrap();
    let installation = store
        .installed()
        .unwrap()
        .remove("example-plugin@market")
        .unwrap();
    assert_eq!(installation.version, "local");
    assert!(installation.enabled);
    fs::remove_dir_all(store.root.join("cache/market/example-plugin/local")).unwrap();
    assert_eq!(
        store.installed().unwrap()["example-plugin@market"].version,
        "1.10.0"
    );
}
