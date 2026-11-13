use super::*;
use crate::cloud_desktop_service::tests::ecs_purchase::{calls, fixture, is_paid_purchase};
use std::os::unix::fs::{symlink, PermissionsExt};

async fn quote(service: &CloudDesktopService, spec: &EcsDesktopSpec) -> Value {
    service
        .request(CloudDesktopParams::QuoteEcs { spec: spec.clone() })
        .await
        .unwrap()
        .data
}

fn purchase(spec: &EcsDesktopSpec, quote: &Value) -> CloudDesktopParams {
    let id = quote["quoteId"].as_str().unwrap();
    CloudDesktopParams::PurchaseEcs {
        spec: spec.clone(),
        desktop_name: "Lime-test".into(),
        operation_id: "network-preflight".into(),
        quote_id: id.into(),
        confirmation: format!("purchase:ecs:cn-test:Lime-test:{id}"),
    }
}

fn proof_path(service: &CloudDesktopService, quote: &Value) -> std::path::PathBuf {
    service.root.join(format!(
        "quote-network-{}.json",
        quote["quoteId"].as_str().unwrap()
    ))
}

async fn ready(service: &CloudDesktopService, spec: &EcsDesktopSpec, quote: &Value) -> Value {
    service
        .preflight_ecs_purchase_with_network(
            spec,
            quote["quoteId"].as_str().unwrap(),
            std::future::ready(Ok(())),
        )
        .await
        .unwrap()
}

fn purchase_calls(directory: &Path) -> usize {
    calls(directory)
        .iter()
        .filter(|args| args[1] == "RunInstances")
        .count()
}

#[tokio::test]
async fn no_network_check_means_explicit_non_submission_without_an_unknown_receipt() {
    let (directory, service, spec) = fixture();
    let quote = quote(&service, &spec).await;
    let result = service.request(purchase(&spec, &quote)).await.unwrap().data;
    assert_eq!(result["outcome"], "notSubmitted");
    assert_eq!(result["submitted"], false);
    assert_eq!(result["requiresInspection"], false);
    assert_eq!(result["diagnostic"], REQUIRED);
    assert!(service.read_receipt("network-preflight").unwrap().is_none());
    assert_eq!(purchase_calls(directory.path()), 0);
}

#[tokio::test]
async fn a_failed_observation_does_not_write_proof_or_change_cloud_resources() {
    let (directory, service, spec) = fixture();
    let quote = quote(&service, &spec).await;
    let before = fs::read(directory.path().join("calls")).unwrap();
    let result = service
        .preflight_ecs_purchase_with_network(
            &spec,
            quote["quoteId"].as_str().unwrap(),
            std::future::ready(Err("network unavailable".into())),
        )
        .await;
    assert_eq!(result.unwrap_err(), "network unavailable");
    assert!(!proof_path(&service, &quote).exists());
    assert_eq!(fs::read(directory.path().join("calls")).unwrap(), before);
}

#[tokio::test]
async fn invalid_identifiers_and_different_specs_fail_before_polling_network() {
    let (_directory, service, spec) = fixture();
    let quote = quote(&service, &spec).await;
    for id in ["../outside", "", "z".repeat(64).as_str()] {
        assert!(service
            .preflight_ecs_purchase_with_network(&spec, id, async {
                panic!("invalid quote must not poll network")
            })
            .await
            .is_err());
    }
    let mut other = spec;
    other.outbound_mbps += 1;
    assert!(service
        .preflight_ecs_purchase_with_network(&other, quote["quoteId"].as_str().unwrap(), async {
            panic!("different spec must not poll network")
        },)
        .await
        .is_err());
}

#[tokio::test]
async fn a_quote_invalidated_during_network_wait_cannot_write_a_success_record() {
    for corruption in ["expired", "integrity"] {
        let (_directory, service, spec) = fixture();
        let quote = quote(&service, &spec).await;
        let id = quote["quoteId"].as_str().unwrap();
        let path = service.root.join(format!("quote-{id}.json"));
        let network = async {
            let mut changed = quote["quote"].clone();
            if corruption == "expired" {
                changed["expiresAt"] =
                    json!((Utc::now() - chrono::Duration::seconds(1)).to_rfc3339());
            } else {
                changed["price"]["hourlyPrice"] = json!(999);
            }
            fs::write(path, serde_json::to_vec(&changed).unwrap()).unwrap();
            Ok(())
        };
        assert!(service
            .preflight_ecs_purchase_with_network(&spec, id, network)
            .await
            .is_err());
        assert!(!proof_path(&service, &quote).exists());
    }
}

