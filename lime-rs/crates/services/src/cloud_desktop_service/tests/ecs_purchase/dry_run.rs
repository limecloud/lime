use super::*;

fn dry_runs(calls: &[Vec<String>]) -> Vec<&Vec<String>> {
    calls
        .iter()
        .filter(|args| args[1] == "RunInstances" && !is_paid_purchase(args))
        .collect()
}

#[tokio::test]
async fn provider_check_precedes_one_durable_purchase_with_the_same_resource_specification() {
    let (directory, service, spec) = fixture();
    let request = purchase_request(&service, spec).await;
    let result = service.request(request.clone()).await.unwrap().data;
    assert_eq!(result["outcome"], "provisioned");
    service.request(request).await.unwrap();
    let calls = calls(directory.path());
    let checks = dry_runs(&calls);
    let purchases: Vec<_> = calls.iter().filter(|args| is_paid_purchase(args)).collect();
    assert_eq!(checks.len(), 1);
    assert_eq!(purchases.len(), 1);
    let mut checked = checks[0].clone();
    let index = checked.iter().position(|arg| arg == "--DryRun").unwrap();
    checked.drain(index..index + 2);
    let mut submitted = purchases[0].clone();
    let index = submitted
        .iter()
        .position(|arg| arg == "--ClientToken")
        .unwrap();
    submitted.drain(index..index + 2);
    assert_eq!(checked, submitted);
    let check_index = calls.iter().position(|args| args == checks[0]).unwrap();
    let purchase_index = calls
        .iter()
        .position(|args| is_paid_purchase(args))
        .unwrap();
    assert!(check_index < purchase_index);
}

#[tokio::test]
async fn provider_business_rejections_never_submit_or_create_an_unknown_receipt() {
    for code in [
        "InvalidAccountStatus.NotEnoughBalance",
        "Forbidden.RAM",
        "Zone.NotOnSale",
    ] {
        let (directory, service, spec) = fixture();
        let request = purchase_request(&service, spec).await;
        fs::write(directory.path().join("dry-run-error.txt"), format!(
            "ErrorCode: {code}\nRequestId: rejected-test\nMessage: DryRunOperation must-not-project-secret"
        )).unwrap();
        let result = service.request(request).await.unwrap().data;
        assert_eq!(result["outcome"], "notSubmitted", "{code}");
        assert_eq!(result["submitted"], false);
        assert_eq!(result["requiresInspection"], false);
        assert_eq!(result["providerCode"], code);
        assert!(result["diagnostic"].as_str().unwrap().contains(code));
        assert!(!result.to_string().contains("must-not-project-secret"));
        assert!(!service.root.join("operation-1.json").exists());
        assert!(!directory.path().join("created").exists());
        let calls = calls(directory.path());
        assert_eq!(dry_runs(&calls).len(), 1);
        assert_eq!(
            calls.iter().filter(|args| is_paid_purchase(args)).count(),
            0
        );
    }
}

#[tokio::test]
async fn only_an_exact_unambiguous_provider_error_can_confirm_the_check() {
    for error in [
        "Message: DryRunOperation",
        "ErrorCode: DryRunOperation.Other",
        "ErrorCode: DryRunOperation\nErrorCode: Denied",
        "ErrorCode: DryRunOperation\nCode: Denied",
        "ErrorCode: DryRunOperation?secret=must-not-project-secret",
        r#"{"Code":"Denied","Message":"DryRunOperation"}"#,
        r#"{"Code":"DryRunOperation","ErrorCode":"Denied"}"#,
        r#"{"Code":"Denied","Code":"DryRunOperation"}"#,
        r#"{"Code":true,"Message":"DryRunOperation"}"#,
        "ErrorCode: dryrunoperation",
        "ERROR: DryRunOperation",
        "",
    ] {
        let (directory, service, spec) = fixture();
        let request = purchase_request(&service, spec).await;
        fs::write(directory.path().join("dry-run-error.txt"), error).unwrap();
        let result = service.request(request).await.unwrap().data;
        assert_eq!(result["outcome"], "notSubmitted", "{error}");
        assert!(result["providerCode"]
            .as_str()
            .is_none_or(|code| code != "DryRunOperation"));
        assert!(!result.to_string().contains("must-not-project-secret"));
        assert!(!service.root.join("operation-1.json").exists());
        assert!(!directory.path().join("created").exists());
        assert_eq!(
            calls(directory.path())
                .iter()
                .filter(|args| is_paid_purchase(args))
                .count(),
            0
        );
    }
}

