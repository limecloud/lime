//! Artifact 输出 Schema 服务
//!
//! 根据 turn metadata 为 Artifact 回合生成 turn-level output schema，
//! 让模型输出从“提示词倾向”升级为“运行时结构合同”。

use aster::session::{TurnContextOverride, TurnOutputSchemaSource};
use serde_json::{json, Value};

const ARTIFACT_DOCUMENT_SCHEMA_VERSION: &str = "artifact_document.v1";
const ARTIFACT_KIND_VALUES: &[&str] = &[
    "report",
    "roadmap",
    "prd",
    "brief",
    "analysis",
    "comparison",
    "plan",
    "table_report",
];
const ARTIFACT_STAGE1_BLOCK_TYPE_VALUES: &[&str] = &[
    "section_header",
    "hero_summary",
    "key_points",
    "rich_text",
    "callout",
    "table",
    "checklist",
    "metric_grid",
    "citation_list",
];
const ARTIFACT_BLOCK_TYPE_VALUES: &[&str] = &[
    "section_header",
    "hero_summary",
    "key_points",
    "rich_text",
    "callout",
    "table",
    "checklist",
    "metric_grid",
    "quote",
    "citation_list",
    "image",
    "code_block",
    "divider",
];
const ARTIFACT_STATUS_VALUES: &[&str] = &["draft", "streaming", "ready", "failed", "archived"];
const ARTIFACT_SOURCE_POLICY_VALUES: &[&str] = &["required", "preferred", "none"];
const ARTIFACT_STAGE2_OP_VALUES: &[&str] = &[
    "artifact.create",
    "artifact.set_meta",
    "artifact.upsert_block",
    "artifact.reorder_blocks",
    "artifact.remove_block",
    "artifact.attach_source",
    "artifact.finalize_version",
    "artifact.fail",
];
const ARTIFACT_REWRITE_OP_VALUES: &[&str] = &[
    "artifact.set_meta",
    "artifact.upsert_block",
    "artifact.attach_source",
    "artifact.finalize_version",
    "artifact.fail",
];

#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct ArtifactOutputSchemaContext {
    mode: Option<String>,
    kind: Option<String>,
    stage: Option<String>,
    source_policy: Option<String>,
    target_block_id: Option<String>,
}

