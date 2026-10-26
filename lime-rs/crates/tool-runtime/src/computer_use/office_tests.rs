use super::*;
use serde_json::json;

fn window() -> ComputerUseTarget {
    serde_json::from_value(json!({
        "identity": {"type":"native", "appId":"com.kingsoft.wpsoffice.mac", "processId":42, "windowId":"100", "title":"Fixture.xlsx"},
        "nativeApp":{"type":"macos", "bundleId":"com.kingsoft.wpsoffice.mac"},
        "locked":false, "capabilities":["observe","screenshot","click","type","key"]
    })).unwrap()
}

fn windows_window() -> ComputerUseTarget {
    serde_json::from_value(json!({
        "identity": {"type":"native", "appId": r"win32:\\?\c:\program files\wps office\et.exe", "processId":42, "windowId":"100:7", "title":"Fixture.xlsx"},
        "nativeApp":{"type":"windows", "aumid":null, "publisherName":"CN=Fixture Publisher", "productName":"WPS Office", "binaryName":"et.exe"},
        "locked":false, "capabilities":["observe","screenshot","click","type","key"]
    })).unwrap()
}

#[test]
fn windows_wps_discovery_binds_app_path_and_signed_identity_to_the_document_session() {
    let native = windows_window();
    let first = wps_identity(&native, 1).unwrap();
    assert!(wps_identity(&native, 0).is_none());
    for field in ["publisherName", "aumid"] {
        let mut value = serde_json::to_value(&native).unwrap();
        value["nativeApp"][field] = json!("Changed identity");
        let changed = serde_json::from_value(value).unwrap();
        assert!(!same_target(&first, &wps_identity(&changed, 1).unwrap()));
    }
    let mut changed = native.clone();
    if let ComputerUseTargetIdentity::Native { app_id, .. } = &mut changed.identity {
        *app_id = r"win32:\\?\c:\other installation\et.exe".into();
    }
    assert!(!same_target(&first, &wps_identity(&changed, 1).unwrap()));
    let mut uppercase = native;
    if let Some(NativeAppIdentity::Windows {
        binary_name,
        product_name,
        ..
    }) = &mut uppercase.native_app
    {
        *binary_name = "ET.EXE".into();
        *product_name = "wps office".into();
    }
    assert!(wps_identity(&uppercase, 1).is_some());
}

#[test]
fn windows_wps_rejects_unverified_metadata_impostor_paths_and_incomplete_targets() {
    let original = serde_json::to_value(windows_window()).unwrap();
    for (section, field, invalid) in [
        ("nativeApp", "publisherName", json!(" ")),
        ("nativeApp", "productName", json!("WPS Office Impostor")),
        ("nativeApp", "binaryName", json!("other.exe")),
        ("nativeApp", "binaryName", json!(r"directory\et.exe")),
        ("nativeApp", "aumid", json!("")),
        ("identity", "appId", json!("et.exe")),
        ("identity", "appId", json!(r"win32:\\?\c:\wps\other.exe")),
        ("identity", "appId", json!(r"win32:\\?\et.exe")),
        ("identity", "processId", json!(0)),
        ("identity", "windowId", json!(" ")),
        ("identity", "title", json!(" ")),
    ] {
        let mut value = original.clone();
        value[section][field] = invalid;
        assert!(
            wps_identity(&serde_json::from_value(value).unwrap(), 1).is_none(),
            "{field}"
        );
    }
    let mut absent = original;
    absent["nativeApp"] = serde_json::Value::Null;
    assert!(wps_identity(&serde_json::from_value(absent).unwrap(), 1).is_none());
}

