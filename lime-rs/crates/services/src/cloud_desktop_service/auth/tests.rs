use super::*;
use std::os::unix::fs::{symlink, PermissionsExt};

mod identity;

fn fixture() -> (tempfile::TempDir, CloudDesktopService) {
    let directory = tempfile::tempdir().unwrap();
    let cli = directory.path().join("aliyun");
    fs::write(
        &cli,
        r#"#!/usr/bin/env python3
import json, pathlib, sys, time
root=pathlib.Path(__file__).parent
args=sys.argv[1:]
if args==['version']: print('3.5.2'); sys.exit(0)
with (root/'calls').open('a') as f: f.write(json.dumps(args)+'\n')
config=pathlib.Path(args[args.index('--config-path')+1])
assert config.is_file() and config.stat().st_mode & 0o077 == 0
if args[0]=='configure':
 assert args[args.index('--mode')+1]=='OAuth'
 assert args[args.index('--oauth-site-type')+1]=='CN'
 assert sys.stdin.read()==''
 print('must-not-project-refresh-token',flush=True)
 print('must-not-project-refresh-token',file=sys.stderr,flush=True)
 while not (root/'finish').exists(): time.sleep(0.02)
 if (root/'fail').exists(): sys.exit(1)
 config.write_text('{"syntheticToken":"must-not-project-refresh-token"}')
elif args[0]=='sts':
 assert args[1]=='GetCallerIdentity' and 'syntheticToken' in config.read_text()
 assert '--RegionId' not in args
 (root/'verification-started').write_text('')
 while (root/'hold-verification').exists() and not (root/'allow-verification').exists(): time.sleep(0.02)
 if (root/'fail-verification').exists():
  print('must-not-project-provider-details',file=sys.stderr); sys.exit(1)
 identity=root/'identity.json'
 print(identity.read_text() if identity.exists() else json.dumps({'AccountId':'1000000000000000'}))
else:
 assert 'syntheticToken' in config.read_text()
 assert args[args.index('--region')+1] == args[args.index('--RegionId')+1]
 print(json.dumps({'LaunchTemplateSets':{'LaunchTemplateSet':[]},'TotalCount':0,'PageNumber':1}))
"#,
    )
    .unwrap();
    fs::set_permissions(&cli, fs::Permissions::from_mode(0o700)).unwrap();
    let service = CloudDesktopService {
        root: directory.path().join("cloud-desktops"),
        cli,
    };
    (directory, service)
}

