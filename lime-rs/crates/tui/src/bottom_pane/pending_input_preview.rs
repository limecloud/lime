use app_server_protocol::protocol::v2::{QueuedSubmission, UserInput};
use ratatui::layout::Rect;
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::Paragraph;
use ratatui::Frame;

use crate::line_truncation::truncate_line_with_ellipsis_if_overflow;
use crate::locale::Locale;
use crate::terminal_hyperlinks::{wrap_hyperlink_line, HyperlinkLine};

const MAX_VISIBLE_SUBMISSIONS: usize = 2;
const MAX_LINES_PER_SUBMISSION: usize = 2;

pub(crate) fn desired_height(submissions: &[QueuedSubmission], width: u16, locale: Locale) -> u16 {
    u16::try_from(preview_lines(submissions, width, locale).len()).unwrap_or(u16::MAX)
}

pub(crate) fn render(
    frame: &mut Frame<'_>,
    area: Rect,
    submissions: &[QueuedSubmission],
    locale: Locale,
) {
    if area.is_empty() {
        return;
    }
    frame.render_widget(
        Paragraph::new(preview_lines(submissions, area.width, locale)),
        area,
    );
}

fn preview_lines(
    submissions: &[QueuedSubmission],
    width: u16,
    locale: Locale,
) -> Vec<Line<'static>> {
    if submissions.is_empty() || width < 4 {
        return Vec::new();
    }

    let mut lines = vec![truncate_line_with_ellipsis_if_overflow(
        Line::styled(
            format!("• {} ({})", locale.status("queued"), submissions.len()),
            Style::default()
                .fg(Color::DarkGray)
                .add_modifier(Modifier::BOLD),
        ),
        usize::from(width),
    )];
    for submission in submissions.iter().take(MAX_VISIBLE_SUBMISSIONS) {
        lines.extend(submission_preview_lines(submission, width, locale));
    }
    if submissions.len() > MAX_VISIBLE_SUBMISSIONS {
        lines.push(truncate_line_with_ellipsis_if_overflow(
            Line::styled(
                format!("   … +{}", submissions.len() - MAX_VISIBLE_SUBMISSIONS),
                Style::default().fg(Color::DarkGray),
            ),
            usize::from(width),
        ));
    }
    if submissions.last().is_some_and(can_restore_submission) {
        let shortcut = crate::keymap::queued_input_edit_shortcut_label();
        lines.push(truncate_line_with_ellipsis_if_overflow(
            Line::styled(
                format!("   {}", locale.edit_queued_input_hint(&shortcut)),
                Style::default().fg(Color::DarkGray),
            ),
            usize::from(width),
        ));
    }
    lines
}

pub(crate) fn can_restore_submission(submission: &QueuedSubmission) -> bool {
    // Queue editing keeps its existing policy for Mention; restoration itself is shared.
    !submission
        .input
        .iter()
        .any(|input| matches!(input, UserInput::Mention { .. }))
        && super::BottomPane::can_restore_user_inputs(&submission.input)
}

fn submission_preview_lines(
    submission: &QueuedSubmission,
    width: u16,
    locale: Locale,
) -> Vec<Line<'static>> {
    let content_width = usize::from(width.saturating_sub(4).max(1));
    let summary = submission_summary(submission, locale);
    let mut wrapped = summary
        .lines()
        .flat_map(|line| {
            wrap_hyperlink_line(
                &HyperlinkLine::new(Line::styled(
                    line.to_string(),
                    Style::default().add_modifier(Modifier::ITALIC),
                )),
                content_width,
            )
        })
        .map(|line| line.line)
        .collect::<Vec<_>>();
    if wrapped.is_empty() {
        wrapped.push(Line::styled(
            locale.not_set_label(),
            Style::default().add_modifier(Modifier::ITALIC),
        ));
    }

    let overflow = wrapped.len() > MAX_LINES_PER_SUBMISSION;
    wrapped.truncate(MAX_LINES_PER_SUBMISSION);
    let mut lines = wrapped
        .into_iter()
        .enumerate()
        .map(|(index, line)| {
            let mut spans = vec![Span::styled(
                if index == 0 { " ↳ " } else { "   " },
                Style::default().fg(Color::DarkGray),
            )];
            spans.extend(line.spans);
            Line::from(spans)
        })
        .collect::<Vec<_>>();
    if overflow {
        lines.push(Line::styled("   …", Style::default().fg(Color::DarkGray)));
    }
    lines
}

