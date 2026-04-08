//! Property-based tests for Context Isolation
//!
//! These tests validate the correctness properties defined in the design document
//! using the proptest framework.
//!
//! **Feature: agents-alignment**

#[cfg(test)]
mod property_tests {
    use crate::agents::context::isolation::{
        ContextIsolation, ResourceUsage, SandboxRestrictions, SandboxState, SandboxedContext,
    };
    use crate::agents::context::types::AgentContext;
    use proptest::prelude::*;
    use std::collections::HashSet;

    // Strategy for generating resource limits
    fn resource_limits_strategy() -> impl Strategy<Value = (usize, usize, usize)> {
        (
            1usize..1000usize, // max_tokens
            1usize..100usize,  // max_files
            1usize..100usize,  // max_tool_results
        )
    }

    // Strategy for generating resource usage within limits
    fn resource_usage_within_limits_strategy(
        max_tokens: usize,
        max_files: usize,
        max_tool_results: usize,
    ) -> impl Strategy<Value = ResourceUsage> {
        (
            0usize..=max_tokens,
            0usize..=max_files,
            0usize..=max_tool_results,
            0usize..100usize,
        )
            .prop_map(|(tokens, files, tool_results, tool_calls)| ResourceUsage {
                tokens_used: tokens,
                files_accessed: files,
                tool_results_count: tool_results,
                tool_calls_made: tool_calls,
            })
    }

    // Strategy for generating resource usage that exceeds at least one limit
    fn resource_usage_exceeding_limits_strategy(
        max_tokens: usize,
        max_files: usize,
        max_tool_results: usize,
    ) -> impl Strategy<Value = ResourceUsage> {
        prop_oneof![
            // Exceed tokens
            (
                (max_tokens + 1)..=(max_tokens * 2),
                0usize..=max_files,
                0usize..=max_tool_results
            )
                .prop_map(|(tokens, files, tool_results)| ResourceUsage {
                    tokens_used: tokens,
                    files_accessed: files,
                    tool_results_count: tool_results,
                    tool_calls_made: 0,
                }),
            // Exceed files
            (
                0usize..=max_tokens,
                (max_files + 1)..=(max_files * 2),
                0usize..=max_tool_results
            )
                .prop_map(|(tokens, files, tool_results)| ResourceUsage {
                    tokens_used: tokens,
                    files_accessed: files,
                    tool_results_count: tool_results,
                    tool_calls_made: 0,
                }),
            // Exceed tool results
            (
                0usize..=max_tokens,
                0usize..=max_files,
                (max_tool_results + 1)..=(max_tool_results * 2)
            )
                .prop_map(|(tokens, files, tool_results)| ResourceUsage {
                    tokens_used: tokens,
                    files_accessed: files,
                    tool_results_count: tool_results,
                    tool_calls_made: 0,
                }),
        ]
    }

    // Strategy for generating tool names
    fn tool_name_strategy() -> impl Strategy<Value = String> {
        "[a-z][a-z0-9_]{0,15}".prop_map(|s| s.to_string())
    }

    // Strategy for generating a set of tool names
    fn tool_set_strategy() -> impl Strategy<Value = HashSet<String>> {
        prop::collection::hash_set(tool_name_strategy(), 0..10)
    }

    // Strategy for generating sandbox restrictions with tool permissions
    fn sandbox_restrictions_with_tools_strategy() -> impl Strategy<Value = SandboxRestrictions> {
        (
            resource_limits_strategy(),
            prop::option::of(tool_set_strategy()),
            prop::option::of(tool_set_strategy()),
        )
            .prop_map(
                |((max_tokens, max_files, max_tool_results), allowed, denied)| {
                    let mut restrictions =
                        SandboxRestrictions::new(max_tokens, max_files, max_tool_results);
                    restrictions.allowed_tools = allowed;
                    restrictions.denied_tools = denied;
                    restrictions
                },
            )
    }

