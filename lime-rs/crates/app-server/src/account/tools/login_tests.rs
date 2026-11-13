use super::*;

#[tokio::test]
async fn first_task_logs_in_then_separately_authorizes_web_before_one_original_search() {
    let f = Fixture::start().await;
    let root = tempfile::tempdir().unwrap();
    let manager = AccountManager::new(root.path(), &root.path().join("config.yaml"));
    f.configure(&manager);
    f.state.lock().unwrap().web_response = Some(result());
    let server = crate::AppServer::new();
    let (mut outbound, _) = attach(&manager, &server).await;
    let host = async {
        for resource in ["default", "web"] {
            let request = next(&mut outbound).await;
            let params = request.params.unwrap();
            assert_eq!(params["authorization"]["resource"], resource);
            assert_eq!(f.count("/web/searches"), 0);
            assert_eq!(f.count("/product-users"), 0);
            let state = manager.read(Default::default()).unwrap();
            if resource == "default" {
                assert!(state.account.is_none());
            } else {
                let Account::Cloud { resources, .. } = state.account.unwrap();
                assert_eq!(resources.len(), 1);
                assert_eq!(resources[0].resource, CloudResource::Default);
            }
            server
                .resolve_transport_server_request_response(
                    ConnectionId(81),
                    request.id,
                    json!({"action":"opened"}),
                )
                .await;
            // Browser handoff itself grants no access.
            tokio::time::sleep(Duration::from_millis(25)).await;
            assert_eq!(f.count("/web/searches"), 0);
            callback(&f, &params, false).await;
        }
    };
    let (search, ()) = tokio::join!(search(&manager), host);
    let result = search.unwrap();
    assert!(result.success);
    assert_eq!(f.count("/auth/token"), 2);
    assert_eq!(f.count("/auth/config"), 2);
    assert_eq!(f.count("/web/searches"), 1);
    assert_eq!(f.count("/product-users"), 1);
    assert!(outbound.try_recv().is_err());
}

#[tokio::test]
async fn first_login_cancel_denial_unknown_logout_and_host_failure_never_dispatch_business() {
    for action in [
        "cancelled",
        "unavailable",
        "invalid",
        "denied",
        "unknown",
        "logout",
        "disconnect",
    ] {
        let f = Fixture::start().await;
        let root = tempfile::tempdir().unwrap();
        let manager = AccountManager::new(root.path(), &root.path().join("config.yaml"));
        f.configure(&manager);
        let server = crate::AppServer::new();
        let (mut outbound, disconnect) = attach(&manager, &server).await;
        let host = async {
            let request = next(&mut outbound).await;
            let params = request.params.unwrap();
            assert_eq!(params["authorization"]["resource"], "default");
            if action == "unknown" {
                store::update(&manager.path, |s| {
                    s.authorizations.get_mut(&CloudResource::Default).unwrap().public.status =
                        app_server_protocol::protocol::v2::AccountAuthorizationStatus::OutcomeUnknown;
                    Ok(())
                }).unwrap();
            }
            if action == "logout" {
                manager.logout().unwrap();
            }
            if action == "disconnect" {
                disconnect.cancel();
            }
            server.resolve_transport_server_request_response(ConnectionId(81), request.id,
                json!({"action":if matches!(action,"cancelled"|"unavailable"|"invalid") {action} else {"opened"}})).await;
            if action == "denied" {
                callback(&f, &params, true).await;
            }
        };
        let (result, ()) = tokio::join!(search(&manager), host);
        assert!(result.is_err(), "{action}");
        assert_eq!(f.count("/auth/token"), 0, "{action}");
        assert_eq!(f.count("/web/searches"), 0, "{action}");
        assert_eq!(f.count("/product-users"), 0, "{action}");
        if action == "unknown" {
            let error = search(&manager).await.unwrap_err();
            assert_eq!(error.message(), "outcome_unknown");
            assert_eq!(f.count("/auth/config"), 1);
            assert!(outbound.try_recv().is_err());
        }
    }
}

