use super::*;

mod types;

pub(crate) fn cloud_fixtures() -> Vec<serde_json::Value> {
    // Produced and verified by Cloud's production Go encoder, including ZIP bytes.
    serde_json::from_str(include_str!("../testdata/cloud-market-types.json")).unwrap()
}

pub(crate) fn fixtures() -> Vec<serde_json::Value> {
    // Exact copy of LimeCore cloudclient/testdata/market-releases.json, captured 2026-11-12.
    // Tests run independently of the sibling checkout and of any network provider.
    serde_json::from_str(include_str!("../testdata/market-releases.json")).unwrap()
}

#[test]
fn three_market_manifests_preserve_core_canonical_digests() {
    let values = fixtures();
    assert_eq!(values.len(), 3);
    for value in values {
        let manifest: Manifest = serde_json::from_value(value["manifest"].clone()).unwrap();
        assert_eq!(
            manifest.sha256().unwrap(),
            value["manifest_sha256"].as_str().unwrap()
        );
        let mut changed = manifest.clone();
        changed.name.push_str(".changed");
        assert_ne!(changed.sha256().unwrap(), manifest.sha256().unwrap());
    }
}

#[test]
fn plugin_release_checks_integrity_paths_and_exact_identity() {
    let raw = fixtures().pop().unwrap();
    let mut release: Release = serde_json::from_value(serde_json::json!({
        "id": raw["id"], "itemId": raw["item_id"], "manifest": raw["manifest"],
        "manifestSha256": raw["manifest_sha256"], "archiveSha256": raw["archive_sha256"],
        "archiveSize": raw["archive_size"], "status": raw["status"], "revision": raw["revision"],
    }))
    .unwrap();
    release.validate().unwrap();
    release.manifest.files[0].path = "../plugin.json".into();
    release.manifest_sha256 = release.manifest.sha256().unwrap();
    assert!(release.validate().is_err());
}

#[test]
fn manifest_rejects_unknown_execution_fields_and_paths() {
    let mut raw = fixtures().pop().unwrap()["manifest"].clone();
    raw["plugin"]["command"] = serde_json::json!("unreviewed executable");
    assert!(serde_json::from_value::<Manifest>(raw).is_err());
    for path in [
        "../SKILL.md",
        "/plugin.json",
        "a/../b",
        "a//b",
        "a\\b",
        "a:b",
        "a\0b",
    ] {
        assert!(!safe_path(path), "{path}");
    }
    assert!(safe_path("skills/research/SKILL.md"));
}
