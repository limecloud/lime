//! Bottom-pane draft and host configuration boundary. The live editor stays private.

use super::*;
use crate::app_event_sender::AppEventSender;
use crate::clipboard_paste::ClipboardTextSource;
use crate::tui::TuiEvent;
use app_server_protocol::protocol::v2::{FuzzyFileSearchResult, SkillMetadata};

impl BottomPane {
    pub(crate) fn can_backtrack(&self) -> bool {
        !self.is_active() && self.composer.can_backtrack()
    }
    pub(crate) fn restore_user_inputs(
        &mut self,
        inputs: &[app_server_protocol::protocol::v2::UserInput],
    ) -> bool {
        let Some(entry) = super::chat_composer_history::HistoryEntry::from_user_inputs(inputs)
        else {
            return false;
        };
        self.composer
            .edit_stored_draft(|composer| composer.apply_history_entry(entry));
        self.composer.clear_completion_popup();
        true
    }

    pub(crate) fn can_restore_user_inputs(
        inputs: &[app_server_protocol::protocol::v2::UserInput],
    ) -> bool {
        super::chat_composer_history::HistoryEntry::from_user_inputs(inputs).is_some()
    }

    pub(crate) fn show_esc_backtrack_hint(&mut self, show: bool) {
        self.composer.show_esc_backtrack_hint(show);
    }
    pub(crate) fn composer_input_enabled(&self) -> bool {
        self.composer.input_enabled()
    }

    #[cfg(test)]
    pub(crate) fn set_composer_input_enabled(
        &mut self,
        enabled: bool,
        placeholder: Option<String>,
    ) {
        self.composer.set_input_enabled(enabled, placeholder);
    }

    pub(crate) fn composer_text(&self) -> &str {
        self.composer.text()
    }

    pub(crate) fn composer_is_empty(&self) -> bool {
        self.composer.is_empty()
    }

    pub(crate) fn composer_text_with_pending(&self) -> String {
        self.composer.current_text_with_pending()
    }

    #[cfg(test)]
    pub(crate) fn insert_str(&mut self, value: &str) {
        self.composer.insert(value)
    }

    pub(crate) fn set_composer_text(&mut self, text: String) {
        self.composer.replace(text)
    }

    /// Restore canonical input, including mention targets, without replacing a search preview.
    pub(crate) fn set_composer_text_with_mention_bindings(
        &mut self,
        text: String,
        text_elements: Vec<agent_protocol::TextElement>,
        images: Vec<LocalImageAttachment>,
        remote_images: Vec<RemoteImageAttachment>,
        mention_bindings: Vec<MentionBinding>,
    ) {
        self.composer.edit_stored_draft(|composer| {
            composer.set_text_content_with_mention_bindings(
                text,
                text_elements,
                images,
                remote_images,
                mention_bindings,
            );
        });
        self.composer.clear_completion_popup();
    }

    #[cfg(test)]
    pub(crate) fn composer_local_images(&self) -> Vec<crate::bottom_pane::LocalImageAttachment> {
        self.composer.local_images()
    }

    #[cfg(test)]
    pub(crate) fn composer_remote_images(&self) -> &[crate::bottom_pane::RemoteImageAttachment] {
        self.composer.remote_images()
    }

    #[cfg(test)]
    pub(crate) fn composer_has_pending_images(&self) -> bool {
        self.composer.has_pending_images()
    }

    #[cfg(test)]
    pub(crate) fn composer_has_selected_remote_image(&self) -> bool {
        self.composer.has_selected_remote_image()
    }

    pub(crate) fn command_from_prompt(
        &self,
        prompt: &str,
    ) -> Option<crate::slash_command::SlashCommand> {
        self.composer.command_from_prompt(prompt)
    }

    pub(crate) fn set_locale(&mut self, locale: crate::locale::Locale) {
        self.composer.set_locale(locale)
    }

    pub(crate) fn set_app_event_tx(&mut self, app_event_tx: AppEventSender) {
        self.composer.set_app_event_tx(app_event_tx)
    }

    pub(crate) fn set_agents_navigation_enabled(&mut self, enabled: bool) {
        self.composer.set_agents_navigation_enabled(enabled)
    }

