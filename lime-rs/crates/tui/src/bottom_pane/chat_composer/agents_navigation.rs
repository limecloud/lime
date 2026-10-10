//! 空草稿下的 Agents Overview 导航。
//!
//! 该 owner 只负责判断 composer 是否可以把 Left 交给 Agents Overview；
//! Overview 的生命周期和 App Server 刷新仍由 `App`/`AgentsOverviewState` 承担。

use super::ChatComposer;

impl ChatComposer {
    /// 仅在本地 stdio 会话显式启用空草稿导航。
    pub(crate) fn set_agents_navigation_enabled(&mut self, enabled: bool) {
        self.agents_navigation_enabled = enabled;
    }

    pub(crate) fn agents_navigation_key_available(&self) -> bool {
        use crate::keymap::{EditorAction, VimKeymapAction, VimNormalAction};
        use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
        let left = KeyEvent::new(KeyCode::Left, KeyModifiers::NONE);
        if self.is_vim_normal_mode() {
            self.draft.textarea.vim_action_for_key(left)
                == Some(VimKeymapAction::Normal(VimNormalAction::MoveLeft))
        } else {
            self.draft.textarea.editor_action_for_key(left) == Some(EditorAction::MoveLeft)
        }
    }

    /// 判断 Left 是否应离开空 composer 并打开 Agents Overview。
    ///
    /// 普通文本、附件、popup、历史搜索和 Vim operator pending 都留在各自
    /// 的 composer owner 内处理；默认关闭保证 remote session fail-closed。
    pub(crate) fn agents_navigation_available(&self) -> bool {
        self.agents_navigation_enabled
            && self.agents_navigation_key_available()
            && self.input_enabled()
            && self.is_empty()
            && !self.draft.paste_burst.is_active()
            && !self.popups.active()
            && self.history_search.is_none()
            && !self.vim_search_active()
            && !self.key_chord_pending()
            && !self.draft.textarea.is_vim_operator_pending()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crossterm::event::{KeyCode, KeyEvent, KeyEventKind, KeyModifiers};

    fn left() -> KeyEvent {
        KeyEvent::new(KeyCode::Left, KeyModifiers::NONE)
    }

    #[test]
    fn left_navigation_is_disabled_by_default_and_for_remote_sessions() {
        let mut composer = ChatComposer::default();
        assert!(!composer.agents_navigation_available());
        composer.set_agents_navigation_enabled(true);
        assert!(composer.agents_navigation_available());
        composer.set_agents_navigation_enabled(false);
        assert!(!composer.agents_navigation_available());
    }

    #[test]
    fn left_navigation_requires_an_empty_unblocked_composer() {
        let mut composer = ChatComposer::default();
        composer.set_agents_navigation_enabled(true);
        assert!(composer.agents_navigation_available());

        composer.insert("draft");
        assert!(!composer.agents_navigation_available());
        composer.clear_for_ctrl_c();
        composer.attach_image(std::path::PathBuf::from("/tmp/image.png"));
        assert!(!composer.agents_navigation_available());
    }

    #[test]
    fn left_navigation_does_not_steal_popup_or_vim_operator_input() {
        let mut composer = ChatComposer::default();
        composer.set_agents_navigation_enabled(true);
        composer.insert("/mo");
        composer.sync_completion_popup();
        assert!(!composer.agents_navigation_available());

        composer.clear_for_ctrl_c();
        composer.set_vim_enabled(true);
        composer.handle_key_event(KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE));
        composer.handle_key_event(KeyEvent::new(KeyCode::Char('d'), KeyModifiers::NONE));
        assert!(!composer.agents_navigation_available());
    }

    #[test]
    fn left_navigation_does_not_steal_active_vim_search() {
        let mut composer = ChatComposer::default();
        composer.set_agents_navigation_enabled(true);
        composer.set_vim_enabled(true);
        composer.insert("draft");

        composer.handle_key_event(KeyEvent::new(KeyCode::Char('/'), KeyModifiers::NONE));

        assert!(composer.vim_search_active());
        assert!(!composer.agents_navigation_available());
        assert_ne!(
            composer.handle_key_event(left()),
            super::super::InputResult::OpenAgentsOverview
        );
    }

    #[test]
    fn left_key_returns_open_agents_overview_only_when_available() {
        let mut composer = ChatComposer::default();
        composer.set_agents_navigation_enabled(true);
        assert_eq!(
            composer.handle_key_event(left()),
            super::super::InputResult::OpenAgentsOverview
        );

        composer.insert("x");
        assert_ne!(
            composer.handle_key_event(left()),
            super::super::InputResult::OpenAgentsOverview
        );
    }

    #[test]
    fn modified_left_stays_in_the_editor() {
        let mut composer = ChatComposer::default();
        composer.set_agents_navigation_enabled(true);
        let modified = KeyEvent::new(KeyCode::Left, KeyModifiers::ALT);
        assert_ne!(
            composer.handle_key_event(modified),
            super::super::InputResult::OpenAgentsOverview
        );
    }

