use super::*;

fn extract(store: &MemoryStateStore, path: &str, content: &str, updated_at: &str) -> StageTwoInput {
    store
        .register_rollout("global", path, content, updated_at)
        .unwrap();
    assert!(store
        .try_claim_stage1("global", path, "extractor", 60, 8)
        .unwrap());
    assert!(store
        .save_stage1_output(
            "global",
            path,
            "extractor",
            StageOneOutputSnapshot {
                source_path: path.to_string(),
                content_hash: hash_content(content),
                source_updated_at: updated_at.to_string(),
                raw_memory: Some(format!("fact: {content}")),
                rollout_summary: format!("summary: {content}"),
                rollout_slug: None,
            },
        )
        .unwrap());
    store
        .stage2_candidates("global", 20)
        .unwrap()
        .into_iter()
        .find(|snapshot| snapshot.source_path == path)
        .unwrap()
}

fn selection(store: &MemoryStateStore, path: &str) -> (String, bool) {
    store
        .open()
        .unwrap()
        .query_row(
            "SELECT status, selected_for_phase2 FROM memory_rollout_jobs WHERE scope_key = 'global' AND source_path = ?1",
            [path],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap()
}

#[test]
fn phase2_commit_never_selects_newer_snapshot_at_the_same_path() {
    // A timestamp change is a new Codex source version, even when the text is unchanged.
    // The digest also distinguishes source edits within one filesystem timestamp tick.
    for (content, updated_at) in [("candidate", "2"), ("changed", "1")] {
        let temp = tempfile::tempdir().unwrap();
        let store = MemoryStateStore::new(temp.path());
        let original = extract(&store, "same.md", "candidate", "1");
        let unchanged = extract(&store, "stable.md", "unchanged", "1");
        assert!(store.try_claim_phase2("global", "phase2", 60).unwrap());
        let newer = extract(&store, "same.md", content, updated_at);
        assert!(store
            .commit_phase2_snapshot("global", "phase2", 42, &[original, unchanged])
            .unwrap());
        assert_eq!(selection(&store, "same.md"), ("pending".into(), false));
        assert_eq!(
            selection(&store, "stable.md"),
            ("consolidated".into(), true)
        );
        assert_eq!(
            store.stage2_candidates("global", 20).unwrap(),
            vec![newer.clone()]
        );
        // The next run can select the exact newer version without losing it.
        assert!(store.try_claim_phase2("global", "next-phase2", 60).unwrap());
        assert!(store
            .commit_phase2_snapshot("global", "next-phase2", 43, &[newer])
            .unwrap());
        assert_eq!(selection(&store, "same.md"), ("consolidated".into(), true));
        assert_eq!(
            selection(&store, "stable.md"),
            ("consolidated".into(), false)
        );
    }
}

#[test]
fn registering_new_source_version_clears_stale_extraction_and_selection() {
    for (content, updated_at) in [("candidate", "2"), ("changed", "1")] {
        let temp = tempfile::tempdir().unwrap();
        let store = MemoryStateStore::new(temp.path());
        let original = extract(&store, "same.md", "candidate", "1");
        assert!(store.try_claim_phase2("global", "phase2", 60).unwrap());
        assert!(store
            .commit_phase2_snapshot("global", "phase2", 1, &[original])
            .unwrap());
        store
            .register_rollout("global", "same.md", content, updated_at)
            .unwrap();
        assert_eq!(selection(&store, "same.md"), ("pending".into(), false));
        assert!(store.stage2_candidates("global", 20).unwrap().is_empty());
        assert_eq!(
            store.stage1_candidates("global", 20).unwrap(),
            vec!["same.md"]
        );
        let stale_outputs: bool = store.open().unwrap().query_row(
            "SELECT output_raw_memory IS NOT NULL OR output_rollout_summary IS NOT NULL OR output_rollout_slug IS NOT NULL OR generated_at IS NOT NULL FROM memory_rollout_jobs WHERE scope_key = 'global' AND source_path = 'same.md'",
            [], |row| row.get(0),
        ).unwrap();
        assert!(!stale_outputs);
    }
}

#[test]
fn registering_identical_source_preserves_extraction_selection_and_running_lease() {
    let temp = tempfile::tempdir().unwrap();
    let store = MemoryStateStore::new(temp.path());
    let original = extract(&store, "same.md", "candidate", "1");
    store
        .register_rollout("global", "same.md", "candidate", "1")
        .unwrap();
    assert_eq!(
        store.stage2_candidates("global", 20).unwrap(),
        vec![original.clone()]
    );
    assert!(store.try_claim_phase2("global", "phase2", 60).unwrap());
    assert!(store
        .commit_phase2_snapshot("global", "phase2", 1, &[original])
        .unwrap());
    store
        .register_rollout("global", "same.md", "candidate", "1")
        .unwrap();
    assert_eq!(selection(&store, "same.md"), ("consolidated".into(), true));
    assert!(store
        .try_claim_stage1("global", "same.md", "extractor", 60, 8)
        .unwrap());
    store
        .register_rollout("global", "same.md", "candidate", "1")
        .unwrap();
    assert!(!store
        .try_claim_stage1("global", "same.md", "racer", 60, 8)
        .unwrap());
    assert!(store
        .heartbeat_stage1("global", "same.md", "extractor", 60)
        .unwrap());
}

#[test]
fn rejected_phase2_commit_keeps_previous_selection_and_watermark() {
    let temp = tempfile::tempdir().unwrap();
    let store = MemoryStateStore::new(temp.path());
    let original = extract(&store, "old.md", "old", "1");
    assert!(store.try_claim_phase2("global", "owner", 60).unwrap());
    assert!(store
        .commit_phase2_snapshot("global", "owner", 42, &[original])
        .unwrap());
    let next = extract(&store, "next.md", "next", "2");
    assert!(store.try_claim_phase2("global", "next-owner", 60).unwrap());
    assert!(!store
        .commit_phase2_snapshot("global", "owner", 100, &[next])
        .unwrap());
    assert_eq!(selection(&store, "old.md"), ("consolidated".into(), true));
    assert_eq!(selection(&store, "next.md"), ("pending".into(), false));
    let watermark: i64 = store
        .open()
        .unwrap()
        .query_row(
            "SELECT completed_watermark FROM memory_phase2_jobs WHERE scope_key = 'global'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(watermark, 42);
}

#[test]
fn phase2_lease_is_exclusive_until_expiry() {
    let temp = tempfile::tempdir().expect("tempdir");
    let store = MemoryStateStore::new(temp.path());
    assert!(store
        .try_claim_phase2("global", "owner-a", 60)
        .expect("claim"));
    assert!(!store
        .try_claim_phase2("global", "owner-b", 60)
        .expect("claim"));
    store
        .finish_phase2("global", "owner-a", true, None)
        .expect("finish");
    assert!(store
        .try_claim_phase2("global", "owner-b", 60)
        .expect("reclaim"));
}

#[test]
fn stage1_claim_snapshot_and_retry_are_recoverable() {
    let temp = tempfile::tempdir().expect("tempdir");
    let store = MemoryStateStore::new(temp.path());
    store
        .register_rollout("global", "rollout-1.md", "candidate", "1")
        .expect("register");
    assert!(store
        .try_claim_stage1("global", "rollout-1.md", "worker-a", 60, 1)
        .expect("claim"));
    assert!(!store
        .try_claim_stage1("global", "rollout-1.md", "worker-b", 60, 1)
        .expect("exclusive claim"));
    assert!(store
        .save_stage1_output(
            "global",
            "rollout-1.md",
            "worker-a",
            StageOneOutputSnapshot {
                source_path: "rollout-1.md".to_string(),
                content_hash: hash_content("candidate"),
                source_updated_at: "1".to_string(),
                raw_memory: Some("fact".to_string()),
                rollout_summary: "summary".to_string(),
                rollout_slug: Some("slug".to_string()),
            },
        )
        .expect("snapshot"));
    assert!(store
        .try_claim_stage1("global", "rollout-1.md", "worker-b", 60, 1)
        .expect("claim after snapshot"));
    assert!(store
        .mark_stage1_failed("global", "rollout-1.md", "worker-b", 60, "provider")
        .expect("failure"));
    assert!(!store
        .try_claim_stage1("global", "rollout-1.md", "worker-c", 60, 1)
        .expect("backoff"));
}

#[test]
fn phase2_snapshot_commits_watermark_and_selected_sources_together() {
    let temp = tempfile::tempdir().expect("tempdir");
    let store = MemoryStateStore::new(temp.path());
    let snapshot = extract(&store, "rollout-1.md", "candidate", "1");
    assert!(store
        .try_claim_phase2("global", "owner-a", 60)
        .expect("claim"));
    assert!(store
        .commit_phase2_snapshot("global", "owner-a", 42, &[snapshot])
        .expect("commit"));
    assert_eq!(store.count_consolidated("global").expect("count"), 1);
}

#[test]
fn citation_usage_resolves_exported_source_thread_identity() {
    let temp = tempfile::tempdir().unwrap();
    let store = MemoryStateStore::new(temp.path());
    let content = "# rollout\n\n- threadId: `thread-1`\n";
    let source_updated_at = test_now_seconds().to_string();
    store
        .register_rollout(
            "global",
            "rollout.md",
            content,
            &source_updated_at,
        )
        .unwrap();
    assert!(store
        .try_claim_stage1("global", "rollout.md", "worker", 60, 8)
        .unwrap());
    assert!(store
        .save_stage1_output(
            "global",
            "rollout.md",
            "worker",
            StageOneOutputSnapshot {
                source_path: "rollout.md".into(),
                content_hash: hash_content(content),
                source_updated_at,
                raw_memory: Some("fact".into()),
                rollout_summary: "summary".into(),
                rollout_slug: None,
            },
        )
        .unwrap());
    assert_eq!(
        store
            .record_stage1_usage_for_thread_ids("global", &["thread-1"])
            .unwrap(),
        1
    );
    let usage: i64 = store
        .open()
        .unwrap()
        .query_row(
            "SELECT usage_count FROM memory_rollout_jobs WHERE scope_key = 'global' AND source_path = 'rollout.md'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(usage, 1);
}

fn test_now_seconds() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64
}

#[test]
fn phase2_heartbeat_requires_current_owner() {
    let temp = tempfile::tempdir().expect("tempdir");
    let store = MemoryStateStore::new(temp.path());
    assert!(store
        .try_claim_phase2("global", "owner-a", 60)
        .expect("claim"));
    assert!(store
        .heartbeat_phase2("global", "owner-a", 120)
        .expect("heartbeat"));
    assert!(!store
        .heartbeat_phase2("global", "owner-b", 120)
        .expect("foreign heartbeat"));
}

#[test]
fn stage1_no_output_clears_previous_snapshot_and_selection() {
    let temp = tempfile::tempdir().expect("tempdir");
    let store = MemoryStateStore::new(temp.path());
    store
        .register_rollout("global", "rollout-1.md", "candidate", "1")
        .expect("register");
    assert!(store
        .try_claim_stage1("global", "rollout-1.md", "worker-a", 60, 1)
        .expect("claim"));
    assert!(store
        .save_stage1_output(
            "global",
            "rollout-1.md",
            "worker-a",
            StageOneOutputSnapshot {
                source_path: "rollout-1.md".to_string(),
                content_hash: hash_content("candidate"),
                source_updated_at: "1".to_string(),
                raw_memory: Some("fact".to_string()),
                rollout_summary: "summary".to_string(),
                rollout_slug: Some("slug".to_string()),
            },
        )
        .expect("snapshot"));
    assert!(store
        .try_claim_phase2("global", "owner-a", 60)
        .expect("claim phase2"));
    let selected = store.stage2_candidates("global", 20).expect("snapshots");
    assert!(store
        .commit_phase2_snapshot("global", "owner-a", 1, &selected)
        .expect("commit phase2"));
    assert!(store
        .try_claim_stage1("global", "rollout-1.md", "worker-b", 60, 1)
        .expect("reclaim"));
    assert!(store
        .mark_stage1_no_output("global", "rollout-1.md", "worker-b")
        .expect("mark no output"));

    let conn = store.open().expect("open state");
    let row = conn
        .query_row(
            "SELECT status, output_rollout_summary, selected_for_phase2, last_error FROM memory_rollout_jobs WHERE scope_key = 'global' AND source_path = 'rollout-1.md'",
            [],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, Option<String>>(3)?,
                ))
            },
        )
        .expect("read no-output state");
    assert_eq!(row.0, "review");
    assert_eq!(row.1, None);
    assert_eq!(row.2, 0);
    assert_eq!(row.3.as_deref(), Some("no_output"));
}
