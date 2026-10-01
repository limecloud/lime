use super::*;
use serde_json::json;

fn dispatch(
    keymap: &RuntimeKeymap,
    context: KeymapContext,
    matcher: &mut KeyChordMatcher,
    key: KeyEvent,
) -> KeymapMatch<VimKeymapAction> {
    VimKeymap {
        normal: &keymap.vim_normal,
        operator: &keymap.vim_operator,
        text_object: &keymap.vim_text_object,
        search: &keymap.vim_search,
    }
    .dispatch(context, false, matcher, key)
}

#[test]
fn every_configured_action_dispatches_through_the_real_modal_snapshot() {
    let cases = [
        (
            "vim_normal",
            "enter_insert",
            KeymapContext::VimNormal,
            VimKeymapAction::Normal(VimNormalAction::EnterInsert),
        ),
        (
            "vim_normal",
            "append_after_cursor",
            KeymapContext::VimNormal,
            VimKeymapAction::Normal(VimNormalAction::AppendAfterCursor),
        ),
        (
            "vim_normal",
            "append_line_end",
            KeymapContext::VimNormal,
            VimKeymapAction::Normal(VimNormalAction::AppendLineEnd),
        ),
        (
            "vim_normal",
            "insert_line_start",
            KeymapContext::VimNormal,
            VimKeymapAction::Normal(VimNormalAction::InsertLineStart),
        ),
        (
            "vim_normal",
            "open_line_below",
            KeymapContext::VimNormal,
            VimKeymapAction::Normal(VimNormalAction::OpenLineBelow),
        ),
        (
            "vim_normal",
            "open_line_above",
            KeymapContext::VimNormal,
            VimKeymapAction::Normal(VimNormalAction::OpenLineAbove),
        ),
        (
            "vim_normal",
            "enter_replace_mode",
            KeymapContext::VimNormal,
            VimKeymapAction::Normal(VimNormalAction::EnterReplaceMode),
        ),
        (
            "vim_normal",
            "move_left",
            KeymapContext::VimNormal,
            VimKeymapAction::Normal(VimNormalAction::MoveLeft),
        ),
        (
            "vim_normal",
            "move_right",
            KeymapContext::VimNormal,
            VimKeymapAction::Normal(VimNormalAction::MoveRight),
        ),
        (
            "vim_normal",
            "move_up",
            KeymapContext::VimNormal,
            VimKeymapAction::Normal(VimNormalAction::MoveUp),
        ),
        (
            "vim_normal",
            "move_down",
            KeymapContext::VimNormal,
            VimKeymapAction::Normal(VimNormalAction::MoveDown),
        ),
        (
            "vim_normal",
            "move_word_forward",
            KeymapContext::VimNormal,
            VimKeymapAction::Normal(VimNormalAction::MoveWordForward),
        ),
        (
            "vim_normal",
            "move_word_backward",
            KeymapContext::VimNormal,
            VimKeymapAction::Normal(VimNormalAction::MoveWordBackward),
        ),
        (
            "vim_normal",
            "move_word_end",
            KeymapContext::VimNormal,
            VimKeymapAction::Normal(VimNormalAction::MoveWordEnd),
        ),
        (
            "vim_normal",
            "move_line_start",
            KeymapContext::VimNormal,
            VimKeymapAction::Normal(VimNormalAction::MoveLineStart),
        ),
        (
            "vim_normal",
            "move_line_end",
            KeymapContext::VimNormal,
            VimKeymapAction::Normal(VimNormalAction::MoveLineEnd),
        ),
        (
            "vim_normal",
            "find_forward",
            KeymapContext::VimNormal,
            VimKeymapAction::Normal(VimNormalAction::FindForward),
        ),
        (
            "vim_normal",
            "find_backward",
            KeymapContext::VimNormal,
            VimKeymapAction::Normal(VimNormalAction::FindBackward),
        ),
        (
            "vim_normal",
            "till_forward",
            KeymapContext::VimNormal,
            VimKeymapAction::Normal(VimNormalAction::TillForward),
        ),
        (
            "vim_normal",
            "till_backward",
            KeymapContext::VimNormal,
            VimKeymapAction::Normal(VimNormalAction::TillBackward),
        ),
        (
            "vim_normal",
            "jump_top",
            KeymapContext::VimNormal,
            VimKeymapAction::Normal(VimNormalAction::JumpTop),
        ),
        (
            "vim_normal",
            "jump_bottom",
            KeymapContext::VimNormal,
            VimKeymapAction::Normal(VimNormalAction::JumpBottom),
        ),
        (
            "vim_normal",
            "delete_char",
            KeymapContext::VimNormal,
            VimKeymapAction::Normal(VimNormalAction::DeleteChar),
        ),
        (
            "vim_normal",
            "replace_char",
            KeymapContext::VimNormal,
            VimKeymapAction::Normal(VimNormalAction::ReplaceChar),
        ),
        (
            "vim_normal",
            "repeat_last_change",
            KeymapContext::VimNormal,
            VimKeymapAction::Normal(VimNormalAction::RepeatLastChange),
        ),
        (
            "vim_normal",
            "substitute_char",
            KeymapContext::VimNormal,
            VimKeymapAction::Normal(VimNormalAction::SubstituteChar),
        ),
        (
            "vim_normal",
            "delete_to_line_end",
            KeymapContext::VimNormal,
            VimKeymapAction::Normal(VimNormalAction::DeleteToLineEnd),
        ),
        (
            "vim_normal",
            "change_to_line_end",
            KeymapContext::VimNormal,
            VimKeymapAction::Normal(VimNormalAction::ChangeToLineEnd),
        ),
        (
            "vim_normal",
            "yank_line",
            KeymapContext::VimNormal,
            VimKeymapAction::Normal(VimNormalAction::YankLine),
        ),
        (
            "vim_normal",
            "paste_after",
            KeymapContext::VimNormal,
            VimKeymapAction::Normal(VimNormalAction::PasteAfter),
        ),
        (
            "vim_normal",
            "start_delete_operator",
            KeymapContext::VimNormal,
            VimKeymapAction::Normal(VimNormalAction::StartDeleteOperator),
        ),
        (
            "vim_normal",
            "start_yank_operator",
            KeymapContext::VimNormal,
            VimKeymapAction::Normal(VimNormalAction::StartYankOperator),
        ),
        (
            "vim_normal",
            "start_change_operator",
            KeymapContext::VimNormal,
            VimKeymapAction::Normal(VimNormalAction::StartChangeOperator),
        ),
        (
            "vim_normal",
            "undo",
            KeymapContext::VimNormal,
            VimKeymapAction::Normal(VimNormalAction::Undo),
        ),
        (
            "vim_normal",
            "redo",
            KeymapContext::VimNormal,
            VimKeymapAction::Normal(VimNormalAction::Redo),
        ),
        (
            "vim_normal",
            "cancel_operator",
            KeymapContext::VimNormal,
            VimKeymapAction::Normal(VimNormalAction::CancelOperator),
        ),
        (
            "vim_operator",
            "delete_line",
            KeymapContext::VimOperator,
            VimKeymapAction::Operator(VimOperatorAction::DeleteLine),
        ),
        (
            "vim_operator",
            "yank_line",
            KeymapContext::VimOperator,
            VimKeymapAction::Operator(VimOperatorAction::YankLine),
        ),
        (
            "vim_operator",
            "motion_left",
            KeymapContext::VimOperator,
            VimKeymapAction::Operator(VimOperatorAction::MotionLeft),
        ),
        (
            "vim_operator",
            "motion_right",
            KeymapContext::VimOperator,
            VimKeymapAction::Operator(VimOperatorAction::MotionRight),
        ),
        (
            "vim_operator",
            "motion_up",
            KeymapContext::VimOperator,
            VimKeymapAction::Operator(VimOperatorAction::MotionUp),
        ),
        (
            "vim_operator",
            "motion_down",
            KeymapContext::VimOperator,
            VimKeymapAction::Operator(VimOperatorAction::MotionDown),
        ),
        (
            "vim_operator",
            "motion_word_forward",
            KeymapContext::VimOperator,
            VimKeymapAction::Operator(VimOperatorAction::MotionWordForward),
        ),
        (
            "vim_operator",
            "motion_word_backward",
            KeymapContext::VimOperator,
            VimKeymapAction::Operator(VimOperatorAction::MotionWordBackward),
        ),
        (
            "vim_operator",
            "motion_word_end",
            KeymapContext::VimOperator,
            VimKeymapAction::Operator(VimOperatorAction::MotionWordEnd),
        ),
        (
            "vim_operator",
            "motion_line_start",
            KeymapContext::VimOperator,
            VimKeymapAction::Operator(VimOperatorAction::MotionLineStart),
        ),
        (
            "vim_operator",
            "motion_line_end",
            KeymapContext::VimOperator,
            VimKeymapAction::Operator(VimOperatorAction::MotionLineEnd),
        ),
        (
            "vim_operator",
            "motion_find_forward",
            KeymapContext::VimOperator,
            VimKeymapAction::Operator(VimOperatorAction::MotionFindForward),
        ),
        (
            "vim_operator",
            "motion_find_backward",
            KeymapContext::VimOperator,
            VimKeymapAction::Operator(VimOperatorAction::MotionFindBackward),
        ),
        (
            "vim_operator",
            "motion_till_forward",
            KeymapContext::VimOperator,
            VimKeymapAction::Operator(VimOperatorAction::MotionTillForward),
        ),
        (
            "vim_operator",
            "motion_till_backward",
            KeymapContext::VimOperator,
            VimKeymapAction::Operator(VimOperatorAction::MotionTillBackward),
        ),
        (
            "vim_operator",
            "motion_jump_top",
            KeymapContext::VimOperator,
            VimKeymapAction::Operator(VimOperatorAction::MotionJumpTop),
        ),
        (
            "vim_operator",
            "motion_jump_bottom",
            KeymapContext::VimOperator,
            VimKeymapAction::Operator(VimOperatorAction::MotionJumpBottom),
        ),
        (
            "vim_operator",
            "select_inner_text_object",
            KeymapContext::VimOperator,
            VimKeymapAction::Operator(VimOperatorAction::SelectInnerTextObject),
        ),
        (
            "vim_operator",
            "select_around_text_object",
            KeymapContext::VimOperator,
            VimKeymapAction::Operator(VimOperatorAction::SelectAroundTextObject),
        ),
        (
            "vim_operator",
            "cancel",
            KeymapContext::VimOperator,
            VimKeymapAction::Operator(VimOperatorAction::Cancel),
        ),
        (
            "vim_text_object",
            "word",
            KeymapContext::VimTextObject,
            VimKeymapAction::TextObject(VimTextObjectAction::Word),
        ),
        (
            "vim_text_object",
            "big_word",
            KeymapContext::VimTextObject,
            VimKeymapAction::TextObject(VimTextObjectAction::BigWord),
        ),
        (
            "vim_text_object",
            "parentheses",
            KeymapContext::VimTextObject,
            VimKeymapAction::TextObject(VimTextObjectAction::Parentheses),
        ),
        (
            "vim_text_object",
            "brackets",
            KeymapContext::VimTextObject,
            VimKeymapAction::TextObject(VimTextObjectAction::Brackets),
        ),
        (
            "vim_text_object",
            "braces",
            KeymapContext::VimTextObject,
            VimKeymapAction::TextObject(VimTextObjectAction::Braces),
        ),
        (
            "vim_text_object",
            "double_quote",
            KeymapContext::VimTextObject,
            VimKeymapAction::TextObject(VimTextObjectAction::DoubleQuote),
        ),
        (
            "vim_text_object",
            "single_quote",
            KeymapContext::VimTextObject,
            VimKeymapAction::TextObject(VimTextObjectAction::SingleQuote),
        ),
        (
            "vim_text_object",
            "backtick",
            KeymapContext::VimTextObject,
            VimKeymapAction::TextObject(VimTextObjectAction::Backtick),
        ),
        (
            "vim_text_object",
            "cancel",
            KeymapContext::VimTextObject,
            VimKeymapAction::TextObject(VimTextObjectAction::Cancel),
        ),
        (
            "vim_search",
            "forward",
            KeymapContext::VimNormal,
            VimKeymapAction::Search(VimSearchAction::Forward),
        ),
        (
            "vim_search",
            "backward",
            KeymapContext::VimNormal,
            VimKeymapAction::Search(VimSearchAction::Backward),
        ),
        (
            "vim_search",
            "next",
            KeymapContext::VimNormal,
            VimKeymapAction::Search(VimSearchAction::Next),
        ),
        (
            "vim_search",
            "previous",
            KeymapContext::VimNormal,
            VimKeymapAction::Search(VimSearchAction::Previous),
        ),
    ];
    for (context, action, focused, expected) in cases {
        let config =
            serde_json::from_value(json!({(context): {(action): ["f9", "ctrl-q z"]}})).unwrap();
        let keymap = RuntimeKeymap::from_config(&config).unwrap();
        let mut matcher = KeyChordMatcher::default();
        assert_eq!(
            dispatch(
                &keymap,
                focused,
                &mut matcher,
                KeyEvent::new(KeyCode::F(9), KeyModifiers::NONE)
            ),
            KeymapMatch::Completed(expected),
            "{context}.{action}"
        );
        assert_eq!(
            dispatch(
                &keymap,
                focused,
                &mut matcher,
                KeyEvent::new(KeyCode::Char('q'), KeyModifiers::CONTROL)
            ),
            KeymapMatch::Pending,
            "{context}.{action} prefix"
        );
        assert_eq!(
            dispatch(
                &keymap,
                focused,
                &mut matcher,
                KeyEvent::new(KeyCode::Char('z'), KeyModifiers::NONE)
            ),
            KeymapMatch::Completed(expected),
            "{context}.{action} completion"
        );
    }
}