    // **Property 8: Sandbox Resource Limit Enforcement**
    //
    // *For any* sandbox with configured limits, exceeding any limit (tokens, files, tool results)
    // SHALL result in sandbox suspension.
    //
    // **Validates: Requirements 2.1, 2.2, 2.3, 2.5**
    proptest! {
        #![proptest_config(ProptestConfig::with_cases(100))]

        #[test]
        fn property_8_sandbox_resource_limit_enforcement(
            (max_tokens, max_files, max_tool_results) in resource_limits_strategy()
        ) {
            let restrictions = SandboxRestrictions::new(max_tokens, max_files, max_tool_results);
            let context = AgentContext::new();
            let mut sandbox = SandboxedContext::new(context, "test-agent", Some(restrictions));

            // Initially sandbox should be active
            prop_assert_eq!(sandbox.state, SandboxState::Active);

            // Test token limit enforcement
            let result = sandbox.record_tokens(max_tokens + 1);
            prop_assert!(result.is_err(), "Should fail when exceeding token limit");
            prop_assert_eq!(
                sandbox.state,
                SandboxState::Suspended,
                "Sandbox should be suspended after exceeding token limit"
            );

            // Reset for next test
            let context = AgentContext::new();
            let restrictions = SandboxRestrictions::new(max_tokens, max_files, max_tool_results);
            let mut sandbox = SandboxedContext::new(context, "test-agent-2", Some(restrictions));

            // Test file limit enforcement
            for _ in 0..=max_files {
                let _ = sandbox.record_file_access();
            }
            prop_assert_eq!(
                sandbox.state,
                SandboxState::Suspended,
                "Sandbox should be suspended after exceeding file limit"
            );

            // Reset for next test
            let context = AgentContext::new();
            let restrictions = SandboxRestrictions::new(max_tokens, max_files, max_tool_results);
            let mut sandbox = SandboxedContext::new(context, "test-agent-3", Some(restrictions));

            // Test tool results limit enforcement
            for _ in 0..=max_tool_results {
                let _ = sandbox.record_tool_result();
            }
            prop_assert_eq!(
                sandbox.state,
                SandboxState::Suspended,
                "Sandbox should be suspended after exceeding tool results limit"
            );
        }

        #[test]
        fn property_8_within_limits_stays_active(
            (max_tokens, max_files, max_tool_results) in resource_limits_strategy()
        ) {
            let restrictions = SandboxRestrictions::new(max_tokens, max_files, max_tool_results);
            let context = AgentContext::new();
            let mut sandbox = SandboxedContext::new(context, "test-agent", Some(restrictions));

            // Record usage within limits
            if max_tokens > 0 {
                let result = sandbox.record_tokens(max_tokens - 1);
                prop_assert!(result.is_ok(), "Should succeed when within token limit");
            }

            // Sandbox should still be active
            prop_assert_eq!(
                sandbox.state,
                SandboxState::Active,
                "Sandbox should remain active when within limits"
            );
        }

        #[test]
        fn property_8_check_limits_detects_violations(
            (max_tokens, max_files, max_tool_results) in resource_limits_strategy()
        ) {
            let restrictions = SandboxRestrictions::new(max_tokens, max_files, max_tool_results);

            // Test within limits - no violation
            let usage_within = ResourceUsage {
                tokens_used: max_tokens.saturating_sub(1),
                files_accessed: max_files.saturating_sub(1),
                tool_results_count: max_tool_results.saturating_sub(1),
                tool_calls_made: 0,
            };
            prop_assert!(
                restrictions.check_limits(&usage_within).is_none(),
                "Should not detect violation when within limits"
            );

            // Test exceeding tokens
            let usage_exceed_tokens = ResourceUsage {
                tokens_used: max_tokens + 1,
                files_accessed: 0,
                tool_results_count: 0,
                tool_calls_made: 0,
            };
            prop_assert!(
                restrictions.check_limits(&usage_exceed_tokens).is_some(),
                "Should detect token limit violation"
            );

            // Test exceeding files
            let usage_exceed_files = ResourceUsage {
                tokens_used: 0,
                files_accessed: max_files + 1,
                tool_results_count: 0,
                tool_calls_made: 0,
            };
            prop_assert!(
                restrictions.check_limits(&usage_exceed_files).is_some(),
                "Should detect file limit violation"
            );

            // Test exceeding tool results
            let usage_exceed_tool_results = ResourceUsage {
                tokens_used: 0,
                files_accessed: 0,
                tool_results_count: max_tool_results + 1,
                tool_calls_made: 0,
            };
            prop_assert!(
                restrictions.check_limits(&usage_exceed_tool_results).is_some(),
                "Should detect tool results limit violation"
            );
        }
    }

