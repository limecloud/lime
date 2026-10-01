//! Codex diff surfaces: full row fill, independent gutter/sign, readable syntax text.

use super::DiffLineKind;
use crate::style::{is_light, readable_color_on};
use crate::terminal_palette::{
    default_colors, effective_stdout_color_level, indexed_color, rgb_color, DefaultColors,
    StdoutColorLevel,
};
use ratatui::style::{Color, Modifier, Style};

#[derive(Clone, Copy)]
pub(super) struct DiffRenderStyleContext {
    colors: Option<DefaultColors>,
    level: StdoutColorLevel,
}

/// Sample the terminal palette once per render pass, never once per span.
pub(super) fn current_diff_render_style_context() -> DiffRenderStyleContext {
    DiffRenderStyleContext::new(default_colors(), effective_stdout_color_level())
}

impl DiffRenderStyleContext {
    pub(super) fn new(colors: Option<DefaultColors>, level: StdoutColorLevel) -> Self {
        Self { colors, level }
    }

    fn light(self) -> bool {
        self.colors.is_some_and(|colors| is_light(colors.bg))
    }

    fn rich_color(self, rgb: (u8, u8, u8), index: u8) -> Option<Color> {
        match self.level {
            StdoutColorLevel::TrueColor => Some(rgb_color(rgb)),
            StdoutColorLevel::Ansi256 => Some(indexed_color(index)),
            StdoutColorLevel::Ansi16 | StdoutColorLevel::Unknown => None,
        }
    }

    pub(super) fn line(self, kind: DiffLineKind) -> Style {
        let background = match (self.light(), kind) {
            (false, DiffLineKind::Insert) => self.rich_color((33, 58, 43), 22),
            (false, DiffLineKind::Delete) => self.rich_color((74, 34, 29), 52),
            (true, DiffLineKind::Insert) => self.rich_color((218, 251, 225), 194),
            (true, DiffLineKind::Delete) => self.rich_color((255, 235, 233), 224),
            _ => None,
        };
        background.map_or_else(Style::default, |color| Style::default().bg(color))
    }

    pub(super) fn content(self, kind: DiffLineKind) -> Style {
        match kind {
            DiffLineKind::FileHeader => Style::default().fg(Color::Blue).bold(),
            DiffLineKind::Hunk => Style::default().fg(Color::Cyan).bold(),
            DiffLineKind::Metadata => Style::default().fg(Color::DarkGray),
            DiffLineKind::Insert | DiffLineKind::Delete => {
                let fill = self.line(kind);
                if self.light() && fill.bg.is_some() {
                    fill
                } else {
                    fill.fg(if kind == DiffLineKind::Insert {
                        Color::Green
                    } else {
                        Color::Red
                    })
                }
            }
            DiffLineKind::Context | DiffLineKind::Plain => Style::default(),
        }
    }

    pub(super) fn sign(self, kind: DiffLineKind) -> Style {
        if self.light() {
            match kind {
                DiffLineKind::Insert => return Style::default().fg(Color::Green),
                DiffLineKind::Delete => return Style::default().fg(Color::Red),
                _ => {}
            }
        }
        self.content(kind)
    }

    pub(super) fn gutter(self, kind: DiffLineKind) -> Style {
        if self.light() && matches!(kind, DiffLineKind::Insert | DiffLineKind::Delete) {
            let foreground = match self.level {
                StdoutColorLevel::TrueColor => rgb_color((31, 35, 40)),
                StdoutColorLevel::Ansi256 => indexed_color(236),
                StdoutColorLevel::Ansi16 | StdoutColorLevel::Unknown => Color::Black,
            };
            let background = match kind {
                DiffLineKind::Insert => self.rich_color((172, 238, 187), 157),
                _ => self.rich_color((255, 206, 203), 217),
            };
            let mut style = Style::default().fg(foreground);
            style.bg = background;
            style
        } else {
            Style::default().dim()
        }
    }

    pub(super) fn readable(self, style: Style, kind: DiffLineKind) -> Style {
        style
            .fg(readable_color_on(
                style.fg.unwrap_or(Color::Reset),
                self.line(kind).bg,
                self.colors,
                self.level,
            ))
            .remove_modifier(Modifier::DIM)
    }
}
