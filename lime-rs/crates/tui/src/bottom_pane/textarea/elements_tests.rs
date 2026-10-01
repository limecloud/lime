use super::*;
use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use crossterm::event::{MouseButton, MouseEvent, MouseEventKind};
use ratatui::style::{Color, Modifier};

#[test]
fn canonical_none_placeholder_survives_utf8_edit_rename_snapshot_and_atomic_delete() {
    let mut area = TextArea::default();
    area.set_text_with_elements(
        "界[one] [two]",
        &[
            agent_protocol::TextElement::new(3..8, None),
            agent_protocol::TextElement::new(9..14, Some("[two]".into())),
        ],
    );
    let ids = area
        .text_element_snapshots()
        .iter()
        .map(|element| element.id)
        .collect::<Vec<_>>();
    area.set_cursor(0);
    area.insert("🙂 ");
    assert!(area.replace_element_payload("[one]", "[renamed]"));
    let expected = vec![
        agent_protocol::TextElement::new(8..17, None),
        agent_protocol::TextElement::new(18..23, Some("[two]".into())),
    ];
    assert_eq!(area.text(), "🙂 界[renamed] [two]");
    assert_eq!(area.text_elements(), expected);
    let snapshot = area.text_element_snapshots();
    assert_eq!(
        snapshot
            .iter()
            .map(|element| element.id)
            .collect::<Vec<_>>(),
        ids
    );
    let mut restored = TextArea::default();
    restored.set_text_clearing_elements(area.text());
    restored.restore_text_elements(&snapshot);
    assert_eq!(restored.text_elements(), expected);
    assert_eq!(restored.text_element_snapshots(), snapshot);
    restored.set_cursor(17);
    assert!(restored.remove_previous_grapheme());
    assert_eq!(restored.text(), "🙂 界 [two]");
    assert_eq!(
        restored.text_elements(),
        vec![agent_protocol::TextElement::new(
            9..14,
            Some("[two]".into())
        )]
    );
}

#[test]
fn element_rename_only_changes_registered_range_and_rebases_neighbors_cursor_and_roundtrip() {
    for cursor in [0, 14, 25, 29] {
        let mut area = TextArea::default();
        area.insert("界 ");
        area.insert_element("[Image #10]");
        area.insert_element("[Image #11]");
        area.insert(" tail [Image #10]");
        area.set_cursor(cursor);
        let before = area.cursor();
        assert!(area.replace_element_payload("[Image #10]", "[Image #9]"));
        assert_eq!(area.text(), "界 [Image #9][Image #11] tail [Image #10]");
        assert_eq!(
            area.text_elements(),
            vec![
                agent_protocol::TextElement::new(4..14, Some("[Image #9]".into())),
                agent_protocol::TextElement::new(14..25, Some("[Image #11]".into())),
            ]
        );
        assert_eq!(
            area.cursor(),
            if before < 4 {
                before
            } else if before <= 15 {
                14
            } else {
                before - 1
            }
        );
        assert!(!area.replace_element_payload("[Image #10]", "literal must not change"));
        let mut restored = TextArea::default();
        restored.replace(area.text().to_string());
        restored.restore_text_elements(&area.text_element_snapshots());
        assert_eq!(restored.text_elements(), area.text_elements());
        restored.set_cursor(14);
        restored.remove_previous_grapheme();
        assert_eq!(restored.text(), "界 [Image #11] tail [Image #10]");
    }
}

#[test]
fn elements_move_delete_and_replace_as_a_single_utf8_safe_unit() {
    let mut area = TextArea::default();
    area.insert("界 ");
    area.insert_element("[paste🙂]");
    area.insert(" end");
    let element = area.text_element_snapshots()[0].clone();
    area.set_cursor(element.range.start);
    area.move_right();
    assert_eq!(area.cursor(), element.range.end);
    area.move_left();
    assert_eq!(area.cursor(), element.range.start);
    area.set_cursor(element.range.start + 2);
    assert_eq!(area.cursor(), element.range.start);
    area.replace_range(element.range.start + 1..element.range.start + 2, "replaced");
    assert_eq!(area.text(), "界 replaced end");
    assert!(area.elements.is_empty());

    area.replace(String::new());
    area.insert_element("[paste]");
    assert!(area.remove_previous_grapheme());
    assert!(area.is_empty());
    area.insert_element("[paste]");
    area.set_cursor(0);
    assert!(area.remove_next_grapheme());
    assert!(area.is_empty());
}

