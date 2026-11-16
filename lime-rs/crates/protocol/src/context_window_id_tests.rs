#![cfg(test)]

use super::ContextWindowId;
use pretty_assertions::assert_eq;
use utils_model_facing_id::ModelFacingIdGenerator;

#[test]
fn restores_allocations_from_the_window_generator() {
    let window = ContextWindowId::Generated(Box::new(
        ModelFacingIdGenerator::new(/*seed*/ 0, "window").fetch_next(),
    ));
    assert_eq!(window.validated(), Some(window));

    let item = ModelFacingIdGenerator::new(/*seed*/ 0, "item").fetch_next();
    assert_eq!(ContextWindowId::Generated(Box::new(item)).validated(), None);
}