    pub(crate) fn set_skills(&mut self, skills: Vec<SkillMetadata>) {
        self.composer.set_skills(skills)
    }

    pub(crate) fn skills(&self) -> &[SkillMetadata] {
        self.composer.skills()
    }

    pub(crate) fn on_file_search_result(
        &mut self,
        generation: u64,
        query: &str,
        matches: Vec<FuzzyFileSearchResult>,
    ) {
        self.composer
            .on_file_search_result(generation, query, matches)
    }

    pub(crate) fn take_file_search_request(&mut self) -> Option<FileSearchRequest> {
        self.composer.take_file_search_request()
    }

    pub(crate) fn on_history_lookup_response(
        &mut self,
        thread_id: &str,
        response: crate::app_event::HistoryLookupResponse,
    ) -> bool {
        self.composer
            .on_history_lookup_response(thread_id, response)
    }

    pub(crate) fn set_history_metadata(
        &mut self,
        thread_id: String,
        log_id: String,
        entry_count: usize,
    ) {
        self.composer
            .set_history_metadata(thread_id, log_id, entry_count)
    }

    pub(crate) fn set_history_thread_id(&mut self, thread_id: &str) {
        self.composer.set_history_thread_id(thread_id)
    }

    pub(crate) fn replace_replayed_history(
        &mut self,
        thread_id: String,
        turns: &[app_server_protocol::protocol::v2::Turn],
    ) {
        self.composer.replace_replayed_history(thread_id, turns)
    }

    pub(crate) fn record_replayed_history_page(
        &mut self,
        items: &[app_server_protocol::protocol::v2::ThreadItem],
        turns: &[app_server_protocol::protocol::v2::Turn],
        prepend: bool,
    ) {
        self.composer
            .record_replayed_history_page(items, turns, prepend)
    }

    pub(crate) fn attach_image(&mut self, path: std::path::PathBuf) {
        self.composer.attach_image(path)
    }

    pub(crate) fn take_recent_submission_images_with_placeholders(
        &mut self,
    ) -> Vec<crate::bottom_pane::LocalImageAttachment> {
        self.composer
            .take_recent_submission_images_with_placeholders()
    }

    pub(crate) fn take_remote_images(&mut self) -> Vec<crate::bottom_pane::RemoteImageAttachment> {
        self.composer.take_remote_images()
    }

    pub(crate) fn take_recent_submission_mention_bindings(&mut self) -> Vec<MentionBinding> {
        self.composer.take_recent_submission_mention_bindings()
    }

    pub(crate) fn apply_external_edit(&mut self, text: String) {
        self.composer.apply_external_edit(text)
    }

    pub(crate) fn toggle_vim_enabled(&mut self) -> bool {
        self.composer.toggle_vim_enabled()
    }

    pub(crate) fn history_search_active(&self) -> bool {
        self.composer.history_search_active()
    }

    pub(crate) fn vim_search_active(&self) -> bool {
        self.composer.vim_search_active()
    }

    pub(crate) fn footer_mode(&self) -> super::FooterMode {
        self.composer.footer_mode()
    }

    pub(crate) fn agents_navigation_available(&self) -> bool {
        self.composer.agents_navigation_available()
    }

    pub(crate) fn completion_popup_active(&self) -> bool {
        self.composer.completion_popup_active()
    }

    pub(crate) fn file_search_popup_active(&self) -> bool {
        self.composer.file_search_popup_active()
    }

    pub(crate) fn skill_popup_active(&self) -> bool {
        self.composer.skill_popup_active()
    }

