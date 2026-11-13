use super::*;

fn extracted(index: usize) -> (tempfile::TempDir, Release) {
    let fixtures: serde_json::Value =
        serde_json::from_str(include_str!("../../testdata/cloud-market-types.json")).unwrap();
    let fixture = &fixtures[index];
    let release = serde_json::from_value(fixture["item"]["release"].clone()).unwrap();
    let file = tempfile::NamedTempFile::new().unwrap();
    fs::write(
        file.path(),
        hex::decode(fixture["archiveHex"].as_str().unwrap()).unwrap(),
    )
    .unwrap();
    (extract(file.path(), &release).unwrap(), release)
}

#[test]
fn installed_dependency_verification_accepts_nested_skill_and_empty_http_package() {
    for index in 0..4 {
        let (root, release) = extracted(index);
        verify_directory(root.path(), &release).unwrap();
    }
}

#[test]
fn installed_dependency_verification_rejects_modified_missing_and_extra_files() {
    let (root, release) = extracted(0);
    let entry = root
        .path()
        .join(&release.manifest.skill.as_ref().unwrap().entry);
    let original = fs::read(&entry).unwrap();
    let mut modified = original.clone();
    modified[0] ^= 1;
    fs::write(&entry, modified).unwrap();
    assert!(verify_directory(root.path(), &release).is_err());
    fs::write(&entry, original).unwrap();
    let extra = root.path().join("extra");
    fs::write(&extra, b"extra").unwrap();
    assert!(verify_directory(root.path(), &release).is_err());
    fs::remove_file(extra).unwrap();
    fs::remove_file(entry).unwrap();
    assert!(verify_directory(root.path(), &release).is_err());
}

#[cfg(unix)]
#[test]
fn installed_dependency_verification_rejects_a_linked_root_or_entry() {
    let (root, release) = extracted(0);
    let outside = tempfile::tempdir().unwrap();
    let link = outside.path().join("link");
    std::os::unix::fs::symlink(root.path(), &link).unwrap();
    assert!(verify_directory(&link, &release).is_err());
    let entry = root
        .path()
        .join(&release.manifest.skill.as_ref().unwrap().entry);
    let saved = outside.path().join("SKILL.md");
    fs::rename(&entry, &saved).unwrap();
    std::os::unix::fs::symlink(saved, entry).unwrap();
    assert!(verify_directory(root.path(), &release).is_err());
}
