//! The public stdio protocol enforces preservation consent before running cloud tools.
mod support;

use serde_json::json;
use std::path::Path;
use support::json_lines_transport::TransportClient;

#[tokio::test]
async fn stdio_preservation_requires_complete_explicit_consent_and_keeps_reads_passive() {
    let root = tempfile::tempdir().unwrap();
    std::fs::write(root.path().join("config.yaml"), "{}").unwrap();
    let mut peer = TransportClient::start_stdio(
        Path::new(env!("CARGO_BIN_EXE_app-server")),
        root.path(),
        "cloud-preservation",
    )
    .await;
    let original = json!({"action":"hibernateEcs","resource":{"provider":"ecs","profile":"fixture",
        "regionId":"cn-test","resourceId":"i-test"},"operationId":"save-1",
        "confirmation":"hibernateEcs:cn-test:i-test:private-image:discard-data",
        "workSaved":true,"includeCredentials":true,"discardData":true});
    for (index, field) in ["workSaved", "includeCredentials", "discardData"]
        .into_iter()
        .enumerate()
    {
        let mut request = original.clone();
        request[field] = json!(false);
        let response = peer
            .request(index as u64 + 2, "cloud/desktop", request)
            .await;
        assert!(
            response["error"]["message"]
                .as_str()
                .unwrap()
                .contains("explicit consent"),
            "{field}: {response}"
        );
    }
    let response = peer.request(5, "cloud/desktop", json!({"action":"cancelEcsHibernation","operationId":"save-1","confirmation":"cancelEcsHibernation:save-1"})).await;
    assert!(response["error"]["message"]
        .as_str()
        .unwrap()
        .contains("does not exist"));
    for id in [6, 7] {
        let response = peer
            .request(
                id,
                "cloud/desktop",
                json!({"action":"readOperation","operationId":"save-1"}),
            )
            .await;
        assert!(response["error"]["message"]
            .as_str()
            .unwrap()
            .contains("does not exist"));
    }
    let resources = peer
        .request_ok(8, "cloud/desktop", json!({"action":"listResources"}))
        .await;
    assert_eq!(
        resources["result"]["data"],
        json!({"resources":[],"operations":[]})
    );
    assert!(!root.path().join("app/cloud-desktops/save-1.json").exists());
    peer.shutdown().await;
}
