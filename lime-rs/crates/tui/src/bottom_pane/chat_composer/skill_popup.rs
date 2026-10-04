//! Skill completion popup for `$` mentions.
//!
//! The popup is presentation-only. Skill metadata comes from the App Server `skills/list`
//! response and the composer remains responsible for replacing the active draft token.

use app_server_protocol::protocol::v2::SkillMetadata;
use crossterm::event::{Event, KeyCode, KeyEventKind, KeyModifiers};
use ratatui::layout::Rect;
use ratatui::style::Stylize;
use ratatui::text::Line;
use ratatui::widgets::Paragraph;
use ratatui::Frame;

use super::super::picker_rows::render_rows_single_line;
use super::super::scroll_state::ScrollState;
use super::super::selection_row_layout::{SelectionRow, MAX_POPUP_ROWS};
use crate::fuzzy_match::fuzzy_match;
use crate::line_truncation::truncate_line_with_ellipsis_if_overflow;
use crate::locale::Locale;
use crate::text_formatting::truncate_text;

type SkillMatch = (usize, Option<Vec<usize>>, i32);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SkillPopupAction {
    Pass,
    Consumed,
    Cancel,
    Complete,
}

#[derive(Debug, Clone)]
pub(crate) struct SkillPopup {
    query: String,
    skills: Vec<SkillMetadata>,
    state: ScrollState,
}

impl SkillPopup {
    pub(crate) fn new(skills: Vec<SkillMetadata>, query: impl Into<String>) -> Self {
        let mut popup = Self {
            query: query.into(),
            skills,
            state: ScrollState::default(),
        };
        popup.state.clamp_selection(popup.matches().len());
        popup
    }

    pub(crate) fn set_query(&mut self, query: impl Into<String>) {
        self.query = query.into();
        self.state.clamp_selection(self.matches().len());
    }

    pub(crate) fn set_skills(&mut self, skills: Vec<SkillMetadata>) {
        self.skills = skills;
        self.state.clamp_selection(self.matches().len());
    }

    pub(crate) fn selected_skill(&self) -> Option<&SkillMetadata> {
        self.state.selected_idx.and_then(|index| {
            self.matches()
                .get(index)
                .and_then(|(index, _, _)| self.skills.get(*index))
        })
    }

    pub(crate) fn handle_event(&mut self, event: &Event) -> SkillPopupAction {
        let Event::Key(key) = event else {
            return SkillPopupAction::Pass;
        };
        if key.kind != KeyEventKind::Press {
            return SkillPopupAction::Pass;
        }
        match key.code {
            KeyCode::Up | KeyCode::Char('p')
                if key.code == KeyCode::Up || key.modifiers.contains(KeyModifiers::CONTROL) =>
            {
                let len = self.matches().len();
                self.state.move_up_wrap(len);
                SkillPopupAction::Consumed
            }
            KeyCode::Down | KeyCode::Char('n')
                if key.code == KeyCode::Down || key.modifiers.contains(KeyModifiers::CONTROL) =>
            {
                let len = self.matches().len();
                self.state.move_down_wrap(len);
                SkillPopupAction::Consumed
            }
            KeyCode::Esc => SkillPopupAction::Cancel,
            KeyCode::Enter | KeyCode::Tab if self.selected_skill().is_some() => {
                SkillPopupAction::Complete
            }
            KeyCode::Enter | KeyCode::Tab => SkillPopupAction::Consumed,
            _ => SkillPopupAction::Pass,
        }
    }

    #[cfg(test)]
    fn render(&self, frame: &mut Frame<'_>, composer_area: Rect, locale: Locale) {
        self.render_with_clip_top(frame, composer_area, locale, 0);
    }

    pub(crate) fn render_with_clip_top(
        &self,
        frame: &mut Frame<'_>,
        composer_area: Rect,
        locale: Locale,
        clip_top: u16,
    ) {
        if composer_area.width == 0 {
            return;
        }
        let matches = self.matches();
        let available_above = composer_area.y.saturating_sub(clip_top);
        let height = u16::try_from(matches.len().clamp(1, MAX_POPUP_ROWS))
            .unwrap_or(u16::MAX)
            .saturating_add(3)
            .min(available_above);
        if height == 0 {
            return;
        }
        let area = Rect::new(
            composer_area.x,
            composer_area.y.saturating_sub(height),
            composer_area.width,
            height,
        );
        let footer = if height >= 2 { 1 } else { 0 };
        let list_area = Rect::new(
            area.x,
            area.y,
            area.width,
            area.height.saturating_sub(footer),
        );
        let rows = matches
            .into_iter()
            .enumerate()
            .map(|(visible, (index, indices, _))| {
                let skill = &self.skills[index];
                let description = skill_description(skill);
                let mut row = SelectionRow::new(
                    truncate_text(&skill_display_name(skill), 28),
                    (!description.is_empty()).then_some(description),
                    vec![if Some(visible) == self.state.selected_idx {
                        "› "
                    } else {
                        "  "
                    }
                    .into()],
                );
                row.match_indices = indices;
                row.category_tag = Some(locale.completion_skill_tag().to_string());
                row
            })
            .collect::<Vec<_>>();
        render_rows_single_line(
            frame,
            list_area,
            &rows,
            &self.state,
            locale.skill_popup_no_matches(),
        );
        if footer > 0 {
            let hint = truncate_line_with_ellipsis_if_overflow(
                Line::from(locale.skill_popup_footer()).dim(),
                usize::from(area.width.saturating_sub(2)),
            );
            frame.render_widget(
                Paragraph::new(hint),
                Rect::new(
                    area.x + 2.min(area.width),
                    area.bottom() - 1,
                    area.width.saturating_sub(2),
                    1,
                ),
            );
        }
    }

