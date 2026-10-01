//! Local images are inline atomic elements; only remote images occupy separate rows.

use crate::bottom_pane::{LocalImageAttachment, RemoteImageAttachment, TextArea};
use crossterm::event::{KeyCode, KeyEvent, KeyEventKind};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::Line;
use std::path::PathBuf;

#[cfg(test)]
#[path = "attachment_state_tests.rs"]
mod tests;

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(super) struct AttachmentState {
    local_images: Vec<LocalImageAttachment>,
    remote_images: Vec<RemoteImageAttachment>,
    selected_remote_image_index: Option<usize>,
}

impl AttachmentState {
    pub(super) fn is_empty(&self) -> bool {
        self.local_images.is_empty() && self.remote_images.is_empty()
    }

    pub(super) fn len(&self) -> usize {
        self.local_images.len() + self.remote_images.len()
    }

    pub(super) fn local_image_paths(&self) -> Vec<PathBuf> {
        self.local_images
            .iter()
            .map(|image| image.path.clone())
            .collect()
    }

    pub(super) fn local_images(&self) -> Vec<LocalImageAttachment> {
        self.local_images.clone()
    }

    pub(super) fn attach_image(&mut self, textarea: &mut TextArea, path: PathBuf) {
        let placeholder = format!("[Image #{}]", self.len() + 1);
        textarea.insert_element(&placeholder);
        self.local_images.push(LocalImageAttachment {
            placeholder,
            path,
            detail: None,
        });
    }

    pub(super) fn take_recent_submission_images_with_placeholders(
        &mut self,
    ) -> Vec<LocalImageAttachment> {
        std::mem::take(&mut self.local_images)
    }

    pub(super) fn reset_local_images(
        &mut self,
        images: Vec<LocalImageAttachment>,
        textarea: &mut TextArea,
    ) {
        self.local_images = images;
        self.relabel_local_images(textarea);
    }

    pub(super) fn remote_images(&self) -> &[RemoteImageAttachment] {
        &self.remote_images
    }

    pub(super) fn take_remote_images(
        &mut self,
        textarea: &mut TextArea,
    ) -> Vec<RemoteImageAttachment> {
        self.selected_remote_image_index = None;
        let images = std::mem::take(&mut self.remote_images);
        self.relabel_local_images(textarea);
        images
    }

    pub(super) fn set_remote_images(
        &mut self,
        images: Vec<RemoteImageAttachment>,
        textarea: &mut TextArea,
    ) {
        self.remote_images = images;
        self.selected_remote_image_index = None;
        self.relabel_local_images(textarea);
    }

    pub(super) fn remove_deleted_local_placeholders(
        &mut self,
        removed: &[String],
        textarea: &mut TextArea,
    ) {
        let previous_len = self.local_images.len();
        self.local_images
            .retain(|image| !removed.contains(&image.placeholder));
        if self.local_images.len() != previous_len {
            self.relabel_local_images(textarea);
        }
    }

    pub(super) fn relabel_local_images(&mut self, textarea: &mut TextArea) {
        // Increasing the remote prefix must rename the largest number first, otherwise a new
        // label could be mistaken for a different image's old label in a reordered textarea.
        let increasing = self.local_images.first().is_some_and(|image| {
            image
                .placeholder
                .strip_prefix("[Image #")
                .and_then(|label| label.strip_suffix(']'))
                .and_then(|number| number.parse::<usize>().ok())
                .is_some_and(|number| number < self.remote_images.len() + 1)
        });
        let mut indices = (0..self.local_images.len()).collect::<Vec<_>>();
        if increasing {
            indices.reverse();
        }
        for index in indices {
            let image = &mut self.local_images[index];
            let expected = format!("[Image #{}]", self.remote_images.len() + index + 1);
            if image.placeholder != expected {
                textarea.replace_element_payload(&image.placeholder, &expected);
                image.placeholder = expected;
            }
        }
    }

    pub(super) fn prune_local_images_for_submission(
        &mut self,
        text: &str,
        text_elements: &[agent_protocol::TextElement],
    ) {
        self.local_images.retain(|image| {
            text_elements
                .iter()
                .any(|element| element.placeholder(text) == Some(image.placeholder.as_str()))
        });
    }

    pub(super) fn handle_remote_image_selection_key(
        &mut self,
        key: KeyEvent,
        textarea: &mut TextArea,
    ) -> bool {
        if self.remote_images.is_empty()
            || key.kind != KeyEventKind::Press
            || !key.modifiers.is_empty()
        {
            return false;
        }
        match key.code {
            KeyCode::Up if self.selected_remote_image_index.is_some() || textarea.cursor() == 0 => {
                self.selected_remote_image_index = Some(match self.selected_remote_image_index {
                    Some(index) => index.saturating_sub(1),
                    None => self.remote_images.len() - 1,
                });
                true
            }
            KeyCode::Down if self.selected_remote_image_index.is_some() => {
                let index = self
                    .selected_remote_image_index
                    .expect("selected remote image");
                self.selected_remote_image_index =
                    (index + 1 < self.remote_images.len()).then_some(index + 1);
                true
            }
            KeyCode::Delete | KeyCode::Backspace if self.remote_image_edit_key(key) => {
                let index = self
                    .selected_remote_image_index
                    .expect("selected remote image");
                self.remote_images.remove(index);
                self.selected_remote_image_index = if self.remote_images.is_empty() {
                    None
                } else {
                    Some(index.min(self.remote_images.len() - 1))
                };
                self.relabel_local_images(textarea);
                true
            }
            _ => {
                self.selected_remote_image_index = None;
                false
            }
        }
    }

    pub(super) fn selected_remote_image_index(&self) -> Option<usize> {
        self.selected_remote_image_index
    }

    pub(super) fn remote_image_edit_key(&self, key: KeyEvent) -> bool {
        self.selected_remote_image_index.is_some()
            && key.modifiers.is_empty()
            && matches!(key.code, KeyCode::Delete | KeyCode::Backspace)
    }

    pub(super) fn clear_remote_image_selection(&mut self) {
        self.selected_remote_image_index = None;
    }

    pub(super) fn remote_image_lines(&self) -> Vec<Line<'static>> {
        self.remote_images
            .iter()
            .enumerate()
            .map(|(index, _)| {
                let mut style = Style::default().fg(Color::Cyan);
                if self.selected_remote_image_index == Some(index) {
                    style = style.add_modifier(Modifier::REVERSED);
                }
                Line::styled(format!("[Image #{}]", index + 1), style)
            })
            .collect()
    }
}
