use super::*;
use serde_json::json;

fn hooks(command: &str) -> Value {
    json!({"description":"test hooks","hooks":{"PreToolUse":[{"matcher":"Bash","hooks":[{"type":"command","command":command}]}]}})
}

fn package(
    temp: &tempfile::TempDir,
    declaration: Option<Value>,
) -> (PluginStore, PathBuf, PluginId, Value) {
    let root = fs::canonicalize(temp.path()).unwrap().join("package");
    fs::create_dir_all(root.join(".lime-plugin")).unwrap();
    let mut manifest = json!({"name":"demo","version":"1.0.0"});
    if let Some(declaration) = declaration {
        manifest["hooks"] = declaration;
    }
    fs::write(root.join(".lime-plugin/plugin.json"), manifest.to_string()).unwrap();
    let store = PluginStore::new(temp.path().join("plugins"), temp.path().join("config.yaml"));
    (
        store,
        root,
        PluginId::new("demo", "team").unwrap(),
        manifest,
    )
}

fn write(root: &Path, relative: &str, value: Value) {
    let path = root.join(relative);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, value.to_string()).unwrap();
}

#[test]
fn native_defaults_have_identity_data_and_stable_source_keys() {
    let temp = tempfile::TempDir::new().unwrap();
    let (store, root, id, manifest) = package(&temp, None);
    write(&root, "hooks/hooks.json", hooks("echo default"));
    let outcome = load_from_manifest(&store, &root, &id, &manifest, true);
    assert!(outcome.warnings.is_empty());
    let source = &outcome.sources[0];
    assert_eq!(source.plugin_id, "demo@team");
    assert_eq!(source.source_path, root.join("hooks/hooks.json"));
    assert_eq!(source.plugin_root, root);
    assert_eq!(
        source.plugin_data_root,
        store.data_root(&id, false).unwrap()
    );
    assert!(source.plugin_data_root.is_dir());
    assert_eq!(
        source.declarations()[0].0,
        "demo@team:hooks/hooks.json:pre_tool_use:0:0"
    );
    assert_eq!(
        declarations(&store, &root, &id, &manifest)[0].key,
        source.declarations()[0].0
    );
    let another = PluginId::new("demo", "another").unwrap();
    assert_ne!(
        declarations(&store, &root, &another, &manifest)[0].key,
        source.declarations()[0].0
    );
}

#[test]
fn explicit_files_replace_defaults_and_isolate_invalid_files() {
    let temp = tempfile::TempDir::new().unwrap();
    let (store, root, id, manifest) = package(
        &temp,
        Some(json!([
            "./custom/missing.json",
            "./custom/good.json",
            "./custom/bad.json"
        ])),
    );
    write(&root, "hooks/hooks.json", hooks("echo ignored"));
    write(&root, "custom/good.json", hooks("echo declared"));
    write(
        &root,
        "custom/bad.json",
        json!({"hooks":{"PreToolUse":"invalid"}}),
    );
    let outcome = load_from_manifest(&store, &root, &id, &manifest, false);
    assert_eq!(outcome.warnings.len(), 2);
    assert_eq!(outcome.sources.len(), 1);
    assert_eq!(outcome.sources[0].source_relative_path, "custom/good.json");
    assert!(
        !store.data_root(&id, false).unwrap().exists(),
        "read declarations must not create data"
    );
    let single = json!({"name":"demo","hooks":"./custom/good.json"});
    assert_eq!(
        load_from_manifest(&store, &root, &id, &single, false).sources,
        outcome.sources
    );
}

#[test]
fn inline_objects_and_lists_use_manifest_source_without_default_fallback() {
    let temp = tempfile::TempDir::new().unwrap();
    let (store, root, id, manifest) = package(
        &temp,
        Some(json!([hooks("echo first"), hooks("echo second")])),
    );
    write(&root, "hooks/hooks.json", hooks("echo ignored"));
    let outcome = load_from_manifest(&store, &root, &id, &manifest, false);
    assert!(outcome.warnings.is_empty());
    assert_eq!(outcome.sources.len(), 2);
    for (index, source) in outcome.sources.iter().enumerate() {
        assert_eq!(source.source_path, root.join(".lime-plugin/plugin.json"));
        assert_eq!(
            source.source_relative_path,
            format!("plugin.json#hooks[{index}]")
        );
    }
    let single = json!({"name":"demo","hooks":hooks("echo first")});
    assert_eq!(
        load_from_manifest(&store, &root, &id, &single, false).sources[0],
        outcome.sources[0]
    );
}

#[test]
fn standard_agent_plugins_do_not_admit_hook_extensions_or_default_files() {
    let temp = tempfile::TempDir::new().unwrap();
    let (store, root, id, _) = package(&temp, Some(hooks("echo native")));
    write(
        &root,
        "plugin.json",
        json!({"$schema":STANDARD_MANIFEST_SCHEMA,"name":"demo","extensions":{"com.lime":{"hooks":hooks("echo extension")}}}),
    );
    write(&root, "hooks/hooks.json", hooks("echo default"));
    let manifest = manifest::read_manifest(&root).unwrap();
    let outcome = load_from_manifest(&store, &root, &id, &manifest, true);
    assert!(outcome.sources.is_empty());
    assert!(outcome.warnings.is_empty());
    assert!(!store.data_root(&id, true).unwrap().exists());
}

#[test]
fn invalid_paths_follow_manifest_fallback_but_missing_declared_files_do_not() {
    let temp = tempfile::TempDir::new().unwrap();
    let (store, root, id, _) = package(&temp, None);
    write(&root, "hooks/hooks.json", hooks("echo default"));
    for declaration in [
        json!("../escape.json"),
        json!("./../escape.json"),
        json!([]),
        json!(false),
    ] {
        let manifest = json!({"name":"demo","hooks":declaration});
        let outcome = load_from_manifest(&store, &root, &id, &manifest, false);
        assert_eq!(outcome.sources[0].source_relative_path, "hooks/hooks.json");
    }
    let manifest = json!({"name":"demo","hooks":"./missing.json"});
    let outcome = load_from_manifest(&store, &root, &id, &manifest, false);
    assert!(outcome.sources.is_empty());
    assert_eq!(outcome.warnings.len(), 1);
}
