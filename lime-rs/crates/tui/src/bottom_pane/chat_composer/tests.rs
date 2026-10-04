use super::*;

fn current_at_token_range(text: &str, cursor: usize) -> Option<(Range<usize>, String)> {
    let mut textarea = TextArea::new();
    textarea.insert_str(text);
    textarea.set_cursor(cursor);
    completion_target::current_prefixed_token_range(&textarea, '@', false)
}

fn current_dollar_token_range(text: &str, cursor: usize) -> Option<(Range<usize>, String)> {
    let mut textarea = TextArea::new();
    textarea.insert_str(text);
    textarea.set_cursor(cursor);
    completion_target::current_prefixed_token_range(&textarea, '$', true)
}

fn key(code: KeyCode) -> KeyEvent {
    KeyEvent::new(code, KeyModifiers::NONE)
}

#[test]
fn cursor_and_backspace_respect_extended_graphemes() {
    let mut composer = ChatComposer::default();
    composer.insert("a👩🏽‍💻界");

    composer.handle_key_event(key(KeyCode::Left));
    composer.handle_key_event(key(KeyCode::Backspace));

    assert_eq!(composer.text(), "a界");
    assert_eq!(composer.cursor(), 1);
}

#[test]
fn paste_inserts_at_a_unicode_boundary() {
    let mut composer = ChatComposer::default();
    composer.insert("你好");
    composer.handle_key_event(key(KeyCode::Left));
    composer.insert("\nworld");

    assert_eq!(composer.text(), "你\nworld好");
}

#[test]
fn slash_popup_tracks_cursor_inside_command_with_argument_suffix() {
    let mut composer = ChatComposer::default();
    composer.insert("/effort value");
    assert!(composer.command_popup().is_none());

    composer.draft.textarea.set_cursor("/ef".len());
    composer.sync_completion_popup();
    assert_eq!(
        composer.command_popup().and_then(CommandPopup::selected),
        Some(crate::slash_command::SlashCommand::Effort)
    );

    composer.draft.textarea.set_cursor("/effort value".len());
    composer.sync_completion_popup();
    assert!(composer.command_popup().is_none());
}

#[test]
fn slash_popup_escape_dismissal_is_scoped_to_cursor_filter() {
    let mut composer = ChatComposer::default();
    composer.insert("/effort value");
    composer.draft.textarea.set_cursor("/ef".len());
    composer.sync_completion_popup();
    assert!(composer.command_popup().is_some());

    assert_eq!(
        composer.handle_command_popup_event(&crossterm::event::Event::Key(key(KeyCode::Esc))),
        CommandPopupAction::Cancel
    );
    assert!(composer.command_popup().is_none());
    composer.sync_completion_popup();
    assert!(composer.command_popup().is_none());

    composer.draft.textarea.set_cursor("/eff".len());
    composer.sync_completion_popup();
    assert!(composer.command_popup().is_some());
}

#[test]
fn history_navigation_does_not_replace_an_arbitrary_draft() {
    let mut composer = ChatComposer::default();
    composer.insert("first");
    assert!(matches!(
        composer.handle_key_event(key(KeyCode::Enter)),
        InputResult::Submitted { .. }
    ));
    composer.insert("draft");

    composer.handle_key_event(key(KeyCode::Up));
    assert_eq!(composer.text(), "draft");
    composer.handle_key_event(key(KeyCode::Down));
    assert_eq!(composer.text(), "draft");
}

#[test]
fn history_navigation_clears_completion_popups_for_recalled_text() {
    let mut composer = ChatComposer::default();
    composer.set_cached_history(["/model".to_string()]);

    composer.handle_key_event(key(KeyCode::Up));
    composer.sync_completion_popup();

    assert_eq!(composer.text(), "/model");
    assert!(!composer.completion_popup_active());
}

