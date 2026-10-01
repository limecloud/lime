//! Submission lowering at the TUI boundary.
//!
//! This module owns the Lime subset of Codex `chatwidget/input_submission`:
//! composer results become app actions, canonical queued submissions can be
//! edited without losing attachments, and the composer owns attachment state.
//! Transport execution remains in the runtime and App Server session.

use super::skills::{collect_tool_mentions, find_skill_mentions_with_tool_mentions};
use super::*;
use crate::bottom_pane::pending_input_preview::can_restore_submission;
use crate::bottom_pane::{
    InputResult, LocalImageAttachment, MentionBinding, RemoteImageAttachment,
};
use app_server_protocol::protocol::v2::UserInput;

pub(crate) fn submission_input(
    prompt: String,
    images: &[LocalImageAttachment],
    remote_images: &[RemoteImageAttachment],
    skills: &[app_server_protocol::protocol::v2::SkillMetadata],
    text_elements: Vec<agent_protocol::TextElement>,
    mention_bindings: &[MentionBinding],
) -> Vec<UserInput> {
    let mut input = remote_images
        .iter()
        .map(|image| UserInput::Image {
            detail: image.detail,
            url: image.url.clone(),
        })
        .collect::<Vec<_>>();
    input.extend(images.iter().map(|image| UserInput::LocalImage {
        detail: image.detail,
        path: image.path.to_string_lossy().into_owned(),
    }));
    let mentions = collect_tool_mentions(&prompt, &std::collections::HashMap::new());
    if !prompt.is_empty() {
        input.push(UserInput::Text {
            text: prompt,
            text_elements,
        });
    }
    let bound_names = mention_bindings
        .iter()
        .map(|binding| binding.mention.as_str())
        .collect::<std::collections::HashSet<_>>();
    let mut selected_skill_paths = std::collections::HashSet::new();
    for binding in mention_bindings {
        let path = PathBuf::from(
            binding
                .path
                .strip_prefix("skill://")
                .unwrap_or(&binding.path),
        );
        if let Some(skill) = skills
            .iter()
            .find(|skill| skill.enabled && skill.path == path)
            .filter(|skill| selected_skill_paths.insert(skill.path.clone()))
        {
            input.push(UserInput::Skill {
                name: skill.name.clone(),
                path: skill.path.to_string_lossy().into_owned(),
            });
        }
    }
    for skill in find_skill_mentions_with_tool_mentions(&mentions, skills) {
        if !bound_names.contains(skill.name.as_str())
            && selected_skill_paths.insert(skill.path.clone())
        {
            input.push(UserInput::Skill {
                name: skill.name,
                path: skill.path.to_string_lossy().into_owned(),
            });
        }
    }
    input
}

pub(crate) fn history_text(
    text: &str,
    elements: &[agent_protocol::TextElement],
    bindings: &[MentionBinding],
) -> String {
    let mentions = bindings
        .iter()
        .map(|binding| crate::mention_codec::LinkedMention {
            sigil: binding.sigil,
            mention: binding.mention.clone(),
            path: binding.path.clone(),
        })
        .collect::<Vec<_>>();
    crate::mention_codec::encode_history_mentions_at_elements(text, &mentions, elements)
}

impl App {
    pub(crate) fn take_recent_submission_mention_bindings(&mut self) -> Vec<MentionBinding> {
        self.composer.take_recent_submission_mention_bindings()
    }
    pub(crate) fn attach_image(&mut self, path: PathBuf) {
        self.composer.attach_image(path);
    }

    pub(crate) fn take_recent_submission_images_with_placeholders(
        &mut self,
    ) -> Vec<LocalImageAttachment> {
        self.composer
            .take_recent_submission_images_with_placeholders()
    }

    /// Restore a submission that could not be acknowledged by App Server.
    ///
    /// The composer is cleared before transport execution. Keeping the complete local draft at
    /// the boundary makes reconnect failures recoverable without retrying an uncertain request.
    pub(crate) fn restore_submission_draft(
        &mut self,
        prompt: String,
        text_elements: Vec<agent_protocol::TextElement>,
        images: Vec<LocalImageAttachment>,
        remote_images: Vec<RemoteImageAttachment>,
        mention_bindings: Vec<MentionBinding>,
    ) {
        self.composer.edit_stored_draft(|composer| {
            composer.set_text_content_with_mention_bindings(
                prompt,
                text_elements,
                images,
                remote_images,
                mention_bindings,
            );
        });
        self.clear_completion_popup();
    }

    pub(crate) fn take_remote_images(&mut self) -> Vec<RemoteImageAttachment> {
        self.composer.take_remote_images()
    }

    #[cfg(test)]
    pub(crate) fn take_remote_image_urls(&mut self) -> Vec<String> {
        self.composer.take_remote_image_urls()
    }

    #[cfg(test)]
    pub(crate) fn set_remote_image_urls(&mut self, urls: Vec<String>) {
        self.composer.set_remote_image_urls(urls);
    }

    pub(crate) fn set_queued_submissions(&mut self, submissions: Vec<QueuedSubmission>) {
        self.queued_submissions = submissions;
    }

    pub(crate) fn upsert_queued_submission(&mut self, submission: QueuedSubmission) {
        if let Some(existing) = self
            .queued_submissions
            .iter_mut()
            .find(|existing| existing.id == submission.id)
        {
            *existing = submission;
        } else {
            self.queued_submissions.push(submission);
        }
    }

