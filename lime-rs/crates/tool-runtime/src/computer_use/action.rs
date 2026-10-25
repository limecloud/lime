//! Internal tool-to-adapter actions. Lease, owner, fence and consent never come from arguments.

use super::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "action", rename_all = "snake_case", deny_unknown_fields)]
pub enum ComputerUseAction {
    Observe {
        max_depth: u8,
        max_nodes: u16,
    },
    Screenshot {},
    Click {
        x: f64,
        y: f64,
        button: MouseButton,
        count: u8,
    },
    Type {
        text: String,
    },
    Key {
        key: String,
        modifiers: Vec<String>,
    },
    Scroll {
        x: f64,
        y: f64,
        delta_x: i32,
        delta_y: i32,
    },
    Drag {
        x: f64,
        y: f64,
        to_x: f64,
        to_y: f64,
        duration_ms: u16,
    },
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MouseButton {
    Left,
    Right,
    Middle,
}

impl ComputerUseAction {
    pub fn capability(&self) -> ComputerUseCapability {
        match self {
            Self::Observe { .. } => ComputerUseCapability::Observe,
            Self::Screenshot {} => ComputerUseCapability::Screenshot,
            Self::Click { .. } => ComputerUseCapability::Click,
            Self::Type { .. } => ComputerUseCapability::Type,
            Self::Key { .. } => ComputerUseCapability::Key,
            Self::Scroll { .. } => ComputerUseCapability::Scroll,
            Self::Drag { .. } => ComputerUseCapability::Drag,
        }
    }

    pub(super) fn validate(&self) -> ComputerUseResult<()> {
        let point = |x: f64, y: f64| {
            x.is_finite() && y.is_finite() && x.abs() < 100_000.0 && y.abs() < 100_000.0
        };
        let valid = match self {
            Self::Observe {
                max_depth,
                max_nodes,
            } => (1..=8).contains(max_depth) && (1..=512).contains(max_nodes),
            Self::Screenshot {} => true,
            Self::Click { x, y, count, .. } => point(*x, *y) && (1..=2).contains(count),
            Self::Type { text } => {
                !text.is_empty() && text.encode_utf16().count() <= 2048 && !text.contains('\0')
            }
            Self::Key { key, modifiers } => {
                !key.is_empty()
                    && key.len() <= 32
                    && modifiers.len() <= 4
                    && modifiers
                        .iter()
                        .all(|m| ["command", "control", "option", "shift"].contains(&m.as_str()))
            }
            Self::Scroll {
                x,
                y,
                delta_x,
                delta_y,
            } => point(*x, *y) && delta_x.abs_diff(0) <= 10_000 && delta_y.abs_diff(0) <= 10_000,
            Self::Drag {
                x,
                y,
                to_x,
                to_y,
                duration_ms,
            } => point(*x, *y) && point(*to_x, *to_y) && (50..=2000).contains(duration_ms),
        };
        if valid {
            Ok(())
        } else {
            Err(denied("Computer Use action exceeds its allowed bounds"))
        }
    }
}
