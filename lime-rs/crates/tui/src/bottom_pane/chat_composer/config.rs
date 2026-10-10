//! Shared input behavior; embedded notes use the same editor without command or image UI.

#[derive(Clone, Copy, Debug)]
pub(crate) struct ChatComposerConfig {
    pub(crate) popups_enabled: bool,
    pub(crate) slash_commands_enabled: bool,
    pub(crate) image_paste_enabled: bool,
    pub(crate) blockquote_paste_enabled: bool,
}

impl Default for ChatComposerConfig {
    fn default() -> Self {
        Self {
            popups_enabled: true,
            slash_commands_enabled: true,
            image_paste_enabled: true,
            blockquote_paste_enabled: true,
        }
    }
}

impl ChatComposerConfig {
    pub(crate) const fn plain_text() -> Self {
        Self {
            popups_enabled: false,
            slash_commands_enabled: false,
            image_paste_enabled: false,
            blockquote_paste_enabled: true,
        }
    }
}
