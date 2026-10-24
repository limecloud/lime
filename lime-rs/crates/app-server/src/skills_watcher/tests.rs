use super::*;
use crate::AppServer;
use app_server_protocol::protocol::v2::{ServerNotification, SkillsChangedNotification};
use std::fs;

mod lifecycle;
mod scope;
mod watch_ready;

#[tokio::test]
async fn watcher_starts_without_global_paths_and_registers_loaded_scope() {
    let server = AppServer::new();
    let watcher = SkillsWatcher::new(server.event_bridge()).expect("watcher");
    assert!(watcher.state.roots.lock().unwrap().paths().is_empty());
    assert!(watcher.state.watched.lock().unwrap().is_empty());

    let temp = tempfile::tempdir().expect("tempdir");
    let root = temp.path().join("skills");
    fs::create_dir(&root).unwrap();
    let registration = watcher.register_roots([root.clone()]);
    let root = root.canonicalize().unwrap();
    assert_eq!(
        watcher.state.watched.lock().unwrap().get(&root),
        Some(&RecursiveMode::Recursive)
    );
    drop(registration);
    assert!(watcher.state.roots.lock().unwrap().paths().is_empty());
    assert!(watcher.state.watched.lock().unwrap().is_empty());
}

#[test]
fn only_catalog_mutations_trigger_invalidation() {
    assert!(is_catalog_change(&EventKind::Create(
        notify::event::CreateKind::File
    )));
    assert!(is_catalog_change(&EventKind::Modify(
        notify::event::ModifyKind::Data(notify::event::DataChange::Content)
    )));
    assert!(is_catalog_change(&EventKind::Remove(
        notify::event::RemoveKind::Folder
    )));
    assert!(!is_catalog_change(&EventKind::Access(
        notify::event::AccessKind::Read
    )));
}

#[tokio::test]
async fn watched_skill_file_change_broadcasts_typed_invalidation() {
    let temp = tempfile::tempdir().expect("tempdir");
    let root = temp.path().join("skills");
    let skill_dir = root.join("writer");
    fs::create_dir_all(&skill_dir).expect("create Skill directory");
    let skill_file = skill_dir.join("SKILL.md");
    fs::write(&skill_file, "---\nname: writer\ndescription: before\n---\n")
        .expect("write Skill fixture");

    let server = AppServer::new();
    let mut outbound = server.subscribe_outbound_messages();
    let _watcher = SkillsWatcher::start(server.event_bridge(), [root], Duration::from_millis(20))
        .expect("start Skill watcher");
    fs::write(&skill_file, "---\nname: writer\ndescription: after\n---\n")
        .expect("update Skill fixture");

    let notification = tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            let message = outbound.recv().await.expect("watcher notification");
            if matches!(
                &message,
                JsonRpcMessage::Notification(notification)
                    if notification.method == "skills/changed"
            ) {
                break message;
            }
        }
    })
    .await
    .expect("wait for skills/changed");
    assert_eq!(
        notification,
        JsonRpcMessage::Notification(
            ServerNotification::SkillsChanged(SkillsChangedNotification {}).into()
        )
    );
}

#[tokio::test]
async fn throttled_change_is_coalesced_into_trailing_notification() {
    let server = AppServer::new();
    let mut outbound = server.subscribe_outbound_messages();
    let notifier = CatalogChangeNotifier::new(
        server.event_bridge(),
        tokio::runtime::Handle::current(),
        Duration::from_millis(500),
    );

    notifier.notify();
    receive_skills_changed(
        &mut outbound,
        Duration::from_secs(1),
        "initial notification",
    )
    .await;

    notifier.notify();
    assert!(
        tokio::time::timeout(Duration::from_millis(100), outbound.recv())
            .await
            .is_err(),
        "throttled change must not broadcast immediately"
    );
    receive_skills_changed(
        &mut outbound,
        Duration::from_secs(1),
        "trailing notification",
    )
    .await;
    notifier.cancel_pending();
}

#[tokio::test]
async fn skill_root_created_after_start_broadcasts_typed_invalidation() {
    let temp = tempfile::tempdir().expect("tempdir");
    let root = temp.path().join("skills");
    let server = AppServer::new();
    let mut outbound = server.subscribe_outbound_messages();
    let _watcher = SkillsWatcher::start(
        server.event_bridge(),
        [root.clone()],
        Duration::from_millis(20),
    )
    .expect("start Skill watcher before root exists");

    let skill_dir = root.join("writer");
    fs::create_dir_all(&skill_dir).expect("create Skill root and directory");
    fs::write(
        skill_dir.join("SKILL.md"),
        "---\nname: writer\ndescription: created later\n---\n",
    )
    .expect("write Skill fixture");

    let notification = tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            let message = outbound.recv().await.expect("watcher notification");
            if matches!(
                &message,
                JsonRpcMessage::Notification(notification)
                    if notification.method == "skills/changed"
            ) {
                break message;
            }
        }
    })
    .await
    .expect("wait for root creation skills/changed");
    assert_eq!(
        notification,
        JsonRpcMessage::Notification(
            ServerNotification::SkillsChanged(SkillsChangedNotification {}).into()
        )
    );
}

async fn receive_skills_changed(
    outbound: &mut tokio::sync::broadcast::Receiver<JsonRpcMessage>,
    timeout: Duration,
    phase: &str,
) -> JsonRpcMessage {
    tokio::time::timeout(timeout, async {
        loop {
            let message = outbound.recv().await.expect("watcher notification");
            if matches!(
                &message,
                JsonRpcMessage::Notification(notification)
                    if notification.method == "skills/changed"
            ) {
                break message;
            }
        }
    })
    .await
    .unwrap_or_else(|error| panic!("wait for skills/changed during {phase}: {error}"))
}
