use super::*;

fn headers(token: &str) -> HeaderMap {
    HeaderMap::from_iter([
        (header::ORIGIN, ORIGIN.parse().unwrap()),
        (
            header::AUTHORIZATION,
            format!("Bearer {token}").parse().unwrap(),
        ),
    ])
}

async fn value(response: axum::response::Response) -> Value {
    let body = axum::body::to_bytes(response.into_body(), mailbox::MAX_BYTES as usize)
        .await
        .unwrap();
    serde_json::from_slice(&body).unwrap()
}

#[tokio::test]
async fn paired_document_lifecycle_uses_only_the_injected_mailbox() {
    let temp = tempfile::tempdir().unwrap();
    let directory = temp.path().join("sessions");
    mailbox::private_directory(&directory).unwrap();
    let host = Host {
        token: Uuid::new_v4().to_string(),
        sessions: Default::default(),
        directory: directory.clone(),
    };
    let denied = connect(State(host.clone()), headers("wrong-token")).await;
    assert_eq!(denied.status(), StatusCode::FORBIDDEN);
    assert_eq!(fs::read_dir(&directory).unwrap().count(), 0);

    let response = connect(State(host.clone()), headers(&host.token)).await;
    assert_eq!(response.status(), StatusCode::OK);
    let id = value(response).await["sessionId"]
        .as_str()
        .unwrap()
        .to_owned();
    let session = directory.join(&id);
    assert!(session.join("requests").is_dir());
    assert!(session.join("responses").is_dir());
    let message = json!({
        "sessionId":id,
        "snapshot":{
            "generation":1,"readiness":"ready","reason":null,"setupSteps":[],
            "targets":[{
                "identity":{"type":"office","host":"Excel","workbookId":"book-1","sessionId":id,"workbookName":"Unsaved.xlsx"},
                "nativeApp":null,"locked":false,"capabilities":["observe"]
            }]
        },
        "responses":[]
    });
    let reply = poll(
        State(host.clone()),
        headers(&host.token),
        Json(message.clone()),
    )
    .await;
    assert_eq!(reply.status(), StatusCode::OK);
    assert_eq!(value(reply).await["protocol"], 1);
    let stored = mailbox::read(&session.join("state.json")).unwrap();
    assert_eq!(stored["adapter"], "office");
    assert_eq!(
        stored["snapshot"]["targets"][0]["identity"]["sessionId"],
        id
    );

    let mut wrong_identity = message.clone();
    wrong_identity["snapshot"]["targets"][0]["identity"]["sessionId"] =
        json!(Uuid::new_v4().to_string());
    let rejected = poll(
        State(host.clone()),
        headers(&host.token),
        Json(wrong_identity),
    )
    .await;
    assert_eq!(rejected.status(), StatusCode::BAD_REQUEST);
    assert_eq!(mailbox::read(&session.join("state.json")).unwrap(), stored);

    host.sessions
        .lock()
        .unwrap()
        .insert(id.clone(), mailbox::now() - 60_001);
    let expired = poll(State(host.clone()), headers(&host.token), Json(message)).await;
    assert_eq!(expired.status(), StatusCode::BAD_REQUEST);
    let response = disconnect(
        State(host.clone()),
        headers(&host.token),
        Json(json!({"sessionId":id})),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    assert!(!session.exists());
    assert!(host.sessions.lock().unwrap().is_empty());
}