#[test]
fn attachment_edit_exits_history_navigation() {
    let mut composer = ChatComposer::default();
    composer.set_cached_history(["recalled prompt".to_string()]);
    composer.handle_key_event(key(KeyCode::Up));
    composer.attach_image(std::path::PathBuf::from("/tmp/recalled.png"));

    composer.handle_key_event(key(KeyCode::Up));

    assert_eq!(composer.text(), "recalled prompt[Image #1]");
    assert_eq!(
        composer.local_image_paths(),
        &[std::path::PathBuf::from("/tmp/recalled.png")]
    );
}

#[test]
fn attachment_only_draft_does_not_enter_text_history() {
    let mut composer = ChatComposer::default();
    composer.set_cached_history(["older prompt".to_string()]);
    composer.attach_image(std::path::PathBuf::from("/tmp/only-image.png"));

    composer.handle_key_event(key(KeyCode::Up));

    assert_eq!(composer.text(), "[Image #1]");
    assert_eq!(
        composer.local_image_paths(),
        &[std::path::PathBuf::from("/tmp/only-image.png")]
    );
}

#[test]
fn taking_attachment_state_exits_history_navigation() {
    let mut composer = ChatComposer::default();
    composer.set_cached_history(["recalled prompt".to_string()]);
    composer.handle_key_event(key(KeyCode::Up));
    composer.attach_image(std::path::PathBuf::from("/tmp/recalled.png"));
    assert_eq!(
        composer
            .take_recent_submission_images_with_placeholders()
            .len(),
        1
    );

    composer.handle_key_event(key(KeyCode::Up));

    assert_eq!(composer.text(), "recalled prompt[Image #1]");
}

#[test]
fn disconnected_submit_keys_clear_history_recall_state() {
    let mut composer = ChatComposer::default();
    composer.set_cached_history(["older prompt".to_string(), "newer prompt".to_string()]);
    composer.handle_key_event(key(KeyCode::Up));
    composer.handle_key_event(key(KeyCode::Up));
    assert_eq!(composer.text(), "older prompt");

    composer.handle_disconnected_key(key(KeyCode::Enter));
    composer.handle_key_event(key(KeyCode::Up));

    assert_eq!(composer.text(), "older prompt");
}

#[test]
fn wrapped_single_line_vertical_navigation_stays_in_editor_until_visual_boundary() {
    let mut composer = ChatComposer::default();
    composer.set_cached_history(["older prompt".to_string()]);
    composer.insert("abcdefghij");
    composer.draft.textarea.set_cursor(6);

    // Seed the same wrap cache used by rendering so Up/Down can distinguish visual rows.
    assert!(composer.desired_height(/*width*/ 4) > 1);
    composer.handle_key_event(key(KeyCode::Up));

    assert_ne!(composer.text(), "older prompt");
    assert!(composer.cursor() < 6);
}

#[test]
fn history_search_cancel_restores_cursor_and_attachments() {
    let mut composer = ChatComposer::default();
    composer.insert("draft");
    composer.handle_key_event(key(KeyCode::Left));
    composer.attach_image(std::path::PathBuf::from("/tmp/draft.png"));
    let original = composer.snapshot_draft();
    composer.set_cached_history(["archived prompt".to_string()]);

    composer.handle_key_event(KeyEvent::new(KeyCode::Char('r'), KeyModifiers::CONTROL));
    for character in "archived".chars() {
        composer.handle_key_event(key(KeyCode::Char(character)));
    }
    assert_eq!(composer.text(), "archived prompt");
    assert!(!composer.has_pending_images());

    composer.handle_key_event(key(KeyCode::Esc));
    assert_eq!(composer.snapshot_draft(), original);
    assert_eq!(
        composer.local_image_paths(),
        &[std::path::PathBuf::from("/tmp/draft.png")]
    );
    assert_eq!(
        composer.footer_mode(),
        FooterMode::ComposerHasDraft,
        "restored draft remains the active composer footer mode"
    );
}

#[test]
fn ctrl_c_clears_plain_text_and_records_it_for_history_recall() {
    let mut composer = ChatComposer::default();
    composer.insert("draft");

    assert_eq!(composer.clear_for_ctrl_c(), Some("draft".to_string()));
    assert!(composer.is_empty());
    assert_eq!(
        composer.handle_key_event(key(KeyCode::Up)),
        InputResult::Changed
    );
    assert_eq!(composer.text(), "draft");
}

