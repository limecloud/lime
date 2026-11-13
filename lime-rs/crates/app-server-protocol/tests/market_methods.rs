use app_server_protocol::protocol::v2::Method;

#[test]
fn market_methods_use_the_same_wire_names_for_serde_and_dispatch() {
    for name in [
        "market/list",
        "market/read",
        "market/install",
        "market/installed",
        "market/enabled/set",
        "market/uninstall",
        "market/install/pending",
        "market/install/cancel",
        "market/reconcile",
        "plugin/list",
    ] {
        let method = Method::parse(name).unwrap();
        assert!(app_server_protocol::app_server_method_catalog().iter().any(|entry| entry.method == name));
        assert_eq!(method.as_str(), name);
        let serialized = serde_json::to_value(method).unwrap();
        assert_eq!(serialized, name);
        assert_eq!(
            serde_json::from_value::<Method>(serialized).unwrap(),
            method
        );
    }
}
