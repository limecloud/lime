//! Property-based tests for MCP Resource Manager
//!
//! This module contains property-based tests for the resource manager,
//! validating correctness properties defined in the design document.
//!
//! # Properties Tested
//!
//! - Property 20: Resource Cache TTL
//! - Property 21: Resource Template Expansion
//!
//! # Requirements Coverage
//!
//! - 5.5: Cache resource content with configurable TTL
//! - 5.6: Support resource templates for parameterized URIs

use proptest::prelude::*;
use std::collections::HashMap;
use std::time::Duration;

use crate::mcp::resource_manager::{McpResourceTemplate, ResourceCacheEntry, ResourceContent};
use chrono::Utc;

// Strategy for generating valid parameter names (alphanumeric, starting with letter)
fn param_name_strategy() -> impl Strategy<Value = String> {
    "[a-z][a-z0-9]{0,9}".prop_map(|s| s.to_string())
}

// Strategy for generating parameter values
fn param_value_strategy() -> impl Strategy<Value = String> {
    "[a-zA-Z0-9_\\-\\.]{1,20}".prop_map(|s| s.to_string())
}

// Strategy for generating URI template patterns
fn uri_template_strategy() -> impl Strategy<Value = (String, Vec<String>)> {
    prop::collection::vec(param_name_strategy(), 1..4).prop_map(|params| {
        let template = params
            .iter()
            .enumerate()
            .fold("resource://".to_string(), |acc, (i, p)| {
                if i == 0 {
                    format!("{}{{{}}}", acc, p)
                } else {
                    format!("{}/{{{}}}", acc, p)
                }
            });
        (template, params)
    })
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(100))]

    // **Property 20: Resource Cache TTL**
    //
    // *For any* cached resource, the cache SHALL expire after the configured TTL
    // and subsequent reads SHALL fetch fresh content.
    //
    // **Validates: Requirements 5.5**
    //
    // **Feature: mcp-alignment, Property 20: Resource Cache TTL**
    #[test]
    fn prop_resource_cache_ttl(
        ttl_secs in 1u64..3600u64,
        content_text in "[a-zA-Z0-9 ]{1,100}",
    ) {
        // Create a cache entry with the given TTL
        let entry = ResourceCacheEntry {
            content: ResourceContent::text("file:///test.txt", &content_text),
            cached_at: Utc::now(),
            ttl: Duration::from_secs(ttl_secs),
        };

        // Fresh entry should be valid
        prop_assert!(entry.is_valid(), "Fresh cache entry should be valid");

        // Create an expired entry (cached_at is in the past beyond TTL)
        let expired_entry = ResourceCacheEntry {
            content: ResourceContent::text("file:///test.txt", &content_text),
            cached_at: Utc::now() - chrono::Duration::seconds(ttl_secs as i64 + 1),
            ttl: Duration::from_secs(ttl_secs),
        };

        // Expired entry should not be valid
        prop_assert!(!expired_entry.is_valid(), "Expired cache entry should not be valid");
    }

    // **Property 21: Resource Template Expansion**
    //
    // *For any* resource template and valid parameters, the expanded URI SHALL
    // correctly substitute all parameter placeholders.
    //
    // **Validates: Requirements 5.6**
    //
    // **Feature: mcp-alignment, Property 21: Resource Template Expansion**
    #[test]
    fn prop_resource_template_expansion(
        (template_str, param_names) in uri_template_strategy(),
        param_values in prop::collection::vec(param_value_strategy(), 1..4),
    ) {
        // Create template
        let template = McpResourceTemplate::new(&template_str, "Test Template", "test-server");

        // Get parameters from template
        let extracted_params = template.get_parameters();

        // Verify extracted parameters match what we put in
        prop_assert_eq!(
            extracted_params.len(),
            param_names.len(),
            "Extracted parameters should match template parameters"
        );

        for param in &param_names {
            prop_assert!(
                extracted_params.contains(param),
                "Template should contain parameter: {}",
                param
            );
        }

        // Create params map with values
        let mut params: HashMap<String, String> = HashMap::new();
        for (i, name) in param_names.iter().enumerate() {
            let value = param_values.get(i % param_values.len()).unwrap();
            params.insert(name.clone(), value.clone());
        }

        // Expand template
        let expanded = template.expand(&params);

        // Verify all placeholders are replaced
        for name in &param_names {
            let placeholder = format!("{{{}}}", name);
            prop_assert!(
                !expanded.contains(&placeholder),
                "Expanded URI should not contain placeholder: {}",
                placeholder
            );
        }

        // Verify all values are present in expanded URI
        for (name, value) in &params {
            prop_assert!(
                expanded.contains(value),
                "Expanded URI should contain value '{}' for parameter '{}'",
                value,
                name
            );
        }
    }

    // Additional property: Template expansion is idempotent when all params provided
    #[test]
    fn prop_template_expansion_deterministic(
        (template_str, param_names) in uri_template_strategy(),
        param_values in prop::collection::vec(param_value_strategy(), 1..4),
    ) {
        let template = McpResourceTemplate::new(&template_str, "Test Template", "test-server");

        // Create params map
        let mut params: HashMap<String, String> = HashMap::new();
        for (i, name) in param_names.iter().enumerate() {
            let value = param_values.get(i % param_values.len()).unwrap();
            params.insert(name.clone(), value.clone());
        }

        // Expand twice
        let expanded1 = template.expand(&params);
        let expanded2 = template.expand(&params);

        // Results should be identical
        prop_assert_eq!(
            expanded1,
            expanded2,
            "Template expansion should be deterministic"
        );
    }
}

#[cfg(test)]
mod unit_tests {
    use super::*;

    #[test]
    fn test_cache_entry_just_expired() {
        // Test edge case: entry that just expired
        let entry = ResourceCacheEntry {
            content: ResourceContent::text("file:///test.txt", "content"),
            cached_at: Utc::now() - chrono::Duration::milliseconds(1001),
            ttl: Duration::from_secs(1),
        };
        assert!(!entry.is_valid());
    }

    #[test]
    fn test_cache_entry_not_yet_expired() {
        // Test edge case: entry that hasn't expired yet
        let entry = ResourceCacheEntry {
            content: ResourceContent::text("file:///test.txt", "content"),
            cached_at: Utc::now() - chrono::Duration::milliseconds(999),
            ttl: Duration::from_secs(1),
        };
        assert!(entry.is_valid());
    }

    #[test]
    fn test_template_with_no_params() {
        let template =
            McpResourceTemplate::new("file:///static/resource", "Static Resource", "test-server");

        let params = HashMap::new();
        let expanded = template.expand(&params);

        assert_eq!(expanded, "file:///static/resource");
        assert!(template.get_parameters().is_empty());
    }

    #[test]
    fn test_template_partial_expansion() {
        let template = McpResourceTemplate::new(
            "db://{database}/{table}",
            "Database Template",
            "test-server",
        );

        let mut params = HashMap::new();
        params.insert("database".to_string(), "mydb".to_string());
        // Note: "table" is not provided

        let expanded = template.expand(&params);

        // Only "database" should be expanded
        assert_eq!(expanded, "db://mydb/{table}");
    }

    #[test]
    fn test_template_repeated_param() {
        let template = McpResourceTemplate::new(
            "api://{version}/users/{version}",
            "API Template",
            "test-server",
        );

        let mut params = HashMap::new();
        params.insert("version".to_string(), "v2".to_string());

        let expanded = template.expand(&params);

        // Both occurrences should be replaced
        assert_eq!(expanded, "api://v2/users/v2");
    }
}