#[test]
fn ctrl_c_records_and_restores_attachment_bearing_drafts() {
    let mut composer = ChatComposer::default();
    composer.insert("draft");
    composer.attach_image(std::path::PathBuf::from("/tmp/draft.png"));

    let original = composer.snapshot_history_entry();
    assert_eq!(composer.clear_for_ctrl_c(), Some("draft[Image #1]".into()));
    assert!(composer.is_empty());
    assert!(!composer.has_pending_images());
    composer.handle_key_event(key(KeyCode::Up));
    assert_eq!(composer.text(), "draft[Image #1]");
    assert!(composer.has_pending_images());
    assert_eq!(composer.snapshot_history_entry(), original);
}

#[test]
fn modified_enter_adds_a_newline_and_plain_enter_submits() {
    let mut composer = ChatComposer::default();
    composer.insert("first");
    composer.handle_key_event(KeyEvent::new(KeyCode::Enter, KeyModifiers::SHIFT));
    composer.insert("second");

    assert_eq!(composer.text(), "first\nsecond");
    assert_eq!(
        composer.handle_key_event(key(KeyCode::Enter)),
        InputResult::Submitted {
            text: "first\nsecond".to_string(),
            text_elements: Vec::new()
        }
    );
}

#[test]
fn editor_word_and_kill_shortcuts_share_textarea_semantics() {
    let mut composer = ChatComposer::default();
    composer.insert("alpha beta");

    composer.handle_key_event(KeyEvent::new(KeyCode::Char('w'), KeyModifiers::CONTROL));
    assert_eq!(composer.text(), "alpha ");

    composer.handle_key_event(KeyEvent::new(KeyCode::Char('y'), KeyModifiers::CONTROL));
    assert_eq!(composer.text(), "alpha beta");

    composer.handle_key_event(KeyEvent::new(KeyCode::Char('b'), KeyModifiers::CONTROL));
    composer.handle_key_event(KeyEvent::new(KeyCode::Char('k'), KeyModifiers::CONTROL));
    assert_eq!(composer.text(), "alpha bet");
}

#[test]
fn codex_control_newline_and_multiline_navigation_stay_in_composer_editor() {
    let mut composer = ChatComposer::default();
    composer.insert("ab\ncdef");
    composer.draft.textarea.set_cursor(2);

    assert_eq!(
        composer.handle_key_event(KeyEvent::new(KeyCode::Char('m'), KeyModifiers::CONTROL,)),
        InputResult::Changed
    );
    assert_eq!(composer.text(), "ab\n\ncdef");

    composer.replace("ab\ncdef".to_string());
    composer.draft.textarea.set_cursor(2);
    assert_eq!(
        composer.handle_key_event(KeyEvent::new(KeyCode::Char('n'), KeyModifiers::CONTROL,)),
        InputResult::Changed
    );
    assert_eq!(composer.cursor(), 5);
    assert_eq!(
        composer.handle_key_event(KeyEvent::new(KeyCode::Char('p'), KeyModifiers::CONTROL,)),
        InputResult::Changed
    );
    assert_eq!(composer.cursor(), 2);
}

#[test]
fn key_release_does_not_insert_or_submit() {
    let mut composer = ChatComposer::default();
    let mut release = key(KeyCode::Char('x'));
    release.kind = KeyEventKind::Release;

    assert_eq!(composer.handle_key_event(release), InputResult::None);
    assert!(composer.is_empty());

    composer.insert("draft");
    let mut submit_release = key(KeyCode::Enter);
    submit_release.kind = KeyEventKind::Release;
    assert_eq!(composer.handle_key_event(submit_release), InputResult::None);
    assert_eq!(composer.text(), "draft");
}