fn normalize_text(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn extract_artifact_object(
    request_metadata: Option<&Value>,
) -> Option<&serde_json::Map<String, Value>> {
    let metadata = request_metadata?;
    let object = metadata.as_object()?;
    if let Some(artifact) = object.get("artifact").and_then(Value::as_object) {
        return Some(artifact);
    }
    Some(object)
}

fn extract_artifact_string(request_metadata: Option<&Value>, keys: &[&str]) -> Option<String> {
    let artifact = extract_artifact_object(request_metadata)?;
    keys.iter()
        .filter_map(|key| artifact.get(*key))
        .find_map(Value::as_str)
        .and_then(|value| normalize_text(Some(value)))
}

fn build_artifact_output_schema_context(
    request_metadata: Option<&Value>,
) -> Option<ArtifactOutputSchemaContext> {
    let context = ArtifactOutputSchemaContext {
        mode: extract_artifact_string(request_metadata, &["artifact_mode", "artifactMode"]),
        kind: extract_artifact_string(request_metadata, &["artifact_kind", "artifactKind"]),
        stage: extract_artifact_string(request_metadata, &["artifact_stage", "artifactStage"]),
        source_policy: extract_artifact_string(
            request_metadata,
            &["source_policy", "sourcePolicy"],
        ),
        target_block_id: extract_artifact_string(
            request_metadata,
            &["artifact_target_block_id", "artifactTargetBlockId"],
        ),
    };

    if context.mode.is_none()
        && context.kind.is_none()
        && context.stage.is_none()
        && context.source_policy.is_none()
        && context.target_block_id.is_none()
    {
        None
    } else {
        Some(context)
    }
}

fn build_string_schema(
    values: &[&str],
    narrowed: Option<&str>,
    fallback_default: Option<&str>,
) -> Value {
    if let Some(value) = narrowed {
        return json!({
            "type": "string",
            "enum": [value]
        });
    }

    if let Some(default_value) = fallback_default {
        json!({
            "type": "string",
            "enum": values,
            "default": default_value
        })
    } else {
        json!({
            "type": "string",
            "enum": values
        })
    }
}

fn build_stage1_output_schema(context: &ArtifactOutputSchemaContext) -> Value {
    json!({
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "title": "lime_artifact_stage1_result",
        "type": "object",
        "additionalProperties": false,
        "required": [
            "needsArtifact",
            "kind",
            "title",
            "sourcePolicy",
            "outline",
            "blockPlan"
        ],
        "properties": {
            "needsArtifact": {
                "type": "boolean"
            },
            "kind": build_string_schema(
                ARTIFACT_KIND_VALUES,
                context.kind.as_deref(),
                Some("analysis")
            ),
            "title": {
                "type": "string",
                "minLength": 1,
                "maxLength": 120
            },
            "sourcePolicy": build_string_schema(
                ARTIFACT_SOURCE_POLICY_VALUES,
                context.source_policy.as_deref(),
                Some("preferred")
            ),
            "outline": {
                "type": "array",
                "minItems": 1,
                "items": {
                    "type": "object",
                    "additionalProperties": false,
                    "required": ["id", "title", "goal"],
                    "properties": {
                        "id": {
                            "type": "string",
                            "minLength": 1
                        },
                        "title": {
                            "type": "string",
                            "minLength": 1
                        },
                        "goal": {
                            "type": "string",
                            "minLength": 1
                        }
                    }
                }
            },
            "blockPlan": {
                "type": "array",
                "minItems": 1,
                "items": {
                    "type": "object",
                    "additionalProperties": false,
                    "required": ["id", "type", "purpose"],
                    "properties": {
                        "id": {
                            "type": "string",
                            "minLength": 1
                        },
                        "type": {
                            "type": "string",
                            "enum": ARTIFACT_STAGE1_BLOCK_TYPE_VALUES
                        },
                        "sectionId": {
                            "type": "string",
                            "minLength": 1
                        },
                        "purpose": {
                            "type": "string",
                            "minLength": 1
                        }
                    }
                }
            },
            "gaps": {
                "type": "array",
                "items": {
                    "type": "string",
                    "minLength": 1
                }
            }
        }
    })
}

fn build_stage2_document_schema(context: &ArtifactOutputSchemaContext) -> Value {
    let required_source_count = if context.source_policy.as_deref() == Some("required") {
        1
    } else {
        0
    };

    json!({
        "type": "object",
        "additionalProperties": true,
        "required": [
            "schemaVersion",
            "kind",
            "title",
            "status",
            "language",
            "blocks",
            "sources",
            "metadata"
        ],
        "properties": {
            "schemaVersion": {
                "type": "string",
                "enum": [ARTIFACT_DOCUMENT_SCHEMA_VERSION]
            },
            "artifactId": {
                "type": "string",
                "minLength": 1
            },
            "workspaceId": {
                "type": "string",
                "minLength": 1
            },
            "threadId": {
                "type": "string",
                "minLength": 1
            },
            "turnId": {
                "type": "string",
                "minLength": 1
            },
            "kind": build_string_schema(
                ARTIFACT_KIND_VALUES,
                context.kind.as_deref(),
                Some("analysis")
            ),
            "title": {
                "type": "string",
                "minLength": 1,
                "maxLength": 120
            },
            "status": {
                "type": "string",
                "enum": ARTIFACT_STATUS_VALUES
            },
            "language": {
                "type": "string",
                "enum": ["zh-CN"]
            },
            "summary": {
                "type": "string"
            },
            "blocks": {
                "type": "array",
                "minItems": 1,
                "maxItems": 40,
                "items": {
                    "type": "object",
                    "additionalProperties": true,
                    "required": ["id", "type"],
                    "properties": {
                        "id": {
                            "type": "string",
                            "minLength": 1
                        },
                        "type": {
                            "type": "string",
                            "enum": ARTIFACT_BLOCK_TYPE_VALUES
                        },
                        "sectionId": {
                            "type": "string",
                            "minLength": 1
                        },
                        "hidden": {
                            "type": "boolean"
                        },
                        "sourceIds": {
                            "type": "array",
                            "items": {
                                "type": "string",
                                "minLength": 1
                            }
                        }
                    }
                }
            },
            "sources": {
                "type": "array",
                "minItems": required_source_count,
                "items": {
                    "type": "object",
                    "additionalProperties": true,
                    "required": ["id"],
                    "properties": {
                        "id": {
                            "type": "string",
                            "minLength": 1
                        },
                        "title": {
                            "type": "string"
                        },
                        "url": {
                            "type": "string"
                        },
                        "note": {
                            "type": "string"
                        },
                        "quote": {
                            "type": "string"
                        },
                        "kind": {
                            "type": "string"
                        },
                        "publishedAt": {
                            "type": "string"
                        }
                    },
                    "anyOf": [
                        { "required": ["title"] },
                        { "required": ["url"] },
                        { "required": ["note"] },
                        { "required": ["quote"] }
                    ]
                }
            },
            "metadata": {
                "type": "object"
            }
        }
    })
}

fn build_artifact_block_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": true,
        "required": ["id", "type"],
        "properties": {
            "id": {
                "type": "string",
                "minLength": 1
            },
            "type": {
                "type": "string",
                "enum": ARTIFACT_BLOCK_TYPE_VALUES
            },
            "sectionId": {
                "type": "string",
                "minLength": 1
            },
            "hidden": {
                "type": "boolean"
            },
            "sourceIds": {
                "type": "array",
                "items": {
                    "type": "string",
                    "minLength": 1
                }
            }
        }
    })
}

