use super::*;

fn record(
    path: &str,
    owned: bool,
    created: Option<i64>,
    updated: i64,
    protected: bool,
) -> Candidate {
    Candidate {
        path: path.into(),
        owned,
        created_at_ms: created,
        updated_at_ms: updated,
        protected,
    }
}

#[test]
fn protected_records_do_not_consume_the_keep_count() {
    let result = plan(
        vec![
            record("pin", true, None, 0, true),
            record("old", true, None, 1, false),
            record("new", true, None, 2, false),
        ],
        1,
        0,
        false,
    );
    assert_eq!(result, vec![PathBuf::from("old")]);
}

#[test]
fn ownerless_precede_owned_with_unknown_birthtime_last_in_their_group() {
    let now = MIGRATION_CUTOFF_MS + 2 * HOUR_MS;
    let result = plan(
        vec![
            record("owned", true, None, 0, false),
            record("unknown", false, None, 0, false),
            record("older", false, Some(MIGRATION_CUTOFF_MS), 0, false),
            record("newer", false, Some(MIGRATION_CUTOFF_MS + 1), 0, false),
        ],
        1,
        now,
        false,
    );
    assert_eq!(result, ["older", "newer", "unknown"].map(PathBuf::from));
}

#[test]
fn owned_order_uses_activity_then_path_and_never_exceeds_the_excess_count() {
    let records = vec![
        record("c", true, None, 2, false),
        record("b", true, None, 1, false),
        record("a", true, None, 1, false),
    ];
    assert_eq!(plan(records, 2, 0, false), vec![PathBuf::from("a")]);
    assert!(plan(vec![record("a", true, None, 1, false)], 15, 0, false).is_empty());
}

#[test]
fn newborn_and_pre_migration_protection_apply_only_to_ownerless() {
    let now = MIGRATION_CUTOFF_MS + HOUR_MS;
    let records = || {
        vec![
            record("old", false, Some(MIGRATION_CUTOFF_MS - 1), 0, false),
            record("newborn", false, Some(now - 1), 0, false),
            record("future", false, Some(now + 1), 0, false),
            record("owned", true, Some(now), 1, false),
            record("keep", true, None, 2, false),
        ]
    };
    assert_eq!(plan(records(), 1, now, true), vec![PathBuf::from("owned")]);
    assert_eq!(
        plan(records(), 1, now, false),
        ["old", "owned"].map(PathBuf::from)
    );
}

#[test]
fn raised_limit_counts_only_eligible_records_and_rechecks_target_age() {
    let now = MIGRATION_CUTOFF_MS + 2 * HOUR_MS;
    let records = vec![
        record("legacy", false, Some(MIGRATION_CUTOFF_MS - 1), 0, false),
        record("newborn", false, Some(now - 1), 0, false),
        record("old", true, None, 100, false),
        record("keep", true, None, 2, false),
    ];
    // 快照可使old的活动时间变新；不重排目标，但必须尊重迁移保护和最新上限。
    assert!(permits_removal(&records, Path::new("old"), 1, now, true));
    assert!(!permits_removal(&records, Path::new("old"), 2, now, true));
    assert!(!permits_removal(
        &records,
        Path::new("legacy"),
        1,
        now,
        true
    ));
    assert!(!permits_removal(
        &records,
        Path::new("newborn"),
        1,
        now,
        false
    ));
    assert!(permits_removal(
        &records,
        Path::new("legacy"),
        1,
        now,
        false
    ));
}