    // **Property 9: Sandbox Tool Permission Enforcement**
    //
    // *For any* sandbox with allowed/denied tool lists, tool access checks SHALL correctly
    // allow or deny based on the configuration.
    //
    // **Validates: Requirements 2.4**
    proptest! {
        #![proptest_config(ProptestConfig::with_cases(100))]

        #[test]
        fn property_9_allowed_tools_whitelist(
            allowed_tools in tool_set_strategy(),
            test_tool in tool_name_strategy()
        ) {
            // Skip if allowed_tools is empty (no whitelist)
            if allowed_tools.is_empty() {
                return Ok(());
            }

            let restrictions = SandboxRestrictions::default()
                .with_allowed_tools(allowed_tools.clone());

            // Tools in the allowed list should be allowed
            for tool in &allowed_tools {
                prop_assert!(
                    restrictions.is_tool_allowed(tool),
                    "Tool '{}' should be allowed when in allowed list",
                    tool
                );
            }

            // Tools not in the allowed list should be denied
            if !allowed_tools.contains(&test_tool) {
                prop_assert!(
                    !restrictions.is_tool_allowed(&test_tool),
                    "Tool '{}' should be denied when not in allowed list",
                    test_tool
                );
            }
        }

        #[test]
        fn property_9_denied_tools_blacklist(
            denied_tools in tool_set_strategy(),
            test_tool in tool_name_strategy()
        ) {
            let restrictions = SandboxRestrictions::default()
                .with_denied_tools(denied_tools.clone());

            // Tools in the denied list should be denied
            for tool in &denied_tools {
                prop_assert!(
                    !restrictions.is_tool_allowed(tool),
                    "Tool '{}' should be denied when in denied list",
                    tool
                );
            }

            // Tools not in the denied list should be allowed (no whitelist)
            if !denied_tools.contains(&test_tool) {
                prop_assert!(
                    restrictions.is_tool_allowed(&test_tool),
                    "Tool '{}' should be allowed when not in denied list",
                    test_tool
                );
            }
        }

        #[test]
        fn property_9_denied_takes_precedence(
            tool_name in tool_name_strategy()
        ) {
            // When a tool is in both allowed and denied lists, denied should take precedence
            let restrictions = SandboxRestrictions::default()
                .with_allowed_tools(vec![tool_name.clone()])
                .with_denied_tools(vec![tool_name.clone()]);

            prop_assert!(
                !restrictions.is_tool_allowed(&tool_name),
                "Tool '{}' should be denied when in both allowed and denied lists",
                tool_name
            );
        }

        #[test]
        fn property_9_no_restrictions_allows_all(
            test_tool in tool_name_strategy()
        ) {
            // With no allowed/denied lists, all tools should be allowed
            let restrictions = SandboxRestrictions::default();

            prop_assert!(
                restrictions.is_tool_allowed(&test_tool),
                "Tool '{}' should be allowed when no restrictions are set",
                test_tool
            );
        }

        #[test]
        fn property_9_context_isolation_tool_check(
            allowed_tools in tool_set_strategy(),
            denied_tools in tool_set_strategy(),
            test_tool in tool_name_strategy()
        ) {
            let mut isolation = ContextIsolation::new();
            let context = AgentContext::new();

            let mut restrictions = SandboxRestrictions::default();
            if !allowed_tools.is_empty() {
                restrictions = restrictions.with_allowed_tools(allowed_tools.clone());
            }
            if !denied_tools.is_empty() {
                restrictions = restrictions.with_denied_tools(denied_tools.clone());
            }

            let sandbox = isolation.create_sandbox(
                context,
                Some("test-agent".to_string()),
                Some(restrictions.clone()),
            );

            // Verify tool permission through ContextIsolation matches SandboxRestrictions
            let expected = restrictions.is_tool_allowed(&test_tool);
            let actual = isolation.is_tool_allowed(&sandbox.sandbox_id, &test_tool);

            prop_assert_eq!(
                actual,
                expected,
                "ContextIsolation.is_tool_allowed should match SandboxRestrictions.is_tool_allowed for tool '{}'",
                test_tool
            );
        }

        #[test]
        fn property_9_nonexistent_sandbox_denies_all(
            test_tool in tool_name_strategy()
        ) {
            let isolation = ContextIsolation::new();

            // Non-existent sandbox should deny all tools
            prop_assert!(
                !isolation.is_tool_allowed("nonexistent-sandbox", &test_tool),
                "Non-existent sandbox should deny tool '{}'",
                test_tool
            );
        }
    }

