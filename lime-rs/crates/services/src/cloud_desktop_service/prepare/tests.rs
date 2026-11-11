use super::*;
use std::os::unix::fs::PermissionsExt;

fn fixture() -> (tempfile::TempDir, CloudDesktopService, CloudDesktopResource) {
    let directory = tempfile::tempdir().unwrap();
    let cli = directory.path().join("aliyun");
    fs::write(&cli, r#"#!/usr/bin/env python3
import json, pathlib, sys
root = pathlib.Path(__file__).parent
args = sys.argv[1:]
action = args[1]
def value(flag): return args[args.index(flag)+1]
with (root/'calls').open('a') as f: f.write(json.dumps(args)+'\n')
if action == 'DescribeInstances':
 print(json.dumps({'Instances': {'Instance': [{'InstanceId':'i-test','Status':'Running','OperationLocks':{}}]}}))
elif action == 'DescribeCloudAssistantStatus':
 print(json.dumps({'InstanceCloudAssistantStatusSet': {'InstanceCloudAssistantStatus': [{'InstanceId':'i-other' if (root/'wrong-agent').exists() else 'i-test', 'OSType':'Windows' if (root/'windows').exists() else 'Linux', 'CloudAssistantStatus':'false' if (root/'offline').exists() else 'true'}]}}))
elif action == 'RunCommand':
 (root/'submitted.json').write_text(json.dumps({'token':value('--ClientToken'), 'name':value('--Name')}))
 if (root/'lost-submit').exists():
  print('token=must-not-leak', file=sys.stderr)
  sys.exit(1)
 print(json.dumps({'InvokeId':'t-test','CommandId':'c-test','RequestId':'request-test','Debug':'must-not-leak'}))
elif action == 'DescribeInvocations':
 data=json.loads((root/'submitted.json').read_text())
 assert value('--Tag.1.Value') == data['token']
 entry={'InvokeId':'t-test','CommandId':'c-test','CommandName':data['name'], 'InvokeInstances':{'InvokeInstance':[{'InstanceId':'i-test'}]}}
 if (root/'wrong-recovery').exists(): entry['CommandName']='other-operation'
 print(json.dumps({'Invocations':{'Invocation':[entry]}}))
elif action == 'DescribeInvocationResults':
 entry={'InvokeId':'t-test','CommandId':'c-test','InstanceId':'i-test','InvocationStatus':'Running','ExitCode':0,'Dropped':0,'Output':'must-not-leak'}
 if (root/'result.json').exists(): entry.update(json.loads((root/'result.json').read_text()))
 print(json.dumps({'Invocation':{'InvocationResults':{'InvocationResult':[entry]}}}))
else: sys.exit(2)
"#).unwrap();
    fs::set_permissions(&cli, fs::Permissions::from_mode(0o700)).unwrap();
    (
        directory,
        CloudDesktopService {
            root: cli.parent().unwrap().join("receipts"),
            cli,
        },
        CloudDesktopResource {
            provider: CloudDesktopProvider::Ecs,
            profile: "user-owned".into(),
            region_id: "cn-test".into(),
            resource_id: "i-test".into(),
        },
    )
}

fn request(resource: &CloudDesktopResource, id: &str) -> CloudDesktopParams {
    CloudDesktopParams::PrepareEcsDesktop {
        resource: resource.clone(),
        operation_id: id.into(),
        confirmation: format!(
            "prepareEcsDesktop:{}:{}",
            resource.region_id, resource.resource_id
        ),
        install_system_packages: true,
    }
}

async fn read(service: &CloudDesktopService, id: &str) -> Result<Value, String> {
    service
        .request(CloudDesktopParams::ReadOperation {
            operation_id: id.into(),
        })
        .await
        .map(|v| v.data)
}

fn calls(directory: &Path) -> Vec<Value> {
    fs::read_to_string(directory.join("calls"))
        .unwrap_or_default()
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect()
}

fn result(directory: &Path, value: Value) {
    fs::write(
        directory.join("result.json"),
        serde_json::to_vec(&value).unwrap(),
    )
    .unwrap();
}

fn success() -> Value {
    json!({"InvocationStatus":"Success", "Output":format!("{MARKER}ready\n")})
}

#[tokio::test]
async fn preparation_runs_once_and_only_exact_verified_result_prepares_dependencies() {
    let (directory, service, resource) = fixture();
    let first = service
        .request(request(&resource, "prepare-1"))
        .await
        .unwrap()
        .data;
    assert_eq!(first["outcome"], "accepted");
    assert_eq!(first["desktopReady"], false);
    assert_eq!(first["runtimeInstalled"], false);
    assert!(!first.to_string().contains("must-not-leak"));
    let before = calls(directory.path());
    assert_eq!(
        service
            .request(request(&resource, "prepare-1"))
            .await
            .unwrap()
            .data,
        first
    );
    assert_eq!(calls(directory.path()), before);
    let args = before.last().unwrap().as_array().unwrap();
    let argument = |name| {
        args[args.iter().position(|v| v == name).unwrap() + 1]
            .as_str()
            .unwrap()
    };
    assert_eq!(argument("--CommandContent"), SCRIPT);
    assert_eq!(argument("--RepeatMode"), "Once");
    assert_eq!(argument("--InstanceId.1"), resource.resource_id);
    assert_eq!(argument("--KeepCommand"), "false");
    assert!(SCRIPT.len().div_ceil(3) * 4 <= 24 * 1024);
    assert_eq!(
        read(&service, "prepare-1").await.unwrap()["outcome"],
        "preparing"
    );
    assert!(service
        .request(request(&resource, "prepare-2"))
        .await
        .unwrap_err()
        .contains("unresolved"));
    result(directory.path(), success());
    let verified = read(&service, "prepare-1").await.unwrap();
    assert_eq!(verified["outcome"], "dependenciesReady");
    assert_eq!(verified["packagesPrepared"], true);
    assert_eq!(verified["requiresInspection"], false);
    assert_eq!(verified["desktopReady"], false);
    assert_eq!(verified["runtimeInstalled"], false);
    assert!(!verified.to_string().contains("must-not-leak"));
    assert!(service.list_resources().unwrap()["operations"]
        .to_string()
        .contains("dependenciesReady"));
}

#[tokio::test]
async fn lost_submit_recovers_the_original_invocation_after_restart_without_resending() {
    let (directory, service, resource) = fixture();
    fs::write(directory.path().join("lost-submit"), "").unwrap();
    let pending = service
        .request(request(&resource, "lost-1"))
        .await
        .unwrap()
        .data;
    assert_eq!(pending["outcome"], "unknown");
    assert!(!pending.to_string().contains("must-not-leak"));
    let restarted = CloudDesktopService {
        root: service.root.clone(),
        cli: service.cli.clone(),
    };
    let mut alias = resource.clone();
    alias.profile = "second-profile".into();
    assert!(restarted
        .request(request(&alias, "lost-2"))
        .await
        .unwrap_err()
        .contains("unresolved"));
    // Invalid recovery metadata cannot attach an unrelated command.
    fs::write(directory.path().join("wrong-recovery"), "").unwrap();
    assert!(read(&restarted, "lost-1").await.is_err());
    fs::remove_file(directory.path().join("wrong-recovery")).unwrap();
    result(directory.path(), success());
    assert_eq!(
        read(&restarted, "lost-1").await.unwrap()["outcome"],
        "dependenciesReady"
    );
    assert_eq!(
        calls(directory.path())
            .iter()
            .filter(|v| v[1] == "RunCommand")
            .count(),
        1
    );
}

#[tokio::test]
async fn preparation_requires_consent_and_exact_online_agent_before_submission() {
    let (directory, service, resource) = fixture();
    let mut denied = request(&resource, "denied");
    if let CloudDesktopParams::PrepareEcsDesktop {
        install_system_packages,
        ..
    } = &mut denied
    {
        *install_system_packages = false;
    }
    assert!(service.request(denied).await.is_err());
    let mut wuying = resource.clone();
    wuying.provider = CloudDesktopProvider::Wuying;
    assert!(service.request(request(&wuying, "wuying")).await.is_err());
    assert!(calls(directory.path()).is_empty());
    for marker in ["offline", "wrong-agent", "windows"] {
        fs::write(directory.path().join(marker), "").unwrap();
        let refused = service
            .request(request(&resource, marker))
            .await
            .unwrap()
            .data;
        assert_eq!(refused["outcome"], "notSubmitted");
        assert_eq!(refused["submitted"], false);
        assert_eq!(read(&service, marker).await.unwrap(), refused);
        fs::remove_file(directory.path().join(marker)).unwrap();
    }
    assert!(calls(directory.path()).iter().all(|v| v[1] != "RunCommand"));
}

#[tokio::test]
async fn preparation_rejects_wrong_target_ids_and_unknown_status_without_losing_receipt() {
    for (field, value) in [
        ("InstanceId", "i-other"),
        ("CommandId", "c-other"),
        ("InvokeId", "t-other"),
        ("InvocationStatus", "unexpected"),
    ] {
        let (directory, service, resource) = fixture();
        service
            .request(request(&resource, "mismatch"))
            .await
            .unwrap();
        result(directory.path(), json!({field:value}));
        assert!(read(&service, "mismatch").await.is_err(), "{field}");
        assert_eq!(
            service.read_receipt("mismatch").unwrap().unwrap()["outcome"],
            "accepted"
        );
        assert!(service.request(request(&resource, "second")).await.is_err());
    }
}

#[tokio::test]
async fn no_ready_claim_for_missing_marker_failed_exit_truncated_or_sensitive_output() {
    for change in [
        json!({"Output":"secret-token=must-not-leak"}),
        json!({"ExitCode":1}),
        json!({"Dropped":1}),
        json!({"InvocationStatus":"Failed"}),
        json!({"Output":format!("{MARKER}ready\nsecret-token=must-not-leak")}),
    ] {
        let (directory, service, resource) = fixture();
        service.request(request(&resource, "failed")).await.unwrap();
        let mut entry = success();
        entry
            .as_object_mut()
            .unwrap()
            .extend(change.as_object().unwrap().clone());
        result(directory.path(), entry);
        let receipt = read(&service, "failed").await.unwrap();
        assert_eq!(receipt["outcome"], "preparationFailed");
        assert_eq!(receipt["packagesPrepared"], false);
        assert!(!receipt.to_string().contains("must-not-leak"));
        assert!(!fs::read_to_string(service.root.join("failed.json"))
            .unwrap()
            .contains("must-not-leak"));
    }
}

#[tokio::test]
async fn fixed_failure_codes_are_projected_and_corrupt_receipt_is_rejected() {
    let (directory, service, resource) = fixture();
    service
        .request(request(&resource, "unsupported"))
        .await
        .unwrap();
    result(
        directory.path(),
        json!({"InvocationStatus":"Failed", "ExitCode":1,"Output":format!("{MARKER}unsupportedSystem\n")}),
    );
    let mut receipt = read(&service, "unsupported").await.unwrap();
    assert_eq!(receipt["failureCode"], "unsupportedSystem");
    receipt["request"]["resource"]["resourceId"] = json!("i-other");
    service.finalize_receipt("unsupported", &receipt);
    assert!(read(&service, "unsupported").await.is_err());
}
