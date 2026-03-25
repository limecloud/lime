//! Artifact 版本差异服务
//!
//! 负责比较两个 ArtifactDocument 快照，生成可直接给 Workbench
//! 消费的 block 级 diff 摘要。

use serde_json::{Map, Value};
use std::collections::HashMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
enum ArtifactBlockChangeType {
    Added,
    Removed,
    Updated,
    Moved,
}

impl ArtifactBlockChangeType {
    fn as_str(self) -> &'static str {
        match self {
            Self::Added => "added",
            Self::Removed => "removed",
            Self::Updated => "updated",
            Self::Moved => "moved",
        }
    }
}

pub fn build_artifact_version_diff(
    base_document: Option<&Value>,
    base_version_id: Option<&str>,
    base_version_no: Option<usize>,
    target_document: &Value,
    target_version_id: &str,
    target_version_no: usize,
) -> Option<Map<String, Value>> {
    let base_record = base_document.and_then(Value::as_object)?;
    let target_record = target_document.as_object()?;
    let base_blocks = extract_blocks(base_record);
    let target_blocks = extract_blocks(target_record);

    if base_blocks.is_empty() && target_blocks.is_empty() {
        return None;
    }

    let mut changed_blocks = Vec::new();
    let mut counts = HashMap::from([
        (ArtifactBlockChangeType::Added, 0usize),
        (ArtifactBlockChangeType::Removed, 0usize),
        (ArtifactBlockChangeType::Updated, 0usize),
        (ArtifactBlockChangeType::Moved, 0usize),
    ]);
    let target_by_id = target_blocks
        .iter()
        .map(|block| (block.id.as_str(), block))
        .collect::<HashMap<_, _>>();
    let base_by_id = base_blocks
        .iter()
        .map(|block| (block.id.as_str(), block))
        .collect::<HashMap<_, _>>();

    for target_block in &target_blocks {
        let Some(base_block) = base_by_id.get(target_block.id.as_str()) else {
            changed_blocks.push(build_changed_block_record(
                ArtifactBlockChangeType::Added,
                None,
                Some(target_block),
            ));
            *counts.entry(ArtifactBlockChangeType::Added).or_default() += 1;
            continue;
        };

        if base_block.block_type != target_block.block_type
            || base_block.preview_text != target_block.preview_text
        {
            changed_blocks.push(build_changed_block_record(
                ArtifactBlockChangeType::Updated,
                Some(base_block),
                Some(target_block),
            ));
            *counts.entry(ArtifactBlockChangeType::Updated).or_default() += 1;
            continue;
        }

        if base_block.index != target_block.index {
            changed_blocks.push(build_changed_block_record(
                ArtifactBlockChangeType::Moved,
                Some(base_block),
                Some(target_block),
            ));
            *counts.entry(ArtifactBlockChangeType::Moved).or_default() += 1;
        }
    }

    for base_block in &base_blocks {
        if target_by_id.contains_key(base_block.id.as_str()) {
            continue;
        }
        changed_blocks.push(build_changed_block_record(
            ArtifactBlockChangeType::Removed,
            Some(base_block),
            None,
        ));
        *counts.entry(ArtifactBlockChangeType::Removed).or_default() += 1;
    }

    if changed_blocks.is_empty() {
        return None;
    }

    let mut diff = Map::new();
    if let Some(version_id) = normalize_text(base_version_id) {
        diff.insert("baseVersionId".to_string(), Value::String(version_id));
    }
    if let Some(version_no) = base_version_no {
        diff.insert("baseVersionNo".to_string(), Value::from(version_no as u64));
    }
    diff.insert(
        "targetVersionId".to_string(),
        Value::String(target_version_id.to_string()),
    );
    diff.insert(
        "targetVersionNo".to_string(),
        Value::from(target_version_no as u64),
    );
    diff.insert(
        "addedCount".to_string(),
        Value::from(*counts.get(&ArtifactBlockChangeType::Added).unwrap_or(&0) as u64),
    );
    diff.insert(
        "removedCount".to_string(),
        Value::from(*counts.get(&ArtifactBlockChangeType::Removed).unwrap_or(&0) as u64),
    );
    diff.insert(
        "updatedCount".to_string(),
        Value::from(*counts.get(&ArtifactBlockChangeType::Updated).unwrap_or(&0) as u64),
    );
    diff.insert(
        "movedCount".to_string(),
        Value::from(*counts.get(&ArtifactBlockChangeType::Moved).unwrap_or(&0) as u64),
    );
    diff.insert(
        "changedBlocks".to_string(),
        Value::Array(changed_blocks.into_iter().map(Value::Object).collect()),
    );
    Some(diff)
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ArtifactBlockSnapshot {
    id: String,
    index: usize,
    block_type: String,
    preview_text: String,
}

fn extract_blocks(record: &Map<String, Value>) -> Vec<ArtifactBlockSnapshot> {
    let Some(blocks) = record.get("blocks").and_then(Value::as_array) else {
        return Vec::new();
    };

    blocks
        .iter()
        .enumerate()
        .filter_map(|(index, block)| {
            let record = block.as_object()?;
            let id = normalize_text(record.get("id").and_then(Value::as_str))?;
            let block_type = normalize_text(record.get("type").and_then(Value::as_str))
                .unwrap_or_else(|| "rich_text".to_string());
            Some(ArtifactBlockSnapshot {
                id,
                index,
                block_type,
                preview_text: build_block_preview(record),
            })
        })
        .collect()
}

fn build_block_preview(record: &Map<String, Value>) -> String {
    let block_type = normalize_text(record.get("type").and_then(Value::as_str))
        .unwrap_or_else(|| "rich_text".to_string());
    let preview = match block_type.as_str() {
        "hero_summary" => normalize_text(record.get("summary").and_then(Value::as_str)),
        "section_header" => normalize_text(record.get("title").and_then(Value::as_str))
            .or_else(|| normalize_text(record.get("description").and_then(Value::as_str))),
        "callout" => normalize_text(record.get("title").and_then(Value::as_str))
            .or_else(|| normalize_text(record.get("content").and_then(Value::as_str)))
            .or_else(|| normalize_text(record.get("text").and_then(Value::as_str))),
        "rich_text" => normalize_text(record.get("markdown").and_then(Value::as_str))
            .or_else(|| normalize_text(record.get("text").and_then(Value::as_str)))
            .or_else(|| normalize_text(record.get("content").and_then(Value::as_str))),
        "key_points" | "checklist" | "metric_grid" => record
            .get("items")
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .take(3)
                    .filter_map(value_to_preview_text)
                    .collect::<Vec<_>>()
                    .join("；")
            })
            .filter(|value| !value.trim().is_empty()),
        "table" => record
            .get("rows")
            .and_then(Value::as_array)
            .map(|rows| format!("{} 行表格", rows.len())),
        "quote" => normalize_text(record.get("text").and_then(Value::as_str))
            .or_else(|| normalize_text(record.get("content").and_then(Value::as_str))),
        _ => value_to_preview_text(&Value::Object(record.clone())),
    };

    preview
        .map(|value| truncate_text(value.as_str(), 160))
        .unwrap_or_else(|| block_type)
}

