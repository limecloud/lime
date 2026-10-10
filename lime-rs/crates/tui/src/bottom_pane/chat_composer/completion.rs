//! Slash, file, and skill completion share one lifecycle and draft edit owner.

use super::*;

impl ChatComposer {
    pub(crate) fn command_popup(&self) -> Option<&CommandPopup> {
        match &self.popups.active {
            ActivePopup::Command(popup) => Some(popup),
            ActivePopup::File(_) | ActivePopup::Skill(_) | ActivePopup::None => None,
        }
    }

    pub(crate) fn file_search_popup(&self) -> Option<&FileSearchPopup> {
        match &self.popups.active {
            ActivePopup::File(popup) => Some(popup),
            ActivePopup::Command(_) | ActivePopup::Skill(_) | ActivePopup::None => None,
        }
    }

    pub(crate) fn file_search_popup_active(&self) -> bool {
        matches!(self.popups.active, ActivePopup::File(_))
    }

    pub(crate) fn file_search_popup_has_selection(&self) -> bool {
        matches!(&self.popups.active, ActivePopup::File(popup) if popup.selected_path().is_some())
    }

    pub(crate) fn take_file_search_request(&mut self) -> Option<FileSearchRequest> {
        self.popups.file_search_request.take()
    }

    /// Update the enabled skill catalog received from the App Server startup contract.
    pub(crate) fn set_skills(&mut self, skills: Vec<SkillMetadata>) {
        self.popups.skills = skills.into_iter().filter(|skill| skill.enabled).collect();
        if let ActivePopup::Skill(popup) = &mut self.popups.active {
            popup.set_skills(self.popups.skills.clone());
        }
        self.sync_completion_popup();
    }

    pub(crate) fn skills(&self) -> &[SkillMetadata] {
        &self.popups.skills
    }

    pub(crate) fn skill_popup(&self) -> Option<&SkillPopup> {
        match &self.popups.active {
            ActivePopup::Skill(popup) => Some(popup),
            ActivePopup::Command(_) | ActivePopup::File(_) | ActivePopup::None => None,
        }
    }

    pub(crate) fn skill_popup_active(&self) -> bool {
        matches!(self.popups.active, ActivePopup::Skill(_))
    }

    pub(crate) fn handle_skill_popup_event(
        &mut self,
        event: &crossterm::event::Event,
    ) -> SkillPopupAction {
        let action = match &mut self.popups.active {
            ActivePopup::Skill(popup) => popup.handle_event(event),
            ActivePopup::Command(_) | ActivePopup::File(_) | ActivePopup::None => {
                SkillPopupAction::Pass
            }
        };
        match action {
            SkillPopupAction::Cancel => {
                if let Some((range, query)) = self.current_skill_token_range() {
                    self.popups.dismissed_skill_token =
                        Some(DismissedToken::new(self.text(), range, query));
                }
                self.popups.clear();
            }
            SkillPopupAction::Complete => {
                let selected_skill = match &self.popups.active {
                    ActivePopup::Skill(popup) => popup.selected_skill().cloned(),
                    _ => None,
                };
                if let (Some(skill), Some((range, _))) =
                    (selected_skill, self.current_skill_token_range())
                {
                    let inserted = format!("${}", skill.name);
                    let inserted_range = self.insert_selected_mention(
                        range,
                        &inserted,
                        Some(&skill.path.to_string_lossy()),
                    );
                    self.popups.dismissed_skill_token =
                        Some(DismissedToken::new(self.text(), inserted_range, skill.name));
                }
                self.popups.clear();
            }
            SkillPopupAction::Consumed => {
                if matches!(
                    event,
                    crossterm::event::Event::Key(key)
                        if matches!(key.code, crossterm::event::KeyCode::Enter | crossterm::event::KeyCode::Tab)
                ) {
                    self.popups.clear();
                }
            }
            SkillPopupAction::Pass => {}
        }
        action
    }

    pub(crate) fn on_file_search_result(
        &mut self,
        generation: u64,
        query: &str,
        matches: Vec<FuzzyFileSearchResult>,
    ) {
        if generation != self.popups.file_search_generation {
            return;
        }
        if let ActivePopup::File(popup) = &mut self.popups.active {
            popup.set_matches(query, matches);
        }
    }

