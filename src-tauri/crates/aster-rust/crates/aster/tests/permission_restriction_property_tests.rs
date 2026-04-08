//! Property-based tests for parameter restriction validation
//!
//! **Property 7: Parameter Restriction Validation**
//! *For any* parameter value and restriction (whitelist, blacklist, pattern, range, or custom validator),
//! the validation result SHALL correctly reflect whether the value satisfies the restriction.
//!
//! **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6**

use aster::permission::{
    check_parameter_restrictions, validate_restriction, ParameterRestriction, RestrictionType,
};
use proptest::prelude::*;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;

// ============================================================================
// Arbitrary Generators
// ============================================================================

/// Generate arbitrary string values
fn arb_string_value() -> impl Strategy<Value = Value> {
    "[a-zA-Z0-9_/-]{1,50}".prop_map(Value::String)
}

/// Generate arbitrary numeric values
fn arb_number_value() -> impl Strategy<Value = Value> {
    (-1000.0f64..1000.0f64).prop_map(|n| serde_json::json!(n))
}

/// Generate arbitrary boolean values
fn arb_bool_value() -> impl Strategy<Value = Value> {
    prop::bool::ANY.prop_map(Value::Bool)
}

/// Generate arbitrary JSON values (strings, numbers, bools)
fn arb_json_value() -> impl Strategy<Value = Value> {
    prop_oneof![arb_string_value(), arb_number_value(), arb_bool_value(),]
}

/// Generate a list of unique string values for whitelist/blacklist
fn arb_value_list(size: usize) -> impl Strategy<Value = Vec<Value>> {
    prop::collection::vec(arb_string_value(), 1..=size)
}

/// Generate a whitelist restriction
fn arb_whitelist_restriction(param_name: String, values: Vec<Value>) -> ParameterRestriction {
    ParameterRestriction {
        parameter: param_name,
        restriction_type: RestrictionType::Whitelist,
        values: Some(values),
        pattern: None,
        validator: None,
        min: None,
        max: None,
        required: false,
        description: Some("Whitelist restriction".to_string()),
    }
}

/// Generate a blacklist restriction
fn arb_blacklist_restriction(param_name: String, values: Vec<Value>) -> ParameterRestriction {
    ParameterRestriction {
        parameter: param_name,
        restriction_type: RestrictionType::Blacklist,
        values: Some(values),
        pattern: None,
        validator: None,
        min: None,
        max: None,
        required: false,
        description: Some("Blacklist restriction".to_string()),
    }
}

/// Generate a range restriction
fn arb_range_restriction(
    param_name: String,
    min: Option<f64>,
    max: Option<f64>,
) -> ParameterRestriction {
    ParameterRestriction {
        parameter: param_name,
        restriction_type: RestrictionType::Range,
        values: None,
        pattern: None,
        validator: None,
        min,
        max,
        required: false,
        description: Some("Range restriction".to_string()),
    }
}

// ============================================================================
// Property Tests
// ============================================================================

