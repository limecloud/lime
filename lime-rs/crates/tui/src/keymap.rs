//! Resolved keymap snapshot for Lime-native TUI interaction surfaces.

mod agents;
mod editor;
mod hints;
mod parsing;

use parsing::*;
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

/// The queued-input edit shortcut is a host action rather than a configurable editor binding.
/// Keep its dispatch predicate and visible label together so the affordance cannot drift from
/// the key handled by `App::handle_key_event`.
pub(crate) fn queued_input_edit_matches(key: KeyEvent) -> bool {
    key.kind == KeyEventKind::Press
        && key.code == KeyCode::Up
        && key.modifiers.contains(KeyModifiers::ALT)
}

pub(crate) fn queued_input_edit_shortcut_label() -> String {
    shortcut_label(KeyCode::Up, KeyModifiers::ALT)
}

#[derive(Clone, Debug, Eq, PartialEq)]
enum Shortcut {
    Single(KeyBinding),
    Chord {
        prefix: KeyBinding,
        completion: KeyBinding,
    },
}

impl KeyBinding {
    /// Canonical config spec accepted by `normalize_keybinding_spec`.
    fn spec(&self) -> String {
        let mut parts = Vec::new();
        for (modifier, name) in [
            (KeyModifiers::CONTROL, "ctrl"),
            (KeyModifiers::ALT, "alt"),
            (KeyModifiers::SHIFT, "shift"),
        ] {
            if self.modifiers.contains(modifier) {
                parts.push(name.to_string());
            }
        }
        let key = match self.code {
            KeyCode::Enter => "enter".to_string(),
            KeyCode::Tab => "tab".to_string(),
            KeyCode::Backspace => "backspace".to_string(),
            KeyCode::Esc => "esc".to_string(),
            KeyCode::Delete => "delete".to_string(),
            KeyCode::Insert => "insert".to_string(),
            KeyCode::Up => "up".to_string(),
            KeyCode::Down => "down".to_string(),
            KeyCode::Left => "left".to_string(),
            KeyCode::Right => "right".to_string(),
            KeyCode::Home => "home".to_string(),
            KeyCode::End => "end".to_string(),
            KeyCode::PageUp => "page-up".to_string(),
            KeyCode::PageDown => "page-down".to_string(),
            KeyCode::Char(' ') => "space".to_string(),
            KeyCode::Char('-') => "minus".to_string(),
            KeyCode::Char(character) if character.is_ascii() => {
                character.to_ascii_lowercase().to_string()
            }
            KeyCode::F(number) => format!("f{number}"),
            other => other.to_string().to_ascii_lowercase(),
        };
        parts.push(key);
        parts.join("-")
    }
}

