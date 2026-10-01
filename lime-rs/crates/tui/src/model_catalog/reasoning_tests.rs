use super::*;
use crate::model_catalog::tests::model;
use ReasoningShortcutDirection::{Lower, Raise};

fn catalog(levels: &[&str], default: &str) -> ModelCatalog {
    let mut preset = model("reasoner", "provider", false);
    preset.default_reasoning_effort = default.into();
    preset.supported_reasoning_efforts = levels
        .iter()
        .map(|level| ReasoningEffortOption {
            reasoning_effort: (*level).into(),
            description: format!("description for {level}"),
        })
        .collect();
    ModelCatalog::new(vec![preset])
}

fn step(
    catalog: &ModelCatalog,
    current: Option<&str>,
    direction: ReasoningShortcutDirection,
) -> Option<ReasoningStep> {
    catalog.reasoning_step(Some("reasoner"), Some("provider"), current, direction)
}

#[test]
fn unset_and_unsupported_anchor_to_the_advertised_default_before_stepping() {
    let catalog = catalog(&["low", "medium", "high"], "medium");
    for current in [None, Some("unsupported")] {
        assert_eq!(
            step(&catalog, current, Raise),
            Some(ReasoningStep::Change("high".into()))
        );
        assert_eq!(
            step(&catalog, current, Lower),
            Some(ReasoningStep::Change("low".into()))
        );
    }
}

#[test]
fn default_absent_from_choices_anchors_to_first_advertised_choice() {
    let catalog = catalog(&["high", "low", "future"], "medium");
    assert_eq!(
        step(&catalog, None, Raise),
        Some(ReasoningStep::Change("low".into()))
    );
    assert_eq!(
        step(&catalog, Some("unsupported"), Lower),
        Some(ReasoningStep::Bound("high".into()))
    );
    assert_eq!(
        step(&catalog, Some("low"), Raise),
        Some(ReasoningStep::Change("future".into()))
    );
}

#[test]
fn bounds_do_not_wrap_or_invent_supported_choices() {
    let catalog = catalog(&["none", "high"], "high");
    assert_eq!(
        step(&catalog, Some("none"), Lower),
        Some(ReasoningStep::Bound("none".into()))
    );
    assert_eq!(
        step(&catalog, Some("high"), Raise),
        Some(ReasoningStep::Bound("high".into()))
    );
    assert_eq!(
        step(&catalog, Some("none"), Raise),
        Some(ReasoningStep::Change("high".into()))
    );
}

#[test]
fn advanced_choices_follow_normal_order_and_ultra_requires_explicit_selection() {
    let catalog = catalog(&["ultra", "high", "max", "low", "future"], "high");
    let options = reasoning_options(&catalog.models[0]);
    assert_eq!(
        options
            .iter()
            .map(|option| option.reasoning_effort.as_str())
            .collect::<Vec<_>>(),
        ["high", "low", "future", "max", "ultra"]
    );
    assert_eq!(options[0].description, "description for high");
    assert_eq!(
        step(&catalog, Some("future"), Raise),
        Some(ReasoningStep::Change("max".into()))
    );
    assert_eq!(
        step(&catalog, Some("max"), Raise),
        Some(ReasoningStep::Advanced)
    );
    assert_eq!(
        step(&catalog, Some("ultra"), Lower),
        Some(ReasoningStep::Change("max".into()))
    );
    assert_eq!(
        step(&catalog, Some("ultra"), Raise),
        Some(ReasoningStep::Bound("ultra".into()))
    );
}

#[test]
fn empty_choices_use_only_the_server_default_and_blank_catalog_fails_closed() {
    let single = catalog(&[], "server-default");
    for direction in [Lower, Raise] {
        assert_eq!(
            step(&single, None, direction),
            Some(ReasoningStep::Bound("server-default".into()))
        );
        assert_eq!(step(&catalog(&[], ""), None, direction), None);
        assert_eq!(step(&catalog(&["", " "], "medium"), None, direction), None);
    }
}

#[test]
fn model_and_provider_identity_must_resolve_uniquely() {
    let mut catalog = catalog(&["low", "high"], "low");
    assert_eq!(
        catalog.reasoning_step(None, Some("provider"), None, Raise),
        None
    );
    assert_eq!(
        catalog.reasoning_step(Some("wrong"), Some("provider"), None, Raise),
        None
    );
    assert_eq!(
        catalog.reasoning_step(Some("reasoner"), Some("wrong"), None, Raise),
        None
    );
    let mut second = catalog.models[0].clone();
    second.provider_id = "other".into();
    second.supported_reasoning_efforts[1].reasoning_effort = "future".into();
    catalog.models.push(second);
    assert_eq!(
        catalog.reasoning_step(Some("reasoner"), None, None, Raise),
        None
    );
    assert_eq!(
        step(&catalog, None, Raise),
        Some(ReasoningStep::Change("high".into()))
    );
    assert_eq!(
        catalog.reasoning_step(Some("reasoner"), Some("other"), None, Raise),
        Some(ReasoningStep::Change("future".into()))
    );
    catalog.models.push(catalog.models[0].clone());
    assert_eq!(step(&catalog, None, Raise), None);
}
