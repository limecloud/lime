use super::*;
use crate::api_key_provider_service::tests::{init_test_database, test_service};

fn source(service: &ApiKeyProviderService, db: &DbConnection) -> (ApiKeyProvider, ApiKeyEntry) {
    let provider = service
        .add_custom_provider(
            db,
            "Selected connection".into(),
            ApiProviderType::Openai,
            "https://model.invalid/v1".into(),
            None,
            None,
            None,
            None,
            None,
        )
        .unwrap();
    let key = service
        .add_api_key(
            db,
            &provider.id,
            "fixture-selected-key",
            Some("Selected key".into()),
            false,
        )
        .unwrap();
    (
        service
            .get_provider(db, &provider.id)
            .unwrap()
            .unwrap()
            .provider,
        key,
    )
}

fn seal(
    service: &ApiKeyProviderService,
    db: &DbConnection,
    state: &Value,
    provider: &ApiKeyProvider,
    key: &ApiKeyEntry,
) -> String {
    service
        .seal_model_connection(
            db,
            state["operationId"].as_str().unwrap(),
            state["recipient"].as_str().unwrap(),
            state["expiresAt"].as_i64().unwrap(),
            &provider.id,
            &key.id,
        )
        .unwrap()["ciphertext"]
        .as_str()
        .unwrap()
        .into()
}

#[test]
fn selected_connection_round_trip_is_ciphertext_only_and_commits_once() {
    let service = test_service();
    let src = init_test_database();
    let dst = init_test_database();
    let (provider, key) = source(&service, &src);
    let id = Uuid::new_v4().to_string();
    let state = service.prepare_model_connection(&dst, &id).unwrap();
    assert_eq!(state, service.prepare_model_connection(&dst, &id).unwrap());
    assert_eq!(state["phase"], "prepared");
    assert!(!state.to_string().contains("secret:"));
    let cipher = seal(&service, &src, &state, &provider, &key);
    assert!(!String::from_utf8_lossy(&STANDARD.decode(&cipher).unwrap())
        .contains("fixture-selected-key"));
    let complete = service.apply_model_connection(&dst, &id, &cipher).unwrap();
    assert_eq!(complete["phase"], "complete");
    assert_eq!(
        service.apply_model_connection(&dst, &id, &cipher).unwrap(),
        complete
    );
    assert_eq!(service.read_model_connection(&dst, &id).unwrap(), complete);
    assert_eq!(
        service
            .credentials
            .load(&reference(reserved_id(&id, "identity")))
            .unwrap_err(),
        "credential_not_found"
    );
    let imported = service
        .get_provider(&dst, complete["providerId"].as_str().unwrap())
        .unwrap()
        .unwrap();
    assert_ne!(imported.provider.id, provider.id);
    assert!(!imported.provider.is_system);
    assert!(imported.provider.id.starts_with("custom-"));
    assert_eq!(imported.provider.group, ProviderGroup::Custom);
    assert_eq!(imported.provider.api_host, provider.api_host);
    assert_eq!(imported.api_keys.len(), 1);
    assert_eq!(
        service
            .read_api_key(&imported.api_keys[0].api_key_encrypted)
            .unwrap(),
        "fixture-selected-key"
    );
    assert_eq!(
        ApiKeyProviderDao::get_all_providers_with_keys(&dst.lock().unwrap())
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        RouteStateDao::read_generation(&dst.lock().unwrap()).unwrap(),
        1
    );
    assert!(!service
        .export_config(&dst, true)
        .unwrap()
        .to_string()
        .contains("fixture-selected-key"));
}

#[test]
fn disabled_or_foreign_keys_are_never_sealed() {
    let service = test_service();
    let src = init_test_database();
    let dst = init_test_database();
    let (provider, mut key) = source(&service, &src);
    let (other, _) = source(&service, &src);
    let state = service
        .prepare_model_connection(&dst, &Uuid::new_v4().to_string())
        .unwrap();
    let call = |p: &str, k: &str| {
        service.seal_model_connection(
            &src,
            state["operationId"].as_str().unwrap(),
            state["recipient"].as_str().unwrap(),
            state["expiresAt"].as_i64().unwrap(),
            p,
            k,
        )
    };
    assert!(call(&other.id, &key.id).is_err());
    key.enabled = false;
    ApiKeyProviderDao::update_api_key(&src.lock().unwrap(), &key).unwrap();
    assert!(call(&provider.id, &key.id).is_err());
}

