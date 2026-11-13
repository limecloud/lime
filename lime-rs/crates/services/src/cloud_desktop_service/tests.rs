use super::*;

#[cfg(unix)]
#[path = "tests/lifecycle.rs"]
mod lifecycle;

#[cfg(unix)]
#[path = "tests/ecs_release.rs"]
mod ecs_release;

#[cfg(unix)]
#[path = "tests/ecs_purchase.rs"]
pub(super) mod ecs_purchase;

#[cfg(unix)]
#[path = "tests/ecs_templates.rs"]
mod ecs_templates;

#[cfg(unix)]
#[path = "tests/wuying_purchase.rs"]
mod wuying_purchase;

#[cfg(unix)]
#[path = "tests/snapshots.rs"]
mod snapshots;

#[cfg(unix)]
#[test]
fn private_receipts_reject_symlinks_hardlinks_and_shared_files() {
    use std::os::unix::fs::{symlink, PermissionsExt};
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("receipt.json");
    let file = private_open(&path, true).unwrap();
    drop(file);
    let link = directory.path().join("link.json");
    symlink(&path, &link).unwrap();
    assert!(private_open(&link, false).is_err());
    fs::hard_link(&path, directory.path().join("hardlink.json")).unwrap();
    assert!(private_open(&path, false).is_err());
    let shared = directory.path().join("shared.json");
    fs::write(&shared, "{}").unwrap();
    fs::set_permissions(&shared, fs::Permissions::from_mode(0o644)).unwrap();
    assert!(private_open(&shared, false).is_err());
}

#[cfg(unix)]
#[tokio::test]
async fn recent_operations_survive_restarts_and_list_only_recovery_metadata() {
    let (_directory, service, resource) = fixture();
    let response = service
        .request(CloudDesktopParams::Stop {
            resource,
            operation_id: "recent-test".into(),
            confirmation: "stop:cn-test:i-test".into(),
            work_saved: true,
        })
        .await
        .unwrap();
    let restarted = CloudDesktopService {
        root: service.root.clone(),
        cli: service.cli.clone(),
    };
    let data = restarted
        .request(CloudDesktopParams::ListResources {})
        .await
        .unwrap()
        .data;
    assert_eq!(data["operations"][0]["operationId"], "recent-test");
    assert_eq!(data["operations"][0]["outcome"], response.data["outcome"]);
    assert_eq!(data["operations"][0]["action"], "stop");
    assert_eq!(data["operations"][0]["resource"]["resourceId"], "i-test");
    assert!(data["operations"][0].get("request").is_none());
}

