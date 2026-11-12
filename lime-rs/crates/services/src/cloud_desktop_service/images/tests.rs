use super::*;
use std::os::unix::fs::PermissionsExt;

const CLI: &str = r#"#!/usr/bin/env python3
import json, pathlib, sys
p=pathlib.Path(__file__).parent
a=sys.argv[1:]
with (p/'calls').open('a') as f: f.write(json.dumps(a)+'\n')
def arg(name): return a[a.index(name)+1]
snapshot={'SnapshotId':'s-test','SourceDiskId':'d-test','SourceDiskType':'system',
          'SourceDiskSize':'80','Status':'accomplished','Encrypted':True,'Available':True,
          'KMSKeyId':'must-not-leak'}
if (p/'source.json').exists(): snapshot=json.loads((p/'source.json').read_text())
if a[1]=='DescribeSnapshots':
  assert json.loads(arg('--SnapshotIds'))==['s-test']
  print(json.dumps({'TotalCount':1,'Snapshots':{'Snapshot':[snapshot]}}))
elif a[1]=='CreateImage':
  assert arg('--SnapshotId')=='s-test'
  assert len(arg('--ClientToken'))==64
  assert arg('--ImageName').startswith('Lime-system-')
  assert arg('--Tag.1.Key')=='lime-operation'
  assert arg('--Tag.2.Key')=='lime-system-image'
  assert arg('--Tag.2.Value')=='true'
  image={'ImageId':'m-test','ImageName':arg('--ImageName'),'Status':'Creating','Size':80,
         'ImageOwnerAlias':'self','IsPublic':False,'IsSelfShared':'False','OSType':'linux',
         'Architecture':'x86_64','Platform':'Ubuntu','CreationTime':'2026-11-11T00:00:00Z',
         'Tags':{'Tag':[{'TagKey':'lime-operation','TagValue':arg('--Tag.1.Value')},
                        {'TagKey':'lime-system-image','TagValue':'true'}]},
         'DiskDeviceMappings':{'DiskDeviceMapping':[{'SnapshotId':'s-test','Type':'system'}]},
         'Description':'must-not-leak'}
  (p/'image.json').write_text(json.dumps(image))
  if (p/'lost').exists():
    print('must-not-leak',file=sys.stderr);sys.exit(1)
  print(json.dumps({'ImageId':'m-test','RequestId':'must-not-leak'}))
elif a[1]=='DescribeImages':
  assert arg('--ImageOwnerAlias')=='self'
  assert '--PageSize' in a
  entries=[json.loads((p/'image.json').read_text())] if (p/'image.json').exists() else []
  if (p/'empty').exists(): entries=[]
  if (p/'duplicate').exists(): entries=entries*2
  print(json.dumps({'TotalCount':len(entries)+(1 if (p/'incomplete').exists() else 0),
                    'Images':{'Image':entries}}))
elif a[1]=='DescribeInstances' and (p/'allow-release').exists():
  assert json.loads(arg('--InstanceIds'))==['i-test']
  entries=[] if (p/'released').exists() else [{'InstanceId':'i-test','Status':'Stopped','InstanceChargeType':'PostPaid','OperationLocks':{}}]
  print(json.dumps({'TotalCount':len(entries),'Instances':{'Instance':entries}}))
elif a[1]=='DescribeDisks' and (p/'allow-release').exists():
  assert arg('--InstanceId')=='i-test'
  disks=[{'DiskId':'d-test','InstanceId':'i-test','Type':'system','Encrypted':True}]
  if (p/'disks.json').exists(): disks=json.loads((p/'disks.json').read_text())
  print(json.dumps({'TotalCount':len(disks),'Disks':{'Disk':disks}}))
elif a[1]=='DeleteInstance' and (p/'allow-release').exists():
  assert arg('--InstanceId')=='i-test' and arg('--Force')=='false'
  intent=json.loads((p/'receipts/release-image.json').read_text())
  assert intent['outcome']=='unknown' and intent['releaseImage']['imageId']=='m-test'
  assert intent['request']['imageOperationId']=='image-1'
  if (p/'lost-delete').exists():
    (p/'released').touch();sys.exit(1)
  print(json.dumps({'RequestId':'release-request'}))
else:
  raise AssertionError('original VM or disk must not be queried')
"#;

