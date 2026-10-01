//! Selected mentions bind to textarea element identities, never to a catalog name alone.

use super::*;
use crate::mention_codec::is_mention_name_char;

impl ChatComposer {
    pub(super) fn insert_selected_mention(
        &mut self,
        mut token_range: Range<usize>,
        insert_text: &str,
        path: Option<&str>,
    ) -> Range<usize> {
        let started = self.begin_direct_vim_edit();
        if self
            .draft
            .textarea
            .text_element_ranges()
            .any(|range| range.end == token_range.start)
        {
            self.draft
                .textarea
                .replace_range(token_range.start..token_range.start, " ");
            token_range.start += 1;
            token_range.end += 1;
        }
        let start = token_range.start;
        self.draft.textarea.replace_range(token_range, "");
        self.draft.textarea.set_cursor(start);
        let id = self.draft.textarea.insert_element(insert_text);
        if let (Some(path), Some((sigil, mention))) =
            (path, Self::mention_token_from_insert_text(insert_text))
        {
            self.draft.mention_bindings.insert(
                id,
                ComposerMentionBinding {
                    sigil,
                    mention,
                    path: path.to_string(),
                },
            );
        }
        self.advance_past_file_completion_separator();
        self.reset_history_navigation();
        if started {
            self.finish_vim_edit();
        }
        start..start + insert_text.len()
    }

    fn mention_token_from_insert_text(text: &str) -> Option<(char, String)> {
        let sigil = text.chars().next()?;
        let name = text.get(sigil.len_utf8()..)?;
        (matches!(sigil, '$' | '@') && !name.is_empty() && name.bytes().all(is_mention_name_char))
            .then(|| (sigil, name.to_string()))
    }

    fn current_mention_elements(&self) -> Vec<(u64, char, String)> {
        self.draft
            .textarea
            .text_element_snapshots()
            .into_iter()
            .filter_map(|element| {
                Self::mention_token_from_insert_text(&element.text)
                    .map(|(sigil, mention)| (element.id, sigil, mention))
            })
            .collect()
    }

    pub(super) fn snapshot_mention_bindings(&self) -> Vec<MentionBinding> {
        self.current_mention_elements()
            .into_iter()
            .filter_map(|(id, sigil, mention)| {
                let binding = self.draft.mention_bindings.get(&id)?;
                (binding.sigil == sigil && binding.mention == mention).then(|| MentionBinding {
                    sigil,
                    mention,
                    path: binding.path.clone(),
                })
            })
            .collect()
    }

    pub(super) fn take_mention_bindings(&mut self) -> Vec<MentionBinding> {
        let bindings = self.snapshot_mention_bindings();
        self.draft.mention_bindings.clear();
        bindings
    }

    pub(crate) fn take_recent_submission_mention_bindings(&mut self) -> Vec<MentionBinding> {
        std::mem::take(&mut self.draft.recent_submission_mention_bindings)
    }

    pub(super) fn bind_mentions_from_snapshot(&mut self, bindings: Vec<MentionBinding>) {
        self.draft.mention_bindings.clear();
        let snapshots = self.draft.textarea.text_element_snapshots();
        let text = self.text().to_string();
        let mut scan_from = 0;
        for binding in bindings {
            let token = format!("{}{}", binding.sigil, binding.mention);
            if Self::mention_token_from_insert_text(&token).is_none() {
                continue;
            }
            // Existing atomic ranges take precedence over lookalike literal tokens. External
            // edits and persistent history can restore a token without an existing range.
            let range = snapshots
                .iter()
                .find(|element| element.range.start >= scan_from && element.text == token)
                .map(|element| element.range.clone())
                .or_else(|| find_next_mention_token_range(&text, &token, scan_from));
            let Some(range) = range else { continue };
            let id = self
                .draft
                .textarea
                .add_element_range(range.clone())
                .or_else(|| {
                    self.draft
                        .textarea
                        .element_id_for_exact_range(range.clone())
                });
            if let Some(id) = id {
                scan_from = range.end;
                self.draft.mention_bindings.insert(
                    id,
                    ComposerMentionBinding {
                        sigil: binding.sigil,
                        mention: binding.mention,
                        path: binding.path,
                    },
                );
            }
        }
    }
}

fn find_next_mention_token_range(text: &str, token: &str, from: usize) -> Option<Range<usize>> {
    for (offset, _) in text.get(from..)?.match_indices(token) {
        let start = from + offset;
        let end = start + token.len();
        if text
            .as_bytes()
            .get(end)
            .is_none_or(|byte| !is_mention_name_char(*byte))
            && (token.starts_with('$')
                || start == 0
                || text[..start]
                    .chars()
                    .next_back()
                    .is_some_and(|ch| ch.is_whitespace()))
        {
            return Some(start..end);
        }
    }
    None
}

#[cfg(test)]
#[path = "mentions_tests.rs"]
mod tests;
