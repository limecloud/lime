use super::*;
use sha2::{Digest, Sha256};
use std::os::unix::fs::PermissionsExt;

fn fixture() -> (tempfile::TempDir, CloudDesktopService, CloudDesktopResource) {
    let directory = tempfile::tempdir().unwrap();
    let cli = directory.path().join("aliyun");
    fs::write(&cli, r#"#!/usr/bin/env python3
import json,pathlib,sys
p=pathlib.Path(__file__).parent
a=sys.argv[1:]
with (p/'calls').open('a') as f:f.write(json.dumps(a)+'\n')
def arg(k):return a[a.index(k)+1]
action=a[1]
if action=='DescribeInstances':
 if (p/'fail-read').exists():sys.exit(1)
 item={'InstanceId':'i-test','Status':'Running' if (p/'running').exists() else 'Stopped',
       'InstanceChargeType':'PrePaid' if (p/'prepaid').exists() else 'PostPaid',
       'AutoReleaseTime':(p/'deadline').read_text().replace(':00Z','Z') if (p/'deadline').exists() else '',
       'OperationLocks':{}}
 if (p/'invalid-time').exists():item['AutoReleaseTime']={'secret':'must-not-leak'}
 print(json.dumps({'TotalCount':0 if (p/'missing').exists() else 1,
                   'Instances':{'Instance':[] if (p/'missing').exists() else [item]}}))
elif action=='DescribeDisks':
 print(json.dumps({'TotalCount':1,'Disks':{'Disk':[{'DiskId':'d-test','InstanceId':'i-test','Type':'system','Encrypted':True}]}}))
elif action=='DescribeSnapshots':
 print(json.dumps({'TotalCount':1,'Snapshots':{'Snapshot':[{'SnapshotId':'s-test','SourceDiskId':'d-test',
       'SourceDiskType':'system','SourceDiskSize':'80','Encrypted':True,'Available':True,'Status':'accomplished'}]}}))
elif action=='DescribeImages':
 items=[] if (p/'no-image').exists() else [{'ImageId':'m-test','ImageName':'Saved desktop','Status':'Available',
       'Size':80,'ImageOwnerAlias':'self','IsPublic':False,'IsSelfShared':'False','Platform':'Ubuntu',
       'Architecture':'x86_64','OSType':'linux','DiskDeviceMappings':{'DiskDeviceMapping':[{'Type':'system','SnapshotId':'s-test'}]},
       'Tags':{'Tag':[{'Key':'lime-operation','Value':'image-1'},{'Key':'lime-system-image','Value':'true'}]}}]
 print(json.dumps({'TotalCount':len(items),'Images':{'Image':items}}))
elif action=='ModifyInstanceAutoReleaseTime':
 assert arg('--InstanceId')=='i-test'
 action='scheduleEcsRelease' if '--AutoReleaseTime' in a else 'cancelEcsRelease'
 intents=[json.loads(f.read_text()) for f in (p/'receipts').glob('*.json')]
 assert any(v.get('request',{}).get('action')==action and v['outcome']=='unknown' for v in intents)
 if '--AutoReleaseTime' in a:(p/'deadline').write_text(arg('--AutoReleaseTime'))
 else:(p/'deadline').unlink(missing_ok=True)
 if (p/'lost').exists():sys.exit(1)
 print(json.dumps({'RequestId':'request-test'}))
elif action=='StartInstance':print(json.dumps({'RequestId':'start-test'}))
else:raise AssertionError('Unexpected cloud mutation '+action)
"#).unwrap();
    fs::set_permissions(&cli, fs::Permissions::from_mode(0o700)).unwrap();
    let service = CloudDesktopService {
        root: directory.path().join("receipts"),
        cli,
    };
    service.ensure_root().unwrap();
    let resource = CloudDesktopResource {
        provider: CloudDesktopProvider::Ecs,
        region_id: "cn-test".into(),
        resource_id: "i-test".into(),
        profile: "owned".into(),
    };
    let request = json!({"action":"createEcsImage","resource":resource,"diskId":"d-test","snapshotId":"s-test",
        "snapshotOperationId":"cold-snapshot","includeCredentials":true});
    service.create_receipt("image-1", &json!({"operationId":"image-1","outcome":"imageReady","imageId":"m-test",
        "requestSha256":format!("{:x}",Sha256::digest(serde_json::to_vec(&request).unwrap())),
        "createdAt":Utc::now().to_rfc3339(),"inspectedAt":Utc::now().to_rfc3339(),
        "requiresInspection":false,"requiresApplicationValidation":true,"request":request,
        "snapshotBefore":{"snapshotId":"s-test","diskId":"d-test","encrypted":true,"ready":true,"systemDiskGiB":80},
        "imageObserved":{"imageId":"m-test","operationId":"image-1","snapshotId":"s-test","diskId":"d-test",
            "encrypted":true,"private":true,"ready":true,"status":"Available","systemDiskGiB":80}})).unwrap();
    service.read_receipt("image-1").unwrap();
    (directory, service, resource)
}

fn time() -> String {
    DateTime::from_timestamp((Utc::now().timestamp() / 60 + 32) * 60, 0)
        .unwrap()
        .to_rfc3339_opts(SecondsFormat::Secs, true)
}

fn schedule(resource: &CloudDesktopResource, id: &str, time: &str) -> CloudDesktopParams {
    CloudDesktopParams::ScheduleEcsRelease {
        resource: resource.clone(),
        operation_id: id.into(),
        image_operation_id: "image-1".into(),
        release_at: time.into(),
        work_saved: true,
        discard_data: true,
        confirmation: format!(
            "scheduleEcsRelease:cn-test:i-test:{time}:discard-data:image:image-1"
        ),
    }
}

fn cancel(resource: &CloudDesktopResource, id: &str, time: &str) -> CloudDesktopParams {
    CloudDesktopParams::CancelEcsRelease {
        resource: resource.clone(),
        operation_id: id.into(),
        release_at: time.into(),
        confirmation: format!("cancelEcsRelease:cn-test:i-test:{time}"),
    }
}

async fn read(service: &CloudDesktopService, id: &str) -> Value {
    service
        .request(CloudDesktopParams::ReadOperation {
            operation_id: id.into(),
        })
        .await
        .unwrap()
        .data
}

fn mutations(directory: &Path) -> usize {
    fs::read_to_string(directory.join("calls"))
        .unwrap_or_default()
        .lines()
        .filter(|line| line.contains("ModifyInstanceAutoReleaseTime"))
        .count()
}

#[tokio::test]
async fn schedule_survives_restart_submits_once_and_provider_read_confirms_deadline() {
    let (dir, service, resource) = fixture();
    let t = time();
    let params = schedule(&resource, "schedule-1", &t);
    let first = service.request(params.clone()).await.unwrap();
    assert_eq!(first.data["outcome"], "accepted");
    assert_eq!(first.data["releaseImage"]["imageId"], "m-test");
    let restarted = CloudDesktopService {
        root: service.root.clone(),
        cli: service.cli.clone(),
    };
    assert_eq!(restarted.request(params).await.unwrap(), first);
    assert_eq!(mutations(dir.path()), 1);
    assert_eq!(read(&restarted, "schedule-1").await["outcome"], "scheduled");
    assert_eq!(mutations(dir.path()), 1);
    assert!(
        service
            .request(schedule(&resource, "schedule-2", &t))
            .await
            .unwrap()
            .data["outcome"]
            == "notSubmitted"
    );
    fs::write(dir.path().join("missing"), "").unwrap();
    assert_eq!(read(&service, "schedule-1").await["outcome"], "released");
}

#[tokio::test]
async fn lost_response_only_reads_original_and_verified_cancel_unblocks_original_schedule() {
    let (dir, service, resource) = fixture();
    let t = time();
    fs::write(dir.path().join("lost"), "").unwrap();
    let params = schedule(&resource, "schedule-1", &t);
    assert_eq!(
        service.request(params.clone()).await.unwrap().data["outcome"],
        "unknown"
    );
    service.request(params).await.unwrap();
    assert_eq!(read(&service, "schedule-1").await["outcome"], "scheduled");
    let start = CloudDesktopParams::Start {
        resource: resource.clone(),
        operation_id: "start-1".into(),
        confirmation: "start:cn-test:i-test".into(),
    };
    assert!(service.request(start.clone()).await.is_err());
    let cancellation = cancel(&resource, "cancel-1", &t);
    assert_eq!(
        service.request(cancellation.clone()).await.unwrap().data["outcome"],
        "unknown"
    );
    service.request(cancellation).await.unwrap();
    assert!(service.request(start.clone()).await.is_err());
    assert!(
        service
            .request(cancel(&resource, "cancel-2", &t))
            .await
            .unwrap()
            .data["outcome"]
            == "notSubmitted"
    );
    assert_eq!(mutations(dir.path()), 2);
    assert_eq!(
        read(&service, "cancel-1").await["outcome"],
        "releaseCancelled"
    );
    assert_eq!(
        read(&service, "schedule-1").await["outcome"],
        "scheduleCancelled"
    );
    assert_eq!(
        service.request(start).await.unwrap().data["outcome"],
        "accepted"
    );
    assert_eq!(mutations(dir.path()), 2);
}

#[tokio::test]
async fn schedule_refuses_running_prepaid_existing_deadline_and_missing_backup() {
    for marker in ["running", "prepaid", "deadline", "no-image", "invalid-time"] {
        let (dir, service, resource) = fixture();
        let t = time();
        fs::write(
            dir.path().join(marker),
            if marker == "deadline" { &t } else { "" },
        )
        .unwrap();
        assert!(
            service
                .request(schedule(&resource, "schedule-1", &t))
                .await
                .unwrap()
                .data["outcome"]
                == "notSubmitted",
            "{marker}"
        );
        assert_eq!(mutations(dir.path()), 0, "{marker}");
        assert!(service.read_receipt("schedule-1").unwrap().is_none());
    }
}

#[tokio::test]
async fn no_mutation_without_exact_consent_canonical_time_and_current_grace_period() {
    for field in [
        "confirmation",
        "workSaved",
        "discardData",
        "releaseAt",
        "imageOperationId",
    ] {
        let (dir, service, resource) = fixture();
        let mut params = serde_json::to_value(schedule(&resource, "schedule-1", &time())).unwrap();
        params[field] = if matches!(field, "workSaved" | "discardData") {
            json!(false)
        } else {
            json!("invalid")
        };
        assert!(
            service
                .request(serde_json::from_value(params).unwrap())
                .await
                .is_err(),
            "{field}"
        );
        assert_eq!(mutations(dir.path()), 0);
    }
    let (dir, service, resource) = fixture();
    for t in [
        "2020-01-01T00:00:00Z",
        "2099-01-01T00:00:00Z",
        "2026-11-12T00:00:01Z",
    ] {
        assert!(service
            .request(schedule(&resource, "schedule-1", t))
            .await
            .map(|r| r.data["outcome"] == "notSubmitted")
            .unwrap_or(true));
    }
    assert_eq!(mutations(dir.path()), 0);
}

#[tokio::test]
async fn outside_deadline_blocks_start_and_cancellation_never_overwrites_changed_plan() {
    let (dir, service, resource) = fixture();
    let t = time();
    fs::write(dir.path().join("deadline"), &t).unwrap();
    assert!(service
        .request(CloudDesktopParams::Start {
            resource: resource.clone(),
            operation_id: "start-1".into(),
            confirmation: "start:cn-test:i-test".into()
        })
        .await
        .is_err());
    assert!(
        service
            .request(cancel(&resource, "cancel-1", "2026-01-01T00:00:00Z"))
            .await
            .unwrap()
            .data["outcome"]
            == "notSubmitted"
    );
    assert_eq!(mutations(dir.path()), 0);
    service
        .request(cancel(&resource, "cancel-1", &t))
        .await
        .unwrap();
    fs::write(dir.path().join("deadline"), "2099-01-01T00:00:00Z").unwrap();
    assert_eq!(
        read(&service, "cancel-1").await["outcome"],
        "scheduleChanged"
    );
    assert_eq!(mutations(dir.path()), 1);
    fs::write(dir.path().join("fail-read"), "").unwrap();
    assert!(service
        .request(CloudDesktopParams::ReadOperation {
            operation_id: "cancel-1".into()
        })
        .await
        .is_err());
    assert_eq!(
        service.read_receipt("cancel-1").unwrap().unwrap()["outcome"],
        "scheduleChanged"
    );
}

#[tokio::test]
async fn absence_without_observed_schedule_never_invents_cancellation_or_unblocks_start() {
    let (dir, service, resource) = fixture();
    let t = time();
    service
        .request(schedule(&resource, "schedule-1", &t))
        .await
        .unwrap();
    fs::remove_file(dir.path().join("deadline")).unwrap();
    assert_eq!(read(&service, "schedule-1").await["outcome"], "unknown");
    assert!(service
        .request(CloudDesktopParams::Start {
            resource,
            operation_id: "start-1".into(),
            confirmation: "start:cn-test:i-test".into(),
        })
        .await
        .is_err());
    assert_eq!(mutations(dir.path()), 1);
}

#[tokio::test]
async fn corrupted_schedule_cannot_claim_release_or_cancel_confirmation() {
    for field in [
        "outcome",
        "requiresInspection",
        "observedBefore",
        "releaseImage",
    ] {
        let (dir, service, resource) = fixture();
        service
            .request(schedule(&resource, "schedule-1", &time()))
            .await
            .unwrap();
        let mut receipt = service.read_receipt("schedule-1").unwrap().unwrap();
        receipt[field] = match field {
            "outcome" => json!("released"),
            "requiresInspection" => json!(false),
            _ => json!({}),
        };
        service.finalize_receipt("schedule-1", &receipt);
        assert!(
            service
                .request(CloudDesktopParams::ReadOperation {
                    operation_id: "schedule-1".into()
                })
                .await
                .is_err(),
            "{field}"
        );
        assert!(service.list_resources().is_err(), "{field}");
        assert_eq!(mutations(dir.path()), 1);
    }
}

#[tokio::test]
async fn a_provider_deadline_prevents_preparation_and_opening_a_new_task_session() {
    let (dir, service, resource) = fixture();
    fs::write(dir.path().join("deadline"), time()).unwrap();
    fs::write(dir.path().join("running"), "").unwrap();
    assert!(service.preflight_ecs_preparation(&resource).await.is_err());
    assert!(service
        .request(CloudDesktopParams::OpenEcsTunnel {
            resource,
            channel: CloudDesktopTunnelChannel::AppServer
        })
        .await
        .is_err());
    assert_eq!(mutations(dir.path()), 0);
    let calls = fs::read_to_string(dir.path().join("calls")).unwrap();
    assert!(!calls.contains("StartTerminalSession"));
    assert!(!calls.contains("RunCommand"));
}