proptest! {
    #![proptest_config(ProptestConfig::with_cases(100))]

    /// **Feature: tool-permission-system, Property 7: Parameter Restriction Validation**
    ///
    /// Property: Whitelist allows only values in the list
    /// *For any* value in the whitelist, validate_restriction SHALL return true.
    /// *For any* value not in the whitelist, validate_restriction SHALL return false.
    ///
    /// **Validates: Requirements 3.1**
    #[test]
    fn prop_whitelist_allows_only_listed_values(
        values in arb_value_list(5),
        index in 0usize..5
    ) {
        let safe_index = index % values.len();
        let restriction = arb_whitelist_restriction("param".to_string(), values.clone());

        // Value in whitelist should pass
        let value_in_list = &values[safe_index];
        prop_assert!(
            validate_restriction(&restriction, value_in_list),
            "Value in whitelist should be allowed"
        );

        // Value not in whitelist should fail
        let value_not_in_list = Value::String("__definitely_not_in_list__".to_string());
        prop_assert!(
            !validate_restriction(&restriction, &value_not_in_list),
            "Value not in whitelist should be denied"
        );
    }

    /// **Feature: tool-permission-system, Property 7: Parameter Restriction Validation**
    ///
    /// Property: Blacklist denies only values in the list
    /// *For any* value in the blacklist, validate_restriction SHALL return false.
    /// *For any* value not in the blacklist, validate_restriction SHALL return true.
    ///
    /// **Validates: Requirements 3.2**
    #[test]
    fn prop_blacklist_denies_only_listed_values(
        values in arb_value_list(5),
        index in 0usize..5
    ) {
        let safe_index = index % values.len();
        let restriction = arb_blacklist_restriction("param".to_string(), values.clone());

        // Value in blacklist should fail
        let value_in_list = &values[safe_index];
        prop_assert!(
            !validate_restriction(&restriction, value_in_list),
            "Value in blacklist should be denied"
        );

        // Value not in blacklist should pass
        let value_not_in_list = Value::String("__definitely_not_in_list__".to_string());
        prop_assert!(
            validate_restriction(&restriction, &value_not_in_list),
            "Value not in blacklist should be allowed"
        );
    }


    /// **Feature: tool-permission-system, Property 7: Parameter Restriction Validation**
    ///
    /// Property: Whitelist and Blacklist are complementary
    /// *For any* value and list, if whitelist allows it, blacklist with same list denies it,
    /// and vice versa.
    ///
    /// **Validates: Requirements 3.1, 3.2**
    #[test]
    fn prop_whitelist_blacklist_complementary(
        values in arb_value_list(5),
        test_value in arb_string_value()
    ) {
        let whitelist = arb_whitelist_restriction("param".to_string(), values.clone());
        let blacklist = arb_blacklist_restriction("param".to_string(), values);

        let whitelist_result = validate_restriction(&whitelist, &test_value);
        let blacklist_result = validate_restriction(&blacklist, &test_value);

        // If value is in list: whitelist allows, blacklist denies
        // If value is not in list: whitelist denies, blacklist allows
        prop_assert_ne!(
            whitelist_result, blacklist_result,
            "Whitelist and blacklist should produce opposite results for the same value and list"
        );
    }

    /// **Feature: tool-permission-system, Property 7: Parameter Restriction Validation**
    ///
    /// Property: Range validates numeric boundaries correctly
    /// *For any* numeric value within [min, max], validate_restriction SHALL return true.
    /// *For any* numeric value outside [min, max], validate_restriction SHALL return false.
    ///
    /// **Validates: Requirements 3.4**
    #[test]
    fn prop_range_validates_boundaries(
        min in -500.0f64..0.0f64,
        max in 0.0f64..500.0f64,
        value_offset in -600.0f64..600.0f64
    ) {
        let restriction = arb_range_restriction("count".to_string(), Some(min), Some(max));
        let test_value = serde_json::json!(value_offset);

        let result = validate_restriction(&restriction, &test_value);
        let expected = value_offset >= min && value_offset <= max;

        prop_assert_eq!(
            result, expected,
            "Range validation should correctly check boundaries: value={}, min={}, max={}",
            value_offset, min, max
        );
    }

    /// **Feature: tool-permission-system, Property 7: Parameter Restriction Validation**
    ///
    /// Property: Range with only min allows values >= min
    /// *For any* numeric value >= min, validate_restriction SHALL return true.
    ///
    /// **Validates: Requirements 3.4**
    #[test]
    fn prop_range_only_min(
        min in -500.0f64..500.0f64,
        value in -1000.0f64..1000.0f64
    ) {
        let restriction = arb_range_restriction("count".to_string(), Some(min), None);
        let test_value = serde_json::json!(value);

        let result = validate_restriction(&restriction, &test_value);
        let expected = value >= min;

        prop_assert_eq!(
            result, expected,
            "Range with only min should allow values >= min"
        );
    }


    /// **Feature: tool-permission-system, Property 7: Parameter Restriction Validation**
    ///
    /// Property: Range with only max allows values <= max
    /// *For any* numeric value <= max, validate_restriction SHALL return true.
    ///
    /// **Validates: Requirements 3.4**
    #[test]
    fn prop_range_only_max(
        max in -500.0f64..500.0f64,
        value in -1000.0f64..1000.0f64
    ) {
        let restriction = arb_range_restriction("count".to_string(), None, Some(max));
        let test_value = serde_json::json!(value);

        let result = validate_restriction(&restriction, &test_value);
        let expected = value <= max;

        prop_assert_eq!(
            result, expected,
            "Range with only max should allow values <= max"
        );
    }

    /// **Feature: tool-permission-system, Property 7: Parameter Restriction Validation**
    ///
    /// Property: Custom validator result is respected
    /// *For any* value and validator function, validate_restriction SHALL return
    /// the validator's result.
    ///
    /// **Validates: Requirements 3.5**
    #[test]
    fn prop_custom_validator_result_respected(
        validator_returns in prop::bool::ANY,
        test_value in arb_json_value()
    ) {
        let restriction = ParameterRestriction {
            parameter: "param".to_string(),
            restriction_type: RestrictionType::Validator,
            values: None,
            pattern: None,
            validator: Some(Arc::new(move |_: &Value| validator_returns)),
            min: None,
            max: None,
            required: false,
            description: Some("Custom validator".to_string()),
        };

        let result = validate_restriction(&restriction, &test_value);

        prop_assert_eq!(
            result, validator_returns,
            "Custom validator result should be respected"
        );
    }

    /// **Feature: tool-permission-system, Property 7: Parameter Restriction Validation**
    ///
    /// Property: Empty whitelist denies all values
    /// *For any* value, an empty whitelist SHALL deny it.
    ///
    /// **Validates: Requirements 3.1**
    #[test]
    fn prop_empty_whitelist_denies_all(
        test_value in arb_json_value()
    ) {
        let restriction = arb_whitelist_restriction("param".to_string(), vec![]);

        let result = validate_restriction(&restriction, &test_value);

        prop_assert!(
            !result,
            "Empty whitelist should deny all values"
        );
    }


    /// **Feature: tool-permission-system, Property 7: Parameter Restriction Validation**
    ///
    /// Property: Empty blacklist allows all values
    /// *For any* value, an empty blacklist SHALL allow it.
    ///
    /// **Validates: Requirements 3.2**
    #[test]
    fn prop_empty_blacklist_allows_all(
        test_value in arb_json_value()
    ) {
        let restriction = arb_blacklist_restriction("param".to_string(), vec![]);

        let result = validate_restriction(&restriction, &test_value);

        prop_assert!(
            result,
            "Empty blacklist should allow all values"
        );
    }

    /// **Feature: tool-permission-system, Property 7: Parameter Restriction Validation**
    ///
    /// Property: check_parameter_restrictions returns Ok when all pass
    /// *For any* set of restrictions and params that all satisfy the restrictions,
    /// check_parameter_restrictions SHALL return Ok(()).
    ///
    /// **Validates: Requirements 3.6**
    #[test]
    fn prop_check_restrictions_ok_when_all_pass(
        allowed_value in "[a-z]{3,10}".prop_map(Value::String)
    ) {
        let restrictions = vec![
            ParameterRestriction {
                parameter: "cmd".to_string(),
                restriction_type: RestrictionType::Whitelist,
                values: Some(vec![allowed_value.clone()]),
                pattern: None,
                validator: None,
                min: None,
                max: None,
                required: false,
                description: None,
            },
        ];

        let mut params = HashMap::new();
        params.insert("cmd".to_string(), allowed_value);

        let result = check_parameter_restrictions(&restrictions, &params);

        prop_assert!(
            result.is_ok(),
            "check_parameter_restrictions should return Ok when all restrictions pass"
        );
    }

    /// **Feature: tool-permission-system, Property 7: Parameter Restriction Validation**
    ///
    /// Property: check_parameter_restrictions returns Err with violations when any fail
    /// *For any* restriction that fails, check_parameter_restrictions SHALL return
    /// Err with violation details.
    ///
    /// **Validates: Requirements 3.6**
    #[test]
    fn prop_check_restrictions_err_when_any_fail(
        allowed_value in "[a-z]{3,10}".prop_map(Value::String),
        denied_value in "[A-Z]{3,10}".prop_map(Value::String)
    ) {
        let restrictions = vec![
            ParameterRestriction {
                parameter: "cmd".to_string(),
                restriction_type: RestrictionType::Whitelist,
                values: Some(vec![allowed_value]),
                pattern: None,
                validator: None,
                min: None,
                max: None,
                required: false,
                description: None,
            },
        ];

        let mut params = HashMap::new();
        params.insert("cmd".to_string(), denied_value);

        let result = check_parameter_restrictions(&restrictions, &params);

        prop_assert!(
            result.is_err(),
            "check_parameter_restrictions should return Err when any restriction fails"
        );

        let violations = result.unwrap_err();
        prop_assert!(
            !violations.is_empty(),
            "Violations list should not be empty"
        );
        prop_assert!(
            violations[0].contains("cmd"),
            "Violation should mention the parameter name"
        );
    }


    /// **Feature: tool-permission-system, Property 7: Parameter Restriction Validation**
    ///
    /// Property: Required parameter missing causes violation
    /// *For any* required parameter that is missing from params,
    /// check_parameter_restrictions SHALL return Err with "Required" violation.
    ///
    /// **Validates: Requirements 3.6**
    #[test]
    fn prop_required_missing_causes_violation(
        param_name in "[a-z]{3,10}"
    ) {
        let restrictions = vec![
            ParameterRestriction {
                parameter: param_name.clone(),
                restriction_type: RestrictionType::Whitelist,
                values: Some(vec![Value::String("any".to_string())]),
                pattern: None,
                validator: None,
                min: None,
                max: None,
                required: true,
                description: None,
            },
        ];

        let params = HashMap::new(); // Empty params

        let result = check_parameter_restrictions(&restrictions, &params);

        prop_assert!(
            result.is_err(),
            "Missing required parameter should cause error"
        );

        let violations = result.unwrap_err();
        prop_assert!(
            violations.iter().any(|v| v.contains("Required") && v.contains(&param_name)),
            "Violation should mention 'Required' and the parameter name"
        );
    }

    /// **Feature: tool-permission-system, Property 7: Parameter Restriction Validation**
    ///
    /// Property: Optional parameter missing does not cause violation
    /// *For any* optional parameter that is missing from params,
    /// check_parameter_restrictions SHALL return Ok.
    ///
    /// **Validates: Requirements 3.6**
    #[test]
    fn prop_optional_missing_no_violation(
        param_name in "[a-z]{3,10}"
    ) {
        let restrictions = vec![
            ParameterRestriction {
                parameter: param_name,
                restriction_type: RestrictionType::Whitelist,
                values: Some(vec![Value::String("any".to_string())]),
                pattern: None,
                validator: None,
                min: None,
                max: None,
                required: false,
                description: None,
            },
        ];

        let params = HashMap::new(); // Empty params

        let result = check_parameter_restrictions(&restrictions, &params);

        prop_assert!(
            result.is_ok(),
            "Missing optional parameter should not cause error"
        );
    }

    /// **Feature: tool-permission-system, Property 7: Parameter Restriction Validation**
    ///
    /// Property: Multiple violations are all reported
    /// *For any* set of restrictions where multiple fail,
    /// check_parameter_restrictions SHALL return all violations.
    ///
    /// **Validates: Requirements 3.6**
    #[test]
    fn prop_multiple_violations_all_reported(
        num_restrictions in 2usize..5
    ) {
        // Create restrictions that will all fail
        let restrictions: Vec<ParameterRestriction> = (0..num_restrictions)
            .map(|i| ParameterRestriction {
                parameter: format!("param{}", i),
                restriction_type: RestrictionType::Whitelist,
                values: Some(vec![Value::String("allowed".to_string())]),
                pattern: None,
                validator: None,
                min: None,
                max: None,
                required: false,
                description: None,
            })
            .collect();

        // Provide values that will all fail
        let mut params = HashMap::new();
        for i in 0..num_restrictions {
            params.insert(format!("param{}", i), Value::String("denied".to_string()));
        }

        let result = check_parameter_restrictions(&restrictions, &params);

        prop_assert!(result.is_err(), "Should have violations");

        let violations = result.unwrap_err();
        prop_assert_eq!(
            violations.len(), num_restrictions,
            "All violations should be reported"
        );
    }


    /// **Feature: tool-permission-system, Property 7: Parameter Restriction Validation**
    ///
    /// Property: Empty restrictions list allows all parameters
    /// *For any* set of parameters, an empty restrictions list SHALL allow them all.
    ///
    /// **Validates: Requirements 3.6**
    #[test]
    fn prop_empty_restrictions_allows_all(
        param_name in "[a-z]{3,10}",
        param_value in arb_json_value()
    ) {
        let restrictions: Vec<ParameterRestriction> = vec![];

        let mut params = HashMap::new();
        params.insert(param_name, param_value);

        let result = check_parameter_restrictions(&restrictions, &params);

        prop_assert!(
            result.is_ok(),
            "Empty restrictions should allow all parameters"
        );
    }
}