fn build_changed_block_record(
    change_type: ArtifactBlockChangeType,
    before: Option<&ArtifactBlockSnapshot>,
    after: Option<&ArtifactBlockSnapshot>,
) -> Map<String, Value> {
    let mut record = Map::new();
    record.insert(
        "changeType".to_string(),
        Value::String(change_type.as_str().to_string()),
    );
    let block_id = after
        .map(|block| block.id.clone())
        .or_else(|| before.map(|block| block.id.clone()))
        .unwrap_or_else(|| "unknown-block".to_string());
    record.insert("blockId".to_string(), Value::String(block_id));
    if let Some(before) = before {
        record.insert(
            "beforeType".to_string(),
            Value::String(before.block_type.clone()),
        );
        record.insert("beforeIndex".to_string(), Value::from(before.index as u64));
        if !before.preview_text.is_empty() {
            record.insert(
                "beforeText".to_string(),
                Value::String(before.preview_text.clone()),
            );
        }
    }
    if let Some(after) = after {
        record.insert(
            "afterType".to_string(),
            Value::String(after.block_type.clone()),
        );
        record.insert("afterIndex".to_string(), Value::from(after.index as u64));
        if !after.preview_text.is_empty() {
            record.insert(
                "afterText".to_string(),
                Value::String(after.preview_text.clone()),
            );
        }
    }
    record.insert(
        "summary".to_string(),
        Value::String(build_change_summary(change_type, before, after)),
    );
    record
}

