use super::*;

pub(super) fn validate_context(
    context: &str,
    actions: &[(&str, &BindingSet)],
) -> Result<(), String> {
    validate_context_bindings(context, actions, false)
}

pub(super) fn validate_modal_context(
    context: &str,
    actions: &[(&str, &BindingSet)],
) -> Result<(), String> {
    validate_context_bindings(context, actions, true)
}

pub(super) fn validate_context_bindings(
    context: &str,
    actions: &[(&str, &BindingSet)],
    modal: bool,
) -> Result<(), String> {
    let entries = actions
        .iter()
        .flat_map(|(action, bindings)| {
            bindings
                .shortcuts
                .iter()
                .map(move |shortcut| (*action, shortcut))
        })
        .collect::<Vec<_>>();
    for (action, shortcut) in &entries {
        if let Shortcut::Chord { prefix, .. } = shortcut {
            if !modal && prefix.modifiers.is_empty() && matches!(prefix.code, KeyCode::Char(_)) {
                return Err(format!(
                    "Invalid `tui.keymap.{context}.{action}` chord: printable prefixes would intercept ordinary text input"
                ));
            }
        }
    }
    for (index, (first_action, first)) in entries.iter().enumerate() {
        for (second_action, second) in entries.iter().skip(index + 1) {
            let ambiguous = shortcuts_overlap(first, second);
            if ambiguous {
                return Err(format!(
                    "Ambiguous `tui.keymap.{context}` bindings: `{first_action}` and `{second_action}` overlap. Set unique keys and retry."
                ));
            }
        }
    }
    Ok(())
}

pub(super) fn parse_shortcut(spec: &str, path: &str) -> Result<Shortcut, String> {
    let strokes = spec.split_whitespace().collect::<Vec<_>>();
    match strokes.as_slice() {
        [single] => parse_keybinding(single)
            .map(Shortcut::Single)
            .ok_or_else(|| invalid_binding(path, spec)),
        [prefix, completion] => Ok(Shortcut::Chord {
            prefix: parse_keybinding(prefix).ok_or_else(|| invalid_binding(path, spec))?,
            completion: parse_keybinding(completion).ok_or_else(|| invalid_binding(path, spec))?,
        }),
        _ => Err(invalid_binding(path, spec)),
    }
}

pub(super) fn invalid_binding(path: &str, spec: &str) -> String {
    format!("Invalid `{path}` = `{spec}`. Use values like `ctrl-a`, `shift-enter`, or `ctrl-x f`.")
}

pub(super) fn parse_keybinding(spec: &str) -> Option<KeyBinding> {
    let mut parts = spec.split('-');
    let mut modifiers = KeyModifiers::NONE;
    let mut key_name = None;
    for part in parts.by_ref() {
        match part {
            "ctrl" => modifiers |= KeyModifiers::CONTROL,
            "alt" => modifiers |= KeyModifiers::ALT,
            "shift" => modifiers |= KeyModifiers::SHIFT,
            other => {
                key_name = Some(other.to_string());
                break;
            }
        }
    }
    let mut key_name = key_name?;
    for trailing in parts {
        key_name.push('-');
        key_name.push_str(trailing);
    }
    let code = match key_name.as_str() {
        "enter" => KeyCode::Enter,
        "tab" => KeyCode::Tab,
        "backspace" => KeyCode::Backspace,
        "esc" => KeyCode::Esc,
        "delete" => KeyCode::Delete,
        "insert" => KeyCode::Insert,
        "up" => KeyCode::Up,
        "down" => KeyCode::Down,
        "left" => KeyCode::Left,
        "right" => KeyCode::Right,
        "home" => KeyCode::Home,
        "end" => KeyCode::End,
        "page-up" => KeyCode::PageUp,
        "page-down" => KeyCode::PageDown,
        "space" => KeyCode::Char(' '),
        "minus" => KeyCode::Char('-'),
        other if other.len() == 1 => KeyCode::Char(char::from(other.as_bytes()[0])),
        other if other.starts_with('f') => {
            let number = other[1..].parse::<u8>().ok()?;
            if !(1..=MAX_FUNCTION_KEY).contains(&number) {
                return None;
            }
            KeyCode::F(number)
        }
        _ => return None,
    };
    Some(KeyBinding { code, modifiers })
}

pub(super) fn normalize_key_parts(
    code: KeyCode,
    mut modifiers: KeyModifiers,
) -> (KeyCode, KeyModifiers) {
    if code == KeyCode::BackTab {
        return (KeyCode::Tab, modifiers | KeyModifiers::SHIFT);
    }
    let KeyCode::Char(character) = code else {
        return (code, modifiers);
    };
    if modifiers.is_empty() {
        let code = u32::from(character);
        let control = match code {
            0x00 => Some(' '),
            0x01..=0x1a => char::from_u32(code - 0x01 + u32::from('a')),
            _ => None,
        };
        if let Some(control) = control {
            return (KeyCode::Char(control), KeyModifiers::CONTROL);
        }
    }
    if character.is_ascii_uppercase() {
        modifiers.insert(KeyModifiers::SHIFT);
        return (KeyCode::Char(character.to_ascii_lowercase()), modifiers);
    }
    (KeyCode::Char(character), modifiers)
}

pub(super) fn binding_labels<'a>(sets: impl IntoIterator<Item = &'a BindingSet>) -> String {
    let mut labels = Vec::new();
    for label in sets.into_iter().flat_map(BindingSet::labels) {
        if !labels.contains(&label) {
            labels.push(label);
        }
    }
    labels.join("·")
}

pub(super) fn singles(bindings: &[KeyBinding]) -> Vec<Shortcut> {
    bindings.iter().copied().map(Shortcut::Single).collect()
}

pub(super) const fn plain(code: KeyCode) -> KeyBinding {
    KeyBinding::plain(code)
}

pub(super) const fn plain_char(character: char) -> KeyBinding {
    KeyBinding::plain(KeyCode::Char(character))
}

pub(super) const fn ctrl(character: char) -> KeyBinding {
    KeyBinding::control(KeyCode::Char(character))
}

pub(super) const fn shift(character: char) -> KeyBinding {
    KeyBinding::shift(KeyCode::Char(character))
}