    fn matches(&self) -> Vec<SkillMatch> {
        let query = self.query.trim();
        let mut matches = self
            .skills
            .iter()
            .enumerate()
            .filter_map(|(index, skill)| {
                let display = skill_display_name(skill);
                let (indices, score) = if query.is_empty() {
                    (None, 0)
                } else if let Some((indices, score)) = fuzzy_match(&display, query) {
                    (Some(indices), score)
                } else {
                    let (_, score) = fuzzy_match(&skill.name, query)?;
                    (None, score)
                };
                Some((index, indices, score))
            })
            .collect::<Vec<_>>();
        matches.sort_by(
            |(left_index, left_indices, left_score), (right_index, right_indices, right_score)| {
                left_indices
                    .is_none()
                    .cmp(&right_indices.is_none())
                    .then_with(|| left_score.cmp(right_score))
                    .then_with(|| {
                        skill_display_name(&self.skills[*left_index])
                            .cmp(&skill_display_name(&self.skills[*right_index]))
                    })
            },
        );
        matches
    }
}

fn skill_display_name(skill: &SkillMetadata) -> String {
    skill
        .interface
        .as_ref()
        .and_then(|interface| interface.display_name.as_deref())
        .filter(|name| !name.trim().is_empty())
        .unwrap_or(&skill.name)
        .to_string()
}

