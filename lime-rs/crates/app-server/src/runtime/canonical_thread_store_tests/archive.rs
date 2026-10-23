use super::*;

#[test]
fn metadata_values_preserve_unrelated_canonical_fields_across_archived_cold_recovery() {
    let (_temp, agent_root, store) = store_with_rollout();
    let mut source = thread("snapshot-metadata", 1_700_000_000_000);
    source.metadata = json!({ "modelName": "keep", "custom": { "id": "keep-nested" } });
    create(&store, &source);
    block_on(store.archive_thread(ArchiveThreadParams {
        thread_id: source.thread_id.clone(),
    }))
    .unwrap();
    let archived = block_on(store.read_thread(ReadThreadParams {
        thread_id: source.thread_id.clone(),
        include_archived: true,
        turns_view: ThreadTurnsView::NotLoaded,
    }))
    .unwrap()
    .unwrap();
    let changed = block_on(store.update_thread_metadata(UpdateThreadMetadataParams {
        thread_id: source.thread_id.clone(),
        include_archived: true,
        patch: ThreadMetadataPatch {
            metadata_values: [("worktreeSnapshot".to_owned(), json!({ "ref": "snapshot" }))].into(),
            ..Default::default()
        },
    }))
    .unwrap();
    assert_eq!(changed.metadata["modelName"], "keep");
    assert_eq!(changed.metadata["custom"]["id"], "keep-nested");
    assert_eq!(changed.recency_at_ms, Some(source.updated_at_ms));
    assert_eq!(changed.updated_at_ms, archived.updated_at_ms);
    let file_time = modified_ms(&rollout_path(&store, &agent_root, &source.thread_id));
    assert!(changed.archived);
    drop(store);
    let cold = ProjectionStore::initialize_with_agent_root(
        agent_root.join("runtime/cold.sqlite"),
        &agent_root,
    )
    .unwrap();
    let recovered = block_on(cold.read_thread(ReadThreadParams {
        thread_id: source.thread_id,
        include_archived: true,
        turns_view: ThreadTurnsView::NotLoaded,
    }))
    .unwrap()
    .unwrap();
    assert_eq!(recovered.metadata["worktreeSnapshot"]["ref"], "snapshot");
    assert_eq!(recovered.metadata["modelName"], "keep");
    assert_eq!(recovered.metadata["custom"]["id"], "keep-nested");
    assert_eq!(recovered.updated_at_ms, file_time);
    assert_eq!(recovered.recency_at_ms, changed.recency_at_ms);
}

fn physical_path(path: &Path, compressed: bool) -> PathBuf {
    if compressed {
        let mut name = path.as_os_str().to_owned();
        name.push(".zst");
        PathBuf::from(name)
    } else {
        path.to_path_buf()
    }
}

fn age_rollout(path: &Path, compressed: bool) -> PathBuf {
    let physical = physical_path(path, compressed);
    if compressed {
        fs::write(
            &physical,
            zstd::stream::encode_all(fs::read(path).unwrap().as_slice(), 3).unwrap(),
        )
        .unwrap();
        fs::remove_file(path).unwrap();
    }
    fs::OpenOptions::new()
        .append(true)
        .open(&physical)
        .unwrap()
        .set_times(
            fs::FileTimes::new().set_modified(
                std::time::UNIX_EPOCH + std::time::Duration::from_secs(1_700_000_000),
            ),
        )
        .unwrap();
    physical
}

fn modified_ms(path: &Path) -> i64 {
    chrono::DateTime::<chrono::Utc>::from(fs::metadata(path).unwrap().modified().unwrap())
        .timestamp_millis()
}

