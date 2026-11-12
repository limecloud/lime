use super::*;

fn archive(directory: &Path, name: &str, payload: &[u8]) -> String {
    let file = private_open(&directory.join("release.zip"), true).unwrap();
    let mut writer = zip::ZipWriter::new(file);
    writer
        .start_file(
            name,
            zip::write::SimpleFileOptions::default().unix_permissions(0o755),
        )
        .unwrap();
    writer.write_all(payload).unwrap();
    let mut file = writer.finish().unwrap();
    hash_file(&mut file, MAX_ARCHIVE).unwrap()
}

#[test]
fn verified_cache_is_reused_and_tampering_never_replaces_existing_executable() {
    let root = tempfile::tempdir().unwrap();
    let digest = archive(
        root.path(),
        "rclone-v1.73.3-linux-amd64/rclone",
        b"synthetic executable",
    );
    let first = install(root.path(), "linux-amd64", &digest).unwrap();
    let before = fs::metadata(&first).unwrap().modified().unwrap();
    assert_eq!(install(root.path(), "linux-amd64", &digest).unwrap(), first);
    assert_eq!(fs::metadata(&first).unwrap().modified().unwrap(), before);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            fs::metadata(&first).unwrap().permissions().mode() & 0o777,
            0o700
        );
    }
    fs::write(&first, b"tampered executable").unwrap();
    assert_eq!(
        install(root.path(), "linux-amd64", &digest).unwrap_err(),
        "OSS_TOOL_INVALID"
    );
    assert_eq!(fs::read(first).unwrap(), b"tampered executable");
}

#[test]
fn wrong_release_digest_or_member_cannot_be_installed() {
    let root = tempfile::tempdir().unwrap();
    let digest = archive(root.path(), "elsewhere/rclone", b"synthetic executable");
    for expected in [&digest, &"0".repeat(64)] {
        assert_eq!(
            install(root.path(), "linux-amd64", expected).unwrap_err(),
            "OSS_TOOL_INVALID"
        );
        assert!(!root.path().join("rclone").exists());
    }
    assert_eq!(fs::read_dir(root.path()).unwrap().count(), 1);
}

#[cfg(unix)]
#[test]
fn symlink_targets_and_shared_archives_are_rejected() {
    use std::os::unix::fs::{symlink, PermissionsExt};
    let root = tempfile::tempdir().unwrap();
    let digest = archive(
        root.path(),
        "rclone-v1.73.3-linux-amd64/rclone",
        b"synthetic executable",
    );
    let elsewhere = root.path().join("outside");
    fs::write(&elsewhere, b"untouched").unwrap();
    symlink(&elsewhere, root.path().join("rclone")).unwrap();
    assert!(install(root.path(), "linux-amd64", &digest).is_err());
    assert_eq!(fs::read(elsewhere).unwrap(), b"untouched");
    fs::set_permissions(
        root.path().join("release.zip"),
        fs::Permissions::from_mode(0o644),
    )
    .unwrap();
    assert!(install(root.path(), "linux-amd64", &digest).is_err());
}
