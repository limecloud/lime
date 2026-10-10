use super::*;
use pretty_assertions::assert_eq;

#[test]
fn input_record_mode_round_trips_all_console_flag_combinations() {
    for original_mode in 0..=u16::MAX as u32 {
        let original = if original_mode & ENABLE_VIRTUAL_TERMINAL_INPUT == 0 {
            VirtualTerminalInput::Disabled
        } else {
            VirtualTerminalInput::Enabled
        };
        let active = input_record_mode(original_mode);
        assert_eq!(active & ENABLE_VIRTUAL_TERMINAL_INPUT, 0);
        assert_eq!(restored_input_mode(active, original), original_mode);
        assert_eq!(input_record_mode(active), active);
    }
}

#[test]
fn restoring_enabled_vt_input_preserves_external_console_changes() {
    // An editor changed echo, line input, mouse and window-event flags during the handoff.
    for (current, expected) in [
        (0x0041, 0x0241),
        (0x0265, 0x0265),
        (0x8000_0098, 0x8000_0298),
    ] {
        assert_eq!(
            restored_input_mode(current, VirtualTerminalInput::Enabled),
            expected
        );
    }
}

#[test]
fn restoring_disabled_vt_input_preserves_external_console_changes() {
    for (current, expected) in [
        (0x0241, 0x0041),
        (0x0065, 0x0065),
        (0x8000_0298, 0x8000_0098),
    ] {
        assert_eq!(
            restored_input_mode(current, VirtualTerminalInput::Disabled),
            expected
        );
    }
}