#[tokio::test]
async fn a_zero_exit_response_is_not_a_successful_supplier_dry_run() {
    let (directory, service, spec) = fixture();
    let request = purchase_request(&service, spec).await;
    fs::write(directory.path().join("dry-run-zero-exit"), "").unwrap();
    let result = service.request(request).await.unwrap().data;
    assert_eq!(result["outcome"], "notSubmitted");
    assert!(!service.root.join("operation-1.json").exists());
    assert!(!directory.path().join("created").exists());
    assert_eq!(
        calls(directory.path())
            .iter()
            .filter(|args| is_paid_purchase(args))
            .count(),
        0
    );
}

#[tokio::test]
async fn approval_and_connectivity_are_checked_again_after_the_provider_check() {
    for marker in [
        "expire-network-during-dry-run",
        "expire-quote-during-dry-run",
    ] {
        let (directory, service, spec) = fixture();
        let request = purchase_request(&service, spec).await;
        fs::write(directory.path().join(marker), "").unwrap();
        let result = service.request(request).await.unwrap().data;
        assert_eq!(result["outcome"], "notSubmitted", "{marker}");
        assert!(!service.root.join("operation-1.json").exists());
        assert_eq!(dry_runs(&calls(directory.path())).len(), 1);
        assert_eq!(
            calls(directory.path())
                .iter()
                .filter(|args| is_paid_purchase(args))
                .count(),
            0
        );
    }
}

#[tokio::test]
async fn a_real_submission_failure_remains_unknown_and_never_repeats_the_check_or_purchase() {
    let (directory, service, spec) = fixture();
    let request = purchase_request(&service, spec).await;
    fs::write(directory.path().join("paid-error"), "").unwrap();
    let result = service.request(request.clone()).await.unwrap().data;
    assert_eq!(result["outcome"], "unknown");
    assert_eq!(result["requiresInspection"], true);
    assert!(!result.to_string().contains("must-not-project-secret"));
    let before = fs::read(service.root.join("operation-1.json")).unwrap();
    let restarted = CloudDesktopService {
        root: service.root.clone(),
        cli: service.cli.clone(),
    };
    assert_eq!(
        restarted.request(request).await.unwrap().data["outcome"],
        "unknown"
    );
    assert_eq!(
        fs::read(service.root.join("operation-1.json")).unwrap(),
        before
    );
    let calls = calls(directory.path());
    assert_eq!(dry_runs(&calls).len(), 1);
    assert_eq!(
        calls.iter().filter(|args| is_paid_purchase(args)).count(),
        1
    );
}

#[tokio::test]
async fn json_provider_error_envelopes_are_supported_without_accepting_a_success_response() {
    for key in ["Code", "ErrorCode", "error_code"] {
        let (directory, service, spec) = fixture();
        let request = purchase_request(&service, spec).await;
        fs::write(directory.path().join("dry-run-error.txt"), format!(
            r#"{{"{key}":"DryRunOperation","RequestId":"check-test","Message":"must-not-project-secret"}}"#
        )).unwrap();
        assert_eq!(
            service.request(request).await.unwrap().data["outcome"],
            "provisioned"
        );
        assert_eq!(dry_runs(&calls(directory.path())).len(), 1);
    }
}