fn fixture() -> (tempfile::TempDir, CloudDesktopService) {
    let directory = tempfile::tempdir().unwrap();
    let cli = directory.path().join("aliyun");
    fs::write(&cli, CLI).unwrap();
    fs::set_permissions(&cli, fs::Permissions::from_mode(0o700)).unwrap();
    let service = CloudDesktopService {
        root: directory.path().join("receipts"),
        cli,
    };
    service.ensure_root().unwrap();
    let resource =
        json!({"provider":"ecs","regionId":"cn-test","resourceId":"i-test","profile":"owned"});
    service.create_receipt("cold-snapshot",&json!({"operationId":"cold-snapshot",
        "request":{"action":"snapshot","resource":resource,"diskId":"d-test"},
        "outcome":"snapshotReady","snapshotId":"s-test","requiresInspection":false,
        "observedBefore":{"resource":resource,"status":"Stopped"},
        "snapshotObserved":{"resource":resource,"diskId":"d-test","snapshotId":"s-test", "ready":true,"encrypted":true}})).unwrap();
    (directory, service)
}

fn create(id: &str) -> CloudDesktopParams {
    CloudDesktopParams::CreateEcsImage {
        snapshot_operation_id: "cold-snapshot".into(),
        operation_id: id.into(),
        confirmation: "createEcsImage:cold-snapshot".into(),
        include_credentials: true,
    }
}

fn calls(directory: &tempfile::TempDir, action: &str) -> Vec<Vec<String>> {
    fs::read_to_string(directory.path().join("calls"))
        .unwrap_or_default()
        .lines()
        .map(|line| serde_json::from_str::<Vec<String>>(line).unwrap())
        .filter(|args| args[1] == action)
        .collect()
}

fn modify(directory: &tempfile::TempDir, file: &str, change: impl FnOnce(&mut Value)) {
    let path = directory.path().join(file);
    let mut value: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    change(&mut value);
    fs::write(path, serde_json::to_vec(&value).unwrap()).unwrap();
}

async fn release_fixture() -> (tempfile::TempDir, CloudDesktopService) {
    let (directory, service) = fixture();
    service.request(create("image-1")).await.unwrap();
    modify(&directory, "image.json", |image| {
        image["Status"] = json!("Available")
    });
    service
        .request(CloudDesktopParams::ReadOperation {
            operation_id: "image-1".into(),
        })
        .await
        .unwrap();
    fs::write(directory.path().join("allow-release"), "").unwrap();
    (directory, service)
}

fn protected_release() -> CloudDesktopParams {
    CloudDesktopParams::Release {
        resource: CloudDesktopResource {
            provider: CloudDesktopProvider::Ecs,
            region_id: "cn-test".into(),
            profile: "owned".into(),
            resource_id: "i-test".into(),
        },
        operation_id: "release-image".into(),
        confirmation: "release:cn-test:i-test:discard-data:image:image-1".into(),
        work_saved: true,
        discard_data: true,
        image_operation_id: Some("image-1".into()),
    }
}

async fn assert_image_not_submitted(service: &CloudDesktopService, params: CloudDesktopParams) {
    let response = service.request(params).await.unwrap().data;
    assert_eq!(response["outcome"], "notSubmitted");
    assert_eq!(response["submitted"], false);
    assert_eq!(response["requiresInspection"], false);
    assert_eq!(response["failureCode"], "imageVerificationFailed");
    assert!(!service.root.join("release-image.json").exists());
}

#[tokio::test]
async fn failed_image_preflight_can_be_corrected_without_replaying_a_cloud_mutation() {
    let (directory, service) = release_fixture().await;
    fs::write(directory.path().join("empty"), "").unwrap();
    assert_image_not_submitted(&service, protected_release()).await;
    assert!(calls(&directory, "DeleteInstance").is_empty());
    // A corrected read-only provider observation allows a newly confirmed submission.
    fs::remove_file(directory.path().join("empty")).unwrap();
    assert_eq!(
        service.request(protected_release()).await.unwrap().data["outcome"],
        "accepted"
    );
    assert_eq!(calls(&directory, "DeleteInstance").len(), 1);
}

