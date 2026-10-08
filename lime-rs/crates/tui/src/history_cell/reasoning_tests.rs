use super::*;
use crate::history_cell::TranscriptHistoryCell;
use crate::locale::Locale;
use crate::projection::{EntryKind, TranscriptEntry};
use ratatui::style::Modifier;

#[test]
fn structured_parts_match_codex_header_and_placeholder_rules() {
    for (parts, header, content) in [
        (vec!["  ", "<!-- -->"], "", ""),
        (
            vec!["**Status**\n\n<!-- -->", "**Next**\n<!-- -->"],
            "**Status**",
            "",
        ),
        (
            vec!["**Plan**\n\nTests passed"],
            "**Plan**",
            "\n\nTests passed",
        ),
        (
            vec!["**Plan**\r\nTests passed"],
            "**Plan**",
            "\r\nTests passed",
        ),
        (
            vec!["**Status**\n<!-- -->", "**Plan**\nTests passed"],
            "**Plan**",
            "\nTests passed",
        ),
        (
            vec![
                "**Status**\n<!-- -->",
                "**Important conclusion**",
                "<!-- -->",
            ],
            "**Status**",
            "**Important conclusion**",
        ),
        (
            vec!["**Plan**\nDone", "**Status**\n<!-- -->", "Second paragraph"],
            "**Plan**",
            "\nDone\n\nSecond paragraph",
        ),
        (vec!["**Bold only**\n\n  "], "", "**Bold only**"),
        (
            vec!["**Result:** keep **this**"],
            "",
            "**Result:** keep **this**",
        ),
        (vec!["**Unclosed title"], "", "**Unclosed title"),
        (
            vec!["**Plan**\nUse `<!-- -->` in JSX."],
            "**Plan**",
            "\nUse `<!-- -->` in JSX.",
        ),
        (
            vec!["<!-- literal -->", "正文", "第二段"],
            "",
            "<!-- literal -->\n\n正文\n\n第二段",
        ),
    ] {
        let parts = parts.into_iter().map(String::from).collect::<Vec<_>>();
        assert_eq!(
            split_reasoning_summary_parts(&parts),
            (header.into(), content.into()),
            "{parts:?}"
        );
    }
}

#[test]
fn actual_projection_cell_hides_compact_reasoning_and_renders_only_body_in_details() {
    let cell = TranscriptHistoryCell::new(
        TranscriptEntry {
            id: "canonical-reasoning".into(),
            kind: EntryKind::Reasoning,
            text: "\n\nTests **passed**.\n\nUse `<!-- -->` in JSX.".into(),
            streaming: false,
            status: None,
            summary: Vec::new(),
            activity_group: None,
            activity_detail: None,
        },
        Locale::EnUs,
        PathBuf::from("/workspace"),
    );
    assert_eq!(cell.entry().id, "canonical-reasoning");
    assert!(cell.display_lines(80).is_empty());
    assert!(cell.compact_hyperlink_lines(80).is_empty());
    assert!(cell.raw_lines().is_empty());
    let lines = cell.transcript_lines(80);
    assert_eq!(
        lines.iter().map(Line::to_string).collect::<Vec<_>>(),
        ["• Tests passed.", "  ", "  Use <!-- --> in JSX."]
    );
    assert_eq!(
        cell.expanded_hyperlink_lines(80),
        cell.transcript_hyperlink_lines(80)
    );
    for span in lines
        .iter()
        .flat_map(|line| &line.spans)
        .filter(|span| !span.content.trim().is_empty() && !span.content.contains('•'))
    {
        assert!(
            span.style
                .add_modifier
                .contains(Modifier::DIM | Modifier::ITALIC),
            "{span:?}"
        );
    }
    let empty = ReasoningSummaryCell::new(String::new(), Path::new("/workspace"));
    assert!(empty.transcript_lines(80).is_empty());
}

#[test]
fn reasoning_cell_preserves_cwd_links_and_wraps_body_with_reserved_prefix_columns() {
    let cwd = std::env::temp_dir().join("reasoning-cell-workspace");
    let cell = ReasoningSummaryCell::new(
        format!("Inspect [src/main.rs]({}) and [reference](https://example.test/reference) then **check these words across narrow rows**", cwd.join("src/main.rs").display()),
        &cwd,
    );
    let lines = cell.transcript_hyperlink_lines(24);
    assert!(lines.len() > 1);
    assert!(
        lines.iter().all(|line| line.line.width() <= 24),
        "{lines:?}"
    );
    let rendered = lines
        .iter()
        .map(|line| line.line.to_string())
        .collect::<Vec<_>>()
        .join("\n");
    assert!(rendered.contains("src/main.rs"), "{rendered}");
    assert!(
        !rendered.contains("reasoning-cell-workspace"),
        "cwd was not applied: {rendered}"
    );
    assert!(
        lines
            .iter()
            .flat_map(|line| &line.hyperlinks)
            .any(|link| link.destination == "https://example.test/reference"),
        "{lines:?}"
    );
    assert_eq!(cell.desired_transcript_height(24), lines.len() as u16);
}
