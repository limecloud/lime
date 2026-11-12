use super::*;
use std::os::unix::fs::PermissionsExt;

fn profile() -> Value {
    json!({"name":"fixture", "mode":"OAuth", "sts_expiration":1000,
        "access_key_id":"synthetic-access", "access_key_secret":"synthetic-secret",
        "sts_token":"synthetic-sts", "refresh_token":"never-forward-refresh"})
}

#[test]
fn only_unique_unexpired_oauth_sts_is_accepted() {
    let valid = profile();
    let bytes = serde_json::to_vec(&json!({"profiles":[valid]})).unwrap();
    let identity = parse_credentials(&bytes, "fixture", 900).unwrap();
    assert_eq!(identity.token, "synthetic-sts");
    for (entries, name, now) in [
        (json!([profile(), profile()]), "fixture", 900),
        (json!([profile()]), "other", 900),
        (json!([profile()]), "fixture", 970),
    ] {
        let bytes = serde_json::to_vec(&json!({"profiles":entries})).unwrap();
        assert_eq!(
            parse_credentials(&bytes, name, now).err().unwrap(),
            "OSS_AUTHORIZATION_FAILED"
        );
    }
    for (field, value) in [
        ("mode", json!("AK")),
        ("sts_token", Value::Null),
        ("access_key_secret", json!("secret\n")),
        ("sts_expiration", json!("1000")),
    ] {
        let mut entry = profile();
        entry[field] = value;
        let bytes = serde_json::to_vec(&json!({"profiles":[entry]})).unwrap();
        assert_eq!(
            parse_credentials(&bytes, "fixture", 900).err().unwrap(),
            "OSS_AUTHORIZATION_FAILED"
        );
    }
}

#[tokio::test]
async fn managed_connection_refreshes_with_sts_api_and_never_accepts_an_external_profile() {
    let root = tempfile::tempdir().unwrap();
    let program = root.path().join("aliyun");
    fs::write(
        &program,
        r#"#!/usr/bin/env python3
import json, pathlib, sys
args=sys.argv[1:]
assert args[0:2] == ['sts', 'GetCallerIdentity']
assert '--RegionId' not in args and args[args.index('--region')+1]=='cn-test'
assert not any('synthetic' in arg for arg in args)
print('{}')
"#,
    )
    .unwrap();
    fs::set_permissions(&program, fs::Permissions::from_mode(0o700)).unwrap();
    let service = CloudDesktopService {
        root: root.path().join("cloud"),
        cli: program,
    };
    assert_eq!(
        service
            .oss_credentials("external", "cn-test")
            .await
            .err()
            .unwrap(),
        "OSS_BROWSER_CONNECTION_REQUIRED"
    );
    let name = format!("lime-oauth-{}", uuid::Uuid::new_v4().simple());
    let directory = service.auth_directory(&name).unwrap();
    for (file, value) in [
        (
            "connection.json",
            json!({"profile":name,"regionId":"cn-test","status":"connected","errorCode":null}),
        ),
        ("aliyun.json", {
            let mut entry = profile();
            entry["name"] = json!(name);
            entry["sts_expiration"] = json!(chrono::Utc::now().timestamp() + 3600);
            json!({"profiles":[entry]})
        }),
    ] {
        let mut file = private_open(&directory.join(file), true).unwrap();
        file.write_all(&serde_json::to_vec(&value).unwrap())
            .unwrap();
    }
    assert_eq!(
        service
            .oss_credentials(&name, "cn-test")
            .await
            .unwrap()
            .access_key,
        "synthetic-access"
    );
    fs::set_permissions(
        directory.join("aliyun.json"),
        fs::Permissions::from_mode(0o644),
    )
    .unwrap();
    assert!(service.oss_credentials(&name, "cn-test").await.is_err());
}

fn script(root: &Path, body: &str) -> PathBuf {
    let file = root.join("transport");
    fs::write(&file, format!("#!/usr/bin/env python3\n{body}\n")).unwrap();
    fs::set_permissions(&file, fs::Permissions::from_mode(0o700)).unwrap();
    file
}

