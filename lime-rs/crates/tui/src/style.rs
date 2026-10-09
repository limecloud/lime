//! Semantic styles shared by Lime TUI surfaces.

mod contrast;
#[cfg(test)]
pub(crate) use contrast::ratio as text_contrast_ratio;
mod selection;
pub(crate) use selection::{active_tab_style, key_hint_style, selection_style};

use ratatui::style::{Color, Style};

use crate::terminal_palette::{
    best_color_for_level, color_rgb, default_bg, default_fg, effective_stdout_color_level,
    rgb_color, stdout_color_level, DefaultColors, StdoutColorLevel,
};

const LIGHT_BG_ACCENT_RGB: (u8, u8, u8) = (28, 100, 200);
const UI_ACCENT: (u8, u8, u8) = (99, 168, 248);
const TABLE_SEPARATOR_FG_ALPHA: f32 = 0.20;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum StatusTone {
    Success,
    Attention,
    Failure,
}

pub(crate) fn status_style(tone: StatusTone) -> Style {
    status_style_for(tone, default_bg(), effective_stdout_color_level())
}

pub(crate) fn attention_style() -> Style {
    status_style(StatusTone::Attention)
}

pub(crate) fn failure_style() -> Style {
    status_style(StatusTone::Failure)
}

pub(crate) fn accent_style() -> Style {
    accent_style_for(default_bg(), effective_stdout_color_level())
}

pub(crate) fn muted_style() -> Style {
    Style::default().dim()
}

pub(crate) fn user_message_style() -> Style {
    user_message_style_for(default_bg(), effective_stdout_color_level())
}

/// Sticky transcript prompts use a slightly stronger fill than ordinary submitted messages.
pub(crate) fn history_prompt_style() -> Style {
    let Some(background) = default_bg() else {
        return Style::default();
    };
    if matches!(
        effective_stdout_color_level(),
        StdoutColorLevel::Ansi16 | StdoutColorLevel::Unknown
    ) {
        return Style::default();
    }
    let (foreground, alpha) = if is_light(background) {
        ((0, 0, 0), 0.02)
    } else {
        ((255, 255, 255), 0.16)
    };
    Style::default().bg(best_color_for_level(
        blend(foreground, background, alpha),
        effective_stdout_color_level(),
    ))
}

pub(crate) fn table_separator_style() -> Style {
    table_separator_style_for(default_fg(), default_bg(), stdout_color_level())
}

pub(crate) fn footer_hint_label_style() -> Style {
    secondary_text_style_for(default_fg(), default_bg(), effective_stdout_color_level())
}

/// Attachment emphasis uses the actual filled input surface, including indexed-color reduction.
pub(crate) fn user_message_accent_color() -> Color {
    user_message_accent_color_for(default_bg(), effective_stdout_color_level())
}

fn user_message_accent_color_for(
    background: Option<(u8, u8, u8)>,
    level: StdoutColorLevel,
) -> Color {
    let preferred = accent_rgb(background);
    let surface =
        background.and_then(|bg| color_rgb(best_color_for_level(user_message_bg_rgb(bg), level)));
    contrast::foreground(preferred, surface, level)
}

fn status_style_for(
    tone: StatusTone,
    terminal_bg: Option<(u8, u8, u8)>,
    color_level: StdoutColorLevel,
) -> Style {
    let light = terminal_bg.is_some_and(is_light);
    let foreground = match (tone, color_level) {
        (_, StdoutColorLevel::Unknown) => Color::Reset,
        (StatusTone::Success, _) => Color::Green,
        (StatusTone::Failure, _) => Color::Red,
        (StatusTone::Attention, _) if light || terminal_bg.is_none() => Color::Reset,
        (StatusTone::Attention, _) => Color::Yellow,
    };
    Style::default().fg(foreground).bold()
}

