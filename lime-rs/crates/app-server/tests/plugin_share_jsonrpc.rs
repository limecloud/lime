use serde_json::{json, Value};
use tempfile::TempDir;

#[allow(dead_code)]
#[path = "remote_plugins_jsonrpc/support.rs"]
mod support;
use support::{item, login, page, raw, rpc, server, session, TOKEN};
#[path = "plugin_share_jsonrpc/http.rs"]
mod http;
use http::{finish, fixture, Reply};

fn shared(id: &str, name: &str) -> Value {
    let mut plugin = item(id, name);
    plugin["creator_account_user_id"] = json!("one");
    plugin["share_principals"] =
        json!([{"principal_type":"user","principal_id":"one","role":"owner","name":"Owner"}]);
    plugin
}

fn package(root: &std::path::Path) -> std::path::PathBuf {
    let path = root.join("editor");
    std::fs::create_dir_all(path.join(".lime-plugin")).unwrap();
    std::fs::write(
        path.join(".lime-plugin/plugin.json"),
        r#"{"name":"research"}"#,
    )
    .unwrap();
    std::fs::write(path.join(".hidden"), "same package bytes").unwrap();
    path
}

fn upload() -> Reply {
    Reply::json(
        json!({"file_id":"file-1","upload_url":"$ORIGIN/upload?cap=upload-secret","etag":"etag-1"}),
    )
}
fn saved() -> Reply {
    Reply::json(
        json!({"plugin_id":"opaque~1","share_url":"$ORIGIN/share/opaque~1","can_publish_to_workspace":true}),
    )
}

