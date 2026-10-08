use super::*;
use app_server_protocol::protocol::v2::{ThreadItem, Turn, TurnItemsView, TurnStatus};

fn user_item(text: &str) -> ThreadItem {
    ThreadItem::UserMessage {
        id: String::from("user"),
        metadata: None,
        client_id: None,
        content: vec![UserInput::Text {
            text: text.to_string(),
            text_elements: Vec::new(),
        }],
    }
}

fn assistant_item(text: &str) -> ThreadItem {
    ThreadItem::AgentMessage {
        id: String::from("assistant"),
        metadata: None,
        text: text.to_string(),
        phase: None,
        memory_citation: None,
        delivery: None,
    }
}

#[test]
fn preview_keeps_newest_lines_and_restores_transcript_order() {
    let lines = preview_from_items(&[
        user_item("first\nsecond"),
        assistant_item("third\n\nfourth"),
    ]);

    assert_eq!(
        lines,
        vec![
            TranscriptPreviewLine {
                speaker: TranscriptPreviewSpeaker::User,
                text: String::from("first"),
            },
            TranscriptPreviewLine {
                speaker: TranscriptPreviewSpeaker::User,
                text: String::from("second"),
            },
            TranscriptPreviewLine {
                speaker: TranscriptPreviewSpeaker::Assistant,
                text: String::from("third"),
            },
            TranscriptPreviewLine {
                speaker: TranscriptPreviewSpeaker::Assistant,
                text: String::from("fourth"),
            },
        ]
    );
}

#[test]
fn preview_ignores_non_text_inputs_and_blank_lines() {
    let lines = preview_from_items(&[ThreadItem::UserMessage {
        id: String::from("user"),
        metadata: None,
        client_id: None,
        content: vec![
            UserInput::Image {
                detail: None,
                url: String::from("https://example.test/image.png"),
            },
            UserInput::Text {
                text: String::from("  visible  \n\n"),
                text_elements: Vec::new(),
            },
        ],
    }]);

    assert_eq!(
        lines,
        vec![TranscriptPreviewLine {
            speaker: TranscriptPreviewSpeaker::User,
            text: String::from("visible"),
        }]
    );
}

#[test]
fn preview_is_bounded_to_six_lines() {
    let lines = preview_from_items(&[assistant_item("one\ntwo\nthree\nfour\nfive\nsix\nseven")]);

    assert_eq!(lines.len(), MAX_TRANSCRIPT_PREVIEW_LINES);
    assert_eq!(lines[0].text, "two");
    assert_eq!(lines[5].text, "seven");
}

#[test]
fn preview_pagination_fails_closed_on_a_repeated_cursor() {
    let mut seen = std::collections::HashSet::from([String::from("head")]);
    assert_eq!(
        next_preview_cursor(Some(String::from("tail")), &mut seen).unwrap(),
        Some(String::from("tail"))
    );
    assert_eq!(
        next_preview_cursor(Some(String::from("tail")), &mut seen)
            .unwrap_err()
            .kind(),
        io::ErrorKind::InvalidData
    );
}

#[test]
fn preview_uses_canonical_review_filtering_before_selecting_speakers() {
    let lines = preview_from_items(&[
        ThreadItem::EnteredReviewMode {
            id: String::from("review-enter"),
            metadata: None,
            review: String::from("review"),
        },
        user_item("hidden review prompt"),
        ThreadItem::ExitedReviewMode {
            id: String::from("review-exit"),
            metadata: None,
            review: String::from("review"),
        },
        assistant_item("visible answer"),
    ]);

    assert_eq!(
        lines,
        vec![TranscriptPreviewLine {
            speaker: TranscriptPreviewSpeaker::Assistant,
            text: String::from("visible answer"),
        }]
    );
}

#[test]
fn bounded_preview_applies_turn_review_ids_across_page_boundaries() {
    let turn = Turn {
        id: String::from("review-turn"),
        items: vec![
            ThreadItem::EnteredReviewMode {
                id: String::from("review-enter"),
                metadata: None,
                review: String::from("review"),
            },
            user_item("hidden review prompt"),
            ThreadItem::ExitedReviewMode {
                id: String::from("review-exit"),
                metadata: None,
                review: String::from("review"),
            },
        ],
        items_view: TurnItemsView::Full,
        status: TurnStatus::Completed,
        error: None,
        started_at: Some(1),
        completed_at: Some(2),
        duration_ms: Some(1),
    };
    let lines = preview_from_items_with_turns(
        &[
            user_item("hidden review prompt"),
            assistant_item("visible answer"),
        ],
        &[turn],
    );

    assert_eq!(
        lines,
        vec![TranscriptPreviewLine {
            speaker: TranscriptPreviewSpeaker::Assistant,
            text: String::from("visible answer"),
        }]
    );
}

#[test]
fn preview_from_entries_returns_newest_lines_in_transcript_order() {
    let lines = preview_from_entries(vec![
        (TranscriptPreviewSpeaker::User, String::from("first")),
        (
            TranscriptPreviewSpeaker::Assistant,
            String::from("second\nthird"),
        ),
    ]);

    assert_eq!(
        lines,
        vec![
            TranscriptPreviewLine {
                speaker: TranscriptPreviewSpeaker::User,
                text: String::from("first"),
            },
            TranscriptPreviewLine {
                speaker: TranscriptPreviewSpeaker::Assistant,
                text: String::from("second"),
            },
            TranscriptPreviewLine {
                speaker: TranscriptPreviewSpeaker::Assistant,
                text: String::from("third"),
            },
        ]
    );
}
