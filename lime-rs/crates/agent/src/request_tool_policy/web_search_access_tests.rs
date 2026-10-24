use super::*;
use agent_protocol::WebSearchMode;

#[test]
fn required_search_does_not_override_disabled_access() {
    let policy =
        resolve_request_tool_policy_with_mode(Some(true), Some(RequestToolPolicyMode::Required))
            .with_web_search_mode(WebSearchMode::Disabled);
    assert!(!policy.allows_web_search());
    assert!(!policy.requires_web_search());
    assert!(policy.required_tools.is_empty());
    assert!(policy.allowed_tools.is_empty());
    assert_eq!(policy.web_search_mode, WebSearchMode::Disabled);
}

#[test]
fn access_and_call_intent_remain_independent() {
    for mode in [
        WebSearchMode::Cached,
        WebSearchMode::Indexed,
        WebSearchMode::Live,
    ] {
        let policy = resolve_request_tool_policy_with_mode(
            Some(true),
            Some(RequestToolPolicyMode::Required),
        )
        .with_web_search_mode(mode);
        assert!(policy.requires_web_search());
        assert_eq!(policy.web_search_mode, mode);
        let off = resolve_request_tool_policy_with_mode(
            Some(false),
            Some(RequestToolPolicyMode::Required),
        )
        .with_web_search_mode(mode);
        assert_eq!(off.web_search_mode, WebSearchMode::Disabled);
    }
}