    // Strategy for generating sandbox states
    fn sandbox_state_strategy() -> impl Strategy<Value = SandboxState> {
        prop_oneof![
            Just(SandboxState::Active),
            Just(SandboxState::Suspended),
            Just(SandboxState::Terminated),
        ]
    }

    // Strategy for generating TTL in seconds (negative for expired, positive for valid)
    #[allow(dead_code)]
    fn ttl_seconds_strategy() -> impl Strategy<Value = i64> {
        prop_oneof![
            -3600i64..-1i64, // Expired (negative TTL)
            1i64..3600i64,   // Valid (positive TTL)
        ]
    }

    // **Property 10: Sandbox State Transitions**
    //
    // *For any* sandbox, state transitions SHALL follow valid paths:
    // active → suspended → terminated, and cleanup SHALL remove expired sandboxes.
    //
    // **Validates: Requirements 2.6, 2.7**
    proptest! {
        #![proptest_config(ProptestConfig::with_cases(100))]

        #[test]
        fn property_10_valid_state_transitions(
            initial_state in sandbox_state_strategy(),
            target_state in sandbox_state_strategy()
        ) {
            // Test that can_transition_to correctly validates state transitions
            let can_transition = initial_state.can_transition_to(target_state);

            match (initial_state, target_state) {
                // Active can go to Suspended or Terminated
                (SandboxState::Active, SandboxState::Suspended) => {
                    prop_assert!(can_transition, "Active should be able to transition to Suspended");
                }
                (SandboxState::Active, SandboxState::Terminated) => {
                    prop_assert!(can_transition, "Active should be able to transition to Terminated");
                }
                // Suspended can go to Active (resume) or Terminated
                (SandboxState::Suspended, SandboxState::Active) => {
                    prop_assert!(can_transition, "Suspended should be able to transition to Active");
                }
                (SandboxState::Suspended, SandboxState::Terminated) => {
                    prop_assert!(can_transition, "Suspended should be able to transition to Terminated");
                }
                // Terminated is final - cannot transition to any state (including itself)
                (SandboxState::Terminated, _) => {
                    prop_assert!(!can_transition, "Terminated should not be able to transition to any state");
                }
                // Same state transitions are allowed for non-Terminated states (no-op)
                (s1, s2) if s1 == s2 => {
                    prop_assert!(can_transition, "Same state transition should be allowed for non-Terminated states");
                }
                _ => {}
            }
        }

        #[test]
        fn property_10_cleanup_removes_sandbox(
            agent_id in "[a-z][a-z0-9_]{0,10}"
        ) {
            let mut isolation = ContextIsolation::new();
            let context = AgentContext::new();
            let sandbox = isolation.create_sandbox(context, Some(agent_id.clone()), None);
            let sandbox_id = sandbox.sandbox_id.clone();

            // Verify sandbox exists
            prop_assert!(isolation.get_sandbox(&sandbox_id).is_some(), "Sandbox should exist before cleanup");
            prop_assert!(isolation.get_isolated_context(&agent_id).is_some(), "Context should be accessible by agent ID");

            // Cleanup the sandbox
            isolation.cleanup(&sandbox_id);

            // Verify sandbox is removed
            prop_assert!(isolation.get_sandbox(&sandbox_id).is_none(), "Sandbox should not exist after cleanup");
            prop_assert!(isolation.get_isolated_context(&agent_id).is_none(), "Context should not be accessible after cleanup");
        }

        #[test]
        fn property_10_cleanup_expired_removes_only_expired(
            num_valid in 1usize..5usize,
            num_expired in 1usize..5usize
        ) {
            use chrono::Duration;

            let mut isolation = ContextIsolation::new();

            // Create valid (non-expired) sandboxes
            let mut valid_ids = Vec::new();
            for i in 0..num_valid {
                let context = AgentContext::new();
                let sandbox = isolation.create_sandbox_with_ttl(
                    context,
                    Some(format!("valid-agent-{}", i)),
                    None,
                    Duration::hours(1), // 1 hour TTL - not expired
                );
                valid_ids.push(sandbox.sandbox_id.clone());
            }

            // Create expired sandboxes
            let mut expired_ids = Vec::new();
            for i in 0..num_expired {
                let context = AgentContext::new();
                let sandbox = isolation.create_sandbox_with_ttl(
                    context,
                    Some(format!("expired-agent-{}", i)),
                    None,
                    Duration::seconds(-1), // Negative TTL - already expired
                );
                expired_ids.push(sandbox.sandbox_id.clone());
            }

            // Verify initial counts
            prop_assert_eq!(
                isolation.sandbox_count(),
                num_valid + num_expired,
                "Should have all sandboxes before cleanup"
            );

            // Cleanup expired sandboxes
            let cleaned_count = isolation.cleanup_expired();

            // Verify cleanup results
            prop_assert_eq!(
                cleaned_count,
                num_expired,
                "Should have cleaned up exactly the expired sandboxes"
            );
            prop_assert_eq!(
                isolation.sandbox_count(),
                num_valid,
                "Should have only valid sandboxes remaining"
            );

            // Verify valid sandboxes still exist
            for id in &valid_ids {
                prop_assert!(
                    isolation.get_sandbox(id).is_some(),
                    "Valid sandbox {} should still exist",
                    id
                );
            }

            // Verify expired sandboxes are removed
            for id in &expired_ids {
                prop_assert!(
                    isolation.get_sandbox(id).is_none(),
                    "Expired sandbox {} should be removed",
                    id
                );
            }
        }
    }