fn accent_style_for(terminal_bg: Option<(u8, u8, u8)>, color_level: StdoutColorLevel) -> Style {
    Style::default()
        .fg(contrast::foreground(
            accent_rgb(terminal_bg),
            terminal_bg,
            color_level,
        ))
        .bold()
}

fn accent_rgb(terminal_bg: Option<(u8, u8, u8)>) -> (u8, u8, u8) {
    if terminal_bg.is_some_and(is_light) {
        LIGHT_BG_ACCENT_RGB
    } else {
        UI_ACCENT
    }
}

fn user_message_style_for(
    terminal_bg: Option<(u8, u8, u8)>,
    color_level: StdoutColorLevel,
) -> Style {
    let Some(background) = terminal_bg else {
        return Style::default();
    };
    if matches!(
        color_level,
        StdoutColorLevel::Ansi16 | StdoutColorLevel::Unknown
    ) {
        return Style::default();
    }
    Style::default().bg(best_color_for_level(
        user_message_bg_rgb(background),
        color_level,
    ))
}

fn table_separator_style_for(
    terminal_fg: Option<(u8, u8, u8)>,
    terminal_bg: Option<(u8, u8, u8)>,
    color_level: StdoutColorLevel,
) -> Style {
    let (Some(foreground), Some(background)) = (terminal_fg, terminal_bg) else {
        return muted_style();
    };
    let separator = blend(foreground, background, TABLE_SEPARATOR_FG_ALPHA);
    match color_level {
        StdoutColorLevel::TrueColor => Style::default().fg(rgb_color(separator)),
        StdoutColorLevel::Ansi256 => {
            Style::default().fg(best_color_for_level(separator, color_level))
        }
        StdoutColorLevel::Ansi16 | StdoutColorLevel::Unknown => muted_style(),
    }
}

fn secondary_text_style_for(
    terminal_fg: Option<(u8, u8, u8)>,
    terminal_bg: Option<(u8, u8, u8)>,
    color_level: StdoutColorLevel,
) -> Style {
    let preferred = terminal_fg
        .zip(terminal_bg)
        .map(|(fg, bg)| blend(fg, bg, 0.6));
    // Without a background sample keep the measured foreground, never invent a terminal palette.
    let foreground = preferred.or(terminal_fg).map_or(Color::Reset, |fg| {
        contrast::foreground(fg, terminal_bg, color_level)
    });
    Style::default().fg(foreground).not_dim().not_bold()
}

pub(crate) fn user_message_bg_rgb(background: (u8, u8, u8)) -> (u8, u8, u8) {
    let (foreground, alpha) = if is_light(background) {
        ((0, 0, 0), 0.04)
    } else {
        ((255, 255, 255), 0.12)
    };
    blend(foreground, background, alpha)
}

/// Resolve known text colors against the painted surface using one terminal snapshot.
/// ANSI colors remain terminal-owned; their configured RGB values are not guessed.
pub(crate) fn readable_color_on(
    preferred: Color,
    background: Option<Color>,
    colors: Option<DefaultColors>,
    level: StdoutColorLevel,
) -> Color {
    let preferred = match preferred {
        Color::Reset => colors.map(|colors| colors.fg),
        color => match color_rgb(color) {
            Some(rgb) => Some(rgb),
            None => return color,
        },
    };
    let background = match background {
        None | Some(Color::Reset) => colors.map(|colors| colors.bg),
        Some(color) => color_rgb(color),
    };
    preferred.map_or(Color::Reset, |rgb| {
        contrast::foreground(rgb, background, level)
    })
}

pub(crate) fn is_light((red, green, blue): (u8, u8, u8)) -> bool {
    let luminance = 0.299 * f32::from(red) + 0.587 * f32::from(green) + 0.114 * f32::from(blue);
    luminance > 128.0
}

