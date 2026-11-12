use super::*;

fn restore(resource: &CloudDesktopResource, id: &str) -> CloudDesktopParams {
    let disk = if resource.provider == CloudDesktopProvider::Ecs {
        "d-test"
    } else {
        "system"
    };
    CloudDesktopParams::RestoreSnapshot {
        resource: resource.clone(),
        disk_id: disk.into(),
        snapshot_id: "s-test".into(),
        operation_id: id.into(),
        work_saved: true,
        discard_changes: true,
        confirmation: format!(
            "restoreSnapshot:cn-test:{}:{disk}:s-test",
            resource.resource_id
        ),
    }
}

fn calls(directory: &tempfile::TempDir) -> Vec<Vec<String>> {
    fs::read_to_string(directory.path().join("calls"))
        .unwrap_or_default()
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect()
}

#[tokio::test]
async fn exact_snapshot_queries_verify_ownership_availability_and_sanitize_fields() {
    for provider in [CloudDesktopProvider::Ecs, CloudDesktopProvider::Wuying] {
        let (directory, service, mut resource) = fixture();
        resource.provider = provider;
        if provider == CloudDesktopProvider::Wuying {
            resource.resource_id = "ecd-test".into();
        }
        let disk = if provider == CloudDesktopProvider::Ecs {
            "d-test"
        } else {
            "system"
        };
        let request = CloudDesktopParams::InspectSnapshot {
            resource,
            disk_id: disk.into(),
            snapshot_id: "s-test".into(),
        };
        let data = service.request(request.clone()).await.unwrap().data;
        assert_eq!(data["ready"], true);
        assert!(!data.to_string().contains("must-not-leak"));
        for marker in [
            "wrong-source",
            "wrong-snapshot",
            "missing-snapshot",
            "fail-snapshot",
        ] {
            fs::write(directory.path().join(marker), "").unwrap();
            assert!(
                service.request(request.clone()).await.is_err(),
                "{provider:?}: {marker}"
            );
            fs::remove_file(directory.path().join(marker)).unwrap();
        }
        fs::write(directory.path().join("progressing"), "").unwrap();
        assert_eq!(service.request(request).await.unwrap().data["ready"], false);
    }
}

#[tokio::test]
async fn snapshot_encryption_requires_explicit_provider_boolean_and_never_exports_key_reference() {
    for provider in [CloudDesktopProvider::Ecs, CloudDesktopProvider::Wuying] {
        let (directory, service, mut resource) = fixture();
        resource.provider = provider;
        let disk = if provider == CloudDesktopProvider::Ecs {
            "d-test"
        } else {
            resource.resource_id = "ecd-test".into();
            "system"
        };
        let request = CloudDesktopParams::InspectSnapshot {
            resource,
            disk_id: disk.into(),
            snapshot_id: "s-test".into(),
        };
        assert!(service.request(request.clone()).await.unwrap().data["encrypted"].is_null());
        for (reported, expected) in [
            (json!(true), json!(true)),
            (json!(false), json!(false)),
            (json!("true"), Value::Null),
            (json!(1), Value::Null),
        ] {
            fs::write(
                directory.path().join("encryption.json"),
                reported.to_string(),
            )
            .unwrap();
            let data = service.request(request.clone()).await.unwrap().data;
            assert_eq!(data["encrypted"], expected);
            assert_eq!(data["ready"], true);
            assert!(!data.to_string().contains("must-not-leak"));
            assert!(data.get("KMSKeyId").is_none());
            assert!(data.get("VolumeEncryptionKey").is_none());
        }
    }
}