#[test]
fn printable_chords_are_modal_only_and_default_gg_yields_to_explicit_bindings() {
    let config =
        serde_json::from_value(json!({"vim_normal": {"jump_bottom": "z z", "enter_insert": "g"}}))
            .unwrap();
    let keymap = RuntimeKeymap::from_config(&config).unwrap();
    let mut matcher = KeyChordMatcher::default();
    assert_eq!(
        dispatch(
            &keymap,
            KeymapContext::VimNormal,
            &mut matcher,
            KeyEvent::new(KeyCode::Char('g'), KeyModifiers::NONE)
        ),
        KeymapMatch::Completed(VimKeymapAction::Normal(VimNormalAction::EnterInsert))
    );
    assert_eq!(
        dispatch(
            &keymap,
            KeymapContext::VimNormal,
            &mut matcher,
            KeyEvent::new(KeyCode::Char('z'), KeyModifiers::NONE)
        ),
        KeymapMatch::Pending
    );
    assert_eq!(
        dispatch(
            &keymap,
            KeymapContext::VimNormal,
            &mut matcher,
            KeyEvent::new(KeyCode::Char('z'), KeyModifiers::NONE)
        ),
        KeymapMatch::Completed(VimKeymapAction::Normal(VimNormalAction::JumpBottom))
    );
    let config = serde_json::from_value(json!({"editor": {"move_left": "z z"}})).unwrap();
    assert!(RuntimeKeymap::from_config(&config)
        .unwrap_err()
        .contains("ordinary text"));
}

