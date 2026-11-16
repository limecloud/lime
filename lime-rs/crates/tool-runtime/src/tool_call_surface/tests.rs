use super::*;
use serde_json::{Map, json};

fn tool_definitions(names: &[&str]) -> Vec<RuntimeToolDefinition> {
    names
        .iter()
        .map(|name| RuntimeToolDefinition::new(*name, "test tool", json!({})))
        .collect()
}

fn canonical_name(name: &str) -> Option<String> {
    match name {
        "read_file" | "ReadTool" => Some("Read".to_string()),
        "ripgrep" => Some("Grep".to_string()),
        _ => None,
    }
}

#[test]
fn tool_call_surface_name_matches_exact_and_case_insensitive_names() {
    let tools = vec!["Read", "Grep", "search_query"];

    assert_eq!(
        runtime_tool_call_surface_name(&tools, "Read", &canonical_name),
        Some("Read".to_string())
    );
    assert_eq!(
        runtime_tool_call_surface_name(&tools, "grep", &canonical_name),
        Some("Grep".to_string())
    );
}

#[test]
fn tool_call_surface_name_resolves_current_aliases() {
    let tools = vec!["Read", "Grep"];

    assert_eq!(
        runtime_tool_call_surface_name(&tools, " read_file ", &canonical_name),
        Some("Read".to_string())
    );
    assert_eq!(
        runtime_tool_call_surface_name(&tools, "ripgrep", &canonical_name),
        Some("Grep".to_string())
    );
    assert_eq!(
        runtime_tool_call_surface_name(&tools, "unknown", &canonical_name),
        None
    );
}

#[test]
fn production_canonical_name_includes_workspace_alias_owners() {
    assert_eq!(
        runtime_tool_call_canonical_name("functions.read_file"),
        Some("Read".to_string())
    );
    assert_eq!(
        runtime_tool_call_canonical_name("ripgrep"),
        Some("Grep".to_string())
    );
}

#[test]
fn normalize_read_arguments_consumes_aliases_and_head() {
    let mut arguments = Map::from_iter([
        ("file_path".to_string(), json!(" src/lib.rs ")),
        ("head".to_string(), json!("42")),
    ]);

    runtime_tool_call_normalize_arguments("Read", &mut arguments);

    assert_eq!(arguments.get("path"), Some(&json!("src/lib.rs")));
    assert_eq!(arguments.get("start_line"), Some(&json!(1)));
    assert_eq!(arguments.get("end_line"), Some(&json!(42)));
    assert!(!arguments.contains_key("file_path"));
    assert!(!arguments.contains_key("head"));
}

#[test]
fn normalize_arguments_does_not_override_existing_values() {
    let mut arguments = Map::from_iter([
        ("filePath".to_string(), json!("other.rs")),
        ("path".to_string(), json!("current.rs")),
        ("head".to_string(), json!(10)),
        ("end_line".to_string(), json!(5)),
    ]);

    runtime_tool_call_normalize_arguments("Read", &mut arguments);

    assert_eq!(arguments.get("path"), Some(&json!("current.rs")));
    assert_eq!(arguments.get("end_line"), Some(&json!(5)));
    assert!(!arguments.contains_key("start_line"));
    assert!(!arguments.contains_key("filePath"));
    assert!(!arguments.contains_key("head"));
}

#[test]
fn normalize_search_arguments_consumes_query() {
    let mut grep_arguments = Map::from_iter([("query".to_string(), json!("TODO"))]);
    let mut glob_arguments = Map::from_iter([("query".to_string(), json!("*.rs"))]);

    runtime_tool_call_normalize_arguments("Grep", &mut grep_arguments);
    runtime_tool_call_normalize_arguments("Glob", &mut glob_arguments);

    assert_eq!(grep_arguments.get("pattern"), Some(&json!("TODO")));
    assert_eq!(glob_arguments.get("pattern"), Some(&json!("*.rs")));
    assert!(!grep_arguments.contains_key("query"));
    assert!(!glob_arguments.contains_key("query"));
}