#[test]
fn tab_queues_non_empty_draft_and_clears_composer() {
    let mut composer = ChatComposer::default();
    composer.insert("follow up");

    assert_eq!(
        composer.handle_key_event(key(KeyCode::Tab)),
        InputResult::Queued {
            text: "follow up".to_string(),
            text_elements: Vec::new()
        }
    );
    assert!(composer.is_empty());
}

#[test]
fn cached_history_has_no_recent_entry_truncation() {
    let mut composer = ChatComposer::default();
    composer.set_cached_history((0..205).map(|index| format!("prompt-{index}")));

    composer.handle_key_event(key(KeyCode::Up));
    assert_eq!(composer.text(), "prompt-204");
    for _ in 0..204 {
        composer.handle_key_event(key(KeyCode::Up));
    }
    assert_eq!(composer.text(), "prompt-0");
}

#[test]
fn ctrl_r_searches_history_without_replacing_the_saved_draft() {
    let mut composer = ChatComposer::default();
    composer.set_cached_history([
        "git status".to_string(),
        "cargo test".to_string(),
        "git diff".to_string(),
    ]);
    composer.insert("draft");

    assert_eq!(
        composer.handle_key_event(KeyEvent::new(KeyCode::Char('r'), KeyModifiers::CONTROL)),
        InputResult::Changed
    );
    assert_eq!(composer.text(), "draft");
    assert_eq!(composer.history_search_query(), Some(""));
    composer.handle_key_event(key(KeyCode::Char('g')));
    composer.handle_key_event(key(KeyCode::Char('i')));
    composer.handle_key_event(key(KeyCode::Char('t')));
    assert_eq!(composer.text(), "git diff");
    assert_eq!(composer.history_search_query(), Some("git"));
    composer.handle_key_event(KeyEvent::new(KeyCode::Char('r'), KeyModifiers::CONTROL));
    assert_eq!(composer.text(), "git status");
    composer.handle_key_event(KeyEvent::new(KeyCode::Char('s'), KeyModifiers::CONTROL));
    assert_eq!(composer.text(), "git diff");
    composer.handle_key_event(key(KeyCode::Esc));
    assert_eq!(composer.text(), "draft");
    assert!(!composer.history_search_active());
}

#[test]
fn ctrl_r_search_accepts_a_match_with_enter() {
    let mut composer = ChatComposer::default();
    composer.set_cached_history(["first prompt".to_string()]);
    composer.handle_key_event(KeyEvent::new(KeyCode::Char('r'), KeyModifiers::CONTROL));
    for character in "first".chars() {
        composer.handle_key_event(key(KeyCode::Char(character)));
    }

    assert_eq!(
        composer.handle_key_event(key(KeyCode::Enter)),
        InputResult::Changed
    );
    assert!(!composer.history_search_active());
    assert_eq!(composer.text(), "first prompt");

    composer.insert(" + follow-up");
    assert_eq!(
        composer.handle_key_event(key(KeyCode::Enter)),
        InputResult::Submitted {
            text: "first prompt + follow-up".to_string(),
            text_elements: Vec::new()
        }
    );
}

#[test]
fn history_search_is_case_insensitive_and_restores_on_no_match() {
    let mut composer = ChatComposer::default();
    composer.set_cached_history(["Deploy Lime".to_string()]);
    composer.insert("draft");
    composer.handle_key_event(KeyEvent::new(KeyCode::Char('r'), KeyModifiers::CONTROL));
    for character in "DEP".chars() {
        composer.handle_key_event(key(KeyCode::Char(character)));
    }
    assert_eq!(composer.text(), "Deploy Lime");
    composer.handle_key_event(key(KeyCode::Char('x')));
    assert_eq!(composer.text(), "draft");
    assert_eq!(composer.history_search_query(), Some("DEPx"));
}

