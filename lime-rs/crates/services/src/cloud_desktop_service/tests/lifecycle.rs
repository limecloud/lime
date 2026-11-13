use super::*;

#[tokio::test]
async fn lifecycle_reads_project_the_durable_receipt_while_another_observer_holds_the_lock() {
    let (directory, service, resource) = fixture();
    fs::write(directory.path().join("fail"), "").unwrap();
    let first = service
        .request(CloudDesktopParams::Stop {
            resource: resource.clone(),
            operation_id: "contended-stop".into(),
            confirmation: "stop:cn-test:i-test".into(),
            work_saved: true,
        })
        .await
        .unwrap();
    assert_eq!(first.data["outcome"], "unknown");
    let calls = fs::read(directory.path().join("calls")).unwrap();
    let durable = fs::read(service.root.join("contended-stop.json")).unwrap();
    let _lock = service.lock_operations().unwrap();
    let observed = service
        .request(CloudDesktopParams::ReadOperation {
            operation_id: "contended-stop".into(),
        })
        .await
        .unwrap();
    assert_eq!(observed, first);
    assert_eq!(
        fs::read(service.root.join("contended-stop.json")).unwrap(),
        durable
    );
    assert_eq!(fs::read(directory.path().join("calls")).unwrap(), calls);
    assert!(service
        .request(CloudDesktopParams::Stop {
            resource,
            operation_id: "replacement-stop".into(),
            confirmation: "stop:cn-test:i-test".into(),
            work_saved: true,
        })
        .await
        .is_err());
    assert!(!service.root.join("replacement-stop.json").exists());
}

#[tokio::test]
async fn lifecycle_resource_reads_skip_receipt_writes_while_another_observer_holds_the_lock() {
    let (directory, service, resource) = fixture();
    service
        .request(CloudDesktopParams::Stop {
            resource: resource.clone(),
            operation_id: "observed-stop".into(),
            confirmation: "stop:cn-test:i-test".into(),
            work_saved: true,
        })
        .await
        .unwrap();
    let path = service.root.join("observed-stop.json");
    let before = fs::read(&path).unwrap();
    fs::write(directory.path().join("stopped"), "").unwrap();
    let lock = service.lock_operations().unwrap();
    let state = service
        .request(CloudDesktopParams::Inspect { resource })
        .await
        .unwrap();
    assert_eq!(state.data["status"], "Stopped");
    assert_eq!(fs::read(&path).unwrap(), before);
    drop(lock);
    let read = CloudDesktopParams::ReadOperation {
        operation_id: "observed-stop".into(),
    };
    let verified = service.request(read.clone()).await.unwrap();
    assert_eq!(verified.data["outcome"], "lifecycleVerified");
    let calls = fs::read(directory.path().join("calls")).unwrap();
    let _lock = service.lock_operations().unwrap();
    assert_eq!(service.request(read).await.unwrap(), verified);
    assert_eq!(fs::read(directory.path().join("calls")).unwrap(), calls);
}

#[tokio::test]
async fn lifecycle_contention_does_not_hide_invalid_receipts_or_private_lock_failures() {
    use std::os::unix::fs::PermissionsExt;
    let (directory, service, resource) = fixture();
    let original = service
        .request(CloudDesktopParams::Stop {
            resource,
            operation_id: "invalid-contended-stop".into(),
            confirmation: "stop:cn-test:i-test".into(),
            work_saved: true,
        })
        .await
        .unwrap();
    let path = service.root.join("invalid-contended-stop.json");
    let mut invalid = original.data.clone();
    invalid["createdAt"] = json!("invalid");
    service
        .replace_receipt("invalid-contended-stop", &invalid)
        .unwrap();
    let calls = fs::read(directory.path().join("calls")).unwrap();
    let lock = service.lock_operations().unwrap();
    let read = CloudDesktopParams::ReadOperation {
        operation_id: "invalid-contended-stop".into(),
    };
    assert!(service.request(read.clone()).await.is_err());
    drop(lock);
    fs::write(path, serde_json::to_vec(&original.data).unwrap()).unwrap();
    fs::set_permissions(
        service.root.join("operations.lock"),
        fs::Permissions::from_mode(0o644),
    )
    .unwrap();
    assert!(service.request(read).await.is_err());
    assert_eq!(fs::read(directory.path().join("calls")).unwrap(), calls);
}

