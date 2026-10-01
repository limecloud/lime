//! Codex editor actions resolved once; dispatch never reinterprets the persisted config.

use super::*;
use lime_core::config::TuiEditorKeymap;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum EditorAction {
    InsertNewline,
    MoveLeft,
    MoveRight,
    MoveUp,
    MoveDown,
    MoveWordLeft,
    MoveWordRight,
    MoveLineStart,
    MoveLineEnd,
    DeleteBackward,
    DeleteForward,
    DeleteBackwardWord,
    DeleteForwardWord,
    KillLineStart,
    KillWholeLine,
    KillLineEnd,
    Yank,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct EditorKeymap {
    actions: Vec<(EditorAction, &'static str, BindingSet)>,
}

impl EditorKeymap {
    pub(super) fn from_config(config: &TuiEditorKeymap) -> Result<Self, String> {
        let alt = |code| KeyBinding {
            code,
            modifiers: KeyModifiers::ALT,
        };
        let ctrl_shift = |code| KeyBinding {
            code,
            modifiers: KeyModifiers::CONTROL | KeyModifiers::SHIFT,
        };
        let definitions = [
            (
                EditorAction::InsertNewline,
                "insert_newline",
                config.insert_newline.as_ref(),
                vec![
                    ctrl('j'),
                    ctrl('m'),
                    plain(KeyCode::Enter),
                    KeyBinding::shift(KeyCode::Enter),
                    alt(KeyCode::Enter),
                ],
            ),
            (
                EditorAction::MoveLeft,
                "move_left",
                config.move_left.as_ref(),
                vec![plain(KeyCode::Left), ctrl('b')],
            ),
            (
                EditorAction::MoveRight,
                "move_right",
                config.move_right.as_ref(),
                vec![plain(KeyCode::Right), ctrl('f')],
            ),
            (
                EditorAction::MoveUp,
                "move_up",
                config.move_up.as_ref(),
                vec![plain(KeyCode::Up), ctrl('p')],
            ),
            (
                EditorAction::MoveDown,
                "move_down",
                config.move_down.as_ref(),
                vec![plain(KeyCode::Down), ctrl('n')],
            ),
            (
                EditorAction::MoveWordLeft,
                "move_word_left",
                config.move_word_left.as_ref(),
                vec![
                    alt(KeyCode::Char('b')),
                    alt(KeyCode::Left),
                    KeyBinding::control(KeyCode::Left),
                ],
            ),
            (
                EditorAction::MoveWordRight,
                "move_word_right",
                config.move_word_right.as_ref(),
                vec![
                    alt(KeyCode::Char('f')),
                    alt(KeyCode::Right),
                    KeyBinding::control(KeyCode::Right),
                ],
            ),
            (
                EditorAction::MoveLineStart,
                "move_line_start",
                config.move_line_start.as_ref(),
                vec![plain(KeyCode::Home), ctrl('a')],
            ),
            (
                EditorAction::MoveLineEnd,
                "move_line_end",
                config.move_line_end.as_ref(),
                vec![plain(KeyCode::End), ctrl('e')],
            ),
            (
                EditorAction::DeleteBackward,
                "delete_backward",
                config.delete_backward.as_ref(),
                vec![
                    plain(KeyCode::Backspace),
                    KeyBinding::shift(KeyCode::Backspace),
                    ctrl('h'),
                ],
            ),
            (
                EditorAction::DeleteForward,
                "delete_forward",
                config.delete_forward.as_ref(),
                vec![
                    plain(KeyCode::Delete),
                    KeyBinding::shift(KeyCode::Delete),
                    ctrl('d'),
                ],
            ),
            (
                EditorAction::DeleteBackwardWord,
                "delete_backward_word",
                config.delete_backward_word.as_ref(),
                vec![
                    alt(KeyCode::Backspace),
                    KeyBinding::control(KeyCode::Backspace),
                    ctrl_shift(KeyCode::Backspace),
                    ctrl('w'),
                    KeyBinding {
                        code: KeyCode::Char('h'),
                        modifiers: KeyModifiers::CONTROL | KeyModifiers::ALT,
                    },
                ],
            ),
            (
                EditorAction::DeleteForwardWord,
                "delete_forward_word",
                config.delete_forward_word.as_ref(),
                vec![
                    alt(KeyCode::Delete),
                    KeyBinding::control(KeyCode::Delete),
                    ctrl_shift(KeyCode::Delete),
                    alt(KeyCode::Char('d')),
                ],
            ),
            (
                EditorAction::KillLineStart,
                "kill_line_start",
                config.kill_line_start.as_ref(),
                vec![ctrl('u')],
            ),
            (
                EditorAction::KillWholeLine,
                "kill_whole_line",
                config.kill_whole_line.as_ref(),
                vec![],
            ),
            (
                EditorAction::KillLineEnd,
                "kill_line_end",
                config.kill_line_end.as_ref(),
                vec![ctrl('k')],
            ),
            (
                EditorAction::Yank,
                "yank",
                config.yank.as_ref(),
                vec![ctrl('y')],
            ),
        ];
        let actions = definitions
            .into_iter()
            .map(|(action, name, value, defaults)| {
                BindingSet::resolve(
                    value,
                    singles(&defaults),
                    &format!("tui.keymap.editor.{name}"),
                )
                .map(|bindings| (action, name, bindings))
            })
            .collect::<Result<Vec<_>, _>>()?;
        validate_context(
            "editor",
            &actions
                .iter()
                .map(|(_, name, bindings)| (*name, bindings))
                .collect::<Vec<_>>(),
        )?;
        for (action, name, bindings) in &actions {
            for shortcut in &bindings.shortcuts {
                let key = first_stroke(shortcut);
                if reserved_host_key(key, *action) {
                    return Err(format!("Invalid `tui.keymap.editor.{name}`: binding overlaps a reserved host/composer key"));
                }
            }
        }
        Ok(Self { actions })
    }

    pub(super) fn validate_main_surface(
        &self,
        transcript: &TranscriptKeymap,
    ) -> Result<(), String> {
        for (_, name, bindings) in &self.actions {
            for shortcut in &bindings.shortcuts {
                for (global, keys) in [
                    ("open_agents", &transcript.open_agents),
                    ("open_transcript", &transcript.open_transcript),
                    ("find_transcript", &transcript.find_transcript),
                ] {
                    // App dispatch runs before the textarea. Even distinct completions sharing
                    // a prefix would be swallowed by App's matcher, so reject that shadowing.
                    if keys.shortcuts.iter().any(|other| {
                        first_stroke(other).normalized_parts()
                            == first_stroke(shortcut).normalized_parts()
                    }) {
                        return Err(format!("Ambiguous `tui.keymap.editor.{name}` and `tui.keymap.global.{global}`: main input bindings overlap"));
                    }
                }
            }
        }
        Ok(())
    }

    pub(crate) fn action_for_key(&self, key: KeyEvent) -> Option<EditorAction> {
        self.actions
            .iter()
            .find_map(|(action, _, bindings)| bindings.is_pressed(key).then_some(*action))
    }

    pub(crate) fn primary_hint(&self, action: EditorAction) -> Option<String> {
        self.actions.iter().find(|(candidate, _, _)| *candidate == action)?.2.shortcuts.iter()
            .find(|shortcut| {
                // Plain Enter is consumed by composer submission, not insert_newline.
                action != EditorAction::InsertNewline || !matches!(shortcut, Shortcut::Single(key) if key.normalized_parts() == plain(KeyCode::Enter).normalized_parts())
            }).map(Shortcut::display_label)
    }

    pub(crate) fn owns_key(&self, matcher: &KeyChordMatcher, key: KeyEvent) -> bool {
        if !matches!(key.kind, KeyEventKind::Press | KeyEventKind::Repeat) {
            return false;
        }
        if matcher.pending.is_some() {
            return true;
        }
        self.actions.iter().any(|(_, _, bindings)| {
            bindings
                .shortcuts
                .iter()
                .any(|shortcut| first_stroke(shortcut).is_pressed(key))
        })
    }

    pub(crate) fn dispatch(
        &self,
        matcher: &mut KeyChordMatcher,
        key: KeyEvent,
    ) -> KeymapMatch<EditorAction> {
        matcher.advance(
            key,
            &self
                .actions
                .iter()
                .map(|(action, _, bindings)| (*action, bindings))
                .collect::<Vec<_>>(),
        )
    }
}

impl Default for EditorKeymap {
    fn default() -> Self {
        Self::from_config(&TuiEditorKeymap::default())
            .expect("built-in editor bindings must be valid")
    }
}

fn reserved_host_key(key: KeyBinding, action: EditorAction) -> bool {
    let (code, modifiers) = key.normalized_parts();
    match code {
        KeyCode::Char('?') if !modifiers.intersects(KeyModifiers::CONTROL | KeyModifiers::ALT) => {
            true
        }
        KeyCode::Esc | KeyCode::Tab | KeyCode::PageUp | KeyCode::PageDown | KeyCode::F(7 | 8) => {
            true
        }
        KeyCode::Enter => action != EditorAction::InsertNewline,
        KeyCode::Home | KeyCode::End => modifiers.contains(KeyModifiers::ALT),
        KeyCode::Up | KeyCode::Down => modifiers.contains(KeyModifiers::ALT),
        KeyCode::Char('c' | 'g' | 'o' | 'r') => modifiers.contains(KeyModifiers::CONTROL),
        KeyCode::Char('v') => modifiers.intersects(KeyModifiers::CONTROL | KeyModifiers::ALT),
        KeyCode::Char(',' | '.') => modifiers.contains(KeyModifiers::ALT),
        KeyCode::Char('d') => {
            modifiers.contains(KeyModifiers::CONTROL) && action != EditorAction::DeleteForward
        }
        _ => false,
    }
}

#[cfg(test)]
#[path = "editor_tests.rs"]
mod tests;
