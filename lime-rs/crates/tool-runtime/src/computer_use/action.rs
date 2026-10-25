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
    NameSession {
        name: String,
    },
    CreateTab {
        url: String,
    },
    MarkTab {
        tab_id: u32,
        mark: TabMark,
    },
    WorkbookRead {},
    RangeRead {
        sheet: String,
        address: String,
    },
    RangeWrite {
        sheet: String,
        address: String,
        values: Vec<Vec<serde_json::Value>>,
    },
    FormulaWrite {
        sheet: String,
        address: String,
        formulas: Vec<Vec<String>>,
    },
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
pub enum TabMark {
    Deliverable,
    Handoff,
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
            Self::NameSession { .. } | Self::CreateTab { .. } | Self::MarkTab { .. } => {
                ComputerUseCapability::Navigate
            }
            Self::WorkbookRead {} => ComputerUseCapability::WorkbookRead,
            Self::RangeRead { .. } => ComputerUseCapability::RangeRead,
            Self::RangeWrite { .. } => ComputerUseCapability::RangeWrite,
            Self::FormulaWrite { .. } => ComputerUseCapability::FormulaWrite,
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
            Self::NameSession { name } => {
                !name.trim().is_empty() && name.chars().count() <= 100 && !name.contains('\0')
            }
            Self::CreateTab { url } => {
                url.len() <= 8192
                    && url::Url::parse(url).is_ok_and(|url| {
                        matches!(url.scheme(), "http" | "https")
                            && url.host_str().is_some()
                            && url.username().is_empty()
                            && url.password().is_none()
                    })
            }
            Self::MarkTab { tab_id, .. } => *tab_id > 0 && *tab_id <= i32::MAX as u32,
            Self::WorkbookRead {} => true,
            Self::RangeRead { sheet, address } => valid_range(sheet, address),
            Self::RangeWrite {
                sheet,
                address,
                values,
            } => {
                valid_range(sheet, address)
                    && valid_matrix(values)
                    && values.iter().flatten().all(|v| match v {
                        serde_json::Value::Null
                        | serde_json::Value::Bool(_)
                        | serde_json::Value::Number(_) => true,
                        serde_json::Value::String(s) => s.len() <= 8192 && !s.starts_with('='),
                        _ => false,
                    })
            }
            Self::FormulaWrite {
                sheet,
                address,
                formulas,
            } => {
                valid_range(sheet, address)
                    && valid_matrix(formulas)
                    && formulas
                        .iter()
                        .flatten()
                        .all(|s| s.len() <= 8192 && s.starts_with('='))
            }
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

fn valid_range(sheet: &str, address: &str) -> bool {
    !sheet.is_empty()
        && sheet.len() <= 128
        && !sheet.contains('\0')
        && address.len() <= 32
        && regex::Regex::new(r"^[A-Z]{1,3}[1-9][0-9]{0,6}(:[A-Z]{1,3}[1-9][0-9]{0,6})?$")
            .unwrap()
            .is_match(address)
}
fn valid_matrix<T: Serialize>(values: &[Vec<T>]) -> bool {
    !values.is_empty()
        && !values[0].is_empty()
        && values.len().saturating_mul(values[0].len()) <= 1000
        && values.iter().all(|row| row.len() == values[0].len())
        && serde_json::to_vec(values).is_ok_and(|v| v.len() <= 256 * 1024)
}