#[tokio::test]
async fn valid_private_proof_preserves_quote_bytes_and_is_not_operation_history() {
    let (directory, service, spec) = fixture();
    let quote = quote(&service, &spec).await;
    let id = quote["quoteId"].as_str().unwrap();
    let quote_path = service.root.join(format!("quote-{id}.json"));
    let before = fs::read(&quote_path).unwrap();
    let calls = fs::read(directory.path().join("calls")).unwrap();
    let proof = ready(&service, &spec, &quote).await;
    assert_eq!(proof.as_object().unwrap().len(), 4);
    assert_eq!(proof["quoteId"], id);
    assert_eq!(proof["networkReady"], true);
    assert_eq!(
        fs::metadata(proof_path(&service, &quote))
            .unwrap()
            .permissions()
            .mode()
            & 0o777,
        0o600
    );
    service
        .require_ecs_purchase_preflight(&quote["quote"], id)
        .unwrap();
    assert_eq!(fs::read(quote_path).unwrap(), before);
    assert_eq!(fs::read(directory.path().join("calls")).unwrap(), calls);
    assert_eq!(service.list_resources().unwrap()["operations"], json!([]));
}

#[tokio::test]
async fn invalid_or_non_private_proofs_never_allow_purchase() {
    for corruption in [
        "expired",
        "future",
        "long",
        "wrong-id",
        "not-ready",
        "malformed",
        "oversized",
        "shared",
        "symlink",
        "hardlink",
    ] {
        let (directory, service, spec) = fixture();
        let quote = quote(&service, &spec).await;
        let mut proof = ready(&service, &spec, &quote).await;
        let path = proof_path(&service, &quote);
        match corruption {
            "expired" => {
                proof["checkedAt"] =
                    json!((Utc::now() - chrono::Duration::seconds(120)).to_rfc3339());
                proof["expiresAt"] =
                    json!((Utc::now() - chrono::Duration::seconds(60)).to_rfc3339());
            }
            "future" => {
                proof["checkedAt"] = json!((Utc::now() + chrono::Duration::seconds(1)).to_rfc3339())
            }
            "long" => {
                proof["expiresAt"] = json!((Utc::now() + chrono::Duration::minutes(2)).to_rfc3339())
            }
            "wrong-id" => proof["quoteId"] = json!("b".repeat(64)),
            "not-ready" => proof["networkReady"] = json!(false),
            _ => {}
        }
        fs::write(&path, serde_json::to_vec(&proof).unwrap()).unwrap();
        match corruption {
            "malformed" => fs::write(&path, "{").unwrap(),
            "oversized" => fs::write(&path, " ".repeat(1025)).unwrap(),
            "shared" => fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).unwrap(),
            "symlink" => {
                let target = directory.path().join("proof-target");
                fs::rename(&path, &target).unwrap();
                symlink(target, &path).unwrap();
            }
            "hardlink" => fs::hard_link(&path, directory.path().join("proof-link")).unwrap(),
            _ => {}
        }
        let result = service.request(purchase(&spec, &quote)).await.unwrap().data;
        assert_eq!(result["diagnostic"], REQUIRED, "{corruption}");
        assert_eq!(result["outcome"], "notSubmitted", "{corruption}");
        assert!(service.read_receipt("network-preflight").unwrap().is_none());
        assert_eq!(purchase_calls(directory.path()), 0);
    }
}

#[tokio::test]
async fn proof_is_rechecked_after_provider_reads_before_any_paid_submission() {
    let (directory, service, spec) = fixture();
    let quote = quote(&service, &spec).await;
    ready(&service, &spec, &quote).await;
    let script = fs::read_to_string(&service.cli).unwrap();
    let check = format!(
        "if action == 'DescribePrice':\n (root/'receipts'/'{}').write_text('{{}}')\n",
        proof_path(&service, &quote)
            .file_name()
            .unwrap()
            .to_str()
            .unwrap()
    );
    fs::write(
        &service.cli,
        script.replace(
            "print(json.dumps(result))",
            &(check + "print(json.dumps(result))"),
        ),
    )
    .unwrap();
    let result = service.request(purchase(&spec, &quote)).await.unwrap().data;
    assert_eq!(result["diagnostic"], REQUIRED);
    assert_eq!(result["outcome"], "notSubmitted");
    assert_eq!(purchase_calls(directory.path()), 0);
}

#[tokio::test]
async fn lost_purchase_response_replays_original_receipt_without_fresh_network_or_resubmission() {
    let (directory, service, spec) = fixture();
    let quote = quote(&service, &spec).await;
    ready(&service, &spec, &quote).await;
    fs::write(directory.path().join("lost-response"), "").unwrap();
    fs::write(directory.path().join("invisible"), "").unwrap();
    let request = purchase(&spec, &quote);
    let receipt = service.request(request.clone()).await.unwrap();
    assert_eq!(receipt.data["outcome"], "unknown");
    // Invalid proof cannot block inspection of the already submitted request.
    fs::write(proof_path(&service, &quote), "{}").unwrap();
    assert_eq!(service.request(request).await.unwrap(), receipt);
    let calls = calls(directory.path());
    assert_eq!(
        calls.iter().filter(|args| is_paid_purchase(args)).count(),
        1
    );
    assert_eq!(
        calls
            .iter()
            .filter(|args| args[1] == "RunInstances"
                && args.windows(2).any(|pair| pair == ["--DryRun", "true"]))
            .count(),
        1
    );
}