fn skill_description(skill: &SkillMetadata) -> String {
    skill
        .interface
        .as_ref()
        .and_then(|interface| interface.short_description.as_deref())
        .or(skill.short_description.as_deref())
        .unwrap_or(&skill.description)
        .trim()
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use app_server_protocol::protocol::v2::SkillScope;
    use crossterm::event::KeyEvent;
    use ratatui::backend::TestBackend;
    use ratatui::layout::Rect;
    use ratatui::Terminal;

    fn skill(name: &str, description: &str) -> SkillMetadata {
        SkillMetadata {
            name: name.to_string(),
            description: description.to_string(),
            short_description: None,
            interface: None,
            dependencies: None,
            path: format!("/skills/{name}/SKILL.md").into(),
            scope: SkillScope::User,
            enabled: true,
        }
    }

    #[test]
    fn filters_and_ranks_skill_names_case_insensitively() {
        let mut popup = SkillPopup::new(
            vec![skill("deploy", "release"), skill("code-review", "review")],
            "cr",
        );
        assert_eq!(
            popup.selected_skill().map(|skill| skill.name.as_str()),
            Some("code-review")
        );
        popup.set_query("DEP");
        assert_eq!(
            popup.selected_skill().map(|skill| skill.name.as_str()),
            Some("deploy")
        );
    }

    #[test]
    fn selection_wraps_and_enter_completes() {
        let mut popup = SkillPopup::new(vec![skill("one", ""), skill("two", "")], "");
        popup.handle_event(&Event::Key(KeyEvent::new(KeyCode::Up, KeyModifiers::NONE)));
        assert_eq!(
            popup.selected_skill().map(|skill| skill.name.as_str()),
            Some("two")
        );
        assert_eq!(
            popup.handle_event(&Event::Key(KeyEvent::new(
                KeyCode::Enter,
                KeyModifiers::NONE
            ))),
            SkillPopupAction::Complete
        );
    }

    #[test]
    fn control_p_and_control_n_cycle_selection() {
        let mut popup = SkillPopup::new(vec![skill("one", ""), skill("two", "")], "");
        popup.handle_event(&Event::Key(KeyEvent::new(
            KeyCode::Char('n'),
            KeyModifiers::CONTROL,
        )));
        assert_eq!(
            popup.selected_skill().map(|skill| skill.name.as_str()),
            Some("two")
        );
        popup.handle_event(&Event::Key(KeyEvent::new(
            KeyCode::Char('p'),
            KeyModifiers::CONTROL,
        )));
        assert_eq!(
            popup.selected_skill().map(|skill| skill.name.as_str()),
            Some("one")
        );
    }

    #[test]
    fn selected_skill_uses_codex_marker_without_narrow_overflow() {
        let popup = SkillPopup::new(vec![skill("deploy", "release")], "");
        for width in [40, 80, 120] {
            let mut terminal = Terminal::new(TestBackend::new(width, 8)).expect("terminal");
            terminal
                .draw(|frame| popup.render(frame, Rect::new(0, 6, width, 2), Locale::EnUs))
                .expect("draw");
            let buffer = terminal.backend().buffer();
            let text = (0..buffer.area.height)
                .map(|y| {
                    (0..buffer.area.width)
                        .map(|x| buffer[(x, y)].symbol())
                        .collect::<String>()
                })
                .collect::<Vec<_>>();
            assert!(text.iter().any(|line| line.contains("› deploy")));
            assert!(text.iter().any(|line| line.contains("[Skill]")));
            assert!(text
                .iter()
                .all(|line| line.chars().count() <= width as usize));
        }
    }

    #[test]
    fn scrolling_full_matches_keeps_selected_skill_visible_with_overflow_hints() {
        let mut popup = SkillPopup::new(
            (0..10)
                .map(|index| skill(&format!("skill-{index:02}"), "Secondary details"))
                .collect(),
            "",
        );
        assert_eq!(popup.matches().len(), 10);
        for _ in 0..9 {
            popup.handle_event(&Event::Key(KeyEvent::new(
                KeyCode::Down,
                KeyModifiers::NONE,
            )));
        }
        for width in [28, 40, 72] {
            for y in [3, 8, 15] {
                let mut terminal = Terminal::new(TestBackend::new(width, 16)).unwrap();
                terminal
                    .draw(|frame| popup.render(frame, Rect::new(0, y, width, 1), Locale::EnUs))
                    .unwrap();
                let text = terminal
                    .backend()
                    .buffer()
                    .content
                    .iter()
                    .map(|cell| cell.symbol())
                    .collect::<String>();
                assert!(text.contains("› skill-09"), "{width}/{y}: {text}");
                assert!(text.contains("[Skill]"));
                assert!(text.contains("esc close"));
                if y >= 8 {
                    assert!(text.contains('↑'), "{text}");
                }
            }
        }
    }

    #[test]
    fn canonical_name_matches_display_alias_without_fabricating_highlights() {
        let mut canonical = skill("deploy", "release");
        canonical.interface = Some(
            serde_json::from_value(serde_json::json!({"displayName": "Publication"})).unwrap(),
        );
        let popup = SkillPopup::new(vec![canonical], "dep");
        assert_eq!(popup.selected_skill().unwrap().name, "deploy");
        assert_eq!(popup.matches()[0].1, None);
        let popup = SkillPopup::new(vec![skill("İstanbul", "")], "is");
        assert_eq!(popup.matches()[0].1, Some(vec![0, 1]));
    }

    #[test]
    fn display_name_matches_rank_before_canonical_only_matches() {
        let mut alternate = skill("abc", "");
        alternate.interface =
            Some(serde_json::from_value(serde_json::json!({"displayName": "ZZZ"})).unwrap());
        let popup = SkillPopup::new(vec![alternate, skill("a-b-c", "")], "abc");
        assert_eq!(popup.selected_skill().unwrap().name, "a-b-c");
    }

    #[test]
    fn skill_category_and_actual_insert_close_hints_cover_all_locales() {
        for locale in [
            Locale::ZhCn,
            Locale::ZhTw,
            Locale::EnUs,
            Locale::JaJp,
            Locale::KoKr,
        ] {
            let popup = SkillPopup::new(vec![skill("deploy", "Secondary details")], "");
            let mut terminal = Terminal::new(TestBackend::new(72, 8)).unwrap();
            terminal
                .draw(|frame| popup.render(frame, Rect::new(0, 6, 72, 2), locale))
                .unwrap();
            let buffer = terminal.backend().buffer();
            let text = (0..8)
                .map(|y| (0..72).map(|x| buffer[(x, y)].symbol()).collect::<String>())
                .collect::<Vec<_>>()
                .join("\n");
            let compact = |text: &str| {
                text.chars()
                    .filter(|ch| !ch.is_whitespace())
                    .collect::<String>()
            };
            assert!(
                compact(&text).contains(&compact(locale.completion_skill_tag())),
                "{locale:?}: {text}"
            );
            assert!(
                compact(&text).contains(&compact(locale.skill_popup_footer())),
                "{locale:?}: {text}"
            );
        }
    }
}