#[tokio::test]
async fn private_image_proof_is_durable_before_release_and_replay_never_rechecks_or_deletes_twice()
{
    let (directory, service) = release_fixture().await;
    service
        .remember_resource(
            &serde_json::from_value(
                serde_json::to_value(protected_release()).unwrap()["resource"].clone(),
            )
            .unwrap(),
        )
        .unwrap();
    let first = service.request(protected_release()).await.unwrap();
    assert_eq!(first.data["outcome"], "accepted");
    assert_eq!(first.data["releaseImage"]["imageId"], "m-test");
    assert_eq!(first.data["releaseImage"]["encrypted"], true);
    assert_eq!(first.data["releaseImage"]["private"], true);
    assert_eq!(
        first.data["releaseImage"]["requiresApplicationValidation"],
        true
    );
    assert!(!first.data.to_string().contains("must-not-leak"));
    let before = fs::read(directory.path().join("calls")).unwrap();
    fs::write(directory.path().join("empty"), "").unwrap();
    let restarted = CloudDesktopService {
        root: service.root.clone(),
        cli: service.cli.clone(),
    };
    assert_eq!(restarted.request(protected_release()).await.unwrap(), first);
    assert_eq!(fs::read(directory.path().join("calls")).unwrap(), before);
    fs::write(directory.path().join("released"), "").unwrap();
    let receipt = restarted
        .request(CloudDesktopParams::ReadOperation {
            operation_id: "release-image".into(),
        })
        .await
        .unwrap();
    assert_eq!(receipt.data["outcome"], "released");
    assert_eq!(receipt.data["releaseImage"], first.data["releaseImage"]);
    assert_eq!(restarted.list_resources().unwrap()["resources"], json!([]));
    assert_eq!(calls(&directory, "DeleteInstance").len(), 1);
    for action in ["DeleteImage", "DeleteSnapshot", "DeleteDisk"] {
        assert!(calls(&directory, action).is_empty());
    }
}

#[tokio::test]
async fn lost_protected_release_recovers_original_operation_without_repeating_deletion() {
    let (directory, service) = release_fixture().await;
    fs::write(directory.path().join("lost-delete"), "").unwrap();
    assert_eq!(
        service.request(protected_release()).await.unwrap().data["outcome"],
        "unknown"
    );
    let restarted = CloudDesktopService {
        root: service.root.clone(),
        cli: service.cli.clone(),
    };
    let receipt = restarted
        .request(CloudDesktopParams::ReadOperation {
            operation_id: "release-image".into(),
        })
        .await
        .unwrap();
    assert_eq!(receipt.data["outcome"], "released");
    assert_eq!(calls(&directory, "DeleteInstance").len(), 1);
}

#[tokio::test]
async fn retained_image_and_snapshot_are_freshly_verified_without_falling_back_to_discard() {
    for (key, value) in [
        ("Status", json!("Creating")),
        ("IsPublic", json!(true)),
        ("IsSelfShared", json!("True")),
        ("ImageOwnerAlias", json!("marketplace")),
        ("ImageId", json!("m-other")),
    ] {
        let (directory, service) = release_fixture().await;
        modify(&directory, "image.json", |image| image[key] = value);
        assert_image_not_submitted(&service, protected_release()).await;
        assert!(calls(&directory, "DeleteInstance").is_empty());
        assert!(!service.root.join("release-image.json").exists());
    }
    for marker in ["empty", "duplicate", "incomplete"] {
        let (directory, service) = release_fixture().await;
        fs::write(directory.path().join(marker), "").unwrap();
        assert_image_not_submitted(&service, protected_release()).await;
        assert!(calls(&directory, "DeleteInstance").is_empty());
    }
    let (directory, service) = release_fixture().await;
    fs::write(directory.path().join("source.json"),json!({"SnapshotId":"s-test","SourceDiskId":"d-test","SourceDiskType":"system","SourceDiskSize":80,"Status":"accomplished","Encrypted":false,"Available":true}).to_string()).unwrap();
    assert_image_not_submitted(&service, protected_release()).await;
    assert!(calls(&directory, "DeleteInstance").is_empty());
}

