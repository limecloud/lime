use super::*;
use crate::bottom_pane::command_popup::CommandPopup;

#[test]
fn popup_state_has_single_active_command_popup() {
    let mut state = PopupState {
        active: ActivePopup::Command(CommandPopup::for_composer("/").expect("popup")),
        ..PopupState::default()
    };

    assert!(state.active());
    assert!(state.active.as_command_mut().is_some());

    state.dismiss_command("/model");
    assert!(!state.active());
    assert_eq!(state.dismissed_command_token.as_deref(), Some("/model"));
}

#[test]
fn clearing_dismissal_does_not_reopen_popup_by_itself() {
    let mut state = PopupState::default();
    state.dismiss_command("/status");
    state.clear_dismissal();

    assert!(!state.active());
    assert!(state.dismissed_command_token.is_none());
}

#[test]
fn dismissed_file_tokens_are_scoped_to_their_occurrence() {
    let text = "@same  @same";
    let first_end = "@same".len();
    let second_start = text.rfind("@same").expect("second token");
    let first = DismissedToken::new(text, 0..first_end, "same".to_string());

    assert!(first.matches(text, &(0..first_end), "same"));
    assert!(!first.matches(text, &(second_start..text.len()), "same"));
}
