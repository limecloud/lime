//! Terminal color capability and palette helpers.
//!
//! The public names mirror Codex TUI. Startup foreground/background probes are
//! cached by the terminal lifecycle owner, while unsupported terminals fail
//! closed to conservative defaults. Color quantization remains deterministic
//! and safe for snapshot tests.

use ratatui::style::Color;

mod perceptual;
pub(crate) use perceptual::perceptual_distance;

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub(crate) enum StdoutColorLevel {
    TrueColor,
    Ansi256,
    Ansi16,
    Unknown,
}

#[allow(dead_code)]
pub(crate) fn stdout_color_level() -> StdoutColorLevel {
    stdout_color_level_for_env(
        std::env::var_os("NO_COLOR").is_some(),
        &std::env::var("COLORTERM").unwrap_or_default(),
        &std::env::var("TERM").unwrap_or_default(),
    )
}

fn stdout_color_level_for_env(no_color: bool, color_term: &str, term: &str) -> StdoutColorLevel {
    if no_color {
        return StdoutColorLevel::Unknown;
    }

    let color_term = color_term.to_ascii_lowercase();
    if matches!(color_term.as_str(), "truecolor" | "24bit") {
        return StdoutColorLevel::TrueColor;
    }

    let term = term.to_ascii_lowercase();
    if term.contains("direct") || term.contains("truecolor") {
        StdoutColorLevel::TrueColor
    } else if term.contains("256color") {
        StdoutColorLevel::Ansi256
    } else if term.is_empty() {
        StdoutColorLevel::Unknown
    } else {
        StdoutColorLevel::Ansi16
    }
}

#[allow(dead_code)]
pub(crate) fn effective_stdout_color_level() -> StdoutColorLevel {
    #[cfg(test)]
    if TEST_DEFAULT_COLORS.with(|colors| colors.get().is_some()) {
        return StdoutColorLevel::TrueColor;
    }

    stdout_color_level()
}

#[allow(clippy::disallowed_methods)]
pub(crate) fn rgb_color((red, green, blue): (u8, u8, u8)) -> Color {
    Color::Rgb(red, green, blue)
}

#[allow(clippy::disallowed_methods)]
pub(crate) fn indexed_color(index: u8) -> Color {
    Color::Indexed(index)
}

#[allow(dead_code)]
pub(crate) fn best_color(target: (u8, u8, u8)) -> Color {
    best_color_for_level(target, effective_stdout_color_level())
}

pub(crate) fn best_color_for_level(target: (u8, u8, u8), level: StdoutColorLevel) -> Color {
    best_color_for_color_level(target, level)
}

/// Resolve only known RGB and fixed xterm colors; user-defined ANSI colors stay unknown.
pub(crate) fn color_rgb(color: Color) -> Option<(u8, u8, u8)> {
    match color {
        Color::Rgb(r, g, b) => Some((r, g, b)),
        Color::Indexed(index) if index >= 16 => {
            xterm_fixed_colors().find_map(|(candidate, rgb)| (candidate == index).then_some(rgb))
        }
        _ => None,
    }
}

#[allow(dead_code)]
fn best_color_for_color_level(target: (u8, u8, u8), level: StdoutColorLevel) -> Color {
    match level {
        StdoutColorLevel::TrueColor => rgb_color(target),
        StdoutColorLevel::Ansi256 => xterm_fixed_colors()
            .min_by(|(_, a), (_, b)| {
                perceptual_distance(*a, target).total_cmp(&perceptual_distance(*b, target))
            })
            .map_or_else(Color::default, |(index, _)| indexed_color(index)),
        StdoutColorLevel::Ansi16 | StdoutColorLevel::Unknown => Color::default(),
    }
}

pub(crate) fn default_colors() -> Option<DefaultColors> {
    #[cfg(test)]
    if let Some(colors) = TEST_DEFAULT_COLORS.with(std::cell::Cell::get) {
        return Some(colors);
    }

    imp::default_colors()
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct DefaultColors {
    pub(crate) fg: (u8, u8, u8),
    pub(crate) bg: (u8, u8, u8),
}

#[cfg(test)]
thread_local! {
    static TEST_DEFAULT_COLORS: std::cell::Cell<Option<DefaultColors>> = const {
        std::cell::Cell::new(None)
    };
}

#[allow(dead_code)]
pub(crate) fn default_fg() -> Option<(u8, u8, u8)> {
    default_colors().map(|colors| colors.fg)
}

#[allow(dead_code)]
pub(crate) fn default_bg() -> Option<(u8, u8, u8)> {
    default_colors().map(|colors| colors.bg)
}

#[allow(dead_code)]
pub(crate) fn with_test_default_colors<T>(
    colors: crate::terminal_probe::DefaultColors,
    render: impl FnOnce() -> T,
) -> T {
    #[cfg(test)]
    return TEST_DEFAULT_COLORS.with(|override_colors| {
        let previous = override_colors.replace(Some(DefaultColors {
            fg: colors.fg,
            bg: colors.bg,
        }));
        let result = render();
        override_colors.set(previous);
        result
    });

    #[cfg(not(test))]
    {
        let _ = colors;
        render()
    }
}

#[allow(dead_code)]
pub(crate) fn set_default_colors_from_startup_probe(
    colors: Option<crate::terminal_probe::DefaultColors>,
) {
    imp::set_default_colors_from_startup_probe(colors);
}

#[cfg(all(unix, not(test)))]
mod imp {
    use super::DefaultColors;
    use std::sync::Mutex;
    use std::sync::OnceLock;

    #[derive(Default)]
    struct Cache {
        attempted: bool,
        value: Option<DefaultColors>,
    }

    fn default_colors_cache() -> &'static Mutex<Cache> {
        static CACHE: OnceLock<Mutex<Cache>> = OnceLock::new();
        CACHE.get_or_init(|| Mutex::new(Cache::default()))
    }

    pub(super) fn default_colors() -> Option<DefaultColors> {
        let cache = default_colors_cache();
        let mut cache = cache.lock().ok()?;
        if !cache.attempted {
            cache.value =
                crate::terminal_probe::default_colors(crate::terminal_probe::DEFAULT_TIMEOUT)
                    .ok()
                    .flatten()
                    .map(|colors| DefaultColors {
                        fg: colors.fg,
                        bg: colors.bg,
                    });
            cache.attempted = true;
        }
        cache.value
    }

    pub(super) fn set_default_colors_from_startup_probe(
        colors: Option<crate::terminal_probe::DefaultColors>,
    ) {
        if let Ok(mut cache) = default_colors_cache().lock() {
            cache.value = colors.map(|colors| DefaultColors {
                fg: colors.fg,
                bg: colors.bg,
            });
            cache.attempted = true;
        }
    }
}

