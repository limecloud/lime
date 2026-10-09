//! Slash-command parsing and composer popup construction.
//!
//! This module is the composer-facing fact source.  The command catalog remains in
//! [`crate::slash_command`], while lifecycle and rendering stay in the popup owner.

use super::super::command_popup::CommandPopup;
use super::ChatComposer;
use crate::slash_command::command_from_prompt as parse_command_from_prompt;
use crate::slash_command::SlashCommand;

impl ChatComposer {
    pub(crate) fn complete_slash_command(&mut self, command: SlashCommand) {
        if !self
            .complete_selected_slash_command_preserving_existing_draft_tail_as_inline_args(command)
        {
            let suffix = if command.requires_argument() { " " } else { "" };
            self.replace(format!("/{}{suffix}", command.command()));
        }
        self.clear_completion_popup();
    }

    fn complete_selected_slash_command_preserving_existing_draft_tail_as_inline_args(
        &mut self,
        command: SlashCommand,
    ) -> bool {
        if !command.supports_inline_args() {
            return false;
        }
        let text = self.text();
        let first_line_end = text.find('\n').unwrap_or(text.len());
        let cursor = self.cursor();
        if cursor > first_line_end || !text.starts_with('/') || !text.is_char_boundary(cursor) {
            return false;
        }
        let command_token_end = text[1..first_line_end]
            .find(char::is_whitespace)
            .map(|index| 1 + index)
            .unwrap_or(first_line_end);
        let typed_command_name = &text[1..command_token_end];
        let rest_after_token_is_empty = text[command_token_end..].trim().is_empty();
        if rest_after_token_is_empty && (cursor <= 1 || cursor >= command_token_end) {
            return false;
        }
        let replace_end = if cursor <= 1
            || (typed_command_name == command.command() && rest_after_token_is_empty)
        {
            command_token_end
        } else {
            cursor
        };
        let tail_starts_with_whitespace = text[replace_end..]
            .chars()
            .next()
            .is_some_and(char::is_whitespace);
        let replacement = if tail_starts_with_whitespace {
            format!("/{}", command.command())
        } else {
            format!("/{} ", command.command())
        };
        let started = self.begin_direct_vim_edit();
        let elements_before = self.draft.textarea.element_payloads();
        let ranges_to_unmark = self
            .draft
            .textarea
            .text_elements()
            .into_iter()
            .filter_map(|element| {
                let range = element.byte_range.start..element.byte_range.end;
                (range.start < replace_end && replace_end < range.end).then_some(range)
            })
            .collect::<Vec<_>>();
        for range in ranges_to_unmark {
            self.draft.textarea.remove_element_range(range);
        }
        self.draft
            .textarea
            .replace_range(0..replace_end, &replacement);
        self.draft.textarea.set_cursor(self.text().len());
        self.reconcile_deleted_elements(elements_before);
        self.reconcile_pending_pastes();
        self.reset_history_navigation();
        if started {
            self.finish_vim_edit();
        }
        true
    }
}

pub(super) fn command_popup(text: &str) -> super::ActivePopup {
    CommandPopup::for_composer(text)
        .map(super::ActivePopup::Command)
        .unwrap_or_default()
}

/// Return the command fragment under the cursor for popup filtering.
///
/// Codex keeps the slash popup available while the cursor is inside the command name, even when
/// the first line already has inline arguments. Once the cursor moves into the argument suffix,
/// the popup is dismissed so it cannot steal normal text editing keys.
pub(super) fn command_popup_filter_text(first_line: &str, cursor: usize) -> Option<String> {
    let (name, _) = command_under_cursor(first_line, cursor)?;
    Some(format!("/{name}"))
}

fn command_under_cursor(first_line: &str, cursor: usize) -> Option<(&str, &str)> {
    if !first_line.starts_with('/')
        || cursor > first_line.len()
        || !first_line.is_char_boundary(cursor)
    {
        return None;
    }

    let name_start = 1;
    let name_end = first_line[name_start..]
        .find(char::is_whitespace)
        .map(|offset| name_start + offset)
        .unwrap_or(first_line.len());
    let cursor = if cursor <= name_start {
        name_end
    } else {
        cursor
    };
    if cursor > name_end {
        return None;
    }

    Some((&first_line[name_start..cursor], &first_line[cursor..]))
}

pub(super) fn command_from_prompt(prompt: &str) -> Option<crate::slash_command::SlashCommand> {
    parse_command_from_prompt(prompt)
}

#[cfg(test)]
#[path = "slash_input_tests.rs"]
mod completion_tests;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bottom_pane::chat_composer::popup_state::ActivePopup;

    #[test]
    fn popup_is_created_only_for_a_single_slash_token() {
        assert!(matches!(command_popup("/mo"), ActivePopup::Command(_)));
        assert!(matches!(command_popup("ordinary"), ActivePopup::None));
        assert!(matches!(command_popup("/model args"), ActivePopup::None));
    }

    #[test]
    fn popup_filter_tracks_the_cursor_inside_a_command_name() {
        let text = "/review inline args";
        assert_eq!(
            command_popup_filter_text(text, "/re".len()),
            Some("/re".to_string())
        );
        assert_eq!(
            command_popup_filter_text(text, "/review".len()),
            Some("/review".to_string())
        );
        assert_eq!(command_popup_filter_text(text, text.len()), None);
    }

    #[test]
    fn popup_filter_rejects_non_boundary_utf8_cursor_offsets() {
        let text = "/审查 参数";
        let slash = text.find('/').expect("slash");
        assert_eq!(command_popup_filter_text(text, slash + 2), None);
        assert_eq!(
            command_popup_filter_text(text, "/审".len()),
            Some("/审".to_string())
        );
    }

    #[test]
    fn parser_delegates_to_the_command_catalog() {
        assert_eq!(
            command_from_prompt("/model"),
            Some(crate::slash_command::SlashCommand::Model)
        );
        assert_eq!(command_from_prompt("/unknown"), None);
    }
}
