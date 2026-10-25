use super::*;
use crate::protocol::v2::ComputerUseConfig;
use serde_json::json;

#[test]
fn setup_without_grant_scope_defaults_to_session() {
    let params: ComputerUseSetupParams = serde_json::from_value(json!({
        "adapter": "native"
    }))
    .unwrap();
    assert_eq!(params.grant_scope, ComputerUseGrantScope::Session);
    let schema = schemars::schema_for!(ComputerUseSetupParams);
    assert_eq!(
        schema.as_value()["properties"]["grantScope"]["default"],
        "session"
    );
}

#[test]
fn computer_use_config_preserves_upstream_wire_names() {
    let value = json!({
        "default_app_access": "deny",
        "macos": {"bundle_ids": {"com.example.Editor": "allow"}},
        "windows": {
            "aumids": {"Example!App": "deny"},
            "exes": [{"publisher_name":"Example","product_name":"Editor","binary_name":null,"access":"allow"}]
        }
    });
    let config: ComputerUseConfig = serde_json::from_value(value.clone()).unwrap();
    assert_eq!(serde_json::to_value(config).unwrap(), value);
}

#[test]
fn typed_requests_bind_canonical_turn_and_reject_client_authority() {
    let target =
        json!({"type":"native","appId":"com.example.Editor","processId":42,"windowId":"12"});
    let request = json!({"id":1,"method":"computerUse/lease/acquire","params":{
        "adapter":"native","target":target,"threadId":"thread-1","turnId":"turn-1",
        "capability":"click","grantId":"grant-1"
    }});
    let decoded: crate::protocol::v2::ClientRequest =
        serde_json::from_value(request.clone()).unwrap();
    assert_eq!(
        decoded.method(),
        crate::protocol::v2::Method::ComputerUseLeaseAcquire
    );
    assert_eq!(serde_json::to_value(decoded).unwrap(), request);
    assert!(serde_json::from_value::<ComputerUseSetupParams>(
        json!({"adapter":"native","approved":true})
    )
    .is_err());
    let mut unbound = request["params"].clone();
    unbound.as_object_mut().unwrap().remove("turnId");
    assert!(serde_json::from_value::<ComputerUseLeaseAcquireParams>(unbound).is_err());
}
