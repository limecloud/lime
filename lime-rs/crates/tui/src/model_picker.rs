use app_server_protocol::protocol::v2::Model;
use crossterm::event::{Event, KeyCode, KeyModifiers};
use ratatui::layout::Rect;
use ratatui::Frame;
use std::cell::Cell;
use unicode_segmentation::UnicodeSegmentation;

use crate::bottom_pane::selection_row_layout::MAX_POPUP_ROWS;
use crate::keymap::{KeyChordMatcher, ListKeymap};
use crate::locale::Locale;

mod effort;
mod input;
mod render;
pub(crate) use render::desired_height;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ModelSelection {
    pub(crate) model: String,
    pub(crate) provider: String,
    pub(crate) effort: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ModelPickerAction {
    None,
    Cancel,
    Select(usize),
}

#[derive(Debug, Default)]
pub(crate) struct ModelPicker {
    models: Vec<Model>,
    selected: usize,
    query: String,
    current: Option<usize>,
    current_effort: Option<String>,
    effort_menu: Option<effort::EffortMenu>,
    page_rows: Cell<usize>,
    list_keymap: ListKeymap,
    list_chord_matcher: KeyChordMatcher,
}

impl ModelPicker {
    pub(crate) fn new(models: Vec<Model>) -> Self {
        let mut models = models
            .into_iter()
            .filter(|model| !model.hidden)
            .collect::<Vec<_>>();
        models.sort_by_key(|model| (!model.is_default, model.display_name.to_lowercase()));
        Self {
            models,
            selected: 0,
            query: String::new(),
            current: None,
            current_effort: None,
            effort_menu: None,
            page_rows: Cell::new(MAX_POPUP_ROWS),
            list_keymap: ListKeymap::default(),
            list_chord_matcher: KeyChordMatcher::default(),
        }
    }

    pub(crate) fn with_keymap(mut self, keymap: ListKeymap) -> Self {
        self.list_keymap = keymap;
        self.list_chord_matcher.reset();
        self
    }

    pub(crate) fn with_current(mut self, model: Option<&str>, provider: Option<&str>) -> Self {
        let mut matches = self
            .models
            .iter()
            .enumerate()
            .filter(|(_, entry)| {
                Some(entry.model.as_str()) == model
                    && provider.is_none_or(|provider| entry.provider_id == provider)
            })
            .map(|(index, _)| index);
        let first = matches.next();
        // Without provider identity a shared model name is ambiguous; never guess the first one.
        self.current = first.filter(|_| matches.next().is_none());
        if let Some(index) = self.current {
            self.selected = index;
        }
        self
    }

    pub(crate) fn selected_model(&self, index: usize) -> Option<ModelSelection> {
        let (model_index, effort) = if let Some(menu) = &self.effort_menu {
            (
                menu.model_index,
                Some(menu.value(index)?.reasoning_effort.clone()),
            )
        } else {
            let model_index = *self.visible_indices().get(index)?;
            let effort = crate::model_catalog::reasoning_options(&self.models[model_index])
                .first()
                .map(|option| option.reasoning_effort.clone());
            (model_index, effort)
        };
        let model = self.models.get(model_index)?;
        Some(ModelSelection {
            model: model.model.clone(),
            provider: model.provider_id.clone(),
            effort,
        })
    }

    pub(crate) fn query(&self) -> &str {
        &self.query
    }

    #[cfg(test)]
    fn visible_models(&self) -> Vec<&Model> {
        self.visible_indices()
            .into_iter()
            .filter_map(|index| self.models.get(index))
            .collect()
    }

    fn visible_indices(&self) -> Vec<usize> {
        let query = self.query.trim().to_lowercase();
        self.models
            .iter()
            .enumerate()
            .filter(|(_, model)| {
                query.is_empty()
                    || model.display_name.to_lowercase().contains(&query)
                    || model.model.to_lowercase().contains(&query)
                    || model.provider_id.to_lowercase().contains(&query)
            })
            .map(|(index, _)| index)
            .collect()
    }
}

#[cfg(test)]
pub(crate) fn render(frame: &mut Frame<'_>, area: Rect, picker: &ModelPicker) {
    render_with_locale(frame, area, picker, Locale::default());
}

pub(crate) fn render_with_locale(
    frame: &mut Frame<'_>,
    area: Rect,
    picker: &ModelPicker,
    locale: Locale,
) {
    render::render(frame, area, picker, locale);
}

#[cfg(test)]
mod effort_tests;

#[cfg(test)]
mod keymap_tests;

#[cfg(test)]
mod tests {
    use super::*;
    use app_server_protocol::protocol::v2::{InputModality, Model};
    use app_server_protocol::CapabilitySnapshot;
    use crossterm::event::{KeyEvent, KeyModifiers};
    use ratatui::backend::TestBackend;
    use ratatui::Terminal;

    pub(super) fn model(id: &str, provider: &str, hidden: bool, is_default: bool) -> Model {
        Model {
            id: id.to_string(),
            provider_id: provider.to_string(),
            model: id.to_string(),
            upgrade: None,
            upgrade_info: None,
            availability_nux: None,
            display_name: id.to_string(),
            description: String::new(),
            hidden,
            supported_reasoning_efforts: Vec::new(),
            default_reasoning_effort: "medium".to_string(),
            input_modalities: vec![InputModality::Text],
            capability_snapshot: CapabilitySnapshot::default(),
            context_window: None,
            max_output_tokens: None,
            supports_personality: false,
            multi_agent_version: None,
            additional_speed_tiers: Vec::new(),
            service_tiers: Vec::new(),
            default_service_tier: None,
            is_default,
        }
    }

    #[test]
    fn picker_filters_hidden_models_and_selects_default_first() {
        let mut picker = ModelPicker::new(vec![
            model("slow", "fixture", false, false),
            model("hidden", "fixture", true, false),
            model("fast", "fixture", false, true),
        ]);
        assert_eq!(picker.visible_models().len(), 2);
        assert_eq!(picker.selected_model(0).expect("default").model, "fast");
        picker.handle_event(Event::Key(KeyEvent::new(
            KeyCode::Char('l'),
            KeyModifiers::NONE,
        )));
        assert_eq!(picker.selected_model(0).expect("filtered").model, "slow");
        assert_eq!(
            picker.handle_event(Event::Key(KeyEvent::new(
                KeyCode::Enter,
                KeyModifiers::NONE,
            ))),
            ModelPickerAction::Select(0)
        );
    }

    #[test]
    fn searchable_picker_keeps_plain_vim_letters_for_query_input() {
        let mut picker = ModelPicker::new(vec![
            model("alpha", "fixture", false, true),
            model("jupiter", "fixture", false, false),
            model("kilo", "fixture", false, false),
        ]);

        assert_eq!(
            picker.handle_event(Event::Key(KeyEvent::new(
                KeyCode::Char('j'),
                KeyModifiers::NONE,
            ))),
            ModelPickerAction::None
        );
        assert_eq!(picker.query(), "j");
        assert_eq!(picker.visible_models()[0].model, "jupiter");

        picker.handle_event(Event::Key(KeyEvent::new(
            KeyCode::Backspace,
            KeyModifiers::NONE,
        )));
        picker.handle_event(Event::Key(KeyEvent::new(
            KeyCode::Char('k'),
            KeyModifiers::NONE,
        )));
        assert_eq!(picker.query(), "k");
        assert_eq!(picker.visible_models()[0].model, "kilo");
    }

    #[test]
    fn picker_navigation_wraps_and_accepts_control_bindings() {
        let mut picker = ModelPicker::new(vec![
            model("first", "fixture", false, true),
            model("second", "fixture", false, false),
        ]);

        picker.handle_event(Event::Key(KeyEvent::new(KeyCode::Up, KeyModifiers::NONE)));
        assert_eq!(picker.selected, 1);

        picker.handle_event(Event::Key(KeyEvent::new(
            KeyCode::Char('n'),
            KeyModifiers::CONTROL,
        )));
        assert_eq!(picker.selected, 0);

        picker.handle_event(Event::Key(KeyEvent::new(
            KeyCode::Char('k'),
            KeyModifiers::CONTROL,
        )));
        assert_eq!(picker.selected, 1);
    }

    #[test]
    fn unhandled_control_keys_do_not_pollute_model_query() {
        let mut picker = ModelPicker::new(vec![model("first", "fixture", false, true)]);
        picker.handle_event(Event::Key(KeyEvent::new(
            KeyCode::Char('z'),
            KeyModifiers::CONTROL,
        )));
        assert!(picker.query().is_empty());
    }

    #[test]
    fn picker_escape_cancels_and_render_stays_bounded() {
        let mut picker = ModelPicker::new(vec![model("模型", "提供方", false, true)]);
        assert_eq!(
            picker.handle_event(Event::Key(KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE,))),
            ModelPickerAction::Cancel
        );
        let mut terminal = Terminal::new(TestBackend::new(12, 6)).expect("terminal");
        terminal
            .draw(|frame| render(frame, frame.area(), &picker))
            .expect("draw");
    }

    #[test]
    fn long_model_catalog_keeps_selected_row_inside_bounded_popup() {
        let models = (0..20)
            .map(|index| model(&format!("model-{index:02}"), "fixture", false, index == 0))
            .collect();
        let mut picker = ModelPicker::new(models);
        for _ in 0..12 {
            picker.handle_event(Event::Key(KeyEvent::new(KeyCode::Down, KeyModifiers::NONE)));
        }

        let mut terminal = Terminal::new(TestBackend::new(80, 20)).expect("terminal");
        terminal
            .draw(|frame| render(frame, frame.area(), &picker))
            .expect("draw");
        let buffer = terminal.backend().buffer();
        let text = (0..buffer.area.height)
            .map(|y| {
                (0..buffer.area.width)
                    .map(|x| buffer[(x, y)].symbol())
                    .collect::<String>()
            })
            .collect::<Vec<_>>()
            .join("\n");
        assert!(
            text.contains("model-12"),
            "selected model was clipped: {text}"
        );
        assert!(
            text.contains("› 13. model-12"),
            "selected model marker missing: {text}"
        );
        assert!(text.lines().all(|line| line.chars().count() <= 80));
    }
}