    // Tests without proptest parameters need to be regular unit tests
    #[test]
    fn property_10_suspend_resume_cycle() {
        let mut isolation = ContextIsolation::new();
        let context = AgentContext::new();
        let sandbox = isolation.create_sandbox(context, Some("test-agent".to_string()), None);
        let sandbox_id = sandbox.sandbox_id.clone();

        // Initial state should be Active
        assert_eq!(
            isolation.get_sandbox(&sandbox_id).unwrap().state,
            SandboxState::Active,
            "Initial state should be Active"
        );

        // Suspend should succeed
        let suspend_result = isolation.suspend(&sandbox_id);
        assert!(
            suspend_result.is_ok(),
            "Suspend should succeed from Active state"
        );
        assert_eq!(
            isolation.get_sandbox(&sandbox_id).unwrap().state,
            SandboxState::Suspended,
            "State should be Suspended after suspend"
        );

        // Resume should succeed
        let resume_result = isolation.resume(&sandbox_id);
        assert!(
            resume_result.is_ok(),
            "Resume should succeed from Suspended state"
        );
        assert_eq!(
            isolation.get_sandbox(&sandbox_id).unwrap().state,
            SandboxState::Active,
            "State should be Active after resume"
        );
    }

    #[test]
    fn property_10_terminated_is_final() {
        let mut isolation = ContextIsolation::new();
        let context = AgentContext::new();
        let sandbox = isolation.create_sandbox(context, Some("test-agent".to_string()), None);
        let sandbox_id = sandbox.sandbox_id.clone();

        // Terminate the sandbox
        let terminate_result = isolation.terminate(&sandbox_id);
        assert!(
            terminate_result.is_ok(),
            "Terminate should succeed from Active state"
        );
        assert_eq!(
            isolation.get_sandbox(&sandbox_id).unwrap().state,
            SandboxState::Terminated,
            "State should be Terminated after terminate"
        );

        // Resume should fail from Terminated state
        let resume_result = isolation.resume(&sandbox_id);
        assert!(
            resume_result.is_err(),
            "Resume should fail from Terminated state"
        );

        // Suspend should fail from Terminated state
        let suspend_result = isolation.suspend(&sandbox_id);
        assert!(
            suspend_result.is_err(),
            "Suspend should fail from Terminated state"
        );

        // State should still be Terminated
        assert_eq!(
            isolation.get_sandbox(&sandbox_id).unwrap().state,
            SandboxState::Terminated,
            "State should remain Terminated after failed transitions"
        );
    }