#[cfg(unix)]
fn fixture() -> (tempfile::TempDir, CloudDesktopService, CloudDesktopResource) {
    use std::os::unix::fs::PermissionsExt;
    let directory = tempfile::tempdir().unwrap();
    let cli = directory.path().join("aliyun");
    fs::write(&cli, r#"#!/usr/bin/env python3
import json, pathlib, sys
root = pathlib.Path(__file__).parent
with (root / 'calls').open('a') as output: output.write(json.dumps(sys.argv[1:]) + '\n')
action = sys.argv[2]
if action == 'DescribeInstances':
 if (root / 'fail-describe').exists(): sys.exit(1)
 elif (root / 'inconsistent').exists(): print(json.dumps({'Instances': {'Instance': []}, 'TotalCount': 1}))
 elif (root / 'invalid-count').exists(): print(json.dumps({'Instances': {'Instance': []}, 'TotalCount': '0'}))
 elif (root / 'malformed').exists(): print(json.dumps({'Instances': {}}))
 elif (root / 'wrong-resource').exists(): print(json.dumps({'Instances': {'Instance': [{'InstanceId': 'i-other', 'Status': 'Stopped', 'InstanceChargeType': 'PostPaid'}]}}))
 else: print(json.dumps({'Instances': {'Instance': [] if (root / 'missing').exists() else [{'InstanceId': 'i-test', 'Status': 'Stopped' if (root / 'stopped').exists() else 'Running', 'StoppedMode': 'StopCharging' if (root / 'released').exists() else 'KeepCharging', 'InstanceChargeType': 'PrePaid' if (root / 'prepaid').exists() else None if (root / 'missing-charge').exists() else 'PostPaid', 'OperationLocks': 'malformed' if (root / 'invalid-locks').exists() else {'LockReason': [{'LockReason': 'security'}]} if (root / 'locked').exists() else {}}]}}))
elif action == 'DescribeDisks':
 print(json.dumps({'Disks': {'Disk': [{'DiskId': 'd-test', 'InstanceId': 'i-other' if (root / 'wrong-disk').exists() else 'i-test', 'Status': 'In_use', 'MountInstanceNum': 0, 'MultiAttach': 'Enabled' if (root / 'shared-disk').exists() else 'Disabled', 'OperationLocks': {'OperationLock': [{'LockReason': 'security'}]} if (root / 'disk-locked').exists() else {}}]}}))
elif action == 'DescribeSnapshots':
 if (root / 'fail-snapshot').exists(): sys.exit(1)
 item = {'SnapshotId': 's-other' if (root / 'wrong-snapshot').exists() else 's-test', 'Status': ('PROGRESSING' if (root / 'progressing').exists() else 'ACCOMPLISHED') if sys.argv[1] == 'ecd' else ('progressing' if (root / 'progressing').exists() else 'accomplished'), 'SourceDiskId': 'd-other' if (root / 'wrong-source').exists() else 'd-test', 'DesktopId': 'ecd-other' if (root / 'wrong-source').exists() else 'ecd-test', 'SourceDiskType': 'SYSTEM', 'DiskStatus': 'Deleted' if (root / 'deleted-disk').exists() else 'Available', 'Available': not (root / 'unavailable').exists(), 'Progress': '100%', 'CreationTime': '2026-11-10T01:00:00Z', 'Description': 'must-not-leak'}
 if (root / 'encryption.json').exists(): item['VolumeEncryptionEnabled' if sys.argv[1] == 'ecd' else 'Encrypted'] = json.loads((root / 'encryption.json').read_text())
 item['VolumeEncryptionKey' if sys.argv[1] == 'ecd' else 'KMSKeyId'] = 'must-not-leak'
 items = [] if (root / 'missing-snapshot').exists() else [item]
 print(json.dumps({'Snapshots': items} if sys.argv[1] == 'ecd' else {'Snapshots': {'Snapshot': items}, 'TotalCount': 9 if (root / 'snapshot-count').exists() else len(items)}))
elif action == 'DescribeImages':
 print(json.dumps({'Images': [{'ImageId': 'desktopimage-linux', 'Status': 'Available', 'OsType': 'LINUX', 'GpuCategory': (root / 'gpu').exists()}]}))
elif action == 'DescribeDesktopTypes':
 print(json.dumps({'DesktopTypes': [{'DesktopTypeId': 'eds.enterprise_office.4c8g', 'GpuCount': 0, 'CpuCount': 4, 'MemorySize': 8192, 'SaleTypes': ['postPaid'], 'StockState': 'Sufficient'}]}))
elif action == 'DescribeOfficeSites':
 print(json.dumps({'OfficeSites': [{'OfficeSiteId': 'cn-test+dir-test', 'Status': 'REGISTERED'}]}))
elif action == 'DescribePolicyGroups':
 print(json.dumps({'DescribePolicyGroups': [{'PolicyGroupId': 'system-test-policy', 'PolicyStatus': 'AVAILABLE'}]}))
elif action == 'DescribePrice':
 print(json.dumps({'PriceInfo': {'Price': {'Currency': 'CNY', 'TradePrice': 0.8 if (root / 'price-changed').exists() else 0.75}}}))
elif action == 'DescribeDesktops':
 if (root / 'fail-describe').exists(): sys.exit(1)
 elif (root / 'inconsistent').exists(): print(json.dumps({'Desktops': [], 'TotalCount': 1}))
 elif (root / 'invalid-count').exists(): print(json.dumps({'Desktops': [], 'TotalCount': '0'}))
 elif (root / 'malformed').exists(): print(json.dumps({'Desktops': {}}))
 else: print(json.dumps({'Desktops': ([] if (root / 'missing').exists() else [{'DesktopId': 'ecd-test', 'DesktopStatus': 'Stopped' if (root / 'stopped').exists() else 'Running', 'ChargeType': 'PrePaid' if (root / 'prepaid').exists() else 'PostPaid'}] if '--DesktopId.1' in sys.argv or (root / 'existing').exists() else [])}))
elif action in ('DeleteDesktops', 'DeleteInstance'):
 if (root / 'lost-delete').exists():
  (root / 'missing').touch()
  sys.exit(1)
 print(json.dumps({'RequestId': 'delete-request'}))
elif (root / 'fail').exists(): sys.exit(1)
else: print(json.dumps({'RequestId': 'request-test', 'SnapshotId': 's-test', 'DesktopId': ['ecd-test']}))
"#).unwrap();
    fs::set_permissions(&cli, fs::Permissions::from_mode(0o700)).unwrap();
    let service = CloudDesktopService {
        root: directory.path().join("receipts"),
        cli,
    };
    let resource = CloudDesktopResource {
        region_id: "cn-test".into(),
        provider: CloudDesktopProvider::Ecs,
        resource_id: "i-test".into(),
        profile: "lime".into(),
    };
    (directory, service, resource)
}

#[cfg(unix)]
#[tokio::test]
async fn stop_replay_never_calls_provider_twice_and_acceptance_is_not_completion() {
    let (directory, service, resource) = fixture();
    let request = CloudDesktopParams::Stop {
        resource,
        operation_id: "operation-1".into(),
        confirmation: "stop:cn-test:i-test".into(),
        work_saved: true,
    };
    let first = service.request(request.clone()).await.unwrap();
    assert_eq!(first.data["outcome"], "accepted");
    assert_eq!(first.data["requiresInspection"], true);
    let before = fs::read(directory.path().join("calls")).unwrap();
    assert_eq!(service.request(request).await.unwrap(), first);
    assert_eq!(before, fs::read(directory.path().join("calls")).unwrap());
    let args = String::from_utf8(before).unwrap();
    assert!(args.contains("StopCharging"));
    assert!(!args.contains("AccessKey"));
}

#[cfg(unix)]
#[tokio::test]
async fn failed_mutation_remains_unknown_and_id_cannot_be_repurposed() {
    let (directory, service, resource) = fixture();
    fs::write(directory.path().join("fail"), "").unwrap();
    let request = CloudDesktopParams::Stop {
        resource: resource.clone(),
        operation_id: "operation-2".into(),
        confirmation: "stop:cn-test:i-test".into(),
        work_saved: true,
    };
    assert_eq!(
        service.request(request.clone()).await.unwrap().data["outcome"],
        "unknown"
    );
    let before = fs::read(directory.path().join("calls")).unwrap();
    service.request(request).await.unwrap();
    assert_eq!(before, fs::read(directory.path().join("calls")).unwrap());
    assert!(service
        .request(CloudDesktopParams::Start {
            resource,
            operation_id: "operation-2".into(),
            confirmation: "start:cn-test:i-test".into()
        })
        .await
        .unwrap_err()
        .contains("different request"));
}

#[cfg(unix)]
#[tokio::test]
async fn confirmation_and_saved_work_are_checked_before_any_cloud_request() {
    let (directory, service, resource) = fixture();
    assert!(service
        .request(CloudDesktopParams::Stop {
            resource,
            operation_id: "operation-3".into(),
            confirmation: "stop:cn-test:i-test".into(),
            work_saved: false
        })
        .await
        .is_err());
    assert!(!directory.path().join("calls").exists());
    for value in ["../token", "--endpoint", "a b", "", "x/y"] {
        assert!(validate_id(value).is_err());
    }
}

#[cfg(unix)]
#[tokio::test]
async fn stopped_instance_is_only_compute_released_when_provider_confirms_mode() {
    let (directory, service, resource) = fixture();
    fs::write(directory.path().join("stopped"), "").unwrap();
    let inspect = CloudDesktopParams::Inspect { resource };
    assert_eq!(
        service.request(inspect.clone()).await.unwrap().data["computeReleased"],
        false
    );
    fs::write(directory.path().join("released"), "").unwrap();
    let data = service.request(inspect).await.unwrap().data;
    assert_eq!(data["computeReleased"], true);
    assert_eq!(data["retainedResourcesMayBeCharged"], true);
    assert_eq!(data["desktopReady"], false);
}

#[cfg(unix)]
#[tokio::test]
async fn snapshots_require_a_cold_attached_disk_and_cannot_target_another_disk() {
    let (directory, service, resource) = fixture();
    fs::write(directory.path().join("stopped"), "").unwrap();
    let data = service
        .request(CloudDesktopParams::Snapshot {
            resource: resource.clone(),
            operation_id: "snapshot-1".into(),
            confirmation: "snapshot:cn-test:i-test:d-test".into(),
            disk_id: "d-test".into(),
            work_saved: true,
        })
        .await
        .unwrap()
        .data;
    assert_eq!(data["snapshotId"], "s-test");
    assert!(service
        .request(CloudDesktopParams::Snapshot {
            resource,
            operation_id: "snapshot-2".into(),
            confirmation: "snapshot:cn-test:i-test:d-other".into(),
            disk_id: "d-other".into(),
            work_saved: true
        })
        .await
        .unwrap_err()
        .contains("does not belong"));
}

#[cfg(unix)]
fn wuying_spec() -> app_server_protocol::protocol::v2::WuyingDesktopSpec {
    app_server_protocol::protocol::v2::WuyingDesktopSpec {
        region_id: "cn-test".into(),
        profile: "lime".into(),
        office_site_id: "cn-test+dir-test".into(),
        end_user_id: "test-user".into(),
        policy_group_id: "system-test-policy".into(),
        desktop_type: "eds.enterprise_office.4c8g".into(),
        image_id: "desktopimage-linux".into(),
        system_disk_gib: 80,
        data_disk_gib: 0,
    }
}

#[cfg(unix)]
async fn purchase_request(service: &CloudDesktopService) -> CloudDesktopParams {
    let spec = wuying_spec();
    let quote = service
        .request(CloudDesktopParams::QuoteWuying { spec: spec.clone() })
        .await
        .unwrap();
    let id = quote.data["quoteId"].as_str().unwrap();
    CloudDesktopParams::PurchaseWuying {
        spec,
        desktop_name: "Lime-test".into(),
        operation_id: "purchase-1".into(),
        quote_id: id.into(),
        confirmation: format!("purchase:wuying:cn-test:Lime-test:{id}"),
    }
}

#[cfg(unix)]
#[tokio::test]
async fn wuying_purchase_uses_approved_quote_and_is_not_repeated() {
    let (directory, service, _) = fixture();
    let request = purchase_request(&service).await;
    let receipt = service.request(request.clone()).await.unwrap();
    assert_eq!(receipt.data["outcome"], "accepted");
    assert_eq!(receipt.data["desktopIds"], json!(["ecd-test"]));
    let before = fs::read(directory.path().join("calls")).unwrap();
    assert_eq!(receipt, service.request(request).await.unwrap());
    assert_eq!(before, fs::read(directory.path().join("calls")).unwrap());
    let calls: Vec<Vec<String>> = String::from_utf8(before)
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    let create = calls
        .iter()
        .find(|call| call[1] == "CreateDesktops")
        .unwrap();
    assert!(create
        .windows(2)
        .any(|args| args == ["--ChargeType", "PostPaid"]));
    assert!(create.windows(2).any(|args| args == ["--Amount", "1"]));
    assert!(create
        .windows(2)
        .any(|args| args == ["--AutoRenew", "false"]));
    assert!(create
        .windows(2)
        .any(|args| args == ["--PolicyGroupId", "system-test-policy"]));
    let index = create
        .iter()
        .position(|arg| arg == "--DesktopAttachment")
        .unwrap();
    let attachment: Value = serde_json::from_str(&create[index + 1]).unwrap();
    assert_eq!(attachment["ImageId"], "desktopimage-linux");
    assert_eq!(attachment["SystemDiskSize"], 80);
    assert!(attachment.get("SystemDiskCategory").is_none());
    let listed = service
        .request(CloudDesktopParams::ListResources {})
        .await
        .unwrap();
    assert_eq!(listed.data["resources"][0]["resourceId"], "ecd-test");
}

#[cfg(unix)]
#[tokio::test]
async fn resource_bindings_survive_service_restart_without_storing_credentials() {
    let (_directory, service, resource) = fixture();
    assert_eq!(
        service
            .request(CloudDesktopParams::ListResources {})
            .await
            .unwrap()
            .data["resources"],
        json!([])
    );
    service
        .request(CloudDesktopParams::Bind {
            resource: resource.clone(),
        })
        .await
        .unwrap();
    service
        .request(CloudDesktopParams::Bind {
            resource: resource.clone(),
        })
        .await
        .unwrap();
    let restarted = CloudDesktopService {
        root: service.root.clone(),
        cli: service.cli.clone(),
    };
    let resources = restarted
        .request(CloudDesktopParams::ListResources {})
        .await
        .unwrap()
        .data;
    assert_eq!(resources["resources"], json!([resource]));
    assert!(!resources.to_string().contains("AccessKey"));
}

#[test]
fn provider_diagnostics_never_include_messages_or_credential_material() {
    let diagnostic = |stderr: &[u8]| auth::cli::CliError::provider(stderr).to_string();
    let error = diagnostic(b"ERROR: SDK.ServerError\nErrorCode: InvalidParam\nRequestId: request-123\nMessage: token=private-value\nRecommend: https://signed.invalid/?secret=value");
    assert!(error.contains("ErrorCode=InvalidParam"));
    assert!(error.contains("RequestId=request-123"));
    for forbidden in ["private-value", "signed.invalid", "secret=value"] {
        assert!(!error.contains(forbidden));
    }
    let error =
        diagnostic(br#"{"Code":"Denied","RequestId":"request-1","Message":"secret"}"#);
    assert!(error.contains("ErrorCode=Denied"));
    assert!(!error.contains("secret"));
    assert!(!diagnostic(b"RequestId: token=secret").contains("secret"));
    let error = diagnostic(br#"{"error_code":"InvalidParameter.CommandContent","request_id":"request-2","message":"token=private-value","recommendation":"https://signed.invalid/?secret=value"}"#);
    assert!(error.contains("ErrorCode=InvalidParameter.CommandContent"));
    assert!(error.contains("RequestId=request-2"));
    assert!(!error.contains("private-value"));
    assert!(!error.contains("signed.invalid"));
}

#[cfg(unix)]
#[tokio::test]
async fn wuying_changed_price_or_existing_name_prevents_purchase() {
    for marker in [
        "price-changed",
        "existing",
        "inconsistent",
        "invalid-count",
        "malformed",
    ] {
        let (directory, service, _) = fixture();
        let request = purchase_request(&service).await;
        fs::write(directory.path().join(marker), "").unwrap();
        assert_eq!(
            service.request(request).await.unwrap().data["outcome"],
            "notSubmitted"
        );
        assert!(!fs::read_to_string(directory.path().join("calls"))
            .unwrap()
            .contains("CreateDesktops"));
        assert!(!service.root.join("purchase-1.json").exists());
    }
}

#[cfg(unix)]
#[tokio::test]
async fn wuying_expired_quote_and_gpu_are_rejected() {
    let (directory, service, _) = fixture();
    let request = purchase_request(&service).await;
    let CloudDesktopParams::PurchaseWuying { quote_id, .. } = &request else {
        unreachable!()
    };
    let path = service.root.join(format!("quote-{quote_id}.json"));
    let mut quote: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    quote["expiresAt"] = json!("2000-01-01T00:00:00Z");
    fs::write(path, serde_json::to_vec(&quote).unwrap()).unwrap();
    let result = service.request(request).await.unwrap().data;
    assert_eq!(result["outcome"], "notSubmitted");
    assert!(result["diagnostic"].as_str().unwrap().contains("expired"));
    fs::write(directory.path().join("gpu"), "").unwrap();
    assert!(service
        .request(CloudDesktopParams::QuoteWuying {
            spec: wuying_spec()
        })
        .await
        .is_err());
    assert!(!fs::read_to_string(directory.path().join("calls"))
        .unwrap()
        .contains("CreateDesktops"));
}

#[cfg(unix)]
#[tokio::test]
async fn wuying_lost_purchase_response_remains_unknown_without_repurchase() {
    let (directory, service, _) = fixture();
    let request = purchase_request(&service).await;
    fs::write(directory.path().join("fail"), "").unwrap();
    assert_eq!(
        service.request(request.clone()).await.unwrap().data["outcome"],
        "unknown"
    );
    let before = fs::read(directory.path().join("calls")).unwrap();
    service.request(request).await.unwrap();
    assert_eq!(before, fs::read(directory.path().join("calls")).unwrap());
}

#[cfg(unix)]
#[tokio::test]
async fn wuying_stop_requests_release_but_inspection_does_not_invent_billing_state() {
    let (directory, service, _) = fixture();
    let resource = CloudDesktopResource {
        provider: CloudDesktopProvider::Wuying,
        resource_id: "ecd-test".into(),
        region_id: "cn-test".into(),
        profile: "lime".into(),
    };
    service
        .request(CloudDesktopParams::Stop {
            resource: resource.clone(),
            operation_id: "stop-1".into(),
            confirmation: "stop:cn-test:ecd-test".into(),
            work_saved: true,
        })
        .await
        .unwrap();
    fs::write(directory.path().join("stopped"), "").unwrap();
    let data = service
        .request(CloudDesktopParams::Inspect { resource })
        .await
        .unwrap()
        .data;
    assert_eq!(data["status"], "Stopped");
    assert!(data["computeReleased"].is_null());
    assert_eq!(data["stopChargingModeExposedByProvider"], false);
    assert!(fs::read_to_string(directory.path().join("calls"))
        .unwrap()
        .contains("StopCharging"));
}

#[cfg(unix)]
fn release_request() -> CloudDesktopParams {
    CloudDesktopParams::Release {
        resource: CloudDesktopResource {
            provider: CloudDesktopProvider::Wuying,
            resource_id: "ecd-test".into(),
            region_id: "cn-test".into(),
            profile: "lime".into(),
        },
        operation_id: "release-1".into(),
        confirmation: "release:cn-test:ecd-test:discard-data".into(),
        work_saved: true,
        discard_data: true,
        image_operation_id: None,
    }
}

#[cfg(unix)]
#[tokio::test]
async fn release_is_submitted_once_and_only_verified_absence_retires_the_binding() {
    let (directory, service, _) = fixture();
    fs::write(directory.path().join("stopped"), "").unwrap();
    let request = release_request();
    let CloudDesktopParams::Release { resource, .. } = &request else {
        unreachable!()
    };
    service
        .request(CloudDesktopParams::Bind {
            resource: resource.clone(),
        })
        .await
        .unwrap();
    let receipt = service.request(request.clone()).await.unwrap();
    assert_eq!(receipt.data["outcome"], "accepted");
    let before = fs::read(directory.path().join("calls")).unwrap();
    assert_eq!(receipt, service.request(request.clone()).await.unwrap());
    assert_eq!(before, fs::read(directory.path().join("calls")).unwrap());
    let read = CloudDesktopParams::ReadOperation {
        operation_id: "release-1".into(),
    };
    assert_eq!(
        service.request(read.clone()).await.unwrap().data["outcome"],
        "accepted"
    );
    assert_eq!(
        service
            .request(CloudDesktopParams::ListResources {})
            .await
            .unwrap()
            .data["resources"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    fs::write(directory.path().join("missing"), "").unwrap();
    // Simulate an interrupted receipt update before the process restarts.
    private_open(&service.root.join("release-1.pending"), true).unwrap();
    let receipt = service.request(read).await.unwrap().data;
    assert_eq!(receipt["outcome"], "released");
    assert_eq!(receipt["requiresInspection"], false);
    assert_eq!(receipt["observedAfter"]["exists"], false);
    let restarted = CloudDesktopService {
        root: service.root.clone(),
        cli: service.cli.clone(),
    };
    let list = restarted
        .request(CloudDesktopParams::ListResources {})
        .await
        .unwrap()
        .data;
    assert_eq!(list["resources"], json!([]));
    assert_eq!(list["operations"][0]["outcome"], "released");
    let calls: Vec<Vec<String>> = fs::read_to_string(directory.path().join("calls"))
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    let deletes: Vec<_> = calls
        .iter()
        .filter(|args| args[1] == "DeleteDesktops")
        .collect();
    assert_eq!(deletes.len(), 1);
    assert!(deletes[0]
        .windows(2)
        .any(|args| args == ["--DesktopId.1", "ecd-test"]));
}

#[cfg(unix)]
#[tokio::test]
async fn lost_release_response_is_reconciled_without_resending_deletion() {
    let (directory, service, _) = fixture();
    fs::write(directory.path().join("stopped"), "").unwrap();
    fs::write(directory.path().join("lost-delete"), "").unwrap();
    let request = release_request();
    assert_eq!(
        service.request(request.clone()).await.unwrap().data["outcome"],
        "unknown"
    );
    let before = fs::read(directory.path().join("calls")).unwrap();
    service.request(request).await.unwrap();
    assert_eq!(before, fs::read(directory.path().join("calls")).unwrap());
    let receipt = service
        .request(CloudDesktopParams::ReadOperation {
            operation_id: "release-1".into(),
        })
        .await
        .unwrap()
        .data;
    assert_eq!(receipt["outcome"], "released");
}

#[cfg(unix)]
#[tokio::test]
async fn release_requires_exact_discard_consent_stopped_postpaid_wuying() {
    for field in ["discardData", "workSaved", "confirmation", "provider"] {
        let (directory, service, _) = fixture();
        let mut request = serde_json::to_value(release_request()).unwrap();
        match field {
            "discardData" | "workSaved" => request[field] = json!(false),
            "provider" => request["resource"]["provider"] = json!("ecs"),
            _ => request[field] = json!("release:cn-test:ecd-other:discard-data"),
        }
        assert!(
            service
                .request(serde_json::from_value(request).unwrap())
                .await
                .is_err(),
            "{field}"
        );
        assert!(!directory.path().join("calls").exists(), "{field}");
    }
    for marker in ["running", "prepaid"] {
        let (directory, service, _) = fixture();
        if marker == "prepaid" {
            fs::write(directory.path().join("stopped"), "").unwrap();
            fs::write(directory.path().join("prepaid"), "").unwrap();
        }
        assert!(
            service.request(release_request()).await.is_err(),
            "{marker}"
        );
        assert!(!fs::read_to_string(directory.path().join("calls"))
            .unwrap()
            .contains("DeleteDesktops"));
    }
}

#[cfg(unix)]
#[tokio::test]
async fn malformed_inventory_cannot_verify_release_or_remove_a_binding() {
    let (directory, service, _) = fixture();
    fs::write(directory.path().join("stopped"), "").unwrap();
    let request = release_request();
    let CloudDesktopParams::Release { resource, .. } = &request else {
        unreachable!()
    };
    service
        .request(CloudDesktopParams::Bind {
            resource: resource.clone(),
        })
        .await
        .unwrap();
    service.request(request).await.unwrap();
    for marker in [
        "malformed",
        "inconsistent",
        "invalid-count",
        "fail-describe",
    ] {
        fs::write(directory.path().join(marker), "").unwrap();
        assert!(service
            .request(CloudDesktopParams::ReadOperation {
                operation_id: "release-1".into()
            })
            .await
            .is_err());
        fs::remove_file(directory.path().join(marker)).unwrap();
    }
    let data = service
        .request(CloudDesktopParams::ListResources {})
        .await
        .unwrap()
        .data;
    assert_eq!(data["resources"].as_array().unwrap().len(), 1);
    assert_eq!(data["operations"][0]["outcome"], "accepted");
}

#[cfg(unix)]
#[tokio::test]
async fn invalid_release_receipts_cannot_claim_completion_or_trigger_cloud_queries() {
    let (directory, service, _) = fixture();
    fs::write(directory.path().join("stopped"), "").unwrap();
    let receipt = service.request(release_request()).await.unwrap().data;
    let calls = fs::read(directory.path().join("calls")).unwrap();
    for field in [
        "operationId",
        "discardData",
        "provider",
        "outcome",
        "unverified",
    ] {
        let mut invalid = receipt.clone();
        match field {
            "operationId" => invalid["operationId"] = json!("other"),
            "discardData" => invalid["request"]["discardData"] = json!(false),
            "provider" => invalid["request"]["resource"]["provider"] = json!("ecs"),
            "outcome" => invalid["outcome"] = json!("success"),
            _ => invalid["outcome"] = json!("released"),
        }
        let mut file = private_open(&service.root.join("release-1.json"), false).unwrap();
        file.set_len(0).unwrap();
        serde_json::to_writer(&mut file, &invalid).unwrap();
        assert!(
            service
                .request(CloudDesktopParams::ReadOperation {
                    operation_id: "release-1".into()
                })
                .await
                .is_err(),
            "{field}"
        );
        assert!(
            service
                .request(CloudDesktopParams::ListResources {})
                .await
                .is_err(),
            "{field}"
        );
        assert_eq!(fs::read(directory.path().join("calls")).unwrap(), calls);
    }
}
