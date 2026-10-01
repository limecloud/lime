//! Resolved keymap snapshot for Codex-shaped TUI interaction surfaces.

mod agents;
mod editor;
mod hints;
mod list;
mod vim;
pub(crate) use agents::{CenterKeymapAction, CenterKeymapContext};
pub(crate) use editor::{EditorAction, EditorKeymap};
pub(crate) use list::{ListAction, ListKeymap};
use vim::{first_stroke, shortcuts_overlap};
pub(crate) use vim::{
    KeymapContext, VimKeymap, VimKeymapAction, VimNormalAction, VimNormalKeymap, VimOperatorAction,
    VimOperatorKeymap, VimSearchAction, VimSearchKeymap, VimTextObjectAction, VimTextObjectKeymap,
};

use crossterm::event::{KeyCode, KeyEvent, KeyEventKind, KeyModifiers};
use lime_core::config::{KeybindingsSpec, TuiKeymap, MAX_FUNCTION_KEY};
use std::sync::Arc;

#[cfg(test)]
const ALT_LABEL: &str = "⌥";
#[cfg(all(not(test), target_os = "macos"))]
const ALT_LABEL: &str = "⌥";
#[cfg(all(not(test), not(target_os = "macos")))]
const ALT_LABEL: &str = "alt";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct KeyBinding {
    code: KeyCode,
    modifiers: KeyModifiers,
}

impl KeyBinding {
    const fn plain(code: KeyCode) -> Self {
        Self {
            code,
            modifiers: KeyModifiers::NONE,
        }
    }

    const fn control(code: KeyCode) -> Self {
        Self {
            code,
            modifiers: KeyModifiers::CONTROL,
        }
    }

    const fn shift(code: KeyCode) -> Self {
        Self {
            code,
            modifiers: KeyModifiers::SHIFT,
        }
    }

    fn is_pressed(self, key: KeyEvent) -> bool {
        matches!(key.kind, KeyEventKind::Press | KeyEventKind::Repeat)
            && self.normalized_parts() == normalize_key_parts(key.code, key.modifiers)
    }

    fn normalized_parts(self) -> (KeyCode, KeyModifiers) {
        normalize_key_parts(self.code, self.modifiers)
    }

    fn display_label(self) -> String {
        let mut label = String::new();
        for (modifier, name) in [
            (KeyModifiers::CONTROL, "ctrl"),
            (KeyModifiers::SHIFT, "shift"),
            (KeyModifiers::ALT, ALT_LABEL),
        ] {
            if self.modifiers.contains(modifier) {
                label.push_str(name);
                if !matches!(name, "⌥" | "⌘" | "^") {
                    label.push('+');
                }
            }
        }
        let key = match self.code {
            KeyCode::Enter => "enter".to_string(),
            KeyCode::Char(' ') => "space".to_string(),
            KeyCode::Up => "↑".to_string(),
            KeyCode::Down => "↓".to_string(),
            KeyCode::Left => "←".to_string(),
            KeyCode::Right => "→".to_string(),
            KeyCode::PageUp => "pgup".to_string(),
            KeyCode::PageDown => "pgdn".to_string(),
            other => other.to_string().to_ascii_lowercase(),
        };
        label.push_str(&key);
        label
    }
}

/// Fixed host shortcuts use the same platform-aware labels as configured bindings.
pub(crate) fn shortcut_label(code: KeyCode, modifiers: KeyModifiers) -> String {
    KeyBinding { code, modifiers }.display_label()
}

#[derive(Clone, Debug, Eq, PartialEq)]
enum Shortcut {
    Single(KeyBinding),
    Chord {
        prefix: KeyBinding,
        completion: KeyBinding,
    },
}

