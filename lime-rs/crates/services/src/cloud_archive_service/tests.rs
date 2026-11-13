use super::*;
use age::secrecy::ExposeSecret;
use std::io::Write;

fn identity(root: &Path) -> (age::x25519::Identity, PathBuf) {
    let identity = age::x25519::Identity::generate();
    let path = root.join("offline-identity");
    let mut options = OpenOptions::new(); options.write(true).create_new(true);
    #[cfg(unix)] { use std::os::unix::fs::OpenOptionsExt; options.mode(0o600); }
    options.open(&path).unwrap().write_all(identity.to_string().expose_secret().as_bytes()).unwrap();
    (identity, path)
}

#[test]
fn encrypted_round_trip_filters_credentials_and_never_restores_control_state() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("home");
    fs::create_dir_all(root.join("project")).unwrap();
    fs::write(root.join("project/code.py"), "print('hello')\n").unwrap();
    fs::write(root.join("project/.env"), "PRIVATE_VALUE=archive-secret").unwrap();
    fs::create_dir_all(root.join("project/.aliyun")).unwrap();
    fs::write(root.join("project/.aliyun/config.json"), "never-backup-cloud-key").unwrap();
    let (identity, key) = identity(directory.path());
    let output = directory.path().join("backup.age");
    let result = export(&root, &["project".into()], &output, &identity.to_public().to_string(), false, true).unwrap();
    let bytes = fs::read(&output).unwrap();
    assert!(!bytes.windows(b"hello".len()).any(|part| part == b"hello"));
    assert_eq!(result["files"], 1);
    let restored = directory.path().join("restored");
    restore(&output, &key, &restored, result["sha256"].as_str().unwrap(), 1024 * 1024).unwrap();
    assert_eq!(fs::read_to_string(restored.join("project/code.py")).unwrap(), "print('hello')\n");
    assert!(!restored.join("project/.env").exists());
    assert!(!restored.join("project/.aliyun").exists());
    assert!(restore(&output, &key, &restored, result["sha256"].as_str().unwrap(), 1024 * 1024).is_err());
    let sensitive = directory.path().join("sensitive.age");
    let result = export(&root, &["project".into()], &sensitive, &identity.to_public().to_string(), true, true).unwrap();
    let restored = directory.path().join("sensitive-restored");
    restore(&sensitive, &key, &restored, result["sha256"].as_str().unwrap(), 1024 * 1024).unwrap();
    assert!(restored.join("project/.env").exists());
    assert!(!restored.join("project/.aliyun").exists());
}

#[test]
fn corrupt_ciphertext_wrong_digest_limits_and_recovery_keys_fail_closed() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("home"); fs::create_dir(&root).unwrap();
    fs::write(root.join("document"), "private document").unwrap();
    let (identity, key) = identity(directory.path());
    let output = directory.path().join("backup.age");
    let result = export(&root, &["document".into()], &output, &identity.to_public().to_string(), false, true).unwrap();
    let restored = directory.path().join("restored");
    assert!(restore(&output, &key, &restored, &"0".repeat(64), 10000).is_err());
    assert!(restore(&output, &key, &restored, result["sha256"].as_str().unwrap(), 1).is_err());
    let mut bytes = fs::read(&output).unwrap(); *bytes.last_mut().unwrap() ^= 1; fs::write(&output, bytes).unwrap();
    assert!(restore(&output, &key, &restored, &digest(&output).unwrap().0, 10000).is_err());
    assert!(!restored.exists());
    fs::write(root.join("secret-key-in-unexpected-name"), identity.to_string().expose_secret()).unwrap();
    assert!(export(&root, &["secret-key-in-unexpected-name".into()], &directory.path().join("key.age"), &identity.to_public().to_string(), true, true).unwrap_err().contains("recovery identity"));
}

#[test]
fn portable_paths_and_control_exclusions_are_enforced_on_both_sides() {
    for path in ["../escape", "/absolute", "a/../escape", "C:drive", "a\\escape", ""] {
        assert!(safe_relative(Path::new(path)).is_err(), "{path}");
    }
    for path in [".aliyun/config.json", ".local/share/lime/lime.db", ".config/rclone/rclone.conf", ".lime/config.toml", "project/computer-use/desktop.lock", "encryption-key.v1"] {
        assert!(excluded(Path::new(path), true), "{path}");
    }
}

