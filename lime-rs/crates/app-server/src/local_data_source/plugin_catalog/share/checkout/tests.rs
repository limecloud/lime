use super::*;
use serde_json::{json, Value};
use std::cell::Cell;
use std::path::Path;

fn setup(root: &Path) -> PluginStore {
    let mut store = PluginStore::new(root.join("store"), root.join("config.yaml"));
    let home = root.join("home");
    fs::create_dir_all(&home).unwrap();
    store.home = Some(home);
    store.bundled_marketplace = None;
    store
}

fn item(id: &str, name: &str) -> Item {
    serde_json::from_value(json!({"id":id,"name":name,"scope":"WORKSPACE","discoverability":"PRIVATE",
        "creator_account_user_id":"owner","share_principals":[],"installation_policy":"AVAILABLE",
        "authentication_policy":"ON_USE","status":"AVAILABLE","release":{"version":"1.0.0",
        "display_name":name,"description":"description","keywords":[],"interface":{"category":"Research"}}})).unwrap()
}

fn source(root: &Path, name: &str) -> PathBuf {
    let source = root.join("source").join(name);
    fs::create_dir_all(source.join(".lime-plugin")).unwrap();
    fs::write(
        source.join(".lime-plugin/plugin.json"),
        json!({"name":name}).to_string(),
    )
    .unwrap();
    fs::write(source.join(".hidden"), "package bytes").unwrap();
    source
}

#[test]
fn checkout_registers_discoverable_personal_marketplace_and_reuses_user_edits() {
    let temp = tempfile::tempdir().unwrap();
    let store = setup(temp.path());
    let item = item("opaque~1", "research");
    let identity = "a".repeat(64);
    let target = select(&store, &identity, &item.id, &item.name).unwrap();
    let source = source(temp.path(), &item.name);
    let result = register(&store, &identity, &item, &target, Some(&source), || Ok(())).unwrap();
    assert_eq!(result.plugin_id, "research@lime-curated");
    assert_eq!(result.marketplace_name, "lime-curated");
    assert_eq!(result.remote_version.as_deref(), Some("1.0.0"));
    assert!(!store.root.join("cache").exists());
    let paths = super::super::super::discovery::implicit_marketplace_paths(&store, None).unwrap();
    assert_eq!(
        paths
            .iter()
            .map(fs::canonicalize)
            .collect::<Result<Vec<_>, _>>()
            .unwrap(),
        vec![PathBuf::from(result.marketplace_path.as_ref() as &Path)]
    );
    let marketplace = super::super::super::discovery::load_marketplace(&paths[0]).unwrap();
    assert_eq!(marketplace.plugins[0].root, target.path);
    assert_eq!(marketplace.plugins[0].id.key(), result.plugin_id);
    let file = target.path.join(".hidden");
    fs::write(&file, "user edits").unwrap();
    let cold = PluginStore {
        home: store.home.clone(),
        ..PluginStore::new(store.root.clone(), store.config_path.clone())
    };
    let target = select(&cold, &identity, &item.id, &item.name).unwrap();
    assert!(target.existing);
    register(&cold, &identity, &item, &target, None, || Ok(())).unwrap();
    assert_eq!(fs::read_to_string(file).unwrap(), "user edits");
    // Another account cannot claim the already existing directory by the same name.
    assert!(select(&cold, &"b".repeat(64), &item.id, &item.name).is_err());
}

#[test]
fn checkout_recreates_missing_mapped_path_and_rejects_missing_outside_mapping() {
    let temp = tempfile::tempdir().unwrap();
    let store = setup(temp.path());
    let identity = "a".repeat(64);
    let item = item("opaque~1", "research");
    let mapped = store.home.as_ref().unwrap().join("custom/research");
    paths::edit(
        &store,
        &identity,
        &item.id,
        Some(AbsolutePathBuf::try_from(mapped.clone()).unwrap()),
    )
    .unwrap();
    let target = select(&store, &identity, &item.id, &item.name).unwrap();
    assert!(!target.existing);
    assert_eq!(target.path, target.home.join("custom/research"));
    let result = register(
        &store,
        &identity,
        &item,
        &target,
        Some(&source(temp.path(), &item.name)),
        || Ok(()),
    )
    .unwrap();
    assert_eq!(result.plugin_path.as_ref() as &Path, target.path);
    assert_eq!(
        fs::read_to_string(mapped.join(".hidden")).unwrap(),
        "package bytes"
    );
    paths::edit(
        &store,
        &identity,
        "outside",
        Some(AbsolutePathBuf::try_from(temp.path().join("missing")).unwrap()),
    )
    .unwrap();
    assert!(select(&store, &identity, "outside", "another").is_err());
}

