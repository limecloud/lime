//! External edits rebuild atomic image ownership from known attachment labels only.

use super::{ChatComposer, VimHistory};
use agent_protocol::TextElement;

impl ChatComposer {
    /// Keep known attachments whose labels remain in the edit, then renumber after remote images.
    /// Extra occurrences stay literal text, matching Codex's external-editor import boundary.
    pub(crate) fn apply_external_edit(&mut self, text: String) {
        let images = self.local_images();
        let previous_elements = self.draft.textarea.text_element_snapshots();
        let mut elements = Vec::new();
        let images = images
            .into_iter()
            .filter(|image| {
                let Some(start) = text.find(&image.placeholder) else {
                    return false;
                };
                elements.push(TextElement::new(
                    start..start + image.placeholder.len(),
                    previous_elements
                        .iter()
                        .find(|element| element.text == image.placeholder)
                        .map_or_else(
                            || Some(image.placeholder.clone()),
                            |element| element.placeholder.clone(),
                        ),
                ));
                true
            })
            .collect();
        let remote_images = self.remote_images().to_vec();
        let bindings = self.snapshot_mention_bindings();
        self.set_text_content_with_mention_bindings(
            text,
            elements,
            images,
            remote_images,
            bindings,
        );
        self.reset_history_navigation();
        self.vim_history = VimHistory::default();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn external_edit_preserves_reordered_owned_images_and_leaves_duplicates_literal() {
        let mut composer = ChatComposer::default();
        composer.attach_image(PathBuf::from("one.png"));
        composer.attach_image(PathBuf::from("two.png"));
        composer.handle_paste(&"界".repeat(1200));
        composer.apply_external_edit("界[Image #2] / [Image #2] / [Image #1]".into());
        assert_eq!(composer.text(), "界[Image #2] / [Image #2] / [Image #1]");
        assert_eq!(
            composer.textarea().text_elements(),
            vec![
                TextElement::new(3..13, Some("[Image #2]".into())),
                TextElement::new(29..39, Some("[Image #1]".into())),
            ]
        );
        assert_eq!(
            composer.local_image_paths(),
            vec![PathBuf::from("one.png"), PathBuf::from("two.png")]
        );
        assert!(composer.draft.pending_pastes.is_empty());
        assert_eq!(composer.cursor(), composer.text().len());
    }

    #[test]
    fn external_edit_drops_missing_images_and_renumbers_only_owned_occurrence() {
        let mut composer = ChatComposer::default();
        composer.set_remote_image_urls(vec!["https://example.test/remote.png".into()]);
        composer.attach_image(PathBuf::from("one.png"));
        composer.attach_image(PathBuf::from("two.png"));
        composer.apply_external_edit("Keep [Image #3] and literal [Image #3]".into());
        assert_eq!(composer.text(), "Keep [Image #2] and literal [Image #3]");
        assert_eq!(composer.local_image_paths(), vec![PathBuf::from("two.png")]);
        assert_eq!(
            composer.textarea().text_elements(),
            vec![TextElement::new(5..15, Some("[Image #2]".into()))]
        );
        composer.apply_external_edit("No images here".into());
        assert!(composer.local_image_paths().is_empty());
        assert!(composer.textarea().text_elements().is_empty());
        assert_eq!(composer.remote_image_urls().len(), 1);
    }
}
