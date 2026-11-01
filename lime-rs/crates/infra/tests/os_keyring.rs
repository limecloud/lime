//! 显式运行的真实 OS 密钥库往返；不读取用户凭据，不使用 mock。
use lime_infra::keyring_store::{DefaultKeyringStore, KeyringStore};

#[test]
#[ignore = "requires an unlocked OS credential store"]
fn os_keyring_round_trip() {
    const SERVICE: &str = "lime.credential-test";
    struct Cleanup(String);
    impl Drop for Cleanup {
        fn drop(&mut self) {
            let _ = DefaultKeyringStore.delete(SERVICE, &self.0);
        }
    }
    let account = Cleanup(uuid::Uuid::new_v4().to_string());
    let store = DefaultKeyringStore;
    assert!(store.load(SERVICE, &account.0).unwrap().is_none());
    store
        .save(SERVICE, &account.0, "generated-test-value")
        .unwrap();
    assert_eq!(
        DefaultKeyringStore
            .load(SERVICE, &account.0)
            .unwrap()
            .as_deref(),
        Some("generated-test-value")
    );
    assert!(store.delete(SERVICE, &account.0).unwrap());
    assert!(store.load(SERVICE, &account.0).unwrap().is_none());
}
