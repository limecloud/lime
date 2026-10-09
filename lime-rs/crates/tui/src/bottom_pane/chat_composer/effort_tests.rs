use super::*;
use crate::terminal_palette::with_test_default_colors;
use crate::terminal_probe::DefaultColors;
use ratatui::{backend::TestBackend, Terminal};

fn with_palette(test: impl FnOnce()) {
    with_test_default_colors(
        DefaultColors {
            fg: (224, 220, 214),
            bg: (18, 22, 28),
        },
        test,
    );
}

fn render(composer: &ChatComposer) {
    let mut terminal = Terminal::new(TestBackend::new(44, 5)).unwrap();
    terminal
        .draw(|frame| composer.render(frame, frame.area(), crate::locale::Locale::EnUs))
        .unwrap();
}

#[test]
fn baseline_repeated_tier_downgrade_and_disabled_motion_do_not_replay() {
    with_palette(|| {
        let mut composer = ChatComposer::default();
        composer.set_active_reasoning_effort(Some("ultra"), true);
        assert!(composer.effort_ignition.is_none());
        composer.set_active_reasoning_effort(Some("ultra"), true);
        assert!(composer.effort_ignition.is_none());
        composer.set_active_reasoning_effort(Some("max"), true);
        let ignition = composer.effort_ignition.as_ref().unwrap() as *const _;
        let style = composer.effort_animation_style;
        composer.set_active_reasoning_effort(Some("max"), true);
        assert_eq!(
            composer.effort_ignition.as_ref().unwrap() as *const _,
            ignition
        );
        assert_eq!(composer.effort_animation_style, style);
        composer.set_active_reasoning_effort(Some("low"), true);
        assert!(composer.effort_ignition.is_none());
        assert!(composer.effort_status_line_transition.is_none());
        composer.set_active_reasoning_effort(Some("ultra"), false);
        assert!(composer.effort_ignition.is_none());
        assert_eq!(composer.effort_tier, Some(EffortTier::Ultra));
        composer.set_active_reasoning_effort(Some("max"), true);
        composer.set_active_reasoning_effort(Some("max"), false);
        assert!(composer.effort_ignition.is_none());
    });
}

#[test]
fn restored_baseline_cancels_pending_effects_and_preserves_the_rich_draft() {
    with_palette(|| {
        let mut composer = ChatComposer::default();
        composer.insert("keep draft");
        composer.attach_image(std::path::PathBuf::from("/tmp/image.png"));
        let before = composer.text().to_string();
        composer.set_active_reasoning_effort_baseline(Some("low"));
        *composer.footer.passive_status_line.borrow_mut() = Some(Line::from("model low"));
        composer.set_active_reasoning_effort(Some("ultra"), true);
        assert!(composer.effort_ignition.is_some());
        assert!(composer.effort_status_line_transition.is_some());
        composer.set_active_reasoning_effort_baseline(Some("ultra"));
        assert!(composer.effort_ignition.is_none());
        assert!(composer.effort_status_line_transition.is_none());
        assert!(composer.footer.passive_status_line.borrow().is_none());
        assert_eq!(composer.text(), before);
        assert_eq!(composer.local_images().len(), 1);
    });
}

#[test]
fn popup_delays_ignition_and_only_visible_frames_use_the_shared_requester() {
    with_palette(|| {
        let mut composer = ChatComposer::default();
        let (requester, mut frames) = FrameRequester::test_channel();
        composer.set_frame_requester(requester);
        composer.set_active_reasoning_effort_baseline(Some("low"));
        composer.replace("/".into());
        composer.sync_completion_popup();
        assert!(composer.popups.active());
        composer.set_active_reasoning_effort(Some("ultra"), true);
        assert!(frames.try_recv().is_ok());
        render(&composer);
        assert!(frames.try_recv().is_err());
        assert_eq!(
            composer.effort_ignition.as_ref().unwrap().charge_alpha(),
            0.0
        );
        composer.clear_completion_popup();
        render(&composer);
        assert!(frames.try_recv().is_ok());
        assert!(!composer.effort_ignition.as_ref().unwrap().is_finished());
        assert_eq!(composer.text(), "/");
    });
}

#[test]
fn only_a_visible_passive_footer_starts_the_status_transition() {
    with_palette(|| {
        let mut composer = ChatComposer::default();
        let (requester, mut frames) = FrameRequester::test_channel();
        composer.set_frame_requester(requester);
        composer.set_active_reasoning_effort_baseline(Some("low"));
        let app = crate::app::App::default();
        let mut props = app.chat_widget.footer_props(44, false, None, None);
        props.status_line_enabled = true;
        props.status_line_value = Some(Line::from("model low"));
        let mut terminal = Terminal::new(TestBackend::new(44, 1)).unwrap();
        terminal
            .draw(|frame| composer.render_footer(frame, frame.area(), &props))
            .unwrap();
        composer.set_active_reasoning_effort(Some("ultra"), true);
        assert!(frames.try_recv().is_ok());
        props.status_line_value = Some(Line::from("model ultra"));
        for hidden in [
            FooterMode::EscHint,
            FooterMode::HistorySearch,
            FooterMode::ShortcutOverlay,
        ] {
            props.mode = hidden;
            terminal
                .draw(|frame| composer.render_footer(frame, frame.area(), &props))
                .unwrap();
            assert!(frames.try_recv().is_err());
            assert!(!composer
                .effort_status_line_transition
                .as_ref()
                .unwrap()
                .is_finished());
        }
        props.mode = FooterMode::ComposerEmpty;
        props.interaction_hint_lines = Some(vec!["required action".into()]);
        terminal
            .draw(|frame| composer.render_footer(frame, frame.area(), &props))
            .unwrap();
        assert!(frames.try_recv().is_err());
        props.interaction_hint_lines = None;
        terminal
            .draw(|frame| composer.render_footer(frame, frame.area(), &props))
            .unwrap();
        let row = (0..44)
            .map(|x| terminal.backend().buffer()[(x, 0)].symbol())
            .collect::<String>();
        assert!(
            row.contains("model low"),
            "outgoing canonical presentation: {row}"
        );
        assert!(frames.try_recv().is_ok());
        assert_eq!(
            composer
                .footer
                .passive_status_line
                .borrow()
                .as_ref()
                .unwrap()
                .to_string(),
            "model ultra"
        );
    });
}
