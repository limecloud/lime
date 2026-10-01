//! Assert contrast after palette reduction, not only for the requested RGB colors.

use super::*;
use crate::terminal_palette::color_rgb;
use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::{Modifier, Style};
use ratatui::text::Line;
use ratatui::widgets::Widget;

#[test]
fn informative_foregrounds_meet_contrast_on_light_dark_and_mid_tone_surfaces() {
    for background in [
        (255, 255, 255),
        (245, 240, 220),
        (130, 130, 130),
        (18, 20, 30),
    ] {
        for preferred in [
            (28, 100, 200),
            (99, 168, 248),
            (139, 98, 20),
            (196, 167, 103),
        ] {
            for level in [StdoutColorLevel::TrueColor, StdoutColorLevel::Ansi256] {
                let resolved = color_rgb(foreground(preferred, Some(background), level)).unwrap();
                assert!(
                    ratio(resolved, background) >= MIN_TEXT_CONTRAST,
                    "{preferred:?} resolved to {resolved:?} on {background:?}, {level:?}",
                );
            }
        }
    }
}

#[test]
fn truecolor_preserves_readable_hues_and_only_blends_until_the_first_readable_step() {
    let preferred = (28, 100, 200);
    let background = (255, 255, 255);
    assert_eq!(
        foreground(preferred, Some(background), StdoutColorLevel::TrueColor),
        rgb_color(preferred)
    );

    let background = (130, 130, 130);
    let endpoint = (0, 0, 0);
    let expected = (1..=255)
        .map(|step| blend(endpoint, preferred, step as f32 / 255.0))
        .find(|candidate| ratio(*candidate, background) >= MIN_TEXT_CONTRAST)
        .unwrap();
    assert_eq!(
        foreground(preferred, Some(background), StdoutColorLevel::TrueColor),
        rgb_color(expected)
    );
    assert_ne!(expected, endpoint);
}

#[test]
fn ansi256_retains_the_nearest_readable_hue_instead_of_jumping_to_black_or_white() {
    let preferred = (99, 168, 248);
    let background = (130, 130, 130);
    let color = foreground(preferred, Some(background), StdoutColorLevel::Ansi256);
    let rgb = color_rgb(color).unwrap();
    assert_ne!(rgb, (0, 0, 0));
    assert_ne!(rgb, (255, 255, 255));
    assert!(ratio(rgb, background) >= MIN_TEXT_CONTRAST);
    let distance = perceptual_distance(rgb, preferred);
    for (_, candidate) in
        xterm_fixed_colors().filter(|(_, rgb)| ratio(*rgb, background) >= MIN_TEXT_CONTRAST)
    {
        assert!(distance <= perceptual_distance(candidate, preferred));
    }
}

#[test]
fn absent_background_preserves_requested_color_and_terminal_owned_palettes_stay_default() {
    let preferred = (28, 100, 200);
    for level in [
        StdoutColorLevel::TrueColor,
        StdoutColorLevel::Ansi256,
        StdoutColorLevel::Ansi16,
        StdoutColorLevel::Unknown,
    ] {
        assert_eq!(
            foreground(preferred, None, level),
            best_color_for_level(preferred, level)
        );
        if matches!(level, StdoutColorLevel::Ansi16 | StdoutColorLevel::Unknown) {
            assert_eq!(foreground(preferred, Some((0, 0, 0)), level), Color::Reset);
        }
    }
}

#[test]
fn painted_selection_clears_inherited_dim_and_meets_contrast_after_conversion() {
    for background in [
        (255, 255, 255),
        (245, 240, 220),
        (130, 130, 130),
        (164, 205, 251),
        (132, 184, 248),
        (18, 20, 30),
    ] {
        for level in [StdoutColorLevel::TrueColor, StdoutColorLevel::Ansi256] {
            let area = Rect::new(0, 0, 8, 1);
            let mut buffer = Buffer::empty(area);
            buffer.set_style(area, Style::default().dim().reversed());
            Line::from("› resume")
                .style(super::super::selection::selection_style_for(
                    Some(background),
                    level,
                ))
                .render(area, &mut buffer);
            let cell = &buffer[(0, 0)];
            assert!(
                ratio(color_rgb(cell.fg).unwrap(), color_rgb(cell.bg).unwrap())
                    >= MIN_TEXT_CONTRAST
            );
            assert_eq!(cell.modifier, Modifier::BOLD);
        }
    }
}

#[test]
fn prompt_emphasis_uses_the_painted_not_unquantized_surface() {
    for background in [
        (255, 255, 255),
        (225, 220, 205),
        (130, 130, 130),
        (95, 95, 95),
        (18, 20, 30),
    ] {
        for level in [StdoutColorLevel::TrueColor, StdoutColorLevel::Ansi256] {
            let emphasis = super::super::user_message_accent_color_for(Some(background), level);
            let fill = best_color_for_level(super::super::user_message_bg_rgb(background), level);
            assert!(
                ratio(color_rgb(emphasis).unwrap(), color_rgb(fill).unwrap()) >= MIN_TEXT_CONTRAST
            );
        }
    }
}

#[test]
fn painted_secondary_labels_reset_inherited_modifiers_and_stay_readable() {
    for (fg, bg) in [
        ((0, 0, 0), (255, 255, 255)),
        ((255, 255, 255), (0, 0, 0)),
        ((150, 150, 150), (130, 130, 130)),
    ] {
        for level in [StdoutColorLevel::TrueColor, StdoutColorLevel::Ansi256] {
            let area = Rect::new(0, 0, 4, 1);
            let mut buffer = Buffer::empty(area);
            buffer.set_style(area, Style::default().bold().dim());
            Line::from("hint")
                .style(super::super::secondary_text_style_for(
                    Some(fg),
                    Some(bg),
                    level,
                ))
                .render(area, &mut buffer);
            let cell = &buffer[(0, 0)];
            assert_eq!(cell.modifier, Modifier::empty());
            assert!(ratio(color_rgb(cell.fg).unwrap(), bg) >= MIN_TEXT_CONTRAST);
        }
    }
}

#[test]
fn cache_tracks_surface_and_capability_changes_and_remains_bounded() {
    let preferred = (95, 175, 255);
    let backgrounds = [None, Some((24, 24, 24)), Some((245, 245, 245))];
    let levels = [
        StdoutColorLevel::TrueColor,
        StdoutColorLevel::Ansi256,
        StdoutColorLevel::Ansi16,
        StdoutColorLevel::Unknown,
    ];
    let expected =
        backgrounds.map(|background| levels.map(|level| foreground(preferred, background, level)));
    for index in 0..MAX_CACHED_FOREGROUNDS * 2 {
        foreground(
            (index as u8, (index / 256) as u8, 42),
            None,
            StdoutColorLevel::TrueColor,
        );
        assert_eq!(
            backgrounds
                .map(|background| levels.map(|level| foreground(preferred, background, level))),
            expected
        );
        FOREGROUNDS.with(|cache| assert!(cache.borrow().len() <= MAX_CACHED_FOREGROUNDS));
    }
    assert_ne!(expected[1][0], expected[2][0]);
}