#[test]
fn checkout_preserves_existing_marketplace_name_fields_and_unrelated_entries() {
    let temp = tempfile::tempdir().unwrap();
    let store = setup(temp.path());
    let home = store.home.as_ref().unwrap();
    let path = home.join(".agents/plugins/marketplace.json");
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    let existing = json!({"name":"my-personal","interface":{"displayName":"Mine"},"future":{"keep":true},
        "plugins":[{"name":"other","source":{"source":"local","path":"./other"},"custom":true}]});
    fs::write(&path, existing.to_string()).unwrap();
    let item = item("opaque~1", "research");
    let identity = "a".repeat(64);
    let target = select(&store, &identity, &item.id, &item.name).unwrap();
    let result = register(
        &store,
        &identity,
        &item,
        &target,
        Some(&source(temp.path(), &item.name)),
        || Ok(()),
    )
    .unwrap();
    assert_eq!(result.plugin_id, "research@my-personal");
    let value: Value = serde_json::from_slice(&fs::read(path).unwrap()).unwrap();
    assert_eq!(value["interface"], existing["interface"]);
    assert_eq!(value["future"], existing["future"]);
    assert_eq!(value["plugins"][0], existing["plugins"][0]);
    assert_eq!(value["plugins"][1]["source"]["path"], "./plugins/research");
    assert_eq!(value["plugins"][1]["policy"]["installation"], "AVAILABLE");
    assert_eq!(value["plugins"][1]["category"], "Research");
}

#[test]
fn checkout_never_replaces_existing_unmapped_files_or_directories_or_outside_mapping() {
    let temp = tempfile::tempdir().unwrap();
    let store = setup(temp.path());
    let identity = "a".repeat(64);
    let home = store.home.as_ref().unwrap();
    let destination = home.join("plugins/research");
    fs::create_dir_all(&destination).unwrap();
    fs::write(destination.join("keep"), "user").unwrap();
    assert!(select(&store, &identity, "opaque~1", "research").is_err());
    assert_eq!(
        fs::read_to_string(destination.join("keep")).unwrap(),
        "user"
    );
    fs::write(home.join("plugins/file"), "file").unwrap();
    assert!(select(&store, &identity, "opaque~1", "file").is_err());
    for outside in [temp.path(), home.as_path()] {
        paths::edit(
            &store,
            &identity,
            "opaque~1",
            Some(AbsolutePathBuf::try_from(outside.to_path_buf()).unwrap()),
        )
        .unwrap();
        assert!(select(&store, &identity, "opaque~1", "research").is_err());
    }
}

#[test]
fn checkout_rolls_back_both_registrations_after_account_change_and_only_removes_new_tree() {
    for reuse in [false, true] {
        let temp = tempfile::tempdir().unwrap();
        let store = setup(temp.path());
        let identity = "a".repeat(64);
        let item = item("opaque~1", "research");
        let home = store.home.as_ref().unwrap();
        let marketplace = home.join(".agents/plugins/marketplace.json");
        fs::create_dir_all(marketplace.parent().unwrap()).unwrap();
        let before = b"{\n  \"name\":\"mine\",\"plugins\":[],\"keep\":true\n}\n";
        fs::write(&marketplace, before).unwrap();
        if reuse {
            let edit = home.join("custom-editor");
            fs::create_dir(&edit).unwrap();
            fs::write(edit.join("keep"), "user changes").unwrap();
            paths::edit(
                &store,
                &identity,
                &item.id,
                Some(AbsolutePathBuf::try_from(edit).unwrap()),
            )
            .unwrap();
        }
        let target = select(&store, &identity, &item.id, &item.name).unwrap();
        let prior_paths = paths::load(&store, &identity).unwrap();
        let calls = Cell::new(0);
        let result = register(
            &store,
            &identity,
            &item,
            &target,
            Some(&source(temp.path(), &item.name)),
            || {
                calls.set(calls.get() + 1);
                if calls.get() == 3 {
                    Err("account changed".into())
                } else {
                    Ok(())
                }
            },
        );
        assert!(result.unwrap_err().contains("account changed"));
        assert_eq!(fs::read(&marketplace).unwrap(), before);
        assert_eq!(paths::load(&store, &identity).unwrap(), prior_paths);
        if reuse {
            assert_eq!(
                fs::read_to_string(target.path.join("keep")).unwrap(),
                "user changes"
            );
        } else {
            assert!(!target.path.exists());
        }
    }
}

