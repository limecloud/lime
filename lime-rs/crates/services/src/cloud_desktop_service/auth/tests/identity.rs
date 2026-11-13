use super::*;

#[tokio::test]
async fn verified_account_is_masked_persisted_and_replaced_without_losing_the_original_profile() {
    let (directory, service) = fixture();
    fs::write(directory.path().join("finish"), "").unwrap();
    let identity = directory.path().join("identity.json");
    fs::write(
        &identity,
        json!({"AccountId":"1000000000008819","Arn":"must-not-project-arn","UserId":"must-not-project-user"}).to_string(),
    )
    .unwrap();
    let pending = service.connect_alibaba("cn-test").unwrap();
    assert!(pending.get("accountIdSuffix").is_none());
    let first = finish(&service).await;
    assert_eq!(first["status"], "connected");
    assert_eq!(first["accountIdSuffix"], "8819");
    assert_eq!(service.clone().read_alibaba_connection().unwrap(), first);
    let first_profile = first["profile"].as_str().unwrap();
    for path in [
        service.auth_directory("").unwrap().join("active.json"),
        service
            .auth_directory(first_profile)
            .unwrap()
            .join("connection.json"),
    ] {
        let metadata = fs::read_to_string(path).unwrap();
        assert!(!metadata.contains("1000000000008819"));
        assert!(!metadata.contains("must-not-project"));
        assert_eq!(serde_json::from_str::<Value>(&metadata).unwrap(), first);
    }
    fs::write(
        &identity,
        json!({"AccountId":"2000000000007728"}).to_string(),
    )
    .unwrap();
    let switching = service.connect_alibaba("cn-other").unwrap();
    assert_ne!(switching["profile"], first["profile"]);
    assert!(switching.get("accountIdSuffix").is_none());
    let second = finish(&service).await;
    assert_eq!(second["status"], "connected");
    assert_eq!(second["accountIdSuffix"], "7728");
    assert!(!second.to_string().contains("8819"));
    assert!(service.alibaba_config(first_profile).unwrap().is_some());
    assert_eq!(service.list_resources().unwrap()["operations"], json!([]));
}

#[tokio::test]
async fn old_metadata_remains_usable_without_fabricating_an_account_or_restarting_oauth() {
    let (directory, service) = fixture();
    fs::write(directory.path().join("finish"), "").unwrap();
    service.connect_alibaba("cn-test").unwrap();
    let mut old = finish(&service).await;
    old.as_object_mut().unwrap().remove("accountIdSuffix");
    let profile = old["profile"].as_str().unwrap();
    for path in [
        service.auth_directory("").unwrap().join("active.json"),
        service
            .auth_directory(profile)
            .unwrap()
            .join("connection.json"),
    ] {
        fs::write(path, serde_json::to_vec(&old).unwrap()).unwrap();
    }
    let calls = directory.path().join("calls");
    let before = fs::read(&calls).unwrap();
    assert_eq!(service.clone().read_alibaba_connection().unwrap(), old);
    assert!(service.alibaba_config(profile).unwrap().is_some());
    assert_eq!(fs::read(calls).unwrap(), before);
}

#[tokio::test]
async fn malformed_persisted_suffixes_cannot_reach_the_renderer() {
    for suffix in ["1000000000008819", "8819\n", "secret", "１２３４", ""] {
        let (_directory, service) = fixture();
        let metadata = json!({
            "profile":format!("{PROFILE_PREFIX}{}", "a".repeat(32)),
            "regionId":"cn-test", "status":"failed", "errorCode":"authorizationFailed",
            "accountIdSuffix":suffix,
        });
        let path = service.auth_directory("").unwrap().join("active.json");
        fs::write(path, metadata.to_string()).unwrap();
        assert!(service.read_alibaba_connection().is_err());
    }
}

#[tokio::test]
async fn very_short_account_identifiers_are_never_projected_in_full() {
    let (directory, service) = fixture();
    fs::write(directory.path().join("finish"), "").unwrap();
    fs::write(
        directory.path().join("identity.json"),
        r#"{"AccountId":"1234"}"#,
    )
    .unwrap();
    service.connect_alibaba("cn-test").unwrap();
    let state = finish(&service).await;
    assert_eq!(state["status"], "connected");
    assert!(state.get("accountIdSuffix").is_none());
    assert!(!state.to_string().contains("1234"));
}