#[tokio::test]
async fn lifecycle_read_reconciles_the_original_receipt_without_resubmitting() {
    let (directory, service, resource) = fixture();
    let request = CloudDesktopParams::Stop {
        resource: resource.clone(),
        operation_id: "original-stop".into(),
        confirmation: "stop:cn-test:i-test".into(),
        work_saved: true,
    };
    service.request(request).await.unwrap();
    fs::write(directory.path().join("stopped"), "").unwrap();
    fs::write(directory.path().join("released"), "").unwrap();
    let restarted = CloudDesktopService {
        root: service.root.clone(),
        cli: service.cli.clone(),
    };
    let receipt = restarted
        .request(CloudDesktopParams::ReadOperation {
            operation_id: "original-stop".into(),
        })
        .await
        .unwrap()
        .data;
    assert_eq!(receipt["outcome"], "lifecycleVerified");
    assert_eq!(receipt["requiresInspection"], false);
    assert_eq!(receipt["observedAfter"]["status"], "Stopped");
    assert_eq!(receipt["observedAfter"]["computeReleased"], true);
    let calls = fs::read_to_string(directory.path().join("calls")).unwrap();
    assert_eq!(calls.matches("StopInstance").count(), 1);
    assert_eq!(calls.matches("DescribeInstances").count(), 2);
}

#[tokio::test]
async fn lifecycle_unknown_blocks_a_new_intent_even_through_another_profile() {
    let (directory, service, mut resource) = fixture();
    fs::write(directory.path().join("fail"), "").unwrap();
    let first = service
        .request(CloudDesktopParams::Stop {
            resource: resource.clone(),
            operation_id: "unknown-stop".into(),
            confirmation: "stop:cn-test:i-test".into(),
            work_saved: true,
        })
        .await
        .unwrap();
    assert_eq!(first.data["outcome"], "unknown");
    let before = fs::read(directory.path().join("calls")).unwrap();
    resource.profile = "another-profile".into();
    let second = service
        .request(CloudDesktopParams::Stop {
            resource,
            operation_id: "replacement-stop".into(),
            confirmation: "stop:cn-test:i-test".into(),
            work_saved: true,
        })
        .await;
    assert!(
        second.is_err(),
        "An unresolved stop must block a new intent"
    );
    assert_eq!(fs::read(directory.path().join("calls")).unwrap(), before);
    assert!(!service.root.join("replacement-stop.json").exists());
}

#[tokio::test]
async fn lifecycle_reads_only_the_original_target_and_requires_a_terminal_observation() {
    for provider in [CloudDesktopProvider::Ecs, CloudDesktopProvider::Wuying] {
        for action in ["start", "stop"] {
            let (directory, service, mut resource) = fixture();
            resource.provider = provider;
            if provider == CloudDesktopProvider::Wuying {
                resource.resource_id = "ecd-test".into();
            }
            let stopped = directory.path().join("stopped");
            if action == "start" {
                fs::write(&stopped, "").unwrap();
            }
            let request = if action == "start" {
                CloudDesktopParams::Start {
                    resource: resource.clone(),
                    operation_id: "original".into(),
                    confirmation: format!("start:cn-test:{}", resource.resource_id),
                }
            } else {
                CloudDesktopParams::Stop {
                    resource: resource.clone(),
                    operation_id: "original".into(),
                    confirmation: format!("stop:cn-test:{}", resource.resource_id),
                    work_saved: true,
                }
            };
            let first = service.request(request.clone()).await.unwrap();
            let read = CloudDesktopParams::ReadOperation {
                operation_id: "original".into(),
            };
            assert_eq!(service.request(read.clone()).await.unwrap(), first);
            if action == "start" {
                fs::remove_file(&stopped).unwrap();
            } else {
                fs::write(&stopped, "").unwrap();
            }
            let verified = service.request(read.clone()).await.unwrap();
            assert_eq!(verified.data["outcome"], "lifecycleVerified");
            assert_eq!(verified.data["observedAfter"]["resource"], json!(resource));
            assert_eq!(verified.data["requiresInspection"], false);
            assert_eq!(
                verified.data["observedAfter"]["computeReleased"],
                if provider == CloudDesktopProvider::Ecs {
                    json!(false)
                } else {
                    Value::Null
                }
            );
            let before = fs::read(directory.path().join("calls")).unwrap();
            assert_eq!(service.request(read).await.unwrap(), verified);
            assert_eq!(service.request(request).await.unwrap(), verified);
            assert_eq!(fs::read(directory.path().join("calls")).unwrap(), before);
            assert!(service.check_change_available(&resource, "start").is_ok());
        }
    }
}

