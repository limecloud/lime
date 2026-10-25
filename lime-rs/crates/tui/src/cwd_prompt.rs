//! Working-directory selection state shared by resume/fork flows.
//!
//! The interactive renderer and persisted `resume_cwd` preference are deferred until Lime has a
//! matching trust/config contract. Keeping this Lime-native state machine separate prevents the
//! eventual `/cd` implementation from adding another session owner.

use std::path::Path;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum CwdPromptAction {
    Resume,
    Fork,
}

impl CwdPromptAction {
    pub(crate) fn verb(self) -> &'static str {
        match self {
            Self::Resume => "resume",
            Self::Fork => "fork",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum CwdSelection {
    Current,
    Session,
    CurrentAndRemember,
    SessionAndRemember,
}

impl CwdSelection {
    pub(crate) fn next(self) -> Self {
        match self {
            Self::Session => Self::Current,
            Self::Current => Self::SessionAndRemember,
            Self::SessionAndRemember => Self::CurrentAndRemember,
            Self::CurrentAndRemember => Self::Session,
        }
    }

    pub(crate) fn prev(self) -> Self {
        match self {
            Self::Session => Self::CurrentAndRemember,
            Self::Current => Self::Session,
            Self::SessionAndRemember => Self::Current,
            Self::CurrentAndRemember => Self::SessionAndRemember,
        }
    }

    pub(crate) fn selected_cwd<'path>(
        self,
        current_cwd: &'path Path,
        session_cwd: &'path Path,
        remembered_current_cwd: &'path Path,
    ) -> &'path Path {
        match self {
            Self::Current => current_cwd,
            Self::CurrentAndRemember => remembered_current_cwd,
            Self::Session | Self::SessionAndRemember => session_cwd,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum CwdPromptOutcome {
    Selection(CwdSelection),
    Exit,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn cwd_prompt_selects_session_by_default() {
        assert_eq!(CwdSelection::Session.next(), CwdSelection::Current);
    }

    #[test]
    fn cwd_prompt_can_select_current() {
        assert_eq!(
            CwdSelection::Current.selected_cwd(
                Path::new("/current"),
                Path::new("/session"),
                Path::new("/remembered"),
            ),
            Path::new("/current")
        );
    }

    #[test]
    fn cwd_prompt_remembered_choices_select_matching_directory() {
        assert_eq!(
            CwdSelection::CurrentAndRemember.selected_cwd(
                Path::new("/current"),
                Path::new("/session"),
                Path::new("/remembered"),
            ),
            Path::new("/remembered")
        );
        assert_eq!(
            CwdSelection::SessionAndRemember.selected_cwd(
                Path::new("/current"),
                Path::new("/session"),
                Path::new("/remembered"),
            ),
            Path::new("/session")
        );
    }

    #[test]
    fn cwd_prompt_navigation_wraps_in_codex_order() {
        assert_eq!(
            CwdSelection::Session.prev(),
            CwdSelection::CurrentAndRemember
        );
        assert_eq!(
            CwdSelection::CurrentAndRemember.next(),
            CwdSelection::Session
        );
    }
}
