use super::*;

#[tokio::test]
async fn verified_release_allows_a_fresh_purchase_but_never_reuses_its_quote() {
    let (directory, service, _) = fixture();
    let original = purchase_request(&service).await;
    assert_eq!(
        service.request(original.clone()).await.unwrap().data["outcome"],
        "accepted"
    );
    let resource = CloudDesktopResource {
        provider: CloudDesktopProvider::Wuying,
        region_id: "cn-test".into(),
        profile: "lime".into(),
        resource_id: "ecd-test".into(),
    };
    let mut fresh = purchase_request(&service).await;
    if let CloudDesktopParams::PurchaseWuying { operation_id, .. } = &mut fresh {
        *operation_id = "purchase-2".into();
    }
    assert!(service
        .request(fresh.clone())
        .await
        .unwrap_err()
        .contains("already exists"));
    fs::write(directory.path().join("stopped"), "").unwrap();
    service
        .request(CloudDesktopParams::Release {
            resource,
            operation_id: "release-original".into(),
            confirmation: "release:cn-test:ecd-test:discard-data".into(),
            work_saved: true,
            discard_data: true,
        })
        .await
        .unwrap();
    // Acceptance of deletion alone does not permit a second purchase.
    assert!(service.request(fresh.clone()).await.is_err());
    fs::write(directory.path().join("missing"), "").unwrap();
    assert_eq!(
        service
            .request(CloudDesktopParams::ReadOperation {
                operation_id: "release-original".into()
            })
            .await
            .unwrap()
            .data["outcome"],
        "released"
    );
    let mut reused_quote = original;
    if let CloudDesktopParams::PurchaseWuying { operation_id, .. } = &mut reused_quote {
        *operation_id = "reuse-quote".into();
    }
    assert!(service
        .request(reused_quote)
        .await
        .unwrap_err()
        .contains("already exists"));
    assert_eq!(
        service.request(fresh).await.unwrap().data["outcome"],
        "accepted"
    );
    let calls: Vec<Vec<String>> = fs::read_to_string(directory.path().join("calls"))
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    assert_eq!(
        calls
            .iter()
            .filter(|args| args[1] == "CreateDesktops")
            .count(),
        2
    );
}