// ============================================================================
// Pattern Matching Property Tests
// ============================================================================

proptest! {
    #![proptest_config(ProptestConfig::with_cases(100))]

    /// **Feature: tool-permission-system, Property 7: Parameter Restriction Validation**
    ///
    /// Property: Pattern restriction validates regex correctly
    /// *For any* string that matches the pattern, validate_restriction SHALL return true.
    ///
    /// **Validates: Requirements 3.3**
    #[test]
    fn prop_pattern_validates_matching_strings(
        prefix in "[a-z]{2,5}",
        suffix in "[a-z]{2,5}"
    ) {
        // Create a pattern that matches strings starting with the prefix
        let pattern = format!("^{}.*$", prefix);
        let restriction = ParameterRestriction {
            parameter: "path".to_string(),
            restriction_type: RestrictionType::Pattern,
            values: None,
            pattern: Some(pattern),
            validator: None,
            min: None,
            max: None,
            required: false,
            description: None,
        };

        // Value that matches
        let matching_value = Value::String(format!("{}{}", prefix, suffix));
        prop_assert!(
            validate_restriction(&restriction, &matching_value),
            "Value matching pattern should be allowed"
        );

        // Value that doesn't match (different prefix)
        let non_matching_value = Value::String(format!("XX{}", suffix));
        prop_assert!(
            !validate_restriction(&restriction, &non_matching_value),
            "Value not matching pattern should be denied"
        );
    }

    /// **Feature: tool-permission-system, Property 7: Parameter Restriction Validation**
    ///
    /// Property: Pattern with None allows all strings
    /// *For any* string value, a Pattern restriction with pattern=None SHALL allow it.
    ///
    /// **Validates: Requirements 3.3**
    #[test]
    fn prop_pattern_none_allows_all(
        test_value in arb_string_value()
    ) {
        let restriction = ParameterRestriction {
            parameter: "path".to_string(),
            restriction_type: RestrictionType::Pattern,
            values: None,
            pattern: None,
            validator: None,
            min: None,
            max: None,
            required: false,
            description: None,
        };

        let result = validate_restriction(&restriction, &test_value);

        prop_assert!(
            result,
            "Pattern restriction with None pattern should allow all strings"
        );
    }
}