#[test]
fn checkout_cleans_new_tree_on_mapping_failure_and_preserves_invalid_personal_file() {
    let temp = tempfile::tempdir().unwrap();
    let store = setup(temp.path());
    let identity = "a".repeat(64);
    let item = item("opaque~1", "research");
    let target = select(&store, &identity, &item.id, &item.name).unwrap();
    let source = source(temp.path(), &item.name);
    let calls = Cell::new(0);
    let result = register(&store, &identity, &item, &target, Some(&source), || {
        calls.set(calls.get() + 1);
        if calls.get() == 2 {
            // Simulate a cache becoming unwritable after download/copy and before commit.
            fs::write(store.root.join("share-paths"), "blocked directory").unwrap();
        }
        Ok(())
    });
    assert!(result.is_err());
    assert!(!target.path.exists());
    let marketplace = target.home.join(".agents/plugins/marketplace.json");
    assert!(!marketplace.exists());
    fs::remove_file(store.root.join("share-paths")).unwrap();
    fs::create_dir_all(marketplace.parent().unwrap()).unwrap();
    fs::write(&marketplace, "not JSON").unwrap();
    assert!(register(&store, &identity, &item, &target, Some(&source), || Ok(())).is_err());
    assert_eq!(fs::read_to_string(&marketplace).unwrap(), "not JSON");
    assert!(!target.path.exists());
}

#[test]
fn checkout_serializes_concurrent_personal_entries_without_losing_other_registrations() {
    let temp = tempfile::tempdir().unwrap();
    let store = setup(temp.path());
    let identity = "a".repeat(64);
    let workers = (0..4)
        .map(|index| {
            let item = item(&format!("opaque-{index}"), &format!("research-{index}"));
            let source = source(temp.path(), &item.name);
            let target = select(&store, &identity, &item.id, &item.name).unwrap();
            let store = store.clone();
            let identity = identity.clone();
            std::thread::spawn(move || {
                register(&store, &identity, &item, &target, Some(&source), || Ok(())).unwrap()
            })
        })
        .collect::<Vec<_>>();
    for worker in workers {
        worker.join().unwrap();
    }
    assert_eq!(paths::load(&store, &identity).unwrap().len(), 4);
    let marketplace = store
        .home
        .as_ref()
        .unwrap()
        .join(".agents/plugins/marketplace.json");
    let value: Value = serde_json::from_slice(&fs::read(marketplace).unwrap()).unwrap();
    assert_eq!(value["plugins"].as_array().unwrap().len(), 4);
}

#[cfg(unix)]
#[test]
fn checkout_rejects_symlinked_personal_paths_outside_home() {
    let temp = tempfile::tempdir().unwrap();
    let store = setup(temp.path());
    let outside = temp.path().join("outside");
    fs::create_dir(&outside).unwrap();
    std::os::unix::fs::symlink(&outside, store.home.as_ref().unwrap().join("plugins")).unwrap();
    assert!(select(&store, &"a".repeat(64), "opaque~1", "research").is_err());
    assert_eq!(fs::read_dir(outside).unwrap().count(), 0);
}

#[test]
fn checkout_rolls_back_mapping_when_personal_commit_fails() {
    let temp = tempfile::tempdir().unwrap();
    let store = setup(temp.path());
    let identity = "a".repeat(64);
    let item = item("opaque~1", "research");
    let target = select(&store, &identity, &item.id, &item.name).unwrap();
    let marketplace = target.home.join(".agents/plugins/marketplace.json");
    let calls = Cell::new(0);
    let result = register(
        &store,
        &identity,
        &item,
        &target,
        Some(&source(temp.path(), &item.name)),
        || {
            calls.set(calls.get() + 1);
            if calls.get() == 2 {
                fs::create_dir_all(&marketplace).unwrap();
            }
            Ok(())
        },
    );
    assert!(result.is_err());
    assert!(!target.path.exists());
    assert!(marketplace.is_dir());
    assert!(paths::load(&store, &identity).unwrap().is_empty());
}

#[test]
fn checkout_preserves_conflicting_personal_entry_and_does_not_create_a_tree() {
    let temp = tempfile::tempdir().unwrap();
    let store = setup(temp.path());
    let identity = "a".repeat(64);
    let item = item("opaque~1", "research");
    let target = select(&store, &identity, &item.id, &item.name).unwrap();
    let marketplace = target.home.join(".agents/plugins/marketplace.json");
    fs::create_dir_all(marketplace.parent().unwrap()).unwrap();
    let before = json!({"name":"mine","plugins":[{"name":"research","source":{"source":"local","path":"./other"}}]}).to_string();
    fs::write(&marketplace, &before).unwrap();
    assert!(register(
        &store,
        &identity,
        &item,
        &target,
        Some(&source(temp.path(), &item.name)),
        || Ok(())
    )
    .is_err());
    assert_eq!(fs::read_to_string(marketplace).unwrap(), before);
    assert!(!target.path.exists());
    assert!(paths::load(&store, &identity).unwrap().is_empty());
}
