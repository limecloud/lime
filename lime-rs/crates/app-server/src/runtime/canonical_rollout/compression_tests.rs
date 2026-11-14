use super::compression::{
    compress_rollout_if_cold_blocking, compressed_rollout_path, run,
    try_acquire_rollout_maintenance_lock, PreparedCompression, RolloutCompressionTrigger,
    MIN_ROLLOUT_AGE,
};
use super::tests::setup;
use super::*;
use std::time::{Duration, SystemTime};

fn age(path: &Path) {
    File::options()
        .write(true)
        .open(path)
        .unwrap()
        .set_times(
            fs::FileTimes::new()
                .set_modified(SystemTime::now() - MIN_ROLLOUT_AGE - Duration::from_secs(60)),
        )
        .unwrap();
}

#[test]
fn compression_preserves_bytes_permissions_mtime_and_writer_materialization() {
    for archived in [false, true] {
        let (_temp, store, thread, relative, path) = setup("cold-history");
        age(&path);
        let (relative, path) = if archived {
            let movement = store
                .archive(
                    &relative,
                    thread.session_id.as_str(),
                    thread.thread_id.as_str(),
                )
                .unwrap();
            let relative = movement.commit();
            let path = store.agent_root.join(&relative);
            (relative, path)
        } else {
            (relative, path)
        };
        let bytes = fs::read(&path).unwrap();
        let metadata = fs::metadata(&path).unwrap();
        assert!(compress_rollout_if_cold_blocking(&store.agent_root, &path).unwrap());
        assert!(!path.exists());
        let compressed = compressed_rollout_path(&path);
        assert_eq!(
            fs::metadata(&compressed).unwrap().modified().unwrap(),
            metadata.modified().unwrap()
        );
        assert_eq!(
            fs::metadata(&compressed).unwrap().permissions(),
            metadata.permissions()
        );
        assert_eq!(
            zstd::stream::decode_all(File::open(&compressed).unwrap()).unwrap(),
            bytes
        );
        assert_eq!(store.snapshots().unwrap().len(), 1);
        assert!(!path.exists(), "read must not materialize");
        let mut next = thread.clone();
        next.metadata = serde_json::json!({"name": "updated"});
        next.updated_at_ms = Utc::now().timestamp_millis();
        store
            .append_metadata(&relative, &thread, &next, archived)
            .unwrap();
        assert!(path.exists());
        assert!(!compressed.exists());
        assert_eq!(
            scan_rollout(&path).unwrap().initial_thread.metadata,
            next.metadata
        );
    }
}

#[test]
fn publication_skips_writer_even_after_store_drop_and_retries_after_release() {
    let (_temp, store, thread, _relative, path) = setup("detached-writer");
    age(&path);
    let prepared = PreparedCompression::prepare(&store.agent_root, &path)
        .unwrap()
        .unwrap();
    let writer = store.acquire_writer(thread.thread_id.as_str()).unwrap();
    let root = store.agent_root.clone();
    drop(store);
    assert!(!prepared.publish().unwrap());
    assert!(path.exists());
    assert!(!compressed_rollout_path(&path).exists());
    assert!(writer_lock::acquire(&root, thread.thread_id.as_str()).is_err());
    drop(writer);
    assert!(compress_rollout_if_cold_blocking(&root, &path).unwrap());
}

#[test]
fn publication_rechecks_source_and_never_overwrites_an_existing_representation() {
    for change in ["append", "mtime", "remove", "destination", "permissions"] {
        let (_temp, store, _thread, _relative, path) = setup("changed-source");
        age(&path);
        let prepared = PreparedCompression::prepare(&store.agent_root, &path)
            .unwrap()
            .unwrap();
        let destination = compressed_rollout_path(&path);
        match change {
            "append" => {
                OpenOptions::new()
                    .append(true)
                    .open(&path)
                    .unwrap()
                    .write_all(b"\n")
                    .unwrap();
            }
            "mtime" => {
                File::options()
                    .write(true)
                    .open(&path)
                    .unwrap()
                    .set_times(fs::FileTimes::new().set_modified(SystemTime::now()))
                    .unwrap();
            }
            "remove" => fs::remove_file(&path).unwrap(),
            "destination" => fs::write(&destination, b"winner").unwrap(),
            "permissions" => {
                let mut permissions = fs::metadata(&path).unwrap().permissions();
                permissions.set_readonly(true);
                fs::set_permissions(&path, permissions).unwrap();
            }
            _ => unreachable!(),
        }
        assert!(!prepared.publish().unwrap(), "{change}");
        if change == "destination" {
            assert_eq!(fs::read(destination).unwrap(), b"winner");
        } else {
            assert!(!destination.exists(), "{change}");
        }
    }
}

