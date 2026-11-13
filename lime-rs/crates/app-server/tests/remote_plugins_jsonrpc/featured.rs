use super::*;

#[tokio::test]
async fn unconfigured_featured_catalog_is_empty_without_hiding_the_shared_catalog() {
    let temp = TempDir::new().unwrap();
    let f = Fixture::start().await;
    let item = package::configure(&f);
    let server = server(temp.path()).await;
    login(&f, &server).await;
    for (revision, items, valid) in [
        (0, json!([]), true),
        (1, json!([]), true),
        (0, json!([item["release"]]), false),
    ] {
        f.respond(
            "/api/v1/client/market/featured",
            200,
            json!({"revision":revision,"items":items}),
        );
        let listed = rpc(&server, "plugin/list", cloud()).await;
        assert_eq!(summary(&listed)["version"], "1.0.0");
        assert_eq!(listed["featuredPlugins"], json!([]));
        assert_eq!(
            listed["marketplaceLoadErrors"]
                .as_array()
                .unwrap()
                .is_empty(),
            valid,
            "{listed}"
        );
    }
}

#[tokio::test]
async fn selected_release_compatibility_is_checked_independently_of_the_current_release() {
    let temp = TempDir::new().unwrap();
    let f = Fixture::start().await;
    package::configure(&f);
    newer(&f, true);
    let (unsupported, _) = package::artifact_with_host("1.0.0", "another-app");
    f.respond(
        "/api/v1/client/market/featured",
        200,
        json!({"revision":2,"items":[unsupported["release"]]}),
    );
    f.respond(
        "/api/v1/client/market/releases/rel_research",
        200,
        unsupported["release"].clone(),
    );
    let server = server(temp.path()).await;
    login(&f, &server).await;
    let listed = rpc(&server, "plugin/list", cloud()).await;
    assert_eq!(summary(&listed)["installPolicy"], "AVAILABLE");
    assert_eq!(
        listed["featuredPlugins"][0]["plugin"]["installPolicy"],
        "NOT_AVAILABLE"
    );
    let mut selected = install();
    selected["remoteRelease"] = reference(&unsupported["release"]);
    assert!(raw(&server, "plugin/install", selected)
        .await
        .get("error")
        .is_some());
    assert_eq!(f.count("/market/acquisitions"), 0);
}

fn newer(f: &Fixture, supported: bool) -> Value {
    let (mut item, _) = package::artifact_version("2.0.0");
    item["release"]["id"] = json!("rel_newer");
    item["publishedReleaseId"] = json!("rel_newer");
    item["revision"] = json!(2);
    item["compatibility"]["status"] = json!(if supported {
        "supported"
    } else {
        "unsupported"
    });
    f.respond(
        "/api/v1/client/market/items/item_research",
        200,
        item.clone(),
    );
    f.respond(
        "/api/v1/client/market/items",
        200,
        json!({"items":[item],"nextCursor":""}),
    );
    f.respond(
        "/api/v1/client/market/releases/rel_newer",
        200,
        item["release"].clone(),
    );
    item
}