#[test]
fn lifecycle_preserves_recency_and_compression_across_cold_recovery_and_metadata_writes() {
    for (compressed, recency) in [
        (false, None),
        (true, None),
        (false, Some(1_699_999_999_000)),
        (true, Some(1_699_999_999_000)),
    ] {
        let (_temp, agent_root, store) = store_with_rollout();
        let mut source = thread("lifecycle-time", 1_700_000_000_000);
        source.recency_at_ms = recency;
        let expected_recency = Some(recency.unwrap_or(source.updated_at_ms));
        create(&store, &source);
        let mut peer = thread("lifecycle-peer", source.updated_at_ms + 200);
        peer.recency_at_ms = Some(peer.updated_at_ms);
        create(&store, &peer);
        let active = rollout_path(&store, &agent_root, &source.thread_id);
        let physical_active = age_rollout(&active, compressed);
        let bytes = fs::read(&physical_active).unwrap();
        block_on(store.archive_thread(ArchiveThreadParams {
            thread_id: source.thread_id.clone(),
        }))
        .unwrap();
        let archived = rollout_path(&store, &agent_root, &source.thread_id);
        let physical_archived = physical_path(&archived, compressed);
        assert_eq!(modified_ms(&physical_archived), source.updated_at_ms);
        assert_eq!(fs::read(&physical_archived).unwrap(), bytes);
        let before = chrono::Utc::now().timestamp_millis();
        let restored = block_on(store.unarchive_thread(ArchiveThreadParams {
            thread_id: source.thread_id.clone(),
        }))
        .unwrap();
        assert_eq!(restored.recency_at_ms, expected_recency);
        assert_eq!(restored.updated_at_ms, modified_ms(&physical_active));
        assert!(restored.updated_at_ms >= before);
        assert_eq!(fs::read(&physical_active).unwrap(), bytes);
        assert!(!physical_archived.exists());
        assert_eq!(active.exists(), !compressed);
        let listed = block_on(store.list_threads(ListThreadsParams {
            include_archived: false,
            section: None,
            project: None,
            sort_by_section_position: false,
            page: page(SortDirection::Desc, 10),
        }))
        .unwrap();
        assert_eq!(
            listed.data[0].thread_id, peer.thread_id,
            "unarchive must not promote recency"
        );

        let cold = ProjectionStore::initialize_with_agent_root(
            agent_root.join("runtime/cold.sqlite"),
            &agent_root,
        )
        .unwrap();
        let recovered = block_on(cold.read_thread(ReadThreadParams {
            thread_id: source.thread_id.clone(),
            include_archived: false,
            turns_view: ThreadTurnsView::Full,
        }))
        .unwrap()
        .unwrap();
        assert_eq!(recovered.updated_at_ms, restored.updated_at_ms);
        assert_eq!(recovered.recency_at_ms, restored.recency_at_ms);
        assert_eq!(active.exists(), !compressed);
        let changed = block_on(cold.update_thread_metadata(UpdateThreadMetadataParams {
            thread_id: source.thread_id.clone(),
            include_archived: false,
            patch: ThreadMetadataPatch {
                metadata: Some(Some(json!({"modelName": "after-unarchive"}))),
                updated_at_ms: Some(restored.updated_at_ms + 1),
                ..Default::default()
            },
        }))
        .unwrap();
        assert_eq!(changed.metadata["modelName"], "after-unarchive");
        assert_eq!(changed.recency_at_ms, expected_recency);
        assert!(active.exists());
        block_on(cold.apply_history(ApplyThreadHistoryParams {
            session_id: source.session_id.clone(),
            thread_id: source.thread_id.clone(),
            changes: ThreadHistoryChangeSet {
                sequence: 1,
                changed_turns: vec![turn(&source, "continued", TurnStatus::Completed)],
                ..Default::default()
            },
        }))
        .unwrap();
        let twice = ProjectionStore::initialize_with_agent_root(
            agent_root.join("runtime/twice.sqlite"),
            &agent_root,
        )
        .unwrap();
        let recovered = block_on(twice.read_thread(ReadThreadParams {
            thread_id: source.thread_id.clone(),
            include_archived: false,
            turns_view: ThreadTurnsView::Full,
        }))
        .unwrap()
        .unwrap();
        assert_eq!(recovered.metadata["modelName"], "after-unarchive");
        assert_eq!(recovered.turns.len(), 1);
        assert_eq!(recovered.recency_at_ms, expected_recency);
    }
}

#[test]
fn unarchive_sql_update_failure_restores_physical_path_and_time() {
    for compressed in [false, true] {
        let (_temp, agent_root, store) = store_with_rollout();
        let source = thread("lifecycle-sql-failure", 1_700_000_000_000);
        create(&store, &source);
        let active = rollout_path(&store, &agent_root, &source.thread_id);
        age_rollout(&active, compressed);
        block_on(store.archive_thread(ArchiveThreadParams {
            thread_id: source.thread_id.clone(),
        }))
        .unwrap();
        let archived = rollout_path(&store, &agent_root, &source.thread_id);
        let physical_archived = physical_path(&archived, compressed);
        let bytes = fs::read(&physical_archived).unwrap();
        let original_modified = fs::metadata(&physical_archived)
            .unwrap()
            .modified()
            .unwrap();
        let conn = Connection::open(store.path()).unwrap();
        conn.execute_batch("CREATE TRIGGER fail_lifecycle_update BEFORE UPDATE OF archived ON canonical_threads BEGIN SELECT RAISE(ABORT, 'injected lifecycle update'); END;").unwrap();
        let error = block_on(store.unarchive_thread(ArchiveThreadParams {
            thread_id: source.thread_id.clone(),
        }))
        .unwrap_err();
        assert!(error.to_string().contains("injected lifecycle update"));
        assert_eq!(
            rollout_path(&store, &agent_root, &source.thread_id),
            archived
        );
        assert_eq!(
            fs::metadata(&physical_archived)
                .unwrap()
                .modified()
                .unwrap(),
            original_modified
        );
        assert_eq!(fs::read(&physical_archived).unwrap(), bytes);
        assert!(!physical_path(&active, compressed).exists());
        conn.execute_batch("DROP TRIGGER fail_lifecycle_update;")
            .unwrap();
        block_on(store.unarchive_thread(ArchiveThreadParams {
            thread_id: source.thread_id.clone(),
        }))
        .unwrap();
    }
}

