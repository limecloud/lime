use super::*;
use serde_json::json;

pub(in crate::computer_use) fn fixture(
    helper: &[u8],
) -> (tempfile::TempDir, PathBuf, NativeResource) {
    let temp = tempfile::tempdir().unwrap();
    let executable = temp.path().join("app-server");
    let helper_path = temp.path().join("helper");
    fs::write(&executable, b"fixture app-server").unwrap();
    fs::write(&helper_path, helper).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&helper_path, fs::Permissions::from_mode(0o700)).unwrap();
    }
    let (platform, arch, id) = platform_identity();
    let manifest = json!({
        "schemaVersion":1,"applicationId":"com.limecloud.lime",
        "version":env!("CARGO_PKG_VERSION"),"platform":platform,"arch":arch,
        "resources":[
            {"id":"app-server","path":"app-server","sha256":hex::encode(Sha256::digest(b"fixture app-server"))},
            {"id":id,"path":"helper","sha256":hex::encode(Sha256::digest(helper))}
        ]
    });
    fs::write(
        temp.path().join(MANIFEST),
        serde_json::to_vec(&manifest).unwrap(),
    )
    .unwrap();
    let resource = NativeResource::from_root(temp.path(), &executable).unwrap();
    (temp, executable, resource)
}

#[test]
fn manifest_identity_server_ownership_and_digests_are_required() {
    let (temp, executable, resource) = fixture(b"helper");
    resource.verify().unwrap();
    assert!(NativeResource::from_root(temp.path(), &temp.path().join("other")).is_err());
    let manifest_path = temp.path().join(MANIFEST);
    let original = fs::read(&manifest_path).unwrap();
    for (key, value) in [
        ("schemaVersion", json!(2)),
        ("applicationId", json!("other")),
        ("version", json!("0.0.0")),
        ("platform", json!("other")),
        ("arch", json!("other")),
    ] {
        let mut manifest: serde_json::Value = serde_json::from_slice(&original).unwrap();
        manifest[key] = value;
        fs::write(&manifest_path, serde_json::to_vec(&manifest).unwrap()).unwrap();
        assert!(
            NativeResource::from_root(temp.path(), &executable).is_err(),
            "{key}"
        );
    }
    fs::write(&manifest_path, original).unwrap();
    fs::write(&resource.path, b"tampered").unwrap();
    assert!(resource.verify().is_err());
    assert!(NativeResource::from_root(temp.path(), &executable).is_err());
}

#[test]
fn verification_reads_the_tail_and_rejects_same_length_tampering() {
    let mut helper = vec![b'x'; 192 * 1024 + 1];
    let (_temp, _, resource) = fixture(&helper);
    resource.verify().unwrap();
    *helper.last_mut().unwrap() = b'y';
    fs::write(&resource.path, helper).unwrap();
    assert!(resource.verify().is_err());
}

#[test]
fn modified_app_server_is_rejected_even_with_an_unchanged_helper() {
    let (temp, executable, resource) = fixture(b"helper");
    fs::write(&executable, b"changed app-server").unwrap();
    resource.verify().unwrap();
    assert!(NativeResource::from_root(temp.path(), &executable).is_err());
}

#[test]
fn traversal_duplicate_resources_and_oversized_manifest_are_rejected() {
    let (temp, executable, _) = fixture(b"helper");
    let path = temp.path().join(MANIFEST);
    let original: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    for invalid in ["../helper", "/helper", "./helper"] {
        let mut manifest = original.clone();
        manifest["resources"][1]["path"] = json!(invalid);
        fs::write(&path, serde_json::to_vec(&manifest).unwrap()).unwrap();
        assert!(NativeResource::from_root(temp.path(), &executable).is_err());
    }
    let mut manifest = original;
    let duplicate = manifest["resources"][1].clone();
    manifest["resources"]
        .as_array_mut()
        .unwrap()
        .push(duplicate);
    fs::write(&path, serde_json::to_vec(&manifest).unwrap()).unwrap();
    assert!(NativeResource::from_root(temp.path(), &executable).is_err());
    fs::write(&path, vec![b' '; MAX_MANIFEST_BYTES as usize + 1]).unwrap();
    assert!(NativeResource::from_root(temp.path(), &executable).is_err());
}

#[cfg(unix)]
#[test]
fn symlink_cannot_escape_resource_root_even_with_matching_digest() {
    let (temp, executable, resource) = fixture(b"helper");
    let external = tempfile::tempdir().unwrap();
    fs::write(external.path().join("helper"), b"helper").unwrap();
    fs::remove_file(&resource.path).unwrap();
    std::os::unix::fs::symlink(external.path().join("helper"), &resource.path).unwrap();
    assert!(NativeResource::from_root(temp.path(), &executable).is_err());
}
