use serde_json::{json, Value};
use tempfile::TempDir;

#[path = "account_jsonrpc/issuer.rs"]
mod issuer;
#[path = "account_jsonrpc/stdio.rs"]
mod stdio;
use issuer::*;

#[tokio::test]
async fn public_native_service_configuration_rejects_caller_origins_and_is_shared_after_restart() {
    let temp = TempDir::new().unwrap();
    let fixture = Fixture::start().await;
    let first = server(temp.path()).await;
    assert!(rpc(&first, "account/read", json!({})).await["serviceUrl"].is_null());
    assert!(raw(
        &first,
        "account/login/start",
        json!({
            "type":"cloud", "baseUrl":fixture.base, "language":"zh-CN"
        })
    )
    .await
    .get("error")
    .is_some());
    assert_eq!(fixture.count("/auth/config"), 0);
    rpc(&first, "config/value/write", json!({
        "keyPath":"cloud.base_url", "value":format!("{}/",fixture.base), "mergeStrategy":"replace"
    })).await;
    assert_eq!(
        rpc(&first, "account/read", json!({})).await["serviceUrl"],
        fixture.base
    );
    let cold = server(temp.path()).await;
    assert_eq!(
        rpc(&cold, "account/read", json!({})).await["serviceUrl"],
        fixture.base
    );
    assert!(raw(&cold, "config/value/write", json!({
        "keyPath":"cloud.base_url", "value":"http://untrusted.example.test", "mergeStrategy":"replace"
    })).await.get("error").is_some());
    assert_eq!(
        rpc(&cold, "account/read", json!({})).await["serviceUrl"],
        fixture.base
    );
    assert_eq!(fixture.count("/auth/config"), 0);
}

#[tokio::test]
async fn public_pkce_cold_read_resource_isolation_and_logout() {
    let temp = TempDir::new().unwrap();
    let fixture = Fixture::start().await;
    let first = server(temp.path()).await;
    assert!(rpc(&first, "account/read", json!({})).await["account"].is_null());
    let default = fixture.authorize(&first, "default").await;
    assert_eq!(default["account"]["userId"], "person-a");
    fixture.authorize(&first, "web").await;
    let second = server(temp.path()).await;
    let cold = rpc(&second, "account/read", json!({})).await;
    assert_eq!(cold["account"]["resources"].as_array().unwrap().len(), 2);
    assert_eq!(
        rpc(
            &first,
            "cloud/request",
            search("rpc-search-operation", "zh-CN")
        )
        .await["status"],
        200
    );
    assert_eq!(fixture.count("/product-users"), 1);
    rpc(&second, "account/logout", json!({})).await;
    assert!(rpc(&first, "account/read", json!({})).await["account"].is_null());
    assert_eq!(fixture.count("/auth/token"), 2);
}

#[tokio::test]
async fn public_unknown_write_resumes_original_command_after_restart() {
    let temp = TempDir::new().unwrap();
    let fixture = Fixture::start().await;
    let first = server(temp.path()).await;
    fixture.authorize(&first, "default").await;
    fixture.authorize(&first, "web").await;
    fixture.state.lock().unwrap().invalid_post = true;
    assert_eq!(
        rpc(
            &first,
            "cloud/request",
            search("rpc-original-operation", "zh-CN")
        )
        .await["status"],
        502
    );
    let cold = server(temp.path()).await;
    assert_eq!(
        rpc(
            &cold,
            "cloud/request",
            search("rpc-original-operation", "en-US")
        )
        .await["status"],
        502
    );
    assert_eq!(fixture.count("/web/searches"), 1);
    let journal = rpc(
        &cold,
        "cloud/request",
        json!({"path":"/operations/rpc-original-operation","method":"GET","language":"en-US"}),
    )
    .await;
    assert_eq!(journal["body"]["task_id"], Value::Null);
    assert_eq!(journal["body"]["taskId"], "research-task");
    assert_eq!(journal["body"]["language"], "zh-CN");
    let result = rpc(
        &cold,
        "cloud/request",
        json!({"path":"/web/operations/rpc-original-operation","method":"GET","language":"en-US"}),
    )
    .await;
    assert_eq!(result["body"]["status"], "completed");
    assert_eq!(fixture.count("/web/searches"), 1);
    fixture.state.lock().unwrap().product_disabled = true;
    assert!(raw(
        &cold,
        "cloud/request",
        search("rpc-blocked-operation", "en-US")
    )
    .await["error"]["message"]
        .as_str()
        .unwrap()
        .contains("product_user_disabled"));
    assert_eq!(fixture.count("/web/searches"), 1);
}

#[tokio::test]
async fn public_rejects_old_token_import_arbitrary_routes_and_wrong_nonce() {
    let temp = TempDir::new().unwrap();
    let fixture = Fixture::start().await;
    let server = server(temp.path()).await;
    assert!(raw(&server, "account/login/start", json!({"type":"cloudAuthTokens","baseUrl":fixture.base,"tenantId":"removed","accessToken":"untrusted"})).await.get("error").is_some());
    assert!(raw(
        &server,
        "cloud/request",
        json!({"path":"https://untrusted.invalid/","method":"GET","language":"en-US"})
    )
    .await
    .get("error")
    .is_some());
    fixture.state.lock().unwrap().invalid_nonce = true;
    let result = fixture.authorize(&server, "default").await;
    assert!(result["account"].is_null());
    assert_eq!(fixture.count("/auth/token"), 1);
}

#[tokio::test]
async fn public_connections_list_is_a_fixed_read_only_route() {
    let temp = TempDir::new().unwrap();
    let fixture = Fixture::start().await;
    let server = server(temp.path()).await;
    fixture.authorize(&server, "default").await;
    fixture.authorize(&server, "connections").await;
    let result = rpc(
        &server,
        "cloud/request",
        json!({"path":"/connections","method":"GET","language":"zh-CN"}),
    )
    .await;
    assert_eq!(result["status"], 200);
    assert_eq!(result["body"]["items"][0]["id"], "icg_original");
    assert_eq!(result["body"]["items"][0]["applicationId"], "app_original");
    assert_eq!(fixture.count("/connections"), 1);
    assert_eq!(fixture.count("/product-users"), 1);
    for params in [
        json!({"path":"/connections/icg_other","method":"GET","language":"zh-CN"}),
        json!({"path":"/connections?cursor=next","method":"GET","language":"zh-CN"}),
        json!({"path":"/connections","method":"POST","body":{},"operationKey":"original-operation-key","taskId":"task","language":"zh-CN"}),
    ] {
        assert!(raw(&server, "cloud/request", params)
            .await
            .get("error")
            .is_some());
    }
    assert_eq!(fixture.count("/connections"), 1);
}