#[test]
fn ordinary_insertions_shift_elements_but_never_split_their_payload() {
    let mut area = TextArea::default();
    area.insert_element("[one]");
    area.insert_element("[two]");
    area.insert_str_at(2, "界");
    assert_eq!(area.text(), "界[one][two]");
    let elements = area.text_element_snapshots();
    assert_eq!(elements[0].range, 3..8);
    assert_eq!(elements[1].range, 8..13);
    area.replace_range(5..11, "🙂");
    assert_eq!(area.text(), "界🙂");
    assert!(area.elements.is_empty());
    assert!(area.text().is_char_boundary(area.cursor()));
}

#[test]
fn restoration_rejects_invalid_mismatched_and_overlapping_ranges() {
    let mut area = TextArea::default();
    area.insert("界[ok]");
    area.restore_text_elements(&[
        TextElementSnapshot {
            id: 0,
            range: 1..2,
            text: "broken".into(),
            placeholder: None,
        },
        TextElementSnapshot {
            id: 1,
            range: 3..7,
            text: "[ok]".into(),
            placeholder: Some("[ok]".into()),
        },
        TextElementSnapshot {
            id: 2,
            range: 4..6,
            text: "ok".into(),
            placeholder: None,
        },
        TextElementSnapshot {
            id: 3,
            range: 50..60,
            text: "out of bounds".into(),
            placeholder: None,
        },
    ]);
    assert_eq!(
        area.text_element_ranges().cloned().collect::<Vec<_>>(),
        vec![3..7]
    );
    area.set_text_clearing_elements("fresh");
    assert!(area.elements.is_empty());
}

#[test]
fn wrapping_mouse_replacement_and_styled_render_share_atomic_ranges() {
    let mut area = TextArea::default();
    area.insert_element("[paste🙂]");
    area.insert(" tail");
    let rect = Rect::new(2, 1, 6, 3);
    let mut buffer = Buffer::empty(Rect::new(0, 0, 12, 5));
    buffer.set_style(buffer.area, Style::default().bg(Color::Yellow));
    let mut state = TextAreaState::default();
    area.render_ref_styled_with_highlights(rect, &mut buffer, &mut state, Style::default(), &[]);
    assert_eq!(buffer[(2, 1)].fg, Color::Cyan);
    assert_eq!(buffer[(0, 1)].fg, Color::Reset);
    assert_eq!(buffer[(2, 1)].bg, Color::Yellow);
    area.handle_mouse(
        MouseEvent {
            kind: MouseEventKind::Down(MouseButton::Left),
            column: 3,
            row: 1,
            modifiers: KeyModifiers::NONE,
        },
        state,
    );
    area.handle_mouse(
        MouseEvent {
            kind: MouseEventKind::Drag(MouseButton::Left),
            column: 5,
            row: 2,
            modifiers: KeyModifiers::NONE,
        },
        state,
    );
    let selected = area.mouse_selection_range().unwrap();
    assert_eq!(selected, 0.."[paste🙂]".len());
    area.insert("new");
    assert_eq!(area.text(), "new tail");
    assert!(area.elements.is_empty());
    assert!(!buffer[(0, 0)].modifier.contains(Modifier::REVERSED));
}

#[test]
fn all_vim_edits_keep_ranges_and_cursor_valid() {
    for sequence in ["x", "dw", "cwX", "rX", "oX", "OX", "RX", "A tail", "wwbe$"] {
        let mut area = TextArea::default();
        area.insert_element("[paste]");
        area.insert(" end");
        area.set_vim_enabled(true);
        area.set_cursor(0);
        for ch in sequence.chars() {
            area.input(KeyEvent::new(KeyCode::Char(ch), KeyModifiers::NONE));
            assert!(area.text().is_char_boundary(area.cursor()), "{sequence}");
            for element in area.text_element_snapshots() {
                assert_eq!(element.text, "[paste]", "{sequence}");
                assert!(
                    !(element.range.start < area.cursor() && area.cursor() < element.range.end),
                    "{sequence}"
                );
            }
        }
    }
}

#[test]
fn paste_retraction_refuses_elements_and_word_kills_consume_the_whole_element() {
    let mut area = TextArea::default();
    area.insert_element("[Pasted Content 1001 chars]");
    assert!(!area.retract_paste_burst(area.cursor() - 2));
    assert_eq!(area.elements.len(), 1);
    area.delete_backward_word();
    assert!(area.is_empty());
    assert_eq!(area.kill_buffer, "[Pasted Content 1001 chars]");
    area.insert_element("[Pasted Content 1001 chars]");
    area.set_cursor(0);
    area.delete_forward_word();
    assert!(area.is_empty());
}