#[tokio::test]
async fn lifecycle_failed_or_missing_observation_keeps_the_durable_unknown() {
    let (directory, service, resource) = fixture();
    fs::write(directory.path().join("fail"), "").unwrap();
    let first = service
        .request(CloudDesktopParams::Stop {
            resource,
            operation_id: "lost-stop".into(),
            confirmation: "stop:cn-test:i-test".into(),
            work_saved: true,
        })
        .await
        .unwrap();
    let read = CloudDesktopParams::ReadOperation {
        operation_id: "lost-stop".into(),
    };
    let path = service.root.join("lost-stop.json");
    let before = fs::read(&path).unwrap();
    fs::write(directory.path().join("fail-describe"), "").unwrap();
    assert!(service.request(read.clone()).await.is_err());
    assert_eq!(fs::read(&path).unwrap(), before);
    fs::remove_file(directory.path().join("fail-describe")).unwrap();
    fs::write(directory.path().join("missing"), "").unwrap();
    assert_eq!(service.request(read.clone()).await.unwrap(), first);
    assert_eq!(fs::read(&path).unwrap(), before);
    fs::remove_file(directory.path().join("missing")).unwrap();
    fs::write(directory.path().join("wrong-resource"), "").unwrap();
    assert!(service.request(read).await.is_err());
    assert_eq!(fs::read(&path).unwrap(), before);
}

#[tokio::test]
async fn lifecycle_unresolved_reservation_cannot_block_an_unrelated_resource() {
    let (_directory, service, resource) = fixture();
    service
        .request(CloudDesktopParams::Stop {
            resource: resource.clone(),
            operation_id: "reserved-stop".into(),
            confirmation: "stop:cn-test:i-test".into(),
            work_saved: true,
        })
        .await
        .unwrap();
    for action in ["start", "stop", "release", "snapshot", "hibernateEcs"] {
        assert!(service.check_change_available(&resource, action).is_err());
    }
    let mut unrelated = resource.clone();
    unrelated.resource_id = "i-other".into();
    assert!(service.check_change_available(&unrelated, "stop").is_ok());
    unrelated = resource.clone();
    unrelated.region_id = "cn-other".into();
    assert!(service.check_change_available(&unrelated, "stop").is_ok());
}

#[tokio::test]
async fn lifecycle_verified_receipt_requires_exact_observation_and_timestamp() {
    let (directory, service, resource) = fixture();
    service
        .request(CloudDesktopParams::Stop {
            resource,
            operation_id: "verified-stop".into(),
            confirmation: "stop:cn-test:i-test".into(),
            work_saved: true,
        })
        .await
        .unwrap();
    fs::write(directory.path().join("stopped"), "").unwrap();
    let verified = service
        .request(CloudDesktopParams::ReadOperation {
            operation_id: "verified-stop".into(),
        })
        .await
        .unwrap()
        .data;
    for (field, value) in [
        ("/verifiedAt", Value::Null),
        ("/observedAfter/resource/resourceId", json!("i-other")),
        ("/observedAfter/status", json!("Running")),
        ("/requiresInspection", json!(true)),
    ] {
        let mut malformed = verified.clone();
        *malformed.pointer_mut(field).unwrap() = value;
        service
            .replace_receipt("verified-stop", &malformed)
            .unwrap();
        assert!(service.read_receipt("verified-stop").is_err(), "{field}");
    }
    service.replace_receipt("verified-stop", &verified).unwrap();
    assert!(service.read_receipt("verified-stop").is_ok());
}