#[test]
fn history_search_no_match_enter_keeps_search_open_for_query_edits() {
    let mut composer = ChatComposer::default();
    composer.set_cached_history(["deploy".to_string()]);
    composer.insert("draft");
    composer.handle_key_event(KeyEvent::new(KeyCode::Char('r'), KeyModifiers::CONTROL));
    for character in "zzz".chars() {
        composer.handle_key_event(key(KeyCode::Char(character)));
    }

    assert_eq!(composer.text(), "draft");
    assert_eq!(
        composer.handle_key_event(key(KeyCode::Enter)),
        InputResult::Changed
    );
    assert!(composer.history_search_active());
    assert_eq!(composer.history_search_query(), Some("zzz"));

    for _ in 0..3 {
        composer.handle_key_event(key(KeyCode::Backspace));
    }
    composer.handle_key_event(key(KeyCode::Char('d')));
    assert_eq!(composer.text(), "deploy");
    assert_eq!(composer.history_search_query(), Some("d"));
}

#[test]
fn history_search_highlights_preview_until_enter_accepts_it() {
    let mut composer = ChatComposer::default();
    composer.set_cached_history(["Deploy Lime".to_string()]);
    composer.handle_key_event(KeyEvent::new(KeyCode::Char('r'), KeyModifiers::CONTROL));
    for character in "dep".chars() {
        composer.handle_key_event(key(KeyCode::Char(character)));
    }

    assert_eq!(composer.text(), "Deploy Lime");
    assert_eq!(composer.history_search_highlight_ranges(), vec![0..3]);

    composer.handle_key_event(key(KeyCode::Enter));
    assert!(composer.history_search_highlight_ranges().is_empty());
}

#[test]
fn at_token_range_tracks_cursor_boundaries_without_crossing_whitespace() {
    let text = "@file\tplain\n@next";
    let token_end = "@file".len();
    let next_start = text.find("@next").expect("second token");

    for cursor in [0, 2, token_end] {
        assert_eq!(
            current_at_token_range(text, cursor),
            Some(0..token_end).map(|range| (range, "file".to_string()))
        );
    }
    assert_eq!(current_at_token_range(text, token_end + 1), None);
    assert_eq!(
        current_at_token_range(text, next_start),
        Some(next_start..text.len()).map(|range| (range, "next".to_string()))
    );
}

#[test]
fn at_token_range_rejects_embedded_prefix_and_keeps_repeated_prefixes_in_one_token() {
    assert_eq!(current_at_token_range("foo@bar", "foo@bar".len()), None);
    assert_eq!(
        current_at_token_range("@foo@bar", "@foo@bar".len()),
        Some(0..8).map(|range| (range, "foo@bar".to_string()))
    );
}

#[test]
fn at_token_range_uses_utf8_safe_byte_ranges() {
    let text = "前 @界🙂 后";
    let start = text.find('@').expect("mention prefix");
    let end = text.find(" 后").expect("trailing separator");
    let expected = Some(start..end).map(|range| (range, "界🙂".to_string()));

    assert_eq!(current_at_token_range(text, start), expected);
    assert_eq!(current_at_token_range(text, start + 2), expected);
    assert_eq!(current_at_token_range(text, end), expected);
    assert_eq!(current_at_token_range(text, start + 3), expected);
}

#[test]
fn file_popup_dismissal_does_not_hide_an_identical_later_token() {
    let mut composer = ChatComposer::default();
    composer.insert("@same  @same");

    let first_end = "@same".len();
    composer.draft.textarea.set_cursor(first_end);
    composer.sync_completion_popup();
    assert!(composer.file_search_popup_active());
    composer.handle_file_search_popup_event(&crossterm::event::Event::Key(key(KeyCode::Esc)));
    assert!(!composer.file_search_popup_active());

    composer.draft.textarea.set_cursor("@same  @same".len());
    composer.sync_completion_popup();
    assert!(composer.file_search_popup_active());
}

pub(super) fn test_skill(name: &str) -> SkillMetadata {
    SkillMetadata {
        name: name.to_string(),
        description: format!("{name} skill"),
        short_description: None,
        interface: None,
        dependencies: None,
        path: std::path::PathBuf::from(format!("/skills/{name}/SKILL.md")),
        scope: app_server_protocol::protocol::v2::SkillScope::User,
        enabled: true,
    }
}