#[test]
fn windows_wps_uses_office_switch_and_exact_persistent_native_rules() {
    let mut target = windows_window();
    target.identity = wps_identity(&target, 1).unwrap();
    let policy = ComputerUsePolicy {
        native_enabled: Some(false),
        office_enabled: Some(true),
        ..Default::default()
    };
    assert!(policy
        .check_office_native(&target, ComputerUseGrantScope::Session, false)
        .is_err());
    assert!(policy
        .check_office_native(&target, ComputerUseGrantScope::Session, true)
        .is_ok());
    let persistent = policy
        .with_persistent_approval(ComputerUseAdapterKind::Office, &target)
        .unwrap();
    assert_eq!(persistent.native_enabled, Some(false));
    assert!(persistent
        .check_office_native(&target, ComputerUseGrantScope::Persistent, false)
        .is_ok());
    let mut other = target.clone();
    if let Some(NativeAppIdentity::Windows { publisher_name, .. }) = &mut other.native_app {
        *publisher_name = "CN=Other Publisher".into();
    }
    assert!(persistent
        .check_office_native(&other, ComputerUseGrantScope::Persistent, false)
        .is_err());
    let rules = json!({"windows":{"exes":[{
        "publisher_name":"CN=Fixture Publisher", "product_name":"WPS Office", "binary_name":"et.exe", "access":"deny"
    }]}});
    for field in ["user", "admin"] {
        let mut denied = persistent.clone();
        if field == "user" {
            denied.user = Some(serde_json::from_value(rules.clone()).unwrap());
        } else {
            denied.admin = Some(serde_json::from_value(rules.clone()).unwrap());
        }
        assert!(
            denied
                .check_office_native(&target, ComputerUseGrantScope::Persistent, true)
                .is_err(),
            "{field}"
        );
        assert!(denied
            .with_persistent_approval(ComputerUseAdapterKind::Office, &target)
            .is_err());
    }
}

#[test]
fn wps_discovery_requires_verified_identity_and_helper_session_is_authority() {
    let mut native = window();
    let first = wps_identity(&native, 1).unwrap();
    assert!(!same_target(&first, &wps_identity(&native, 2).unwrap()));
    if let ComputerUseTargetIdentity::Native { title, .. } = &mut native.identity {
        *title = Some("Another.xlsx".into());
    }
    assert!(!same_target(&first, &wps_identity(&native, 1).unwrap()));
    native.native_app = None;
    assert!(wps_identity(&native, 1).is_none());
    native.native_app = Some(NativeAppIdentity::Macos {
        bundle_id: "other.app".into(),
    });
    assert!(wps_identity(&native, 1).is_none());
}

#[test]
fn wps_switch_is_independent_and_app_denials_lock_and_consent_still_apply() {
    let mut target = window();
    target.identity = wps_identity(&target, 1).unwrap();
    let mut policy = ComputerUsePolicy {
        native_enabled: Some(false),
        office_enabled: Some(true),
        ..Default::default()
    };
    assert!(policy
        .check_office_native(&target, ComputerUseGrantScope::Session, true)
        .is_ok());
    assert!(policy
        .check_office_native(&target, ComputerUseGrantScope::Session, false)
        .is_err());
    assert!(policy
        .check_office_native(&target, ComputerUseGrantScope::Persistent, true)
        .is_err());
    target.locked = true;
    assert!(policy
        .check_office_native(&target, ComputerUseGrantScope::Session, true)
        .is_err());
    target.locked = false;
    policy.user = Some(
        serde_json::from_value(
            json!({"macos":{"bundle_ids":{"com.kingsoft.wpsoffice.mac":"deny"}}}),
        )
        .unwrap(),
    );
    assert!(policy
        .check_office_native(&target, ComputerUseGrantScope::Session, true)
        .is_err());
    policy.user = None;
    policy.office_enabled = Some(false);
    assert!(policy
        .check_office_native(&target, ComputerUseGrantScope::Session, true)
        .is_err());
    // A connected add-in cannot invent a verified OS identity.
    assert!(policy
        .check_extension(&target.identity, ComputerUseGrantScope::Session, true)
        .is_err());
}

#[test]
fn discovered_wps_identity_is_accepted_by_the_advertised_model_schema() {
    let validator = jsonschema::validator_for(&super::super::tool_schema::input_schema()).unwrap();
    for native in [window(), windows_window()] {
        let target = wps_identity(&native, 1).unwrap();
        let input = json!({"target":target,"operation":{"action":"type","text":"Lime WPS 🟢"}});
        assert!(validator.is_valid(&input));
        let mut invalid = input;
        invalid["target"]["host"] = json!("UntrustedOffice");
        assert!(!validator.is_valid(&invalid));
    }
}
