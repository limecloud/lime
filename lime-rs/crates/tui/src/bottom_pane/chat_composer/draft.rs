//! Draft and attachment edits retain one TextArea and one Vim edit boundary.

use super::*;

impl ChatComposer {
    /// A thread handoff creates a fresh edit lifetime, carrying only the session register.
    pub(crate) fn restore_thread_input_state(
        &mut self,
        draft: ComposerDraft,
        keymap: &crate::keymap::RuntimeKeymap,
    ) {
        let vim_enabled = self.draft.textarea.is_vim_enabled();
        let register: super::super::textarea::KillBufferSnapshot =
            self.draft.textarea.take_kill_buffer_snapshot();
        let mut textarea = TextArea::default();
        textarea.set_keymap_bindings(keymap);
        textarea.set_vim_enabled(vim_enabled);
        textarea.restore_kill_buffer_snapshot(register);
        self.draft = DraftState {
            textarea,
            disable_paste_burst: self.draft.disable_paste_burst,
            ..DraftState::default()
        };
        self.history_search = None;
        self.vim_history = VimHistory::default();
        self.reset_history_navigation();
        self.popups.clear();
        self.popups.dismissed_command_token = None;
        self.popups.dismissed_file_token = None;
        self.popups.dismissed_skill_token = None;
        self.footer = FooterState::default();
        self.restore_draft(draft);
    }

    pub(crate) fn snapshot_draft(&self) -> ComposerDraft {
        ComposerDraft {
            text: self.text().to_owned(),
            cursor: self.cursor(),
            attachments: self.attachments.clone(),
            text_elements: self.draft.textarea.text_element_snapshots(),
            pending_pastes: self.draft.pending_pastes.clone(),
            mention_bindings: self.snapshot_mention_bindings(),
        }
    }

    pub(crate) fn restore_draft(&mut self, draft: ComposerDraft) {
        self.draft.textarea.set_text_clearing_elements(&draft.text);
        self.draft
            .textarea
            .restore_text_elements(&draft.text_elements);
        self.draft.pending_pastes = draft.pending_pastes;
        self.bind_mentions_from_snapshot(draft.mention_bindings);
        self.draft.textarea.set_cursor(draft.cursor);
        self.attachments = draft.attachments;
        self.draft.saved_draft = None;
        if self.history_search.is_none() {
            self.footer.mode = if self.is_empty() {
                FooterMode::ComposerEmpty
            } else {
                FooterMode::ComposerHasDraft
            };
        }
        self.sync_completion_popup();
    }

    pub(super) fn draft_content_equals(&self, draft: &ComposerDraft) -> bool {
        self.text() == draft.text
            && self.attachments == draft.attachments
            && self.draft.textarea.text_element_snapshots() == draft.text_elements
            && self.draft.pending_pastes == draft.pending_pastes
            && self.snapshot_mention_bindings() == draft.mention_bindings
    }

    pub(crate) fn textarea(&self) -> &TextArea {
        &self.draft.textarea
    }

