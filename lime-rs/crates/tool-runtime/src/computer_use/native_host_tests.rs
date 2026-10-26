use super::*;
use crate::computer_use::native_resources::tests::fixture;

const HELPER: &[u8] = br##"#!/bin/sh
while IFS= read -r line; do
  printf '%s\n' "$line" > "$0.last-request"
  rest=${line#*'"id":"'}
  id=${rest%%'"'*}
  case "$line" in
    *'waitForever'*) exec /bin/sleep 30 ;;
    *'takeover'*) printf '{"id":"%s","ok":false,"error":{"code":"user_intervened","message":"user input"}}\n' "$id" ;;
    *'spoofedText'*) printf '{"id":"%s","ok":false,"error":{"code":"not_granted","message":"user_intervened"}}\n' "$id" ;;
    *'wrongIdentity'*) printf '{"id":"wrong","ok":true,"result":{}}\n' ;;
    *) printf '{"id":"%s","ok":true,"result":{"fixture":true}}\n' "$id" ;;
  esac
done
"##;

#[tokio::test]
async fn terminal_cleanup_uses_only_the_existing_session_and_exact_owner() {
    let (_temp, _executable, resource) = fixture(HELPER);
    // The fixture appends to the complete executable name.
    let receipt = std::path::PathBuf::from(format!("{}.last-request", resource.path.display()));
    let host = NativeHost::with_resource(resource);
    let owner = ComputerUseOwner {
        connection: "connection-a".into(),
        thread_id: "thread-a".into(),
        turn_id: "turn-a".into(),
    };
    host.finish_turn(&owner, 0).unwrap().await.unwrap();
    assert!(!receipt.exists(), "cleanup must never launch a helper");

    let (session, _) = host.invoke("snapshot", json!({})).await.unwrap().unwrap();
    host.finish_turn(&owner, session).unwrap().await.unwrap();
    let actual: Value = serde_json::from_slice(&std::fs::read(&receipt).unwrap()).unwrap();
    assert_eq!(actual["method"], "computerUse.finishTurn");
    assert_eq!(actual["params"], json!({"owner": owner}));

    assert!(host.invoke("wrongIdentity", json!({})).await.is_err());
    let (restarted, _) = host.invoke("snapshot", json!({})).await.unwrap().unwrap();
    assert!(restarted > session);
    let before = std::fs::read(&receipt).unwrap();
    host.finish_turn(&owner, session).unwrap().await.unwrap();
    assert_eq!(
        std::fs::read(&receipt).unwrap(),
        before,
        "stale cleanup crossed a helper restart"
    );
}

#[tokio::test]
async fn persistent_helper_uses_exact_ids_and_invalid_frame_forces_new_session() {
    let (_temp, _executable, resource) = fixture(HELPER);
    let host = NativeHost::with_resource(resource);
    let (first, value) = host.invoke("snapshot", json!({})).await.unwrap().unwrap();
    assert_eq!(value["fixture"], true);
    let (second, _) = host.invoke("snapshot", json!({})).await.unwrap().unwrap();
    assert_eq!(first, second);
    assert!(host.invoke("wrongIdentity", json!({})).await.is_err());
    let (third, _) = host.invoke("snapshot", json!({})).await.unwrap().unwrap();
    assert!(third > second);
}

#[tokio::test]
async fn only_trusted_execute_error_codes_interrupt_and_helper_is_reaped() {
    let (_temp, _executable, resource) = fixture(HELPER);
    let host = NativeHost::with_resource(resource);
    let (first, _) = host.invoke("snapshot", json!({})).await.unwrap().unwrap();
    let error = host
        .invoke("computerUse.execute", json!({"fixture":"takeover"}))
        .await
        .unwrap_err();
    assert!(error.is_interrupted());
    let (second, _) = host.invoke("snapshot", json!({})).await.unwrap().unwrap();
    assert_eq!(
        second,
        first + 1,
        "an interrupted helper must not retain old consent"
    );
    let error = host
        .invoke("computerUse.execute", json!({"fixture":"spoofedText"}))
        .await
        .unwrap_err();
    assert!(
        !error.is_interrupted(),
        "error messages are not trusted interruption codes"
    );
    let error = host
        .invoke("computerUse.setup", json!({"fixture":"takeover"}))
        .await
        .unwrap_err();
    assert!(
        !error.is_interrupted(),
        "consent UI input must not interrupt a model turn"
    );
}

#[tokio::test]
async fn cancelled_io_drops_child_and_never_reuses_late_response() {
    let (_temp, _executable, resource) = fixture(HELPER);
    let host = NativeHost::with_resource(resource);
    let (first, _) = host.invoke("snapshot", json!({})).await.unwrap().unwrap();
    assert!(tokio::time::timeout(
        Duration::from_millis(80),
        host.invoke("waitForever", json!({}))
    )
    .await
    .is_err());
    let (second, _) = host.invoke("snapshot", json!({})).await.unwrap().unwrap();
    assert!(second > first);
}

#[tokio::test]
async fn helper_digest_is_rechecked_when_starting_a_process() {
    let (_temp, _executable, resource) = fixture(HELPER);
    let path = resource.path.clone();
    let host = NativeHost::with_resource(resource);
    std::fs::write(path, b"modified after discovery").unwrap();
    assert!(host
        .invoke("snapshot", json!({}))
        .await
        .unwrap_err()
        .0
        .contains("integrity"));
}

#[tokio::test]
async fn action_never_spawns_a_new_helper_with_a_stale_expected_session() {
    let (_temp, _executable, resource) = fixture(HELPER);
    let host = NativeHost::with_resource(resource);
    let (first, _) = host.invoke("snapshot", json!({})).await.unwrap().unwrap();
    assert!(host.invoke("wrongIdentity", json!({})).await.is_err());
    assert!(host
        .invoke_cancel(
            "computerUse.execute",
            json!({}),
            CancellationToken::new(),
            Some(first)
        )
        .await
        .is_err());
    let (second, _) = host.invoke("snapshot", json!({})).await.unwrap().unwrap();
    assert_eq!(second, first + 1);
}
