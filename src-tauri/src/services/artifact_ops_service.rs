//! Artifact 增量包络应用服务
//!
//! 负责解析 current / compat Artifact 增量包络，并把它们应用到现有
//! `ArtifactDocument v1`，为后续 rewrite / diff / 版本化打地基。

use crate::services::artifact_document_validator::{
    ArtifactDocumentValidationContext, ARTIFACT_DOCUMENT_SCHEMA_VERSION,
};
use serde_json::{Map, Value};

const ARTIFACT_OPS_ENVELOPE_TYPE: &str = "artifact_ops";
const ARTIFACT_REWRITE_PATCH_ENVELOPE_TYPE: &str = "artifact_rewrite_patch";
const ARTIFACT_INTERNAL_SOURCE_UPSERT_OP: &str = "artifact.source.upsert";
const ARTIFACT_INCREMENTAL_ENVELOPE_TYPES: &[&str] = &[
    "artifact.begin",
    "artifact.meta.patch",
    "artifact.source.upsert",
    "artifact.block.upsert",
    "artifact.block.remove",
    "artifact.complete",
    "artifact.fail",
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ArtifactOpsApplyOutcome {
    pub document: Value,
    pub issues: Vec<String>,
}

pub fn extract_artifact_operation_candidate(raw_text: &str) -> Option<Value> {
    let trimmed = raw_text.trim();
    if trimmed.is_empty() {
        return None;
    }

    let candidates = [
        trimmed.to_string(),
        strip_outer_code_fence(trimmed),
        extract_first_fenced_payload(trimmed).unwrap_or_default(),
        extract_braced_json_candidate(trimmed).unwrap_or_default(),
    ];

    for candidate in candidates {
        let normalized = candidate.trim();
        if normalized.is_empty() {
            continue;
        }
        let Ok(parsed) = serde_json::from_str::<Value>(normalized) else {
            continue;
        };
        if let Some(ops) = unwrap_artifact_ops_envelope(&parsed) {
            return Some(ops.clone());
        }
        if let Some(incremental) = unwrap_artifact_incremental_envelope(&parsed) {
            return Some(incremental.clone());
        }
        if let Some(rewrite_patch) = unwrap_artifact_rewrite_patch_envelope(&parsed) {
            return Some(rewrite_patch.clone());
        }
    }

    None
}

pub fn apply_artifact_operation_candidate_to_document(
    base_document: Option<&Value>,
    operation_value: &Value,
    context: &ArtifactDocumentValidationContext,
) -> ArtifactOpsApplyOutcome {
    let Some(actions) = normalize_artifact_operation_candidate_to_actions(operation_value) else {
        let mut issues = Vec::new();
        let document = initialize_document(base_document, context);
        issues.push("未识别的 Artifact 增量包络，已回退到当前文档骨架。".to_string());
        return ArtifactOpsApplyOutcome { document, issues };
    };

    apply_artifact_actions_to_document(base_document, &actions, context)
}

fn apply_artifact_actions_to_document(
    base_document: Option<&Value>,
    actions: &[Value],
    context: &ArtifactDocumentValidationContext,
) -> ArtifactOpsApplyOutcome {
    let mut issues = Vec::new();
    let mut document = initialize_document(base_document, context);
    if actions.is_empty() {
        issues.push("增量包络没有提供可执行的动作，已沿用现有文档骨架。".to_string());
        return ArtifactOpsApplyOutcome { document, issues };
    }

    for (index, action) in actions.iter().enumerate() {
        apply_single_action(&mut document, action, index, context, &mut issues);
    }

    ArtifactOpsApplyOutcome { document, issues }
}

fn normalize_artifact_operation_candidate_to_actions(candidate: &Value) -> Option<Vec<Value>> {
    if let Some(ops) = unwrap_artifact_ops_envelope(candidate) {
        return Some(extract_ops_actions(ops));
    }
    if let Some(incremental) = unwrap_artifact_incremental_envelope(candidate) {
        return convert_incremental_envelope_to_artifact_action(incremental)
            .map(|action| vec![action]);
    }
    if let Some(rewrite_patch) = unwrap_artifact_rewrite_patch_envelope(candidate) {
        return convert_rewrite_patch_to_artifact_actions(rewrite_patch);
    }
    None
}

fn extract_ops_actions(value: &Value) -> Vec<Value> {
    value
        .as_object()
        .and_then(|record| record.get("ops"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
}

fn unwrap_artifact_ops_envelope(value: &Value) -> Option<&Value> {
    let record = value.as_object()?;
    let op_type = record
        .get("type")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if op_type == Some(ARTIFACT_OPS_ENVELOPE_TYPE) {
        return Some(value);
    }

    if record.get("ops").and_then(Value::as_array).is_some() {
        return Some(value);
    }

    None
}

fn unwrap_artifact_incremental_envelope(value: &Value) -> Option<&Value> {
    let record = value.as_object()?;
    let envelope_type = record
        .get("type")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())?;
    if ARTIFACT_INCREMENTAL_ENVELOPE_TYPES.contains(&envelope_type) {
        Some(value)
    } else {
        None
    }
}

fn unwrap_artifact_rewrite_patch_envelope(value: &Value) -> Option<&Value> {
    let record = value.as_object()?;
    let patch_type = record
        .get("type")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if patch_type == Some(ARTIFACT_REWRITE_PATCH_ENVELOPE_TYPE) {
        return Some(value);
    }

    if record
        .get("targetBlockId")
        .or_else(|| record.get("target_block_id"))
        .is_some()
        && record.get("block").and_then(Value::as_object).is_some()
    {
        return Some(value);
    }

    None
}

fn convert_rewrite_patch_to_artifact_actions(value: &Value) -> Option<Vec<Value>> {
    let record = value.as_object()?;
    let block_record = record.get("block").and_then(Value::as_object)?.clone();
    let block_id = normalize_text(block_record.get("id").and_then(Value::as_str))?;
    let target_block_id = normalize_text(
        record
            .get("targetBlockId")
            .or_else(|| record.get("target_block_id"))
            .and_then(Value::as_str),
    )
    .unwrap_or_else(|| block_id.clone());
    if block_id != target_block_id {
        return None;
    }

    let mut actions = vec![serde_json::json!({
        "op": "artifact.upsert_block",
        "block": Value::Object(block_record)
    })];

    if let Some(source) = record.get("source") {
        actions.push(serde_json::json!({
            "op": "artifact.attach_source",
            "blockId": target_block_id,
            "source": source
        }));
    }
    if let Some(sources) = record.get("sources").and_then(Value::as_array) {
        for source in sources {
            actions.push(serde_json::json!({
                "op": "artifact.attach_source",
                "blockId": target_block_id,
                "source": source
            }));
        }
    }

    let mut finalize_record = Map::new();
    finalize_record.insert(
        "op".to_string(),
        Value::String("artifact.finalize_version".to_string()),
    );
    if let Some(summary) = normalize_text(record.get("summary").and_then(Value::as_str)) {
        finalize_record.insert("summary".to_string(), Value::String(summary));
    }
    if let Some(status) = normalize_text(record.get("status").and_then(Value::as_str)) {
        finalize_record.insert("status".to_string(), Value::String(status));
    }
    if finalize_record.len() > 1 {
        actions.push(Value::Object(finalize_record));
    }

    Some(actions)
}

fn convert_incremental_envelope_to_artifact_action(value: &Value) -> Option<Value> {
    let record = value.as_object()?;
    let envelope_type = normalize_text(record.get("type").and_then(Value::as_str))?;
    match envelope_type.as_str() {
        "artifact.begin" => {
            let kind = normalize_text(record.get("kind").and_then(Value::as_str))?;
            let title = normalize_text(record.get("title").and_then(Value::as_str))?;
            Some(serde_json::json!({
                "op": "artifact.create",
                "kind": kind,
                "title": title,
            }))
        }
        "artifact.meta.patch" => {
            let patch = record.get("patch").and_then(Value::as_object)?.clone();
            Some(serde_json::json!({
                "op": "artifact.set_meta",
                "metadata": Value::Object(patch),
            }))
        }
        "artifact.source.upsert" => {
            let source = record.get("source").and_then(Value::as_object)?.clone();
            Some(serde_json::json!({
                "op": ARTIFACT_INTERNAL_SOURCE_UPSERT_OP,
                "source": Value::Object(source),
            }))
        }
        "artifact.block.upsert" => {
            let block = record.get("block").and_then(Value::as_object)?.clone();
            Some(serde_json::json!({
                "op": "artifact.upsert_block",
                "block": Value::Object(block),
            }))
        }
        "artifact.block.remove" => {
            let block_id = normalize_text(record.get("blockId").and_then(Value::as_str))
                .or_else(|| normalize_text(record.get("block_id").and_then(Value::as_str)))?;
            Some(serde_json::json!({
                "op": "artifact.remove_block",
                "blockId": block_id,
            }))
        }
        "artifact.complete" => {
            let mut op = Map::from_iter([(
                "op".to_string(),
                Value::String("artifact.finalize_version".to_string()),
            )]);
            if let Some(summary) = normalize_text(record.get("summary").and_then(Value::as_str)) {
                op.insert("summary".to_string(), Value::String(summary));
            }
            Some(Value::Object(op))
        }
        "artifact.fail" => {
            let reason = normalize_text(record.get("reason").and_then(Value::as_str))?;
            Some(serde_json::json!({
                "op": "artifact.fail",
                "reason": reason,
            }))
        }
        _ => None,
    }
}

fn strip_outer_code_fence(raw: &str) -> String {
    let trimmed = raw.trim();
    if !(trimmed.starts_with("```") && trimmed.ends_with("```")) {
        return trimmed.to_string();
    }
    let mut lines = trimmed.lines();
    let _ = lines.next();
    let mut body = lines.collect::<Vec<_>>();
    if !body.is_empty() {
        body.pop();
    }
    body.join("\n").trim().to_string()
}

fn extract_first_fenced_payload(raw: &str) -> Option<String> {
    let start = raw.find("```")?;
    let remainder = &raw[start + 3..];
    let newline_idx = remainder.find('\n')?;
    let content_start = start + 3 + newline_idx + 1;
    let end = raw[content_start..].find("```")?;
    Some(raw[content_start..content_start + end].trim().to_string())
}

fn extract_braced_json_candidate(raw: &str) -> Option<String> {
    let start = raw.find('{')?;
    let end = raw.rfind('}')?;
    if end <= start {
        return None;
    }
    Some(raw[start..=end].trim().to_string())
}

fn initialize_document(
    base_document: Option<&Value>,
    context: &ArtifactDocumentValidationContext,
) -> Value {
    let mut document = base_document
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    document.insert(
        "schemaVersion".to_string(),
        Value::String(ARTIFACT_DOCUMENT_SCHEMA_VERSION.to_string()),
    );
    document.insert(
        "artifactId".to_string(),
        Value::String(context.artifact_id.clone()),
    );
    upsert_optional_string_field(
        &mut document,
        "workspaceId",
        context.workspace_id.as_deref(),
    );
    upsert_optional_string_field(&mut document, "threadId", context.thread_id.as_deref());
    upsert_optional_string_field(&mut document, "turnId", context.turn_id.as_deref());
    ensure_text_field(
        &mut document,
        "kind",
        context.kind_hint.as_deref().unwrap_or("analysis"),
    );
    ensure_text_field(
        &mut document,
        "title",
        context.title_hint.as_deref().unwrap_or("未命名交付物"),
    );
    ensure_text_field(&mut document, "status", "draft");
    ensure_text_field(&mut document, "language", "zh-CN");
    ensure_array_field(&mut document, "blocks");
    ensure_array_field(&mut document, "sources");
    let metadata = ensure_object_field(&mut document, "metadata");
    if metadata
        .get("generatedBy")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_none()
    {
        metadata.insert(
            "generatedBy".to_string(),
            Value::String("agent".to_string()),
        );
    }
    if metadata
        .get("theme")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_none()
    {
        if let Some(theme) = context.theme.as_deref() {
            metadata.insert("theme".to_string(), Value::String(theme.to_string()));
        }
    }
    if let Some(request_id) = context.request_id.as_deref() {
        metadata.insert(
            "artifactRequestId".to_string(),
            Value::String(request_id.to_string()),
        );
    }
    Value::Object(document)
}

fn apply_single_action(
    document: &mut Value,
    op_value: &Value,
    index: usize,
    context: &ArtifactDocumentValidationContext,
    issues: &mut Vec<String>,
) {
    let Some(op_record) = op_value.as_object() else {
        issues.push(format!("ops[{index}] 不是对象，已忽略。"));
        return;
    };
    let Some(op_name) = normalize_text(op_record.get("op").and_then(Value::as_str)) else {
        issues.push(format!("ops[{index}] 缺少 op 字段，已忽略。"));
        return;
    };

    match op_name.as_str() {
        "artifact.create" => {
            if context.target_block_id.is_some() {
                issues.push(format!(
                    "ops[{index}] 在局部 rewrite 模式下不允许 `artifact.create`，已忽略。"
                ));
                return;
            }
            apply_create_op(document, op_record)
        }
        "artifact.set_meta" => apply_set_meta_op(document, op_record),
        "artifact.upsert_block" => {
            apply_upsert_block_op(document, op_record, index, context, issues)
        }
        "artifact.reorder_blocks" => {
            if context.target_block_id.is_some() {
                issues.push(format!(
                    "ops[{index}] 在局部 rewrite 模式下不允许重排 blocks，已忽略。"
                ));
                return;
            }
            apply_reorder_blocks_op(document, op_record, index, issues)
        }
        "artifact.remove_block" => {
            apply_remove_block_op(document, op_record, index, context, issues)
        }
        "artifact.attach_source" => {
            apply_attach_source_op(document, op_record, index, context, issues)
        }
        ARTIFACT_INTERNAL_SOURCE_UPSERT_OP => {
            apply_source_upsert_op(document, op_record, index, issues)
        }
        "artifact.finalize_version" => apply_finalize_version_op(document, op_record),
        "artifact.fail" => apply_fail_op(document, op_record),
        _ => issues.push(format!("ops[{index}].op `{op_name}` 暂不支持，已忽略。")),
    }
}

fn apply_create_op(document: &mut Value, op_record: &Map<String, Value>) {
    let Some(document_record) = document.as_object_mut() else {
        return;
    };
    if let Some(patch) = op_record.get("document").and_then(Value::as_object) {
        merge_document_patch(document_record, patch);
    }
    merge_meta_fields(document_record, op_record);
}

fn apply_set_meta_op(document: &mut Value, op_record: &Map<String, Value>) {
    let Some(document_record) = document.as_object_mut() else {
        return;
    };
    merge_meta_fields(document_record, op_record);
}

fn apply_upsert_block_op(
    document: &mut Value,
    op_record: &Map<String, Value>,
    index: usize,
    context: &ArtifactDocumentValidationContext,
    issues: &mut Vec<String>,
) {
    let Some(block_record) = op_record.get("block").and_then(Value::as_object) else {
        issues.push(format!("ops[{index}] 缺少 block 对象，已忽略。"));
        return;
    };
    let Some(block_id) = normalize_text(block_record.get("id").and_then(Value::as_str)) else {
        issues.push(format!("ops[{index}].block 缺少稳定 id，已忽略。"));
        return;
    };
    if !is_allowed_target_block(context, block_id.as_str()) {
        issues.push(format!(
            "ops[{index}] 试图改写非目标 block `{block_id}`，当前仅允许 `{}`，已忽略。",
            context.target_block_id.as_deref().unwrap_or_default()
        ));
        return;
    }

    let Some(document_record) = document.as_object_mut() else {
        return;
    };
    let blocks = ensure_array_field(document_record, "blocks");
    let previous_index = blocks.iter().position(|block| {
        block
            .as_object()
            .and_then(|record| record.get("id"))
            .and_then(Value::as_str)
            .map(str::trim)
            == Some(block_id.as_str())
    });
    if let Some(existing_index) = previous_index {
        blocks.remove(existing_index);
    }

    let insert_index = if context.target_block_id.is_some() {
        previous_index.unwrap_or(blocks.len())
    } else {
        resolve_block_insert_index(blocks, op_record)
    };
    let block = Value::Object(block_record.clone());
    if insert_index >= blocks.len() {
        blocks.push(block);
    } else {
        blocks.insert(insert_index, block);
    }
}

fn apply_reorder_blocks_op(
    document: &mut Value,
    op_record: &Map<String, Value>,
    index: usize,
    issues: &mut Vec<String>,
) {
    let desired_order = op_record
        .get("blockIds")
        .or_else(|| op_record.get("block_ids"))
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .filter_map(|value| normalize_text(Some(value)))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    if desired_order.is_empty() {
        issues.push(format!("ops[{index}] 缺少 blockIds，已忽略。"));
        return;
    }

    let Some(document_record) = document.as_object_mut() else {
        return;
    };
    let blocks = ensure_array_field(document_record, "blocks");
    let mut remaining = blocks.clone();
    let mut reordered = Vec::new();

    for block_id in desired_order {
        if let Some(position) = remaining.iter().position(|block| {
            block
                .as_object()
                .and_then(|record| record.get("id"))
                .and_then(Value::as_str)
                .map(str::trim)
                == Some(block_id.as_str())
        }) {
            reordered.push(remaining.remove(position));
        } else {
            issues.push(format!(
                "ops[{index}] 指定的 block `{block_id}` 不存在，已忽略该排序项。"
            ));
        }
    }

    reordered.extend(remaining);
    *blocks = reordered;
}

fn apply_remove_block_op(
    document: &mut Value,
    op_record: &Map<String, Value>,
    index: usize,
    context: &ArtifactDocumentValidationContext,
    issues: &mut Vec<String>,
) {
    let Some(block_id) = normalize_text(
        op_record
            .get("blockId")
            .or_else(|| op_record.get("block_id"))
            .and_then(Value::as_str),
    ) else {
        issues.push(format!("ops[{index}] 缺少 blockId，已忽略。"));
        return;
    };
    if !is_allowed_target_block(context, block_id.as_str()) {
        issues.push(format!(
            "ops[{index}] 试图删除非目标 block `{block_id}`，当前仅允许 `{}`，已忽略。",
            context.target_block_id.as_deref().unwrap_or_default()
        ));
        return;
    };
    if context.target_block_id.is_some() {
        issues.push(format!(
            "ops[{index}] 局部 rewrite 不允许删除目标 block `{block_id}`，已忽略。"
        ));
        return;
    }

    let Some(document_record) = document.as_object_mut() else {
        return;
    };
    let blocks = ensure_array_field(document_record, "blocks");
    let previous_len = blocks.len();
    blocks.retain(|block| {
        block
            .as_object()
            .and_then(|record| record.get("id"))
            .and_then(Value::as_str)
            .map(str::trim)
            != Some(block_id.as_str())
    });
    if previous_len == blocks.len() {
        issues.push(format!(
            "ops[{index}] 指定的 block `{block_id}` 不存在，已忽略。"
        ));
    }
}

fn apply_attach_source_op(
    document: &mut Value,
    op_record: &Map<String, Value>,
    index: usize,
    context: &ArtifactDocumentValidationContext,
    issues: &mut Vec<String>,
) {
    let Some(block_id) = normalize_text(
        op_record
            .get("blockId")
            .or_else(|| op_record.get("block_id"))
            .and_then(Value::as_str),
    ) else {
        issues.push(format!("ops[{index}] 缺少 blockId，已忽略来源绑定。"));
        return;
    };
    if !is_allowed_target_block(context, block_id.as_str()) {
        issues.push(format!(
            "ops[{index}] 试图给非目标 block `{block_id}` 绑定来源，当前仅允许 `{}`，已忽略。",
            context.target_block_id.as_deref().unwrap_or_default()
        ));
        return;
    }
    let Some(source_record) = op_record.get("source").and_then(Value::as_object) else {
        issues.push(format!("ops[{index}] 缺少 source 对象，已忽略来源绑定。"));
        return;
    };

    let Some(document_record) = document.as_object_mut() else {
        return;
    };
    let next_source_id = upsert_source_record(
        document_record,
        source_record,
        op_record.get("sourceLink").and_then(Value::as_object),
    );

    let blocks = ensure_array_field(document_record, "blocks");
    let Some(block) = blocks.iter_mut().find(|block| {
        block
            .as_object()
            .and_then(|record| record.get("id"))
            .and_then(Value::as_str)
            .map(str::trim)
            == Some(block_id.as_str())
    }) else {
        issues.push(format!(
            "ops[{index}] 目标 block `{block_id}` 不存在，已保留 source 但未完成绑定。"
        ));
        return;
    };
    let Some(block_record) = block.as_object_mut() else {
        return;
    };
    let source_ids = ensure_array_field(block_record, "sourceIds");
    let already_exists = source_ids
        .iter()
        .any(|value| value.as_str().map(str::trim) == Some(next_source_id.as_str()));
    if !already_exists {
        source_ids.push(Value::String(next_source_id));
    }
}

fn apply_source_upsert_op(
    document: &mut Value,
    op_record: &Map<String, Value>,
    index: usize,
    issues: &mut Vec<String>,
) {
    let Some(source_record) = op_record.get("source").and_then(Value::as_object) else {
        issues.push(format!("ops[{index}] 缺少 source 对象，已忽略来源写入。"));
        return;
    };
    let Some(document_record) = document.as_object_mut() else {
        return;
    };
    upsert_source_record(document_record, source_record, None);
}

fn is_allowed_target_block(context: &ArtifactDocumentValidationContext, block_id: &str) -> bool {
    context
        .target_block_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_none_or(|target_block_id| target_block_id == block_id)
}

fn apply_finalize_version_op(document: &mut Value, op_record: &Map<String, Value>) {
    let Some(document_record) = document.as_object_mut() else {
        return;
    };
    if let Some(status) = normalize_text(op_record.get("status").and_then(Value::as_str)) {
        document_record.insert("status".to_string(), Value::String(status));
    }
    if let Some(summary) = normalize_text(op_record.get("summary").and_then(Value::as_str)) {
        let metadata = ensure_object_field(document_record, "metadata");
        metadata.insert("versionSummary".to_string(), Value::String(summary));
    }
}

fn apply_fail_op(document: &mut Value, op_record: &Map<String, Value>) {
    let Some(document_record) = document.as_object_mut() else {
        return;
    };
    document_record.insert("status".to_string(), Value::String("failed".to_string()));
    if let Some(reason) = normalize_text(
        op_record
            .get("reason")
            .or_else(|| op_record.get("message"))
            .and_then(Value::as_str),
    ) {
        let metadata = ensure_object_field(document_record, "metadata");
        metadata.insert("failureReason".to_string(), Value::String(reason));
    }
}

fn upsert_source_record(
    document_record: &mut Map<String, Value>,
    source_record: &Map<String, Value>,
    source_link: Option<&Map<String, Value>>,
) -> String {
    let sources = ensure_array_field(document_record, "sources");
    let next_source_id = normalize_text(source_record.get("id").and_then(Value::as_str))
        .unwrap_or_else(|| format!("source-{}", sources.len() + 1));
    let mut merged_source = source_record.clone();
    merged_source.insert("id".to_string(), Value::String(next_source_id.clone()));
    if let Some(link_record) = source_link {
        if !merged_source.contains_key("locator") {
            if let Some(locator) = link_record.get("locator") {
                merged_source.insert("locator".to_string(), locator.clone());
            }
        }
        if merged_source
            .get("kind")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .is_none()
        {
            if let Some(source_type) = normalize_text(
                link_record
                    .get("sourceType")
                    .or_else(|| link_record.get("source_type"))
                    .and_then(Value::as_str),
            ) {
                merged_source.insert("kind".to_string(), Value::String(source_type));
            }
        }
        if merged_source
            .get("url")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .is_none()
        {
            if let Some(source_ref) = normalize_text(
                link_record
                    .get("sourceRef")
                    .or_else(|| link_record.get("source_ref"))
                    .and_then(Value::as_str),
            ) {
                merged_source.insert("url".to_string(), Value::String(source_ref));
            }
        }
    }

    if let Some(existing_index) = sources.iter().position(|source| {
        source
            .as_object()
            .and_then(|record| record.get("id"))
            .and_then(Value::as_str)
            .map(str::trim)
            == Some(next_source_id.as_str())
    }) {
        if let Some(existing) = sources[existing_index].as_object_mut() {
            for (key, value) in merged_source {
                existing.insert(key, value);
            }
        }
    } else {
        sources.push(Value::Object(merged_source));
    }

    next_source_id
}

fn merge_document_patch(document_record: &mut Map<String, Value>, patch: &Map<String, Value>) {
    for key in [
        "schemaVersion",
        "artifactId",
        "workspaceId",
        "threadId",
        "turnId",
        "kind",
        "title",
        "status",
        "language",
        "summary",
        "blocks",
        "sources",
    ] {
        if let Some(value) = patch.get(key) {
            document_record.insert(key.to_string(), value.clone());
        }
    }
    if let Some(metadata) = patch.get("metadata").and_then(Value::as_object) {
        let target = ensure_object_field(document_record, "metadata");
        for (key, value) in metadata {
            target.insert(key.clone(), value.clone());
        }
    }
}

fn merge_meta_fields(document_record: &mut Map<String, Value>, op_record: &Map<String, Value>) {
    for field in ["title", "kind", "status", "summary"] {
        if let Some(value) = op_record.get(field).and_then(Value::as_str) {
            if let Some(normalized) = normalize_text(Some(value)) {
                document_record.insert(field.to_string(), Value::String(normalized));
            }
        }
    }
    if let Some(metadata) = op_record.get("metadata").and_then(Value::as_object) {
        let target = ensure_object_field(document_record, "metadata");
        for (key, value) in metadata {
            target.insert(key.clone(), value.clone());
        }
    }
}

fn resolve_block_insert_index(blocks: &[Value], op_record: &Map<String, Value>) -> usize {
    if let Some(before_block_id) = normalize_text(
        op_record
            .get("beforeBlockId")
            .or_else(|| op_record.get("before_block_id"))
            .and_then(Value::as_str),
    ) {
        if let Some(position) = blocks.iter().position(|block| {
            block
                .as_object()
                .and_then(|record| record.get("id"))
                .and_then(Value::as_str)
                .map(str::trim)
                == Some(before_block_id.as_str())
        }) {
            return position;
        }
    }

    if let Some(after_block_id) = normalize_text(
        op_record
            .get("afterBlockId")
            .or_else(|| op_record.get("after_block_id"))
            .and_then(Value::as_str),
    ) {
        if let Some(position) = blocks.iter().position(|block| {
            block
                .as_object()
                .and_then(|record| record.get("id"))
                .and_then(Value::as_str)
                .map(str::trim)
                == Some(after_block_id.as_str())
        }) {
            return position + 1;
        }
    }

    blocks.len()
}

fn ensure_array_field<'a>(record: &'a mut Map<String, Value>, key: &str) -> &'a mut Vec<Value> {
    if !record.get(key).is_some_and(Value::is_array) {
        record.insert(key.to_string(), Value::Array(Vec::new()));
    }
    record
        .get_mut(key)
        .and_then(Value::as_array_mut)
        .expect("array field should exist")
}