    pub(crate) fn textarea_state_mut(&self) -> RefMut<'_, TextAreaState> {
        self.draft.textarea_state_mut()
    }

    pub(crate) fn text(&self) -> &str {
        self.draft.textarea.text()
    }

    pub(crate) fn set_locale(&mut self, locale: crate::locale::Locale) {
        self.locale = locale;
    }

    pub(crate) fn cursor(&self) -> usize {
        self.draft.textarea.cursor()
    }

    pub(crate) fn desired_height(&self, width: u16) -> u16 {
        self.draft.textarea.desired_height(width)
    }

    pub(crate) fn is_empty(&self) -> bool {
        self.draft.textarea.is_empty() && self.attachments.is_empty()
    }

    #[cfg(test)]
    pub(crate) fn local_image_paths(&self) -> Vec<std::path::PathBuf> {
        self.attachments.local_image_paths()
    }

    pub(crate) fn local_images(&self) -> Vec<crate::bottom_pane::LocalImageAttachment> {
        self.attachments.local_images()
    }

    pub(crate) fn remote_images(&self) -> &[crate::bottom_pane::RemoteImageAttachment] {
        self.attachments.remote_images()
    }

    #[cfg(test)]
    pub(crate) fn remote_image_urls(&self) -> Vec<String> {
        self.remote_images()
            .iter()
            .map(|image| image.url.clone())
            .collect()
    }

    pub(crate) fn has_selected_remote_image(&self) -> bool {
        self.attachments.selected_remote_image_index().is_some()
    }

    pub(crate) fn remote_image_lines(&self) -> Vec<ratatui::text::Line<'static>> {
        self.attachments.remote_image_lines()
    }

    #[cfg(test)]
    pub(crate) fn has_pending_images(&self) -> bool {
        !self.attachments.is_empty()
    }

    pub(crate) fn attach_image(&mut self, path: std::path::PathBuf) {
        self.edit_stored_draft(|composer| {
            let started = composer.begin_direct_vim_edit();
            let elements_before = composer.draft.textarea.element_payloads();
            composer
                .attachments
                .attach_image(&mut composer.draft.textarea, path);
            composer.reconcile_deleted_elements(elements_before);
            composer.reset_history_navigation();
            if started {
                composer.finish_vim_edit();
            }
        });
    }

    pub(crate) fn take_recent_submission_images_with_placeholders(
        &mut self,
    ) -> Vec<crate::bottom_pane::LocalImageAttachment> {
        self.attachments
            .take_recent_submission_images_with_placeholders()
    }

    pub(crate) fn take_remote_images(&mut self) -> Vec<crate::bottom_pane::RemoteImageAttachment> {
        let images = self
            .attachments
            .take_remote_images(&mut self.draft.textarea);
        if !images.is_empty() {
            self.reset_history_navigation();
        }
        images
    }

    #[cfg(test)]
    pub(crate) fn take_remote_image_urls(&mut self) -> Vec<String> {
        self.take_remote_images()
            .into_iter()
            .map(|image| image.url)
            .collect()
    }

    #[cfg(test)]
    pub(crate) fn set_remote_image_urls(&mut self, urls: Vec<String>) {
        self.edit_stored_draft(|composer| {
            let started = composer.begin_direct_vim_edit();
            composer.attachments.set_remote_images(
                urls.into_iter()
                    .map(|url| crate::bottom_pane::RemoteImageAttachment { url, detail: None })
                    .collect(),
                &mut composer.draft.textarea,
            );
            composer.reset_history_navigation();
            if started {
                composer.finish_vim_edit();
            }
        });
    }

    #[cfg(test)]
    pub(crate) fn set_text_content(
        &mut self,
        text: String,
        text_elements: Vec<agent_protocol::TextElement>,
        images: Vec<crate::bottom_pane::LocalImageAttachment>,
        remote_images: Vec<String>,
    ) {
        self.set_text_content_with_mention_bindings(
            text,
            text_elements,
            images,
            remote_images
                .into_iter()
                .map(|url| crate::bottom_pane::RemoteImageAttachment { url, detail: None })
                .collect(),
            Vec::new(),
        );
    }

    pub(crate) fn set_text_content_with_mention_bindings(
        &mut self,
        text: String,
        text_elements: Vec<agent_protocol::TextElement>,
        images: Vec<crate::bottom_pane::LocalImageAttachment>,
        remote_images: Vec<crate::bottom_pane::RemoteImageAttachment>,
        mention_bindings: Vec<MentionBinding>,
    ) {
        self.rebuild_text_content(text, text_elements, images, remote_images, mention_bindings);
        self.reset_history_navigation();
        self.sync_completion_popup();
    }

    pub(super) fn rebuild_text_content(
        &mut self,
        text: String,
        text_elements: Vec<agent_protocol::TextElement>,
        images: Vec<crate::bottom_pane::LocalImageAttachment>,
        remote_images: Vec<crate::bottom_pane::RemoteImageAttachment>,
        mention_bindings: Vec<MentionBinding>,
    ) {
        self.replace_text(text);
        self.vim_history = VimHistory::default();
        self.attachments
            .set_remote_images(remote_images, &mut self.draft.textarea);
        let text = self.text().to_owned();
        self.draft
            .textarea
            .set_text_with_elements(&text, &text_elements);
        self.attachments
            .reset_local_images(images, &mut self.draft.textarea);
        // Canonical image-only inputs have no inline text. Give each missing attachment a
        // registered element; literal lookalike text is never inferred to be an attachment.
        for image in self.local_images().into_iter().rev() {
            if !self
                .draft
                .textarea
                .element_payloads()
                .contains(&image.placeholder)
            {
                self.draft.textarea.set_cursor(0);
                self.draft.textarea.insert_element(&image.placeholder);
                self.draft.textarea.insert(" ");
            }
        }
        self.draft.textarea.set_cursor(self.text().len());
        self.bind_mentions_from_snapshot(mention_bindings);
    }

    pub(super) fn reconcile_deleted_elements(&mut self, before: Vec<String>) {
        let removed = before
            .into_iter()
            .filter(|payload| !self.draft.textarea.can_restore_element_payload(payload))
            .collect::<Vec<_>>();
        self.attachments
            .remove_deleted_local_placeholders(&removed, &mut self.draft.textarea);
    }

    /// Cancel a draft while keeping its complete structured entry available through history.
    pub(crate) fn clear_for_ctrl_c(&mut self) -> Option<String> {
        if let Some(text) = self.draft.paste_burst.flush_before_modified_input() {
            self.handle_paste(&text);
        }
        if self.is_empty() {
            return None;
        }
        let entry = self.snapshot_history_entry();
        let previous = entry.text.clone();
        self.draft.textarea.take();
        self.draft.pending_pastes.clear();
        self.draft.mention_bindings.clear();
        self.draft.recent_submission_mention_bindings.clear();
        self.attachments = AttachmentState::default();
        self.history.record_local_submission(entry);
        self.draft.saved_draft = None;
        self.history_search = None;
        self.vim_history = VimHistory::default();
        self.footer.mode = FooterMode::ComposerEmpty;
        Some(previous)
    }

    pub(crate) fn history_search_active(&self) -> bool {
        self.history_search.is_some()
    }

    pub(crate) fn footer_has_draft(&self) -> bool {
        matches!(self.footer.mode, FooterMode::ComposerHasDraft) || !self.attachments.is_empty()
    }

    pub(crate) fn set_vim_enabled(&mut self, enabled: bool) {
        self.draft.textarea.set_vim_enabled(enabled);
        self.vim_history = VimHistory::default();
        self.reset_history_navigation();
    }

    pub(crate) fn toggle_vim_enabled(&mut self) -> bool {
        let enabled = !self.draft.textarea.is_vim_enabled();
        self.set_vim_enabled(enabled);
        enabled
    }

    pub(crate) fn is_vim_normal_mode(&self) -> bool {
        self.draft.textarea.is_vim_normal_mode()
    }

    pub(crate) fn should_handle_vim_insert_escape(&self, key: KeyEvent) -> bool {
        self.draft.textarea.should_handle_vim_insert_escape(key)
    }

    pub(crate) fn vim_mode_indicator_span(&self) -> Option<ratatui::text::Span<'static>> {
        self.draft.textarea.vim_mode_indicator_span()
    }

    pub(crate) fn replace(&mut self, text: String) {
        self.replace_text(text);
        self.reset_history_navigation();
        self.history_search = None;
        self.sync_completion_popup();
    }

    pub(crate) fn insert(&mut self, value: &str) {
        self.edit_stored_draft(|composer| {
            let started = composer.begin_direct_vim_edit();
            let elements_before = composer.draft.textarea.element_payloads();
            composer.draft.textarea.insert(value);
            composer.reconcile_deleted_elements(elements_before);
            composer.reset_history_navigation();
            composer.sync_completion_popup();
            if started {
                composer.finish_vim_edit();
            }
        });
    }
}
