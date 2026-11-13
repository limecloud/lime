use super::*;

fn params() -> LoginAccountParams {
    LoginAccountParams::Cloud {
        resource: CloudResource::Default,
        language: "zh-CN".into(),
        installation: None,
    }
}

#[tokio::test]
async fn user_configuration_is_optional_live_and_invalid_configuration_fails_closed() {
    let root = tempfile::tempdir().unwrap();
    let config = root.path().join("config.yaml");
    let manager = AccountManager::new(root.path(), &config);
    assert_eq!(manager.read(Default::default()).unwrap().service_url, None);
    assert!(!config.exists());
    assert_eq!(
        manager.login(params()).await.unwrap_err(),
        "account_service_unconfigured"
    );
    std::fs::write(&config, "cloud:\n  base_url: https://core.example.test/\n").unwrap();
    assert_eq!(
        manager
            .read(Default::default())
            .unwrap()
            .service_url
            .as_deref(),
        Some("https://core.example.test")
    );
    std::fs::write(
        &config,
        "cloud:\n  base_url: http://untrusted.example.test\n",
    )
    .unwrap();
    assert_eq!(
        manager
            .read(Default::default())
            .unwrap()
            .service_error
            .as_deref(),
        Some("account_config_invalid")
    );
    assert_eq!(
        manager.login(params()).await.unwrap_err(),
        "account_config_invalid"
    );
}

#[tokio::test]
async fn pending_login_remains_bound_across_configuration_changes_and_restart() {
    let f = Fixture::start().await;
    let root = tempfile::tempdir().unwrap();
    let config = root.path().join("config.yaml");
    let manager = AccountManager::new(root.path(), &config);
    f.configure(&manager);
    let LoginAccountResponse::Cloud { authorization, .. } = manager.login(params()).await.unwrap();
    std::fs::write(
        &config,
        "cloud:\n  base_url: https://replacement.example.test\n",
    )
    .unwrap();
    for (status, error) in [
        (
            AccountAuthorizationStatus::Pending,
            "authorization_in_progress",
        ),
        (AccountAuthorizationStatus::Exchanging, "outcome_unknown"),
        (
            AccountAuthorizationStatus::OutcomeUnknown,
            "outcome_unknown",
        ),
    ] {
        store::update(&manager.path, |s| {
            s.authorizations
                .get_mut(&CloudResource::Default)
                .unwrap()
                .public
                .status = status;
            Ok(())
        })
        .unwrap();
        let cold = AccountManager::new(root.path(), &config);
        let read = cold.read(Default::default()).unwrap();
        assert_eq!(read.service_url.as_deref(), Some(f.base.as_str()));
        assert_eq!(read.authorizations[0].id, authorization.id);
        assert_eq!(cold.login(params()).await.unwrap_err(), error);
    }
    assert_eq!(f.count("/auth/config"), 1);
    manager.logout().unwrap();
    assert_eq!(
        manager
            .read(Default::default())
            .unwrap()
            .service_url
            .as_deref(),
        Some("https://replacement.example.test")
    );
}

#[tokio::test]
async fn logged_in_account_and_resources_use_bound_service_until_logout() {
    let f = Fixture::start().await;
    let root = tempfile::tempdir().unwrap();
    let config = root.path().join("config.yaml");
    let manager = AccountManager::new(root.path(), &config);
    f.login(&manager, CloudResource::Default).await;
    let replacement = "https://replacement.example.test";
    std::fs::write(
        &config,
        json!({"cloud":{"base_url":replacement}}).to_string(),
    )
    .unwrap();
    let cold = AccountManager::new(root.path(), &config);
    let LoginAccountResponse::Cloud { authorization, .. } = cold
        .login(LoginAccountParams::Cloud {
            resource: CloudResource::Web,
            language: "en-US".into(),
            installation: None,
        })
        .await
        .unwrap();
    assert_eq!(
        store::load(&cold.path).unwrap().authorizations[&CloudResource::Web].base_url,
        f.base
    );
    let read = cold.read(Default::default()).unwrap();
    assert_eq!(read.service_url.as_deref(), Some(f.base.as_str()));
    assert_eq!(
        read.authorizations
            .iter()
            .find(|a| a.id == authorization.id)
            .unwrap()
            .resource,
        CloudResource::Web
    );
    // A malformed replacement cannot hide the existing identity or block logout.
    std::fs::write(&config, "cloud: [invalid]\n").unwrap();
    assert!(cold.read(Default::default()).unwrap().account.is_some());
    cold.logout().unwrap();
    assert_eq!(
        cold.read(Default::default())
            .unwrap()
            .service_error
            .as_deref(),
        Some("account_config_invalid")
    );
}
