use super::*;
use std::os::unix::fs::PermissionsExt;

#[test]
fn preservation_digest_is_stable_across_json_object_order() {
    let expected = "ee60a642b44d93b4596f8d8c0233c2d85d35b4e82fa31a3e13590742e5f22207";
    for text in [
        r#"{"workSaved":true,"resource":{"resourceId":"i-test","regionId":"cn-test","profile":"owned","provider":"ecs"},"action":"hibernateEcs","includeCredentials":true,"discardData":true}"#,
        r#"{"action":"hibernateEcs","discardData":true,"includeCredentials":true,"resource":{"profile":"owned","provider":"ecs","regionId":"cn-test","resourceId":"i-test"},"workSaved":true}"#,
    ] {
        let request = serde_json::from_str(text).unwrap();
        assert_eq!(digest(&request, "d-test").unwrap(), expected);
        assert_ne!(digest(&request, "d-other").unwrap(), expected);
    }
}

const CLI: &str = r#"#!/usr/bin/env python3
import json,pathlib,sys
p=pathlib.Path(__file__).parent
a=sys.argv[1:]
with (p/'calls').open('a') as f: f.write(json.dumps(a)+'\n')
def arg(k): return a[a.index(k)+1]
def load(f): return json.loads((p/f).read_text())
def out(v): print(json.dumps(v))
def intent(action):
  entries=[json.loads(f.read_text()) for f in (p/'receipts').glob('*.json')]
  found=[v for v in entries if v.get('request',{}).get('action')==action]
  assert len(found)==1 and found[0]['outcome']=='unknown'
  parent=[v for v in entries if v.get('request',{}).get('action')=='hibernateEcs'][0]
  assert parent['children'][action]==found[0]['operationId']
  return found[0]
if a[1]=='DescribeInstances':
  assert json.loads(arg('--InstanceIds'))==['i-test']
  entries=[] if (p/'released').exists() else [load('instance.json')]
  out({'TotalCount':len(entries),'Instances':{'Instance':entries}})
elif a[1]=='DescribeDisks':
  out({'TotalCount':len(load('disks.json')),'Disks':{'Disk':load('disks.json')}})
elif a[1]=='StopInstance':
  intent('stop')
  assert arg('--ForceStop')=='false' and arg('--StoppedMode')=='StopCharging'
  v=load('instance.json');v['Status']='Stopping' if (p/'stop-pending').exists() else 'Stopped'
  (p/'instance.json').write_text(json.dumps(v))
  if (p/'lost-stop').exists(): sys.exit(1)
  out({'RequestId':'stop-request'})
elif a[1]=='CreateSnapshot':
  v=intent('snapshot');assert arg('--DiskId')=='d-test' and arg('--ClientToken')==v['operationId']
  if (p/'lost-snapshot').exists(): sys.exit(1)
  out({'SnapshotId':'s-test','RequestId':'snapshot-request'})
elif a[1]=='DescribeSnapshots':
  v={'SnapshotId':'s-test','SourceDiskId':'d-test','SourceDiskType':'system','SourceDiskSize':'80',
     'Status':'accomplished','Encrypted':True,'Available':True,'KMSKeyId':'must-not-leak'}
  if (p/'bad-source').exists(): v['Encrypted']=False
  if (p/'snapshot-pending').exists(): v['Status']='progressing'
  out({'TotalCount':1,'Snapshots':{'Snapshot':[v]}})
elif a[1]=='CreateImage':
  v=intent('createEcsImage');assert arg('--Tag.1.Value')==v['operationId']
  (p/'image-operation').write_text(v['operationId'])
  if (p/'lost-image').exists(): sys.exit(1)
  out({'ImageId':'m-test','RequestId':'image-request'})
elif a[1]=='DescribeImages':
  v={'ImageId':'m-test','ImageName':'Saved environment','Status':'Available','Size':80,
     'ImageOwnerAlias':'self','IsPublic':False,'IsSelfShared':'False','OSType':'linux',
     'Architecture':'x86_64','Platform':'Ubuntu','CreationTime':'2026-11-12T00:00:00Z',
     'Tags':{'Tag':[{'TagKey':'lime-operation','TagValue':(p/'image-operation').read_text()},
                    {'TagKey':'lime-system-image','TagValue':'true'}]},
     'DiskDeviceMappings':{'DiskDeviceMapping':[{'SnapshotId':'s-test','Type':'system'}]}}
  if (p/'bad-image').exists(): v['IsPublic']=True
  if (p/'image-failed').exists(): v['Status']='CreateFailed'
  if (p/'image-pending').exists(): v['Status']='Creating'
  out({'TotalCount':1,'Images':{'Image':[v]}})