    #[test]
    fn property_10_suspend_from_suspended_is_noop() {
        let mut isolation = ContextIsolation::new();
        let context = AgentContext::new();
        let sandbox = isolation.create_sandbox(context, Some("test-agent".to_string()), None);
        let sandbox_id = sandbox.sandbox_id.clone();

        // Suspend the sandbox
        isolation.suspend(&sandbox_id).unwrap();
        assert_eq!(
            isolation.get_sandbox(&sandbox_id).unwrap().state,
            SandboxState::Suspended
        );

        // Suspending again should succeed (same state transition is allowed)
        let result = isolation.suspend(&sandbox_id);
        assert!(
            result.is_ok(),
            "Suspending an already suspended sandbox should succeed"
        );
        assert_eq!(
            isolation.get_sandbox(&sandbox_id).unwrap().state,
            SandboxState::Suspended,
            "State should remain Suspended"
        );
    }

    #[test]
    fn property_10_list_sandboxes_by_state() {
        let mut isolation = ContextIsolation::new();

        // Create sandboxes in different states
        let context1 = AgentContext::new();
        let sandbox1 = isolation.create_sandbox(context1, Some("agent-1".to_string()), None);

        let context2 = AgentContext::new();
        let sandbox2 = isolation.create_sandbox(context2, Some("agent-2".to_string()), None);
        isolation.suspend(&sandbox2.sandbox_id).unwrap();

        let context3 = AgentContext::new();
        let sandbox3 = isolation.create_sandbox(context3, Some("agent-3".to_string()), None);
        isolation.terminate(&sandbox3.sandbox_id).unwrap();

        // Verify listing by state
        let active = isolation.list_sandboxes_by_state(SandboxState::Active);
        assert_eq!(active.len(), 1, "Should have 1 active sandbox");
        assert_eq!(active[0].sandbox_id, sandbox1.sandbox_id);

        let suspended = isolation.list_sandboxes_by_state(SandboxState::Suspended);
        assert_eq!(suspended.len(), 1, "Should have 1 suspended sandbox");
        assert_eq!(suspended[0].sandbox_id, sandbox2.sandbox_id);

        let terminated = isolation.list_sandboxes_by_state(SandboxState::Terminated);
        assert_eq!(terminated.len(), 1, "Should have 1 terminated sandbox");
        assert_eq!(terminated[0].sandbox_id, sandbox3.sandbox_id);
    }
}