    pub(crate) fn vim_mode_indicator_span(&self) -> Option<ratatui::text::Span<'static>> {
        self.composer.vim_mode_indicator_span()
    }

    pub(crate) fn history_search_footer_line(&self) -> Option<ratatui::text::Line<'static>> {
        self.composer.history_search_footer_line()
    }

    pub(crate) fn history_search_cursor_column(&self, label: &str) -> Option<u16> {
        self.composer.history_search_cursor_column(label)
    }

    pub(crate) fn vim_search_query(&self) -> Option<(&str, crate::vim_search::SearchDirection)> {
        self.composer.vim_search_query()
    }

    #[cfg(test)]
    pub(crate) fn is_vim_normal_mode(&self) -> bool {
        self.composer.is_vim_normal_mode()
    }

    #[cfg(test)]
    pub(crate) fn key_chord_pending(&self) -> bool {
        self.composer.key_chord_pending()
    }

    pub(crate) fn copy_selection_request(&mut self, event: &TuiEvent) -> Option<(String, bool)> {
        self.composer.copy_selection_request(event)
    }

    pub(crate) fn clipboard_paste_request(&self, event: &TuiEvent) -> Option<ClipboardTextSource> {
        self.composer.clipboard_paste_request(event)
    }

    pub(crate) fn clipboard_paste_target(&self) -> Option<(String, usize)> {
        self.composer.clipboard_paste_target()
    }

    pub(crate) fn clear_mouse_selection(&mut self) {
        self.composer.clear_mouse_selection()
    }

    pub(crate) fn dismiss_shortcut_overlay(&mut self) -> bool {
        self.composer.dismiss_shortcut_overlay()
    }

    pub(crate) fn end_mouse_drag(&mut self) {
        self.composer.end_mouse_drag()
    }

    pub(crate) fn clear_completion_popup(&mut self) {
        self.composer.clear_completion_popup()
    }

    pub(crate) fn clear_composer_for_ctrl_c(&mut self) -> Option<String> {
        self.composer.clear_for_ctrl_c()
    }

    #[cfg(test)]
    pub(crate) fn composer_snapshot(&self) -> ComposerDraft {
        self.composer.snapshot_draft()
    }

    #[cfg(test)]
    pub(crate) fn composer_draft(&self) -> ComposerDraft {
        self.composer.draft_snapshot()
    }

    #[cfg(test)]
    pub(crate) fn composer_local_image_paths(&self) -> Vec<std::path::PathBuf> {
        self.composer.local_image_paths()
    }

    #[cfg(test)]
    pub(crate) fn composer_remote_image_urls(&self) -> Vec<String> {
        self.composer.remote_image_urls()
    }

    #[cfg(test)]
    pub(crate) fn set_remote_image_urls(&mut self, urls: Vec<String>) {
        self.composer.set_remote_image_urls(urls)
    }

    #[cfg(test)]
    pub(crate) fn take_remote_image_urls(&mut self) -> Vec<String> {
        self.composer.take_remote_image_urls()
    }

    #[cfg(test)]
    pub(crate) fn set_vim_enabled(&mut self, enabled: bool) {
        self.composer.set_vim_enabled(enabled)
    }

    #[cfg(test)]
    pub(crate) fn paste_burst_is_disabled(&self) -> bool {
        self.composer.paste_burst_is_disabled()
    }

    #[cfg(test)]
    pub(crate) fn set_paste_burst_disabled(&mut self, disabled: bool) {
        self.composer.set_paste_burst_disabled(disabled)
    }

    #[cfg(test)]
    pub(crate) fn command_popup_active(&self) -> bool {
        self.composer.command_popup().is_some()
    }

    #[cfg(test)]
    pub(crate) fn selected_command(&self) -> Option<crate::slash_command::SlashCommand> {
        self.composer
            .command_popup()
            .and_then(super::command_popup::CommandPopup::selected)
    }

    #[cfg(test)]
    pub(crate) fn composer_text_elements(&self) -> Vec<agent_protocol::TextElement> {
        self.composer.textarea().text_elements()
    }

    #[cfg(test)]
    pub(crate) fn render_composer_textarea(
        &self,
        area: ratatui::layout::Rect,
        buffer: &mut ratatui::buffer::Buffer,
    ) {
        use ratatui::widgets::StatefulWidgetRef;
        let mut state = self.composer.textarea_state_mut();
        StatefulWidgetRef::render_ref(&self.composer.textarea(), area, buffer, &mut *state);
    }

    #[cfg(test)]
    pub(crate) fn history_search_query(&self) -> Option<&str> {
        self.composer.history_search_query()
    }

    #[cfg(test)]
    pub(crate) fn set_cached_history<I>(&mut self, entries: I)
    where
        I: IntoIterator<Item = String>,
    {
        self.composer.set_cached_history(entries);
    }
}