elif a[1]=='DeleteInstance':
  v=intent('release');assert v['releaseImage']['ready'] and v['releaseImage']['encrypted']
  assert arg('--Force')=='false' and arg('--TerminateSubscription')=='false'
  if not (p/'hold-delete').exists(): (p/'released').touch()
  if (p/'lost-delete').exists(): sys.exit(1)
  out({'RequestId':'release-request'})
else: raise AssertionError('unexpected action '+a[1])
"#;

fn fixture(status: &str) -> (tempfile::TempDir, CloudDesktopService) {
    let directory = tempfile::tempdir().unwrap();
    let cli = directory.path().join("aliyun");
    fs::write(&cli, CLI).unwrap();
    fs::set_permissions(&cli, fs::Permissions::from_mode(0o700)).unwrap();
    fs::write(directory.path().join("instance.json"), json!({"InstanceId":"i-test","Status":status,"InstanceChargeType":"PostPaid","OperationLocks":{}}).to_string()).unwrap();
    fs::write(directory.path().join("disks.json"), json!([{"DiskId":"d-test","InstanceId":"i-test","Type":"system","Encrypted":true,"Status":"In_use","OperationLocks":{}}]).to_string()).unwrap();
    let service = CloudDesktopService {
        root: directory.path().join("receipts"),
        cli,
    };
    service.ensure_root().unwrap();
    (directory, service)
}

fn resource() -> CloudDesktopResource {
    CloudDesktopResource {
        provider: CloudDesktopProvider::Ecs,
        region_id: "cn-test".into(),
        resource_id: "i-test".into(),
        profile: "owned".into(),
    }
}

fn request() -> CloudDesktopParams {
    CloudDesktopParams::HibernateEcs {
        resource: resource(),
        operation_id: "save-1".into(),
        confirmation: "hibernateEcs:cn-test:i-test:private-image:discard-data".into(),
        work_saved: true,
        include_credentials: true,
        discard_data: true,
    }
}

fn read() -> CloudDesktopParams {
    CloudDesktopParams::ReadOperation {
        operation_id: "save-1".into(),
    }
}

fn calls(directory: &tempfile::TempDir, action: &str) -> usize {
    fs::read_to_string(directory.path().join("calls"))
        .unwrap_or_default()
        .lines()
        .map(|v| serde_json::from_str::<Vec<String>>(v).unwrap())
        .filter(|v| v[1] == action)
        .count()
}

fn modify(directory: &tempfile::TempDir, file: &str, change: impl FnOnce(&mut Value)) {
    let path = directory.path().join(file);
    let mut value: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    change(&mut value);
    fs::write(path, value.to_string()).unwrap();
}

async fn initialize(service: &CloudDesktopService) -> OperationLock {
    // The fixture holds the production lease so it can advance exact steps deterministically.
    let lease = service.hibernation_lease("save-1").unwrap().unwrap();
    let response = service.request(request()).await.unwrap().data;
    assert_eq!(response["workerActive"], true);
    assert_eq!(response["canResume"], false);
    lease
}

#[tokio::test]
async fn single_authorization_preserves_exact_private_image_and_confirms_release() {
    let (directory, service) = fixture("Running");
    fs::write(directory.path().join("lost-stop"), "").unwrap();
    let _lease = initialize(&service).await;
    service.remember_resource(&resource()).unwrap();
    for phase in ["stopping", "snapshotting", "imaging", "releasing"] {
        assert_eq!(
            service.read_receipt("save-1").unwrap().unwrap()["phase"],
            phase
        );
        service.advance_hibernation("save-1").await.unwrap();
    }
    let result = service.request(read()).await.unwrap().data;
    assert_eq!(result["outcome"], "hibernated");
    assert_eq!(result["releaseImage"]["imageId"], "m-test");
    assert_eq!(result["releaseImage"]["diskId"], "d-test");
    assert_eq!(result["observedAfter"]["exists"], false);
    assert_eq!(result["requiresApplicationValidation"], true);
    assert_eq!(result["retainedResourcesMayBeCharged"], true);
    assert!(!result.to_string().contains("must-not-leak"));
    assert_eq!(service.list_resources().unwrap()["resources"], json!([]));
    assert_eq!(service.request(request()).await.unwrap().data, result);
    for action in [
        "StopInstance",
        "CreateSnapshot",
        "CreateImage",
        "DeleteInstance",
    ] {
        assert_eq!(calls(&directory, action), 1, "{action}");
    }
    assert_eq!(calls(&directory, "DeleteSnapshot"), 0);
}