    pub(crate) fn restore_queued_submission_for_edit(
        &mut self,
        submission: QueuedSubmission,
    ) -> bool {
        if !self.composer.is_empty() || !can_restore_submission(&submission) {
            return false;
        }
        let submission_id = submission.id.clone();
        let mut text = String::new();
        let mut text_elements = Vec::new();
        let mut local_images = Vec::new();
        let mut remote_images = Vec::new();
        let mut mention_bindings = Vec::new();
        for input in submission.input {
            match input {
                UserInput::Text {
                    text: value,
                    text_elements: elements,
                } => {
                    let offset = text.len();
                    text.push_str(&value);
                    text_elements.extend(elements.into_iter().map(|mut element| {
                        element.byte_range.start += offset;
                        element.byte_range.end += offset;
                        element
                    }));
                }
                UserInput::LocalImage { path, detail } => {
                    local_images.push((PathBuf::from(path), detail))
                }
                UserInput::Image { url, detail } => {
                    remote_images.push(RemoteImageAttachment { url, detail })
                }
                UserInput::Skill { name, path } => mention_bindings.push(MentionBinding {
                    sigil: '$',
                    mention: name,
                    path,
                }),
                _ => return false,
            }
        }
        self.queued_submissions
            .retain(|queued| queued.id != submission_id);
        // Reuse existing canonical mention elements; only prepend skills absent from text.
        let mut available = std::collections::HashMap::<&str, usize>::new();
        for element in &text_elements {
            if let Some(token) = text.get(element.byte_range.start..element.byte_range.end) {
                *available.entry(token).or_default() += 1;
            }
        }
        let mut present = Vec::new();
        let mut missing = Vec::new();
        for binding in mention_bindings {
            let token = format!("${}", binding.mention);
            if let Some(count) = available
                .get_mut(token.as_str())
                .filter(|count| **count > 0)
            {
                *count -= 1;
                present.push(binding);
            } else {
                missing.push(binding);
            }
        }
        if !missing.is_empty() {
            let prefix = missing
                .iter()
                .map(|binding| format!("${}", binding.mention))
                .collect::<Vec<_>>()
                .join(" ");
            let offset = prefix.len() + usize::from(!text.is_empty());
            for element in &mut text_elements {
                element.byte_range.start += offset;
                element.byte_range.end += offset;
            }
            let mut start = 0;
            let mut prefix_elements = Vec::new();
            for binding in &missing {
                let token = format!("${}", binding.mention);
                prefix_elements.push(agent_protocol::TextElement::new(
                    start..start + token.len(),
                    Some(token.clone()),
                ));
                start += token.len() + 1;
            }
            prefix_elements.extend(text_elements);
            text_elements = prefix_elements;
            text = if text.is_empty() {
                prefix
            } else {
                format!("{prefix} {text}")
            };
        }
        let mention_bindings = missing.into_iter().chain(present).collect();
        let local_images = local_images
            .into_iter()
            .enumerate()
            .map(|(index, (path, detail))| LocalImageAttachment {
                placeholder: format!("[Image #{}]", remote_images.len() + index + 1),
                path,
                detail,
            })
            .collect();
        self.composer.set_text_content_with_mention_bindings(
            text,
            text_elements,
            local_images,
            remote_images,
            mention_bindings,
        );
        self.clear_completion_popup();
        true
    }

    pub(super) fn map_composer_action(&mut self, action: InputResult) -> AppAction {
        let mapped = match action {
            InputResult::Submitted {
                text,
                text_elements,
            } => {
                self.clear_completion_popup();
                AppAction::Submit {
                    text,
                    text_elements,
                }
            }
            InputResult::Queued {
                text,
                text_elements,
            } => {
                self.clear_completion_popup();
                AppAction::Queue {
                    text,
                    text_elements,
                }
            }
            InputResult::Interrupt => {
                let cleared = self.composer.clear_for_ctrl_c().is_some();
                if cleared {
                    self.clear_completion_popup();
                    // Codex treats Ctrl-C as composer cancellation when a draft is present.
                    // Do not also interrupt the active turn: a follow-up Ctrl-C can then be
                    // handled after the terminal projection settles.
                    AppAction::None
                } else {
                    AppAction::Interrupt
                }
            }
            InputResult::SubmissionRejected { actual_chars } => {
                self.projection
                    .add_error_message(self.locale.user_input_too_large_message(actual_chars));
                AppAction::None
            }
            InputResult::DecreaseEffort => AppAction::DecreaseEffort,
            InputResult::IncreaseEffort => AppAction::IncreaseEffort,
            InputResult::PreviousPermissions => AppAction::PreviousPermissions,
            InputResult::NextPermissions => AppAction::NextPermissions,
            InputResult::OpenExternalEditor => {
                self.request_external_editor_launch();
                AppAction::None
            }
            InputResult::OpenAgentsOverview => {
                self.open_agents_overview();
                AppAction::RefreshAgentsOverview
            }
            InputResult::Quit => AppAction::Quit,
            InputResult::Changed => {
                if self.composer.history_search_active() || self.composer.vim_search_active() {
                    self.clear_completion_popup();
                } else {
                    self.sync_completion_popup();
                }
                AppAction::None
            }
            InputResult::None => AppAction::None,
        };
        if matches!(mapped, AppAction::None) && self.composer.paste_burst_needs_frame() {
            AppAction::ScheduleFrameIn(crate::tui::TARGET_FRAME_INTERVAL)
        } else {
            mapped
        }
    }
}

#[cfg(test)]
#[path = "input_submission_tests.rs"]
mod tests;