#[tokio::test]
async fn share_rpc_saves_real_archive_lists_cold_paths_updates_and_deletes() {
    let temp = TempDir::new().unwrap();
    let app = server(temp.path()).await;
    let path = package(temp.path());
    let plugin = shared("opaque~1", "research");
    let other = shared("opaque~2", "writer");
    let mut installed = plugin.clone();
    installed["enabled"] = json!(true);
    installed["installed_at"] = json!("2026-10-18T00:00:00Z");
    let (url, task) = fixture(vec![
        Reply::json(session("one")), upload(), Reply::empty(201), saved(),
        Reply::json(page(vec![plugin.clone()], Some("next+/="))),
        Reply::json(page(vec![other.clone()], None)),
        Reply::json(page(vec![installed], Some("installed-next"))),
        Reply::json(page(vec![], None)),
        Reply::json(json!({"discoverability":"UNLISTED","principals":[
            {"principal_type":"user","principal_id":"one","role":"owner","name":"Owner"},
            {"principal_type":"user","principal_id":"two","role":"editor","name":"Editor"},
            {"principal_type":"workspace","principal_id":"tenant-one","role":"reader","name":"Workspace"}]})),
        Reply::empty(204),
        Reply::json(page(vec![plugin], None)), Reply::json(page(vec![], None)),
    ]).await;
    rpc(&app, "account/login/start", Some(login(&url))).await;
    let result = rpc(
        &app,
        "plugin/share/save",
        Some(json!({"pluginPath":path,"discoverability":"PRIVATE","shareTargets":[]})),
    )
    .await;
    assert_eq!(result["remotePluginId"], "opaque~1");
    assert_eq!(result["canPublishToWorkspace"], true);
    // Independent App Server instance reloads the same account/store cache.
    let cold = server(temp.path()).await;
    let listed = rpc(&cold, "plugin/share/list", Some(json!({}))).await;
    assert_eq!(listed["data"].as_array().unwrap().len(), 2);
    assert_eq!(listed["data"][0]["localPluginPath"], json!(path));
    assert_eq!(listed["data"][1]["localPluginPath"], Value::Null);
    assert_eq!(listed["data"][0]["plugin"]["installed"], true);
    assert_eq!(listed["data"][0]["plugin"]["enabled"], true);
    assert_eq!(listed["data"][0]["plugin"]["installedAt"], 1792281600_i64);
    assert_eq!(listed["data"][0]["plugin"]["localVersion"], "1.2.3");
    assert_eq!(
        listed["data"][0]["plugin"]["shareContext"]["sharePrincipals"][0]["role"],
        "owner"
    );
    let updated = rpc(&cold, "plugin/share/updateTargets", Some(json!({"remotePluginId":"opaque~1","discoverability":"UNLISTED","shareTargets":[{"principalType":"user","principalId":"two","role":"editor"}]}))).await;
    assert_eq!(updated["principals"][1]["principalId"], "two");
    assert_eq!(
        rpc(
            &cold,
            "plugin/share/delete",
            Some(json!({"remotePluginId":"opaque~1"}))
        )
        .await,
        json!({})
    );
    assert_eq!(
        std::fs::read_to_string(path.join(".hidden")).unwrap(),
        "same package bytes"
    );
    let after = rpc(&cold, "plugin/share/list", Some(json!({}))).await;
    assert_eq!(after["data"][0]["localPluginPath"], Value::Null);
    let requests = finish(task).await;
    assert!(requests[1].headers.starts_with(
        "POST /api/v1/public/tenants/tenant-one/client/public/plugins/workspace/upload-url "
    ));
    let request: Value = serde_json::from_slice(&requests[1].body).unwrap();
    assert_eq!(request["filename"], "editor.tar.gz");
    assert_eq!(request["mime_type"], "application/gzip");
    assert!(request.get("plugin_id").is_none());
    let put = &requests[2];
    assert!(put.headers.starts_with("PUT /upload?cap=upload-secret "));
    let headers = put.headers.to_lowercase();
    assert!(headers.contains("content-type: application/gzip"));
    assert!(headers.contains("x-ms-blob-type: blockblob"));
    assert!(
        !headers.contains("authorization:")
            && !headers.contains("cookie:")
            && !headers.contains(TOKEN)
    );
    assert_eq!(request["size_bytes"], put.body.len());
    let mut archive = tar::Archive::new(flate2::read::GzDecoder::new(put.body.as_slice()));
    let paths = archive
        .entries()
        .unwrap()
        .map(|entry| entry.unwrap().path().unwrap().into_owned())
        .collect::<Vec<_>>();
    assert!(paths.contains(&".lime-plugin/plugin.json".into()));
    assert!(paths.contains(&".hidden".into()));
    assert!(requests[3]
        .headers
        .starts_with("POST /api/v1/public/tenants/tenant-one/client/public/plugins/workspace "));
    assert_eq!(
        serde_json::from_slice::<Value>(&requests[3].body).unwrap(),
        json!({"file_id":"file-1","etag":"etag-1","discoverability":"PRIVATE","share_targets":[]})
    );
    assert!(requests[5].headers.contains("pageToken=next%2B%2F%3D"));
    assert!(requests[6].headers.contains("includeDownloadUrls=false"));
    assert!(requests[7].headers.contains("pageToken=installed-next"));
    assert_eq!(
        serde_json::from_slice::<Value>(&requests[8].body).unwrap(),
        json!({"discoverability":"UNLISTED","targets":[{"principal_type":"user","principal_id":"two","role":"editor"},{"principal_type":"workspace","principal_id":"tenant-one","role":"reader"}]})
    );
    for (index, request) in requests.iter().enumerate() {
        if index != 2 {
            assert!(request
                .headers
                .to_lowercase()
                .contains(&format!("authorization: bearer {TOKEN}")));
        }
    }
}

#[tokio::test]
async fn share_rpc_update_uses_post_and_only_commits_paths_after_finalize() {
    for status in [200, 409] {
        let temp = TempDir::new().unwrap();
        let app = server(temp.path()).await;
        let path = package(temp.path());
        let (url, task) = fixture(vec![
            Reply::json(session("one")),
            upload(),
            Reply::empty(201),
            if status == 200 {
                saved()
            } else {
                Reply::status(status, json!({"message":"upload-secret"}))
            },
            Reply::json(page(vec![shared("opaque~1", "research")], None)),
            Reply::json(page(vec![], None)),
        ])
        .await;
        rpc(&app, "account/login/start", Some(login(&url))).await;
        let result = raw(
            &app,
            "plugin/share/save",
            Some(json!({"pluginPath":path,"remotePluginId":"opaque~1"})),
        )
        .await;
        assert_eq!(result.get("error").is_none(), status == 200);
        assert!(!result.to_string().contains("upload-secret"));
        let listed = rpc(&app, "plugin/share/list", Some(json!({}))).await;
        assert_eq!(
            listed["data"][0]["localPluginPath"],
            if status == 200 {
                json!(path)
            } else {
                Value::Null
            }
        );
        let requests = finish(task).await;
        assert_eq!(
            serde_json::from_slice::<Value>(&requests[1].body).unwrap()["plugin_id"],
            "opaque~1"
        );
        assert!(requests[3].headers.starts_with(
            "POST /api/v1/public/tenants/tenant-one/client/public/plugins/workspace/opaque~1 "
        ));
    }
}