fn build_change_summary(
    change_type: ArtifactBlockChangeType,
    before: Option<&ArtifactBlockSnapshot>,
    after: Option<&ArtifactBlockSnapshot>,
) -> String {
    match change_type {
        ArtifactBlockChangeType::Added => format!(
            "新增 {} block",
            after
                .map(|block| block.block_type.as_str())
                .unwrap_or("artifact")
        ),
        ArtifactBlockChangeType::Removed => format!(
            "删除 {} block",
            before
                .map(|block| block.block_type.as_str())
                .unwrap_or("artifact")
        ),
        ArtifactBlockChangeType::Updated => "更新 block 内容".to_string(),
        ArtifactBlockChangeType::Moved => {
            let from = before.map(|block| block.index + 1).unwrap_or(0);
            let to = after.map(|block| block.index + 1).unwrap_or(0);
            format!("block 位置从 #{from} 调整到 #{to}")
        }
    }
}

fn value_to_preview_text(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => normalize_text(Some(text)),
        Value::Array(items) => {
            let joined = items
                .iter()
                .filter_map(value_to_preview_text)
                .collect::<Vec<_>>()
                .join("；");
            normalize_text(Some(joined.as_str()))
        }
        Value::Object(record) => normalize_text(
            record
                .get("text")
                .and_then(Value::as_str)
                .or_else(|| record.get("label").and_then(Value::as_str))
                .or_else(|| record.get("title").and_then(Value::as_str))
                .or_else(|| record.get("content").and_then(Value::as_str))
                .or_else(|| record.get("summary").and_then(Value::as_str)),
        ),
        _ => None,
    }
}

fn normalize_text(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(ToString::to_string)
}

fn truncate_text(value: &str, max_chars: usize) -> String {
    value.trim().chars().take(max_chars).collect::<String>()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn should_build_block_level_diff_summary() {
        let previous = json!({
            "blocks": [
                { "id": "hero-1", "type": "hero_summary", "summary": "旧摘要" },
                { "id": "body-1", "type": "rich_text", "markdown": "旧正文" }
            ]
        });
        let current = json!({
            "blocks": [
                { "id": "hero-1", "type": "hero_summary", "summary": "新摘要" },
                { "id": "appendix-1", "type": "rich_text", "markdown": "新增附录" },
                { "id": "body-1", "type": "rich_text", "markdown": "旧正文" }
            ]
        });

        let diff = build_artifact_version_diff(
            Some(&previous),
            Some("artifact:v1"),
            Some(1),
            &current,
            "artifact:v2",
            2,
        )
        .expect("diff");

        assert_eq!(diff.get("updatedCount").and_then(Value::as_u64), Some(1));
        assert_eq!(diff.get("addedCount").and_then(Value::as_u64), Some(1));
        assert_eq!(diff.get("movedCount").and_then(Value::as_u64), Some(1));
        assert_eq!(
            diff.get("changedBlocks")
                .and_then(Value::as_array)
                .map(|items| items.len()),
            Some(3)
        );
    }
}