fn ensure_object_field<'a>(
    record: &'a mut Map<String, Value>,
    key: &str,
) -> &'a mut Map<String, Value> {
    if !record.get(key).is_some_and(Value::is_object) {
        record.insert(key.to_string(), Value::Object(Map::new()));
    }
    record
        .get_mut(key)
        .and_then(Value::as_object_mut)
        .expect("object field should exist")
}

fn ensure_text_field(record: &mut Map<String, Value>, key: &str, fallback: &str) {
    let has_value = record
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .is_some_and(|value| !value.is_empty());
    if !has_value {
        record.insert(key.to_string(), Value::String(fallback.to_string()));
    }
}

fn upsert_optional_string_field(record: &mut Map<String, Value>, key: &str, value: Option<&str>) {
    if let Some(normalized) = normalize_text(value) {
        record.insert(key.to_string(), Value::String(normalized));
    }
}

fn normalize_text(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn extract_normalized_actions(raw_text: &str) -> Vec<Value> {
        let candidate = extract_artifact_operation_candidate(raw_text).expect("operation envelope");
        normalize_artifact_operation_candidate_to_actions(&candidate).expect("normalized actions")
    }

    fn build_context() -> ArtifactDocumentValidationContext {
        ArtifactDocumentValidationContext {
            artifact_id: "artifact-document:demo".to_string(),
            workspace_id: Some("workspace-1".to_string()),
            thread_id: Some("thread-1".to_string()),
            turn_id: Some("turn-2".to_string()),
            title_hint: Some("季度结论".to_string()),
            kind_hint: Some("analysis".to_string()),
            theme: Some("knowledge".to_string()),
            source_policy: Some("required".to_string()),
            request_id: Some("artifact:demo".to_string()),
            target_block_id: None,
        }
    }

    #[test]
    fn should_extract_artifact_ops_from_fenced_json() {
        let raw = r#"
```json
{
  "type": "artifact_ops",
  "ops": [
    {
      "op": "artifact.set_meta",
      "title": "更新后的标题"
    }
  ]
}
```
"#;

        let extracted = extract_normalized_actions(raw);
        assert_eq!(
            extracted
                .first()
                .and_then(|action| action.get("op"))
                .and_then(Value::as_str),
            Some("artifact.set_meta")
        );
    }

    #[test]
    fn should_extract_current_incremental_candidate_without_normalizing_to_compat() {
        let raw = r#"
{
  "type": "artifact.block.upsert",
  "artifactId": "artifact-document:demo",
  "block": {
    "id": "body-1",
    "type": "rich_text",
    "contentFormat": "markdown",
    "content": "增量改写后的正文"
  }
}
"#;

        let extracted = extract_artifact_operation_candidate(raw).expect("operation envelope");

        assert_eq!(
            extracted.get("type").and_then(Value::as_str).map(str::trim),
            Some("artifact.block.upsert")
        );
        assert!(extracted.get("ops").is_none());
    }

    #[test]
    fn should_extract_rewrite_patch_candidate_without_normalizing_to_compat() {
        let raw = r#"
{
  "type": "artifact_rewrite_patch",
  "artifactId": "artifact-document:demo",
  "targetBlockId": "body-1",
  "block": {
    "id": "body-1",
    "type": "rich_text",
    "contentFormat": "markdown",
    "content": "current shape 改写后的正文"
  }
}
"#;

        let extracted = extract_artifact_operation_candidate(raw).expect("operation envelope");

        assert_eq!(
            extracted.get("type").and_then(Value::as_str).map(str::trim),
            Some("artifact_rewrite_patch")
        );
        assert_eq!(
            extracted
                .get("block")
                .and_then(|block| block.get("content"))
                .and_then(Value::as_str),
            Some("current shape 改写后的正文")
        );
    }

    #[test]
    fn should_normalize_rewrite_patch_to_internal_actions() {
        let raw = r#"
{
  "type": "artifact_rewrite_patch",
  "artifactId": "artifact-document:demo",
  "targetBlockId": "body-1",
  "block": {
    "id": "body-1",
    "type": "rich_text",
    "markdown": "改写后的正文"
  },
  "source": {
    "id": "source-1",
    "title": "OpenAI",
    "url": "https://openai.com"
  },
  "summary": "仅改写目标正文"
}
"#;

        let actions = extract_normalized_actions(raw);

        assert_eq!(actions.len(), 3);
        assert_eq!(
            actions
                .first()
                .and_then(|op| op.get("op"))
                .and_then(Value::as_str),
            Some("artifact.upsert_block")
        );
        assert_eq!(
            actions
                .get(1)
                .and_then(|op| op.get("op"))
                .and_then(Value::as_str),
            Some("artifact.attach_source")
        );
        assert_eq!(
            actions
                .get(2)
                .and_then(|op| op.get("summary"))
                .and_then(Value::as_str),
            Some("仅改写目标正文")
        );
    }

    #[test]
    fn should_normalize_current_shaped_rewrite_patch_to_internal_actions() {
        let raw = r#"
{
  "type": "artifact_rewrite_patch",
  "artifactId": "artifact-document:demo",
  "targetBlockId": "body-1",
  "block": {
    "id": "body-1",
    "type": "rich_text",
    "contentFormat": "markdown",
    "content": "current shape 改写后的正文"
  },
  "source": {
    "id": "source-1",
    "type": "web",
    "label": "OpenAI",
    "locator": {
      "url": "https://openai.com"
    }
  },
  "summary": "current shape typed patch"
}
"#;

        let actions = extract_normalized_actions(raw);

        assert_eq!(actions.len(), 3);
        assert_eq!(
            actions
                .first()
                .and_then(|op| op.get("block"))
                .and_then(|block| block.get("content"))
                .and_then(Value::as_str),
            Some("current shape 改写后的正文")
        );
        assert_eq!(
            actions
                .get(1)
                .and_then(|op| op.get("source"))
                .and_then(|source| source.get("label"))
                .and_then(Value::as_str),
            Some("OpenAI")
        );
        assert_eq!(
            actions
                .get(2)
                .and_then(|op| op.get("summary"))
                .and_then(Value::as_str),
            Some("current shape typed patch")
        );
    }

    #[test]
    fn should_normalize_current_incremental_block_upsert_to_internal_action() {
        let raw = r#"
{
  "type": "artifact.block.upsert",
  "artifactId": "artifact-document:demo",
  "block": {
    "id": "body-1",
    "type": "rich_text",
    "contentFormat": "markdown",
    "content": "增量改写后的正文"
  }
}
"#;

        let actions = extract_normalized_actions(raw);

        assert_eq!(actions.len(), 1);
        assert_eq!(
            actions
                .first()
                .and_then(|op| op.get("op"))
                .and_then(Value::as_str),
            Some("artifact.upsert_block")
        );
    }

    #[test]
    fn should_apply_current_incremental_candidate_without_compat_envelope() {
        let base_document = json!({
            "schemaVersion": ARTIFACT_DOCUMENT_SCHEMA_VERSION,
            "artifactId": "artifact-document:demo",
            "kind": "analysis",
            "title": "季度结论",
            "status": "ready",
            "language": "zh-CN",
            "summary": "旧摘要",
            "blocks": [
                { "id": "body-1", "type": "rich_text", "contentFormat": "markdown", "content": "旧正文" }
            ],
            "sources": [],
            "metadata": {
                "generatedBy": "agent"
            }
        });
        let operation = json!({
            "type": "artifact.block.upsert",
            "artifactId": "artifact-document:demo",
            "block": {
                "id": "body-1",
                "type": "rich_text",
                "contentFormat": "markdown",
                "content": "直接通过 current 包络改写后的正文"
            }
        });

        let outcome = apply_artifact_operation_candidate_to_document(
            Some(&base_document),
            &operation,
            &build_context(),
        );

        assert!(outcome.issues.is_empty());
        assert_eq!(
            outcome
                .document
                .get("blocks")
                .and_then(Value::as_array)
                .and_then(|blocks| blocks.first())
                .and_then(|block| block.get("content"))
                .and_then(Value::as_str),
            Some("直接通过 current 包络改写后的正文")
        );
    }

    #[test]
    fn should_apply_rewrite_patch_candidate_without_compat_envelope() {
        let base_document = json!({
            "schemaVersion": ARTIFACT_DOCUMENT_SCHEMA_VERSION,
            "artifactId": "artifact-document:demo",
            "kind": "analysis",
            "title": "季度结论",
            "status": "ready",
            "language": "zh-CN",
            "summary": "旧摘要",
            "blocks": [
                { "id": "body-1", "type": "rich_text", "contentFormat": "markdown", "content": "旧正文" }
            ],
            "sources": [],
            "metadata": {
                "generatedBy": "agent"
            }
        });
        let operation = json!({
            "type": "artifact_rewrite_patch",
            "artifactId": "artifact-document:demo",
            "targetBlockId": "body-1",
            "block": {
                "id": "body-1",
                "type": "rich_text",
                "contentFormat": "markdown",
                "content": "rewrite patch 直接改写后的正文"
            },
            "source": {
                "id": "source-1",
                "type": "web",
                "label": "OpenAI",
                "locator": {
                    "url": "https://openai.com"
                }
            },
            "summary": "仅改写目标正文"
        });

        let outcome = apply_artifact_operation_candidate_to_document(
            Some(&base_document),
            &operation,
            &build_context(),
        );

        assert!(outcome.issues.is_empty());
        assert_eq!(
            outcome
                .document
                .get("blocks")
                .and_then(Value::as_array)
                .and_then(|blocks| blocks.first())
                .and_then(|block| block.get("content"))
                .and_then(Value::as_str),
            Some("rewrite patch 直接改写后的正文")
        );
        assert_eq!(
            outcome
                .document
                .get("sources")
                .and_then(Value::as_array)
                .and_then(|sources| sources.first())
                .and_then(|source| source.get("label"))
                .and_then(Value::as_str),
            Some("OpenAI")
        );
        assert_eq!(
            outcome
                .document
                .get("metadata")
                .and_then(Value::as_object)
                .and_then(|metadata| metadata.get("versionSummary"))
                .and_then(Value::as_str),
            Some("仅改写目标正文")
        );
    }

    #[test]
    fn should_apply_current_incremental_source_upsert_without_block_binding() {
        let base_document = json!({
            "schemaVersion": ARTIFACT_DOCUMENT_SCHEMA_VERSION,
            "artifactId": "artifact-document:demo",
            "kind": "analysis",
            "title": "季度结论",
            "status": "ready",
            "language": "zh-CN",
            "summary": "旧摘要",
            "blocks": [
                { "id": "body-1", "type": "rich_text", "contentFormat": "markdown", "content": "旧正文" }
            ],
            "sources": [],
            "metadata": {
                "generatedBy": "agent"
            }
        });
        let operation = json!({
            "type": "artifact.source.upsert",
            "artifactId": "artifact-document:demo",
            "source": {
                "id": "source-1",
                "type": "web",
                "label": "OpenAI",
                "locator": {
                    "url": "https://openai.com"
                }
            }
        });

        let outcome = apply_artifact_operation_candidate_to_document(
            Some(&base_document),
            &operation,
            &build_context(),
        );

        assert!(outcome.issues.is_empty());
        assert_eq!(
            outcome
                .document
                .get("sources")
                .and_then(Value::as_array)
                .map(|items| items.len()),
            Some(1)
        );
        assert_eq!(
            outcome
                .document
                .get("blocks")
                .and_then(Value::as_array)
                .and_then(|blocks| blocks.first())
                .and_then(|block| block.get("sourceIds")),
            None
        );
    }

    #[test]
    fn should_keep_compat_artifact_ops_as_fallback_input() {
        let base_document = json!({
            "schemaVersion": ARTIFACT_DOCUMENT_SCHEMA_VERSION,
            "artifactId": "artifact-document:demo",
            "kind": "analysis",
            "title": "季度结论",
            "status": "ready",
            "language": "zh-CN",
            "summary": "旧摘要",
            "blocks": [
                { "id": "body-1", "type": "rich_text", "contentFormat": "markdown", "content": "旧正文" }
            ],
            "sources": [],
            "metadata": {
                "generatedBy": "agent"
            }
        });
        let operation = json!({
            "type": "artifact_ops",
            "ops": [
                {
                    "op": "artifact.source.upsert",
                    "source": {
                        "id": "source-1",
                        "type": "web",
                        "label": "OpenAI",
                        "locator": {
                            "url": "https://openai.com"
                        }
                    }
                }
            ]
        });

        let outcome = apply_artifact_operation_candidate_to_document(
            Some(&base_document),
            &operation,
            &build_context(),
        );

        assert!(outcome.issues.is_empty());
        assert_eq!(
            outcome
                .document
                .get("sources")
                .and_then(Value::as_array)
                .map(|items| items.len()),
            Some(1)
        );
        assert_eq!(
            outcome
                .document
                .get("blocks")
                .and_then(Value::as_array)
                .and_then(|blocks| blocks.first())
                .and_then(|block| block.get("sourceIds")),
            None
        );
    }

    #[test]
    fn should_apply_upsert_block_and_attach_source_on_existing_document() {
        let base_document = json!({
            "schemaVersion": ARTIFACT_DOCUMENT_SCHEMA_VERSION,
            "artifactId": "artifact-document:demo",
            "kind": "analysis",
            "title": "季度结论",
            "status": "ready",
            "language": "zh-CN",
            "summary": "旧摘要",
            "blocks": [
                { "id": "hero-1", "type": "hero_summary", "summary": "旧摘要" },
                { "id": "body-1", "type": "rich_text", "markdown": "旧正文" }
            ],
            "sources": [],
            "metadata": {
                "generatedBy": "agent"
            }
        });
        let ops = json!({
            "type": "artifact_ops",
            "ops": [
                {
                    "op": "artifact.upsert_block",
                    "block": {
                        "id": "body-1",
                        "type": "rich_text",
                        "markdown": "新正文"
                    },
                    "afterBlockId": "hero-1"
                },
                {
                    "op": "artifact.attach_source",
                    "blockId": "body-1",
                    "source": {
                        "id": "source-1",
                        "title": "OpenAI",
                        "url": "https://openai.com"
                    }
                },
                {
                    "op": "artifact.finalize_version",
                    "summary": "补充了新的证据来源"
                }
            ]
        });

        let outcome = apply_artifact_operation_candidate_to_document(
            Some(&base_document),
            &ops,
            &build_context(),
        );

        assert!(outcome.issues.is_empty());
        let body_block = outcome
            .document
            .get("blocks")
            .and_then(Value::as_array)
            .and_then(|blocks| {
                blocks.iter().find(|block| {
                    block.get("id").and_then(Value::as_str).map(str::trim) == Some("body-1")
                })
            })
            .expect("body block");
        assert_eq!(
            body_block
                .get("markdown")
                .and_then(Value::as_str)
                .map(str::trim),
            Some("新正文")
        );
        assert_eq!(
            body_block
                .get("sourceIds")
                .and_then(Value::as_array)
                .and_then(|items| items.first())
                .and_then(Value::as_str),
            Some("source-1")
        );
        assert_eq!(
            outcome
                .document
                .get("metadata")
                .and_then(Value::as_object)
                .and_then(|metadata| metadata.get("versionSummary"))
                .and_then(Value::as_str)
                .map(str::trim),
            Some("补充了新的证据来源")
        );
    }

    #[test]
    fn should_restrict_rewrite_ops_to_target_block() {
        let base_document = json!({
            "schemaVersion": ARTIFACT_DOCUMENT_SCHEMA_VERSION,
            "artifactId": "artifact-document:demo",
            "kind": "analysis",
            "title": "季度结论",
            "status": "ready",
            "language": "zh-CN",
            "summary": "旧摘要",
            "blocks": [
                { "id": "hero-1", "type": "hero_summary", "summary": "旧摘要" },
                { "id": "body-1", "type": "rich_text", "markdown": "旧正文 1" },
                { "id": "body-2", "type": "rich_text", "markdown": "旧正文 2" }
            ],
            "sources": [],
            "metadata": {
                "generatedBy": "agent"
            }
        });
        let ops = json!({
            "type": "artifact_ops",
            "ops": [
                {
                    "op": "artifact.upsert_block",
                    "block": {
                        "id": "body-2",
                        "type": "rich_text",
                        "markdown": "不应被应用"
                    }
                },
                {
                    "op": "artifact.attach_source",
                    "blockId": "body-2",
                    "source": {
                        "id": "source-2",
                        "title": "不应绑定",
                        "url": "https://example.com"
                    }
                },
                {
                    "op": "artifact.upsert_block",
                    "block": {
                        "id": "body-1",
                        "type": "rich_text",
                        "markdown": "目标正文"
                    },
                    "afterBlockId": "body-2"
                }
            ]
        });
        let mut context = build_context();
        context.target_block_id = Some("body-1".to_string());

        let outcome =
            apply_artifact_operation_candidate_to_document(Some(&base_document), &ops, &context);

        let blocks = outcome
            .document
            .get("blocks")
            .and_then(Value::as_array)
            .expect("blocks");
        let body_1 = blocks
            .iter()
            .find(|block| block.get("id").and_then(Value::as_str) == Some("body-1"))
            .expect("body-1");
        let body_2 = blocks
            .iter()
            .find(|block| block.get("id").and_then(Value::as_str) == Some("body-2"))
            .expect("body-2");

        assert_eq!(
            body_1.get("markdown").and_then(Value::as_str),
            Some("目标正文")
        );
        assert_eq!(
            body_2.get("markdown").and_then(Value::as_str),
            Some("旧正文 2")
        );
        assert_eq!(
            blocks
                .iter()
                .position(|block| block.get("id").and_then(Value::as_str) == Some("body-1")),
            Some(1)
        );
        assert_eq!(
            blocks
                .iter()
                .position(|block| block.get("id").and_then(Value::as_str) == Some("body-2")),
            Some(2)
        );
        assert_eq!(outcome.issues.len(), 2);
        assert!(outcome
            .issues
            .iter()
            .any(|issue| issue.contains("非目标 block `body-2`")));
    }
}
