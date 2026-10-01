//! TUI 键位配置 schema 与规范化规则。
//!
//! 本模块只暴露 Lime 当前已有真实消费者的 context/action。新增字段前必须先完成运行时接线，
//! 避免出现“配置可写但不生效”的伪合同。

use serde::de::Error as SerdeError;
use serde::{Deserialize, Deserializer, Serialize};
use std::collections::BTreeMap;

mod vim;
pub use vim::{
    TuiVimNormalKeymap, TuiVimOperatorKeymap, TuiVimSearchKeymap, TuiVimTextObjectKeymap,
};

/// 可移植 TUI 配置支持的最高功能键。
pub const MAX_FUNCTION_KEY: u8 = 24;

const MAX_KEY_CHORD_STROKES: usize = 2;

/// 一个规范化后的按键或两段 chord。
#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
#[serde(transparent)]
pub struct KeybindingSpec(pub String);

impl KeybindingSpec {
    pub fn as_str(&self) -> &str {
        self.0.as_str()
    }
}

impl<'de> Deserialize<'de> for KeybindingSpec {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let raw = String::deserialize(deserializer)?;
        normalize_keybinding_spec(&raw)
            .map(Self)
            .map_err(SerdeError::custom)
    }
}

/// 一个 action 的单项绑定或有序 alternatives；空数组表示显式 unbind。
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(untagged)]
pub enum KeybindingsSpec {
    One(KeybindingSpec),
    Many(Vec<KeybindingSpec>),
}

impl KeybindingsSpec {
    pub fn specs(&self) -> Vec<&KeybindingSpec> {
        match self {
            Self::One(spec) => vec![spec],
            Self::Many(specs) => specs.iter().collect(),
        }
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq, Default)]
#[serde(default, deny_unknown_fields)]
pub struct TuiGlobalKeymap {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub open_agents: Option<KeybindingsSpec>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub open_transcript: Option<KeybindingsSpec>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub find_transcript: Option<KeybindingsSpec>,
}

impl TuiGlobalKeymap {
    fn is_default(&self) -> bool {
        self == &Self::default()
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq, Default)]
#[serde(default, deny_unknown_fields)]
pub struct TuiPagerKeymap {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scroll_up: Option<KeybindingsSpec>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scroll_down: Option<KeybindingsSpec>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub page_up: Option<KeybindingsSpec>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub page_down: Option<KeybindingsSpec>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub half_page_up: Option<KeybindingsSpec>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub half_page_down: Option<KeybindingsSpec>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub jump_top: Option<KeybindingsSpec>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub jump_bottom: Option<KeybindingsSpec>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub close: Option<KeybindingsSpec>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub close_transcript: Option<KeybindingsSpec>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub find: Option<KeybindingsSpec>,
}

impl TuiPagerKeymap {
    fn is_default(&self) -> bool {
        self == &Self::default()
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq, Default)]
#[serde(default, deny_unknown_fields)]
pub struct TuiAgentsKeymap {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resume: Option<KeybindingsSpec>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub search: Option<KeybindingsSpec>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub new_task: Option<KeybindingsSpec>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rename: Option<KeybindingsSpec>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stop: Option<KeybindingsSpec>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub toggle_grouping: Option<KeybindingsSpec>,
}

impl TuiAgentsKeymap {
    fn is_default(&self) -> bool {
        self == &Self::default()
    }
}

/// 当前 resume/fork picker 消费的列表导航与确认/取消配置。
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq, Default)]
#[serde(default, deny_unknown_fields)]
pub struct TuiListKeymap {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub move_up: Option<KeybindingsSpec>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub move_down: Option<KeybindingsSpec>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub move_left: Option<KeybindingsSpec>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub move_right: Option<KeybindingsSpec>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub page_up: Option<KeybindingsSpec>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub page_down: Option<KeybindingsSpec>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub jump_top: Option<KeybindingsSpec>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub jump_bottom: Option<KeybindingsSpec>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub accept: Option<KeybindingsSpec>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cancel: Option<KeybindingsSpec>,
}

impl TuiListKeymap {
    fn is_default(&self) -> bool {
        self == &Self::default()
    }
}

/// Composer 与文本输入组件共用的编辑键位；语义与 Codex `TuiEditorKeymap` 一致。
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq, Default)]
#[serde(default, deny_unknown_fields)]
pub struct TuiEditorKeymap {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub insert_newline: Option<KeybindingsSpec>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub move_left: Option<KeybindingsSpec>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub move_right: Option<KeybindingsSpec>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub move_up: Option<KeybindingsSpec>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub move_down: Option<KeybindingsSpec>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub move_word_left: Option<KeybindingsSpec>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub move_word_right: Option<KeybindingsSpec>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub move_line_start: Option<KeybindingsSpec>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub move_line_end: Option<KeybindingsSpec>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delete_backward: Option<KeybindingsSpec>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delete_forward: Option<KeybindingsSpec>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delete_backward_word: Option<KeybindingsSpec>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delete_forward_word: Option<KeybindingsSpec>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kill_line_start: Option<KeybindingsSpec>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kill_whole_line: Option<KeybindingsSpec>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kill_line_end: Option<KeybindingsSpec>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub yank: Option<KeybindingsSpec>,
}

