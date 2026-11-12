use super::*;

fn request(resource: CloudDesktopResource, operation_id: &str) -> CloudDesktopParams {
    CloudDesktopParams::Release {
        confirmation: format!(
            "release:{}:{}:discard-data",
            resource.region_id, resource.resource_id
        ),
        resource,
        operation_id: operation_id.into(),
        work_saved: true,
        discard_data: true,
        image_operation_id: None,
    }
}

fn calls(directory: &Path) -> Vec<Vec<String>> {
    fs::read_to_string(directory.join("calls"))
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect()
}

#[tokio::test]
async fn ecs_release_is_non_forced_and_only_verified_absence_retires_the_binding() {
    let (directory, service, resource) = fixture();
    fs::write(directory.path().join("stopped"), "").unwrap();
    service.remember_resource(&resource).unwrap();
    let params = request(resource, "ecs-release");
    let first = service.request(params.clone()).await.unwrap();
    assert_eq!(first.data["outcome"], "accepted");
    let before = calls(directory.path());
    assert_eq!(service.request(params).await.unwrap(), first);
    assert_eq!(calls(directory.path()), before);
    let read = CloudDesktopParams::ReadOperation {
        operation_id: "ecs-release".into(),
    };
    assert_eq!(service.request(read.clone()).await.unwrap(), first);
    assert_eq!(
        service.list_resources().unwrap()["resources"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    fs::write(directory.path().join("missing"), "").unwrap();
    let receipt = service.request(read).await.unwrap().data;
    assert_eq!(receipt["outcome"], "released");
    assert_eq!(receipt["requiresInspection"], false);
    assert_eq!(
        receipt["observedAfter"]["retainedResourcesMayBeCharged"],
        true
    );
    let restarted = CloudDesktopService {
        root: service.root.clone(),
        cli: service.cli.clone(),
    };
    assert_eq!(restarted.list_resources().unwrap()["resources"], json!([]));
    let calls = calls(directory.path());
    let deletes: Vec<_> = calls
        .iter()
        .filter(|args| args[1] == "DeleteInstance")
        .collect();
    assert_eq!(deletes.len(), 1);
    for expected in [
        ["--InstanceId", "i-test"],
        ["--Force", "false"],
        ["--TerminateSubscription", "false"],
        ["--RegionId", "cn-test"],
        ["--profile", "lime"],
    ] {
        assert!(deletes[0].windows(2).any(|pair| pair == expected));
    }
    assert!(calls.iter().all(
        |args| !["DeleteDisk", "DeleteSnapshot", "DeleteSecurityGroup"].contains(&args[1].as_str())
    ));
}

#[tokio::test]
async fn ecs_lost_release_response_is_recovered_after_restart_without_resending() {
    let (directory, service, resource) = fixture();
    fs::write(directory.path().join("stopped"), "").unwrap();
    fs::write(directory.path().join("lost-delete"), "").unwrap();
    let params = request(resource, "ecs-release-lost");
    assert_eq!(
        service.request(params.clone()).await.unwrap().data["outcome"],
        "unknown"
    );
    let before = calls(directory.path());
    let restarted = CloudDesktopService {
        root: service.root.clone(),
        cli: service.cli.clone(),
    };
    restarted.request(params).await.unwrap();
    assert_eq!(calls(directory.path()), before);
    let receipt = restarted
        .request(CloudDesktopParams::ReadOperation {
            operation_id: "ecs-release-lost".into(),
        })
        .await
        .unwrap()
        .data;
    assert_eq!(receipt["outcome"], "released");
    assert_eq!(
        calls(directory.path())
            .iter()
            .filter(|args| args[1] == "DeleteInstance")
            .count(),
        1
    );
}

#[tokio::test]
async fn ecs_release_rejects_running_prepaid_missing_charge_and_missing_instances() {
    for marker in [
        "running",
        "prepaid",
        "missing-charge",
        "missing",
        "wrong-resource",
    ] {
        let (directory, service, resource) = fixture();
        if marker != "running" {
            fs::write(directory.path().join("stopped"), "").unwrap();
            fs::write(directory.path().join(marker), "").unwrap();
        }
        assert!(
            service
                .request(request(resource, "ecs-invalid"))
                .await
                .is_err(),
            "{marker}"
        );
        assert!(
            calls(directory.path())
                .iter()
                .all(|args| args[1] != "DeleteInstance"),
            "{marker}"
        );
        assert!(!service.root.join("ecs-invalid.json").exists());
    }
}

#[tokio::test]
async fn ecs_release_requires_saved_work_exact_identity_and_disk_discard_before_cloud_calls() {
    for field in ["confirmation", "workSaved", "discardData"] {
        let (directory, service, resource) = fixture();
        let mut params = serde_json::to_value(request(resource, "ecs-consent")).unwrap();
        params[field] = if field == "confirmation" {
            json!("release:cn-test:i-other:discard-data")
        } else {
            json!(false)
        };
        assert!(
            service
                .request(serde_json::from_value(params).unwrap())
                .await
                .is_err(),
            "{field}"
        );
        assert!(!directory.path().join("calls").exists(), "{field}");
    }
}

#[tokio::test]
async fn ecs_inventory_errors_never_verify_release_or_drop_resource_bindings() {
    let (directory, service, resource) = fixture();
    fs::write(directory.path().join("stopped"), "").unwrap();
    service.remember_resource(&resource).unwrap();
    service
        .request(request(resource, "ecs-inventory"))
        .await
        .unwrap();
    for marker in [
        "malformed",
        "inconsistent",
        "invalid-count",
        "fail-describe",
        "wrong-resource",
    ] {
        fs::write(directory.path().join(marker), "").unwrap();
        assert!(
            service
                .request(CloudDesktopParams::ReadOperation {
                    operation_id: "ecs-inventory".into()
                })
                .await
                .is_err(),
            "{marker}"
        );
        assert_eq!(
            service.read_receipt("ecs-inventory").unwrap().unwrap()["outcome"],
            "accepted"
        );
        assert_eq!(
            service.list_resources().unwrap()["resources"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        fs::remove_file(directory.path().join(marker)).unwrap();
    }
}

#[tokio::test]
async fn a_new_operation_id_cannot_bypass_an_unresolved_release() {
    for provider in [CloudDesktopProvider::Ecs, CloudDesktopProvider::Wuying] {
        let (directory, service, mut resource) = fixture();
        resource.provider = provider;
        if provider == CloudDesktopProvider::Wuying {
            resource.resource_id = "ecd-test".into();
        }
        fs::write(directory.path().join("stopped"), "").unwrap();
        service
            .request(request(resource.clone(), "original-release"))
            .await
            .unwrap();
        let before = calls(directory.path());
        for params in [
            request(resource.clone(), "new-release"),
            CloudDesktopParams::Start {
                confirmation: format!("start:cn-test:{}", resource.resource_id),
                resource: resource.clone(),
                operation_id: "new-start".into(),
            },
        ] {
            assert!(service
                .request(params)
                .await
                .unwrap_err()
                .contains("original-release"));
        }
        assert_eq!(calls(directory.path()), before);
    }
}