#[tokio::test]
async fn concurrent_anonymous_tasks_share_the_reserved_login_and_resource_authorization() {
    let f = Fixture::start().await;
    let root = tempfile::tempdir().unwrap();
    let manager = AccountManager::new(root.path(), &root.path().join("config.yaml"));
    f.configure(&manager);
    {
        let mut state = f.state.lock().unwrap();
        state.product_registered = true;
        state.web_response = Some(result());
    }
    let server = crate::AppServer::new();
    let (mut outbound, _) = attach(&manager, &server).await;
    let second_context = context().with_tool_identity(RuntimeToolExecutionIdentity::new(
        "other-search",
        "turn-web",
    ));
    let turn = live_thread();
    let params = json!({"query":"Lime release"});
    let second = manager.execute(RuntimeToolExecutionRequest {
        tool_name: "WebSearch",
        params: &params,
        context: &second_context,
        turn_context: Some(&turn),
    });
    let host = async {
        for resource in ["default", "web"] {
            let request = next(&mut outbound).await;
            let params = request.params.unwrap();
            assert_eq!(params["authorization"]["resource"], resource);
            server
                .resolve_transport_server_request_response(
                    ConnectionId(81),
                    request.id,
                    json!({"action":"opened"}),
                )
                .await;
            callback(&f, &params, false).await;
        }
    };
    let (first, second, ()) = tokio::join!(search(&manager), second, host);
    assert!(first.unwrap().success);
    assert!(second.unwrap().success);
    assert_eq!(f.count("/auth/config"), 2);
    assert_eq!(f.count("/auth/token"), 2);
    assert_eq!(f.count("/web/searches"), 2);
    assert!(outbound.try_recv().is_err());
}

#[tokio::test]
async fn cancelled_first_login_resumes_the_same_transaction_after_native_restart() {
    let f = Fixture::start().await;
    let root = tempfile::tempdir().unwrap();
    let config = root.path().join("config.yaml");
    let manager = AccountManager::new(root.path(), &config);
    f.configure(&manager);
    f.state.lock().unwrap().web_response = Some(result());
    let server = crate::AppServer::new();
    let (mut outbound, _) = attach(&manager, &server).await;
    let cancel = async {
        let request = next(&mut outbound).await;
        let params = request.params.unwrap();
        server
            .resolve_transport_server_request_response(
                ConnectionId(81),
                request.id,
                json!({"action":"cancelled"}),
            )
            .await;
        params
    };
    let (result, original) = tokio::join!(search(&manager), cancel);
    assert!(result.is_err());
    let cold = AccountManager::new(root.path(), &config);
    let second = crate::AppServer::new();
    let (mut outbound, _) = attach(&cold, &second).await;
    let host = async {
        let request = next(&mut outbound).await;
        let params = request.params.unwrap();
        assert_eq!(
            params["authorization"]["id"],
            original["authorization"]["id"]
        );
        assert_eq!(params["authUrl"], original["authUrl"]);
        second
            .resolve_transport_server_request_response(
                ConnectionId(81),
                request.id,
                json!({"action":"opened"}),
            )
            .await;
        callback(&f, &params, false).await;
        let request = next(&mut outbound).await;
        let params = request.params.unwrap();
        assert_eq!(params["authorization"]["resource"], "web");
        second
            .resolve_transport_server_request_response(
                ConnectionId(81),
                request.id,
                json!({"action":"opened"}),
            )
            .await;
        callback(&f, &params, false).await;
    };
    let (result, ()) = tokio::join!(search(&cold), host);
    assert!(result.unwrap().success);
    assert_eq!(f.count("/auth/config"), 2);
    assert_eq!(f.count("/auth/token"), 2);
    assert_eq!(f.count("/web/searches"), 1);
}

