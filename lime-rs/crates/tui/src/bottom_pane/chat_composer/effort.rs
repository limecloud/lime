//! Effort effects are composer presentation state; settings and status facts stay upstream.

use super::super::effort_ignition::{effort_animation_enabled, IGNITION_FRAME_TICK};
use super::super::effort_status_line::EFFORT_STATUS_LINE_FRAME_TICK;
use super::super::footer::{self, FooterProps};
use super::*;
use crate::terminal_palette::effective_stdout_color_level;
use crate::tui::FrameRequester;
use ratatui::layout::Rect;
use ratatui::Frame;

impl ChatComposer {
    pub(crate) fn set_frame_requester(&mut self, frame_requester: FrameRequester) {
        self.frame_requester = Some(frame_requester);
    }

    pub(crate) fn set_active_reasoning_effort(
        &mut self,
        effort: Option<&str>,
        animations_enabled: bool,
    ) {
        let tier = EffortTier::from_effort(effort);
        let baseline = !self.effort_observed;
        self.effort_observed = true;
        if self.effort_tier == tier {
            if !animations_enabled {
                self.effort_ignition = None;
                self.effort_status_line_transition = None;
            }
            return;
        }
        self.effort_tier = tier;
        self.effort_ignition = None;
        self.effort_status_line_transition = None;
        if !baseline && effort_animation_enabled(animations_enabled, effective_stdout_color_level())
        {
            if let Some(tier) = tier {
                let style = IgnitionStyle::random(self.effort_animation_style);
                self.effort_ignition = Some(EffortIgnition::new(tier, style));
                self.effort_animation_style = Some(style);
                if let Some(previous) = self.footer.passive_status_line.borrow().clone() {
                    self.effort_status_line_transition =
                        Some(EffortStatusLineTransition::new(tier, previous));
                }
                if let Some(requester) = &self.frame_requester {
                    requester.schedule_frame();
                }
            }
        }
    }

    pub(crate) fn set_active_reasoning_effort_baseline(&mut self, effort: Option<&str>) {
        self.effort_tier = EffortTier::from_effort(effort);
        self.effort_observed = true;
        self.effort_ignition = None;
        self.effort_status_line_transition = None;
        self.footer.passive_status_line.borrow_mut().take();
    }

    pub(super) fn effort_charge_alpha(&self) -> f32 {
        self.effort_ignition
            .as_ref()
            .filter(|ignition| !ignition.is_finished())
            .map_or(1.0, EffortIgnition::charge_alpha)
    }

    pub(super) fn render_effort_ignition(
        &self,
        frame: &mut Frame<'_>,
        area: Rect,
        protected: Rect,
    ) {
        if self.popups.active() {
            return;
        }
        if let Some(ignition) = self
            .effort_ignition
            .as_ref()
            .filter(|effect| !effect.is_finished())
        {
            if ignition.render(area, protected, frame.buffer_mut()) {
                if let Some(requester) = &self.frame_requester {
                    requester.schedule_frame_in(IGNITION_FRAME_TICK);
                }
            }
        }
    }

    pub(crate) fn render_footer(&self, frame: &mut Frame<'_>, area: Rect, props: &FooterProps) {
        // Keep an unanimated presentation snapshot, never an interpolated frame or business fact.
        *self.footer.passive_status_line.borrow_mut() = props
            .status_line_enabled
            .then(|| footer::passive_footer_status_line(props))
            .flatten();
        let transition = self
            .effort_status_line_transition
            .as_ref()
            .filter(|effect| !effect.is_finished());
        if footer::render_footer(frame, area, props, transition) {
            if let Some(requester) = &self.frame_requester {
                requester.schedule_frame_in(EFFORT_STATUS_LINE_FRAME_TICK);
            }
        }
    }
}

#[cfg(test)]
#[path = "effort_tests.rs"]
mod tests;
