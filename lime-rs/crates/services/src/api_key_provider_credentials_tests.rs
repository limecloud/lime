use super::tests::{init_test_database, test_service};
use super::*;

fn provider(service: &ApiKeyProviderService, db: &DbConnection) -> ApiKeyProvider {
    service
        .add_custom_provider(
            db,
            "Fixture".into(),
            ApiProviderType::Openai,
            "http://127.0.0.1:1/v1".into(),
            None,
            None,
            None,
            None,
            None,
        )
        .unwrap()
}

#[test]
fn credential_lifecycle_keeps_provider_identity_and_cleans_replaced_secrets() {
    let db = init_test_database();
    let service = test_service();
    let first_provider = provider(&service, &db);
    let second_provider = provider(&service, &db);
    let first = service
        .add_api_key(&db, &first_provider.id, "first", None, false)
        .unwrap();
    let second = service
        .add_api_key(&db, &first_provider.id, "second", None, false)
        .unwrap();
    let other = service
        .add_api_key(&db, &second_provider.id, "other", None, false)
        .unwrap();
    assert!(service
        .add_api_key(&db, &first_provider.id, "first", None, false)
        .is_err());
    assert!(first.api_key_encrypted.starts_with("secret:API_KEY_"));
    let replacement = service
        .add_api_key(&db, &first_provider.id, "first", None, true)
        .unwrap();
    assert_eq!(replacement.id, first.id);
    assert!(service.read_api_key(&second.api_key_encrypted).is_err());
    assert_eq!(
        service.read_api_key(&other.api_key_encrypted).unwrap(),
        "other"
    );
    service.delete_api_key(&db, &first.id).unwrap();
    assert!(service.read_api_key(&first.api_key_encrypted).is_err());
    service
        .delete_custom_provider(&db, &second_provider.id)
        .unwrap();
    assert!(service.read_api_key(&other.api_key_encrypted).is_err());
}

#[test]
fn failed_database_insert_removes_new_secret_and_keeps_existing_key() {
    let root = tempfile::tempdir().unwrap();
    let db = init_test_database();
    let mut service = test_service();
    service.credentials =
        crate::provider_credentials::ProviderCredentialStore::file(root.path().into());
    let provider = provider(&service, &db);
    let original = service
        .add_api_key(&db, &provider.id, "original", None, false)
        .unwrap();
    db.lock().unwrap().execute_batch("CREATE TRIGGER reject_key_insert BEFORE INSERT ON api_keys BEGIN SELECT RAISE(FAIL, 'fixture'); END;").unwrap();
    assert!(service
        .add_api_key(&db, &provider.id, "replacement", None, true)
        .is_err());
    assert_eq!(
        service
            .get_next_api_key(&db, &provider.id)
            .unwrap()
            .as_deref(),
        Some("original")
    );
    assert_eq!(
        service.read_api_key(&original.api_key_encrypted).unwrap(),
        "original"
    );
    let files = std::fs::read_dir(root.path().join("credentials"))
        .unwrap()
        .filter(|entry| {
            entry
                .as_ref()
                .unwrap()
                .path()
                .extension()
                .is_some_and(|ext| ext == "json")
        })
        .count();
    assert_eq!(files, 1);
}

#[test]
fn store_failure_does_not_write_database_or_fall_back() {
    let root = tempfile::tempdir().unwrap();
    let blocked_root = root.path().join("blocked");
    std::fs::write(&blocked_root, "fixture").unwrap();
    let db = init_test_database();
    let mut service = test_service();
    service.credentials = crate::provider_credentials::ProviderCredentialStore::file(blocked_root);
    let provider = provider(&service, &db);
    assert_eq!(
        service
            .add_api_key(&db, &provider.id, "fixture", None, false)
            .unwrap_err(),
        "credential_store_write_failed"
    );
    assert!(service
        .get_provider(&db, &provider.id)
        .unwrap()
        .unwrap()
        .api_keys
        .is_empty());
}
