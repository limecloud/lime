//! Original lifecycle intents survive stdio restart; provider calls are an explicit local fixture.
#![cfg(unix)]
mod support;

use serde_json::{json, Value};
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use support::json_lines_transport::TransportClient;

const CLI: &str = r#"#!/usr/bin/env python3
import json,pathlib,sys
p=pathlib.Path(__file__).parent
a=sys.argv[1:]
with (p/'calls').open('a') as f: f.write(json.dumps(a)+'\n')
assert a[a.index('--profile')+1]=='original-profile'
assert a[a.index('--region')+1]=='cn-test'
action=a[1]
if action=='DescribeInstances':
 assert json.loads(a[a.index('--InstanceIds')+1])==['i-test']
 status=(p/'status').read_text()
 print(json.dumps({'TotalCount':1,'Instances':{'Instance':[{'InstanceId':'i-test',
  'Status':status,'InstanceChargeType':'PostPaid','OperationLocks':{},
  'StoppedMode':'StopCharging' if status=='Stopped' else 'KeepCharging'}]}}))
elif action=='StopInstance':
 assert a[a.index('--ForceStop')+1]=='false'
 assert a[a.index('--StoppedMode')+1]=='StopCharging'
 (p/'status').write_text('Stopping')
 sys.exit(1)
elif action=='StartInstance':
 (p/'status').write_text('Running')
 print(json.dumps({'RequestId':'local-start'}))
else: raise AssertionError(action)
"#;

#[tokio::test]
async fn stdio_lifecycle_recovers_original_unknown_and_allows_the_next_confirmed_action() {
    let root = tempfile::tempdir().unwrap();
    fs::write(root.path().join("config.yaml"), "{}\n").unwrap();
    let tools = root.path().join("app/tools");
    fs::create_dir_all(&tools).unwrap();
    let cli = tools.join("aliyun");
    fs::write(&cli, CLI).unwrap();
    fs::set_permissions(&cli, fs::Permissions::from_mode(0o700)).unwrap();
    fs::write(tools.join("status"), "Running").unwrap();
    let binary = Path::new(env!("CARGO_BIN_EXE_app-server"));
    let resource = json!({"provider":"ecs","profile":"original-profile", "regionId":"cn-test","resourceId":"i-test"});
    let mut peer = TransportClient::start_stdio(binary, root.path(), "lifecycle-before").await;
    let stop = peer
        .request_ok(
            2,
            "cloud/desktop",
            json!({"action":"stop","resource":resource,
            "operationId":"original-stop","confirmation":"stop:cn-test:i-test","workSaved":true}),
        )
        .await;
    assert_eq!(stop["result"]["data"]["outcome"], "unknown");
    let before = fs::read(tools.join("calls")).unwrap();
    let mut alias = resource.clone();
    alias["profile"] = json!("another-profile");
    let blocked = peer
        .request(3, "cloud/desktop", json!({"action":"stop","resource":alias,
            "operationId":"replacement-stop","confirmation":"stop:cn-test:i-test","workSaved":true}))
        .await;
    assert!(blocked["error"]["message"]
        .as_str()
        .unwrap()
        .contains("original-stop"));
    assert_eq!(fs::read(tools.join("calls")).unwrap(), before);
    assert!(!root
        .path()
        .join("app/cloud-desktops/replacement-stop.json")
        .exists());
    peer.shutdown().await;

    fs::write(tools.join("status"), "Stopped").unwrap();
    let mut peer = TransportClient::start_stdio(binary, root.path(), "lifecycle-after").await;
    let observed = peer
        .request_ok(
            2,
            "cloud/desktop",
            json!({"action":"inspect","resource":resource}),
        )
        .await;
    assert_eq!(observed["result"]["data"]["status"], "Stopped");
    let before = fs::read(tools.join("calls")).unwrap();
    let read = json!({"action":"readOperation","operationId":"original-stop"});
    let verified = peer.request_ok(3, "cloud/desktop", read.clone()).await;
    let receipt = &verified["result"]["data"];
    assert_eq!(receipt["operationId"], "original-stop");
    assert_eq!(receipt["request"]["resource"], resource);
    assert_eq!(receipt["outcome"], "lifecycleVerified");
    assert_eq!(receipt["requiresInspection"], false);
    assert_eq!(receipt["observedAfter"]["computeReleased"], true);
    assert_eq!(fs::read(tools.join("calls")).unwrap(), before);
    let again = peer.request_ok(4, "cloud/desktop", read).await;
    assert_eq!(again["result"]["data"], *receipt);
    assert_eq!(fs::read(tools.join("calls")).unwrap(), before);

    let start = peer
        .request_ok(
            5,
            "cloud/desktop",
            json!({"action":"start","resource":resource,
            "operationId":"next-start","confirmation":"start:cn-test:i-test"}),
        )
        .await;
    assert_eq!(start["result"]["data"]["outcome"], "accepted");
    let running = peer
        .request_ok(
            6,
            "cloud/desktop",
            json!({"action":"readOperation","operationId":"next-start"}),
        )
        .await;
    assert_eq!(running["result"]["data"]["outcome"], "lifecycleVerified");
    assert_eq!(
        running["result"]["data"]["observedAfter"]["status"],
        "Running"
    );
    peer.shutdown().await;
    let calls: Vec<Value> = fs::read_to_string(tools.join("calls"))
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    for action in ["StopInstance", "StartInstance"] {
        assert_eq!(calls.iter().filter(|call| call[1] == action).count(), 1);
    }
}