#[tokio::test]
async fn stopped_desktop_skips_stop_and_lost_image_or_delete_never_replays() {
    let (directory, service) = fixture("Stopped");
    let _lease = initialize(&service).await;
    fs::write(directory.path().join("lost-image"), "").unwrap();
    fs::write(directory.path().join("lost-delete"), "").unwrap();
    service.advance_hibernation("save-1").await.unwrap();
    let restarted = CloudDesktopService {
        root: service.root.clone(),
        cli: service.cli.clone(),
    };
    restarted.advance_hibernation("save-1").await.unwrap();
    assert_eq!(
        restarted.advance_hibernation("save-1").await.unwrap(),
        worker::Progress::Complete
    );
    assert_eq!(
        restarted.advance_hibernation("save-1").await.unwrap(),
        worker::Progress::Complete
    );
    assert_eq!(
        restarted.request(read()).await.unwrap().data["outcome"],
        "hibernated"
    );
    assert_eq!(calls(&directory, "StopInstance"), 0);
    for action in ["CreateSnapshot", "CreateImage", "DeleteInstance"] {
        assert_eq!(calls(&directory, action), 1);
    }
}

#[tokio::test]
async fn unknown_snapshot_pauses_and_same_operation_only_inspects_existing_intent() {
    let (directory, service) = fixture("Stopped");
    let lease = initialize(&service).await;
    fs::write(directory.path().join("lost-snapshot"), "").unwrap();
    service.run_hibernation("save-1").await;
    drop(lease);
    let response = service.request(read()).await.unwrap().data;
    assert_eq!(response["outcome"], "paused");
    assert_eq!(response["phase"], "snapshotting");
    assert_eq!(response["canResume"], true);
    let lease = service.hibernation_lease("save-1").unwrap().unwrap();
    service.request(request()).await.unwrap();
    assert!(service.advance_hibernation("save-1").await.is_err());
    drop(lease);
    assert_eq!(calls(&directory, "CreateSnapshot"), 1);
    assert_eq!(calls(&directory, "CreateImage"), 0);
    assert_eq!(calls(&directory, "DeleteInstance"), 0);
}

#[tokio::test]
async fn active_reservation_blocks_alias_profiles_and_unrelated_child_requests() {
    let (directory, service) = fixture("Stopped");
    let _lease = initialize(&service).await;
    let mut alias = resource();
    alias.profile = "alias".into();
    assert!(service
        .mutate(
            alias,
            "start-2".into(),
            "start:cn-test:i-test".into(),
            LifecycleChange::Start,
            true
        )
        .await
        .unwrap_err()
        .contains("preservation is unresolved"));
    let mut second = serde_json::to_value(request()).unwrap();
    second["operationId"] = json!("save-2");
    assert!(service
        .request(serde_json::from_value(second).unwrap())
        .await
        .is_err());
    assert!(service
        .require_hibernation_step("save-1", &resource(), "snapshot", "fake-child")
        .is_err());
    assert_eq!(calls(&directory, "CreateSnapshot"), 0);
}

#[tokio::test]
async fn consent_missing_extra_disks_or_unencrypted_source_never_start_preservation() {
    for key in ["workSaved", "includeCredentials", "discardData"] {
        let (directory, service) = fixture("Running");
        let mut params = serde_json::to_value(request()).unwrap();
        params[key] = json!(false);
        assert!(service
            .request(serde_json::from_value(params).unwrap())
            .await
            .is_err());
        assert_eq!(calls(&directory, "StopInstance"), 0);
        assert!(!service.root.join("save-1.json").exists());
    }
    for extra in [false, true] {
        let (directory, service) = fixture("Running");
        modify(&directory, "disks.json", |v| {
            if extra {
                v.as_array_mut().unwrap().push(json!({"DiskId":"d-extra"}));
            } else {
                v[0]["Encrypted"] = json!(false);
            }
        });
        assert!(service.request(request()).await.is_err());
        assert_eq!(calls(&directory, "StopInstance"), 0);
    }
}

#[tokio::test]
async fn changed_disk_failed_image_and_changed_sharing_never_release_original() {
    for marker in ["bad-source", "bad-image", "image-failed", "extra-disk"] {
        let (directory, service) = fixture("Stopped");
        let _lease = initialize(&service).await;
        service.advance_hibernation("save-1").await.unwrap();
        if marker == "extra-disk" {
            service.advance_hibernation("save-1").await.unwrap();
            modify(&directory, "disks.json", |v| {
                v.as_array_mut().unwrap().push(json!({"DiskId":"d-extra"}))
            });
        } else {
            fs::write(directory.path().join(marker), "").unwrap();
        }
        assert!(
            service.advance_hibernation("save-1").await.is_err(),
            "{marker}"
        );
        assert_eq!(calls(&directory, "DeleteInstance"), 0, "{marker}");
        assert!(!directory.path().join("released").exists());
    }
}

