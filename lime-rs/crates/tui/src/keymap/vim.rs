//! Codex-shaped modal bindings. Printable chords are confined to Vim contexts.

use super::*;
use lime_core::config::{
    TuiVimNormalKeymap, TuiVimOperatorKeymap, TuiVimSearchKeymap, TuiVimTextObjectKeymap,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum KeymapContext {
    Editor,
    VimNormal,
    VimOperator,
    VimTextObject,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum VimKeymapAction {
    Normal(VimNormalAction),
    Operator(VimOperatorAction),
    TextObject(VimTextObjectAction),
    Search(VimSearchAction),
    ChangeLine,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct ModalBinding<A> {
    action: A,
    name: &'static str,
    bindings: BindingSet,
    configured: bool,
}

macro_rules! modal_keymap {
    ($keymap:ident, $action:ident, $config:ident, $context:literal, {
        $($variant:ident => $field:ident: $defaults:expr),+ $(,)?
    }) => {
        #[derive(Clone, Copy, Debug, PartialEq, Eq)]
        pub(crate) enum $action { $($variant),+ }

        #[derive(Clone, Debug, PartialEq, Eq)]
        pub(crate) struct $keymap { actions: Vec<ModalBinding<$action>> }

        impl $keymap {
            pub(super) fn from_config(config: &$config) -> Result<Self, String> {
                let mut actions = vec![$(ModalBinding {
                    action: $action::$variant,
                    name: stringify!($field),
                    bindings: BindingSet::resolve(config.$field.as_ref(), $defaults,
                        concat!("tui.keymap.", $context, ".", stringify!($field)))?,
                    configured: config.$field.is_some(),
                }),+];
                let explicit = actions.iter().filter(|action| action.configured)
                    .flat_map(|action| action.bindings.shortcuts.iter().cloned()).collect::<Vec<_>>();
                for action in &mut actions {
                    if !action.configured {
                        action.bindings.shortcuts.retain(|shortcut|
                            !explicit.iter().any(|other| shortcuts_overlap(shortcut, other)));
                    }
                }
                validate_modal_context($context, &actions.iter()
                    .map(|action| (action.name, &action.bindings)).collect::<Vec<_>>())?;
                Ok(Self { actions })
            }
        }

        impl Default for $keymap {
            fn default() -> Self {
                Self::from_config(&$config::default()).expect("built-in Vim bindings must be valid")
            }
        }
    };
}

fn jump_top_chord() -> Vec<Shortcut> {
    vec![Shortcut::Chord {
        prefix: plain_char('g'),
        completion: plain_char('g'),
    }]
}

modal_keymap!(VimNormalKeymap, VimNormalAction, TuiVimNormalKeymap, "vim_normal", {
    EnterInsert => enter_insert: singles(&[plain_char('i'), plain(KeyCode::Insert)]),
    AppendAfterCursor => append_after_cursor: singles(&[plain_char('a')]),
    AppendLineEnd => append_line_end: singles(&[shift('a')]),
    InsertLineStart => insert_line_start: singles(&[shift('i')]),
    OpenLineBelow => open_line_below: singles(&[plain_char('o')]),
    OpenLineAbove => open_line_above: singles(&[shift('o')]),
    EnterReplaceMode => enter_replace_mode: singles(&[shift('r')]),
    MoveLeft => move_left: singles(&[plain_char('h'), plain(KeyCode::Left)]),
    MoveRight => move_right: singles(&[plain_char('l'), plain(KeyCode::Right)]),
    MoveUp => move_up: singles(&[plain_char('k'), plain(KeyCode::Up)]),
    MoveDown => move_down: singles(&[plain_char('j'), plain(KeyCode::Down)]),
    MoveWordForward => move_word_forward: singles(&[plain_char('w')]),
    MoveWordBackward => move_word_backward: singles(&[plain_char('b')]),
    MoveWordEnd => move_word_end: singles(&[plain_char('e')]),
    MoveLineStart => move_line_start: singles(&[plain_char('0')]),
    MoveLineEnd => move_line_end: singles(&[plain_char('$'), shift('$')]),
    FindForward => find_forward: singles(&[plain_char('f')]),
    FindBackward => find_backward: singles(&[shift('f')]),
    TillForward => till_forward: singles(&[plain_char('t')]),
    TillBackward => till_backward: singles(&[shift('t')]),
    JumpTop => jump_top: jump_top_chord(),
    JumpBottom => jump_bottom: singles(&[shift('g')]),
    DeleteChar => delete_char: singles(&[plain_char('x')]),
    ReplaceChar => replace_char: singles(&[plain_char('r')]),
    RepeatLastChange => repeat_last_change: singles(&[plain_char('.')]),
    SubstituteChar => substitute_char: singles(&[plain_char('s')]),
    DeleteToLineEnd => delete_to_line_end: singles(&[shift('d')]),
    ChangeToLineEnd => change_to_line_end: singles(&[shift('c')]),
    YankLine => yank_line: singles(&[shift('y')]),
    PasteAfter => paste_after: singles(&[plain_char('p')]),
    StartDeleteOperator => start_delete_operator: singles(&[plain_char('d')]),
    StartYankOperator => start_yank_operator: singles(&[plain_char('y')]),
    StartChangeOperator => start_change_operator: singles(&[plain_char('c')]),
    Undo => undo: singles(&[plain_char('u')]),
    Redo => redo: singles(&[ctrl('r')]),
    CancelOperator => cancel_operator: singles(&[plain(KeyCode::Esc)]),
});

modal_keymap!(VimOperatorKeymap, VimOperatorAction, TuiVimOperatorKeymap, "vim_operator", {
    DeleteLine => delete_line: singles(&[plain_char('d')]),
    YankLine => yank_line: singles(&[plain_char('y')]),
    MotionLeft => motion_left: singles(&[plain_char('h')]),
    MotionRight => motion_right: singles(&[plain_char('l')]),
    MotionUp => motion_up: singles(&[plain_char('k')]),
    MotionDown => motion_down: singles(&[plain_char('j')]),
    MotionWordForward => motion_word_forward: singles(&[plain_char('w')]),
    MotionWordBackward => motion_word_backward: singles(&[plain_char('b')]),
    MotionWordEnd => motion_word_end: singles(&[plain_char('e')]),
    MotionLineStart => motion_line_start: singles(&[plain_char('0')]),
    MotionLineEnd => motion_line_end: singles(&[plain_char('$'), shift('$')]),
    MotionFindForward => motion_find_forward: singles(&[plain_char('f')]),
    MotionFindBackward => motion_find_backward: singles(&[shift('f')]),
    MotionTillForward => motion_till_forward: singles(&[plain_char('t')]),
    MotionTillBackward => motion_till_backward: singles(&[shift('t')]),
    MotionJumpTop => motion_jump_top: jump_top_chord(),
    MotionJumpBottom => motion_jump_bottom: singles(&[shift('g')]),
    SelectInnerTextObject => select_inner_text_object: singles(&[plain_char('i')]),
    SelectAroundTextObject => select_around_text_object: singles(&[plain_char('a')]),
    Cancel => cancel: singles(&[plain(KeyCode::Esc)]),
});

modal_keymap!(VimTextObjectKeymap, VimTextObjectAction, TuiVimTextObjectKeymap, "vim_text_object", {
    Word => word: singles(&[plain_char('w')]),
    BigWord => big_word: singles(&[shift('w')]),
    Parentheses => parentheses: singles(&[plain_char('('), shift('('), plain_char(')'), shift(')'), plain_char('b')]),
    Brackets => brackets: singles(&[plain_char('['), plain_char(']')]),
    Braces => braces: singles(&[plain_char('{'), shift('{'), plain_char('}'), shift('}'), shift('b')]),
    DoubleQuote => double_quote: singles(&[plain_char('"'), shift('"')]),
    SingleQuote => single_quote: singles(&[plain_char('\'')]),
    Backtick => backtick: singles(&[plain_char('`')]),
    Cancel => cancel: singles(&[plain(KeyCode::Esc)]),
});

modal_keymap!(VimSearchKeymap, VimSearchAction, TuiVimSearchKeymap, "vim_search", {
    Forward => forward: singles(&[plain_char('/')]),
    Backward => backward: singles(&[plain_char('?'), shift('?')]),
    Next => next: singles(&[plain_char('n')]),
    Previous => previous: singles(&[shift('n')]),
});

impl RuntimeKeymap {
    pub(super) fn configure_vim(&mut self) -> Result<(), String> {
        let global = [
            &self.transcript.open_agents,
            &self.transcript.open_transcript,
            &self.transcript.find_transcript,
        ];
        macro_rules! yield_to_global {
            ($keymap:expr) => {
                for action in &mut Arc::make_mut($keymap).actions {
                    if !action.configured {
                        action.bindings.shortcuts.retain(|shortcut| {
                            !global.iter().any(|bindings| {
                                bindings.shortcuts.iter().any(|other| {
                                    first_stroke(shortcut).normalized_parts()
                                        == first_stroke(other).normalized_parts()
                                })
                            })
                        });
                    }
                }
            };
        }
        yield_to_global!(&mut self.vim_normal);
        yield_to_global!(&mut self.vim_operator);
        yield_to_global!(&mut self.vim_text_object);
        yield_to_global!(&mut self.vim_search);
        let explicit = self
            .vim_normal
            .actions
            .iter()
            .filter(|action| action.configured)
            .map(|action| &action.bindings)
            .chain(
                self.vim_operator
                    .actions
                    .iter()
                    .filter(|action| action.configured)
                    .map(|action| &action.bindings),
            )
            .collect::<Vec<_>>();
        // Explicit modal actions take precedence over default search shortcuts.
        for action in &mut Arc::make_mut(&mut self.vim_search).actions {
            if !action.configured {
                action.bindings.shortcuts.retain(|shortcut| {
                    !explicit.iter().any(|bindings| {
                        bindings
                            .shortcuts
                            .iter()
                            .any(|other| shortcuts_overlap(shortcut, other))
                    })
                });
            }
        }
        for (context, actions) in [
            (
                "vim_normal",
                self.vim_normal
                    .actions
                    .iter()
                    .map(|a| (a.name, &a.bindings))
                    .collect::<Vec<_>>(),
            ),
            (
                "vim_operator",
                self.vim_operator
                    .actions
                    .iter()
                    .map(|a| (a.name, &a.bindings))
                    .collect(),
            ),
        ] {
            let search = self
                .vim_search
                .actions
                .iter()
                .map(|a| (a.name, &a.bindings));
            validate_modal_context(
                context,
                &actions.iter().copied().chain(search).collect::<Vec<_>>(),
            )?;
        }
        let all = [
            (
                "vim_normal",
                self.vim_normal
                    .actions
                    .iter()
                    .map(|a| (a.name, &a.bindings))
                    .collect::<Vec<_>>(),
            ),
            (
                "vim_operator",
                self.vim_operator
                    .actions
                    .iter()
                    .map(|a| (a.name, &a.bindings))
                    .collect(),
            ),
            (
                "vim_text_object",
                self.vim_text_object
                    .actions
                    .iter()
                    .map(|a| (a.name, &a.bindings))
                    .collect(),
            ),
            (
                "vim_search",
                self.vim_search
                    .actions
                    .iter()
                    .map(|a| (a.name, &a.bindings))
                    .collect(),
            ),
        ];
        for (context, actions) in all {
            for (action, bindings) in actions {
                for shortcut in &bindings.shortcuts {
                    let key = first_stroke(shortcut);
                    if reserved_modal_key(key, context, action) {
                        return Err(format!("Invalid `tui.keymap.{context}.{action}`: binding overlaps a reserved host/composer key"));
                    }
                    for (global, bindings) in [
                        ("open_agents", &self.transcript.open_agents),
                        ("open_transcript", &self.transcript.open_transcript),
                        ("find_transcript", &self.transcript.find_transcript),
                    ] {
                        if bindings.shortcuts.iter().any(|other| {
                            first_stroke(other).normalized_parts() == key.normalized_parts()
                        }) {
                            return Err(format!("Ambiguous `tui.keymap.{context}.{action}` and `tui.keymap.global.{global}`: focused input bindings overlap"));
                        }
                    }
                }
            }
        }
        Ok(())
    }
}

fn reserved_modal_key(key: KeyBinding, context: &str, action: &str) -> bool {
    let (code, modifiers) = key.normalized_parts();
    match code {
        KeyCode::Esc => !matches!(action, "cancel" | "cancel_operator"),
        KeyCode::Enter | KeyCode::Tab | KeyCode::PageUp | KeyCode::PageDown | KeyCode::F(7 | 8) => {
            true
        }
        KeyCode::Home | KeyCode::End | KeyCode::Up | KeyCode::Down => {
            modifiers.contains(KeyModifiers::ALT)
        }
        KeyCode::Char('r') if modifiers.contains(KeyModifiers::CONTROL) => {
            context != "vim_normal" || action != "redo"
        }
        KeyCode::Char('c' | 'd' | 'g' | 'o') => modifiers.contains(KeyModifiers::CONTROL),
        KeyCode::Char('v') => modifiers.intersects(KeyModifiers::CONTROL | KeyModifiers::ALT),
        KeyCode::Char(',' | '.') => modifiers.contains(KeyModifiers::ALT),
        _ => false,
    }
}

pub(super) fn first_stroke(shortcut: &Shortcut) -> KeyBinding {
    match shortcut {
        Shortcut::Single(key) => *key,
        Shortcut::Chord { prefix, .. } => *prefix,
    }
}

pub(super) fn shortcuts_overlap(first: &Shortcut, second: &Shortcut) -> bool {
    match (first, second) {
        (Shortcut::Single(a), Shortcut::Single(b)) => a.normalized_parts() == b.normalized_parts(),
        (Shortcut::Single(a), Shortcut::Chord { prefix, .. })
        | (Shortcut::Chord { prefix, .. }, Shortcut::Single(a)) => {
            a.normalized_parts() == prefix.normalized_parts()
        }
        (
            Shortcut::Chord {
                prefix: a,
                completion: x,
            },
            Shortcut::Chord {
                prefix: b,
                completion: y,
            },
        ) => {
            a.normalized_parts() == b.normalized_parts()
                && x.normalized_parts() == y.normalized_parts()
        }
    }
}

fn vim_binding_actions<'a>(
    normal: &'a VimNormalKeymap,
    operator: &'a VimOperatorKeymap,
    text_object: &'a VimTextObjectKeymap,
    search: &'a VimSearchKeymap,
    context: KeymapContext,
    change_operator: bool,
) -> Vec<(VimKeymapAction, &'a BindingSet)> {
    let mut actions = match context {
        KeymapContext::VimNormal => normal
            .actions
            .iter()
            .map(|a| (VimKeymapAction::Normal(a.action), &a.bindings))
            .collect(),
        KeymapContext::VimOperator => operator
            .actions
            .iter()
            .map(|a| (VimKeymapAction::Operator(a.action), &a.bindings))
            .collect(),
        KeymapContext::VimTextObject => text_object
            .actions
            .iter()
            .map(|a| (VimKeymapAction::TextObject(a.action), &a.bindings))
            .collect(),
        KeymapContext::Editor => Vec::new(),
    };
    if matches!(
        context,
        KeymapContext::VimNormal | KeymapContext::VimOperator
    ) {
        actions.extend(
            search
                .actions
                .iter()
                .map(|a| (VimKeymapAction::Search(a.action), &a.bindings)),
        );
    }
    if context == KeymapContext::VimOperator && change_operator {
        if let Some(action) = normal
            .actions
            .iter()
            .find(|a| a.action == VimNormalAction::StartChangeOperator)
        {
            actions.push((VimKeymapAction::ChangeLine, &action.bindings));
        }
    }
    actions
}

pub(crate) struct VimKeymap<'a> {
    pub(crate) normal: &'a VimNormalKeymap,
    pub(crate) operator: &'a VimOperatorKeymap,
    pub(crate) text_object: &'a VimTextObjectKeymap,
    pub(crate) search: &'a VimSearchKeymap,
}

impl VimKeymap<'_> {
    pub(crate) fn dispatch(
        &self,
        context: KeymapContext,
        change_operator: bool,
        matcher: &mut KeyChordMatcher,
        key: KeyEvent,
    ) -> KeymapMatch<VimKeymapAction> {
        matcher.advance(
            key,
            &vim_binding_actions(
                self.normal,
                self.operator,
                self.text_object,
                self.search,
                context,
                change_operator,
            ),
        )
    }
}

#[cfg(test)]
#[path = "vim_tests.rs"]
mod tests;