    #[test]
    fn only_press_opens_overview_through_the_host_input_boundary() {
        use crate::app::{App, AppAction};
        use crate::tui::TuiEvent;
        for kind in [
            KeyEventKind::Repeat,
            KeyEventKind::Release,
            KeyEventKind::Press,
        ] {
            let mut app = App::default();
            app.chat_widget
                .bottom_pane
                .set_agents_navigation_enabled(true);
            let action = app.handle_tui_event(
                TuiEvent::Key(KeyEvent::new_with_kind(
                    KeyCode::Left,
                    KeyModifiers::NONE,
                    kind,
                )),
                true,
            );
            assert_eq!(
                action,
                if kind == KeyEventKind::Press {
                    AppAction::RefreshAgentsOverview
                } else {
                    AppAction::None
                },
                "kind={kind:?}"
            );
            assert_eq!(
                app.chat_widget.agents_overview.is_some(),
                kind == KeyEventKind::Press
            );
            assert!(app.chat_widget.bottom_pane.composer_is_empty());
        }
    }

    #[test]
    fn rebound_or_unbound_left_keeps_editor_ownership_and_hides_navigation_hint() {
        use crate::keymap::RuntimeKeymap;
        for value in [
            serde_json::json!({"editor": {"move_left": "f9"}}),
            serde_json::json!({"editor": {"move_left": []}}),
            serde_json::json!({"editor": {"move_left": [], "insert_newline": "left"}}),
        ] {
            let mut composer = ChatComposer::default();
            composer.set_agents_navigation_enabled(true);
            composer.set_keymap_bindings(
                &RuntimeKeymap::from_config(&serde_json::from_value(value.clone()).unwrap())
                    .unwrap(),
            );
            assert!(
                !composer.agents_navigation_key_available(),
                "bindings={value}"
            );
            assert!(!composer.agents_navigation_available(), "bindings={value}");
            assert_ne!(
                composer.handle_key_event(left()),
                super::super::InputResult::OpenAgentsOverview
            );
            assert_eq!(
                composer.text(),
                if value["editor"]["insert_newline"] == "left" {
                    "\n"
                } else {
                    ""
                }
            );
            composer.replace(String::new());
            composer.set_keymap_bindings(&RuntimeKeymap::default());
            assert!(composer.agents_navigation_available());
        }
    }

    #[test]
    fn vim_left_uses_modal_binding_and_press_only_navigation() {
        use crate::keymap::RuntimeKeymap;
        let mut composer = ChatComposer::default();
        composer.set_agents_navigation_enabled(true);
        composer.set_vim_enabled(true);
        assert!(composer.agents_navigation_available());
        assert_ne!(
            composer.handle_key_event(KeyEvent::new_with_kind(
                KeyCode::Left,
                KeyModifiers::NONE,
                KeyEventKind::Repeat
            )),
            super::super::InputResult::OpenAgentsOverview
        );
        composer.set_keymap_bindings(
            &RuntimeKeymap::from_config(
                &serde_json::from_value(serde_json::json!({
                    "vim_normal": {"move_left": [], "enter_insert": "left"}
                }))
                .unwrap(),
            )
            .unwrap(),
        );
        assert!(!composer.agents_navigation_key_available());
        assert_ne!(
            composer.handle_key_event(left()),
            super::super::InputResult::OpenAgentsOverview
        );
        assert!(!composer.is_vim_normal_mode());
        assert!(
            composer.agents_navigation_key_available(),
            "insert mode uses editor move_left"
        );
    }

    #[test]
    fn footer_drops_unbound_left_and_keeps_an_explicit_global_agents_binding() {
        use crate::app::App;
        use crate::keymap::RuntimeKeymap;
        let mut app = App::default();
        app.chat_widget
            .bottom_pane
            .set_agents_navigation_enabled(true);
        assert_eq!(
            app.chat_widget
                .footer_props(100, false, None, None)
                .agents_hint
                .as_deref(),
            Some("←")
        );
        for (value, expected) in [
            (serde_json::json!({"editor": {"move_left": []}}), None),
            (
                serde_json::json!({"editor": {"move_left": []}, "global": {"open_agents": "f10"}}),
                Some("f10"),
            ),
        ] {
            app.set_runtime_keymap(
                RuntimeKeymap::from_config(&serde_json::from_value(value).unwrap()).unwrap(),
            );
            assert_eq!(
                app.chat_widget
                    .footer_props(100, false, None, None)
                    .agents_hint
                    .as_deref(),
                expected
            );
        }
    }

    #[test]
    fn paste_burst_disabled_input_and_pending_editor_chord_block_navigation() {
        use crate::keymap::RuntimeKeymap;
        let mut composer = ChatComposer::default();
        composer.set_agents_navigation_enabled(true);
        composer.set_input_enabled(false, None);
        assert!(!composer.agents_navigation_available());
        assert_eq!(
            composer.handle_key_event(left()),
            super::super::InputResult::None
        );
        composer.set_input_enabled(true, None);
        let now = std::time::Instant::now();
        composer.draft.paste_burst.on_plain_char('a', now);
        assert!(!composer.agents_navigation_available());
        assert_ne!(
            composer.handle_key_event_at(left(), now),
            super::super::InputResult::OpenAgentsOverview
        );
        assert_eq!(composer.text(), "a");
        composer.clear_for_ctrl_c();
        composer.set_keymap_bindings(
            &RuntimeKeymap::from_config(
                &serde_json::from_value(serde_json::json!({
                    "editor": {"insert_newline": "ctrl-q left"}
                }))
                .unwrap(),
            )
            .unwrap(),
        );
        composer.handle_key_event(KeyEvent::new(KeyCode::Char('q'), KeyModifiers::CONTROL));
        assert!(!composer.agents_navigation_available());
        assert_ne!(
            composer.handle_key_event(left()),
            super::super::InputResult::OpenAgentsOverview
        );
        assert_eq!(composer.text(), "\n");
        assert!(!composer.key_chord_pending());
    }
}