// ============================================================================
// Edge Case Unit Tests
// ============================================================================

#[cfg(test)]
mod edge_case_tests {
    use super::*;

    #[test]
    fn test_whitelist_with_none_values_allows_all() {
        let restriction = ParameterRestriction {
            parameter: "cmd".to_string(),
            restriction_type: RestrictionType::Whitelist,
            values: None,
            pattern: None,
            validator: None,
            min: None,
            max: None,
            required: false,
            description: None,
        };

        assert!(validate_restriction(
            &restriction,
            &Value::String("anything".to_string())
        ));
    }

    #[test]
    fn test_blacklist_with_none_values_allows_all() {
        let restriction = ParameterRestriction {
            parameter: "cmd".to_string(),
            restriction_type: RestrictionType::Blacklist,
            values: None,
            pattern: None,
            validator: None,
            min: None,
            max: None,
            required: false,
            description: None,
        };

        assert!(validate_restriction(
            &restriction,
            &Value::String("anything".to_string())
        ));
    }

    #[test]
    fn test_range_with_string_number() {
        let restriction = ParameterRestriction {
            parameter: "count".to_string(),
            restriction_type: RestrictionType::Range,
            values: None,
            pattern: None,
            validator: None,
            min: Some(0.0),
            max: Some(100.0),
            required: false,
            description: None,
        };

        // String that can be parsed as number
        assert!(validate_restriction(
            &restriction,
            &Value::String("50".to_string())
        ));
        assert!(!validate_restriction(
            &restriction,
            &Value::String("150".to_string())
        ));

        // String that cannot be parsed
        assert!(!validate_restriction(
            &restriction,
            &Value::String("not a number".to_string())
        ));
    }

