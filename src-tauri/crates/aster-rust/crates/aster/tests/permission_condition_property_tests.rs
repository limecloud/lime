//! Property-based tests for condition evaluation
//!
//! **Property 8: Condition Evaluation**
//! *For any* permission with multiple conditions and a given context,
//! the permission SHALL only match if ALL conditions evaluate to true (AND logic).
//!
//! **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5**

use aster::permission::{ConditionOperator, ConditionType, PermissionCondition, PermissionContext};
use proptest::prelude::*;
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

// ============================================================================
// Arbitrary Generators
// ============================================================================

/// Generate arbitrary PermissionContext
fn arb_permission_context() -> impl Strategy<Value = PermissionContext> {
    (
        prop::collection::vec("[a-z]{1,10}", 1..5), // path segments
        "[a-z0-9-]{8,16}",                          // session_id
        1600000000i64..1900000000i64,               // timestamp
        prop::option::of("[a-z]{3,10}"),            // user
        prop::collection::hash_map("[A-Z_]{3,10}", "[a-zA-Z0-9/:-]{1,20}", 0..3), // environment
    )
        .prop_map(
            |(path_segments, session_id, timestamp, user, environment)| {
                let working_directory = PathBuf::from(format!("/{}", path_segments.join("/")));
                PermissionContext {
                    working_directory,
                    session_id,
                    timestamp,
                    user,
                    environment,
                    metadata: HashMap::new(),
                }
            },
        )
}

/// Generate a condition that will always pass for the given context
fn arb_passing_condition(ctx: &PermissionContext) -> PermissionCondition {
    PermissionCondition {
        condition_type: ConditionType::Session,
        field: Some("session_id".to_string()),
        operator: ConditionOperator::Equals,
        value: Value::String(ctx.session_id.clone()),
        validator: None,
        description: Some("Always passing condition".to_string()),
    }
}

/// Generate a condition that will always fail for the given context
fn arb_failing_condition(ctx: &PermissionContext) -> PermissionCondition {
    PermissionCondition {
        condition_type: ConditionType::Session,
        field: Some("session_id".to_string()),
        operator: ConditionOperator::Equals,
        value: Value::String(format!("{}_invalid", ctx.session_id)),
        validator: None,
        description: Some("Always failing condition".to_string()),
    }
}

/// Generate arbitrary ConditionOperator
fn arb_condition_operator() -> impl Strategy<Value = ConditionOperator> {
    prop_oneof![
        Just(ConditionOperator::Equals),
        Just(ConditionOperator::NotEquals),
        Just(ConditionOperator::Contains),
        Just(ConditionOperator::NotContains),
        Just(ConditionOperator::Matches),
        Just(ConditionOperator::NotMatches),
        Just(ConditionOperator::In),
        Just(ConditionOperator::NotIn),
    ]
}

// ============================================================================
// Property Tests
// ============================================================================

