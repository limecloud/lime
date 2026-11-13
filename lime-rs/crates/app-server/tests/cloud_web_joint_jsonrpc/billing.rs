use super::*;

#[tokio::test]
#[ignore = "requires actual Cloud/Core, isolated credits and frozen native process"]
async fn real_public_client_cloud_core_priced_search_and_cold_recovery() {
    let core = std::env::var("LIME_NATIVE_JOINT_CORE_URL").unwrap();
    let browser = std::env::var("LIME_NATIVE_JOINT_BROWSER").unwrap();
    let binary = std::env::var("LIME_NATIVE_JOINT_APP_SERVER").unwrap();
    let http = reqwest::Client::builder().no_proxy().build().unwrap();
    let root = tempfile::tempdir().unwrap();
    let operation = Arc::new(Mutex::new(None::<String>));
    let model_operation = Arc::clone(&operation);
    let mut step = 0;
    let model = ModelFixture::start_with_script(Wire::Chat, json!({"data":[]}), move |capture| {
        step += 1;
        let mut input = json!({"query":"Rust release"});
        match step {
            1 => {}
            2 => {
                assert_eq!(
                    latest_result(&capture.history())["errorCode"],
                    "INTEGRATION_PRICE_ACCEPTANCE_REQUIRED"
                );
                input["price_version"] = json!("fixture.v1");
                input["max_credits"] = json!("6");
            }
            3 => {
                assert_eq!(
                    latest_result(&capture.history())["errorCode"],
                    "INTEGRATION_BUDGET_EXCEEDED"
                );
                input["price_version"] = json!("fixture.v1");
                input["max_credits"] = json!("7");
            }
            5 => {
                input["price_version"] = json!("fixture.v1");
                input["max_credits"] = json!("7");
                input["operation_key"] = json!(model_operation.lock().unwrap().as_ref().unwrap());
            }
            7 => {
                input["query"] = json!("A new search after the price changed");
                input["price_version"] = json!("fixture.v1");
                input["max_credits"] = json!("7");
            }
            _ => return None,
        }
        Some((format!("billed-search-{step}"), "WebSearch".into(), input))
    })
    .await;
    let roots =
        app_server::StorageRoots::initialize(root.path().join("app"), root.path().join("agent"))
            .unwrap();
    let db = lime_core::database::init_database_at_path(&roots.product_db_path).unwrap();
    support::seed_chat_providers(
        &db,
        &[(
            "native-joint-model",
            Wire::Chat.model(),
            Wire::Chat.provider_type(),
            &model.url,
            Wire::Chat.credential(),
        )],
        false,
    );
    drop(db);
    std::fs::write(
        root.path().join("config.yaml"),
        json!({"cloud":{"base_url":core}}).to_string(),
    )
    .unwrap();
    let mut peer =
        TransportClient::start_stdio(Path::new(&binary), root.path(), "native-billed").await;
    peer.set_read_timeout(Duration::from_secs(60));
    let started = peer.request_ok(2, "thread/start", json!({"cwd":root.path(),"modelProvider":"native-joint-model","model":Wire::Chat.model(),"config":{"web_search":"live","approval_policy":"never"}})).await;
    let thread = started["result"]["thread"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let started = peer.request_ok(3, "turn/start", json!({"threadId":thread,"input":[{"type":"text","text":"Search within the explicitly accepted limit of 7 test credits."}]})).await;
    let turn = started["result"]["turn"]["id"].as_str().unwrap().to_owned();
    authorize_web_task(&mut peer, &http, &browser, &thread).await;
    tokio::time::timeout(
        Duration::from_secs(60),
        peer.wait_for_turn_completed(&thread, &turn),
    )
    .await
    .unwrap();
    assert_eq!(model.request_count(), 4);
    let first = latest_operation(&model.last_request().history()).unwrap();
    assert_eq!(first["status"], "completed");
    assert_eq!(first["usage"]["billingStatus"], "settled");
    assert_eq!(
        first["usage"]["billing"],
        json!({"priceVersion":"fixture.v1","unit":"credit","creditsPerUnit":"7","reservedCredits":"7","chargedCredits":"7","quantity":"1"})
    );
    assert!(first.to_string().contains("native-cloud-core-result"));
    let key = first["operationKey"].as_str().unwrap().to_owned();
    *operation.lock().unwrap() = Some(key.clone());
    peer.shutdown().await;
    assert_eq!(
        http.post(format!("{browser}/change-price"))
            .send()
            .await
            .unwrap()
            .status()
            .as_u16(),
        204
    );

    peer =
        TransportClient::start_stdio(Path::new(&binary), root.path(), "native-billed-cold").await;
    peer.set_read_timeout(Duration::from_secs(60));
    peer.request_ok(4, "thread/resume", json!({"threadId":thread}))
        .await;
    complete_turn(&mut peer, 5, &thread, "Recover the original billed result.").await;
    assert_eq!(model.request_count(), 6);
    let restored = latest_operation(&model.last_request().history()).unwrap();
    assert_eq!(
        restored, first,
        "changed live prices cannot change an original bill"
    );
    complete_turn(&mut peer, 6, &thread, "Try the old price for a new search.").await;
    assert_eq!(model.request_count(), 8);
    let refused = latest_result(&model.last_request().history());
    assert_eq!(refused["errorCode"], "INTEGRATION_PRICE_CHANGED");
    assert_eq!(refused["executionStarted"], false);
    assert!(refused.get("operationKey").is_none());
    let summary = peer.request_ok(7, "cloud/request", json!({"path":format!("/recovery/web/operations/{key}"),"method":"GET","language":"en-US"})).await;
    assert_eq!(summary["result"]["status"], 200);
    assert_eq!(summary["result"]["body"]["usage"], first["usage"]);
    assert_eq!(summary["result"]["body"]["recoveryOnly"], true);
    assert!(summary["result"]["body"].get("search").is_none());
    assert_eq!(
        http.post(format!("{browser}/revoke"))
            .send()
            .await
            .unwrap()
            .status()
            .as_u16(),
        204
    );
    let revoked = peer.request_ok(8, "cloud/request", json!({"path":format!("/recovery/web/operations/{key}"),"method":"GET","language":"en-US"})).await;
    assert_eq!(revoked["result"]["status"], 401);
    assert!(revoked["result"]["body"].get("usage").is_none());
    let canonical = peer
        .request_ok(
            9,
            "thread/read",
            json!({"threadId":thread,"includeTurns":true}),
        )
        .await;
    assert_eq!(
        canonical["result"]["thread"]["turns"]
            .as_array()
            .unwrap()
            .len(),
        3
    );
    assert!(canonical.to_string().contains("native-cloud-core-result"));
    for projection in [
        canonical.to_string(),
        model.last_request().history().to_string(),
        summary.to_string(),
        revoked.to_string(),
    ] {
        for secret in [
            "access_token",
            "refresh_token",
            "code_verifier",
            "client_secret",
        ] {
            assert!(!projection.contains(secret));
        }
    }
    if let Ok(evidence) = std::env::var("LIME_NATIVE_JOINT_EVIDENCE") {
        let value = json!({"modelRequests":model.request_count(),"coldResultEqual":restored==first,"chargedCredits":first["usage"]["billing"]["chargedCredits"],"originalPriceVersion":first["usage"]["billing"]["priceVersion"],"newPriceVersion":refused["quote"]["price"]["priceVersion"],"restrictedSummaryPreserved":summary["result"]["body"]["usage"]==first["usage"],"revokedStatus":revoked["result"]["status"],"canonicalTurns":3});
        std::fs::write(
            Path::new(&evidence).join("native-billing.json"),
            serde_json::to_vec_pretty(&value).unwrap(),
        )
        .unwrap();
    }
    peer.shutdown().await;
}

fn latest_result(value: &Value) -> Value {
    let messages = value.as_array().unwrap();
    let message = messages
        .iter()
        .rev()
        .find(|message| message["role"] == "tool")
        .unwrap();
    serde_json::from_str(message["content"].as_str().unwrap()).unwrap()
}

async fn complete_turn(peer: &mut TransportClient, id: u64, thread: &str, text: &str) {
    let started = peer
        .request_ok(
            id,
            "turn/start",
            json!({"threadId":thread,"input":[{"type":"text","text":text}]}),
        )
        .await;
    let turn = started["result"]["turn"]["id"].as_str().unwrap();
    tokio::time::timeout(
        Duration::from_secs(60),
        peer.wait_for_turn_completed(thread, turn),
    )
    .await
    .unwrap();
}
