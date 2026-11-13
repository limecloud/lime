//! 阿里云 BYOC 授权经过真实 stdio App Server，供应商 CLI 为显式本机夹具。
#![cfg(unix)]
mod support;

use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::time::Duration;
use support::json_lines_transport::TransportClient;

const CLI: &str = r#"#!/usr/bin/env python3
import json,pathlib,sys,time
p=pathlib.Path(__file__).parent
a=sys.argv[1:]
if a==['version']: print('3.5.2');sys.exit(0)
with (p/'calls').open('a') as f: f.write(json.dumps(a)+'\n')
config=pathlib.Path(a[a.index('--config-path')+1])
assert config.is_file() and config.stat().st_mode & 0o077 == 0
if a[0]=='configure':
 assert a[a.index('--mode')+1]=='OAuth'
 assert a[a.index('--oauth-site-type')+1]=='CN'
 assert sys.stdin.read()==''
 config.write_text(json.dumps({'syntheticToken':'must-not-project-refresh-token',
     'syntheticAccount':json.loads((p/'identity.json').read_text())}))
 print('must-not-project-refresh-token',flush=True)
 print('must-not-project-refresh-token',file=sys.stderr,flush=True)
elif a[0]=='sts':
 assert a[1]=='GetCallerIdentity' and 'syntheticToken' in config.read_text()
 (p/'verification-started').touch()
 while not (p/'allow-verification').exists(): time.sleep(0.02)
 if (p/'fail-verification').exists():
  print('must-not-project-provider-details',file=sys.stderr);sys.exit(1)
 print(json.dumps(json.loads(config.read_text())['syntheticAccount']))
elif a[0]=='ecs':
 assert 'syntheticToken' in config.read_text()
 assert json.loads(config.read_text())['syntheticAccount']['AccountId']=='1000000000008819'
 assert config.parent.name==a[a.index('--profile')+1]
 if a[1]=='DescribeLaunchTemplates':
  print(json.dumps({'LaunchTemplateSets':{'LaunchTemplateSet':[]},'TotalCount':0,'PageNumber':1}))
 elif a[1]=='DescribeInstances':
  assert (p/'unknown-recovery-enabled').exists()
  assert a[a.index('--Tag.1.Key')+1]=='lime-operation'
  assert a[a.index('--Tag.1.Value')+1]=='purchase-original'
  assert a[a.index('--region')+1]=='cn-test'
  assert '--InstanceIds' not in a
  print(json.dumps({'Instances':{'Instance':[]},'TotalCount':0}))
 else: raise AssertionError('unexpected ECS request')
else: raise AssertionError('unexpected provider request')
"#;

fn binary() -> PathBuf {
    std::env::var_os("APP_SERVER_BIN")
        .map(PathBuf::from)
        .unwrap_or_else(|| Path::new(env!("CARGO_BIN_EXE_app-server")).to_path_buf())
}

fn fixture() -> tempfile::TempDir {
    let root = tempfile::tempdir().unwrap();
    std::fs::write(root.path().join("config.yaml"), "{}").unwrap();
    let tools = root.path().join("app/tools");
    std::fs::create_dir_all(&tools).unwrap();
    let cli = tools.join("aliyun");
    std::fs::write(&cli, CLI).unwrap();
    std::fs::set_permissions(&cli, std::fs::Permissions::from_mode(0o700)).unwrap();
    std::fs::write(
        tools.join("identity.json"),
        json!({"AccountId":"1000000000008819","Arn":"must-not-project-arn","UserId":"must-not-project-user"}).to_string(),
    )
    .unwrap();
    root
}

async fn start(root: &Path, name: &str) -> TransportClient {
    // If the fixture version probe fails, the official downloader must fail
    // closed rather than install a real CLI or open an actual OAuth browser.
    let environment: Vec<(String, String)> = [
        "HTTPS_PROXY",
        "https_proxy",
        "HTTP_PROXY",
        "http_proxy",
        "ALL_PROXY",
        "all_proxy",
    ]
    .into_iter()
    .map(|name| (name.into(), "http://127.0.0.1:9".into()))
    .chain([
        ("NO_PROXY".into(), "".into()),
        ("no_proxy".into(), "".into()),
    ])
    .collect();
    TransportClient::start_stdio_with_env(&binary(), root, name, &environment).await
}