#[tokio::test]
async fn image_release_refuses_other_disks_profiles_and_unbound_confirmation() {
    for disks in [
        json!([]),
        json!([{"DiskId":"d-other","InstanceId":"i-test","Type":"system","Encrypted":true}]),
        json!([{"DiskId":"d-test","InstanceId":"i-other","Type":"system","Encrypted":true}]),
        json!([{"DiskId":"d-test","InstanceId":"i-test","Type":"system","Encrypted":false}]),
        json!([{"DiskId":"d-test","InstanceId":"i-test","Type":"system","Encrypted":true},{"DiskId":"d-data","InstanceId":"i-test","Type":"data","Encrypted":true}]),
    ] {
        let (directory, service) = release_fixture().await;
        fs::write(directory.path().join("disks.json"), disks.to_string()).unwrap();
        assert_image_not_submitted(&service, protected_release()).await;
        assert!(calls(&directory, "DeleteInstance").is_empty());
    }
    for (key, value) in [
        ("confirmation", json!("release:cn-test:i-test:discard-data")),
        ("imageOperationId", json!("other-image")),
        ("workSaved", json!(false)),
        ("discardData", json!(false)),
    ] {
        let (directory, service) = release_fixture().await;
        let mut params = serde_json::to_value(protected_release()).unwrap();
        params[key] = value;
        assert!(
            service
                .request(serde_json::from_value(params).unwrap())
                .await
                .is_err(),
            "{key}"
        );
        assert!(calls(&directory, "DeleteInstance").is_empty());
    }
    let (directory, service) = release_fixture().await;
    let mut params = serde_json::to_value(protected_release()).unwrap();
    params["resource"]["profile"] = json!("another");
    assert_image_not_submitted(&service, serde_json::from_value(params).unwrap()).await;
    assert!(calls(&directory, "DeleteInstance").is_empty());
}

#[tokio::test]
async fn a_release_operation_cannot_be_repurposed_or_hide_corrupted_image_proof() {
    let (directory, service) = release_fixture().await;
    service.request(protected_release()).await.unwrap();
    let mut params = serde_json::to_value(protected_release()).unwrap();
    params.as_object_mut().unwrap().remove("imageOperationId");
    params["confirmation"] = json!("release:cn-test:i-test:discard-data");
    assert!(service
        .request(serde_json::from_value(params).unwrap())
        .await
        .is_err());
    modify(&directory, "receipts/release-image.json", |receipt| {
        receipt["releaseImage"]["encrypted"] = json!(false)
    });
    assert!(service
        .request(CloudDesktopParams::ReadOperation {
            operation_id: "release-image".into()
        })
        .await
        .is_err());
    assert_eq!(calls(&directory, "DeleteInstance").len(), 1);
}

#[tokio::test]
async fn full_disk_consent_and_verified_cold_snapshot_are_required_before_submission() {
    let (directory, service) = fixture();
    let mut invalid = serde_json::to_value(create("image-1")).unwrap();
    invalid["includeCredentials"] = json!(false);
    assert!(service
        .request(serde_json::from_value(invalid).unwrap())
        .await
        .unwrap_err()
        .contains("explicit consent"));
    assert!(calls(&directory, "CreateImage").is_empty());
    modify(&directory, "receipts/cold-snapshot.json", |source| {
        source["observedBefore"]["status"] = json!("Running")
    });
    assert!(service.request(create("image-1")).await.is_err());
    assert!(calls(&directory, "DescribeSnapshots").is_empty());
}

#[tokio::test]
async fn available_encrypted_system_source_is_rechecked_and_supplier_details_stay_private() {
    for (key, value) in [
        ("Encrypted", json!(false)),
        ("Encrypted", json!("true")),
        ("SourceDiskType", json!("data")),
        ("SourceDiskId", json!("d-other")),
        ("Status", json!("progressing")),
        ("Available", json!(false)),
    ] {
        let (directory, service) = fixture();
        let mut source = json!({"SnapshotId":"s-test","SourceDiskId":"d-test","SourceDiskType":"system",
            "SourceDiskSize":"80","Status":"accomplished","Encrypted":true,"Available":true});
        source[key] = value;
        fs::write(directory.path().join("source.json"), source.to_string()).unwrap();
        assert!(service.request(create("image-1")).await.is_err(), "{key}");
        assert!(calls(&directory, "CreateImage").is_empty());
    }
}

