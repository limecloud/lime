use super::*;
use serde_json::json;

fn window() -> ComputerUseTarget {
    serde_json::from_value(json!({
        "identity": {"type":"native", "appId":"com.kingsoft.wpsoffice.mac", "processId":42, "windowId":"100", "title":"Fixture.xlsx"},
        "nativeApp":{"type":"macos", "bundleId":"com.kingsoft.wpsoffice.mac"},
        "locked":false, "capabilities":["observe","screenshot","click","type","key"]
    })).unwrap()
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
    let target = wps_identity(&window(), 1).unwrap();
    let validator = jsonschema::validator_for(&super::super::tool_schema::input_schema()).unwrap();
    let input = json!({"target":target,"operation":{"action":"type","text":"Lime WPS 🟢"}});
    assert!(validator.is_valid(&input));
    let mut invalid = input;
    invalid["target"]["host"] = json!("UntrustedOffice");
    assert!(!validator.is_valid(&invalid));
}