#[cfg(unix)]
#[test]
fn unarchive_touch_failure_restores_read_only_plain_and_compressed_files() {
    use std::os::unix::fs::PermissionsExt;
    for compressed in [false, true] {
        let (_temp, agent_root, store) = store_with_rollout();
        let source = thread("lifecycle-touch-failure", 1_700_000_000_000);
        create(&store, &source);
        let active = rollout_path(&store, &agent_root, &source.thread_id);
        age_rollout(&active, compressed);
        block_on(store.archive_thread(ArchiveThreadParams {
            thread_id: source.thread_id.clone(),
        }))
        .unwrap();
        let archived = rollout_path(&store, &agent_root, &source.thread_id);
        let physical_archived = physical_path(&archived, compressed);
        let original_modified = fs::metadata(&physical_archived)
            .unwrap()
            .modified()
            .unwrap();
        fs::set_permissions(&physical_archived, fs::Permissions::from_mode(0o400)).unwrap();
        let error = block_on(store.unarchive_thread(ArchiveThreadParams {
            thread_id: source.thread_id.clone(),
        }))
        .unwrap_err();
        assert!(error.to_string().contains("failed to touch rollout"));
        assert_eq!(
            rollout_path(&store, &agent_root, &source.thread_id),
            archived
        );
        assert_eq!(
            fs::metadata(&physical_archived)
                .unwrap()
                .modified()
                .unwrap(),
            original_modified
        );
        assert!(!physical_path(&active, compressed).exists());
        fs::set_permissions(&physical_archived, fs::Permissions::from_mode(0o600)).unwrap();
        block_on(store.unarchive_thread(ArchiveThreadParams {
            thread_id: source.thread_id.clone(),
        }))
        .unwrap();
    }
}

#[test]
fn canonical_rollout_archive_moves_and_restores_the_original_date_path() {
    let (_temp, agent_root, store) = store_with_rollout();
    let source = thread("archive-thread", 1_700_000_000_000);
    create(&store, &source);
    block_on(store.apply_history(ApplyThreadHistoryParams {
        session_id: source.session_id.clone(),
        thread_id: source.thread_id.clone(),
        changes: ThreadHistoryChangeSet {
            sequence: 1,
            changed_turns: vec![turn(&source, "turn-1", TurnStatus::Completed)],
            ..Default::default()
        },
    }))
    .expect("seed rollout history");
    let active_path = rollout_path(&store, &agent_root, &source.thread_id);

    block_on(store.archive_thread(ArchiveThreadParams {
        thread_id: source.thread_id.clone(),
    }))
    .expect("archive rollout");
    let archived_path = rollout_path(&store, &agent_root, &source.thread_id);
    assert_eq!(
        archived_path.parent(),
        Some(agent_root.join("archived_sessions").as_path())
    );
    assert!(!active_path.exists());
    assert!(archived_path.exists());
    block_on(store.archive_thread(ArchiveThreadParams {
        thread_id: source.thread_id.clone(),
    }))
    .expect("idempotent archive");
    let error = block_on(store.apply_history(ApplyThreadHistoryParams {
        session_id: source.session_id.clone(),
        thread_id: source.thread_id.clone(),
        changes: ThreadHistoryChangeSet {
            sequence: 2,
            changed_turns: vec![turn(&source, "turn-2", TurnStatus::InProgress)],
            ..Default::default()
        },
    }))
    .expect_err("archived thread must reject append");
    assert!(error.to_string().contains("is archived"));
    drop(store);

    let restarted = ProjectionStore::initialize_with_agent_root(
        agent_root.join("runtime").join("projection.sqlite"),
        &agent_root,
    )
    .expect("restart archived store");
    let restored = block_on(restarted.unarchive_thread(ArchiveThreadParams {
        thread_id: source.thread_id.clone(),
    }))
    .expect("unarchive rollout");
    assert!(!restored.archived);
    assert!(!archived_path.exists());
    assert!(active_path.exists());
    assert_eq!(
        rollout_path(&restarted, &agent_root, &source.thread_id),
        active_path
    );
    let before = fs::read(&active_path).unwrap();
    let modified = fs::metadata(&active_path).unwrap().modified().unwrap();
    let error = block_on(restarted.unarchive_thread(ArchiveThreadParams {
        thread_id: source.thread_id.clone(),
    }))
    .expect_err("unarchive requires an archived rollout");
    assert_eq!(
        error.kind(),
        thread_store::ThreadStoreErrorKind::InvalidRequest
    );
    assert!(error.to_string().contains("no archived rollout found"));
    assert_eq!(fs::read(&active_path).unwrap(), before);
    assert_eq!(
        fs::metadata(&active_path).unwrap().modified().unwrap(),
        modified
    );
    let unchanged = block_on(restarted.read_thread(ReadThreadParams {
        thread_id: source.thread_id,
        include_archived: true,
        turns_view: ThreadTurnsView::NotLoaded,
    }))
    .unwrap()
    .unwrap();
    assert_eq!(unchanged, restored);
    assert_eq!(rollout_lines(&active_path).len(), 2);
}

