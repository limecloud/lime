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

    /// 判断 Left 是否应离开空 composer 并打开 Agents Overview。
    ///
    /// 普通文本、附件、popup、历史搜索和 Vim operator pending 都留在各自
    /// 的 composer owner 内处理；默认关闭保证 remote session fail-closed。
    pub(crate) fn agents_navigation_available(&self) -> bool {
        self.agents_navigation_enabled
            && self.is_empty()
            && !self.popups.active()
            && self.history_search.is_none()
            && !self.vim_search_active()
            && !self.draft.textarea.is_vim_operator_pending()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};

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
}
