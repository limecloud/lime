use super::*;
use crate::bottom_pane::LocalImageAttachment;
use agent_protocol::TextElement;

fn history(texts: &[&str]) -> ChatComposerHistory {
    let mut history = ChatComposerHistory::default();
    history.set_cached_entries(texts.iter().map(|text| (*text).to_string()));
    history
}

fn found(text: &str) -> HistorySearchResult {
    HistorySearchResult::Found(HistoryEntry::new(text.into()))
}

#[test]
fn search_skips_exact_duplicates_and_revisits_cached_matches_in_both_directions() {
    let mut history = history(&["git status", "cargo test", "git status", "git diff"]);
    assert_eq!(
        history.search(
            "GIT",
            HistorySearchDirection::Older,
            true,
            &AppEventSender::default()
        ),
        found("git diff")
    );
    assert_eq!(
        history.search(
            "GIT",
            HistorySearchDirection::Older,
            false,
            &AppEventSender::default()
        ),
        found("git status")
    );
    for _ in 0..2 {
        assert_eq!(
            history.search(
                "GIT",
                HistorySearchDirection::Older,
                false,
                &AppEventSender::default()
            ),
            HistorySearchResult::AtBoundary
        );
    }
    assert_eq!(
        history.search(
            "GIT",
            HistorySearchDirection::Newer,
            false,
            &AppEventSender::default()
        ),
        found("git diff")
    );
    assert_eq!(
        history.search(
            "GIT",
            HistorySearchDirection::Newer,
            false,
            &AppEventSender::default()
        ),
        HistorySearchResult::AtBoundary
    );
    assert_eq!(
        history.search(
            "GIT",
            HistorySearchDirection::Older,
            false,
            &AppEventSender::default()
        ),
        found("git status")
    );
}

#[test]
fn case_insensitive_matching_does_not_merge_case_distinct_prompt_text() {
    let mut history = history(&["Deploy", "deploy", "deploy"]);
    assert_eq!(
        history.search(
            "DEP",
            HistorySearchDirection::Older,
            true,
            &AppEventSender::default()
        ),
        found("deploy")
    );
    assert_eq!(
        history.search(
            "DEP",
            HistorySearchDirection::Older,
            false,
            &AppEventSender::default()
        ),
        found("Deploy")
    );
    assert_eq!(
        history.search(
            "DEP",
            HistorySearchDirection::Older,
            false,
            &AppEventSender::default()
        ),
        HistorySearchResult::AtBoundary
    );
}

#[test]
fn changed_query_explicit_restart_and_history_mutation_reset_unique_traversal() {
    let mut history = history(&["git status", "cargo test", "git diff"]);
    history.search(
        "git",
        HistorySearchDirection::Older,
        true,
        &AppEventSender::default(),
    );
    history.search(
        "git",
        HistorySearchDirection::Older,
        false,
        &AppEventSender::default(),
    );
    assert_eq!(
        history.search(
            "git",
            HistorySearchDirection::Older,
            true,
            &AppEventSender::default()
        ),
        found("git diff")
    );
    assert_eq!(
        history.search(
            "cargo",
            HistorySearchDirection::Older,
            false,
            &AppEventSender::default()
        ),
        found("cargo test")
    );
    assert_eq!(
        history.search(
            "absent",
            HistorySearchDirection::Older,
            true,
            &AppEventSender::default()
        ),
        HistorySearchResult::NotFound
    );
    history.record_local_submission(HistoryEntry::new("new git".into()));
    assert_eq!(
        history.search(
            "git",
            HistorySearchDirection::Older,
            false,
            &AppEventSender::default()
        ),
        found("new git")
    );
    history.reset_navigation();
    assert_eq!(
        history.navigate_up(&AppEventSender::default()),
        Some(HistoryEntry::new("new git".into()))
    );
}

#[test]
fn rich_local_match_wins_duplicate_text_and_cached_navigation_keeps_its_identity() {
    let mut history = history(&["historic [Image #1]", "other historic"]);
    let rich = HistoryEntry {
        text: "historic [Image #1]".into(),
        text_elements: vec![TextElement::new(9..19, Some("[Image #1]".into()))],
        local_images: vec![LocalImageAttachment {
            placeholder: "[Image #1]".into(),
            path: "image.png".into(),
            detail: None,
        }],
        remote_images: Vec::new(),
        pending_pastes: Vec::new(),
        mention_bindings: Vec::new(),
    };
    history.record_local_submission(rich.clone());
    assert_eq!(
        history.search(
            "historic",
            HistorySearchDirection::Older,
            true,
            &AppEventSender::default()
        ),
        HistorySearchResult::Found(rich.clone())
    );
    assert_eq!(
        history.search(
            "historic",
            HistorySearchDirection::Older,
            false,
            &AppEventSender::default()
        ),
        found("other historic")
    );
    assert_eq!(
        history.search(
            "historic",
            HistorySearchDirection::Older,
            false,
            &AppEventSender::default()
        ),
        HistorySearchResult::AtBoundary
    );
    assert_eq!(
        history.search(
            "historic",
            HistorySearchDirection::Newer,
            false,
            &AppEventSender::default()
        ),
        HistorySearchResult::Found(rich)
    );
}

#[test]
fn empty_history_misses_and_empty_query_traversal_remains_history_owner_policy() {
    assert_eq!(
        ChatComposerHistory::default().search(
            "x",
            HistorySearchDirection::Older,
            true,
            &AppEventSender::default()
        ),
        HistorySearchResult::NotFound
    );
    let mut history = history(&["first", "second"]);
    assert_eq!(
        history.search(
            "",
            HistorySearchDirection::Older,
            true,
            &AppEventSender::default()
        ),
        found("second")
    );
    assert_eq!(
        history.search(
            "",
            HistorySearchDirection::Older,
            false,
            &AppEventSender::default()
        ),
        found("first")
    );
}