fn build_artifact_source_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": true,
        "properties": {
            "id": {
                "type": "string",
                "minLength": 1
            },
            "title": {
                "type": "string"
            },
            "url": {
                "type": "string"
            },
            "note": {
                "type": "string"
            },
            "quote": {
                "type": "string"
            },
            "kind": {
                "type": "string"
            },
            "publishedAt": {
                "type": "string"
            },
            "locator": {}
        },
        "anyOf": [
            { "required": ["id"] },
            { "required": ["title"] },
            { "required": ["url"] },
            { "required": ["note"] },
            { "required": ["quote"] }
        ]
    })
}

fn build_stage2_document_envelope_schema(context: &ArtifactOutputSchemaContext) -> Value {
    json!({
        "title": "lime_artifact_document_draft",
        "type": "object",
        "additionalProperties": false,
        "required": ["type", "document"],
        "properties": {
            "type": {
                "type": "string",
                "enum": ["artifact_document_draft"]
            },
            "document": build_stage2_document_schema(context)
        }
    })
}

fn build_block_id_constraint_schema(target_block_id: Option<&str>) -> Value {
    if let Some(target_block_id) = target_block_id {
        json!({
            "type": "string",
            "enum": [target_block_id]
        })
    } else {
        json!({
            "type": "string",
            "minLength": 1
        })
    }
}

fn build_artifact_block_schema_with_target_id(target_block_id: Option<&str>) -> Value {
    let mut schema = build_artifact_block_schema();
    if let Some(target_block_id) = target_block_id {
        if let Some(properties) = schema
            .as_object_mut()
            .and_then(|record| record.get_mut("properties"))
            .and_then(Value::as_object_mut)
        {
            properties.insert(
                "id".to_string(),
                build_block_id_constraint_schema(Some(target_block_id)),
            );
        }
    }
    schema
}

