//! Resolve text against its painted background before reducing it to the terminal palette.

use super::blend;
use crate::terminal_palette::{
    best_color_for_level, indexed_color, perceptual_distance, rgb_color, xterm_fixed_colors,
    StdoutColorLevel,
};
use ratatui::style::Color;
use std::cell::RefCell;
use std::collections::HashMap;

const MIN_TEXT_CONTRAST: f64 = 4.5;
const MAX_CACHED_FOREGROUNDS: usize = 512;

#[derive(Clone, Copy, Eq, Hash, PartialEq)]
struct ForegroundKey {
    preferred: (u8, u8, u8),
    background: Option<(u8, u8, u8)>,
    level: StdoutColorLevel,
}

thread_local! {
    // Surface and capability changes must not reuse a foreground from the previous palette.
    static FOREGROUNDS: RefCell<HashMap<ForegroundKey, Color>> = RefCell::default();
}

pub(super) fn foreground(
    preferred: (u8, u8, u8),
    background: Option<(u8, u8, u8)>,
    level: StdoutColorLevel,
) -> Color {
    FOREGROUNDS.with(|cache| {
        let key = ForegroundKey {
            preferred,
            background,
            level,
        };
        let mut cache = cache.borrow_mut();
        if let Some(color) = cache.get(&key) {
            return *color;
        }
        let color = match (background, level) {
            (None, _) => best_color_for_level(preferred, level),
            (Some(background), StdoutColorLevel::TrueColor) => {
                if ratio(preferred, background) >= MIN_TEXT_CONTRAST {
                    rgb_color(preferred)
                } else {
                    let black = (0, 0, 0);
                    let white = (255, 255, 255);
                    let endpoint = if ratio(black, background) >= ratio(white, background) {
                        black
                    } else {
                        white
                    };
                    (1..=255)
                        .map(|step| blend(endpoint, preferred, step as f32 / 255.0))
                        .find(|candidate| ratio(*candidate, background) >= MIN_TEXT_CONTRAST)
                        .map_or_else(|| rgb_color(endpoint), rgb_color)
                }
            }
            (Some(background), StdoutColorLevel::Ansi256) => xterm_fixed_colors()
                .filter(|(_, color)| ratio(*color, background) >= MIN_TEXT_CONTRAST)
                .min_by(|(_, a), (_, b)| {
                    perceptual_distance(*a, preferred)
                        .total_cmp(&perceptual_distance(*b, preferred))
                })
                .map_or(Color::Reset, |(index, _)| indexed_color(index)),
            (Some(_), StdoutColorLevel::Ansi16 | StdoutColorLevel::Unknown) => Color::Reset,
        };
        if cache.len() >= MAX_CACHED_FOREGROUNDS {
            cache.clear();
        }
        cache.insert(key, color);
        color
    })
}

pub(crate) fn ratio(a: (u8, u8, u8), b: (u8, u8, u8)) -> f64 {
    let a = luminance(a);
    let b = luminance(b);
    (a.max(b) + 0.05) / (a.min(b) + 0.05)
}

fn luminance(rgb: (u8, u8, u8)) -> f64 {
    let [r, g, b] = [rgb.0, rgb.1, rgb.2].map(|channel| {
        let value = f64::from(channel) / 255.0;
        if value <= 0.04045 {
            value / 12.92
        } else {
            ((value + 0.055) / 1.055).powf(2.4)
        }
    });
    0.2126 * r + 0.7152 * g + 0.0722 * b
}

#[cfg(test)]
#[path = "contrast_tests.rs"]
mod tests;