#[tokio::test]
async fn share_rpc_rejects_relative_paths_and_requires_auth_for_all_methods() {
    let temp = TempDir::new().unwrap();
    let app = server(temp.path()).await;
    let result = raw(
        &app,
        "plugin/share/save",
        Some(json!({"pluginPath":"relative/path"})),
    )
    .await;
    assert!(result["error"].is_object());
    for (method, params) in [
        ("plugin/share/save", json!({"pluginPath":temp.path()})),
        ("plugin/share/list", json!({})),
        (
            "plugin/share/updateTargets",
            json!({"remotePluginId":"id","discoverability":"PRIVATE","shareTargets":[]}),
        ),
        ("plugin/share/delete", json!({"remotePluginId":"id"})),
        ("plugin/share/checkout", json!({"remotePluginId":"id"})),
    ] {
        assert!(raw(&app, method, Some(params)).await["error"]["message"]
            .as_str()
            .unwrap()
            .contains("authentication required"));
    }
}

#[tokio::test]
async fn share_rpc_rejects_invalid_upload_metadata_redirect_and_non_204_delete() {
    for reply in [
        Reply::json(json!({"file_id":"file-1","upload_url":"$ORIGIN/upload?cap=upload-secret"})),
        Reply::json(
            json!({"file_id":"","etag":"etag-1","upload_url":"$ORIGIN/upload?cap=upload-secret"}),
        ),
        Reply::json(
            json!({"file_id":"file-1","etag":"etag-1","upload_url":"http://other.invalid/upload?cap=upload-secret"}),
        ),
    ] {
        let temp = TempDir::new().unwrap();
        let app = server(temp.path()).await;
        let path = package(temp.path());
        let (url, task) = fixture(vec![Reply::json(session("one")), reply]).await;
        rpc(&app, "account/login/start", Some(login(&url))).await;
        let result = raw(&app, "plugin/share/save", Some(json!({"pluginPath":path}))).await;
        assert!(result["error"].is_object());
        assert!(!result.to_string().contains("upload-secret"));
        finish(task).await;
    }
    let temp = TempDir::new().unwrap();
    let app = server(temp.path()).await;
    let path = package(temp.path());
    let (url, task) = fixture(vec![
        Reply::json(session("one")),
        upload(),
        Reply {
            status: 307,
            body: Value::Null,
            headers: "Location: $ORIGIN/trap?cap=upload-secret\r\n".into(),
            bytes: None,
        },
        Reply::json(json!({})),
    ])
    .await;
    rpc(&app, "account/login/start", Some(login(&url))).await;
    let result = raw(&app, "plugin/share/save", Some(json!({"pluginPath":path}))).await;
    assert!(result["error"]["message"]
        .as_str()
        .unwrap()
        .contains("HTTP 307"));
    assert!(!result.to_string().contains("upload-secret"));
    let deleted = raw(
        &app,
        "plugin/share/delete",
        Some(json!({"remotePluginId":"opaque~1"})),
    )
    .await;
    assert!(deleted["error"]["message"]
        .as_str()
        .unwrap()
        .contains("HTTP 204"));
    let requests = finish(task).await;
    assert!(requests[3].headers.starts_with("DELETE "));
}