fn build_artifact_ops_item_schema(op_values: &[&str], target_block_id: Option<&str>) -> Value {
    let mut item_schemas = vec![
        json!({
            "type": "object",
            "additionalProperties": false,
            "required": ["op"],
            "properties": {
                "op": build_string_schema(op_values, Some("artifact.set_meta"), None),
                "title": {
                    "type": "string",
                    "minLength": 1
                },
                "kind": {
                    "type": "string",
                    "enum": ARTIFACT_KIND_VALUES
                },
                "status": {
                    "type": "string",
                    "enum": ARTIFACT_STATUS_VALUES
                },
                "summary": {
                    "type": "string"
                },
                "metadata": {
                    "type": "object"
                }
            },
            "anyOf": [
                { "required": ["title"] },
                { "required": ["kind"] },
                { "required": ["status"] },
                { "required": ["summary"] },
                { "required": ["metadata"] }
            ]
        }),
        json!({
            "type": "object",
            "additionalProperties": false,
            "required": ["op", "block"],
            "properties": {
                "op": build_string_schema(op_values, Some("artifact.upsert_block"), None),
                "block": build_artifact_block_schema_with_target_id(target_block_id),
                "beforeBlockId": build_block_id_constraint_schema(None),
                "afterBlockId": build_block_id_constraint_schema(None)
            }
        }),
        json!({
            "type": "object",
            "additionalProperties": false,
            "required": ["op", "blockId", "source"],
            "properties": {
                "op": build_string_schema(op_values, Some("artifact.attach_source"), None),
                "blockId": build_block_id_constraint_schema(target_block_id),
                "source": build_artifact_source_schema(),
                "sourceLink": {
                    "type": "object",
                    "additionalProperties": true
                }
            }
        }),
        json!({
            "type": "object",
            "additionalProperties": false,
            "required": ["op"],
            "properties": {
                "op": build_string_schema(op_values, Some("artifact.finalize_version"), None),
                "summary": {
                    "type": "string"
                },
                "status": {
                    "type": "string",
                    "enum": ARTIFACT_STATUS_VALUES
                }
            }
        }),
        json!({
            "type": "object",
            "additionalProperties": false,
            "required": ["op", "reason"],
            "properties": {
                "op": build_string_schema(op_values, Some("artifact.fail"), None),
                "reason": {
                    "type": "string",
                    "minLength": 1
                }
            }
        }),
    ];

    if op_values.contains(&"artifact.create") {
        item_schemas.push(json!({
            "type": "object",
            "additionalProperties": false,
            "required": ["op"],
            "properties": {
                "op": build_string_schema(op_values, Some("artifact.create"), None),
                "document": {
                    "type": "object"
                },
                "title": {
                    "type": "string",
                    "minLength": 1
                },
                "kind": {
                    "type": "string",
                    "enum": ARTIFACT_KIND_VALUES
                },
                "status": {
                    "type": "string",
                    "enum": ARTIFACT_STATUS_VALUES
                },
                "summary": {
                    "type": "string"
                },
                "metadata": {
                    "type": "object"
                }
            }
        }));
    }

    if op_values.contains(&"artifact.reorder_blocks") {
        item_schemas.push(json!({
            "type": "object",
            "additionalProperties": false,
            "required": ["op", "blockIds"],
            "properties": {
                "op": build_string_schema(op_values, Some("artifact.reorder_blocks"), None),
                "blockIds": {
                    "type": "array",
                    "minItems": 1,
                    "items": {
                        "type": "string",
                        "minLength": 1
                    }
                }
            }
        }));
    }

    if op_values.contains(&"artifact.remove_block") {
        item_schemas.push(json!({
            "type": "object",
            "additionalProperties": false,
            "required": ["op", "blockId"],
            "properties": {
                "op": build_string_schema(op_values, Some("artifact.remove_block"), None),
                "blockId": build_block_id_constraint_schema(target_block_id)
            }
        }));
    }

    if target_block_id.is_some() {
        item_schemas = item_schemas
            .into_iter()
            .map(|schema| {
                let Some(record) = schema.as_object() else {
                    return schema;
                };
                let Some(properties) = record.get("properties").and_then(Value::as_object) else {
                    return schema;
                };
                if !properties.contains_key("block") {
                    return schema;
                }

                let mut next_record = record.clone();
                if let Some(next_properties) = next_record
                    .get_mut("properties")
                    .and_then(Value::as_object_mut)
                {
                    next_properties.remove("beforeBlockId");
                    next_properties.remove("afterBlockId");
                }
                Value::Object(next_record)
            })
            .collect();
    }

    json!({
        "oneOf": item_schemas
    })
}

