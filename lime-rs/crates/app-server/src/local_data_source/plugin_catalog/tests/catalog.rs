use super::*;

#[test]
fn marketplaces_keep_errors_and_independent_identities() {
    let temp = TempDir::new().unwrap();
    let source = temp.path().join("source");
    fixture(&source);
    let params = install_params(&source);
    let market = params.marketplace_path.unwrap();
    let second_root = temp.path().join("second");
    fixture(&second_root.join("source"));
    install_params_for_market(&second_root.join("source"), "second");
    let broken_root = temp.path().join("broken");
    let broken = broken_root.join(".agents/plugins/marketplace.json");
    fs::create_dir_all(broken.parent().unwrap()).unwrap();
    fs::write(&broken, "{broken").unwrap();
    let store = isolated_store(temp.path().join("plugins"), temp.path().join("config.yaml"));
    let response = list(
        &store,
        PluginListParams {
            cwds: Some(vec![
                temp.path().to_path_buf(),
                second_root.clone(),
                broken_root,
            ]),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(response.marketplaces.len(), 2);
    assert_eq!(response.marketplace_load_errors.len(), 1);
    assert_eq!(response.marketplace_load_errors[0].marketplace_path, broken);
    let ids = response
        .marketplaces
        .iter()
        .flat_map(|market| &market.plugins)
        .map(|plugin| plugin.id.as_str())
        .collect::<std::collections::BTreeSet<_>>();
    assert_eq!(
        ids,
        ["example-plugin@test-marketplace", "example-plugin@second"]
            .into_iter()
            .collect()
    );
    let detail = read(
        &store,
        PluginReadParams {
            remote_release: None,
            marketplace_path: Some(market.clone()),
            remote_marketplace_name: None,
            plugin_name: "example-plugin".to_string(),
        },
    )
    .unwrap()
    .plugin;
    assert_eq!(
        detail.marketplace_path,
        Some(fs::canonicalize(market).unwrap())
    );
    assert!(!detail.summary.installed);
    assert!(!detail.skills[0].enabled);
    assert_eq!(detail.skills[0].name, "example-plugin:example");
    assert!(list(&store, PluginListParams::default())
        .unwrap()
        .marketplaces
        .is_empty());
    assert!(list(
        &store,
        PluginListParams {
            cwds: Some(vec![PathBuf::from("relative")]),
            ..Default::default()
        }
    )
    .is_err());
}

#[test]
fn installed_filters_candidates_and_preserves_install_policy() {
    let temp = TempDir::new().unwrap();
    let source = temp.path().join("source");
    fixture(&source);
    let params = install_params(&source);
    let store = isolated_store(temp.path().join("plugins"), temp.path().join("config.yaml"));
    let cwds = Some(vec![temp.path().to_path_buf()]);
    assert!(installed(
        &store,
        PluginInstalledParams {
            cwds: cwds.clone(),
            ..Default::default()
        }
    )
    .unwrap()
    .marketplaces
    .is_empty());
    let suggested = installed(
        &store,
        PluginInstalledParams {
            cwds: cwds.clone(),
            install_suggestion_plugin_names: Some(vec!["example-plugin".to_string()]),
        },
    )
    .unwrap();
    assert!(!suggested.marketplaces[0].plugins[0].installed);
    install(&store, params.clone()).unwrap();
    let active = installed(
        &store,
        PluginInstalledParams {
            cwds,
            ..Default::default()
        },
    )
    .unwrap();
    assert!(active.marketplaces[0].plugins[0].installed);
    let path = params.marketplace_path.as_ref().unwrap();
    let mut value: Value = serde_json::from_slice(&fs::read(path).unwrap()).unwrap();
    value["plugins"][0]["policy"] =
        serde_json::json!({"installation": "NOT_AVAILABLE", "authentication": "ON_INSTALL"});
    fs::write(path, serde_json::to_vec(&value).unwrap()).unwrap();
    let original =
        package_digest(&store.installed().unwrap()["example-plugin@test-marketplace"].root)
            .unwrap();
    assert!(install(&store, params).unwrap_err().contains("不允许安装"));
    assert_eq!(
        package_digest(&store.installed().unwrap()["example-plugin@test-marketplace"].root)
            .unwrap(),
        original
    );
}

#[test]
fn read_and_install_require_exactly_one_marketplace_locator() {
    let temp = TempDir::new().unwrap();
    let store = isolated_store(temp.path().join("plugins"), temp.path().join("config.yaml"));
    for (marketplace_path, remote_marketplace_name) in [
        (None, None),
        (
            Some(temp.path().join("marketplace.json")),
            Some("remote".to_string()),
        ),
        (None, Some("remote".to_string())),
    ] {
        assert!(install(
            &store,
            PluginInstallParams {
                remote_release: None,
                marketplace_path: marketplace_path.clone(),
                remote_marketplace_name: remote_marketplace_name.clone(),
                plugin_name: "example-plugin".to_string(),
                install_attempt_id: None,
            }
        )
        .is_err());
        assert!(read(
            &store,
            PluginReadParams {
                remote_release: None,
                marketplace_path,
                remote_marketplace_name,
                plugin_name: "example-plugin".to_string(),
            }
        )
        .is_err());
    }
    assert!(store.installed().unwrap().is_empty());
}
