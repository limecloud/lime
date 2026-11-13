use super::*;

mod live;

fn state() -> Distribution {
    Distribution {
        schema_version: 1,
        profile: "fixture".into(),
        region_id: "cn-hangzhou".into(),
        operation_id: uuid::Uuid::new_v4().to_string(),
        version: "1.175.0".into(),
        archive_bytes: 12,
        archive_sha256: "a".repeat(64),
        phase: "creating".into(),
    }
}

#[tokio::test]
async fn interrupted_creation_reopens_original_identity_without_network_or_resubmission() {
    let directory = tempfile::tempdir().unwrap();
    let service = CloudDesktopService {
        root: directory.path().join("cloud-desktops"),
        cli: "must-not-execute".into(),
    };
    let mut state = state();
    service.save_distribution(&mut state, "creating").unwrap();
    let result = service
        .prepare_runtime_distribution(
            &state.profile,
            &state.region_id,
            &state.operation_id,
            &state.version,
            state.archive_bytes,
            &state.archive_sha256,
        )
        .await
        .unwrap();
    assert_eq!(result["operationId"], state.operation_id);
    assert_eq!(result["phase"], "creating");
    assert!(!result.to_string().contains("bucket"));
    assert!(service
        .read_runtime_distribution("other", &state.region_id, &state.operation_id)
        .await
        .is_err());
    assert!(service
        .read_runtime_distribution(&state.profile, "cn-shanghai", &state.operation_id)
        .await
        .is_err());
    assert!(service
        .prepare_runtime_distribution(
            &state.profile,
            &state.region_id,
            &state.operation_id,
            "1.176.0",
            state.archive_bytes,
            &state.archive_sha256
        )
        .await
        .is_err());
    assert!(!directory.path().join("cloud-runtime-releases").exists());
}

#[test]
fn durable_distribution_locks_and_schema_reject_aliases_and_tampering() {
    let directory = tempfile::tempdir().unwrap();
    let service = CloudDesktopService {
        root: directory.path().join("cloud"),
        cli: "unused".into(),
    };
    let mut state = state();
    let lock = service
        .distribution_lock(&state.profile, &state.region_id, &state.operation_id)
        .unwrap();
    assert!(service
        .distribution_lock(&state.profile, &state.region_id, &state.operation_id)
        .is_err());
    service.save_distribution(&mut state, "uploading").unwrap();
    let saved = service
        .load_distribution(&state.profile, &state.region_id, &state.operation_id)
        .unwrap();
    assert_eq!(saved.bucket(), state.bucket());
    assert_eq!(saved.key(), state.key());
    drop(lock);
    assert!(service
        .distribution_lock(&state.profile, &state.region_id, &state.operation_id)
        .is_ok());
    for id in [
        "../outside",
        "not-a-uuid",
        &state.operation_id.to_uppercase(),
    ] {
        assert!(service
            .distribution_path(&state.profile, &state.region_id, id)
            .is_err());
    }
    for (version, bytes, digest) in [
        ("1.2.3+evil", 1, "a".repeat(64)),
        ("1.2.3", 0, "a".repeat(64)),
        ("1.2.3", 1, "A".repeat(64)),
    ] {
        assert!(validate_release(version, bytes, &digest).is_err());
    }
}

#[test]
fn checked_package_rejects_changes_and_rewinds_a_verified_private_descriptor() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("package.tar.gz");
    let bytes = b"public runtime fixture";
    let mut file = private_open(&path, true).unwrap();
    file.write_all(bytes).unwrap();
    drop(file);
    let digest = format!("{:x}", Sha256::digest(bytes));
    let (mut file, checksum) = checked_package(&path, bytes.len() as u64, &digest).unwrap();
    assert_eq!(
        checksum,
        base64::engine::general_purpose::STANDARD.encode(md5::compute(bytes).0)
    );
    let mut content = Vec::new();
    file.read_to_end(&mut content).unwrap();
    assert_eq!(content, bytes);
    assert!(checked_package(&path, bytes.len() as u64 - 1, &digest).is_err());
    assert!(checked_package(&path, bytes.len() as u64, &"0".repeat(64)).is_err());
    #[cfg(unix)]
    {
        let link = directory.path().join("link.tar.gz");
        std::os::unix::fs::symlink(&path, &link).unwrap();
        assert!(checked_package(&link, bytes.len() as u64, &digest).is_err());
    }
}