#[test]
fn repair_resolves_alias_and_records_read_argument_changes() {
    let outcome = repair_tool_call(
        &tool_definitions(&["Read", "Grep"]),
        "read_file",
        r#"{"file_path":" src/lib.rs ","head":"42"}"#,
        &canonical_name,
    );

    let ToolCallRepairOutcome::Ready(repair) = outcome else {
        panic!("repair should be ready");
    };
    assert_eq!(repair.requested_name, "read_file");
    assert_eq!(repair.resolved_name, "Read");
    assert_eq!(repair.original_arguments.get("path"), None);
    assert_eq!(repair.arguments.get("path"), Some(&json!("src/lib.rs")));
    assert_eq!(repair.arguments.get("start_line"), Some(&json!(1)));
    assert_eq!(repair.arguments.get("end_line"), Some(&json!(42)));
    assert_eq!(
        repair.argument_changes,
        vec![
            ToolArgumentChange {
                key: "end_line".to_string(),
                before: None,
                after: Some(json!(42)),
            },
            ToolArgumentChange {
                key: "file_path".to_string(),
                before: Some(json!(" src/lib.rs ")),
                after: None,
            },
            ToolArgumentChange {
                key: "head".to_string(),
                before: Some(json!("42")),
                after: None,
            },
            ToolArgumentChange {
                key: "path".to_string(),
                before: None,
                after: Some(json!("src/lib.rs")),
            },
            ToolArgumentChange {
                key: "start_line".to_string(),
                before: None,
                after: Some(json!(1)),
            },
        ]
    );
}

#[test]
fn repair_preserves_existing_target_arguments() {
    let outcome = repair_tool_call(
        &tool_definitions(&["Read"]),
        "read",
        r#"{"filePath":"other.rs","path":"current.rs","head":10,"end_line":5}"#,
        &canonical_name,
    );

    let ToolCallRepairOutcome::Ready(repair) = outcome else {
        panic!("repair should be ready");
    };
    assert_eq!(repair.resolved_name, "Read");
    assert_eq!(repair.arguments.get("path"), Some(&json!("current.rs")));
    assert_eq!(repair.arguments.get("end_line"), Some(&json!(5)));
    assert!(!repair.arguments.contains_key("filePath"));
    assert!(!repair.arguments.contains_key("head"));
    assert_eq!(repair.argument_changes.len(), 2);
    assert!(
        repair
            .argument_changes
            .iter()
            .all(|change| change.after.is_none())
    );
}

#[test]
fn repair_returns_typed_invalid_for_bad_arguments() {
    let malformed = repair_tool_call(
        &tool_definitions(&["Read"]),
        "Read",
        r#"{"path": "unfinished"#,
        &canonical_name,
    );
    let scalar = repair_tool_call(
        &tool_definitions(&["Read"]),
        "Read",
        r#"["src/lib.rs"]"#,
        &canonical_name,
    );

    assert!(matches!(
        malformed,
        ToolCallRepairOutcome::Invalid(ToolCallRepairFailure {
            kind: ToolCallRepairFailureKind::MalformedArguments,
            ..
        })
    ));
    assert!(matches!(
        scalar,
        ToolCallRepairOutcome::Invalid(ToolCallRepairFailure {
            kind: ToolCallRepairFailureKind::ArgumentsNotObject,
            ..
        })
    ));
}

#[test]
fn repair_returns_typed_invalid_for_missing_or_unknown_tool() {
    let tools = tool_definitions(&["Read"]);
    let missing = repair_tool_call(&tools, " ", "{}", &canonical_name);
    let unknown = repair_tool_call(&tools, "write_file", "{}", &canonical_name);

    assert!(matches!(
        missing,
        ToolCallRepairOutcome::Invalid(ToolCallRepairFailure {
            kind: ToolCallRepairFailureKind::MissingName,
            ..
        })
    ));
    assert!(matches!(
        unknown,
        ToolCallRepairOutcome::Invalid(ToolCallRepairFailure {
            kind: ToolCallRepairFailureKind::UnknownTool,
            ..
        })
    ));
}