#[test]
fn local_encryption_key_is_excluded_even_when_its_directory_is_the_archive_root() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("selected-files"); fs::create_dir(&root).unwrap();
    fs::write(root.join("encryption-key.v1"), [42_u8; 32]).unwrap();
    fs::write(root.join("document"), "user document").unwrap();
    let (identity, key) = identity(directory.path());
    for sensitive in [false, true] {
        let output = directory.path().join(format!("backup-{sensitive}.age"));
        let result = export(&root, &["encryption-key.v1".into(), "document".into()], &output, &identity.to_public().to_string(), sensitive, true).unwrap();
        assert_eq!(result["files"], 1); assert_eq!(result["skippedEntries"], 1);
        let restored = directory.path().join(format!("restored-{sensitive}"));
        restore(&output, &key, &restored, result["sha256"].as_str().unwrap(), 10000).unwrap();
        assert_eq!(fs::read_to_string(restored.join("document")).unwrap(), "user document");
        assert!(!restored.join("encryption-key.v1").exists());
    }
}

#[test]
fn railway_login_files_require_explicit_sensitive_export_from_home_or_direct_root() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("home");
    let railway = root.join(".railway");
    fs::create_dir_all(&railway).unwrap();
    fs::write(root.join("notes.txt"), "ordinary workspace document").unwrap();
    let names = ["config.json", "config-staging.json", "config-dev.json"];
    let fixture = r#"{"user":{"access_token":"synthetic-test-only","refresh_token":"synthetic-refresh-only"}}"#;
    for name in names { fs::write(railway.join(name), fixture).unwrap(); }
    let (identity, key) = identity(directory.path());

    let plain = directory.path().join("ordinary.age");
    let result = export(&root, &["notes.txt".into(), ".railway".into()], &plain, &identity.to_public().to_string(), false, true).unwrap();
    assert_eq!(result["files"], 1);
    assert_eq!(result["containsCredentials"], false);
    let restored = directory.path().join("ordinary-restored");
    restore(&plain, &key, &restored, result["sha256"].as_str().unwrap(), 1024 * 1024).unwrap();
    assert_eq!(fs::read_to_string(restored.join("notes.txt")).unwrap(), "ordinary workspace document");
    assert!(!restored.join(".railway").exists());

    let direct = directory.path().join("direct-root.age");
    assert_eq!(export(&railway, &["config.json".into()], &direct, &identity.to_public().to_string(), false, true).unwrap_err(), "No eligible regular files selected");
    assert!(!direct.exists());

    for (label, source, paths, prefix) in [
        ("home", &root, vec![".railway".into()], ".railway"),
        ("direct", &railway, names.iter().map(|name| (*name).to_owned()).collect(), ""),
    ] {
        let output = directory.path().join(format!("sensitive-{label}.age"));
        let result = export(source, &paths, &output, &identity.to_public().to_string(), true, true).unwrap();
        assert_eq!(result["files"], names.len());
        assert_eq!(result["containsCredentials"], true);
        let destination = directory.path().join(format!("sensitive-{label}-restored"));
        restore(&output, &key, &destination, result["sha256"].as_str().unwrap(), 1024 * 1024).unwrap();
        for name in names { assert_eq!(fs::read_to_string(destination.join(prefix).join(name)).unwrap(), fixture); }
    }
}

#[test]
fn selecting_control_state_as_the_archive_root_cannot_bypass_exclusions() {
    let directory = tempfile::tempdir().unwrap();
    let (identity, _) = identity(directory.path());
    for (index, name) in [".aliyun", ".aws", ".azure", ".age", ".lime", "credentials", "cloud-desktops", ".config/gcloud", ".config/rclone", ".local/share/lime"].iter().enumerate() {
        let root = directory.path().join("home").join(name);
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("config.json"), "synthetic-control-data").unwrap();
        for sensitive in [false, true] {
            let output = directory.path().join(format!("control-{index}-{sensitive}.age"));
            assert_eq!(export(&root, &["config.json".into()], &output, &identity.to_public().to_string(), sensitive, true).unwrap_err(), "No eligible regular files selected", "{name}: sensitive={sensitive}");
            assert!(!output.exists());
        }
    }
}

#[cfg(unix)]
#[test]
fn a_symlinked_archive_root_retains_its_sensitive_directory_context() {
    use std::os::unix::fs::symlink;
    let directory = tempfile::tempdir().unwrap();
    let storage = directory.path().join("external-store");
    fs::create_dir(&storage).unwrap();
    fs::write(storage.join("config.json"), "synthetic-login-only").unwrap();
    let (identity, _) = identity(directory.path());
    for name in [".railway", ".aliyun"] {
        let selected = directory.path().join(name);
        symlink(&storage, &selected).unwrap();
        for sensitive in [false, true] {
            let output = directory.path().join(format!("alias-{name}-{sensitive}.age"));
            let result = export(&selected, &["config.json".into()], &output, &identity.to_public().to_string(), sensitive, true);
            if name == ".railway" && sensitive {
                assert_eq!(result.unwrap()["files"], 1);
            } else {
                assert_eq!(result.unwrap_err(), "No eligible regular files selected", "{name}: sensitive={sensitive}");
                assert!(!output.exists());
            }
        }
    }
}