    pub(crate) fn handle_file_search_popup_event(
        &mut self,
        event: &crossterm::event::Event,
    ) -> FileSearchPopupAction {
        let action = match &mut self.popups.active {
            ActivePopup::File(popup) => popup.handle_event(event),
            ActivePopup::Command(_) | ActivePopup::Skill(_) | ActivePopup::None => {
                FileSearchPopupAction::Pass
            }
        };
        match action {
            FileSearchPopupAction::Cancel => {
                if let Some((range, query)) = self.current_at_token_range() {
                    self.popups.dismissed_file_token =
                        Some(DismissedToken::new(self.text(), range, query));
                }
                self.popups.clear();
            }
            FileSearchPopupAction::Complete => {
                let path = match &self.popups.active {
                    ActivePopup::File(popup) => popup.selected_path().map(str::to_owned),
                    _ => None,
                };
                if let (Some(path), Some((range, _))) = (path, self.current_at_token_range()) {
                    self.complete_token(range, &path);
                    self.popups.dismissed_file_token = None;
                    self.popups.clear();
                    self.sync_completion_popup();
                }
            }
            FileSearchPopupAction::Consumed => {
                if matches!(
                    event,
                    crossterm::event::Event::Key(key)
                        if matches!(key.code, crossterm::event::KeyCode::Enter | crossterm::event::KeyCode::Tab)
                            && !self.file_search_popup_has_selection()
                ) {
                    self.popups.clear();
                }
            }
            FileSearchPopupAction::Pass => {}
        }
        action
    }

    pub(crate) fn completion_popup_active(&self) -> bool {
        self.popups.active()
    }

    pub(crate) fn clear_completion_popup(&mut self) {
        self.popups.clear();
    }

    pub(crate) fn handle_command_popup_event(
        &mut self,
        event: &crossterm::event::Event,
    ) -> CommandPopupAction {
        let ActivePopup::Command(popup) = &mut self.popups.active else {
            return CommandPopupAction::Pass;
        };
        let action = popup.handle_event(event);
        if matches!(action, CommandPopupAction::Cancel) {
            let first_line = self.text().lines().next().unwrap_or("");
            let token = slash_input::command_popup_filter_text(first_line, self.cursor());
            self.popups.dismiss_command(token.unwrap_or_default());
        }
        action
    }

    pub(crate) fn sync_completion_popup(&mut self) {
        if !self.config.popups_enabled || self.history.is_navigating() {
            self.popups.clear();
            return;
        }
        if !self.popups.skills.is_empty() {
            if let Some((range, query)) = self.current_skill_token_range() {
                if skill_query_is_candidate(&query, &self.popups.skills) {
                    if self
                        .popups
                        .dismissed_skill_token
                        .as_ref()
                        .is_some_and(|dismissed| dismissed.matches(self.text(), &range, &query))
                    {
                        if matches!(self.popups.active, ActivePopup::Skill(_)) {
                            self.popups.active = ActivePopup::None;
                        }
                        return;
                    }
                    self.popups.dismissed_skill_token = None;
                    match &mut self.popups.active {
                        ActivePopup::Skill(popup) => {
                            popup.set_query(query.clone());
                            popup.set_skills(self.popups.skills.clone());
                        }
                        ActivePopup::Command(_) | ActivePopup::File(_) | ActivePopup::None => {
                            self.popups.clear();
                            self.popups.active = ActivePopup::Skill(SkillPopup::new(
                                self.popups.skills.clone(),
                                query,
                            ));
                        }
                    }
                    return;
                }
            }
        }
        self.popups.dismissed_skill_token = None;
        if matches!(self.popups.active, ActivePopup::Skill(_)) {
            self.popups.active = ActivePopup::None;
        }
        if let Some((range, query)) = self.current_at_token_range() {
            if self
                .popups
                .dismissed_file_token
                .as_ref()
                .is_some_and(|dismissed| dismissed.matches(self.text(), &range, &query))
            {
                if matches!(self.popups.active, ActivePopup::File(_)) {
                    self.popups.active = ActivePopup::None;
                }
                return;
            }
            self.popups.dismissed_file_token = None;
            match &mut self.popups.active {
                ActivePopup::File(popup) => popup.set_query(query.clone()),
                ActivePopup::Command(_) | ActivePopup::Skill(_) | ActivePopup::None => {
                    self.popups.active = ActivePopup::File(FileSearchPopup::new(query.clone()));
                }
            }
            if query.is_empty() {
                if let ActivePopup::File(popup) = &mut self.popups.active {
                    popup.set_empty_prompt();
                }
                self.popups.file_search_request = None;
                self.popups.file_search_requested_query = None;
                return;
            }
            let current_query = match &self.popups.active {
                ActivePopup::File(popup) => Some(popup.query()),
                ActivePopup::Command(_) | ActivePopup::Skill(_) | ActivePopup::None => None,
            };
            if let Some(current_query) = current_query {
                if !current_query.is_empty()
                    && self.popups.file_search_requested_query.as_deref() != Some(current_query)
                {
                    self.popups.file_search_generation =
                        self.popups.file_search_generation.wrapping_add(1);
                    self.popups.file_search_request = Some(FileSearchRequest {
                        generation: self.popups.file_search_generation,
                        query: current_query.to_string(),
                    });
                    self.popups.file_search_requested_query = Some(current_query.to_string());
                }
            }
            return;
        }
        self.popups.dismissed_file_token = None;
        if matches!(self.popups.active, ActivePopup::File(_)) {
            self.popups.clear();
        }
        self.popups.file_search_requested_query = None;
        let text = self.text().to_string();
        let first_line = text.lines().next().unwrap_or("");
        let Some(filter) = slash_input::command_popup_filter_text(first_line, self.cursor()) else {
            self.popups.clear_dismissal();
            self.popups.active = ActivePopup::None;
            return;
        };
        if self.popups.dismissed_for(Some(&filter)) {
            self.popups.active = ActivePopup::None;
            return;
        } else {
            self.popups.clear_dismissal();
        }
        if self
            .popups
            .active
            .as_command_mut()
            .is_some_and(|popup| popup.update(&filter))
        {
            return;
        }
        self.popups.active = slash_input::command_popup(&filter);
    }

