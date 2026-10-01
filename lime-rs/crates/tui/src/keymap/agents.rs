//! Task and list shortcuts share one chord owner; editing never dispatches task actions.

use super::*;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum CenterKeymapAction {
    Task(AgentsKeymapAction),
    List(ListAction),
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum CenterKeymapContext {
    Tasks,
    Search,
    Input,
    Help,
}

impl AgentsKeymap {
    fn actions(&self) -> [(AgentsKeymapAction, &BindingSet); 6] {
        [
            (AgentsKeymapAction::Resume, &self.resume),
            (AgentsKeymapAction::Search, &self.search),
            (AgentsKeymapAction::NewTask, &self.new_task),
            (AgentsKeymapAction::Rename, &self.rename),
            (AgentsKeymapAction::Stop, &self.stop),
            (AgentsKeymapAction::ToggleGrouping, &self.toggle_grouping),
        ]
    }

    pub(crate) fn reserves_key(&self, key: KeyEvent) -> bool {
        self.actions().into_iter().any(|(_, bindings)| {
            bindings.shortcuts.iter().any(|shortcut| match shortcut {
                Shortcut::Single(binding) => binding.is_pressed(key),
                Shortcut::Chord { prefix, .. } => prefix.is_pressed(key),
            })
        })
    }

    pub(super) fn shadows(&self, shortcut: &Shortcut) -> bool {
        self.actions().into_iter().any(|(_, bindings)| {
            bindings.shortcuts.iter().any(|task| {
                task == shortcut
                    || matches!((task, shortcut),
                (Shortcut::Single(single), Shortcut::Chord { prefix, .. })
                | (Shortcut::Chord { prefix, .. }, Shortcut::Single(single))
                    if single.normalized_parts() == prefix.normalized_parts())
            })
        })
    }

    pub(crate) fn primary_hint(&self, action: AgentsKeymapAction) -> Option<String> {
        self.actions()
            .into_iter()
            .find(|(candidate, _)| *candidate == action)?
            .1
            .labels()
            .next()
    }

    pub(crate) fn dispatch_center(
        &self,
        list: &ListKeymap,
        matcher: &mut KeyChordMatcher,
        key: KeyEvent,
        context: CenterKeymapContext,
    ) -> KeymapMatch<CenterKeymapAction> {
        let mut actions = Vec::new();
        if context == CenterKeymapContext::Tasks {
            actions.extend(
                self.actions()
                    .into_iter()
                    .map(|(action, bindings)| (CenterKeymapAction::Task(action), bindings.clone())),
            );
        }
        actions.extend(
            list.binding_actions(key, context != CenterKeymapContext::Tasks, matcher)
                .into_iter()
                .filter(|(action, _)| match context {
                    CenterKeymapContext::Help => *action == ListAction::Cancel,
                    CenterKeymapContext::Input => {
                        matches!(action, ListAction::Accept | ListAction::Cancel)
                    }
                    _ => true,
                })
                .map(|(action, bindings)| {
                    let mut bindings = bindings.clone();
                    if context == CenterKeymapContext::Tasks {
                        // A task chord prefix outranks an overlapping list single, too.
                        // Retain reachable alternatives using the same filter as footer hints.
                        bindings
                            .shortcuts
                            .retain(|shortcut| !self.shadows(shortcut));
                    }
                    (CenterKeymapAction::List(action), bindings)
                }),
        );
        let actions = actions
            .iter()
            .map(|(action, bindings)| (*action, bindings))
            .collect::<Vec<_>>();
        matcher.advance(key, &actions)
    }

    #[cfg(test)]
    pub(crate) fn resume(&self, key: KeyEvent) -> bool {
        self.resume.is_pressed(key)
    }
    #[cfg(test)]
    pub(crate) fn search(&self, key: KeyEvent) -> bool {
        self.search.is_pressed(key)
    }
    #[cfg(test)]
    pub(crate) fn new_task(&self, key: KeyEvent) -> bool {
        self.new_task.is_pressed(key)
    }
    #[cfg(test)]
    pub(crate) fn rename(&self, key: KeyEvent) -> bool {
        self.rename.is_pressed(key)
    }
    #[cfg(test)]
    pub(crate) fn stop(&self, key: KeyEvent) -> bool {
        self.stop.is_pressed(key)
    }
    #[cfg(test)]
    pub(crate) fn toggle_grouping(&self, key: KeyEvent) -> bool {
        self.toggle_grouping.is_pressed(key)
    }
}
