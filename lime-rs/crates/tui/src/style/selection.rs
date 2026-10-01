//! Codex selection fills retain readable contrast and conservative ANSI fallbacks.

use super::{blend, contrast::foreground, contrast::ratio, is_light};
use crate::terminal_palette::{
    best_color_for_level, color_rgb, default_bg, default_fg, effective_stdout_color_level,
    StdoutColorLevel,
};
use ratatui::style::{Color, Style};

pub(crate) fn selection_style() -> Style {
    selection_style_for(default_bg(), effective_stdout_color_level())
}

pub(super) fn selection_style_for(
    background: Option<(u8, u8, u8)>,
    level: StdoutColorLevel,
) -> Style {
    let fallback = Style::default()
        .fg(Color::Reset)
        .bg(Color::Reset)
        .bold()
        .not_dim()
        .reversed();
    let Some(background) = background else {
        return fallback;
    };
    let (preferred, alternate) = if is_light(background) {
        ((164, 205, 251), (99, 168, 248))
    } else {
        ((99, 168, 248), (164, 205, 251))
    };
    let mut fill = best_color_for_level(preferred, level);
    let Some(mut fill_rgb) = color_rgb(fill) else {
        return fallback;
    };
    if ratio(fill_rgb, background) < 1.25 {
        let alternate = best_color_for_level(alternate, level);
        if let Some(alternate_rgb) =
            color_rgb(alternate).filter(|rgb| ratio(*rgb, background) > ratio(fill_rgb, background))
        {
            fill = alternate;
            fill_rgb = alternate_rgb;
        }
    }
    Style::default()
        .fg(foreground((0, 0, 46), Some(fill_rgb), level))
        .bg(fill)
        .bold()
        .not_dim()
        .not_reversed()
}

pub(crate) fn active_tab_style() -> Style {
    let fallback = Style::default()
        .fg(Color::Reset)
        .bg(Color::Reset)
        .bold()
        .not_dim()
        .underlined();
    let Some(background) = default_bg() else {
        return fallback;
    };
    let level = effective_stdout_color_level();
    let fill = best_color_for_level(
        if is_light(background) {
            (220, 220, 220)
        } else {
            (76, 76, 76)
        },
        level,
    );
    let Some(rgb) = color_rgb(fill) else {
        return fallback;
    };
    let fg = default_fg().map_or(Color::Reset, |fg| foreground(fg, Some(rgb), level));
    Style::default()
        .fg(fg)
        .bg(fill)
        .bold()
        .not_dim()
        .not_underlined()
}

pub(crate) fn key_hint_style() -> Style {
    let preferred = default_fg().map(|fg| match default_bg() {
        Some(bg) if is_light(bg) => blend(fg, bg, 0.85),
        _ => fg,
    });
    let level = effective_stdout_color_level();
    let foreground = preferred.map_or(Color::Reset, |fg| foreground(fg, default_bg(), level));
    Style::default().fg(foreground).bold().not_dim()
}

#[cfg(test)]
mod tests {
    use super::*;
    use ratatui::style::Modifier;

    #[test]
    fn selection_fill_matches_codex_and_escapes_a_similar_canvas() {
        for (background, expected) in [
            ((255, 255, 255), (164, 205, 251)),
            ((0, 0, 0), (99, 168, 248)),
            ((99, 168, 248), (164, 205, 251)),
        ] {
            let style = selection_style_for(Some(background), StdoutColorLevel::TrueColor);
            assert_eq!(color_rgb(style.bg.unwrap()), Some(expected));
            assert!(ratio(color_rgb(style.fg.unwrap()).unwrap(), expected) >= 4.5);
        }
    }

    #[test]
    fn selection_without_resolvable_colors_uses_terminal_reverse_video() {
        for (background, level) in [
            (None, StdoutColorLevel::TrueColor),
            (Some((0, 0, 0)), StdoutColorLevel::Ansi16),
            (Some((255, 255, 255)), StdoutColorLevel::Unknown),
        ] {
            let style = selection_style_for(background, level);
            assert!(style.add_modifier.contains(Modifier::REVERSED));
            assert_eq!(style.fg, Some(Color::Reset));
            assert_eq!(style.bg, Some(Color::Reset));
        }
    }

    #[test]
    fn active_tab_preserves_readable_terminal_foreground() {
        let style = crate::terminal_palette::with_test_default_colors(
            crate::terminal_probe::DefaultColors {
                fg: (0, 0, 46),
                bg: (255, 255, 255),
            },
            active_tab_style,
        );
        assert_eq!(color_rgb(style.fg.unwrap()), Some((0, 0, 46)));
        assert_eq!(color_rgb(style.bg.unwrap()), Some((220, 220, 220)));
        for level in [StdoutColorLevel::TrueColor, StdoutColorLevel::Ansi256] {
            let foreground = foreground((76, 76, 76), Some((76, 76, 76)), level);
            assert!(ratio(color_rgb(foreground).unwrap(), (76, 76, 76)) >= 4.5);
        }
    }
}
