use super::*;

fn fixtures() -> Vec<Value> {
    serde_json::from_str(include_str!(
        "../../src/market/testdata/cloud-market-types.json"
    ))
    .unwrap()
}

#[tokio::test]
async fn standalone_skills_and_mcp_cannot_enter_plugin_list_read_or_install() {
    for fixture in fixtures().into_iter().take(3) {
        let item = &fixture["item"];
        let temp = TempDir::new().unwrap();
        let f = Fixture::start().await;
        f.respond(
            "/api/v1/client/market/items",
            200,
            json!({"items":[item],"nextCursor":""}),
        );
        f.respond(
            &format!(
                "/api/v1/client/market/items/{}",
                item["id"].as_str().unwrap()
            ),
            200,
            item.clone(),
        );
        f.respond(
            "/api/v1/client/market/featured",
            200,
            json!({"revision":1,"items":[]}),
        );
        let current = server(temp.path()).await;
        login(&f, &current).await;
        let listed = rpc(&current, "plugin/list", cloud()).await;
        assert_eq!(listed["marketplaces"], json!([]), "{listed}");
        assert!(!listed["marketplaceLoadErrors"]
            .as_array()
            .unwrap()
            .is_empty());
        let params = json!({"remoteMarketplaceName":MARKET,"pluginName":item["id"],"remoteRelease":reference(&item["release"]),"installAttemptId":"original-install-attempt"});
        assert!(raw(&current, "plugin/read", params.clone())
            .await
            .get("error")
            .is_some());
        assert!(raw(&current, "plugin/install", params)
            .await
            .get("error")
            .is_some());
        assert_eq!(f.count("/market/acquisitions"), 0);
        assert_eq!(f.count("/download-tickets"), 0);
        assert_eq!(
            rpc(&current, "plugin/installed", json!({})).await["marketplaces"],
            json!([])
        );
    }
}

#[tokio::test]
async fn featured_plugin_release_requires_a_current_item_of_the_same_type() {
    let fixtures = fixtures();
    let release = &fixtures[3]["item"]["release"];
    let mut current_item = fixtures[0]["item"].clone();
    current_item["id"] = release["itemId"].clone();
    current_item["release"]["itemId"] = release["itemId"].clone();
    let temp = TempDir::new().unwrap();
    let f = Fixture::start().await;
    f.respond(
        "/api/v1/client/market/items",
        200,
        json!({"items":[],"nextCursor":""}),
    );
    f.respond(
        "/api/v1/client/market/featured",
        200,
        json!({"revision":1,"items":[release]}),
    );
    f.respond(
        &format!(
            "/api/v1/client/market/items/{}",
            release["itemId"].as_str().unwrap()
        ),
        200,
        current_item,
    );
    let current = server(temp.path()).await;
    login(&f, &current).await;
    let listed = rpc(&current, "plugin/list", cloud()).await;
    assert_eq!(listed["featuredPlugins"], json!([]), "{listed}");
    assert!(!listed["marketplaceLoadErrors"]
        .as_array()
        .unwrap()
        .is_empty());
    assert_eq!(f.count("/market/acquisitions"), 0);
}