proptest! {
    #![proptest_config(ProptestConfig::with_cases(100))]

    /// **Feature: tool-permission-system, Property 8: Condition Evaluation**
    ///
    /// Property: Empty conditions list always returns true
    /// *For any* context, an empty conditions list SHALL evaluate to true.
    ///
    /// **Validates: Requirements 4.3**
    #[test]
    fn prop_empty_conditions_always_pass(
        ctx in arb_permission_context()
    ) {
        use aster::permission::condition::check_conditions;

        let conditions: Vec<PermissionCondition> = vec![];
        let result = check_conditions(&conditions, &ctx);

        prop_assert!(result, "Empty conditions should always pass");
    }

    /// **Feature: tool-permission-system, Property 8: Condition Evaluation**
    ///
    /// Property: All passing conditions result in true
    /// *For any* context and list of conditions that all pass individually,
    /// check_conditions SHALL return true.
    ///
    /// **Validates: Requirements 4.3**
    #[test]
    fn prop_all_passing_conditions_return_true(
        ctx in arb_permission_context(),
        num_conditions in 1usize..5
    ) {
        use aster::permission::condition::check_conditions;

        // Create multiple passing conditions
        let conditions: Vec<PermissionCondition> = (0..num_conditions)
            .map(|_| arb_passing_condition(&ctx))
            .collect();

        let result = check_conditions(&conditions, &ctx);

        prop_assert!(result, "All passing conditions should result in true");
    }

    /// **Feature: tool-permission-system, Property 8: Condition Evaluation**
    ///
    /// Property: Any failing condition results in false (AND logic)
    /// *For any* context and list of conditions where at least one fails,
    /// check_conditions SHALL return false.
    ///
    /// **Validates: Requirements 4.3**
    #[test]
    fn prop_any_failing_condition_returns_false(
        ctx in arb_permission_context(),
        num_passing in 0usize..4,
        fail_position in 0usize..5
    ) {
        use aster::permission::condition::check_conditions;

        let total = num_passing + 1;
        let fail_pos = fail_position % total;

        // Create conditions with one failing
        let mut conditions: Vec<PermissionCondition> = Vec::new();
        for i in 0..total {
            if i == fail_pos {
                conditions.push(arb_failing_condition(&ctx));
            } else {
                conditions.push(arb_passing_condition(&ctx));
            }
        }

        let result = check_conditions(&conditions, &ctx);

        prop_assert!(!result, "Any failing condition should result in false (AND logic)");
    }

    /// **Feature: tool-permission-system, Property 8: Condition Evaluation**
    ///
    /// Property: Equals operator is symmetric with NotEquals
    /// *For any* field value and condition value, Equals and NotEquals
    /// SHALL produce opposite results.
    ///
    /// **Validates: Requirements 4.2**
    #[test]
    fn prop_equals_not_equals_symmetric(
        ctx in arb_permission_context(),
        match_session in prop::bool::ANY
    ) {
        use aster::permission::condition::evaluate_condition;

        let value = if match_session {
            Value::String(ctx.session_id.clone())
        } else {
            Value::String(format!("{}_different", ctx.session_id))
        };

        let equals_condition = PermissionCondition {
            condition_type: ConditionType::Session,
            field: Some("session_id".to_string()),
            operator: ConditionOperator::Equals,
            value: value.clone(),
            validator: None,
            description: None,
        };

        let not_equals_condition = PermissionCondition {
            condition_type: ConditionType::Session,
            field: Some("session_id".to_string()),
            operator: ConditionOperator::NotEquals,
            value,
            validator: None,
            description: None,
        };

        let equals_result = evaluate_condition(&equals_condition, &ctx);
        let not_equals_result = evaluate_condition(&not_equals_condition, &ctx);

        prop_assert_ne!(
            equals_result, not_equals_result,
            "Equals and NotEquals should produce opposite results"
        );
    }

    /// **Feature: tool-permission-system, Property 8: Condition Evaluation**
    ///
    /// Property: Contains and NotContains are symmetric
    /// *For any* string field and substring, Contains and NotContains
    /// SHALL produce opposite results.
    ///
    /// **Validates: Requirements 4.2**
    #[test]
    fn prop_contains_not_contains_symmetric(
        ctx in arb_permission_context(),
        substring in "[a-z]{1,5}"
    ) {
        use aster::permission::condition::evaluate_condition;

        let contains_condition = PermissionCondition {
            condition_type: ConditionType::Context,
            field: Some("working_directory".to_string()),
            operator: ConditionOperator::Contains,
            value: Value::String(substring.clone()),
            validator: None,
            description: None,
        };

        let not_contains_condition = PermissionCondition {
            condition_type: ConditionType::Context,
            field: Some("working_directory".to_string()),
            operator: ConditionOperator::NotContains,
            value: Value::String(substring),
            validator: None,
            description: None,
        };

        let contains_result = evaluate_condition(&contains_condition, &ctx);
        let not_contains_result = evaluate_condition(&not_contains_condition, &ctx);

        prop_assert_ne!(
            contains_result, not_contains_result,
            "Contains and NotContains should produce opposite results"
        );
    }

    /// **Feature: tool-permission-system, Property 8: Condition Evaluation**
    ///
    /// Property: In and NotIn are symmetric
    /// *For any* value and list, In and NotIn SHALL produce opposite results.
    ///
    /// **Validates: Requirements 4.2**
    #[test]
    fn prop_in_not_in_symmetric(
        ctx in arb_permission_context(),
        include_session in prop::bool::ANY
    ) {
        use aster::permission::condition::evaluate_condition;

        let list = if include_session {
            serde_json::json!([ctx.session_id.clone(), "other1", "other2"])
        } else {
            serde_json::json!(["other1", "other2", "other3"])
        };

        let in_condition = PermissionCondition {
            condition_type: ConditionType::Session,
            field: Some("session_id".to_string()),
            operator: ConditionOperator::In,
            value: list.clone(),
            validator: None,
            description: None,
        };

        let not_in_condition = PermissionCondition {
            condition_type: ConditionType::Session,
            field: Some("session_id".to_string()),
            operator: ConditionOperator::NotIn,
            value: list,
            validator: None,
            description: None,
        };

        let in_result = evaluate_condition(&in_condition, &ctx);
        let not_in_result = evaluate_condition(&not_in_condition, &ctx);

        prop_assert_ne!(
            in_result, not_in_result,
            "In and NotIn should produce opposite results"
        );
    }

    /// **Feature: tool-permission-system, Property 8: Condition Evaluation**
    ///
    /// Property: Range operator correctly validates boundaries
    /// *For any* timestamp within range, Range SHALL return true;
    /// for timestamps outside range, Range SHALL return false.
    ///
    /// **Validates: Requirements 4.2**
    #[test]
    fn prop_range_operator_validates_boundaries(
        ctx in arb_permission_context()
    ) {
        use aster::permission::condition::evaluate_condition;

        let min = ctx.timestamp - 50000000;
        let max = ctx.timestamp + 50000000;

        let range_condition = PermissionCondition {
            condition_type: ConditionType::Time,
            field: Some("timestamp".to_string()),
            operator: ConditionOperator::Range,
            value: serde_json::json!({"min": min, "max": max}),
            validator: None,
            description: None,
        };

        let result = evaluate_condition(&range_condition, &ctx);

        // The context timestamp should always be within the range we constructed
        prop_assert!(result, "Timestamp should be within the constructed range");
    }

    /// **Feature: tool-permission-system, Property 8: Condition Evaluation**
    ///
    /// Property: Missing field causes condition to fail
    /// *For any* condition referencing a non-existent field,
    /// the condition SHALL evaluate to false.
    ///
    /// **Validates: Requirements 4.1, 4.5**
    #[test]
    fn prop_missing_field_fails(
        ctx in arb_permission_context(),
        operator in arb_condition_operator()
    ) {
        use aster::permission::condition::evaluate_condition;

        let condition = PermissionCondition {
            condition_type: ConditionType::Context,
            field: Some("nonexistent_field_xyz".to_string()),
            operator,
            value: Value::String("any_value".to_string()),
            validator: None,
            description: None,
        };

        let result = evaluate_condition(&condition, &ctx);

        prop_assert!(!result, "Missing field should cause condition to fail");
    }

    /// **Feature: tool-permission-system, Property 8: Condition Evaluation**
    ///
    /// Property: Custom validator is invoked for Custom operator
    /// *For any* context, a Custom condition with a validator
    /// SHALL use the validator's result.
    ///
    /// **Validates: Requirements 4.4**
    #[test]
    fn prop_custom_validator_is_used(
        ctx in arb_permission_context(),
        validator_returns in prop::bool::ANY
    ) {
        use aster::permission::condition::evaluate_condition;

        let condition = PermissionCondition {
            condition_type: ConditionType::Custom,
            field: None,
            operator: ConditionOperator::Custom,
            value: Value::Null,
            validator: Some(Arc::new(move |_: &PermissionContext| validator_returns)),
            description: Some("Custom validator test".to_string()),
        };

        let result = evaluate_condition(&condition, &ctx);

        prop_assert_eq!(
            result, validator_returns,
            "Custom validator result should be used"
        );
    }

    /// **Feature: tool-permission-system, Property 8: Condition Evaluation**
    ///
    /// Property: Context field retrieval is consistent
    /// *For any* context, retrieving a known field SHALL return the correct value.
    ///
    /// **Validates: Requirements 4.1**
    #[test]
    fn prop_context_field_retrieval_consistent(
        ctx in arb_permission_context()
    ) {
        use aster::permission::condition::get_context_field;

        // Test working_directory
        let wd = get_context_field(&ctx, "working_directory");
        prop_assert!(wd.is_some(), "working_directory should be retrievable");
        if let Some(Value::String(s)) = wd {
            prop_assert_eq!(s, ctx.working_directory.to_string_lossy().to_string());
        }

        // Test session_id
        let sid = get_context_field(&ctx, "session_id");
        prop_assert!(sid.is_some(), "session_id should be retrievable");
        if let Some(Value::String(s)) = sid {
            prop_assert_eq!(s, ctx.session_id.clone());
        }

        // Test timestamp
        let ts = get_context_field(&ctx, "timestamp");
        prop_assert!(ts.is_some(), "timestamp should be retrievable");
        if let Some(Value::Number(n)) = ts {
            prop_assert_eq!(n.as_i64(), Some(ctx.timestamp));
        }

        // Test user (may be None)
        let user = get_context_field(&ctx, "user");
        match &ctx.user {
            Some(u) => {
                prop_assert!(user.is_some(), "user should be retrievable when set");
                if let Some(Value::String(s)) = user {
                    prop_assert_eq!(s, u.clone());
                }
            }
            None => {
                prop_assert!(user.is_none(), "user should be None when not set");
            }
        }
    }

    /// **Feature: tool-permission-system, Property 8: Condition Evaluation**
    ///
    /// Property: Environment variables are accessible via field path
    /// *For any* context with environment variables, they SHALL be
    /// accessible via "environment.<key>" field path.
    ///
    /// **Validates: Requirements 4.1**
    #[test]
    fn prop_environment_field_accessible(
        ctx in arb_permission_context()
    ) {
        use aster::permission::condition::get_context_field;

        for (key, value) in &ctx.environment {
            let field_path = format!("environment.{}", key);
            let retrieved = get_context_field(&ctx, &field_path);

            prop_assert!(
                retrieved.is_some(),
                "Environment variable {} should be retrievable",
                key
            );

            if let Some(Value::String(s)) = retrieved {
                prop_assert_eq!(
                    s, value.clone(),
                    "Environment variable {} should have correct value",
                    key
                );
            }
        }
    }
}

