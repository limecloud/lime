//! Paid cloud purchase must reject missing network proof through the real stdio API.
#![cfg(unix)]
mod support;

use chrono::Utc;
use serde_json::json;
use sha2::{Digest, Sha256};
use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use support::json_lines_transport::TransportClient;

#[tokio::test]
async fn stdio_preflight_validates_exact_quote_and_purchase_cannot_skip_it() {
    let root = tempfile::tempdir().unwrap();
    std::fs::write(root.path().join("config.yaml"), "{}").unwrap();
    let receipts = root.path().join("app/cloud-desktops");
    std::fs::create_dir_all(&receipts).unwrap();
    std::fs::set_permissions(&receipts, std::fs::Permissions::from_mode(0o700)).unwrap();
    let spec = json!({"regionId":"cn-test","profile":"fixture","vSwitchId":"vsw-test",
        "securityGroupId":"sg-test","keyPairName":"","instanceType":"ecs.test.large",
        "imageId":"ubuntu-test","systemDiskGib":80,"outboundMbps":5});
    let quote = json!({"spec":spec,"price":{"hourlyPrice":0.8,"currency":"CNY"},
        "createdAt":Utc::now().to_rfc3339(),
        "expiresAt":(Utc::now()+chrono::Duration::minutes(15)).to_rfc3339(),
        "amount":1,"chargeType":"PostPaid","autoRenew":false,"requiresExplicitPurchase":true});
    let bytes = serde_json::to_vec(&quote).unwrap();
    let quote_id = format!("{:x}", Sha256::digest(&bytes));
    let quote_path = receipts.join(format!("quote-{quote_id}.json"));
    std::fs::write(&quote_path, &bytes).unwrap();
    std::fs::set_permissions(&quote_path, std::fs::Permissions::from_mode(0o600)).unwrap();
    // If any provider command runs, this explicit local fixture leaves evidence.
    let tools = root.path().join("app/tools");
    std::fs::create_dir_all(&tools).unwrap();
    let cli = tools.join("aliyun");
    let marker = root.path().join("unexpected-provider-call");
    std::fs::write(
        &cli,
        format!("#!/bin/sh\ntouch '{}'\nexit 1\n", marker.display()),
    )
    .unwrap();
    std::fs::set_permissions(&cli, std::fs::Permissions::from_mode(0o700)).unwrap();
    let mut peer = TransportClient::start_stdio(
        Path::new(env!("CARGO_BIN_EXE_app-server")),
        root.path(),
        "cloud-purchase-preflight",
    )
    .await;
    for (index, id) in ["../outside".to_owned(), "b".repeat(64)]
        .into_iter()
        .enumerate()
    {
        let response = peer
            .request(
                index as u64 + 2,
                "cloud/desktop",
                json!({"action":"preflightEcsPurchase","spec":spec,"quoteId":id}),
            )
            .await;
        assert!(response["error"]["message"]
            .as_str()
            .unwrap()
            .contains(if index == 0 {
                "Invalid quote identifier"
            } else {
                "Quote is unavailable"
            }));
    }
    let mut other = spec.clone();
    other["outboundMbps"] = json!(10);
    let mismatch = peer
        .request(
            4,
            "cloud/desktop",
            json!({"action":"preflightEcsPurchase","spec":other,"quoteId":quote_id}),
        )
        .await;
    assert!(mismatch["error"]["message"]
        .as_str()
        .unwrap()
        .contains("does not match"));
    let result = peer
        .request_ok(
            5,
            "cloud/desktop",
            json!({"action":"purchaseEcs","spec":spec,
        "quoteId":quote_id,"operationId":"preflight-required","desktopName":"Lime-test",
        "confirmation":format!("purchase:ecs:cn-test:Lime-test:{quote_id}")}),
        )
        .await;
    assert_eq!(
        result["result"]["data"],
        json!({"operationId":"preflight-required",
        "outcome":"notSubmitted","submitted":false,"requiresInspection":false,
        "diagnostic":"CLOUD_PURCHASE_PREFLIGHT_REQUIRED"})
    );
    let listed = peer
        .request_ok(6, "cloud/desktop", json!({"action":"listResources"}))
        .await;
    assert_eq!(
        listed["result"]["data"],
        json!({"resources":[],"operations":[]})
    );
    assert_eq!(std::fs::read(quote_path).unwrap(), bytes);
    assert!(!receipts.join("preflight-required.json").exists());
    assert!(!receipts
        .join(format!("quote-network-{quote_id}.json"))
        .exists());
    assert!(!marker.exists(), "no CLI or paid cloud request may run");
    peer.shutdown().await;
}
