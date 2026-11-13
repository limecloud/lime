use super::*;

const ATTEMPT: &str = "standalone-install-attempt";

fn cancel(item: &Value) -> Value {
    json!({"itemId":item["id"],"kind":item["kind"],"installAttemptId":ATTEMPT})
}

fn receipt(command: &str, resource: &str, result: Value) -> Value {
    json!({"command":command,"resourceId":resource,"result":result,"createdAt":"2026-11-13T00:00:00Z"})
}

fn account_root(temp: &TempDir) -> std::path::PathBuf {
    std::fs::read_dir(temp.path().join("agent/market"))
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path()
}

#[tokio::test]
async fn pending_keeps_original_selection_and_unknown_cannot_be_cancelled_or_replaced() {
    let temp = TempDir::new().unwrap();
    let f = Fixture::start().await;
    let items = resources::configure(&f);
    let app = server(temp.path()).await;
    login(&f, &app).await;
    f.respond(
        "/api/v1/client/market/acquisitions#rel_research_skill",
        503,
        json!({"error":"outcome_unknown"}),
    );
    assert!(
        raw(&app, "market/install", resources::install_params(&items[0]))
            .await
            .get("error")
            .is_some()
    );
    let mut published = items[0].clone();
    published["publishedReleaseId"] = json!("rel_new_publication");
    published["release"]["id"] = json!("rel_new_publication");
    published["revision"] = json!(10);
    f.respond(
        "/api/v1/client/market/items/item_research_skill",
        200,
        published.clone(),
    );
    let cold = issuer::server(temp.path()).await;
    let pending = rpc(&cold, "market/install/pending", json!({"kind":"skill"})).await;
    assert_eq!(pending["attempts"][0]["installAttemptId"], ATTEMPT);
    assert_eq!(
        pending["attempts"][0]["resource"]["release"],
        reference(&items[0]["release"])
    );
    assert_eq!(pending["errors"], json!([]));
    assert!(
        raw(&cold, "market/install/cancel", cancel(&items[0])).await["error"]["message"]
            .as_str()
            .unwrap()
            .contains("market_install_outcome_unknown")
    );
    let mut stale = cancel(&items[0]);
    stale["installAttemptId"] = json!("new-click-without-original");
    assert!(raw(&cold, "market/install/cancel", stale)
        .await
        .get("error")
        .is_some());
    assert!(raw(
        &cold,
        "market/install",
        resources::install_params(&published)
    )
    .await
    .get("error")
    .is_some());
    assert_eq!(
        rpc(&cold, "market/install/pending", json!({})).await["attempts"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(f.count("/market/acquisitions"), 1);
    assert_eq!(f.count("/download-tickets"), 0);
    rpc(&cold, "account/logout", json!({})).await;
    assert_eq!(
        rpc(&cold, "market/install/pending", json!({})).await["attempts"],
        json!([])
    );
    f.state.lock().unwrap().user = "person-b".into();
    login(&f, &cold).await;
    assert_eq!(
        rpc(&cold, "market/install/pending", json!({})).await["attempts"],
        json!([])
    );
    assert_eq!(f.count("/market/acquisitions"), 1);
}

#[tokio::test]
async fn failure_before_dispatch_can_be_cancelled_without_remote_commands() {
    let temp = TempDir::new().unwrap();
    let f = Fixture::start().await;
    let items = resources::configure(&f);
    let app = server(temp.path()).await;
    login(&f, &app).await;
    f.respond(
        "/api/v1/client/market/releases/rel_research_skill",
        503,
        json!({"error":"unavailable"}),
    );
    assert!(
        raw(&app, "market/install", resources::install_params(&items[0]))
            .await
            .get("error")
            .is_some()
    );
    assert_eq!(
        rpc(&app, "market/install/pending", json!({})).await["attempts"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    rpc(&app, "market/install/cancel", cancel(&items[0])).await;
    rpc(&app, "market/install/cancel", cancel(&items[0])).await;
    assert_eq!(
        rpc(&app, "market/install/pending", json!({})).await["attempts"],
        json!([])
    );
    assert_eq!(f.count("/market/acquisitions"), 0);
    f.respond(
        "/api/v1/client/market/releases/rel_research_skill",
        200,
        items[0]["release"].clone(),
    );
    let mut new_attempt = resources::install_params(&items[0]);
    new_attempt["installAttemptId"] = json!("new-explicit-install-attempt");
    rpc(&app, "market/install", new_attempt).await;
    assert_eq!(f.count("/market/acquisitions"), 1);
}

#[tokio::test]
async fn local_download_failure_only_releases_after_both_original_receipts_are_verified() {
    let temp = TempDir::new().unwrap();
    let f = Fixture::start().await;
    let items = resources::configure(&f);
    let app = server(temp.path()).await;
    login(&f, &app).await;
    f.respond(
        "/bundle/rel_research_skill",
        503,
        json!({"error":"unavailable"}),
    );
    assert!(
        raw(&app, "market/install", resources::install_params(&items[0]))
            .await
            .get("error")
            .is_some()
    );
    let acquire_path = dependencies::operation_path(ATTEMPT, "item_research_skill", "acquire");
    let ticket_path = dependencies::operation_path(ATTEMPT, "item_research_skill", "download");
    let acquired = json!({"id":"acq_skill_main","releaseId":"rel_research_skill","status":"active","revision":1});
    f.respond(
        &acquire_path,
        200,
        receipt("acquisition.create", "rel_wrong", acquired.clone()),
    );
    assert!(raw(&app, "market/install/cancel", cancel(&items[0]))
        .await
        .get("error")
        .is_some());
    f.respond(
        &acquire_path,
        200,
        receipt("acquisition.create", "rel_research_skill", acquired),
    );
    f.respond(&ticket_path, 404, json!({"error":"not_found"}));
    assert!(raw(&app, "market/install/cancel", cancel(&items[0]))
        .await
        .get("error")
        .is_some());
    let release = &items[0]["release"];
    // An expired successful ticket still proves dispatch completed. Cancellation
    // never uses it to download or to extend access.
    let ticket = json!({"sha256":release["archiveSha256"],"size":release["archiveSize"],"download":{"url":format!("{}/bundle/rel_research_skill",f.base),"method":"GET","headers":{},"expiresAt":"2026-01-01T00:00:00Z"}});
    f.respond(
        &ticket_path,
        200,
        receipt("acquisition.download", "acq_skill_main", ticket),
    );
    rpc(&app, "market/install/cancel", cancel(&items[0])).await;
    assert_eq!(
        rpc(&app, "market/install/pending", json!({})).await["attempts"],
        json!([])
    );
    assert_eq!(
        rpc(&app, "market/installed", json!({})).await["resources"],
        json!([])
    );
    assert_eq!(f.count("/market/acquisitions"), 1);
    assert_eq!(f.count("/download-tickets"), 1);
}

#[tokio::test]
async fn acquisition_checks_distinguish_revoked_unavailable_and_invalid_without_local_mutation() {
    let temp = TempDir::new().unwrap();
    let f = Fixture::start().await;
    let items = resources::configure(&f);
    let app = server(temp.path()).await;
    login(&f, &app).await;
    for item in &items[..3] {
        rpc(&app, "market/install", resources::install_params(item)).await;
    }
    f.respond("/api/v1/client/market/acquisitions/acq_mcp_main",200,json!({"id":"acq_mcp_main","releaseId":"rel_research_http","status":"revoked","revision":2}));
    f.respond(
        "/api/v1/client/market/acquisitions/acq_mcp_stdio",
        503,
        json!({"error":"unavailable"}),
    );
    let check = rpc(&app, "market/reconcile", json!({})).await;
    let statuses = check["resources"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| {
            (
                r["itemId"].as_str().unwrap(),
                r["acquisitionStatus"].as_str().unwrap(),
            )
        })
        .collect::<std::collections::BTreeMap<_, _>>();
    assert_eq!(statuses["item_research_skill"], "active");
    assert_eq!(statuses["item_research_http"], "revoked");
    assert_eq!(statuses["item_research_stdio"], "unavailable");
    assert_eq!(check["errors"], json!([]));
    f.respond(
        "/api/v1/client/market/acquisitions/acq_skill_main",
        200,
        json!({"id":"acq_other","releaseId":"rel_research_skill","status":"active","revision":1}),
    );
    assert_eq!(
        rpc(&app, "market/reconcile", json!({"kind":"skill"})).await["resources"][0]
            ["acquisitionStatus"],
        "unavailable"
    );
    let installed = rpc(&app, "market/installed", json!({})).await;
    assert_eq!(installed["resources"].as_array().unwrap().len(), 3);
    assert!(installed["resources"]
        .as_array()
        .unwrap()
        .iter()
        .all(|r| r["installation"]["enabled"] == true));
    assert_eq!(f.count("/market/acquisitions"), 3);
    assert_eq!(f.count("/download-tickets"), 3);
}

#[tokio::test]
async fn damaged_installation_is_isolated_from_other_acquisition_checks() {
    let temp = TempDir::new().unwrap();
    let f = Fixture::start().await;
    let items = resources::configure(&f);
    let app = server(temp.path()).await;
    login(&f, &app).await;
    for item in &items[..3] {
        rpc(&app, "market/install", resources::install_params(item)).await;
    }
    let package = account_root(&temp).join("skill/item_research_skill/package");
    let file = items[0]["release"]["manifest"]["files"][0]["path"]
        .as_str()
        .unwrap();
    std::fs::write(package.join(file), b"tampered skill").unwrap();
    let check = rpc(&app, "market/reconcile", json!({})).await;
    assert_eq!(check["resources"].as_array().unwrap().len(), 2);
    assert_eq!(check["errors"][0]["itemId"], "item_research_skill");
    assert_eq!(check["errors"][0]["error"], "invalid_market_installation");
}

#[cfg(unix)]
#[tokio::test]
async fn pending_records_reject_corruption_and_symlinks_without_hiding_valid_attempts() {
    let temp = TempDir::new().unwrap();
    let f = Fixture::start().await;
    let items = resources::configure(&f);
    let app = server(temp.path()).await;
    login(&f, &app).await;
    for item in &items[..3] {
        f.respond(
            &format!(
                "/api/v1/client/market/releases/{}",
                item["release"]["id"].as_str().unwrap()
            ),
            503,
            json!({"error":"unavailable"}),
        );
        assert!(raw(&app, "market/install", resources::install_params(item))
            .await
            .get("error")
            .is_some());
    }
    let root = account_root(&temp).join("attempts");
    std::fs::write(root.join("skill-item_research_skill.json"), b"not json").unwrap();
    let linked = root.join("mcp-item_research_http.json");
    let external = temp.path().join("external-attempt.json");
    std::fs::rename(&linked, &external).unwrap();
    std::os::unix::fs::symlink(&external, &linked).unwrap();
    let before = std::fs::read(&external).unwrap();
    let pending = rpc(&app, "market/install/pending", json!({})).await;
    assert_eq!(pending["attempts"].as_array().unwrap().len(), 1);
    assert_eq!(
        pending["attempts"][0]["resource"]["itemId"],
        "item_research_stdio"
    );
    assert_eq!(pending["errors"].as_array().unwrap().len(), 2);
    assert!(raw(&app, "market/install/cancel", cancel(&items[1]))
        .await
        .get("error")
        .is_some());
    assert!(
        raw(&app, "market/install", resources::install_params(&items[1]))
            .await
            .get("error")
            .is_some()
    );
    assert_eq!(std::fs::read(&external).unwrap(), before);
    assert_eq!(f.count("/market/acquisitions"), 0);
}
