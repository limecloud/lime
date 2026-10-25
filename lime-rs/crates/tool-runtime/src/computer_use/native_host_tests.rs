use super::*;
use crate::computer_use::native_resources::tests::fixture;

const HELPER: &[u8] = br##"#!/bin/sh
while IFS= read -r line; do
  rest=${line#*'"id":"'}
  id=${rest%%'"'*}
  case "$line" in
    *'waitForever'*) exec /bin/sleep 30 ;;
    *'wrongIdentity'*) printf '{"id":"wrong","ok":true,"result":{}}\n' ;;
    *) printf '{"id":"%s","ok":true,"result":{"fixture":true}}\n' "$id" ;;
  esac
done
"##;

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
