use super::*;
use app_server_protocol::protocol::v2::MergeStrategy;
use serde_json::json;
use tool_runtime::hook_discovery::{discover_hooks, HookDiscoveryInput};

fn edit(key: &str, leaf: &str, value: serde_json::Value) -> ConfigEdit {
    ConfigEdit {
        key_path: format!(
            "hooks.state.{}.{}",
            serde_json::to_string(key).unwrap(),
            leaf
        ),
        value,
        merge_strategy: MergeStrategy::Upsert,
    }
}

#[test]
fn controls_are_consumed_by_discovery_and_executable_snapshot() {
    let home = tempfile::tempdir().unwrap();
    let cwd = tempfile::tempdir().unwrap();
    let path = home.path().join("config.toml");
    let original = "# user config\nmodel = 'keep'\n[[hooks.PreToolUse]]\nmatcher = 'Bash'\n[[hooks.PreToolUse.hooks]]\ntype = 'command'\ncommand = 'echo reviewed'\n";
    std::fs::write(&path, original).unwrap();
    let input = HookDiscoveryInput {
        lime_home: home.path().into(),
        cwd: cwd.path().into(),
        plugins: vec![],
    };
    let first = discover_hooks(&input);
    let hook = &first.hooks[0];
    assert!(!hook.is_executable());
    let key = &hook.snapshot.key;
    let hash = &hook.snapshot.current_hash;
    let response =
        write_hook_edits(&path, None, None, &[edit(key, "trusted_hash", json!(hash))]).unwrap();
    assert_eq!(response.file_path, path.to_string_lossy());
    assert!(discover_hooks(&input).hooks[0].is_executable());
    let source = std::fs::read_to_string(&path).unwrap();
    assert!(source.starts_with(original));
    write_hook_edits(
        &path,
        None,
        Some(&response.version),
        &[edit(key, "enabled", json!(false))],
    )
    .unwrap();
    assert!(!discover_hooks(&input).hooks[0].is_executable());
    write_hook_edits(&path, None, None, &[edit(key, "enabled", json!(true))]).unwrap();
    assert!(discover_hooks(&input).hooks[0].is_executable());
    let source = std::fs::read_to_string(&path)
        .unwrap()
        .replace("echo reviewed", "echo changed");
    std::fs::write(&path, source).unwrap();
    assert!(!discover_hooks(&input).hooks[0].is_executable());
}

#[test]
fn invalid_batch_paths_versions_and_values_never_partially_write() {
    let home = tempfile::tempdir().unwrap();
    let path = home.path().join("config.toml");
    let original = "# keep\nmodel = 'unchanged'\n";
    std::fs::write(&path, original).unwrap();
    let valid = edit("plugin@market:path.with.dots:0", "enabled", json!(false));
    let mut mixed = valid.clone();
    mixed.key_path = "desktop.foo".into();
    for edits in [
        vec![valid.clone(), mixed],
        vec![valid.clone(), edit("key", "enabled", json!("false"))],
        vec![valid.clone(), edit("key", "trusted_hash", json!(12))],
        vec![valid.clone(), edit("key", "other", json!(true))],
    ] {
        assert!(write_hook_edits(&path, None, None, &edits).is_err());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), original);
    }
    for file in ["relative.toml", "/elsewhere/config.toml"] {
        assert!(write_hook_edits(&path, Some(file), None, &[valid.clone()]).is_err());
    }
    let error = write_hook_edits(&path, None, Some("stale"), &[valid]).unwrap_err();
    assert_eq!(
        error.data.unwrap()["config_write_error_code"],
        "configVersionConflict"
    );
    assert_eq!(std::fs::read_to_string(&path).unwrap(), original);
}