impl Shortcut {
    fn display_label(&self) -> String {
        match self {
            Self::Single(binding) => binding.display_label(),
            Self::Chord { prefix, completion } => {
                format!("{} {}", prefix.display_label(), completion.display_label())
            }
        }
    }
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
struct BindingSet {
    shortcuts: Vec<Shortcut>,
}

impl BindingSet {
    fn resolve(
        configured: Option<&KeybindingsSpec>,
        defaults: Vec<Shortcut>,
        path: &str,
    ) -> Result<Self, String> {
        let shortcuts = if let Some(configured) = configured {
            configured
                .specs()
                .into_iter()
                .map(|spec| parse_shortcut(spec.as_str(), path))
                .collect::<Result<Vec<_>, _>>()?
        } else {
            defaults
        };
        let mut deduplicated = Vec::new();
        for shortcut in shortcuts {
            if !deduplicated.contains(&shortcut) {
                deduplicated.push(shortcut);
            }
        }
        Ok(Self {
            shortcuts: deduplicated,
        })
    }

    fn is_pressed(&self, key: KeyEvent) -> bool {
        self.shortcuts.iter().any(
            |shortcut| matches!(shortcut, Shortcut::Single(binding) if binding.is_pressed(key)),
        )
    }

    fn labels(&self) -> impl Iterator<Item = String> + '_ {
        self.shortcuts.iter().map(Shortcut::display_label)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum KeymapMatch<A> {
    PassThrough,
    Pending,
    Completed(A),
    Cancelled,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub(crate) struct KeyChordMatcher {
    pending: Option<KeyBinding>,
}

impl KeyChordMatcher {
    fn advance<A: Copy>(&mut self, key: KeyEvent, actions: &[(A, &BindingSet)]) -> KeymapMatch<A> {
        if !matches!(key.kind, KeyEventKind::Press | KeyEventKind::Repeat) {
            return KeymapMatch::PassThrough;
        }
        if let Some(prefix) = self.pending.take() {
            return actions
                .iter()
                .find_map(|(action, bindings)| {
                    bindings
                        .shortcuts
                        .iter()
                        .find_map(|shortcut| match shortcut {
                            Shortcut::Chord {
                                prefix: expected,
                                completion,
                            } if prefix.normalized_parts() == expected.normalized_parts()
                                && completion.is_pressed(key) =>
                            {
                                Some(*action)
                            }
                            _ => None,
                        })
                })
                .map(KeymapMatch::Completed)
                .unwrap_or(KeymapMatch::Cancelled);
        }
        if let Some(action) = actions
            .iter()
            .find_map(|(action, bindings)| bindings.is_pressed(key).then_some(*action))
        {
            return KeymapMatch::Completed(action);
        }
        let prefix = actions.iter().find_map(|(_, bindings)| {
            bindings
                .shortcuts
                .iter()
                .find_map(|shortcut| match shortcut {
                    Shortcut::Chord { prefix, .. } if prefix.is_pressed(key) => Some(*prefix),
                    _ => None,
                })
        });
        if let Some(prefix) = prefix {
            self.pending = Some(prefix);
            KeymapMatch::Pending
        } else {
            KeymapMatch::PassThrough
        }
    }

    pub(crate) fn reset(&mut self) {
        self.pending = None;
    }

    pub(crate) fn is_pending(&self) -> bool {
        self.pending.is_some()
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum GlobalKeymapAction {
    OpenAgents,
    OpenTranscript,
    FindTranscript,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum PagerKeymapAction {
    ScrollUp,
    ScrollDown,
    PageUp,
    PageDown,
    HalfPageUp,
    HalfPageDown,
    JumpTop,
    JumpBottom,
    Close,
    CloseTranscript,
    Find,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum AgentsKeymapAction {
    Resume,
    Search,
    NewTask,
    Rename,
    Stop,
    ToggleGrouping,
}

/// Transcript actions and visible hints resolved from one startup snapshot.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct TranscriptKeymap {
    open_agents: BindingSet,
    open_transcript: BindingSet,
    find_transcript: BindingSet,
    scroll_up: BindingSet,
    scroll_down: BindingSet,
    page_up: BindingSet,
    page_down: BindingSet,
    half_page_up: BindingSet,
    half_page_down: BindingSet,
    jump_top: BindingSet,
    jump_bottom: BindingSet,
    close: BindingSet,
    close_transcript: BindingSet,
    find: BindingSet,
}

impl TranscriptKeymap {
    pub(crate) fn dispatch_global(
        &self,
        matcher: &mut KeyChordMatcher,
        key: KeyEvent,
    ) -> KeymapMatch<GlobalKeymapAction> {
        matcher.advance(
            key,
            &[
                (GlobalKeymapAction::OpenAgents, &self.open_agents),
                (GlobalKeymapAction::OpenTranscript, &self.open_transcript),
                (GlobalKeymapAction::FindTranscript, &self.find_transcript),
            ],
        )
    }

    pub(crate) fn dispatch_pager(
        &self,
        matcher: &mut KeyChordMatcher,
        key: KeyEvent,
    ) -> KeymapMatch<PagerKeymapAction> {
        matcher.advance(
            key,
            &[
                (PagerKeymapAction::ScrollUp, &self.scroll_up),
                (PagerKeymapAction::ScrollDown, &self.scroll_down),
                (PagerKeymapAction::PageUp, &self.page_up),
                (PagerKeymapAction::PageDown, &self.page_down),
                (PagerKeymapAction::HalfPageUp, &self.half_page_up),
                (PagerKeymapAction::HalfPageDown, &self.half_page_down),
                (PagerKeymapAction::JumpTop, &self.jump_top),
                (PagerKeymapAction::JumpBottom, &self.jump_bottom),
                (PagerKeymapAction::Close, &self.close),
                (PagerKeymapAction::CloseTranscript, &self.close_transcript),
                (PagerKeymapAction::Find, &self.find),
            ],
        )
    }

    #[cfg(test)]
    pub(crate) fn open_transcript(&self, key: KeyEvent) -> bool {
        self.open_transcript.is_pressed(key)
    }

    #[cfg(test)]
    pub(crate) fn find_transcript(&self, key: KeyEvent) -> bool {
        self.find_transcript.is_pressed(key)
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct AgentsKeymap {
    resume: BindingSet,
    search: BindingSet,
    new_task: BindingSet,
    rename: BindingSet,
    stop: BindingSet,
    toggle_grouping: BindingSet,
}

/// Immutable runtime snapshot resolved once from the App Server user config layer.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct RuntimeKeymap {
    transcript: TranscriptKeymap,
    agents: AgentsKeymap,
    list: ListKeymap,
    pub(crate) editor: Arc<EditorKeymap>,
    pub(crate) vim_normal: Arc<VimNormalKeymap>,
    pub(crate) vim_operator: Arc<VimOperatorKeymap>,
    pub(crate) vim_text_object: Arc<VimTextObjectKeymap>,
    pub(crate) vim_search: Arc<VimSearchKeymap>,
}

impl RuntimeKeymap {
    pub(crate) fn from_config(config: &TuiKeymap) -> Result<Self, String> {
        let global = &config.global;
        let pager = &config.pager;
        let agents_config = &config.agents;
        let transcript = TranscriptKeymap {
            open_agents: BindingSet::resolve(
                global.open_agents.as_ref(),
                Vec::new(),
                "tui.keymap.global.open_agents",
            )?,
            open_transcript: BindingSet::resolve(
                global.open_transcript.as_ref(),
                singles(&[ctrl('t')]),
                "tui.keymap.global.open_transcript",
            )?,
            find_transcript: BindingSet::resolve(
                global.find_transcript.as_ref(),
                singles(&[KeyBinding::plain(KeyCode::F(3))]),
                "tui.keymap.global.find_transcript",
            )?,
            scroll_up: BindingSet::resolve(
                pager.scroll_up.as_ref(),
                singles(&[plain(KeyCode::Up), plain_char('k')]),
                "tui.keymap.pager.scroll_up",
            )?,
            scroll_down: BindingSet::resolve(
                pager.scroll_down.as_ref(),
                singles(&[plain(KeyCode::Down), plain_char('j')]),
                "tui.keymap.pager.scroll_down",
            )?,
            page_up: BindingSet::resolve(
                pager.page_up.as_ref(),
                singles(&[plain(KeyCode::PageUp), shift(' '), ctrl('b')]),
                "tui.keymap.pager.page_up",
            )?,
            page_down: BindingSet::resolve(
                pager.page_down.as_ref(),
                singles(&[plain(KeyCode::PageDown), plain_char(' '), ctrl('f')]),
                "tui.keymap.pager.page_down",
            )?,
            half_page_up: BindingSet::resolve(
                pager.half_page_up.as_ref(),
                singles(&[ctrl('u')]),
                "tui.keymap.pager.half_page_up",
            )?,
            half_page_down: BindingSet::resolve(
                pager.half_page_down.as_ref(),
                singles(&[ctrl('d')]),
                "tui.keymap.pager.half_page_down",
            )?,
            jump_top: BindingSet::resolve(
                pager.jump_top.as_ref(),
                singles(&[plain(KeyCode::Home)]),
                "tui.keymap.pager.jump_top",
            )?,
            jump_bottom: BindingSet::resolve(
                pager.jump_bottom.as_ref(),
                singles(&[plain(KeyCode::End)]),
                "tui.keymap.pager.jump_bottom",
            )?,
            close: BindingSet::resolve(
                pager.close.as_ref(),
                singles(&[plain(KeyCode::Esc), plain_char('q')]),
                "tui.keymap.pager.close",
            )?,
            close_transcript: BindingSet::resolve(
                pager.close_transcript.as_ref(),
                singles(&[ctrl('t')]),
                "tui.keymap.pager.close_transcript",
            )?,
            find: BindingSet::resolve(
                pager.find.as_ref(),
                singles(&[plain(KeyCode::F(3)), plain_char('/')]),
                "tui.keymap.pager.find",
            )?,
        };
        let agents = AgentsKeymap {
            resume: BindingSet::resolve(
                agents_config.resume.as_ref(),
                singles(&[plain_char('o')]),
                "tui.keymap.agents.resume",
            )?,
            search: BindingSet::resolve(
                agents_config.search.as_ref(),
                singles(&[plain_char('f')]),
                "tui.keymap.agents.search",
            )?,
            new_task: BindingSet::resolve(
                agents_config.new_task.as_ref(),
                singles(&[plain_char('n')]),
                "tui.keymap.agents.new_task",
            )?,
            rename: BindingSet::resolve(
                agents_config.rename.as_ref(),
                singles(&[plain_char('r')]),
                "tui.keymap.agents.rename",
            )?,
            stop: BindingSet::resolve(
                agents_config.stop.as_ref(),
                singles(&[plain_char('x')]),
                "tui.keymap.agents.stop",
            )?,
            toggle_grouping: BindingSet::resolve(
                agents_config.toggle_grouping.as_ref(),
                singles(&[plain_char('g')]),
                "tui.keymap.agents.toggle_grouping",
            )?,
        };

        validate_context(
            "global",
            &[
                ("open_agents", &transcript.open_agents),
                ("open_transcript", &transcript.open_transcript),
                ("find_transcript", &transcript.find_transcript),
            ],
        )?;
        validate_context(
            "pager",
            &[
                ("scroll_up", &transcript.scroll_up),
                ("scroll_down", &transcript.scroll_down),
                ("page_up", &transcript.page_up),
                ("page_down", &transcript.page_down),
                ("half_page_up", &transcript.half_page_up),
                ("half_page_down", &transcript.half_page_down),
                ("jump_top", &transcript.jump_top),
                ("jump_bottom", &transcript.jump_bottom),
                ("close", &transcript.close),
                ("close_transcript", &transcript.close_transcript),
                ("find", &transcript.find),
            ],
        )?;
        validate_context(
            "agents",
            &[
                ("resume", &agents.resume),
                ("search", &agents.search),
                ("new_task", &agents.new_task),
                ("rename", &agents.rename),
                ("stop", &agents.stop),
                ("toggle_grouping", &agents.toggle_grouping),
            ],
        )?;
        let editor = EditorKeymap::from_config(&config.editor)?;
        editor.validate_main_surface(&transcript)?;
        let mut resolved = Self {
            transcript,
            agents,
            list: ListKeymap::from_config(&config.list)?,
            editor: Arc::new(editor),
            vim_normal: Arc::new(VimNormalKeymap::from_config(&config.vim_normal)?),
            vim_operator: Arc::new(VimOperatorKeymap::from_config(&config.vim_operator)?),
            vim_text_object: Arc::new(VimTextObjectKeymap::from_config(&config.vim_text_object)?),
            vim_search: Arc::new(VimSearchKeymap::from_config(&config.vim_search)?),
        };
        resolved.configure_vim()?;
        Ok(resolved)
    }

    pub(crate) fn transcript(&self) -> &TranscriptKeymap {
        &self.transcript
    }

    pub(crate) fn agents(&self) -> &AgentsKeymap {
        &self.agents
    }

    pub(crate) fn list(&self) -> &ListKeymap {
        &self.list
    }
}

impl Default for RuntimeKeymap {
    fn default() -> Self {
        Self::from_config(&TuiKeymap::default())
            .expect("built-in TUI keymap defaults must be valid")
    }
}

impl Default for TranscriptKeymap {
    fn default() -> Self {
        RuntimeKeymap::default().transcript
    }
}

impl Default for AgentsKeymap {
    fn default() -> Self {
        RuntimeKeymap::default().agents
    }
}

fn validate_context(context: &str, actions: &[(&str, &BindingSet)]) -> Result<(), String> {
    validate_context_bindings(context, actions, false)
}

fn validate_modal_context(context: &str, actions: &[(&str, &BindingSet)]) -> Result<(), String> {
    validate_context_bindings(context, actions, true)
}

fn validate_context_bindings(
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

fn parse_shortcut(spec: &str, path: &str) -> Result<Shortcut, String> {
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

fn invalid_binding(path: &str, spec: &str) -> String {
    format!("Invalid `{path}` = `{spec}`. Use values like `ctrl-a`, `shift-enter`, or `ctrl-x f`.")
}

fn parse_keybinding(spec: &str) -> Option<KeyBinding> {
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

fn normalize_key_parts(code: KeyCode, mut modifiers: KeyModifiers) -> (KeyCode, KeyModifiers) {
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

fn binding_labels<'a>(sets: impl IntoIterator<Item = &'a BindingSet>) -> String {
    let mut labels = Vec::new();
    for label in sets.into_iter().flat_map(BindingSet::labels) {
        if !labels.contains(&label) {
            labels.push(label);
        }
    }
    labels.join("·")
}

fn singles(bindings: &[KeyBinding]) -> Vec<Shortcut> {
    bindings.iter().copied().map(Shortcut::Single).collect()
}

const fn plain(code: KeyCode) -> KeyBinding {
    KeyBinding::plain(code)
}

const fn plain_char(character: char) -> KeyBinding {
    KeyBinding::plain(KeyCode::Char(character))
}

const fn ctrl(character: char) -> KeyBinding {
    KeyBinding::control(KeyCode::Char(character))
}

const fn shift(character: char) -> KeyBinding {
    KeyBinding::shift(KeyCode::Char(character))
}

#[cfg(test)]
#[path = "keymap/tests.rs"]
mod tests;