// ============================================================================
// Additional Unit Tests for Edge Cases
// ============================================================================

#[cfg(test)]
mod edge_case_tests {
    use super::*;
    use aster::permission::condition::{evaluate_condition, get_context_field};

    fn create_test_context() -> PermissionContext {
        let mut environment = HashMap::new();
        environment.insert("PATH".to_string(), "/usr/bin:/bin".to_string());

        let mut metadata = HashMap::new();
        metadata.insert("role".to_string(), Value::String("admin".to_string()));

        PermissionContext {
            working_directory: PathBuf::from("/home/user/project"),
            session_id: "session-123".to_string(),
            timestamp: 1700000000,
            user: Some("testuser".to_string()),
            environment,
            metadata,
        }
    }

    #[test]
    fn test_regex_matches_valid_pattern() {
        let ctx = create_test_context();
        let condition = PermissionCondition {
            condition_type: ConditionType::Context,
            field: Some("working_directory".to_string()),
            operator: ConditionOperator::Matches,
            value: Value::String(r"^/home/\w+/project$".to_string()),
            validator: None,
            description: None,
        };

        assert!(evaluate_condition(&condition, &ctx));
    }

    #[test]
    fn test_regex_matches_invalid_pattern() {
        let ctx = create_test_context();
        let condition = PermissionCondition {
            condition_type: ConditionType::Context,
            field: Some("working_directory".to_string()),
            operator: ConditionOperator::Matches,
            value: Value::String(r"[invalid regex".to_string()),
            validator: None,
            description: None,
        };

        // Invalid regex should return false, not panic
        assert!(!evaluate_condition(&condition, &ctx));
    }

