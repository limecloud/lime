use super::*;
use std::os::unix::fs::{symlink, PermissionsExt};

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
 assert sys.stdin.read()==''
 print('must-not-project-refresh-token',flush=True)
 print('must-not-project-refresh-token',file=sys.stderr,flush=True)
 while not (root/'finish').exists(): time.sleep(0.02)
 if (root/'fail').exists(): sys.exit(1)
 config.write_text('{"syntheticToken":"must-not-project-refresh-token"}')
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