async fn finish(service: &CloudDesktopService) -> Value {
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            let state = service.read_alibaba_connection().unwrap();
            if ["connected", "failed"].contains(&state["status"].as_str().unwrap()) {
                return state;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .unwrap()
}

#[tokio::test]
async fn authorization_is_leased_survives_service_recreation_and_isolates_credentials() {
    let (directory, service) = fixture();
    assert_eq!(
        service.read_alibaba_connection().unwrap()["status"],
        "disconnected"
    );
    let pending = service.connect_alibaba("cn-test").unwrap();
    assert_eq!(pending["status"], "preparing");
    let replay = service.clone().connect_alibaba("cn-other").unwrap();
    assert_eq!(pending["profile"], replay["profile"]);
    fs::write(directory.path().join("finish"), "").unwrap();
    let state = finish(&service).await;
    assert_eq!(state["status"], "connected");
    assert!(!state.to_string().contains("must-not-project"));
    let restarted = service.clone();
    assert_eq!(restarted.read_alibaba_connection().unwrap(), state);
    let profile = state["profile"].as_str().unwrap();
    let templates = restarted
        .list_ecs_templates("cn-test", profile)
        .await
        .unwrap();
    assert_eq!(templates, json!({"templates":[]}));
    let calls = fs::read_to_string(directory.path().join("calls")).unwrap();
    let calls: Vec<Vec<String>> = calls
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    assert_eq!(
        calls.iter().filter(|args| args[0] == "configure").count(),
        1
    );
    for args in calls {
        let index = args.iter().position(|arg| arg == "--config-path").unwrap();
        assert_eq!(
            Path::new(&args[index + 1]),
            service.root.join("auth").join(profile).join("aliyun.json")
        );
    }
    assert_eq!(service.list_resources().unwrap()["operations"], json!([]));
}

#[tokio::test]
async fn failed_login_has_only_a_fixed_error_and_can_start_a_new_attempt() {
    let (directory, service) = fixture();
    fs::write(directory.path().join("fail"), "").unwrap();
    fs::write(directory.path().join("finish"), "").unwrap();
    let pending = service.connect_alibaba("cn-test").unwrap();
    let failed = finish(&service).await;
    assert_eq!(failed["status"], "failed");
    assert_eq!(failed["errorCode"], "authorizationFailed");
    assert!(!failed.to_string().contains("must-not-project"));
    assert!(service
        .alibaba_config(pending["profile"].as_str().unwrap())
        .is_err());
    let retry = service.connect_alibaba("cn-test").unwrap();
    assert_ne!(pending["profile"], retry["profile"]);
    finish(&service).await;
}

#[tokio::test]
async fn abandoned_login_is_interrupted_and_does_not_restart_on_read() {
    let (_directory, service) = fixture();
    let state = Connection {
        profile: format!("{PROFILE_PREFIX}{}", uuid::Uuid::new_v4().simple()),
        region_id: "cn-test".into(),
        status: "authorizing".into(),
        error_code: None,
        account_id_suffix: None,
    };
    let path = service.auth_directory("").unwrap().join("active.json");
    service.write_connection_file(&path, &state).unwrap();
    let observed = service.read_alibaba_connection().unwrap();
    assert_eq!(observed["status"], "failed");
    assert_eq!(observed["errorCode"], "interrupted");
    assert!(!service.cli.parent().unwrap().join("calls").exists());
}

#[tokio::test]
async fn managed_profiles_require_their_own_private_completed_authorization() {
    let (directory, service) = fixture();
    assert!(service
        .alibaba_config("ordinary-user-profile")
        .unwrap()
        .is_none());
    assert!(service.alibaba_config("lime-oauth-../outside").is_err());
    assert!(service
        .alibaba_config(&format!(
            "{PROFILE_PREFIX}{}",
            uuid::Uuid::new_v4().simple()
        ))
        .is_err());
    fs::write(directory.path().join("finish"), "").unwrap();
    service.connect_alibaba("cn-test").unwrap();
    let state = finish(&service).await;
    let profile = state["profile"].as_str().unwrap();
    let config = service.alibaba_config(profile).unwrap().unwrap();
    let moved = config.with_extension("preserved");
    fs::rename(&config, &moved).unwrap();
    assert!(service.alibaba_config(profile).is_err());
    assert!(!config.exists());
    symlink(&moved, &config).unwrap();
    assert!(service.alibaba_config(profile).is_err());
}

#[tokio::test]
async fn an_existing_service_uses_the_cli_installed_after_it_was_created() {
    let (directory, service) = fixture();
    fs::write(directory.path().join("finish"), "").unwrap();
    service.connect_alibaba("cn-test").unwrap();
    let connected = finish(&service).await;
    let stale = CloudDesktopService {
        root: service.root.clone(),
        cli: directory.path().join("not-installed-yet"),
    };
    let installed = cli::installed_path(&stale.root);
    fs::create_dir_all(installed.parent().unwrap()).unwrap();
    fs::set_permissions(
        installed.parent().unwrap(),
        fs::Permissions::from_mode(0o700),
    )
    .unwrap();
    fs::copy(&service.cli, &installed).unwrap();
    let templates = stale
        .list_ecs_templates("cn-test", connected["profile"].as_str().unwrap())
        .await
        .expect("the same service must use the newly installed official CLI");
    assert_eq!(templates, json!({"templates":[]}));
    assert_eq!(cli::ensure_available(&stale).await.unwrap(), installed);
    assert!(!stale.cli.exists());
}

#[tokio::test]
async fn a_successful_browser_login_is_verified_before_becoming_connected() {
    let (directory, service) = fixture();
    fs::write(directory.path().join("finish"), "").unwrap();
    fs::write(directory.path().join("hold-verification"), "").unwrap();
    service.connect_alibaba("cn-test").unwrap();
    let verifying = tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            let value = service.read_alibaba_connection().unwrap();
            assert_ne!(
                value["status"], "connected",
                "OAuth completion alone is not connection readiness"
            );
            if value["status"] == "verifying" {
                break value;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .unwrap();
    assert!(!verifying.to_string().contains("syntheticToken"));
    assert!(
        service
            .alibaba_config(verifying["profile"].as_str().unwrap())
            .is_err(),
        "ordinary cloud operations must wait for verified connectivity"
    );
    fs::write(directory.path().join("allow-verification"), "").unwrap();
    let connected = finish(&service).await;
    assert_eq!(connected["status"], "connected");
    assert!(!connected.to_string().contains("1000000000000000"));
    assert!(directory.path().join("verification-started").is_file());
}

#[tokio::test]
async fn explicit_verification_retry_reuses_the_completed_browser_authorization() {
    let (directory, service) = fixture();
    fs::write(directory.path().join("finish"), "").unwrap();
    fs::write(directory.path().join("fail-verification"), "").unwrap();
    let original = service.connect_alibaba("cn-test").unwrap();
    let failed = finish(&service).await;
    assert_eq!(failed["status"], "failed");
    assert_eq!(failed["errorCode"], "verificationFailed");
    assert!(!failed.to_string().contains("must-not-project"));
    fs::remove_file(directory.path().join("fail-verification")).unwrap();
    let retry = service.connect_alibaba("cn-test").unwrap();
    assert_eq!(retry["status"], "verifying");
    assert_eq!(retry["profile"], original["profile"]);
    assert_eq!(finish(&service).await["status"], "connected");
    let calls: Vec<Vec<String>> = fs::read_to_string(directory.path().join("calls"))
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    assert_eq!(
        calls.iter().filter(|args| args[0] == "configure").count(),
        1
    );
    assert_eq!(calls.iter().filter(|args| args[0] == "sts").count(), 2);
}

#[tokio::test]
async fn interrupted_verification_is_read_only_until_explicitly_resumed() {
    let (directory, service) = fixture();
    let state = Connection {
        profile: format!("{PROFILE_PREFIX}{}", uuid::Uuid::new_v4().simple()),
        region_id: "cn-test".into(),
        status: "verifying".into(),
        error_code: None,
        account_id_suffix: None,
    };
    let config = service
        .auth_directory(&state.profile)
        .unwrap()
        .join("aliyun.json");
    private_open(&config, true)
        .unwrap()
        .write_all(b"{\"syntheticToken\":\"must-not-project-refresh-token\"}")
        .unwrap();
    service
        .write_connection_file(
            &service.auth_directory("").unwrap().join("active.json"),
            &state,
        )
        .unwrap();
    for _ in 0..2 {
        let observed = service.clone().read_alibaba_connection().unwrap();
        assert_eq!(observed["status"], "failed");
        assert_eq!(observed["errorCode"], "verificationInterrupted");
    }
    assert!(!directory.path().join("calls").exists());
    let resumed = service.connect_alibaba("cn-test").unwrap();
    assert_eq!(resumed["profile"], state.profile);
    assert_eq!(resumed["status"], "verifying");
    assert_eq!(finish(&service).await["status"], "connected");
    let calls = fs::read_to_string(directory.path().join("calls")).unwrap();
    let calls: Vec<Vec<String>> = calls
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0][0], "sts");
}