impl TuiEditorKeymap {
    fn is_default(&self) -> bool {
        self == &Self::default()
    }
}

/// `tui.keymap` 的持久化形状；运行时必须先解析为不可变 snapshot。
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq, Default)]
#[serde(default, deny_unknown_fields)]
pub struct TuiKeymap {
    #[serde(skip_serializing_if = "TuiGlobalKeymap::is_default")]
    pub global: TuiGlobalKeymap,
    #[serde(skip_serializing_if = "TuiPagerKeymap::is_default")]
    pub pager: TuiPagerKeymap,
    #[serde(skip_serializing_if = "TuiAgentsKeymap::is_default")]
    pub agents: TuiAgentsKeymap,
    #[serde(skip_serializing_if = "TuiListKeymap::is_default")]
    pub list: TuiListKeymap,
    #[serde(skip_serializing_if = "TuiEditorKeymap::is_default")]
    pub editor: TuiEditorKeymap,
    #[serde(skip_serializing_if = "TuiVimNormalKeymap::is_default")]
    pub vim_normal: TuiVimNormalKeymap,
    #[serde(skip_serializing_if = "TuiVimOperatorKeymap::is_default")]
    pub vim_operator: TuiVimOperatorKeymap,
    #[serde(skip_serializing_if = "TuiVimTextObjectKeymap::is_default")]
    pub vim_text_object: TuiVimTextObjectKeymap,
    #[serde(skip_serializing_if = "TuiVimSearchKeymap::is_default")]
    pub vim_search: TuiVimSearchKeymap,
}

impl TuiKeymap {
    pub fn is_default(&self) -> bool {
        self == &Self::default()
    }
}

/// TUI 客户端拥有的用户偏好；仅包含已接线的输入策略和 keymap。
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq, Default)]
#[serde(default, deny_unknown_fields)]
pub struct TuiConfig {
    /// Mouse right-click paste policy. `auto` follows terminal safety guards.
    #[serde(skip_serializing_if = "RightClickPaste::is_default")]
    pub right_click_paste: RightClickPaste,
    #[serde(skip_serializing_if = "TuiKeymap::is_default")]
    pub keymap: TuiKeymap,
}