    pub(super) fn current_at_token_range(&self) -> Option<(Range<usize>, String)> {
        completion_target::current_prefixed_token_range(&self.draft.textarea, '@', false)
    }

    pub(super) fn current_skill_token_range(&self) -> Option<(Range<usize>, String)> {
        completion_target::current_prefixed_token_range(&self.draft.textarea, '$', true)
    }

    /// Both mention types replace one draft token inside the same Vim/history edit boundary.
    fn complete_token(&mut self, range: Range<usize>, replacement: &str) -> Range<usize> {
        let started = self.begin_direct_vim_edit();
        let start = range.start;
        self.draft.textarea.replace_range(range, replacement);
        let inserted_range = start..start.saturating_add(replacement.len());
        self.draft.textarea.set_cursor(inserted_range.end);
        self.advance_past_file_completion_separator();
        self.reset_history_navigation();
        if started {
            self.finish_vim_edit();
        }
        inserted_range
    }

    /// Leave the cursor after one horizontal separator following a file completion.
    ///
    /// Existing horizontal whitespace is reused when it already separates the completed path
    /// from a suffix. Newlines are not reused as separators, matching Codex completion behavior.
    pub(super) fn advance_past_file_completion_separator(&mut self) {
        let cursor = self.draft.textarea.cursor();
        let text = self.draft.textarea.text();
        let Some(next) = text[cursor..].chars().next() else {
            self.draft.textarea.insert_str_at(cursor, " ");
            return;
        };
        let is_horizontal = |ch: char| {
            ch.is_whitespace()
                && !matches!(
                    ch,
                    '\n' | '\r' | '\u{000B}' | '\u{000C}' | '\u{0085}' | '\u{2028}' | '\u{2029}'
                )
        };
        if !is_horizontal(next) {
            self.draft.textarea.insert_str_at(cursor, " ");
            return;
        }
        let separator_len = next.len_utf8();
        let after_separator = cursor.saturating_add(separator_len);
        let suffix_is_non_whitespace = self.draft.textarea.text()[after_separator..]
            .chars()
            .next()
            .is_some_and(|ch| !ch.is_whitespace());
        if suffix_is_non_whitespace {
            self.draft.textarea.insert_str_at(cursor, " ");
        } else {
            self.draft.textarea.set_cursor(after_separator);
        }
    }

    pub(crate) fn command_from_prompt(
        &self,
        prompt: &str,
    ) -> Option<crate::slash_command::SlashCommand> {
        slash_input::command_from_prompt(prompt)
    }
}

fn skill_query_is_candidate(query: &str, skills: &[SkillMetadata]) -> bool {
    match completion_target::dollar_query_kind(query) {
        completion_target::DollarQueryKind::Completable => true,
        completion_target::DollarQueryKind::AmbiguousShellParameter => {
            skills.iter().any(|skill| skill.name == query)
        }
        completion_target::DollarQueryKind::ShellVariable
        | completion_target::DollarQueryKind::DefiniteShellParameter
        | completion_target::DollarQueryKind::Invalid => false,
    }
}
