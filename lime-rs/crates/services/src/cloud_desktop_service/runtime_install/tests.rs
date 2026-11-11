use super::*;
use std::os::unix::fs::PermissionsExt;

const ID: &str = "c8aa13cb-98f2-4c42-a0b3-8f66c73fa4cd";
fn fixture() -> (tempfile::TempDir, CloudDesktopService, CloudDesktopResource) {
    let directory = tempfile::tempdir().unwrap();
    let cli = directory.path().join("aliyun");
    fs::write(&cli,r#"#!/usr/bin/env python3
import json,pathlib,sys
root=pathlib.Path(__file__).parent
args=sys.argv[1:];action=args[1]
def value(flag):return args[args.index(flag)+1]
with (root/'calls').open('a') as out:out.write(json.dumps(args)+'\n')
if action=='DescribeInstances':
 address='127.0.0.1' if (root/'invalid-network').exists() else '47.1.2.3'
 print(json.dumps({'TotalCount':1,'Instances':{'Instance':[{'InstanceId':'i-test','Status':'Running','OperationLocks':{},'VpcAttributes':{'PrivateIpAddress':{'IpAddress':['172.16.1.2']}},'PublicIpAddress':{'IpAddress':[address]}}]}}))
elif action=='DescribeCloudAssistantStatus':
 print(json.dumps({'InstanceCloudAssistantStatusSet':{'InstanceCloudAssistantStatus':[{'InstanceId':'i-test','OSType':'Linux','CloudAssistantStatus':'true'}]}}))
elif action=='RunCommand':
 (root/'submitted.json').write_text(json.dumps({'token':value('--ClientToken'),'name':value('--Name')}))
 if (root/'lost').exists():print('secret-must-not-leak',file=sys.stderr);sys.exit(1)
 print(json.dumps({'InvokeId':'t-test','CommandId':'c-test','Debug':'secret-must-not-leak'}))
elif action=='DescribeInvocations':
 data=json.loads((root/'submitted.json').read_text());assert data['token']==value('--Tag.1.Value')
 print(json.dumps({'Invocations':{'Invocation':[{'InvokeId':'t-test','CommandId':'c-test','CommandName':data['name'],'InvokeInstances':{'InvokeInstance':[{'InstanceId':'i-test'}]}}]}}))
elif action=='DescribeInvocationResults':
 entry={'InvokeId':'t-test','CommandId':'c-test','InstanceId':'i-test','InvocationStatus':'Running','ExitCode':0,'Dropped':0,'Output':'secret-must-not-leak'}
 if (root/'result.json').exists():entry.update(json.loads((root/'result.json').read_text()))
 print(json.dumps({'Invocation':{'InvocationResults':{'InvocationResult':[entry]}}}))
else:sys.exit(2)
"#).unwrap();
    fs::set_permissions(&cli, fs::Permissions::from_mode(0o700)).unwrap();
    let service = CloudDesktopService {
        root: directory.path().join("receipts"),
        cli,
    };
    let resource = CloudDesktopResource {
        provider: CloudDesktopProvider::Ecs,
        profile: "user-owned".into(),
        region_id: "cn-test".into(),
        resource_id: "i-test".into(),
    };
    (directory, service, resource)
}
fn request(resource: &CloudDesktopResource, id: &str) -> CloudDesktopParams {
    CloudDesktopParams::StartEcsRuntimeInstallation {
        resource: resource.clone(),
        operation_id: id.into(),
        archive_sha256: "a".repeat(64),
        manifest_sha256: "b".repeat(64),
        archive_bytes: 12345,
        capability_sha256: "c".repeat(64),
        confirmation: format!(
            "installRuntime:{}:{}",
            resource.region_id, resource.resource_id
        ),
        create_desktop_user: true,
    }
}
async fn read(service: &CloudDesktopService) -> Value {
    service
        .request(CloudDesktopParams::ReadOperation {
            operation_id: ID.into(),
        })
        .await
        .unwrap()
        .data
}
fn result(root: &Path, value: Value) {
    fs::write(
        root.join("result.json"),
        serde_json::to_vec(&value).unwrap(),
    )
    .unwrap()
}
fn ready(receipt: &Value) -> Value {
    json!({"InvocationStatus":"Success","Output":format!("{MARKER}{}\n",json!({"operationId":ID,"phase":"uploadReady","certificate":"-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n","publicAddress":receipt["publicAddress"],"expiresAt":receipt["expiresAt"]}))})
}

#[tokio::test]
async fn fixed_bootstrap_submits_once_and_never_claims_runtime_or_desktop_ready() {
    let (directory, service, resource) = fixture();
    let first = service.request(request(&resource, ID)).await.unwrap().data;
    assert_eq!(first["outcome"], "accepted");
    assert_eq!(first["runtimeInstalled"], false);
    assert_eq!(
        service.request(request(&resource, ID)).await.unwrap().data,
        first
    );
    let calls = fs::read_to_string(directory.path().join("calls")).unwrap();
    let submissions: Vec<Value> = calls
        .lines()
        .map(|line| serde_json::from_str::<Value>(line).unwrap())
        .filter(|v| v[1] == "RunCommand")
        .collect();
    assert_eq!(submissions.len(), 1);
    let args = submissions[0].as_array().unwrap();
    let script = args[args.iter().position(|v| v == "--CommandContent").unwrap() + 1]
        .as_str()
        .unwrap();
    assert!(script.len() <= 24 * 1024);
    assert!(script.contains("/usr/bin/python3 -I"));
    assert_eq!(read(&service).await["outcome"], "runtimeStarting");
    assert!(service
        .request(request(&resource, "199d73b5-6858-4ccb-90ec-e3bb51db1e3e"))
        .await
        .unwrap_err()
        .contains("unresolved"));
    result(directory.path(), ready(&first));
    let observed = read(&service).await;
    assert_eq!(observed["outcome"], "runtimeUploadReady");
    assert_eq!(observed["desktopReady"], false);
    assert_eq!(observed["requiresInspection"], false);
    assert!(!observed.to_string().contains("secret-must-not-leak"));
    assert_eq!(read(&service).await, observed);
}

#[tokio::test]
async fn lost_response_recovers_original_command_and_static_failures_do_not_leak_output() {
    let (directory, service, resource) = fixture();
    fs::write(directory.path().join("lost"), "").unwrap();
    let first = service.request(request(&resource, ID)).await.unwrap().data;
    assert_eq!(first["outcome"], "unknown");
    let restarted = CloudDesktopService {
        root: service.root.clone(),
        cli: service.cli.clone(),
    };
    result(
        directory.path(),
        json!({"InvocationStatus":"Failed","ExitCode":1,"Output":format!("{MARKER}{}\n",json!({"phase":"failed","code":"secret-must-not-leak"}))}),
    );
    let failed = read(&restarted).await;
    assert_eq!(failed["outcome"], "runtimeLaunchFailed");
    assert_eq!(failed["failureCode"], "bootstrapFailed");
    assert!(!failed.to_string().contains("secret-must-not-leak"));
    assert_eq!(
        fs::read_to_string(directory.path().join("calls"))
            .unwrap()
            .lines()
            .filter(|line| line.contains("\"RunCommand\""))
            .count(),
        1
    );
}

#[tokio::test]
async fn request_consent_uuid_hash_and_authoritative_network_are_validated_before_submission() {
    let (directory, service, resource) = fixture();
    let mut denied = request(&resource, ID);
    if let CloudDesktopParams::StartEcsRuntimeInstallation {
        create_desktop_user,
        ..
    } = &mut denied
    {
        *create_desktop_user = false
    }
    assert!(service.request(denied).await.is_err());
    assert!(service.request(request(&resource, "../bad")).await.is_err());
    let mut wrong = request(&resource, ID);
    if let CloudDesktopParams::StartEcsRuntimeInstallation {
        capability_sha256, ..
    } = &mut wrong
    {
        *capability_sha256 = "raw-token".into()
    }
    assert!(service.request(wrong).await.is_err());
    fs::write(directory.path().join("invalid-network"), "").unwrap();
    let refused = service.request(request(&resource, ID)).await.unwrap().data;
    assert_eq!(refused["outcome"], "notSubmitted");
    assert_eq!(read(&service).await, refused);
    assert!(!fs::read_to_string(directory.path().join("calls"))
        .unwrap()
        .contains("\"RunCommand\""));
}

#[tokio::test]
async fn public_certificate_target_expiry_and_complete_output_must_match_original_operation() {
    for change in [
        json!({"operationId":"wrong"}),
        json!({"publicAddress":"8.8.8.8"}),
        json!({"expiresAt":1}),
        json!({"certificate":"token-secret-must-not-leak"}),
    ] {
        let (directory, service, resource) = fixture();
        let first = service.request(request(&resource, ID)).await.unwrap().data;
        let mut entry = ready(&first);
        let mut public: Value = serde_json::from_str(
            entry["Output"]
                .as_str()
                .unwrap()
                .strip_prefix(MARKER)
                .unwrap(),
        )
        .unwrap();
        public
            .as_object_mut()
            .unwrap()
            .extend(change.as_object().unwrap().clone());
        entry["Output"] = json!(format!("{MARKER}{public}\n"));
        result(directory.path(), entry);
        let failed = read(&service).await;
        assert_eq!(failed["outcome"], "runtimeLaunchFailed");
        assert!(failed["upload"].is_null());
        assert!(!failed.to_string().contains("secret-must-not-leak"));
    }
}