impl TuiConfig {
    pub fn is_default(&self) -> bool {
        self == &Self::default()
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum RightClickPaste {
    #[default]
    Auto,
    On,
    Off,
}

impl RightClickPaste {
    pub fn is_default(&self) -> bool {
        *self == Self::Auto
    }
}

fn normalize_keybinding_spec(raw: &str) -> Result<String, String> {
    let strokes = raw.split_whitespace().collect::<Vec<_>>();
    if strokes.is_empty() {
        return normalize_keybinding_stroke(raw);
    }
    if strokes.len() > MAX_KEY_CHORD_STROKES {
        return Err(format!(
            "invalid keybinding `{raw}`: key chords may contain at most \
{MAX_KEY_CHORD_STROKES} strokes (for example `ctrl-x ctrl-s`)."
        ));
    }

    strokes
        .into_iter()
        .map(normalize_keybinding_stroke)
        .collect::<Result<Vec<_>, _>>()
        .map(|normalized| normalized.join(" "))
}

fn normalize_keybinding_stroke(raw: &str) -> Result<String, String> {
    let lower = raw.trim().to_ascii_lowercase();
    if lower.is_empty() {
        return Err(
            "keybinding cannot be empty; use a value such as `ctrl-a` or `shift-enter`".to_string(),
        );
    }

    let segments = lower
        .split('-')
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>();
    if segments.is_empty() {
        return Err(format!("invalid keybinding `{raw}`"));
    }

    let mut modifiers =
        BTreeMap::<&str, bool>::from([("ctrl", false), ("alt", false), ("shift", false)]);
    let mut key_segments = Vec::new();
    let mut saw_key = false;
    for segment in segments {
        let modifier = match segment {
            "ctrl" | "control" => Some("ctrl"),
            "alt" | "option" => Some("alt"),
            "shift" => Some("shift"),
            _ => None,
        };
        if !saw_key {
            if let Some(modifier) = modifier {
                if modifiers.get(modifier).copied().unwrap_or(false) {
                    return Err(format!(
                        "duplicate modifier in keybinding `{raw}`; use each modifier at most once"
                    ));
                }
                modifiers.insert(modifier, true);
                continue;
            }
        }
        saw_key = true;
        key_segments.push(segment);
    }

    if key_segments.is_empty() {
        return Err(format!("missing key in keybinding `{raw}`"));
    }
    if key_segments
        .iter()
        .any(|segment| matches!(*segment, "ctrl" | "control" | "alt" | "option" | "shift"))
    {
        return Err(format!(
            "invalid keybinding `{raw}`: modifiers must precede the key"
        ));
    }

    let key = normalize_key_name(&key_segments.join("-"), raw)?;
    let mut normalized = Vec::new();
    for modifier in ["ctrl", "alt", "shift"] {
        if modifiers.get(modifier).copied().unwrap_or(false) {
            normalized.push(modifier.to_string());
        }
    }
    normalized.push(key);
    Ok(normalized.join("-"))
}

fn normalize_key_name(key: &str, original: &str) -> Result<String, String> {
    let alias = match key {
        "escape" => "esc",
        "return" => "enter",
        "spacebar" => "space",
        "pgup" | "pageup" => "page-up",
        "pgdn" | "pagedown" => "page-down",
        "del" => "delete",
        other => other,
    };

    if alias.len() == 1 {
        let character = alias.chars().next().unwrap_or_default();
        if character.is_ascii() && !character.is_ascii_control() && character != '-' {
            return Ok(alias.to_string());
        }
    }
    if matches!(
        alias,
        "enter"
            | "tab"
            | "backspace"
            | "esc"
            | "delete"
            | "insert"
            | "up"
            | "down"
            | "left"
            | "right"
            | "home"
            | "end"
            | "page-up"
            | "page-down"
            | "space"
            | "minus"
    ) {
        return Ok(alias.to_string());
    }
    if let Some(number) = alias.strip_prefix('f') {
        if number
            .parse::<u8>()
            .ok()
            .is_some_and(|number| (1..=MAX_FUNCTION_KEY).contains(&number))
        {
            return Ok(alias.to_string());
        }
    }

    Err(format!(
        "unknown key `{key}` in keybinding `{original}`; use an ASCII character, f1-f{MAX_FUNCTION_KEY}, or a supported named key"
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keymap_normalizes_aliases_chords_and_explicit_unbinds() {
        let config: TuiConfig = serde_yaml::from_str(
            "keymap:\n  global:\n    find_transcript: Control-X PageDown\n  pager:\n    find: []\n",
        )
        .expect("valid keymap");
        assert_eq!(
            config
                .keymap
                .global
                .find_transcript
                .as_ref()
                .expect("find binding")
                .specs()[0]
                .as_str(),
            "ctrl-x page-down"
        );
        assert_eq!(
            config.keymap.pager.find,
            Some(KeybindingsSpec::Many(Vec::new()))
        );
    }

    #[test]
    fn keymap_rejects_unknown_actions_and_long_chords() {
        let unknown =
            serde_yaml::from_str::<TuiConfig>("keymap:\n  global:\n    find_transcrip: f3\n")
                .expect_err("unknown action must fail closed");
        assert!(unknown.to_string().contains("find_transcrip"));

        serde_yaml::from_str::<TuiConfig>(
            "keymap:\n  global:\n    find_transcript: ctrl-x ctrl-f f3\n",
        )
        .expect_err("three-stroke chord must fail closed");
    }

    #[test]
    fn list_keymap_round_trips_configured_chords_alternatives_and_unbinds() {
        let config: TuiConfig = serde_yaml::from_str("keymap:\n  list:\n    accept: F9\n    cancel: Control-X q\n    page_down: [PageDown, ctrl-d]\n    move_up: []\n").unwrap();
        assert_eq!(
            config.keymap.list.accept.as_ref().unwrap().specs()[0].as_str(),
            "f9"
        );
        assert_eq!(
            config.keymap.list.cancel.as_ref().unwrap().specs()[0].as_str(),
            "ctrl-x q"
        );
        assert_eq!(
            config.keymap.list.move_up,
            Some(KeybindingsSpec::Many(Vec::new()))
        );
        let serialized = serde_json::to_value(&config).unwrap();
        assert_eq!(
            serialized["keymap"]["list"]["page_down"],
            serde_json::json!(["page-down", "ctrl-d"])
        );
        assert_eq!(
            serde_json::from_value::<TuiConfig>(serialized).unwrap(),
            config
        );
        assert!(serde_yaml::from_str::<TuiConfig>("keymap:\n  list:\n    acept: f9\n").is_err());
    }

    #[test]
    fn default_tui_config_serializes_without_empty_keymap_noise() {
        assert_eq!(
            serde_yaml::to_string(&TuiConfig::default()).expect("serialize default TUI config"),
            "{}\n"
        );
    }

    #[test]
    fn editor_keymap_roundtrips_normalized_alternatives_chords_and_unbind() {
        let config: TuiConfig = serde_yaml::from_str("keymap:\n  editor:\n    move_left: [F9, Control-Q h]\n    delete_backward: []\n    kill_whole_line: ctrl-shift-u\n").unwrap();
        let value = serde_json::to_value(&config).unwrap();
        assert_eq!(
            value["keymap"]["editor"],
            serde_json::json!({
                "move_left": ["f9", "ctrl-q h"], "delete_backward": [], "kill_whole_line": "ctrl-shift-u"
            })
        );
        assert_eq!(serde_json::from_value::<TuiConfig>(value).unwrap(), config);
        assert!(
            serde_yaml::from_str::<TuiConfig>("keymap:\n  editor:\n    move_lft: f9\n").is_err()
        );
        assert!(serde_yaml::from_str::<TuiConfig>(
            "keymap:\n  editor:\n    move_left: ctrl-q h j\n"
        )
        .is_err());
    }
}