#[tokio::test]
async fn single_creation_survives_restart_and_original_disk_absence_without_resubmission() {
    let (directory, service) = fixture();
    let first = service.request(create("image-1")).await.unwrap().data;
    assert_eq!(first["outcome"], "accepted");
    assert!(!first.to_string().contains("must-not-leak"));
    let restarted = CloudDesktopService {
        root: service.root.clone(),
        cli: service.cli.clone(),
    };
    assert_eq!(
        restarted.request(create("image-1")).await.unwrap().data,
        first
    );
    let pending = restarted
        .request(CloudDesktopParams::ReadOperation {
            operation_id: "image-1".into(),
        })
        .await
        .unwrap()
        .data;
    assert_eq!(pending["outcome"], "accepted");
    assert!(restarted
        .request(create("image-2"))
        .await
        .unwrap_err()
        .contains("unresolved"));
    modify(&directory, "image.json", |image| {
        image["Status"] = json!("Available")
    });
    let ready = restarted
        .request(CloudDesktopParams::ReadOperation {
            operation_id: "image-1".into(),
        })
        .await
        .unwrap()
        .data;
    assert_eq!(ready["outcome"], "imageReady");
    assert_eq!(ready["requiresInspection"], false);
    assert_eq!(ready["requiresApplicationValidation"], true);
    assert!(!ready.to_string().contains("must-not-leak"));
    assert_eq!(calls(&directory, "CreateImage").len(), 1);
    assert_eq!(restarted.read_receipt("image-1").unwrap().unwrap(), ready);
}

#[tokio::test]
async fn lost_response_recovers_exact_tagged_image_and_empty_or_ambiguous_queries_do_not_resend() {
    let (directory, service) = fixture();
    fs::write(directory.path().join("lost"), "").unwrap();
    assert_eq!(
        service.request(create("image-1")).await.unwrap().data["outcome"],
        "unknown"
    );
    for marker in ["empty", "duplicate", "incomplete"] {
        fs::write(directory.path().join(marker), "").unwrap();
        assert!(service
            .request(CloudDesktopParams::ReadOperation {
                operation_id: "image-1".into()
            })
            .await
            .is_err());
        fs::remove_file(directory.path().join(marker)).unwrap();
        assert_eq!(
            service.read_receipt("image-1").unwrap().unwrap()["outcome"],
            "unknown"
        );
    }
    modify(&directory, "image.json", |image| {
        image["Status"] = json!("Available")
    });
    assert_eq!(
        service
            .request(CloudDesktopParams::ReadOperation {
                operation_id: "image-1".into()
            })
            .await
            .unwrap()
            .data["outcome"],
        "imageReady"
    );
    assert_eq!(calls(&directory, "CreateImage").len(), 1);
}

#[tokio::test]
async fn changed_image_identity_ownership_sharing_source_and_operation_are_rejected() {
    for (key, value) in [
        ("ImageId", json!("m-other")),
        ("ImageOwnerAlias", json!("others")),
        ("IsPublic", json!(true)),
        ("IsSelfShared", json!("true")),
        ("IsSelfShared", json!("True")),
        ("IsSelfShared", json!(false)),
        ("IsSelfShared", json!(null)),
        ("IsSelfShared", json!("")),
        ("IsSelfShared", json!(" false ")),
        ("Platform", json!("Windows Server")),
        ("Architecture", json!("arm64")),
        ("Size", json!(60)),
    ] {
        let (directory, service) = fixture();
        service.request(create("image-1")).await.unwrap();
        modify(&directory, "image.json", |image| image[key] = value);
        assert!(
            service
                .request(CloudDesktopParams::ReadOperation {
                    operation_id: "image-1".into()
                })
                .await
                .is_err(),
            "{key}"
        );
        assert_eq!(
            service.read_receipt("image-1").unwrap().unwrap()["outcome"],
            "accepted"
        );
    }
    for (pointer, value) in [
        ("/Tags/Tag/0/TagValue", json!("other-operation")),
        (
            "/DiskDeviceMappings/DiskDeviceMapping/0/SnapshotId",
            json!("s-other"),
        ),
        (
            "/DiskDeviceMappings/DiskDeviceMapping/0/Type",
            json!("data"),
        ),
    ] {
        let (directory, service) = fixture();
        service.request(create("image-1")).await.unwrap();
        modify(&directory, "image.json", |image| {
            *image.pointer_mut(pointer).unwrap() = value
        });
        assert!(
            service
                .request(CloudDesktopParams::ReadOperation {
                    operation_id: "image-1".into()
                })
                .await
                .is_err(),
            "{pointer}"
        );
    }
}

#[tokio::test]
async fn provider_string_false_casing_survives_receipt_and_inventory_readback() {
    let (directory, service) = fixture();
    service.request(create("image-1")).await.unwrap();
    for value in ["False", "false", "FALSE"] {
        modify(&directory, "image.json", |image| {
            image["Status"] = json!("Available");
            image["IsSelfShared"] = json!(value);
        });
        let receipt = service
            .request(CloudDesktopParams::ReadOperation {
                operation_id: "image-1".into(),
            })
            .await
            .unwrap()
            .data;
        assert_eq!(receipt["outcome"], "imageReady");
        assert_eq!(receipt["imageObserved"]["private"], true);
        assert_eq!(calls(&directory, "CreateImage").len(), 1);
    }
}