pub(crate) fn blend(
    foreground: (u8, u8, u8),
    background: (u8, u8, u8),
    alpha: f32,
) -> (u8, u8, u8) {
    let channel = |foreground: u8, background: u8| {
        (f32::from(foreground) * alpha + f32::from(background) * (1.0 - alpha)) as u8
    };
    (
        channel(foreground.0, background.0),
        channel(foreground.1, background.1),
        channel(foreground.2, background.2),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use ratatui::style::Modifier;

    #[test]
    fn status_tones_preserve_light_dark_and_no_color_semantics() {
        assert_eq!(
            status_style_for(
                StatusTone::Attention,
                Some((0, 0, 0)),
                StdoutColorLevel::Ansi16,
            )
            .fg,
            Some(Color::Yellow),
        );
        assert_eq!(
            status_style_for(
                StatusTone::Attention,
                Some((255, 255, 255)),
                StdoutColorLevel::TrueColor,
            )
            .fg,
            Some(Color::Reset),
        );
        for tone in [
            StatusTone::Success,
            StatusTone::Attention,
            StatusTone::Failure,
        ] {
            let style = status_style_for(tone, Some((0, 0, 0)), StdoutColorLevel::Unknown);
            assert_eq!(style.fg, Some(Color::Reset));
            assert!(style.add_modifier.contains(Modifier::BOLD));
        }
    }

    #[test]
    fn accent_is_palette_aware_and_has_a_no_color_fallback() {
        assert_eq!(
            accent_style_for(Some((0, 0, 0)), StdoutColorLevel::Ansi16).fg,
            Some(Color::Reset),
        );
        assert!(matches!(
            accent_style_for(Some((255, 255, 255)), StdoutColorLevel::TrueColor).fg,
            Some(Color::Rgb(28, 100, 200)),
        ));
        assert_eq!(
            accent_style_for(Some((0, 0, 0)), StdoutColorLevel::Unknown).fg,
            Some(Color::Reset),
        );
        assert_eq!(
            accent_style_for(Some((0, 0, 0)), StdoutColorLevel::TrueColor).fg,
            Some(Color::Rgb(99, 168, 248)),
        );
    }

    #[test]
    fn user_message_surface_adapts_to_dark_light_and_no_color() {
        assert_eq!(
            user_message_style_for(Some((0, 0, 0)), StdoutColorLevel::TrueColor).bg,
            Some(Color::Rgb(30, 30, 30)),
        );
        assert_eq!(
            user_message_style_for(Some((255, 255, 255)), StdoutColorLevel::TrueColor).bg,
            Some(Color::Rgb(244, 244, 244)),
        );
        assert_eq!(
            user_message_style_for(Some((0, 0, 0)), StdoutColorLevel::Unknown).bg,
            None,
        );
    }

    #[test]
    fn table_separator_blends_on_truecolor_and_dims_without_palette_support() {
        assert_eq!(
            table_separator_style_for(
                Some((255, 255, 255)),
                Some((0, 0, 0)),
                StdoutColorLevel::TrueColor,
            )
            .fg,
            Some(Color::Rgb(51, 51, 51)),
        );
        assert!(table_separator_style_for(
            Some((255, 255, 255)),
            Some((0, 0, 0)),
            StdoutColorLevel::Unknown,
        )
        .add_modifier
        .contains(Modifier::DIM),);
    }

    #[test]
    fn footer_styles_keep_labels_quiet_on_all_palettes() {
        assert_eq!(
            secondary_text_style_for(
                Some((0, 0, 0)),
                Some((255, 255, 255)),
                StdoutColorLevel::TrueColor,
            )
            .fg,
            Some(Color::Rgb(101, 101, 101)),
        );
        for level in [StdoutColorLevel::Ansi16, StdoutColorLevel::Unknown] {
            let style = secondary_text_style_for(Some((255, 255, 255)), Some((0, 0, 0)), level);
            assert_eq!(style.fg, Some(Color::Reset));
            assert!(!style
                .add_modifier
                .intersects(Modifier::DIM | Modifier::BOLD));
            assert!(style.sub_modifier.contains(Modifier::DIM | Modifier::BOLD));
        }
    }
}