    #[test]
    fn test_range_with_non_numeric_fails() {
        let restriction = ParameterRestriction {
            parameter: "count".to_string(),
            restriction_type: RestrictionType::Range,
            values: None,
            pattern: None,
            validator: None,
            min: Some(0.0),
            max: Some(100.0),
            required: false,
            description: None,
        };

        assert!(!validate_restriction(&restriction, &Value::Bool(true)));
        assert!(!validate_restriction(&restriction, &Value::Null));
        assert!(!validate_restriction(
            &restriction,
            &serde_json::json!({"key": "value"})
        ));
    }

    #[test]
    fn test_pattern_with_invalid_regex_fails() {
        let restriction = ParameterRestriction {
            parameter: "path".to_string(),
            restriction_type: RestrictionType::Pattern,
            values: None,
            pattern: Some("[invalid".to_string()),
            validator: None,
            min: None,
            max: None,
            required: false,
            description: None,
        };

        // Invalid regex should cause validation to fail
        assert!(!validate_restriction(
            &restriction,
            &Value::String("anything".to_string())
        ));
    }

    #[test]
    fn test_pattern_with_number_value() {
        let restriction = ParameterRestriction {
            parameter: "port".to_string(),
            restriction_type: RestrictionType::Pattern,
            values: None,
            pattern: Some(r"^\d{2,5}$".to_string()),
            validator: None,
            min: None,
            max: None,
            required: false,
            description: None,
        };

        // Numbers are converted to string for pattern matching
        assert!(validate_restriction(&restriction, &serde_json::json!(8080)));
        assert!(!validate_restriction(&restriction, &serde_json::json!(1)));
    }