impl Shortcut {
    fn spec(&self) -> String {
        match self {
            Self::Single(binding) => binding.spec(),
            Self::Chord { prefix, completion } => {
                format!("{} {}", prefix.spec(), completion.spec())
            }
        }
    }

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
    fn specs(&self) -> Vec<String> {
        self.shortcuts.iter().map(Shortcut::spec).collect()
    }

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

pub(crate) fn key_event_spec(key: KeyEvent) -> String {
    KeyBinding {
        code: key.code,
        modifiers: key.modifiers,
    }
    .spec()
}

#[derive(Debug, Clone)]
pub(crate) struct KeymapEntry {
    pub path: String,
    pub keys: Vec<String>,
    pub specs: Vec<String>,
}

impl RuntimeKeymap {
    /// Flat, display-only view of the effective bindings with their config paths.
    pub(crate) fn describe(&self) -> Vec<KeymapEntry> {
        let mut entries = Vec::new();
        for (path, set) in [
            (
                "tui.keymap.global.open_agents",
                &self.transcript.open_agents,
            ),
            (
                "tui.keymap.global.open_transcript",
                &self.transcript.open_transcript,
            ),
            (
                "tui.keymap.global.find_transcript",
                &self.transcript.find_transcript,
            ),
            ("tui.keymap.pager.scroll_up", &self.transcript.scroll_up),
            ("tui.keymap.pager.scroll_down", &self.transcript.scroll_down),
            ("tui.keymap.pager.page_up", &self.transcript.page_up),
            ("tui.keymap.pager.page_down", &self.transcript.page_down),
            (
                "tui.keymap.pager.half_page_up",
                &self.transcript.half_page_up,
            ),
            (
                "tui.keymap.pager.half_page_down",
                &self.transcript.half_page_down,
            ),
            ("tui.keymap.pager.jump_top", &self.transcript.jump_top),
            ("tui.keymap.pager.jump_bottom", &self.transcript.jump_bottom),
            ("tui.keymap.pager.close", &self.transcript.close),
            (
                "tui.keymap.pager.close_transcript",
                &self.transcript.close_transcript,
            ),
            ("tui.keymap.pager.find", &self.transcript.find),
            ("tui.keymap.agents.resume", &self.agents.resume),
            ("tui.keymap.agents.search", &self.agents.search),
            ("tui.keymap.agents.new_task", &self.agents.new_task),
            ("tui.keymap.agents.rename", &self.agents.rename),
            ("tui.keymap.agents.stop", &self.agents.stop),
            (
                "tui.keymap.agents.toggle_grouping",
                &self.agents.toggle_grouping,
            ),
        ] {
            entries.push(KeymapEntry {
                path: path.to_string(),
                keys: set.labels().collect(),
                specs: set.specs(),
            });
        }
        for (name, specs) in self.list.describe() {
            let path = match name {
                "move_up" => "tui.keymap.list.move_up",
                "move_down" => "tui.keymap.list.move_down",
                "move_left" => "tui.keymap.list.move_left",
                "move_right" => "tui.keymap.list.move_right",
                "page_up" => "tui.keymap.list.page_up",
                "page_down" => "tui.keymap.list.page_down",
                "jump_top" => "tui.keymap.list.jump_top",
                "jump_bottom" => "tui.keymap.list.jump_bottom",
                "accept" => "tui.keymap.list.accept",
                "cancel" => "tui.keymap.list.cancel",
                _ => continue,
            };
            entries.push(KeymapEntry {
                path: path.to_string(),
                keys: specs.clone(),
                specs,
            });
        }
        for (name, specs) in self.editor.describe() {
            let path = match name {
                "insert_newline" => "tui.keymap.editor.insert_newline",
                "move_left" => "tui.keymap.editor.move_left",
                "move_right" => "tui.keymap.editor.move_right",
                "move_up" => "tui.keymap.editor.move_up",
                "move_down" => "tui.keymap.editor.move_down",
                "move_word_left" => "tui.keymap.editor.move_word_left",
                "move_word_right" => "tui.keymap.editor.move_word_right",
                "move_line_start" => "tui.keymap.editor.move_line_start",
                "move_line_end" => "tui.keymap.editor.move_line_end",
                "delete_backward" => "tui.keymap.editor.delete_backward",
                "delete_forward" => "tui.keymap.editor.delete_forward",
                "delete_backward_word" => "tui.keymap.editor.delete_backward_word",
                "delete_forward_word" => "tui.keymap.editor.delete_forward_word",
                "kill_line_start" => "tui.keymap.editor.kill_line_start",
                "kill_whole_line" => "tui.keymap.editor.kill_whole_line",
                "kill_line_end" => "tui.keymap.editor.kill_line_end",
                "yank" => "tui.keymap.editor.yank",
                _ => continue,
            };
            entries.push(KeymapEntry {
                path: path.to_string(),
                keys: specs.clone(),
                specs,
            });
        }
        for (context, items) in [
            ("vim_normal", self.vim_normal.describe()),
            ("vim_operator", self.vim_operator.describe()),
            ("vim_text_object", self.vim_text_object.describe()),
            ("vim_search", self.vim_search.describe()),
        ] {
            for (name, specs) in items {
                entries.push(KeymapEntry {
                    path: format!("tui.keymap.{context}.{name}"),
                    keys: specs.clone(),
                    specs,
                });
            }
        }
        entries
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

#[cfg(test)]
#[path = "keymap/tests.rs"]
mod tests;