    #[test]
    fn test_range_with_only_min() {
        let ctx = create_test_context();
        let condition = PermissionCondition {
            condition_type: ConditionType::Time,
            field: Some("timestamp".to_string()),
            operator: ConditionOperator::Range,
            value: serde_json::json!({"min": 1600000000}),
            validator: None,
            description: None,
        };

        assert!(evaluate_condition(&condition, &ctx));
    }

    #[test]
    fn test_range_with_only_max() {
        let ctx = create_test_context();
        let condition = PermissionCondition {
            condition_type: ConditionType::Time,
            field: Some("timestamp".to_string()),
            operator: ConditionOperator::Range,
            value: serde_json::json!({"max": 1800000000}),
            validator: None,
            description: None,
        };

        assert!(evaluate_condition(&condition, &ctx));
    }

    #[test]
    fn test_metadata_field_access() {
        let ctx = create_test_context();
        let value = get_context_field(&ctx, "metadata.role");
        assert_eq!(value, Some(Value::String("admin".to_string())));
    }

    #[test]
    fn test_custom_condition_without_validator_fails() {
        let ctx = create_test_context();
        let condition = PermissionCondition {
            condition_type: ConditionType::Custom,
            field: None,
            operator: ConditionOperator::Equals,
            value: Value::Null,
            validator: None,
            description: None,
        };

        assert!(!evaluate_condition(&condition, &ctx));
    }

    #[test]
    fn test_default_field_for_condition_types() {
        let ctx = create_test_context();

        // Context type defaults to working_directory
        let context_condition = PermissionCondition {
            condition_type: ConditionType::Context,
            field: None,
            operator: ConditionOperator::Contains,
            value: Value::String("project".to_string()),
            validator: None,
            description: None,
        };
        assert!(evaluate_condition(&context_condition, &ctx));

        // Time type defaults to timestamp
        let time_condition = PermissionCondition {
            condition_type: ConditionType::Time,
            field: None,
            operator: ConditionOperator::Range,
            value: serde_json::json!({"min": 1600000000, "max": 1800000000}),
            validator: None,
            description: None,
        };
        assert!(evaluate_condition(&time_condition, &ctx));

        // Session type defaults to session_id
        let session_condition = PermissionCondition {
            condition_type: ConditionType::Session,
            field: None,
            operator: ConditionOperator::Equals,
            value: Value::String("session-123".to_string()),
            validator: None,
            description: None,
        };
        assert!(evaluate_condition(&session_condition, &ctx));

        // User type defaults to user
        let user_condition = PermissionCondition {
            condition_type: ConditionType::User,
            field: None,
            operator: ConditionOperator::Equals,
            value: Value::String("testuser".to_string()),
            validator: None,
            description: None,
        };
        assert!(evaluate_condition(&user_condition, &ctx));
    }
}