#[tokio::test]
async fn restores_validate_consent_before_provider_and_fail_closed_on_wrong_disks() {
    for field in ["confirmation", "workSaved", "discardChanges"] {
        let (directory, service, resource) = fixture();
        let mut value = serde_json::to_value(restore(&resource, "restore-1")).unwrap();
        value[field] = if field == "confirmation" {
            json!("restoreSnapshot:wrong")
        } else {
            json!(false)
        };
        assert!(service
            .request(serde_json::from_value(value).unwrap())
            .await
            .is_err());
        assert!(calls(&directory).is_empty());
    }
    for marker in [
        "running",
        "wrong-disk",
        "wrong-source",
        "unavailable",
        "progressing",
        "shared-disk",
        "snapshot-count",
        "locked",
        "disk-locked",
        "invalid-locks",
    ] {
        let (directory, service, resource) = fixture();
        if marker != "running" {
            fs::write(directory.path().join("stopped"), "").unwrap();
        }
        fs::write(directory.path().join(marker), "").unwrap();
        assert!(
            service
                .request(restore(&resource, "restore-1"))
                .await
                .is_err(),
            "{marker}"
        );
        assert!(!calls(&directory).iter().any(|args| args[1] == "ResetDisk"));
        assert!(!service.root.join("restore-1.json").exists());
    }
}

#[tokio::test]
async fn restore_replay_and_unknown_response_never_resubmit_or_allow_new_destructive_ids() {
    for lost in [false, true] {
        let (directory, service, resource) = fixture();
        fs::write(directory.path().join("stopped"), "").unwrap();
        if lost {
            fs::write(directory.path().join("fail"), "").unwrap();
        }
        let request = restore(&resource, "restore-1");
        let first = service.request(request.clone()).await.unwrap();
        assert_eq!(
            first.data["outcome"],
            if lost { "unknown" } else { "accepted" }
        );
        assert_eq!(first.data["requiresApplicationValidation"], true);
        let before = calls(&directory);
        assert_eq!(service.request(request).await.unwrap(), first);
        assert_eq!(calls(&directory), before);
        assert!(service
            .request(restore(&resource, "restore-2"))
            .await
            .unwrap_err()
            .contains("unresolved"));
        let mut alias = resource.clone();
        alias.profile = "profile-alias".into();
        assert!(service
            .request(restore(&alias, "restore-alias"))
            .await
            .unwrap_err()
            .contains("unresolved"));
        assert!(service
            .request(CloudDesktopParams::Release {
                resource: resource.clone(),
                operation_id: "delete-1".into(),
                confirmation: "release:cn-test:i-test:discard-data".into(),
                work_saved: true,
                discard_data: true,
                image_operation_id: None
            })
            .await
            .is_err());
        let inspected = service
            .request(CloudDesktopParams::ReadOperation {
                operation_id: "restore-1".into(),
            })
            .await
            .unwrap()
            .data;
        assert_eq!(inspected["outcome"], first.data["outcome"]);
        assert_eq!(inspected["requiresApplicationValidation"], true);
        assert_eq!(
            calls(&directory)
                .iter()
                .filter(|args| args[1] == "ResetDisk")
                .count(),
            1
        );
    }
}

#[tokio::test]
async fn restore_verification_requires_running_desktop_and_explicit_user_validation() {
    let (directory, service, resource) = fixture();
    fs::write(directory.path().join("stopped"), "").unwrap();
    service
        .request(restore(&resource, "restore-1"))
        .await
        .unwrap();
    let request = CloudDesktopParams::VerifySnapshotRestore {
        operation_id: "restore-1".into(),
        confirmation: "verifyRestore:cn-test:i-test:d-test:s-test".into(),
        applications_validated: true,
    };
    assert!(service
        .request(request.clone())
        .await
        .unwrap_err()
        .contains("Start"));
    // Starting is necessary for validation and must not silently repeat the rollback.
    service
        .request(CloudDesktopParams::Start {
            resource: resource.clone(),
            operation_id: "start-after-restore".into(),
            confirmation: "start:cn-test:i-test".into(),
        })
        .await
        .unwrap();
    fs::remove_file(directory.path().join("stopped")).unwrap();
    let mut invalid = serde_json::to_value(&request).unwrap();
    invalid["applicationsValidated"] = json!(false);
    assert!(service
        .request(serde_json::from_value(invalid).unwrap())
        .await
        .is_err());
    let verified = service.request(request.clone()).await.unwrap().data;
    assert_eq!(verified["outcome"], "verified");
    assert_eq!(verified["verification"], "userConfirmed");
    assert_eq!(verified["requiresInspection"], false);
    assert_eq!(service.request(request).await.unwrap().data, verified);
    let restarted = CloudDesktopService {
        root: service.root.clone(),
        cli: service.cli.clone(),
    };
    assert_eq!(
        restarted
            .request(CloudDesktopParams::ReadOperation {
                operation_id: "restore-1".into()
            })
            .await
            .unwrap()
            .data,
        verified
    );
    fs::write(directory.path().join("stopped"), "").unwrap();
    service
        .request(restore(&resource, "restore-2"))
        .await
        .unwrap();
}