#[cfg(unix)]
#[test]
fn initial_selection_cannot_traverse_a_symlinked_directory() {
    use std::os::unix::fs::symlink;
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("home"); fs::create_dir(&root).unwrap();
    let outside = directory.path().join("outside"); fs::create_dir(&outside).unwrap();
    fs::write(outside.join("secret"), "outside data").unwrap();
    symlink(&outside, root.join("link")).unwrap();
    let (identity, _) = identity(directory.path());
    assert!(export(&root, &["link/secret".into()], &directory.path().join("backup.age"), &identity.to_public().to_string(), true, true).is_err());
}

#[cfg(unix)]
#[test]
fn restore_preserves_owner_executable_files_without_executing_or_restoring_unsafe_permissions() {
    use std::os::unix::fs::PermissionsExt;
    let directory = tempfile::tempdir().unwrap();
    let source = directory.path().join("home"); fs::create_dir(&source).unwrap();
    let executed = directory.path().join("executed");
    fs::write(source.join("tool"), format!("#!/bin/sh\nprintf 'invoked' > \"{}\"\nprintf 'restored-tool-ready'\n", executed.display())).unwrap();
    fs::set_permissions(source.join("tool"), fs::Permissions::from_mode(0o4777)).unwrap();
    fs::write(source.join("data"), "saved application state").unwrap();
    let (identity, key) = identity(directory.path());
    let output = directory.path().join("backup.age");
    let result = export(&source, &["tool".into(), "data".into()], &output, &identity.to_public().to_string(), false, true).unwrap();
    let destination = directory.path().join("fresh-environment");
    restore(&output, &key, &destination, result["sha256"].as_str().unwrap(), 10000).unwrap();
    assert_eq!(fs::metadata(destination.join("tool")).unwrap().permissions().mode() & 0o7777, 0o700);
    assert_eq!(fs::metadata(destination.join("data")).unwrap().permissions().mode() & 0o7777, 0o600);
    assert!(!executed.exists(), "restore must never invoke recovered executables");
    // Only the test operator invokes the recovered tool, after restore completed.
    let invocation = std::process::Command::new(destination.join("tool")).output().unwrap();
    assert!(invocation.status.success());
    assert_eq!(invocation.stdout, b"restored-tool-ready");
    assert!(executed.is_file());
    assert_eq!(fs::read_to_string(destination.join("data")).unwrap(), "saved application state");
}

#[test]
fn cloud_rewrap_rejects_wrong_digest_and_uses_only_the_temporary_guest_identity() {
    let root = tempfile::tempdir().unwrap();
    let workspace = root.path().join("workspace");
    fs::create_dir(&workspace).unwrap();
    fs::write(workspace.join("test.txt"), b"persistent workspace").unwrap();
    let (offline, key) = identity(root.path());
    let backup = root.path().join("backup.age");
    let exported = export(&workspace, &["test.txt".into()], &backup, &offline.to_public().to_string(), false, true).unwrap();
    let original = exported["sha256"].as_str().unwrap();
    let rewrapped = root.path().join("rewrapped.age");
    let guest = CloudRestoreIdentity::generate();
    assert!(rewrap_for_restore(&backup, &key, &rewrapped, &"0".repeat(64), &guest.recipient()).is_err());
    assert!(!rewrapped.exists());
    let transfer = rewrap_for_restore(&backup, &key, &rewrapped, original, &guest.recipient()).unwrap();
    let expected = transfer["sha256"].as_str().unwrap();
    assert_ne!(expected, original);
    let destination = root.path().join("restored");
    assert!(restore(&rewrapped, &key, &destination, expected, 4096).is_err());
    assert!(!destination.exists());
    guest.restore(&rewrapped, &destination, expected).unwrap();
    assert_eq!(fs::read(destination.join("test.txt")).unwrap(), b"persistent workspace");
    assert_eq!(digest(&backup).unwrap().0, original);
}

#[test]
fn publishing_never_replaces_even_an_empty_destination() {
    let root = tempfile::tempdir().unwrap();
    let staged = root.path().join("staged");
    let existing = root.path().join("existing");
    fs::create_dir(&staged).unwrap();
    fs::write(staged.join("test.txt"), b"new").unwrap();
    fs::create_dir(&existing).unwrap();
    assert!(publish_restore(&staged, &existing).is_err());
    assert!(staged.join("test.txt").exists());
    assert_eq!(fs::read_dir(existing).unwrap().count(), 0);
}