#[test]
fn explicit_conflicts_reserved_keys_and_search_shadowing_fail_closed() {
    for config in [
        json!({"vim_normal": {"move_left": "f9", "move_right": "f9"}}),
        json!({"vim_operator": {"motion_word_forward": "ctrl-q", "cancel": "ctrl-q x"}}),
        json!({"vim_normal": {"move_left": "f9"}, "vim_search": {"forward": "f9"}}),
        json!({"global": {"open_agents": "f9"}, "vim_text_object": {"word": "f9"}}),
        json!({"vim_normal": {"enter_insert": "enter"}}),
        json!({"vim_search": {"forward": "ctrl-c"}}),
    ] {
        let config = serde_json::from_value(config).unwrap();
        assert!(RuntimeKeymap::from_config(&config).is_err(), "{config:?}");
    }
}

#[test]
fn uppercase_keys_match_terminals_with_or_without_shift_reporting() {
    let keymap = RuntimeKeymap::default();
    for (code, modifiers) in [
        (KeyCode::Char('A'), KeyModifiers::NONE),
        (KeyCode::Char('a'), KeyModifiers::SHIFT),
        (KeyCode::Char('A'), KeyModifiers::SHIFT),
    ] {
        assert_eq!(
            dispatch(
                &keymap,
                KeymapContext::VimNormal,
                &mut KeyChordMatcher::default(),
                KeyEvent::new(code, modifiers)
            ),
            KeymapMatch::Completed(VimKeymapAction::Normal(VimNormalAction::AppendLineEnd))
        );
    }
}