#[cfg(windows)]
mod imp {
    use super::DefaultColors;
    use std::sync::Mutex;
    use std::sync::OnceLock;

    #[derive(Default)]
    struct Cache {
        attempted: bool,
        value: Option<DefaultColors>,
    }

    fn default_colors_cache() -> &'static Mutex<Cache> {
        static CACHE: OnceLock<Mutex<Cache>> = OnceLock::new();
        CACHE.get_or_init(|| Mutex::new(Cache::default()))
    }

    pub(super) fn default_colors() -> Option<DefaultColors> {
        let cache = default_colors_cache();
        let mut cache = cache.lock().ok()?;
        if !cache.attempted {
            cache.value =
                crate::terminal_probe::default_colors(crate::terminal_probe::DEFAULT_TIMEOUT)
                    .ok()
                    .flatten()
                    .map(|colors| DefaultColors {
                        fg: colors.fg,
                        bg: colors.bg,
                    });
            cache.attempted = true;
        }
        cache.value
    }

    pub(super) fn set_default_colors_from_startup_probe(
        colors: Option<crate::terminal_probe::DefaultColors>,
    ) {
        if let Ok(mut cache) = default_colors_cache().lock() {
            cache.value = colors.map(|colors| DefaultColors {
                fg: colors.fg,
                bg: colors.bg,
            });
            cache.attempted = true;
        }
    }
}

#[cfg(not(any(all(unix, not(test)), windows)))]
mod imp {
    use super::DefaultColors;

    pub(super) fn default_colors() -> Option<DefaultColors> {
        None
    }

    pub(super) fn set_default_colors_from_startup_probe(
        _colors: Option<crate::terminal_probe::DefaultColors>,
    ) {
    }
}

pub(crate) fn xterm_fixed_colors() -> impl Iterator<Item = (u8, (u8, u8, u8))> {
    let cube = (0..216).map(|offset| {
        let red = offset / 36;
        let green = (offset / 6) % 6;
        let blue = offset % 6;
        let level = |value: u8| if value == 0 { 0 } else { 55 + value * 40 };
        (16 + offset, (level(red), level(green), level(blue)))
    });
    let grayscale = (0..24).map(|offset| {
        let value = 8 + offset * 10;
        (232 + offset, (value, value, value))
    });
    cube.chain(grayscale)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn best_color_uses_truecolor_without_quantization() {
        assert_eq!(
            best_color_for_level((12, 34, 56), StdoutColorLevel::TrueColor),
            Color::Rgb(12, 34, 56)
        );
    }

    #[test]
    fn best_color_resets_for_ansi16() {
        assert_eq!(
            best_color_for_level((12, 34, 56), StdoutColorLevel::Ansi16),
            Color::Reset
        );
    }

    #[test]
    fn ansi256_palette_contains_cube_and_grayscale() {
        let colors = xterm_fixed_colors().collect::<Vec<_>>();
        assert_eq!(colors.len(), 240);
        assert_eq!(colors.first(), Some(&(16, (0, 0, 0))));
        assert_eq!(colors.last(), Some(&(255, (238, 238, 238))));
    }

    #[test]
    fn nearest_ansi256_color_is_indexed() {
        assert!(matches!(
            best_color_for_level((255, 0, 0), StdoutColorLevel::Ansi256),
            Color::Indexed(_)
        ));
    }

    #[test]
    fn default_color_queries_fail_closed_without_probe() {
        assert_eq!(default_colors(), None);
        assert_eq!(default_fg(), None);
        assert_eq!(default_bg(), None);
    }

    #[test]
    fn no_color_disables_semantic_colors_without_mutating_process_env() {
        assert_eq!(
            stdout_color_level_for_env(true, "truecolor", "xterm-256color"),
            StdoutColorLevel::Unknown,
        );
    }
}