#[test]
fn repair_outcome_serializes_as_typed_contract() {
    let ready = repair_tool_call(
        &tool_definitions(&["Grep"]),
        "ripgrep",
        r#"{"query":"TODO"}"#,
        &canonical_name,
    );
    let invalid = repair_tool_call(
        &tool_definitions(&["Read"]),
        "unknown",
        "{}",
        &canonical_name,
    );

    let ready_value = json!({
        "status": "ready",
        "requested_name": "ripgrep",
        "resolved_name": "Grep",
        "original_arguments": { "query": "TODO" },
        "arguments": { "pattern": "TODO" },
        "argument_changes": [
            { "key": "pattern", "after": "TODO" },
            { "key": "query", "before": "TODO" }
        ]
    });
    let invalid_value = json!({
        "status": "invalid",
        "requested_name": "unknown",
        "raw_arguments": "{}",
        "kind": "unknown_tool"
    });

    assert_eq!(
        serde_json::to_value(&ready).expect("serialize ready repair"),
        ready_value
    );
    assert_eq!(
        serde_json::to_value(&invalid).expect("serialize invalid repair"),
        invalid_value
    );
    assert_eq!(
        serde_json::from_value::<ToolCallRepairOutcome>(ready_value)
            .expect("deserialize ready repair"),
        ready
    );
    assert_eq!(
        serde_json::from_value::<ToolCallRepairOutcome>(invalid_value)
            .expect("deserialize invalid repair"),
        invalid
    );
}

#[test]
fn invalid_repair_projects_safe_model_arguments_without_raw_payload() {
    let failure = ToolCallRepairFailure {
        requested_name: "Read".to_string(),
        raw_arguments: "{not-json".to_string(),
        kind: ToolCallRepairFailureKind::MalformedArguments,
        schema_errors: Vec::new(),
    };

    assert_eq!(
        failure.model_arguments(),
        Map::from_iter([
            ("tool".to_string(), json!("Read")),
            (
                "error".to_string(),
                json!("tool 'Read' received malformed JSON arguments"),
            ),
        ])
    );
}

#[test]
fn repair_coerces_only_explicit_numeric_schema_fields() {
    let tools = vec![RuntimeToolDefinition::new(
        "measure",
        "test numeric coercion",
        json!({
            "type": "object",
            "properties": {
                "count": { "type": "integer", "minimum": 1 },
                "ratio": { "type": "number" },
                "label": { "type": "string" },
                "samples": {
                    "type": "array",
                    "items": { "type": "integer" }
                }
            },
            "required": ["count", "ratio", "label", "samples"],
            "additionalProperties": false
        }),
    )];

    let outcome = repair_tool_call(
        &tools,
        "measure",
        r#"{"count":"42","ratio":"1.5","label":"7","samples":["2",3]}"#,
        &canonical_name,
    );

    let ToolCallRepairOutcome::Ready(repair) = outcome else {
        panic!("numeric strings covered by explicit schema types should be repaired");
    };
    assert_eq!(repair.arguments["count"], json!(42));
    assert_eq!(repair.arguments["ratio"], json!(1.5));
    assert_eq!(repair.arguments["label"], json!("7"));
    assert_eq!(repair.arguments["samples"], json!([2, 3]));
    assert_eq!(repair.argument_changes.len(), 3);
}

#[test]
fn repair_rejects_schema_mismatch_without_exposing_argument_values() {
    let tools = vec![RuntimeToolDefinition::new(
        "measure",
        "test schema validation",
        json!({
            "type": "object",
            "properties": {
                "count": { "type": "integer", "minimum": 1 }
            },
            "required": ["count"],
            "additionalProperties": false
        }),
    )];
    let outcome = repair_tool_call(
        &tools,
        "measure",
        r#"{"count":"private-not-a-number"}"#,
        &canonical_name,
    );

    let ToolCallRepairOutcome::Invalid(failure) = outcome else {
        panic!("schema mismatch must be invalid");
    };
    assert_eq!(failure.kind, ToolCallRepairFailureKind::SchemaMismatch);
    assert!(!failure.schema_errors.is_empty());
    assert!(!failure.message().contains("private-not-a-number"));
    assert!(
        !failure
            .model_arguments()
            .values()
            .any(|value| value.to_string().contains("private-not-a-number"))
    );
}

#[test]
fn repair_fails_closed_when_advertised_schema_is_invalid() {
    let tools = vec![RuntimeToolDefinition::new(
        "broken",
        "invalid schema",
        json!({ "type": 42 }),
    )];

    let outcome = repair_tool_call(&tools, "broken", "{}", &canonical_name);

    assert!(matches!(
        outcome,
        ToolCallRepairOutcome::Invalid(ToolCallRepairFailure {
            kind: ToolCallRepairFailureKind::InvalidSchema,
            ..
        })
    ));
}