#[tokio::test]
async fn successful_sts_without_a_valid_account_does_not_connect() {
    for account in [json!(null), json!(123), json!(""), json!(" "), json!("abc")] {
        let (directory, service) = fixture();
        fs::write(directory.path().join("finish"), "").unwrap();
        fs::write(
            directory.path().join("identity.json"),
            json!({"AccountId":account}).to_string(),
        )
        .unwrap();
        let pending = service.connect_alibaba("cn-test").unwrap();
        let failed = finish(&service).await;
        assert_eq!(failed["status"], "failed", "invalid account: {account}");
        assert_eq!(failed["errorCode"], "verificationFailed");
        assert!(service
            .alibaba_config(pending["profile"].as_str().unwrap())
            .is_err());
    }
}

#[tokio::test]
async fn lost_authorization_does_not_create_an_empty_config_and_loop_verification() {
    let (directory, service) = fixture();
    fs::write(directory.path().join("finish"), "").unwrap();
    fs::write(directory.path().join("fail-verification"), "").unwrap();
    let original = service.connect_alibaba("cn-test").unwrap();
    assert_eq!(finish(&service).await["errorCode"], "verificationFailed");
    let missing = service
        .root
        .join("auth")
        .join(original["profile"].as_str().unwrap())
        .join("aliyun.json");
    fs::remove_file(&missing).unwrap();
    fs::remove_file(directory.path().join("fail-verification")).unwrap();
    let retry = service.connect_alibaba("cn-test").unwrap();
    assert_eq!(retry["status"], "preparing");
    assert_ne!(retry["profile"], original["profile"]);
    assert!(
        !missing.exists(),
        "resuming must not fabricate an empty OAuth config"
    );
    assert_eq!(finish(&service).await["status"], "connected");
}