#[test]
fn wrong_destination_tampering_and_changed_replay_have_no_side_effects() {
    let service = test_service();
    let src = init_test_database();
    let dst = init_test_database();
    let (provider, key) = source(&service, &src);
    let first = service
        .prepare_model_connection(&dst, &Uuid::new_v4().to_string())
        .unwrap();
    let other = service
        .prepare_model_connection(&dst, &Uuid::new_v4().to_string())
        .unwrap();
    let cipher = seal(&service, &src, &first, &provider, &key);
    assert!(service
        .apply_model_connection(&dst, other["operationId"].as_str().unwrap(), &cipher)
        .is_err());
    let mut tampered = STANDARD.decode(&cipher).unwrap();
    *tampered.last_mut().unwrap() ^= 1;
    let id = first["operationId"].as_str().unwrap();
    assert!(service
        .apply_model_connection(&dst, id, &STANDARD.encode(tampered))
        .is_err());
    assert_eq!(
        service.read_model_connection(&dst, id).unwrap()["phase"],
        "prepared"
    );
    assert!(
        ApiKeyProviderDao::get_all_providers_with_keys(&dst.lock().unwrap())
            .unwrap()
            .is_empty()
    );
    service.apply_model_connection(&dst, id, &cipher).unwrap();
    // age 同一明文再次封装也是不同密文；完成后不接受替换。
    let another = seal(&service, &src, &first, &provider, &key);
    assert_eq!(
        service
            .apply_model_connection(&dst, id, &another)
            .unwrap_err(),
        "model_connection_payload_conflict"
    );
}

#[test]
fn failed_database_commit_resumes_reserved_secret_and_original_receipt() {
    let service = test_service();
    let src = init_test_database();
    let dst = init_test_database();
    let (provider, key) = source(&service, &src);
    let id = Uuid::new_v4().to_string();
    let state = service.prepare_model_connection(&dst, &id).unwrap();
    let cipher = seal(&service, &src, &state, &provider, &key);
    dst.lock().unwrap().execute_batch("CREATE TRIGGER fail_transfer BEFORE INSERT ON api_keys BEGIN SELECT RAISE(ABORT, 'fixture'); END;").unwrap();
    assert_eq!(
        service
            .apply_model_connection(&dst, &id, &cipher)
            .unwrap_err(),
        STORAGE
    );
    assert_eq!(
        service.read_model_connection(&dst, &id).unwrap()["phase"],
        "receiving"
    );
    assert_eq!(
        service
            .credentials
            .load(&reference(reserved_id(&id, "key")))
            .unwrap(),
        "fixture-selected-key"
    );
    assert_eq!(
        RouteStateDao::read_generation(&dst.lock().unwrap()).unwrap(),
        0
    );
    dst.lock()
        .unwrap()
        .execute_batch("DROP TRIGGER fail_transfer;")
        .unwrap();
    let reopened = test_service();
    let complete = reopened.apply_model_connection(&dst, &id, &cipher).unwrap();
    assert_eq!(complete["phase"], "complete");
    assert_eq!(
        reopened.apply_model_connection(&dst, &id, &cipher).unwrap(),
        complete
    );
    assert_eq!(
        RouteStateDao::read_generation(&dst.lock().unwrap()).unwrap(),
        1
    );
}

#[test]
fn expiration_cleans_uncommitted_secret_and_never_extends_the_original_window() {
    let service = test_service();
    let src = init_test_database();
    let dst = init_test_database();
    let (provider, key) = source(&service, &src);
    let id = Uuid::new_v4().to_string();
    let state = service.prepare_model_connection(&dst, &id).unwrap();
    let cipher = seal(&service, &src, &state, &provider, &key);
    service
        .credentials
        .save_reserved(reserved_id(&id, "key"), "fixture-selected-key")
        .unwrap();
    dst.lock()
        .unwrap()
        .execute(
            "UPDATE provider_connection_transfers SET expires_at = 1 WHERE operation_id = ?1",
            [&id],
        )
        .unwrap();
    assert_eq!(
        service.prepare_model_connection(&dst, &id).unwrap()["phase"],
        "expired"
    );
    assert_eq!(
        service.read_model_connection(&dst, &id).unwrap()["expiresAt"],
        1
    );
    assert!(service.apply_model_connection(&dst, &id, &cipher).is_err());
    for purpose in ["key", "identity"] {
        assert_eq!(
            service
                .credentials
                .load(&reference(reserved_id(&id, purpose)))
                .unwrap_err(),
            "credential_not_found"
        );
    }
    assert!(
        ApiKeyProviderDao::get_all_providers_with_keys(&dst.lock().unwrap())
            .unwrap()
            .is_empty()
    );
}

#[test]
fn preparing_receipt_recovers_identity_and_missing_read_never_creates_one() {
    let service = test_service();
    let db = init_test_database();
    let id = Uuid::new_v4().to_string();
    assert_eq!(
        service.read_model_connection(&db, &id).unwrap()["phase"],
        "notFound"
    );
    let state = service.prepare_model_connection(&db, &id).unwrap();
    db.lock().unwrap().execute("UPDATE provider_connection_transfers SET recipient = '', phase = 'preparing' WHERE operation_id = ?1", [&id]).unwrap();
    assert_eq!(service.prepare_model_connection(&db, &id).unwrap(), state);
    assert!(service.prepare_model_connection(&db, "../escape").is_err());
}