fn build_artifact_ops_output_schema(op_values: &[&str], target_block_id: Option<&str>) -> Value {
    json!({
        "title": "lime_artifact_ops",
        "type": "object",
        "additionalProperties": false,
        "required": ["type", "ops"],
        "properties": {
            "type": {
                "type": "string",
                "enum": ["artifact_ops"]
            },
            "artifactId": {
                "type": "string",
                "minLength": 1
            },
            "ops": {
                "type": "array",
                "minItems": 1,
                "items": build_artifact_ops_item_schema(op_values, target_block_id)
            }
        }
    })
}

fn build_artifact_rewrite_patch_output_schema(context: &ArtifactOutputSchemaContext) -> Value {
    json!({
        "title": "lime_artifact_rewrite_patch",
        "type": "object",
        "additionalProperties": false,
        "required": ["type", "targetBlockId", "block"],
        "properties": {
            "type": {
                "type": "string",
                "enum": ["artifact_rewrite_patch"]
            },
            "artifactId": {
                "type": "string",
                "minLength": 1
            },
            "targetBlockId": build_block_id_constraint_schema(context.target_block_id.as_deref()),
            "block": build_artifact_block_schema_with_target_id(context.target_block_id.as_deref()),
            "source": build_artifact_source_schema(),
            "sources": {
                "type": "array",
                "minItems": 1,
                "items": build_artifact_source_schema()
            },
            "summary": {
                "type": "string"
            },
            "status": {
                "type": "string",
                "enum": ARTIFACT_STATUS_VALUES
            }
        }
    })
}

fn build_stage2_output_schema(context: &ArtifactOutputSchemaContext) -> Value {
    json!({
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "title": "lime_artifact_stage2_result",
        "oneOf": [
            build_stage2_document_envelope_schema(context),
            build_artifact_ops_output_schema(ARTIFACT_STAGE2_OP_VALUES, None)
        ]
    })
}

fn build_rewrite_output_schema(context: &ArtifactOutputSchemaContext) -> Value {
    json!({
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "title": "lime_artifact_rewrite_result",
        "oneOf": [
            build_artifact_rewrite_patch_output_schema(context),
            build_artifact_ops_output_schema(
                ARTIFACT_REWRITE_OP_VALUES,
                context.target_block_id.as_deref()
            )
        ]
    })
}

pub fn build_artifact_output_schema(request_metadata: Option<&Value>) -> Option<Value> {
    let context = build_artifact_output_schema_context(request_metadata)?;
    if matches!(context.mode.as_deref(), Some("none")) {
        return None;
    }

    let stage = context
        .stage
        .as_deref()
        .or(context.mode.as_deref())
        .unwrap_or("stage2");

    match stage {
        "stage1" => Some(build_stage1_output_schema(&context)),
        "rewrite" => Some(build_rewrite_output_schema(&context)),
        "stage2" => Some(build_stage2_output_schema(&context)),
        _ => Some(build_stage2_output_schema(&context)),
    }
}