async fn request(peer: &mut TransportClient, params: Value) -> Value {
    peer.request_ok(20, "cloud/desktop", params).await["result"]["data"].clone()
}

async fn read(peer: &mut TransportClient) -> Value {
    request(peer, json!({"action":"readAlibabaConnection"})).await
}

async fn wait_status(peer: &mut TransportClient, expected: &str) -> Value {
    let mut last = Value::Null;
    tokio::time::timeout(Duration::from_secs(30), async {
        loop {
            let state = read(peer).await;
            if state["status"] == expected {
                break state;
            }
            assert_ne!(
                state["status"], "failed",
                "expected authorization status {expected}, actual: {state}"
            );
            last = state;
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    })
    .await
    .unwrap_or_else(|_| panic!("expected authorization status {expected}, last state: {last}"))
}

fn assert_masked(value: &Value) {
    let projected = value.to_string();
    for forbidden in [
        "1000000000008819",
        "2000000000007728",
        "must-not-project",
        "syntheticToken",
    ] {
        assert!(
            !projected.contains(forbidden),
            "private identity must not be projected"
        );
    }
}

#[tokio::test]
async fn stdio_verified_identity_survives_restart_and_switch_keeps_the_original_profile_usable() {
    let root = fixture();
    let tools = root.path().join("app/tools");
    let mut peer = start(root.path(), "alibaba-identity").await;
    assert_eq!(read(&mut peer).await, json!({"status":"disconnected"}));
    let pending = request(
        &mut peer,
        json!({"action":"connectAlibaba","regionId":"cn-test"}),
    )
    .await;
    assert_eq!(pending["status"], "preparing");
    assert!(pending.get("accountIdSuffix").is_none());
    let verifying = wait_status(&mut peer, "verifying").await;
    assert!(verifying.get("accountIdSuffix").is_none());
    assert_masked(&verifying);
    std::fs::write(tools.join("allow-verification"), "").unwrap();
    let first = wait_status(&mut peer, "connected").await;
    assert_eq!(first["accountIdSuffix"], "8819");
    assert_masked(&first);
    let first_profile = first["profile"].as_str().unwrap().to_owned();
    let metadata = root.path().join("app/cloud-desktops/auth");
    for file in [
        metadata.join("active.json"),
        metadata.join(&first_profile).join("connection.json"),
    ] {
        let saved: Value = serde_json::from_slice(&std::fs::read(file).unwrap()).unwrap();
        assert_eq!(saved, first);
        assert_masked(&saved);
    }
    peer.shutdown().await;
    let calls_before = std::fs::read(tools.join("calls")).unwrap();
    let mut peer = start(root.path(), "alibaba-identity-restart").await;
    assert_eq!(read(&mut peer).await, first);
    assert_eq!(std::fs::read(tools.join("calls")).unwrap(), calls_before);

    std::fs::write(
        tools.join("identity.json"),
        json!({"AccountId":"2000000000007728"}).to_string(),
    )
    .unwrap();
    let switching = request(
        &mut peer,
        json!({"action":"connectAlibaba","regionId":"cn-other"}),
    )
    .await;
    assert_ne!(switching["profile"], first["profile"]);
    assert!(switching.get("accountIdSuffix").is_none());
    let second = wait_status(&mut peer, "connected").await;
    assert_eq!(second["accountIdSuffix"], "7728");
    assert!(!second.to_string().contains("8819"));
    assert_masked(&second);
    assert_eq!(
        request(
            &mut peer,
            json!({"action":"listEcsTemplates","regionId":"cn-test","profile":first_profile})
        )
        .await,
        json!({"templates":[]})
    );
    let calls: Vec<Vec<String>> = std::fs::read_to_string(tools.join("calls"))
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    assert_eq!(
        calls.iter().filter(|args| args[0] == "configure").count(),
        2
    );
    assert_eq!(calls.iter().filter(|args| args[0] == "sts").count(), 2);
    assert_eq!(calls.iter().filter(|args| args[0] == "ecs").count(), 1);
    assert!(calls
        .iter()
        .all(|args| matches!(args[0].as_str(), "configure" | "sts" | "ecs")));
    assert_eq!(
        request(&mut peer, json!({"action":"listResources"})).await,
        json!({"resources":[],"operations":[]})
    );
    peer.shutdown().await;
}

#[tokio::test]
async fn stdio_failed_verification_is_redacted_and_explicit_retry_reuses_the_original_authorization(
) {
    let root = fixture();
    let tools = root.path().join("app/tools");
    std::fs::write(tools.join("allow-verification"), "").unwrap();
    std::fs::write(tools.join("fail-verification"), "").unwrap();
    let mut peer = start(root.path(), "alibaba-verification-retry").await;
    let pending = request(
        &mut peer,
        json!({"action":"connectAlibaba","regionId":"cn-test"}),
    )
    .await;
    let failed = wait_status(&mut peer, "failed").await;
    assert_eq!(failed["errorCode"], "verificationFailed");
    assert!(failed.get("accountIdSuffix").is_none());
    assert_masked(&failed);
    peer.shutdown().await;

    let before = std::fs::read(tools.join("calls")).unwrap();
    let mut peer = start(root.path(), "alibaba-verification-retry-restart").await;
    assert_eq!(read(&mut peer).await, failed);
    assert_eq!(std::fs::read(tools.join("calls")).unwrap(), before);
    std::fs::remove_file(tools.join("fail-verification")).unwrap();
    let retry = request(
        &mut peer,
        json!({"action":"connectAlibaba","regionId":"cn-test"}),
    )
    .await;
    assert_eq!(retry["status"], "verifying");
    assert_eq!(retry["profile"], pending["profile"]);
    let connected = wait_status(&mut peer, "connected").await;
    assert_eq!(connected["accountIdSuffix"], "8819");
    assert_masked(&connected);
    let calls: Vec<Vec<String>> = std::fs::read_to_string(tools.join("calls"))
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    assert_eq!(
        calls.iter().filter(|args| args[0] == "configure").count(),
        1
    );
    assert_eq!(calls.iter().filter(|args| args[0] == "sts").count(), 2);
    assert_eq!(calls.len(), 3);
    peer.shutdown().await;
}

#[tokio::test]
async fn stdio_old_metadata_and_unknown_receipt_are_read_only_and_do_not_start_authorization() {
    let root = fixture();
    let auth = root.path().join("app/cloud-desktops/auth");
    let profile = format!("lime-oauth-{}", "a".repeat(32));
    let directory = auth.join(&profile);
    std::fs::create_dir_all(&directory).unwrap();
    for p in [
        auth.parent().unwrap().to_path_buf(),
        auth.clone(),
        directory.clone(),
    ] {
        std::fs::set_permissions(p, std::fs::Permissions::from_mode(0o700)).unwrap();
    }
    let old = json!({"profile":profile,"regionId":"cn-test","status":"connected","errorCode":null});
    for file in [auth.join("active.json"), directory.join("connection.json")] {
        std::fs::write(&file, old.to_string()).unwrap();
        std::fs::set_permissions(file, std::fs::Permissions::from_mode(0o600)).unwrap();
    }
    let config = directory.join("aliyun.json");
    std::fs::write(
        &config,
        r#"{"syntheticToken":"must-not-project-refresh-token"}"#,
    )
    .unwrap();
    std::fs::set_permissions(&config, std::fs::Permissions::from_mode(0o600)).unwrap();
    // An unrelated original unknown receipt must remain byte-for-byte untouched.
    let receipt = root.path().join("app/cloud-desktops/original-unknown.json");
    let unknown = br#"{"outcome":"unknown","requiresInspection":true}"#;
    std::fs::write(&receipt, unknown).unwrap();
    std::fs::set_permissions(&receipt, std::fs::Permissions::from_mode(0o600)).unwrap();
    let mut peer = start(root.path(), "alibaba-legacy").await;
    assert_eq!(read(&mut peer).await, old);
    assert_eq!(read(&mut peer).await, old);
    assert!(!root.path().join("app/tools/calls").exists());
    assert_eq!(std::fs::read(&receipt).unwrap(), unknown);
    assert_eq!(
        serde_json::from_slice::<Value>(&std::fs::read(auth.join("active.json")).unwrap()).unwrap(),
        old
    );
    peer.shutdown().await;
}

#[tokio::test]
async fn stdio_account_switch_preserves_unknown_purchase_and_recovery_uses_original_profile() {
    let root = fixture();
    let tools = root.path().join("app/tools");
    std::fs::write(tools.join("allow-verification"), "").unwrap();
    std::fs::write(tools.join("unknown-recovery-enabled"), "").unwrap();
    let mut peer = start(root.path(), "alibaba-original-purchase").await;
    request(
        &mut peer,
        json!({"action":"connectAlibaba","regionId":"cn-test"}),
    )
    .await;
    let first = wait_status(&mut peer, "connected").await;
    let original_profile = first["profile"].as_str().unwrap();
    let quote_id = "a".repeat(64);
    let original = json!({"action":"purchaseEcs","desktopName":"Lime-original",
        "quoteId":quote_id,"spec":{"regionId":"cn-test","profile":original_profile,
        "vSwitchId":"vsw-test","securityGroupId":"sg-test","keyPairName":"",
        "instanceType":"ecs.test.large","imageId":"ubuntu-test","systemDiskGib":80,
        "outboundMbps":5}});
    // Seed a valid durable receipt, then exercise public recovery and replay.
    // No provider purchase is submitted by this fixture.
    let receipt = json!({"operationId":"purchase-original","request":original,
        "requestSha256":format!("{:x}",Sha256::digest(serde_json::to_vec(&original).unwrap())),
        "createdAt":chrono::Utc::now().to_rfc3339(),"outcome":"unknown",
        "requiresInspection":true});
    let receipt_path = root
        .path()
        .join("app/cloud-desktops/purchase-original.json");
    let receipt_bytes = serde_json::to_vec(&receipt).unwrap();
    std::fs::write(&receipt_path, &receipt_bytes).unwrap();
    std::fs::set_permissions(&receipt_path, std::fs::Permissions::from_mode(0o600)).unwrap();
    peer.shutdown().await;

    std::fs::write(
        tools.join("identity.json"),
        json!({"AccountId":"2000000000007728"}).to_string(),
    )
    .unwrap();
    let mut peer = start(root.path(), "alibaba-switch-with-unknown").await;
    assert_eq!(read(&mut peer).await, first);
    request(
        &mut peer,
        json!({"action":"connectAlibaba","regionId":"cn-other"}),
    )
    .await;
    let second = wait_status(&mut peer, "connected").await;
    assert_eq!(second["accountIdSuffix"], "7728");
    assert_ne!(second["profile"], first["profile"]);
    assert_eq!(std::fs::read(&receipt_path).unwrap(), receipt_bytes);
    let recovered = request(
        &mut peer,
        json!({"action":"readOperation","operationId":"purchase-original"}),
    )
    .await;
    assert_eq!(recovered, receipt);
    assert_masked(&recovered);
    assert_eq!(read(&mut peer).await, second);

    let calls_before_replay = std::fs::read(tools.join("calls")).unwrap();
    let mut replay = original.clone();
    replay["operationId"] = json!("purchase-original");
    replay["confirmation"] = json!(format!("purchase:ecs:cn-test:Lime-original:{quote_id}"));
    assert_eq!(request(&mut peer, replay).await, receipt);
    assert_eq!(
        std::fs::read(tools.join("calls")).unwrap(),
        calls_before_replay
    );
    assert_eq!(std::fs::read(&receipt_path).unwrap(), receipt_bytes);
    let calls: Vec<Vec<String>> = std::fs::read_to_string(tools.join("calls"))
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    assert_eq!(
        calls
            .iter()
            .map(|args| args[0].as_str())
            .collect::<Vec<_>>(),
        vec!["configure", "sts", "configure", "sts", "ecs"]
    );
    let inspect = calls.last().unwrap();
    assert_eq!(inspect[1], "DescribeInstances");
    let profile_index = inspect.iter().position(|arg| arg == "--profile").unwrap();
    assert_eq!(inspect[profile_index + 1], original_profile);
    peer.shutdown().await;
}