#[tokio::test]
async fn share_rpc_never_returns_partial_or_cross_creator_snapshots() {
    let mut wrong_creator = shared("opaque~1", "research");
    wrong_creator["creator_account_user_id"] = json!("another");
    let mut missing_owner = shared("opaque~1", "research");
    missing_owner["share_principals"] = json!([]);
    for pages in [
        vec![page(vec![wrong_creator], None)],
        vec![page(vec![missing_owner], None)],
        vec![
            page(vec![shared("opaque~1", "research")], Some("repeat")),
            page(vec![], Some("repeat")),
        ],
        vec![
            page(vec![shared("opaque~1", "research")], Some("next")),
            page(vec![shared("opaque~1", "research")], None),
        ],
    ] {
        let temp = TempDir::new().unwrap();
        let app = server(temp.path()).await;
        let mut replies = vec![Reply::json(session("one"))];
        replies.extend(pages.into_iter().map(Reply::json));
        let (url, task) = fixture(replies).await;
        rpc(&app, "account/login/start", Some(login(&url))).await;
        let result = raw(&app, "plugin/share/list", Some(json!({}))).await;
        assert!(result.get("result").is_none());
        assert!(result["error"].is_object());
        finish(task).await;
    }
}

#[tokio::test]
async fn share_rpc_preserves_remote_success_when_local_path_cache_is_unwritable() {
    let temp = TempDir::new().unwrap();
    let app = server(temp.path()).await;
    let path = package(temp.path());
    std::fs::create_dir_all(temp.path().join("plugins")).unwrap();
    std::fs::write(temp.path().join("plugins/share-paths"), "blocked directory").unwrap();
    let (url, task) = fixture(vec![
        Reply::json(session("one")),
        upload(),
        Reply::empty(201),
        saved(),
    ])
    .await;
    rpc(&app, "account/login/start", Some(login(&url))).await;
    let result = rpc(&app, "plugin/share/save", Some(json!({"pluginPath":path}))).await;
    assert_eq!(result["remotePluginId"], "opaque~1");
    assert_eq!(finish(task).await.len(), 4);
}

#[tokio::test]
async fn share_rpc_stops_before_finalize_after_peer_logout_during_upload() {
    use std::sync::Arc;
    use std::time::Duration;
    use tokio::io::AsyncWriteExt;
    let temp = TempDir::new().unwrap();
    let app = Arc::new(server(temp.path()).await);
    let peer = server(temp.path()).await;
    let path = package(temp.path());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let origin = url.clone();
    let (entered, request_entered) = tokio::sync::oneshot::channel();
    let (release, released) = tokio::sync::oneshot::channel();
    let http = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        http::receive(&mut socket).await;
        support::respond(&mut socket, session("one")).await;
        let (mut socket, _) = listener.accept().await.unwrap();
        http::receive(&mut socket).await;
        support::respond(&mut socket, json!({"file_id":"file-1","etag":"etag-1","upload_url":format!("{origin}/upload?cap=upload-secret")})).await;
        let (mut socket, _) = listener.accept().await.unwrap();
        let request = http::receive(&mut socket).await;
        assert!(!request.headers.to_lowercase().contains("authorization:"));
        entered.send(()).unwrap();
        released.await.unwrap();
        socket
            .write_all(b"HTTP/1.1 201 Created\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
            .await
            .unwrap();
        // No finalize request is accepted after the shared account disappears.
    });
    rpc(&app, "account/login/start", Some(login(&url))).await;
    let querying = app.clone();
    let pending = tokio::spawn(async move {
        raw(
            &querying,
            "plugin/share/save",
            Some(json!({"pluginPath":path})),
        )
        .await
    });
    tokio::time::timeout(Duration::from_secs(10), request_entered)
        .await
        .unwrap()
        .unwrap();
    rpc(&peer, "account/logout", None).await;
    release.send(()).unwrap();
    let response = pending.await.unwrap();
    assert!(response["error"]["message"]
        .as_str()
        .unwrap()
        .contains("account changed"));
    assert!(!response.to_string().contains("upload-secret"));
    http.await.unwrap();
    let (url, task) = fixture(vec![
        Reply::json(session("one")),
        Reply::json(page(vec![shared("opaque~1", "research")], None)),
        Reply::json(page(vec![], None)),
    ])
    .await;
    rpc(&peer, "account/login/start", Some(login(&url))).await;
    assert_eq!(
        rpc(&peer, "plugin/share/list", Some(json!({}))).await["data"][0]["localPluginPath"],
        Value::Null
    );
    finish(task).await;
}