pub fn merge_turn_context_with_artifact_output_schema(
    turn_context: Option<TurnContextOverride>,
    request_metadata: Option<&Value>,
) -> Option<TurnContextOverride> {
    let Some(output_schema) = build_artifact_output_schema(request_metadata) else {
        return turn_context;
    };

    match turn_context {
        Some(mut turn_context) => {
            if turn_context.output_schema.is_none() {
                turn_context.output_schema = Some(output_schema);
            }
            if turn_context.output_schema_source.is_none() {
                turn_context.output_schema_source = Some(TurnOutputSchemaSource::Turn);
            }
            Some(turn_context)
        }
        None => Some(TurnContextOverride {
            output_schema: Some(output_schema),
            output_schema_source: Some(TurnOutputSchemaSource::Turn),
            ..TurnContextOverride::default()
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stage1_should_build_outline_schema() {
        let metadata = json!({
            "artifact_mode": "draft",
            "artifact_stage": "stage1",
            "artifact_kind": "analysis",
            "source_policy": "required"
        });

        let schema = build_artifact_output_schema(Some(&metadata)).expect("schema");
        assert_eq!(schema.get("type").and_then(Value::as_str), Some("object"));
        assert_eq!(
            schema
                .get("properties")
                .and_then(Value::as_object)
                .and_then(|properties| properties.get("kind"))
                .and_then(|kind| kind.get("enum"))
                .and_then(Value::as_array)
                .and_then(|items| items.first())
                .and_then(Value::as_str),
            Some("analysis")
        );
        assert!(schema
            .get("properties")
            .and_then(Value::as_object)
            .and_then(|properties| properties.get("blockPlan"))
            .is_some());
    }

    #[test]
    fn stage2_should_build_required_source_document_schema() {
        let metadata = json!({
            "artifact": {
                "artifact_mode": "draft",
                "artifact_stage": "stage2",
                "artifact_kind": "report",
                "source_policy": "required"
            }
        });

        let schema = build_artifact_output_schema(Some(&metadata)).expect("schema");
        assert_eq!(
            schema
                .get("oneOf")
                .and_then(Value::as_array)
                .and_then(|items| items.first())
                .and_then(|item| item.get("properties"))
                .and_then(Value::as_object)
                .and_then(|properties| properties.get("type"))
                .and_then(|kind| kind.get("enum"))
                .and_then(Value::as_array)
                .and_then(|items| items.first())
                .and_then(Value::as_str),
            Some("artifact_document_draft")
        );
        assert_eq!(
            schema
                .get("oneOf")
                .and_then(Value::as_array)
                .and_then(|items| items.first())
                .and_then(|item| item.get("properties"))
                .and_then(Value::as_object)
                .and_then(|properties| properties.get("document"))
                .and_then(|document| document.get("properties"))
                .and_then(Value::as_object)
                .and_then(|properties| properties.get("sources"))
                .and_then(|sources| sources.get("minItems"))
                .and_then(Value::as_u64),
            Some(1)
        );
    }

    #[test]
    fn rewrite_should_build_artifact_ops_schema() {
        let metadata = json!({
            "artifact": {
                "artifact_mode": "rewrite",
                "artifact_stage": "rewrite",
                "artifact_kind": "report",
                "artifact_target_block_id": "body-1"
            }
        });

        let schema = build_artifact_output_schema(Some(&metadata)).expect("schema");
        assert_eq!(
            schema
                .get("oneOf")
                .and_then(Value::as_array)
                .map(|items| items.len()),
            Some(2)
        );
        let rewrite_patch_schema = schema
            .get("oneOf")
            .and_then(Value::as_array)
            .and_then(|items| {
                items.iter().find(|item| {
                    item.get("properties")
                        .and_then(Value::as_object)
                        .and_then(|properties| properties.get("op"))
                        .is_none()
                        && item
                            .get("properties")
                            .and_then(Value::as_object)
                            .and_then(|properties| properties.get("type"))
                            .and_then(|op| op.get("enum"))
                            .and_then(Value::as_array)
                            .and_then(|values| values.first())
                            .and_then(Value::as_str)
                            == Some("artifact_rewrite_patch")
                })
            })
            .expect("rewrite patch schema");
        assert_eq!(
            rewrite_patch_schema
                .get("properties")
                .and_then(Value::as_object)
                .and_then(|properties| properties.get("targetBlockId"))
                .and_then(|id| id.get("enum"))
                .and_then(Value::as_array)
                .and_then(|values| values.first())
                .and_then(Value::as_str),
            Some("body-1")
        );
        assert_eq!(
            rewrite_patch_schema
                .get("properties")
                .and_then(Value::as_object)
                .and_then(|properties| properties.get("block"))
                .and_then(|block| block.get("properties"))
                .and_then(Value::as_object)
                .and_then(|properties| properties.get("id"))
                .and_then(|id| id.get("enum"))
                .and_then(Value::as_array)
                .and_then(|values| values.first())
                .and_then(Value::as_str),
            Some("body-1")
        );
        let ops_schema = schema
            .get("oneOf")
            .and_then(Value::as_array)
            .and_then(|items| {
                items.iter().find(|item| {
                    item.get("properties")
                        .and_then(Value::as_object)
                        .and_then(|properties| properties.get("type"))
                        .and_then(|op| op.get("enum"))
                        .and_then(Value::as_array)
                        .and_then(|values| values.first())
                        .and_then(Value::as_str)
                        == Some("artifact_ops")
                })
            })
            .expect("ops schema");
        let upsert_schema = ops_schema
            .get("properties")
            .and_then(Value::as_object)
            .and_then(|properties| properties.get("ops"))
            .and_then(|ops| ops.get("items"))
            .and_then(|items| items.get("oneOf"))
            .and_then(Value::as_array)
            .and_then(|items| {
                items.iter().find(|item| {
                    item.get("properties")
                        .and_then(Value::as_object)
                        .and_then(|properties| properties.get("op"))
                        .and_then(|op| op.get("enum"))
                        .and_then(Value::as_array)
                        .and_then(|values| values.first())
                        .and_then(Value::as_str)
                        == Some("artifact.upsert_block")
                })
            })
            .expect("upsert schema");
        assert_eq!(
            upsert_schema
                .get("properties")
                .and_then(Value::as_object)
                .and_then(|properties| properties.get("block"))
                .and_then(|block| block.get("properties"))
                .and_then(Value::as_object)
                .and_then(|properties| properties.get("id"))
                .and_then(|id| id.get("enum"))
                .and_then(Value::as_array)
                .and_then(|values| values.first())
                .and_then(Value::as_str),
            Some("body-1")
        );
        assert!(upsert_schema
            .get("properties")
            .and_then(Value::as_object)
            .is_some_and(|properties| !properties.contains_key("beforeBlockId")));
    }

    #[test]
    fn merge_turn_context_should_inject_output_schema_without_dropping_existing_context() {
        let metadata = json!({
            "artifact_mode": "draft",
            "artifact_stage": "stage2",
            "artifact_kind": "plan"
        });
        let turn_context = TurnContextOverride {
            model: Some("gpt-5.4".to_string()),
            metadata: std::collections::HashMap::from([(
                "theme".to_string(),
                Value::String("planning".to_string()),
            )]),
            ..TurnContextOverride::default()
        };

        let merged =
            merge_turn_context_with_artifact_output_schema(Some(turn_context), Some(&metadata))
                .expect("merged turn context");

        assert_eq!(merged.model.as_deref(), Some("gpt-5.4"));
        assert_eq!(
            merged.metadata.get("theme").and_then(Value::as_str),
            Some("planning")
        );
        assert!(merged.output_schema.is_some());
        assert_eq!(
            merged.output_schema_source,
            Some(TurnOutputSchemaSource::Turn)
        );
    }

    #[test]
    fn merge_turn_context_should_not_override_existing_output_schema() {
        let existing_schema = json!({
            "type": "object",
            "properties": {
                "answer": {
                    "type": "string"
                }
            }
        });
        let turn_context = TurnContextOverride {
            output_schema: Some(existing_schema.clone()),
            ..TurnContextOverride::default()
        };
        let metadata = json!({
            "artifact_mode": "draft",
            "artifact_stage": "stage2"
        });

        let merged =
            merge_turn_context_with_artifact_output_schema(Some(turn_context), Some(&metadata))
                .expect("merged");

        assert_eq!(merged.output_schema, Some(existing_schema));
    }
}