#[tokio::test]
async fn featured_old_release_survives_new_publication_and_installs_the_selected_artifact() {
    let temp = TempDir::new().unwrap();
    let f = Fixture::start().await;
    let old = package::configure(&f);
    newer(&f, false);
    let server = server(temp.path()).await;
    login(&f, &server).await;
    let listed = rpc(&server, "plugin/list", cloud()).await;
    assert_eq!(summary(&listed)["version"], "2.0.0");
    assert_eq!(summary(&listed)["installPolicy"], "NOT_AVAILABLE");
    let featured = &listed["featuredPlugins"][0]["plugin"];
    assert_eq!(featured["version"], "1.0.0");
    assert_eq!(featured["remoteRelease"], reference(&old["release"]));
    assert_eq!(featured["installPolicy"], "AVAILABLE");
    rpc(&server, "plugin/install", install()).await;
    let installed = rpc(&server, "plugin/installed", json!({})).await;
    assert_eq!(
        summary(&installed)["localRelease"],
        reference(&old["release"])
    );
    assert_eq!(summary(&installed)["localVersion"], "1.0.0");
    let current = newer(&f, true);
    let mut selected = detail();
    selected["remoteRelease"] = reference(&current["release"]);
    let read = rpc(&server, "plugin/read", selected).await;
    assert_eq!(read["plugin"]["summary"]["version"], "2.0.0");
    assert_eq!(read["plugin"]["summary"]["localVersion"], "1.0.0");
    assert_eq!(
        read["plugin"]["summary"]["localRelease"],
        reference(&old["release"])
    );
    assert_eq!(read["plugin"]["skills"], json!([]));
    let mut selected = detail();
    selected["remoteRelease"] = reference(&old["release"]);
    let read = rpc(&server, "plugin/read", selected).await;
    assert_eq!(read["plugin"]["summary"]["version"], "1.0.0");
    assert_eq!(read["plugin"]["skills"][0]["name"], "research:research");
    let state = f.state.lock().unwrap();
    let acquisitions: Vec<_> = state
        .calls
        .iter()
        .filter(|(path, _, _)| path.ends_with("/market/acquisitions"))
        .collect();
    assert_eq!(acquisitions.len(), 1);
    assert_eq!(acquisitions[0].1["releaseId"], "rel_research");
    assert_eq!(acquisitions[0].1["expectedItemRevision"], 2);
}

#[tokio::test]
async fn pending_install_rejects_another_release_before_network_and_cold_recovers_original() {
    let temp = TempDir::new().unwrap();
    let f = Fixture::start().await;
    package::configure(&f);
    let recovery = {
        let mut state = f.state.lock().unwrap();
        let path = state
            .responses
            .keys()
            .find(|path| path.contains("/market/operations/"))
            .unwrap()
            .clone();
        let response = state.responses.remove(&path).unwrap();
        (path, response)
    };
    f.state.lock().unwrap().responses.insert(
        "/api/v1/client/market/acquisitions".into(),
        (200, b"invalid-json".to_vec()),
    );
    let first = server(temp.path()).await;
    login(&f, &first).await;
    assert!(raw(&first, "plugin/install", install())
        .await
        .get("error")
        .is_some());
    let current = newer(&f, true);
    let cold = server(temp.path()).await;
    let mut selected = install();
    selected["remoteRelease"] = reference(&current["release"]);
    let calls = f.state.lock().unwrap().calls.len();
    let rejected = raw(&cold, "plugin/install", selected).await;
    assert!(
        rejected
            .to_string()
            .contains("plugin_install_pending_other_release"),
        "{rejected}"
    );
    assert_eq!(f.state.lock().unwrap().calls.len(), calls);
    f.state
        .lock()
        .unwrap()
        .responses
        .insert(recovery.0, recovery.1);
    rpc(&cold, "plugin/install", install()).await;
    assert_eq!(f.count("/market/acquisitions"), 1);
    assert_eq!(
        summary(&rpc(&cold, "plugin/installed", json!({})).await)["localVersion"],
        "1.0.0"
    );
}

#[tokio::test]
async fn changed_or_withdrawn_selection_never_falls_back_to_current_or_installed_release() {
    let temp = TempDir::new().unwrap();
    let f = Fixture::start().await;
    let old = package::configure(&f);
    let server = server(temp.path()).await;
    login(&f, &server).await;
    let mut wrong = install();
    wrong["remoteRelease"]["archiveSha256"] = json!("a".repeat(64));
    assert!(raw(&server, "plugin/install", wrong)
        .await
        .get("error")
        .is_some());
    assert_eq!(f.count("/market/acquisitions"), 0);
    rpc(&server, "plugin/install", install()).await;
    newer(&f, true);
    f.respond(
        "/api/v1/client/market/releases/rel_research",
        404,
        json!({"error":"not_found"}),
    );
    let mut selected = detail();
    selected["remoteRelease"] = reference(&old["release"]);
    assert!(raw(&server, "plugin/read", selected)
        .await
        .get("error")
        .is_some());
    assert!(raw(&server, "plugin/install", install())
        .await
        .get("error")
        .is_some());
    assert_eq!(f.count("/market/acquisitions"), 1);
    let installed = rpc(&server, "plugin/read", detail()).await;
    assert_eq!(installed["plugin"]["summary"]["localVersion"], "1.0.0");
}