#[test]
fn compression_skips_recent_files_and_preserves_invalid_cold_source() {
    let (_temp, store, _thread, _relative, path) = setup("invalid-source");
    assert!(!compress_rollout_if_cold_blocking(&store.agent_root, &path).unwrap());
    fs::write(&path, b"invalid\n").unwrap();
    age(&path);
    assert!(compress_rollout_if_cold_blocking(&store.agent_root, &path).is_err());
    assert_eq!(fs::read(&path).unwrap(), b"invalid\n");
    assert!(!compressed_rollout_path(&path).exists());
}

#[test]
fn lifecycle_holds_writer_ownership_until_commit_or_rollback() {
    for commit in [false, true] {
        let (_temp, store, thread, relative, path) = setup("lifecycle-lock");
        let movement = store
            .archive(
                &relative,
                thread.session_id.as_str(),
                thread.thread_id.as_str(),
            )
            .unwrap();
        assert!(
            writer_lock::try_publication(&store.agent_root, thread.thread_id.as_str())
                .unwrap()
                .is_none()
        );
        if commit {
            movement.commit();
        } else {
            movement.rollback().unwrap();
        }
        assert_eq!(path.exists(), !commit);
        assert!(
            writer_lock::try_publication(&store.agent_root, thread.thread_id.as_str())
                .unwrap()
                .is_some()
        );
    }
}

#[tokio::test]
async fn worker_excludes_maintenance_and_keeps_cooldown_while_cleaning_only_stale_temps() {
    let (_temp, store, _thread, _relative, path) = setup("worker-pass");
    age(&path);
    let parent = path.parent().unwrap();
    let stale = parent.join("rollout-compress-stale.tmp");
    let recent = parent.join("rollout-compress-recent.tmp");
    let unrelated = parent.join("unrelated.tmp");
    for temp in [&stale, &recent, &unrelated] {
        fs::write(temp, b"temp").unwrap();
    }
    age(&stale);
    age(&unrelated);
    let lock = try_acquire_rollout_maintenance_lock(&store.agent_root)
        .unwrap()
        .unwrap();
    assert_eq!(
        run(store.agent_root.clone(), RolloutCompressionTrigger::Startup)
            .await
            .unwrap()
            .compressed,
        0
    );
    assert!(path.exists());
    drop(lock);
    assert_eq!(
        run(store.agent_root.clone(), RolloutCompressionTrigger::Startup)
            .await
            .unwrap()
            .compressed,
        1
    );
    assert!(!stale.exists());
    assert!(recent.exists());
    assert!(unrelated.exists());
    let marker = store.agent_root.join(".tmp/rollout-compression.lock");
    assert!(marker.exists());
    fs::write(&path, b"cooldown source").unwrap();
    age(&path);
    assert_eq!(
        run(store.agent_root.clone(), RolloutCompressionTrigger::Startup)
            .await
            .unwrap()
            .compressed,
        0
    );
    assert!(path.exists());
    age(&marker);
    assert_eq!(
        run(store.agent_root.clone(), RolloutCompressionTrigger::Startup)
            .await
            .unwrap()
            .skipped,
        1,
        "existing compressed sibling wins"
    );
}

#[cfg(unix)]
#[tokio::test]
async fn worker_does_not_follow_symlink_directories_or_files() {
    use std::os::unix::fs::symlink;
    let (temp, store, _thread, relative, path) = setup("symlink-source");
    age(&path);
    let outside = temp.path().join("outside");
    fs::create_dir(&outside).unwrap();
    fs::rename(&path, outside.join("source.jsonl")).unwrap();
    symlink(outside.join("source.jsonl"), &path).unwrap();
    symlink(&outside, store.agent_root.join("sessions/external")).unwrap();
    assert_eq!(
        run(store.agent_root.clone(), RolloutCompressionTrigger::Startup)
            .await
            .unwrap()
            .compressed,
        0
    );
    assert!(outside.join("source.jsonl").exists());
    assert!(!compressed_rollout_path(&store.agent_root.join(relative)).exists());
}