#[tokio::test]
async fn first_login_recovers_saved_exchange_before_requesting_another_browser_handoff() {
    let f = Fixture::start().await;
    let root = tempfile::tempdir().unwrap();
    let config = root.path().join("config.yaml");
    let manager = AccountManager::new(root.path(), &config);
    f.configure(&manager);
    {
        let mut state = f.state.lock().unwrap();
        state.reject_identity = true;
        state.web_response = Some(result());
    }
    let server = crate::AppServer::new();
    let (mut outbound, _) = attach(&manager, &server).await;
    let host = async {
        let request = next(&mut outbound).await;
        let params = request.params.unwrap();
        assert_eq!(params["authorization"]["resource"], "default");
        server
            .resolve_transport_server_request_response(
                ConnectionId(81),
                request.id,
                json!({"action":"opened"}),
            )
            .await;
        callback(&f, &params, false).await;
    };
    let (result, ()) = tokio::join!(search(&manager), host);
    assert!(result.is_err());
    let original = store::load(&manager.path).unwrap();
    assert!(original.account.is_none());
    let authorization = &original.authorizations[&CloudResource::Default];
    assert!(authorization.staged.is_some());
    assert_eq!(f.count("/auth/token"), 1);
    assert_eq!(f.count("/web/searches"), 0);
    f.state.lock().unwrap().reject_identity = false;

    let cold = AccountManager::new(root.path(), &config);
    let second = crate::AppServer::new();
    let (mut outbound, _) = attach(&cold, &second).await;
    let host = async {
        let request = next(&mut outbound).await;
        let params = request.params.unwrap();
        assert_eq!(params["authorization"]["resource"], "web");
        assert_eq!(f.count("/auth/token"), 1);
        assert_eq!(f.count("/web/searches"), 0);
        let current = store::load(&cold.path).unwrap();
        assert_eq!(
            current.authorizations[&CloudResource::Default].public.id,
            authorization.public.id
        );
        second
            .resolve_transport_server_request_response(
                ConnectionId(81),
                request.id,
                json!({"action":"opened"}),
            )
            .await;
        callback(&f, &params, false).await;
    };
    let (result, ()) = tokio::join!(search(&cold), host);
    assert!(result.unwrap().success);
    assert_eq!(f.count("/auth/token"), 2);
    assert_eq!(f.count("/web/searches"), 1);
    assert!(outbound.try_recv().is_err());
}

#[tokio::test]
async fn anonymous_task_does_not_adopt_an_unrelated_later_login() {
    let f = Fixture::start().await;
    let root = tempfile::tempdir().unwrap();
    let manager = AccountManager::new(root.path(), &root.path().join("config.yaml"));
    f.configure(&manager);
    // With no host, only the original anonymous input and epoch are retained.
    assert!(search(&manager)
        .await
        .unwrap_err()
        .message()
        .contains("account_host_unavailable"));
    f.login(&manager, CloudResource::Default).await;
    assert!(search(&manager)
        .await
        .unwrap_err()
        .message()
        .contains("account_changed"));
    assert_eq!(f.count("/web/searches"), 0);
    assert_eq!(f.count("/product-users"), 0);
}

#[tokio::test]
async fn anonymous_task_input_and_service_remain_bound_before_login_starts() {
    let f = Fixture::start().await;
    let root = tempfile::tempdir().unwrap();
    let config = root.path().join("config.yaml");
    let manager = AccountManager::new(root.path(), &config);
    f.configure(&manager);
    assert!(search(&manager).await.is_err());
    let changed = manager
        .execute(RuntimeToolExecutionRequest {
            tool_name: "WebSearch",
            params: &json!({"query":"different original input"}),
            context: &context(),
            turn_context: Some(&live_thread()),
        })
        .await
        .unwrap_err();
    assert!(changed.message().contains("operation_key_conflict"));
    std::fs::write(
        &config,
        json!({"cloud":{"base_url":"https://replacement.example.test"}}).to_string(),
    )
    .unwrap();
    let server = crate::AppServer::new();
    let (mut outbound, _) = attach(&manager, &server).await;
    assert!(search(&manager)
        .await
        .unwrap_err()
        .message()
        .contains("account_changed"));
    assert!(outbound.try_recv().is_err());
    assert_eq!(f.count("/auth/config"), 0);
    assert_eq!(f.count("/auth/token"), 0);
}
