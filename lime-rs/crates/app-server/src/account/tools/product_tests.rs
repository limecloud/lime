use super::*;
use std::time::Duration;

#[tokio::test]
async fn concurrent_owners_wait_for_one_original_product_registration() {
    let f = Fixture::start().await;
    let root = tempfile::tempdir().unwrap();
    let config = root.path().join("config.yaml");
    let manager = AccountManager::new(root.path(), &config);
    f.login(&manager, CloudResource::Default).await;
    f.state.lock().unwrap().registration_delay = true;
    let epoch = store::load(&manager.path).unwrap().epoch;
    let cold = AccountManager::new(root.path(), &config);
    let (first, second) = tokio::join!(
        manager.ensure_product_user("zh-CN", &epoch),
        cold.ensure_product_user("zh-CN", &epoch),
    );
    assert!(first.is_ok(), "{first:?}");
    assert!(second.is_ok(), "{second:?}");
    assert_eq!(f.count("/product-users"), 1);
    assert!(f.count("/product-users/self") >= 4);
}

#[tokio::test]
async fn cancelled_registration_wait_never_dispatches_and_a_later_owner_can_register() {
    let f = Fixture::start().await;
    let root = tempfile::tempdir().unwrap();
    let config = root.path().join("config.yaml");
    let manager = AccountManager::new(root.path(), &config);
    f.login(&manager, CloudResource::Default).await;
    let epoch = store::load(&manager.path).unwrap().epoch;
    let lease = store::try_lock(&manager.path.with_file_name("product-user.lock"))
        .unwrap()
        .unwrap();
    let mut pending = Box::pin(manager.ensure_product_user("zh-CN", &epoch));
    assert!(
        tokio::time::timeout(Duration::from_millis(50), &mut pending)
            .await
            .is_err()
    );
    drop(pending);
    assert_eq!(f.count("/product-users"), 0);
    drop(lease);
    let cold = AccountManager::new(root.path(), &config);
    cold.ensure_product_user("zh-CN", &epoch).await.unwrap();
    assert_eq!(f.count("/product-users"), 1);
}

#[tokio::test]
async fn unknown_registration_is_only_read_and_never_dispatched_again() {
    let f = Fixture::start().await;
    let root = tempfile::tempdir().unwrap();
    let config = root.path().join("config.yaml");
    let manager = AccountManager::new(root.path(), &config);
    f.login(&manager, CloudResource::Default).await;
    f.state.lock().unwrap().registration_unknown = true;
    let epoch = store::load(&manager.path).unwrap().epoch;
    assert_eq!(
        manager
            .ensure_product_user("zh-CN", &epoch)
            .await
            .unwrap_err(),
        "outcome_unknown"
    );
    // A missing recovery result still cannot authorize a replacement POST.
    f.state.lock().unwrap().product_registered = false;
    let cold = AccountManager::new(root.path(), &config);
    assert_eq!(
        cold.ensure_product_user("zh-CN", &epoch).await.unwrap_err(),
        "outcome_unknown"
    );
    assert_eq!(f.count("/product-users"), 1);
    f.state.lock().unwrap().product_registered = true;
    cold.ensure_product_user("zh-CN", &epoch).await.unwrap();
    assert_eq!(f.count("/product-users"), 1);
}