#[tokio::test]
async fn cancellation_stops_future_steps_without_undoing_stop_or_deleting_backups() {
    let (directory, service) = fixture("Running");
    let _lease = initialize(&service).await;
    service.advance_hibernation("save-1").await.unwrap();
    let cancelled = service
        .request(CloudDesktopParams::CancelEcsHibernation {
            operation_id: "save-1".into(),
            confirmation: "cancelEcsHibernation:save-1".into(),
        })
        .await
        .unwrap()
        .data;
    assert_eq!(cancelled["outcome"], "cancelled");
    assert_eq!(
        service.advance_hibernation("save-1").await.unwrap(),
        worker::Progress::Complete
    );
    assert_eq!(
        service.request(request()).await.unwrap().data["outcome"],
        "cancelled"
    );
    assert_eq!(calls(&directory, "StopInstance"), 1);
    assert_eq!(calls(&directory, "CreateSnapshot"), 0);
    assert!(service.check_change_available(&resource(), "start").is_ok());
}

#[tokio::test]
async fn releasing_cannot_be_cancelled_and_reads_never_start_a_worker() {
    let (directory, service) = fixture("Stopped");
    let lease = initialize(&service).await;
    service.advance_hibernation("save-1").await.unwrap();
    service.advance_hibernation("save-1").await.unwrap();
    fs::write(directory.path().join("hold-delete"), "").unwrap();
    service.advance_hibernation("save-1").await.unwrap();
    drop(lease);
    let before = fs::read(directory.path().join("calls")).unwrap();
    for _ in 0..2 {
        let status = service.request(read()).await.unwrap().data;
        assert_eq!(status["canResume"], true);
        assert_eq!(status["canCancel"], false);
    }
    assert_eq!(fs::read(directory.path().join("calls")).unwrap(), before);
    assert!(service
        .cancel_ecs_hibernation("save-1", "cancelEcsHibernation:save-1")
        .is_err());
    assert_eq!(calls(&directory, "DeleteInstance"), 1);
}

#[tokio::test]
async fn failed_release_preflight_can_cancel_before_any_delete_intent() {
    let (directory, service) = fixture("Stopped");
    let _lease = initialize(&service).await;
    service.advance_hibernation("save-1").await.unwrap();
    service.advance_hibernation("save-1").await.unwrap();
    fs::write(directory.path().join("bad-image"), "").unwrap();
    assert!(service.advance_hibernation("save-1").await.is_err());
    assert_eq!(
        service.request(read()).await.unwrap().data["canCancel"],
        true
    );
    assert_eq!(
        service
            .cancel_ecs_hibernation("save-1", "cancelEcsHibernation:save-1")
            .unwrap()["outcome"],
        "cancelled"
    );
    assert_eq!(calls(&directory, "DeleteInstance"), 0);
}

#[tokio::test]
async fn tampered_consent_children_and_completion_proof_fail_closed() {
    for pointer in [
        "/request/includeCredentials",
        "/children/snapshot",
        "/diskId",
        "/outcome",
    ] {
        let (directory, service) = fixture("Stopped");
        let _lease = initialize(&service).await;
        modify(&directory, "receipts/save-1.json", |v| {
            *v.pointer_mut(pointer).unwrap() = json!("tampered")
        });
        assert!(service.request(read()).await.is_err(), "{pointer}");
        assert_eq!(calls(&directory, "DeleteInstance"), 0);
    }
}

#[tokio::test]
async fn background_worker_finishes_once_and_is_independent_of_status_reads() {
    let (directory, service) = fixture("Stopped");
    service.request(request()).await.unwrap();
    tokio::time::timeout(Duration::from_secs(20), async {
        loop {
            if service.read_receipt("save-1").unwrap().unwrap()["outcome"] == "hibernated" {
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .unwrap();
    assert_eq!(
        service.request(read()).await.unwrap().data["outcome"],
        "hibernated"
    );
    for action in ["CreateSnapshot", "CreateImage", "DeleteInstance"] {
        assert_eq!(calls(&directory, action), 1);
    }
}

#[tokio::test]
async fn interrupted_preservation_remains_discoverable_after_recent_history_limit() {
    let (_directory, service) = fixture("Stopped");
    let lease = initialize(&service).await;
    for index in 0..55 {
        let id = format!("recent-{index}");
        service
            .create_receipt(
                &id,
                &json!({"operationId":id,"request":{"action":"start","resource":resource()},
                    "outcome":"accepted","requiresInspection":true,
                    "observedBefore":{"resource":resource(),"status":"Stopped"},
                    "createdAt":"2099-01-01T00:00:00Z"}),
            )
            .unwrap();
    }
    drop(lease);
    let listed = service.list_resources().unwrap();
    assert!(listed["operations"]
        .as_array()
        .unwrap()
        .iter()
        .any(|operation| operation["operationId"] == "save-1"));
    assert_eq!(
        service.request(read()).await.unwrap().data["canResume"],
        true
    );
}

mod polling;