#[tokio::test]
async fn wuying_restore_uses_original_snapshot_without_automatic_shutdown_or_image_rebuild() {
    let (directory, service, mut resource) = fixture();
    resource.provider = CloudDesktopProvider::Wuying;
    resource.resource_id = "ecd-test".into();
    fs::write(directory.path().join("stopped"), "").unwrap();
    service
        .request(restore(&resource, "restore-1"))
        .await
        .unwrap();
    let calls = calls(&directory);
    let reset: Vec<_> = calls
        .iter()
        .filter(|args| args[1] == "ResetSnapshot")
        .collect();
    assert_eq!(reset.len(), 1);
    assert!(reset[0]
        .windows(2)
        .any(|args| args == ["--SnapshotId", "s-test"]));
    assert!(reset[0]
        .windows(2)
        .any(|args| args == ["--StopDesktop", "false"]));
    assert!(!calls.iter().any(
        |args| ["ResetDesktops", "RebuildDesktops", "StopDesktops"].contains(&args[1].as_str())
    ));
}

#[tokio::test]
async fn snapshot_creation_only_becomes_ready_after_exact_provider_inspection() {
    let (directory, service, resource) = fixture();
    fs::write(directory.path().join("stopped"), "").unwrap();
    service
        .request(CloudDesktopParams::Snapshot {
            resource,
            operation_id: "snapshot-1".into(),
            confirmation: "snapshot:cn-test:i-test:d-test".into(),
            disk_id: "d-test".into(),
            work_saved: true,
        })
        .await
        .unwrap();
    let request = CloudDesktopParams::ReadOperation {
        operation_id: "snapshot-1".into(),
    };
    fs::write(directory.path().join("progressing"), "").unwrap();
    assert_eq!(
        service.request(request.clone()).await.unwrap().data["outcome"],
        "accepted"
    );
    fs::remove_file(directory.path().join("progressing")).unwrap();
    let ready = service.request(request).await.unwrap().data;
    assert_eq!(ready["outcome"], "snapshotReady");
    assert_eq!(ready["requiresInspection"], false);
    assert_eq!(
        calls(&directory)
            .iter()
            .filter(|args| args[1] == "CreateSnapshot")
            .count(),
        1
    );
}

#[tokio::test]
async fn corrupt_restore_receipts_cannot_bypass_validation_or_reconciliation() {
    for field in ["discardChanges", "ready", "outcome"] {
        let (directory, service, resource) = fixture();
        fs::write(directory.path().join("stopped"), "").unwrap();
        service
            .request(restore(&resource, "restore-1"))
            .await
            .unwrap();
        let path = service.root.join("restore-1.json");
        let mut receipt: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        match field {
            "discardChanges" => receipt["request"][field] = json!(false),
            "ready" => receipt["snapshotBefore"][field] = json!(false),
            _ => receipt["outcome"] = json!("verified"),
        }
        fs::write(path, serde_json::to_vec(&receipt).unwrap()).unwrap();
        let before = calls(&directory);
        assert!(service
            .request(restore(&resource, "restore-2"))
            .await
            .is_err());
        assert_eq!(calls(&directory), before);
    }
}