#[test]
fn skill_popup_filters_and_completes_the_active_dollar_token() {
    let mut composer = ChatComposer::default();
    composer.set_skills(vec![test_skill("deploy"), test_skill("code-review")]);
    composer.insert("please $cr");
    assert!(composer.skill_popup_active());
    composer.handle_skill_popup_event(&crossterm::event::Event::Key(key(KeyCode::Enter)));
    assert_eq!(composer.text(), "please $code-review ");
    assert!(!composer.skill_popup_active());
}

#[test]
fn skill_popup_escape_is_scoped_to_the_current_token_occurrence() {
    let mut composer = ChatComposer::default();
    composer.set_skills(vec![test_skill("same")]);
    composer.insert("$same  $same");
    composer.draft.textarea.set_cursor("$same".len());
    composer.sync_completion_popup();
    assert!(composer.skill_popup_active());
    composer.handle_skill_popup_event(&crossterm::event::Event::Key(key(KeyCode::Esc)));
    composer.draft.textarea.set_cursor("$same  $same".len());
    composer.sync_completion_popup();
    assert!(composer.skill_popup_active());
}

#[test]
fn dollar_token_range_is_utf8_safe_and_rejects_embedded_prefixes() {
    let text = "前 $审查-1 后";
    let start = text.find('$').expect("dollar");
    let end = text.find(" 后").expect("suffix");
    assert_eq!(
        current_dollar_token_range(text, start + 1),
        Some((start..end, "审查-1".to_string()))
    );
    assert_eq!(current_dollar_token_range("foo$deploy", 10), None);
}

#[test]
fn shell_parameters_do_not_open_skill_popup_without_an_exact_skill() {
    let mut composer = ChatComposer::default();
    composer.set_skills(vec![test_skill("deploy")]);
    composer.insert("$HOME");
    assert!(!composer.skill_popup_active());
    composer.replace("$1".to_string());
    assert!(!composer.skill_popup_active());
}

#[test]
fn paste_burst_treats_tab_and_enter_as_draft_text() {
    let mut composer = ChatComposer::default();
    let start = Instant::now();

    assert_eq!(
        composer.handle_key_event_at(key(KeyCode::Char('a')), start),
        InputResult::None
    );
    assert_eq!(
        composer.handle_key_event_at(
            key(KeyCode::Char('b')),
            start + std::time::Duration::from_millis(1),
        ),
        InputResult::Changed
    );
    assert_eq!(
        composer.handle_key_event_at(
            key(KeyCode::Tab),
            start + std::time::Duration::from_millis(2),
        ),
        InputResult::Changed
    );
    assert_eq!(
        composer.handle_key_event_at(
            key(KeyCode::Enter),
            start + std::time::Duration::from_millis(3),
        ),
        InputResult::Changed
    );

    composer.handle_paste_burst_flush(start + std::time::Duration::from_millis(20));
    assert_eq!(composer.text(), "ab\t\n");
}

#[test]
fn explicit_paste_preserves_a_pending_typed_prefix() {
    let mut composer = ChatComposer::default();
    let start = Instant::now();
    assert_eq!(
        composer.handle_key_event_at(key(KeyCode::Char('x')), start),
        InputResult::None
    );

    composer.handle_paste("pasted");

    assert_eq!(composer.text(), "xpasted");
    assert!(!composer.paste_burst_needs_frame());
}

#[test]
fn multiline_paste_continues_markdown_blockquote_and_leaves_next_block() {
    let mut composer = ChatComposer::default();
    composer.insert("> first\n> ");

    composer.handle_paste("second\n\nthird\n");

    assert_eq!(composer.text(), "> first\n> second\n> \n> third\n> \n\n");
}

#[test]
fn multiline_paste_is_literal_outside_a_markdown_blockquote() {
    let mut composer = ChatComposer::default();
    composer.insert("plain");

    composer.handle_paste("one\n\ntwo");

    assert_eq!(composer.text(), "plainone\n\ntwo");
}