#[test]
fn rollout_archive_and_unarchive_retry_after_projection_commit_failure() {
    let (_temp, agent_root, store) = store_with_rollout();
    let source = thread("archive-retry", 1_700_000_000_000);
    create(&store, &source);
    let active_path = rollout_path(&store, &agent_root, &source.thread_id);
    let archived_path = agent_root
        .join("archived_sessions")
        .join(active_path.file_name().expect("rollout filename"));
    let conn = Connection::open(store.path()).expect("open projection DB");
    conn.execute_batch(
        "PRAGMA foreign_keys = ON;
         CREATE TABLE rollout_archive_guard_parent (id INTEGER PRIMARY KEY);
         CREATE TABLE rollout_archive_guard_child (
             id INTEGER PRIMARY KEY,
             parent_id INTEGER NOT NULL,
             FOREIGN KEY (parent_id) REFERENCES rollout_archive_guard_parent(id)
                 DEFERRABLE INITIALLY DEFERRED
         );
         CREATE TRIGGER fail_rollout_archive_commit
         AFTER UPDATE OF archived ON canonical_threads
         WHEN NEW.archived = 1
         BEGIN
             INSERT INTO rollout_archive_guard_child (id, parent_id) VALUES (1, 999);
         END;",
    )
    .expect("install archive commit failure");
    drop(conn);

    let error = block_on(store.archive_thread(ArchiveThreadParams {
        thread_id: source.thread_id.clone(),
    }))
    .expect_err("archive projection commit must fail");
    assert!(error.to_string().contains("FOREIGN KEY constraint failed"));
    assert!(active_path.exists());
    assert!(!archived_path.exists());
    assert_eq!(
        rollout_path(&store, &agent_root, &source.thread_id),
        active_path
    );

    let conn = Connection::open(store.path()).expect("reopen projection DB");
    conn.execute_batch("DROP TRIGGER fail_rollout_archive_commit;")
        .expect("remove archive failure");
    drop(conn);
    block_on(store.archive_thread(ArchiveThreadParams {
        thread_id: source.thread_id.clone(),
    }))
    .expect("retry archive");
    assert_eq!(
        rollout_path(&store, &agent_root, &source.thread_id),
        archived_path
    );

    let conn = Connection::open(store.path()).expect("open projection DB");
    conn.execute_batch(
        "CREATE TRIGGER fail_rollout_unarchive_commit
         AFTER UPDATE OF archived ON canonical_threads
         WHEN NEW.archived = 0
         BEGIN
             INSERT INTO rollout_archive_guard_child (id, parent_id) VALUES (1, 999);
         END;",
    )
    .expect("install unarchive commit failure");
    drop(conn);
    let original_modified = fs::metadata(&archived_path).unwrap().modified().unwrap();
    let error = block_on(store.unarchive_thread(ArchiveThreadParams {
        thread_id: source.thread_id.clone(),
    }))
    .expect_err("unarchive projection commit must fail");
    assert!(error.to_string().contains("FOREIGN KEY constraint failed"));
    assert!(!active_path.exists());
    assert!(archived_path.exists());
    assert_eq!(
        fs::metadata(&archived_path).unwrap().modified().unwrap(),
        original_modified
    );
    assert_eq!(
        rollout_path(&store, &agent_root, &source.thread_id),
        archived_path
    );

    let conn = Connection::open(store.path()).expect("reopen projection DB");
    conn.execute_batch("DROP TRIGGER fail_rollout_unarchive_commit;")
        .expect("remove unarchive failure");
    drop(conn);
    block_on(store.unarchive_thread(ArchiveThreadParams {
        thread_id: source.thread_id.clone(),
    }))
    .expect("retry unarchive");
    assert_eq!(
        rollout_path(&store, &agent_root, &source.thread_id),
        active_path
    );
    assert_eq!(rollout_lines(&active_path).len(), 1);
}
