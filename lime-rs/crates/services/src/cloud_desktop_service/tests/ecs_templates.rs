use super::*;

#[tokio::test]
async fn launch_template_listing_returns_only_selection_metadata() {
    let (directory, service, _) = super::ecs_purchase::fixture();
    let data = service
        .request(CloudDesktopParams::ListEcsTemplates {
            region_id: "cn-test".into(),
            profile: "lime".into(),
        })
        .await
        .unwrap()
        .data;
    assert_eq!(
        data,
        json!({"templates":[{"id":"lt-test","name":"Linux desktop","version":1}]})
    );
    assert!(!data.to_string().contains("must-not-project"));
    fs::write(directory.path().join("duplicate-templates"), "").unwrap();
    assert!(service
        .request(CloudDesktopParams::ListEcsTemplates {
            region_id: "cn-test".into(),
            profile: "lime".into(),
        })
        .await
        .unwrap_err()
        .contains("Duplicate"));
}

#[tokio::test]
async fn exact_template_version_fills_the_existing_quote_and_encryption_contract() {
    let (_directory, service, expected) = super::ecs_purchase::fixture();
    let data = service
        .request(CloudDesktopParams::QuoteEcsTemplate {
            region_id: "cn-test".into(),
            profile: "lime".into(),
            launch_template_id: "lt-test".into(),
            version: 1,
        })
        .await
        .unwrap()
        .data;
    assert_eq!(data["spec"], serde_json::to_value(expected).unwrap());
    assert_eq!(data["template"]["version"], 1);
    assert_eq!(data["quote"]["price"]["systemDiskEncrypted"], true);
    assert_eq!(data["quote"]["amount"], 1);
    assert_eq!(data["quote"]["autoRenew"], false);
    assert!(data["quoteId"].as_str().is_some_and(|v| v.len() == 64));
}

#[tokio::test]
async fn templates_without_an_ssh_keypair_quote_without_keypair_inventory() {
    for key in [None, Some(Value::Null), Some(json!(""))] {
        let (directory, service, mut expected) = super::ecs_purchase::fixture();
        expected.key_pair_name.clear();
        if let Some(key) = key {
            fs::write(
                directory.path().join("template-keypair.json"),
                serde_json::to_vec(&key).unwrap(),
            )
            .unwrap();
        } else {
            fs::write(directory.path().join("template-no-key"), "").unwrap();
        }
        let data = service
            .request(CloudDesktopParams::QuoteEcsTemplate {
                region_id: "cn-test".into(),
                profile: "lime".into(),
                launch_template_id: "lt-test".into(),
                version: 1,
            })
            .await
            .unwrap()
            .data;
        assert_eq!(data["spec"], serde_json::to_value(expected).unwrap());
        assert_eq!(data["quote"]["price"]["systemDiskEncrypted"], true);
        let calls = fs::read_to_string(directory.path().join("calls")).unwrap();
        assert!(calls.contains("DescribePrice"));
        assert!(!calls.contains("DescribeKeyPairs"));
        assert!(!calls.contains("RunInstances"));
    }
}

#[tokio::test]
async fn malformed_template_keypair_cannot_become_a_keyless_purchase() {
    for key in [json!(false), json!([]), json!({}), json!(" ")] {
        let (directory, service, _) = super::ecs_purchase::fixture();
        fs::write(
            directory.path().join("template-keypair.json"),
            serde_json::to_vec(&key).unwrap(),
        )
        .unwrap();
        assert!(service
            .request(CloudDesktopParams::QuoteEcsTemplate {
                region_id: "cn-test".into(),
                profile: "lime".into(),
                launch_template_id: "lt-test".into(),
                version: 1,
            })
            .await
            .is_err());
        let calls = fs::read_to_string(directory.path().join("calls")).unwrap();
        assert!(!calls.contains("DescribePrice"));
        assert!(!calls.contains("RunInstances"));
    }
}

#[tokio::test]
async fn unsupported_template_side_effects_and_mismatched_versions_fail_before_quoting() {
    for (flag, reason) in [
        ("template-userdata", "UserData"),
        ("template-extra-disk", "DataDisks"),
        ("wrong-template-version", "version"),
    ] {
        let (directory, service, _) = super::ecs_purchase::fixture();
        fs::write(directory.path().join(flag), "").unwrap();
        let error = service
            .request(CloudDesktopParams::QuoteEcsTemplate {
                region_id: "cn-test".into(),
                profile: "lime".into(),
                launch_template_id: "lt-test".into(),
                version: 1,
            })
            .await
            .unwrap_err();
        assert!(error.contains(reason), "{error}");
        assert!(!error.contains("must-not-project-secret"));
        let calls = fs::read_to_string(directory.path().join("calls")).unwrap();
        assert!(!calls.contains("DescribePrice"));
        assert!(!calls.contains("RunInstances"));
    }
}