#[test]
fn quoted_keys_and_inline_tables_preserve_neighbors() {
    let home = tempfile::tempdir().unwrap();
    let path = home.path().join("config.toml");
    std::fs::write(
        &path,
        "hooks = { state = { existing = { enabled = true } } }\n",
    )
    .unwrap();
    let key = r#"C:\work\a.b\"quoted":PreToolUse:0:0"#;
    write_hook_edits(&path, None, None, &[edit(key, "enabled", json!(false))]).unwrap();
    let source = std::fs::read_to_string(&path).unwrap();
    let document = source.parse::<DocumentMut>().unwrap();
    assert_eq!(
        document["hooks"]["state"][key]["enabled"].as_bool(),
        Some(false)
    );
    assert_eq!(
        document["hooks"]["state"]["existing"]["enabled"].as_bool(),
        Some(true)
    );
    write_hook_edits(&path, None, None, &[edit(key, "enabled", json!(null))]).unwrap();
    let source = std::fs::read_to_string(&path).unwrap();
    assert!(source
        .parse::<DocumentMut>()
        .unwrap()
        .get("hooks")
        .and_then(|item| item.get("state"))
        .and_then(|item| item.get(key))
        .and_then(|item| item.get("enabled"))
        .is_none());
}

#[test]
fn malformed_toml_or_conflicting_table_is_not_replaced() {
    let home = tempfile::tempdir().unwrap();
    let path = home.path().join("config.toml");
    for source in ["[broken", "hooks = 42\n"] {
        std::fs::write(&path, source).unwrap();
        assert!(
            write_hook_edits(&path, None, None, &[edit("key", "enabled", json!(false))]).is_err()
        );
        assert_eq!(std::fs::read_to_string(&path).unwrap(), source);
    }
}

#[test]
fn json_quoted_keys_round_trip_and_missing_removals_do_not_touch_neighbors() {
    let home = tempfile::tempdir().unwrap();
    let path = home.path().join("config.toml");
    let source = "enabled = true\n[hooks.state]\nenabled = 'keep'\n";
    std::fs::write(&path, source).unwrap();
    write_hook_edits(
        &path,
        None,
        None,
        &[edit("missing", "enabled", json!(null))],
    )
    .unwrap();
    assert_eq!(std::fs::read_to_string(&path).unwrap(), source);
    let key = "路径\\file.\"\n\t😀";
    write_hook_edits(&path, None, None, &[edit(key, "enabled", json!(false))]).unwrap();
    let document = std::fs::read_to_string(&path)
        .unwrap()
        .parse::<DocumentMut>()
        .unwrap();
    assert_eq!(
        document["hooks"]["state"][key]["enabled"].as_bool(),
        Some(false)
    );
    for path in [
        "hooks..enabled",
        "hooks.state.\"key\"suffix.enabled",
        "hooks.state.\"\\q\".enabled",
        "hooks.state.key.",
    ] {
        assert!(parse_key_path(path).is_err(), "{path}");
    }
}

#[test]
fn user_control_does_not_silently_overwrite_project_hook_state() {
    let home = tempfile::tempdir().unwrap();
    let cwd = tempfile::tempdir().unwrap();
    let path = home.path().join("config.toml");
    std::fs::write(&path, "[[hooks.PreToolUse]]\nmatcher = 'Bash'\n[[hooks.PreToolUse.hooks]]\ntype = 'command'\ncommand = 'echo review'\n").unwrap();
    let input = HookDiscoveryInput {
        lime_home: home.path().into(),
        cwd: cwd.path().into(),
        plugins: vec![],
    };
    let first = discover_hooks(&input);
    let hook = &first.hooks[0].snapshot;
    std::fs::create_dir_all(cwd.path().join(".lime")).unwrap();
    let project_path = cwd.path().join(".lime/config.toml");
    let project_state = format!(
        "[hooks.state.{}]\nenabled = false\n",
        serde_json::to_string(&hook.key).unwrap()
    );
    std::fs::write(&project_path, &project_state).unwrap();
    write_hook_edits(
        &path,
        None,
        None,
        &[
            edit(&hook.key, "enabled", json!(true)),
            edit(&hook.key, "trusted_hash", json!(hook.current_hash)),
        ],
    )
    .unwrap();
    let reloaded = discover_hooks(&input);
    assert!(!reloaded.hooks[0].snapshot.enabled);
    assert!(!reloaded.hooks[0].is_executable());
    assert_eq!(
        std::fs::read_to_string(project_path).unwrap(),
        project_state
    );
}