fn submission_summary(submission: &QueuedSubmission, locale: Locale) -> String {
    let mut parts = Vec::new();
    let mut image_count = 0usize;
    for input in &submission.input {
        match input {
            UserInput::Text { text, .. } if !text.trim().is_empty() => {
                parts.push(text.trim().to_string());
            }
            UserInput::Image { .. } | UserInput::LocalImage { .. } => image_count += 1,
            UserInput::Skill { name, .. } => parts.push(format!("${name}")),
            UserInput::Mention { name, .. } => parts.push(format!("@{name}")),
            UserInput::Text { .. } => {}
        }
    }
    if image_count > 0 {
        parts.push(format!("[{} ×{image_count}]", locale.image_label()));
    }
    parts.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::line_truncation::line_width;

    fn submission(id: &str, input: Vec<UserInput>) -> QueuedSubmission {
        QueuedSubmission {
            id: id.to_string(),
            input,
            client_user_message_id: format!("client-{id}"),
        }
    }

    fn line_text(line: &Line<'_>) -> String {
        line.spans
            .iter()
            .map(|span| span.content.as_ref())
            .collect()
    }

    #[test]
    fn preview_uses_canonical_multimodal_queue_and_caps_visible_items() {
        let submissions = vec![
            submission(
                "queue-1",
                vec![
                    UserInput::LocalImage {
                        detail: None,
                        path: "/tmp/one.png".to_string(),
                    },
                    UserInput::Text {
                        text: "first follow-up".to_string(),
                        text_elements: Vec::new(),
                    },
                ],
            ),
            submission(
                "queue-2",
                vec![UserInput::Text {
                    text: "second follow-up".to_string(),
                    text_elements: Vec::new(),
                }],
            ),
            submission(
                "queue-3",
                vec![UserInput::Text {
                    text: "third follow-up".to_string(),
                    text_elements: Vec::new(),
                }],
            ),
        ];

        let text = preview_lines(&submissions, 80, Locale::EnUs)
            .iter()
            .map(line_text)
            .collect::<Vec<_>>()
            .join("\n");

        assert!(text.contains("queued (3)"), "{text}");
        assert!(text.contains("first follow-up"), "{text}");
        assert!(text.contains("[image ×1]"), "{text}");
        assert!(text.contains("second follow-up"), "{text}");
        assert!(!text.contains("third follow-up"), "{text}");
        assert!(text.contains("… +1"), "{text}");
    }

    #[test]
    fn narrow_preview_wraps_and_caps_each_submission() {
        let submissions = vec![submission(
            "queue-1",
            vec![UserInput::Text {
                text: "one two three four five six seven eight nine".to_string(),
                text_elements: Vec::new(),
            }],
        )];

        let lines = preview_lines(&submissions, 12, Locale::EnUs);

        assert_eq!(lines.len(), 5);
        assert_eq!(line_text(&lines[3]), "   …");
        assert!(line_text(lines.last().expect("edit hint"))
            .contains(&crate::keymap::queued_input_edit_shortcut_label()));
        assert!(lines.iter().all(|line| line_width(line) <= 12));
    }

    #[test]
    fn edit_hint_requires_a_lossless_composer_projection() {
        let local = submission(
            "local",
            vec![UserInput::LocalImage {
                detail: None,
                path: "/tmp/local.png".to_string(),
            }],
        );
        let remote = submission(
            "remote",
            vec![UserInput::Image {
                detail: None,
                url: "https://example.test/image.png".to_string(),
            }],
        );
        let skill = submission(
            "skill",
            vec![UserInput::Skill {
                name: "review".to_string(),
                path: "/skills/review/SKILL.md".to_string(),
            }],
        );
        let structured = submission(
            "structured",
            vec![
                UserInput::Text {
                    text: "first segment".to_string(),
                    text_elements: Vec::new(),
                },
                UserInput::Text {
                    text: "second segment".to_string(),
                    text_elements: Vec::new(),
                },
            ],
        );

        assert!(can_restore_submission(&local));
        assert!(can_restore_submission(&remote));
        assert!(can_restore_submission(&skill));
        assert!(can_restore_submission(&structured));
        let invalid = submission(
            "invalid",
            vec![UserInput::Text {
                text: "界[Image #1]".into(),
                text_elements: vec![agent_protocol::TextElement::new(
                    1..13,
                    Some("[Image #1]".into()),
                )],
            }],
        );
        assert!(!can_restore_submission(&invalid));
        assert!(preview_lines(&[remote], 80, Locale::EnUs)
            .iter()
            .map(line_text)
            .collect::<String>()
            .contains(&crate::keymap::queued_input_edit_shortcut_label()));
    }

    #[test]
    fn queue_header_and_image_label_cover_all_product_locales() {
        let cases = [
            (Locale::ZhCn, "已排队", "图片"),
            (Locale::ZhTw, "已排隊", "圖片"),
            (Locale::EnUs, "queued", "image"),
            (Locale::JaJp, "キューに追加済み", "画像"),
            (Locale::KoKr, "대기열에 추가됨", "이미지"),
        ];
        for (locale, queued, image) in cases {
            let lines = preview_lines(
                &[submission(
                    "queue-1",
                    vec![UserInput::Image {
                        detail: None,
                        url: "https://example.test/image.png".to_string(),
                    }],
                )],
                80,
                locale,
            );
            let text = lines.iter().map(line_text).collect::<Vec<_>>().join("\n");
            assert!(text.contains(queued), "{locale:?}: {text}");
            assert!(text.contains(image), "{locale:?}: {text}");
        }
    }

    #[test]
    fn queued_edit_hint_stays_width_bounded_across_locales_and_narrow_terminals() {
        let queued = submission(
            "unicode",
            vec![UserInput::Text {
                text: "你好🙂 queued follow-up".to_string(),
                text_elements: Vec::new(),
            }],
        );
        for locale in [
            Locale::ZhCn,
            Locale::ZhTw,
            Locale::EnUs,
            Locale::JaJp,
            Locale::KoKr,
        ] {
            for width in [4, 5, 8, 12, 20, 40] {
                let lines = preview_lines(std::slice::from_ref(&queued), width, locale);
                assert!(
                    lines
                        .iter()
                        .all(|line| line_width(line) <= usize::from(width)),
                    "{locale:?} at {width}: {lines:?}"
                );
            }
        }
    }

    #[test]
    fn typed_metadata_enables_edit_hint_but_invalid_ranges_remain_fail_closed() {
        use agent_protocol::{ImageDetail, TextElement};
        for detail in [
            None,
            Some(ImageDetail::Auto),
            Some(ImageDetail::Low),
            Some(ImageDetail::High),
            Some(ImageDetail::Original),
        ] {
            let queued = submission(
                "typed",
                vec![
                    UserInput::Image {
                        url: "data:image/png;base64,AA==".into(),
                        detail,
                    },
                    UserInput::LocalImage {
                        path: "one.png".into(),
                        detail,
                    },
                    UserInput::Text {
                        text: "界[token]".into(),
                        text_elements: vec![TextElement::new(3..10, None)],
                    },
                ],
            );
            assert!(can_restore_submission(&queued));
            for locale in [
                Locale::ZhCn,
                Locale::ZhTw,
                Locale::EnUs,
                Locale::JaJp,
                Locale::KoKr,
            ] {
                assert!(
                    preview_lines(std::slice::from_ref(&queued), 80, locale)
                        .iter()
                        .map(line_text)
                        .collect::<String>()
                        .contains(&locale.edit_queued_input_hint(
                            &crate::keymap::queued_input_edit_shortcut_label()
                        )),
                    "{locale:?} / {detail:?}"
                );
            }
        }
        for elements in [
            vec![TextElement::new(1..10, None)],
            vec![TextElement::new(3..11, None)],
            vec![TextElement::new(3..3, None)],
            vec![TextElement::new(3..10, Some("different".into()))],
            vec![TextElement::new(3..7, None), TextElement::new(6..10, None)],
            vec![TextElement::new(7..10, None), TextElement::new(3..7, None)],
        ] {
            assert!(!can_restore_submission(&submission(
                "invalid",
                vec![UserInput::Text {
                    text: "界[token]".into(),
                    text_elements: elements
                }]
            )));
        }
    }
}