#[tokio::test]
async fn listing_uses_owned_tagged_images_and_batch_checks_sources_without_original_vm_or_receipts()
{
    let (directory, service) = fixture();
    service.request(create("image-1")).await.unwrap();
    modify(&directory, "image.json", |image| {
        image["Status"] = json!("Available")
    });
    let list = CloudDesktopParams::ListEcsImages {
        region_id: "cn-test".into(),
        profile: "owned".into(),
    };
    let data = service.request(list.clone()).await.unwrap().data;
    assert_eq!(data["images"][0]["imageId"], "m-test");
    assert_eq!(data["images"][0]["ready"], true);
    assert!(!data.to_string().contains("must-not-leak"));
    fs::remove_file(service.root.join("image-1.json")).unwrap();
    fs::remove_file(service.root.join("cold-snapshot.json")).unwrap();
    assert_eq!(service.request(list.clone()).await.unwrap().data, data);
    let arguments = calls(&directory, "DescribeImages");
    assert!(arguments
        .last()
        .unwrap()
        .windows(2)
        .any(|pair| pair == ["--Tag.1.Key", "lime-system-image"]));
    fs::write(directory.path().join("incomplete"), "").unwrap();
    assert!(service.request(list).await.is_err());
}

#[tokio::test]
async fn tampered_receipt_cannot_clear_inspection_or_claim_an_unverified_ready_image() {
    let (directory, service) = fixture();
    service.request(create("image-1")).await.unwrap();
    modify(&directory, "receipts/image-1.json", |receipt| {
        receipt["requiresInspection"] = json!(false)
    });
    assert!(service.read_receipt("image-1").is_err());
    modify(&directory, "receipts/image-1.json", |receipt| {
        receipt["requiresInspection"] = json!(true);
        receipt["request"]["snapshotId"] = json!("s-other");
    });
    assert!(service.read_receipt("image-1").is_err());
}

#[tokio::test]
async fn provider_failure_is_observed_separately_from_cold_restore_validation() {
    let (directory, service) = fixture();
    service.request(create("image-1")).await.unwrap();
    modify(&directory, "image.json", |image| {
        image["Status"] = json!("CreateFailed")
    });
    let receipt = service
        .request(CloudDesktopParams::ReadOperation {
            operation_id: "image-1".into(),
        })
        .await
        .unwrap()
        .data;
    assert_eq!(receipt["outcome"], "imageFailed");
    assert_eq!(receipt["requiresApplicationValidation"], true);
    assert_eq!(service.read_receipt("image-1").unwrap().unwrap(), receipt);
}

#[tokio::test]
async fn official_tag_spellings_must_agree_and_extra_disks_or_duplicate_tags_are_rejected() {
    let (directory, service) = fixture();
    service.request(create("image-1")).await.unwrap();
    let original = fs::read(directory.path().join("image.json")).unwrap();
    let read = || CloudDesktopParams::ReadOperation {
        operation_id: "image-1".into(),
    };
    modify(&directory, "image.json", |image| {
        for tag in image["Tags"]["Tag"].as_array_mut().unwrap() {
            tag["Key"] = tag["TagKey"].clone();
            tag["Value"] = tag["TagValue"].clone();
        }
    });
    service.request(read()).await.unwrap();
    modify(&directory, "image.json", |image| {
        image["Tags"]["Tag"][0]["Value"] = json!("other-operation")
    });
    assert!(service.request(read()).await.is_err());
    fs::write(directory.path().join("image.json"), &original).unwrap();
    modify(&directory, "image.json", |image| {
        let duplicate = image["Tags"]["Tag"][0].clone();
        image["Tags"]["Tag"].as_array_mut().unwrap().push(duplicate);
    });
    assert!(service.request(read()).await.is_err());
    fs::write(directory.path().join("image.json"), &original).unwrap();
    modify(&directory, "image.json", |image| {
        image["DiskDeviceMappings"]["DiskDeviceMapping"]
            .as_array_mut()
            .unwrap()
            .push(json!({"Type":"data","SnapshotId":"s-other"}));
    });
    assert!(service.request(read()).await.is_err());
}