fn credentials() -> Credentials {
    parse_credentials(
        &serde_json::to_vec(&json!({"profiles":[profile()]})).unwrap(),
        "fixture",
        900,
    )
    .unwrap()
}

#[tokio::test]
async fn transport_delivers_only_short_lived_identity_in_environment_and_projects_names_only() {
    let root = tempfile::tempdir().unwrap();
    let file = script(
        root.path(),
        r#"import json, os, sys
assert not any('synthetic' in arg or 'refresh' in arg for arg in sys.argv)
assert os.environ['RCLONE_CONFIG_LIMEOSS_SESSION_TOKEN']=='synthetic-sts'
assert os.environ['RCLONE_CONFIG_LIMEOSS_ENDPOINT']=='https://oss-cn-test.aliyuncs.com'
assert os.environ['RCLONE_CONFIG_LIMEOSS_NO_CHECK_BUCKET']=='true'
assert os.environ['RCLONE_CONFIG_LIMEOSS_ACL']=='private'
assert 'HOME' not in os.environ and not any(key.startswith('AWS_') for key in os.environ)
assert not any('refresh' in value for value in os.environ.values())
assert sys.argv[sys.argv.index('--config')+1]=='/dev/null'
assert 'lsjson' in sys.argv and 'limeoss:' in sys.argv
print(json.dumps([{'Name':name,'Path':name,'IsDir':True,'ignored':'synthetic-secret'} for name in ['bucket-b','bucket-a','bucket-b']]))"#,
    );
    let result = list_buckets(
        transport_command(&file, "cn-test", credentials()).unwrap(),
        "cn-test",
    )
    .await
    .unwrap();
    assert_eq!(
        result,
        json!({"buckets":["bucket-a","bucket-b"],"regionId":"cn-test"})
    );
    assert!(!result.to_string().contains("synthetic"));
}

#[tokio::test]
async fn malformed_oversized_and_failed_listings_return_fixed_errors() {
    let root = tempfile::tempdir().unwrap();
    for body in [
        "print('invalid')",
        "print('x'*1048577)",
        "import sys; print('synthetic-secret',file=sys.stderr); sys.exit(1)",
        r#"print('[{"Name":"../outside","Path":"../outside","IsDir":true}]')"#,
        r#"print('[{"Name":"bucket-a","Path":"other","IsDir":true}]')"#,
    ] {
        let file = script(root.path(), body);
        let result = list_buckets(
            transport_command(&file, "cn-test", credentials()).unwrap(),
            "cn-test",
        )
        .await;
        assert_eq!(result.unwrap_err(), "OSS_LIST_FAILED");
    }
    for region in [
        "CN-test",
        "cn-test/evil",
        "cn-test.aliyuncs.com",
        "-cn-test",
    ] {
        assert!(transport_command(Path::new("missing"), region, credentials()).is_err());
    }
}

#[tokio::test]
async fn unsafe_bucket_or_object_never_requests_identity_or_installs_tools() {
    let root = tempfile::tempdir().unwrap();
    let service = CloudDesktopService {
        root: root.path().join("untouched"),
        cli: PathBuf::from("missing"),
    };
    for (bucket, key) in [
        ("a", "backup.age"),
        ("Bad-bucket", "backup.age"),
        ("bucket-a", "../escape.age"),
        ("bucket-a", "folder//file.age"),
        ("bucket-a", "/absolute.age"),
        ("bucket-a", "secret\n.age"),
        ("bucket-a", "data.txt"),
        ("bucket-a", "remote:key.age"),
    ] {
        assert!(service
            .transfer_oss_archive(
                "external",
                "cn-test",
                bucket,
                key,
                Path::new("/tmp/backup.age"),
                true,
                &"a".repeat(64)
            )
            .await
            .is_err());
    }
    assert!(!service.root.exists());
}