#[tokio::test]
async fn lifecycle_resource_refresh_reconciles_without_an_extra_provider_query() {
    let (directory, service, resource) = fixture();
    service
        .request(CloudDesktopParams::Stop {
            resource: resource.clone(),
            operation_id: "refresh-stop".into(),
            confirmation: "stop:cn-test:i-test".into(),
            work_saved: true,
        })
        .await
        .unwrap();
    fs::write(directory.path().join("stopped"), "").unwrap();
    let observed = service
        .request(CloudDesktopParams::Inspect {
            resource: resource.clone(),
        })
        .await
        .unwrap();
    assert_eq!(observed.data["status"], "Stopped");
    let receipt = service.read_receipt("refresh-stop").unwrap().unwrap();
    assert_eq!(receipt["outcome"], "lifecycleVerified");
    assert_eq!(receipt["observedAfter"], observed.data);
    let calls = fs::read_to_string(directory.path().join("calls")).unwrap();
    assert_eq!(calls.matches("DescribeInstances").count(), 2);
    assert_eq!(calls.matches("StopInstance").count(), 1);
    assert!(service.check_change_available(&resource, "start").is_ok());
}

#[tokio::test]
async fn lifecycle_resource_refresh_cannot_substitute_another_profile_for_the_original() {
    let (directory, service, resource) = fixture();
    service
        .request(CloudDesktopParams::Stop {
            resource: resource.clone(),
            operation_id: "original-profile-stop".into(),
            confirmation: "stop:cn-test:i-test".into(),
            work_saved: true,
        })
        .await
        .unwrap();
    fs::write(directory.path().join("stopped"), "").unwrap();
    let mut alias = resource;
    alias.profile = "another-profile".into();
    service
        .request(CloudDesktopParams::Inspect {
            resource: alias.clone(),
        })
        .await
        .unwrap();
    assert_eq!(
        service
            .read_receipt("original-profile-stop")
            .unwrap()
            .unwrap()["outcome"],
        "accepted"
    );
    assert!(service.check_change_available(&alias, "start").is_err());
    let verified = service
        .request(CloudDesktopParams::ReadOperation {
            operation_id: "original-profile-stop".into(),
        })
        .await
        .unwrap();
    assert_eq!(verified.data["outcome"], "lifecycleVerified");
    let calls = fs::read_to_string(directory.path().join("calls")).unwrap();
    let last: Value = serde_json::from_str(calls.lines().last().unwrap()).unwrap();
    let args = last.as_array().unwrap();
    let profile = args.iter().position(|value| value == "--profile").unwrap();
    assert_eq!(args[profile + 1], "lime");
}

#[tokio::test]
async fn lifecycle_pending_remains_discoverable_beyond_recent_history_window() {
    let (_directory, service, resource) = fixture();
    let original = service
        .request(CloudDesktopParams::Stop {
            resource,
            operation_id: "old-unresolved-stop".into(),
            confirmation: "stop:cn-test:i-test".into(),
            work_saved: true,
        })
        .await
        .unwrap()
        .data;
    for index in 0..55 {
        let id = format!("completed-stop-{index}");
        let mut completed = original.clone();
        completed["operationId"] = json!(id);
        completed["outcome"] = json!("lifecycleVerified");
        completed["createdAt"] = json!("2099-01-01T00:00:00Z");
        completed["verifiedAt"] = json!("2099-01-01T00:00:01Z");
        completed["requiresInspection"] = json!(false);
        completed["observedAfter"] = completed["observedBefore"].clone();
        completed["observedAfter"]["status"] = json!("Stopped");
        service.create_receipt(&id, &completed).unwrap();
    }
    let history = service.list_resources().unwrap();
    let operations = history["operations"].as_array().unwrap();
    assert_eq!(operations.len(), 51);
    assert!(operations
        .iter()
        .any(|entry| entry["operationId"] == "old-unresolved-stop"));
}