    #[test]
    fn test_validator_with_none_allows_all() {
        let restriction = ParameterRestriction {
            parameter: "path".to_string(),
            restriction_type: RestrictionType::Validator,
            values: None,
            pattern: None,
            validator: None,
            min: None,
            max: None,
            required: false,
            description: None,
        };

        assert!(validate_restriction(
            &restriction,
            &Value::String("anything".to_string())
        ));
    }

    #[test]
    fn test_check_restrictions_with_extra_params() {
        // Extra parameters not covered by restrictions should be allowed
        let restrictions = vec![ParameterRestriction {
            parameter: "cmd".to_string(),
            restriction_type: RestrictionType::Whitelist,
            values: Some(vec![Value::String("ls".to_string())]),
            pattern: None,
            validator: None,
            min: None,
            max: None,
            required: false,
            description: None,
        }];

        let mut params = HashMap::new();
        params.insert("cmd".to_string(), Value::String("ls".to_string()));
        params.insert(
            "extra_param".to_string(),
            Value::String("extra_value".to_string()),
        );

        let result = check_parameter_restrictions(&restrictions, &params);
        assert!(result.is_ok());
    }

    #[test]
    fn test_whitelist_with_mixed_types() {
        let restriction = ParameterRestriction {
            parameter: "value".to_string(),
            restriction_type: RestrictionType::Whitelist,
            values: Some(vec![
                Value::String("text".to_string()),
                serde_json::json!(42),
                Value::Bool(true),
            ]),
            pattern: None,
            validator: None,
            min: None,
            max: None,
            required: false,
            description: None,
        };

        assert!(validate_restriction(
            &restriction,
            &Value::String("text".to_string())
        ));
        assert!(validate_restriction(&restriction, &serde_json::json!(42)));
        assert!(validate_restriction(&restriction, &Value::Bool(true)));
        assert!(!validate_restriction(
            &restriction,
            &Value::String("other".to_string())
        ));
    }

    #[test]
    fn test_range_boundary_values() {
        let restriction = ParameterRestriction {
            parameter: "count".to_string(),
            restriction_type: RestrictionType::Range,
            values: None,
            pattern: None,
            validator: None,
            min: Some(0.0),
            max: Some(100.0),
            required: false,
            description: None,
        };

        // Boundary values should be included
        assert!(validate_restriction(&restriction, &serde_json::json!(0)));
        assert!(validate_restriction(&restriction, &serde_json::json!(100)));

        // Just outside boundaries
        assert!(!validate_restriction(
            &restriction,
            &serde_json::json!(-0.001)
        ));
        assert!(!validate_restriction(
            &restriction,
            &serde_json::json!(100.001)
        ));
    }
}
