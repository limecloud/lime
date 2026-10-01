//! Vim 模式配置仅由同名 runtime keymap 与聚焦输入消费。

use super::KeybindingsSpec;
use serde::{Deserialize, Serialize};

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::TuiKeymap;
    use serde_json::json;

    #[test]
    fn every_vim_action_roundtrips_alternatives_chords_and_explicit_unbinds() {
        for (context, actions) in [
            ("vim_normal", "enter_insert append_after_cursor append_line_end insert_line_start open_line_below open_line_above enter_replace_mode move_left move_right move_up move_down move_word_forward move_word_backward move_word_end move_line_start move_line_end find_forward find_backward till_forward till_backward jump_top jump_bottom delete_char replace_char repeat_last_change substitute_char delete_to_line_end change_to_line_end yank_line paste_after start_delete_operator start_yank_operator start_change_operator undo redo cancel_operator"),
            ("vim_operator", "delete_line yank_line motion_left motion_right motion_up motion_down motion_word_forward motion_word_backward motion_word_end motion_line_start motion_line_end motion_find_forward motion_find_backward motion_till_forward motion_till_backward motion_jump_top motion_jump_bottom select_inner_text_object select_around_text_object cancel"),
            ("vim_text_object", "word big_word parentheses brackets braces double_quote single_quote backtick cancel"),
            ("vim_search", "forward backward next previous"),
        ] {
            for action in actions.split_whitespace() {
                let config: TuiKeymap = serde_json::from_value(json!({(context): {(action): ["F12", "z z"]}})).unwrap();
                let value = serde_json::to_value(config).unwrap();
                assert_eq!(value[context][action], json!(["f12", "z z"]), "{context}.{action}");
                let config: TuiKeymap = serde_json::from_value(json!({(context): {(action): []}})).unwrap();
                assert_eq!(serde_json::to_value(config).unwrap()[context][action], json!([]));
            }
            assert!(serde_json::from_value::<TuiKeymap>(json!({(context): {"misspelled": "f12"}})).is_err());
            assert!(serde_json::from_value::<TuiKeymap>(json!({(context): {"cancel": "g g g"}})).is_err());
        }
        assert_eq!(
            serde_json::to_value(TuiVimNormalKeymap::default()).unwrap(),
            json!({})
        );
    }
}

macro_rules! vim_keymap {
    ($name:ident, $description:literal, [$($action:ident),+ $(,)?]) => {
        #[doc = $description]
        #[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq, Default)]
        #[serde(default, deny_unknown_fields)]
        pub struct $name {
            $(#[serde(skip_serializing_if = "Option::is_none")]
            pub $action: Option<KeybindingsSpec>,)+
        }

        impl $name {
            pub(super) fn is_default(&self) -> bool {
                self == &Self::default()
            }
        }
    };
}

vim_keymap!(
    TuiVimNormalKeymap,
    "Vim Normal 模式键位，字段与 Codex 同义。",
    [
        enter_insert,
        append_after_cursor,
        append_line_end,
        insert_line_start,
        open_line_below,
        open_line_above,
        enter_replace_mode,
        move_left,
        move_right,
        move_up,
        move_down,
        move_word_forward,
        move_word_backward,
        move_word_end,
        move_line_start,
        move_line_end,
        find_forward,
        find_backward,
        till_forward,
        till_backward,
        jump_top,
        jump_bottom,
        delete_char,
        replace_char,
        repeat_last_change,
        substitute_char,
        delete_to_line_end,
        change_to_line_end,
        yank_line,
        paste_after,
        start_delete_operator,
        start_yank_operator,
        start_change_operator,
        undo,
        redo,
        cancel_operator,
    ]
);

vim_keymap!(
    TuiVimOperatorKeymap,
    "Vim operator-pending 模式键位。",
    [
        delete_line,
        yank_line,
        motion_left,
        motion_right,
        motion_up,
        motion_down,
        motion_word_forward,
        motion_word_backward,
        motion_word_end,
        motion_line_start,
        motion_line_end,
        motion_find_forward,
        motion_find_backward,
        motion_till_forward,
        motion_till_backward,
        motion_jump_top,
        motion_jump_bottom,
        select_inner_text_object,
        select_around_text_object,
        cancel,
    ]
);

vim_keymap!(
    TuiVimTextObjectKeymap,
    "Vim inner/around text-object 模式键位。",
    [
        word,
        big_word,
        parentheses,
        brackets,
        braces,
        double_quote,
        single_quote,
        backtick,
        cancel,
    ]
);

vim_keymap!(
    TuiVimSearchKeymap,
    "Normal 与 operator-pending 共用的搜索动作。",
    [forward, backward, next, previous,]
);
