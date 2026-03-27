//! ArtifactDocument v1 校验与修复服务
//!
//! 负责把模型返回的结构化 JSON 修正为可持久化、可渲染的 ArtifactDocument，
//! 并在必要时回退为失败态的 rich_text 文档。

use serde_json::{Map, Value};
use std::collections::HashSet;

pub const ARTIFACT_DOCUMENT_SCHEMA_VERSION: &str = "artifact_document.v1";
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
const ARTIFACT_STATUS_VALUES: &[&str] = &["draft", "streaming", "ready", "failed", "archived"];
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
const MAX_BLOCK_COUNT: usize = 40;
const MARKDOWN_RECOVERY_REASON: &str =
    "模型未返回合法的 ArtifactDocument JSON，已按 Markdown 正文自动恢复为可渲染文档。";
const TRUNCATED_JSON_RECOVERY_REASON: &str =
    "检测到不完整的 ArtifactDocument JSON，已做闭合修复后继续校验。";

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ArtifactDocumentValidationContext {
    pub artifact_id: String,
    pub workspace_id: Option<String>,
    pub thread_id: Option<String>,
    pub turn_id: Option<String>,
    pub title_hint: Option<String>,
    pub kind_hint: Option<String>,
    pub theme: Option<String>,
    pub source_policy: Option<String>,
    pub request_id: Option<String>,
    pub target_block_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ArtifactDocumentValidationOutcome {
    pub document: Value,
    pub title: String,
    pub kind: String,
    pub status: String,
    pub repaired: bool,
    pub fallback_used: bool,
    pub issues: Vec<String>,
}

pub fn validate_or_fallback_artifact_document(
    raw_text: &str,
    context: &ArtifactDocumentValidationContext,
) -> ArtifactDocumentValidationOutcome {
    let Some((candidate, repaired_truncated_json)) = extract_artifact_document_candidate(raw_text)
    else {
        if let Some(recovered_candidate) = build_markdown_recovery_candidate(raw_text, context) {
            let mut outcome =
                validate_or_repair_artifact_document_value(&recovered_candidate, raw_text, context);
            outcome.repaired = true;
            outcome.fallback_used = true;
            outcome
                .issues
                .insert(0, MARKDOWN_RECOVERY_REASON.to_string());
            return outcome;
        }
        return build_failed_fallback_document(
            raw_text,
            "模型未返回合法的 ArtifactDocument JSON，已回退为失败态文档。",
            context,
        );
    };

    let mut outcome = validate_or_repair_artifact_document_value(&candidate, raw_text, context);
    if repaired_truncated_json {
        outcome.repaired = true;
        outcome
            .issues
            .insert(0, TRUNCATED_JSON_RECOVERY_REASON.to_string());
    }
    outcome
}

pub fn validate_or_repair_artifact_document_value(
    value: &Value,
    raw_text: &str,
    context: &ArtifactDocumentValidationContext,
) -> ArtifactDocumentValidationOutcome {
    let Some(record) = value.as_object() else {
        return build_failed_fallback_document(
            raw_text,
            "ArtifactDocument 顶层不是对象，已回退为失败态文档。",
            context,
        );
    };

    let mut issues = Vec::new();
    let mut repaired = false;

    let kind = normalize_enum(
        find_string(record, &["kind"]),
        ARTIFACT_KIND_VALUES,
        context.kind_hint.as_deref().unwrap_or("analysis"),
    );
    if find_string(record, &["kind"]).as_deref() != Some(kind.as_str()) {
        repaired = true;
        issues.push(format!("kind 已规范化为 `{kind}`。"));
    }

    let title = normalize_title(
        find_string(record, &["title"])
            .or_else(|| find_string(record, &["name"]))
            .or_else(|| context.title_hint.clone()),
    );
    if find_string(record, &["title"]).as_deref() != Some(title.as_str()) {
        repaired = true;
        issues.push("title 缺失或为空，已使用兜底标题。".to_string());
    }

    let sources = normalize_sources(record.get("sources"), &mut repaired, &mut issues);
    let source_id_set = sources
        .iter()
        .filter_map(|source| {
            source
                .get("id")
                .and_then(Value::as_str)
                .map(ToString::to_string)
        })
        .collect::<HashSet<_>>();

    let blocks = normalize_blocks(
        record.get("blocks"),
        raw_text,
        &source_id_set,
        &sources,
        &mut repaired,
        &mut issues,
    );

    if blocks.is_empty() {
        return build_failed_fallback_document(
            raw_text,
            "ArtifactDocument 未提供可渲染 block，已回退为失败态文档。",
            context,
        );
    }

    let mut status = normalize_enum(
        find_string(record, &["status"]),
        ARTIFACT_STATUS_VALUES,
        "ready",
    );
    let source_policy = context
        .source_policy
        .as_deref()
        .map(str::trim)
        .unwrap_or("none");
    if source_policy == "required" && sources.is_empty() {
        repaired = true;
        status = "failed".to_string();
        issues.push(
            "当前回合 source_policy=required，但文档没有 sources，已标记为 failed。".to_string(),
        );
    }

    if find_string(record, &["status"]).as_deref() != Some(status.as_str()) {
        repaired = true;
    }

    let mut metadata = record
        .get("metadata")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();

    merge_string_field(&mut metadata, "theme", context.theme.as_deref());
    merge_string_field(&mut metadata, "generatedBy", Some("agent"));
    merge_source_run_binding(&mut metadata, context);
    if let Some(request_id) = context.request_id.as_deref() {
        metadata.insert(
            "artifactRequestId".to_string(),
            Value::String(request_id.to_string()),
        );
    }

    let document = Value::Object(Map::from_iter([
        (
            "schemaVersion".to_string(),
            Value::String(ARTIFACT_DOCUMENT_SCHEMA_VERSION.to_string()),
        ),
        (
            "artifactId".to_string(),
            Value::String(context.artifact_id.clone()),
        ),
        (
            "workspaceId".to_string(),
            optional_string_value(context.workspace_id.as_deref()),
        ),
        (
            "threadId".to_string(),
            optional_string_value(context.thread_id.as_deref()),
        ),
        (
            "turnId".to_string(),
            optional_string_value(context.turn_id.as_deref()),
        ),
        ("kind".to_string(), Value::String(kind.clone())),
        ("title".to_string(), Value::String(title.clone())),
        ("status".to_string(), Value::String(status.clone())),
        ("language".to_string(), Value::String("zh-CN".to_string())),
        (
            "summary".to_string(),
            optional_string_value(
                find_string(record, &["summary"])
                    .or_else(|| derive_summary_from_blocks(&blocks))
                    .as_deref(),
            ),
        ),
        (
            "blocks".to_string(),
            Value::Array(blocks.into_iter().map(Value::Object).collect()),
        ),
        (
            "sources".to_string(),
            Value::Array(sources.into_iter().map(Value::Object).collect()),
        ),
        ("metadata".to_string(), Value::Object(metadata)),
    ]));

    ArtifactDocumentValidationOutcome {
        document,
        title,
        kind,
        status,
        repaired,
        fallback_used: false,
        issues,
    }
}

fn build_failed_fallback_document(
    raw_text: &str,
    reason: &str,
    context: &ArtifactDocumentValidationContext,
) -> ArtifactDocumentValidationOutcome {
    let title = normalize_title(context.title_hint.clone());
    let kind = normalize_enum(context.kind_hint.clone(), ARTIFACT_KIND_VALUES, "analysis");
    let fallback_markdown = build_fallback_markdown(raw_text, reason);
    let mut metadata = Map::new();
    merge_string_field(&mut metadata, "theme", context.theme.as_deref());
    merge_string_field(&mut metadata, "generatedBy", Some("agent"));
    merge_source_run_binding(&mut metadata, context);
    if let Some(request_id) = context.request_id.as_deref() {
        metadata.insert(
            "artifactRequestId".to_string(),
            Value::String(request_id.to_string()),
        );
    }

    let document = Value::Object(Map::from_iter([
        (
            "schemaVersion".to_string(),
            Value::String(ARTIFACT_DOCUMENT_SCHEMA_VERSION.to_string()),
        ),
        (
            "artifactId".to_string(),
            Value::String(context.artifact_id.clone()),
        ),
        (
            "workspaceId".to_string(),
            optional_string_value(context.workspace_id.as_deref()),
        ),
        (
            "threadId".to_string(),
            optional_string_value(context.thread_id.as_deref()),
        ),
        (
            "turnId".to_string(),
            optional_string_value(context.turn_id.as_deref()),
        ),
        ("kind".to_string(), Value::String(kind.clone())),
        ("title".to_string(), Value::String(title.clone())),
        ("status".to_string(), Value::String("failed".to_string())),
        ("language".to_string(), Value::String("zh-CN".to_string())),
        (
            "summary".to_string(),
            Value::String("结构化交付失败，已回退为失败态文档。".to_string()),
        ),
        (
            "blocks".to_string(),
            Value::Array(vec![Value::Object(Map::from_iter([
                ("id".to_string(), Value::String("fallback-1".to_string())),
                ("type".to_string(), Value::String("rich_text".to_string())),
                ("markdown".to_string(), Value::String(fallback_markdown)),
            ]))]),
        ),
        ("sources".to_string(), Value::Array(Vec::new())),
        ("metadata".to_string(), Value::Object(metadata)),
    ]));

    ArtifactDocumentValidationOutcome {
        document,
        title,
        kind,
        status: "failed".to_string(),
        repaired: true,
        fallback_used: true,
        issues: vec![reason.to_string()],
    }
}

fn build_markdown_recovery_candidate(
    raw_text: &str,
    context: &ArtifactDocumentValidationContext,
) -> Option<Value> {
    let trimmed = raw_text.trim();
    if trimmed.is_empty() {
        return None;
    }

    let (heading_title, markdown_body) = extract_markdown_heading_and_body(trimmed);
    let title = normalize_title(
        heading_title
            .or_else(|| context.title_hint.clone())
            .or_else(|| extract_first_non_empty_line(trimmed)),
    );
    let body = if markdown_body.trim().is_empty() {
        trimmed.to_string()
    } else {
        markdown_body
    };
    let kind = normalize_enum(context.kind_hint.clone(), ARTIFACT_KIND_VALUES, "analysis");
    let mut document = Map::new();
    document.insert(
        "schemaVersion".to_string(),
        Value::String(ARTIFACT_DOCUMENT_SCHEMA_VERSION.to_string()),
    );
    document.insert("kind".to_string(), Value::String(kind));
    document.insert("title".to_string(), Value::String(title));
    document.insert("status".to_string(), Value::String("draft".to_string()));
    document.insert("language".to_string(), Value::String("zh-CN".to_string()));
    if let Some(summary) = extract_markdown_summary(body.as_str()) {
        document.insert("summary".to_string(), Value::String(summary));
    }
    document.insert(
        "blocks".to_string(),
        Value::Array(vec![Value::Object(build_fallback_rich_text_block(
            "block-1",
            body.as_str(),
            Some("markdown_recovery"),
        ))]),
    );
    document.insert("sources".to_string(), Value::Array(Vec::new()));
    document.insert("metadata".to_string(), Value::Object(Map::new()));
    Some(Value::Object(document))
}

fn extract_artifact_document_candidate(raw_text: &str) -> Option<(Value, bool)> {
    let trimmed = raw_text.trim();
    if trimmed.is_empty() {
        return None;
    }

    let candidates = [
        trimmed.to_string(),
        strip_outer_code_fence(trimmed),
        extract_first_fenced_payload(trimmed).unwrap_or_default(),
        extract_braced_json_candidate(trimmed).unwrap_or_default(),
        extract_unclosed_json_candidate(trimmed).unwrap_or_default(),
    ];

    for candidate in candidates {
        let normalized = candidate.trim();
        if normalized.is_empty() {
            continue;
        }
        if let Some(document) = parse_artifact_document_candidate(normalized) {
            return Some((document, false));
        }
        if let Some(repaired) = repair_json_candidate(normalized) {
            if let Some(document) = parse_artifact_document_candidate(repaired.as_str()) {
                return Some((document, true));
            }
        }
    }

    None
}

fn parse_artifact_document_candidate(candidate: &str) -> Option<Value> {
    let parsed = serde_json::from_str::<Value>(candidate).ok()?;
    unwrap_artifact_document_envelope(&parsed).cloned()
}

fn unwrap_artifact_document_envelope(value: &Value) -> Option<&Value> {
    let record = value.as_object()?;
    if is_artifact_document_record(record) {
        return Some(value);
    }

    if record.get("type").and_then(Value::as_str).map(str::trim) == Some("artifact_document_draft")
    {
        return record
            .get("document")
            .filter(|candidate| candidate.is_object());
    }

    record.get("document").and_then(|candidate| {
        let object = candidate.as_object()?;
        if is_artifact_document_record(object) {
            Some(candidate)
        } else {
            None
        }
    })
}

fn is_artifact_document_record(record: &Map<String, Value>) -> bool {
    record
        .get("schemaVersion")
        .or_else(|| record.get("schema_version"))
        .and_then(Value::as_str)
        .map(str::trim)
        == Some(ARTIFACT_DOCUMENT_SCHEMA_VERSION)
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

fn extract_unclosed_json_candidate(raw: &str) -> Option<String> {
    let start = raw.find('{').or_else(|| raw.find('['))?;
    Some(raw[start..].trim().to_string())
}

fn repair_json_candidate(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }

    let mut repaired = String::new();
    let mut expected_closers = Vec::new();
    let mut in_string = false;
    let mut escaping = false;

    for ch in trimmed.chars() {
        repaired.push(ch);
        if in_string {
            if escaping {
                escaping = false;
                continue;
            }
            match ch {
                '\\' => escaping = true,
                '"' => in_string = false,
                _ => {}
            }
            continue;
        }

        match ch {
            '"' => in_string = true,
            '{' => expected_closers.push('}'),
            '[' => expected_closers.push(']'),
            '}' | ']' => {
                let expected = expected_closers.pop()?;
                if ch != expected {
                    return None;
                }
            }
            _ => {}
        }
    }

    if in_string {
        repaired.push('"');
    }
    repaired = repair_json_tail(repaired);
    while let Some(closer) = expected_closers.pop() {
        repaired = repair_json_tail(repaired);
        repaired.push(closer);
    }
    Some(repaired)
}

fn repair_json_tail(mut value: String) -> String {
    loop {
        let trimmed_len = value.trim_end().len();
        value.truncate(trimmed_len);
        if value.ends_with(':') {
            value.push_str(" null");
            break;
        }
        if value.ends_with(',') {
            value.pop();
            continue;
        }
        break;
    }
    value
}

fn normalize_sources(
    value: Option<&Value>,
    repaired: &mut bool,
    issues: &mut Vec<String>,
) -> Vec<Map<String, Value>> {
    let Some(items) = value.and_then(Value::as_array) else {
        return Vec::new();
    };

    let mut seen_ids = HashSet::new();
    let mut sources = Vec::new();
    for (index, item) in items.iter().enumerate() {
        let Some(record) = item.as_object() else {
            *repaired = true;
            issues.push(format!("sources[{}] 不是对象，已忽略。", index));
            continue;
        };
        let id = normalize_text(
            record
                .get("id")
                .or_else(|| record.get("sourceId"))
                .and_then(Value::as_str),
        )
        .unwrap_or_else(|| format!("source-{}", index + 1));
        if !seen_ids.insert(id.clone()) {
            *repaired = true;
            issues.push(format!("sources 中存在重复 id `{id}`，已忽略后续重复项。"));
            continue;
        }

        let title = find_string(record, &["title", "label"]);
        let url = find_string(record, &["url", "href", "link"]);
        let note = find_string(record, &["note", "summary", "description"]);
        let kind = find_string(record, &["kind", "type"]);
        let quote = find_string(record, &["quote"]);
        let published_at = find_string(record, &["publishedAt", "published_at"]);

        if title.is_none() && url.is_none() && note.is_none() && quote.is_none() {
            *repaired = true;
            issues.push(format!("sources[{}] 缺少可展示字段，已忽略。", index));
            continue;
        }

        let mut normalized = record.clone();
        normalized.insert("id".to_string(), Value::String(id));
        upsert_optional_string(&mut normalized, "title", title.as_deref());
        upsert_optional_string(&mut normalized, "url", url.as_deref());
        upsert_optional_string(&mut normalized, "note", note.as_deref());
        upsert_optional_string(&mut normalized, "kind", kind.as_deref());
        upsert_optional_string(&mut normalized, "quote", quote.as_deref());
        upsert_optional_string(&mut normalized, "publishedAt", published_at.as_deref());
        sources.push(normalized);
    }

    sources
}

fn normalize_blocks(
    value: Option<&Value>,
    raw_text: &str,
    source_id_set: &HashSet<String>,
    sources: &[Map<String, Value>],
    repaired: &mut bool,
    issues: &mut Vec<String>,
) -> Vec<Map<String, Value>> {
    let Some(items) = value.and_then(Value::as_array) else {
        return vec![build_fallback_rich_text_block(
            "block-1",
            raw_text,
            Some("missing_blocks"),
        )];
    };

    let mut seen_ids = HashSet::new();
    let mut blocks = Vec::new();
    for (index, item) in items.iter().enumerate() {
        let Some((mut block, block_repaired)) =
            normalize_block(item, index, source_id_set, sources)
        else {
            *repaired = true;
            issues.push(format!(
                "blocks[{}] 无法修复为可渲染 block，已忽略。",
                index
            ));
            continue;
        };
        if block_repaired {
            *repaired = true;
            issues.push(format!("blocks[{index}] 已自动修复或降级为可渲染 block。"));
        }

        let base_id = normalize_text(block.get("id").and_then(Value::as_str))
            .unwrap_or_else(|| format!("block-{}", index + 1));
        let block_id = dedupe_id(base_id, &mut seen_ids);
        if block.get("id").and_then(Value::as_str).map(str::trim) != Some(block_id.as_str()) {
            *repaired = true;
        }
        block.insert("id".to_string(), Value::String(block_id));
        blocks.push(block);
    }

    if blocks.len() > MAX_BLOCK_COUNT {
        *repaired = true;
        issues.push(format!(
            "blocks 数量超过上限 {MAX_BLOCK_COUNT}，已截断后续 block。"
        ));
        blocks.truncate(MAX_BLOCK_COUNT);
    }

    if blocks.is_empty() {
        vec![build_fallback_rich_text_block(
            "block-1",
            raw_text,
            Some("empty_blocks"),
        )]
    } else {
        blocks
    }
}

fn normalize_block(
    value: &Value,
    index: usize,
    source_id_set: &HashSet<String>,
    sources: &[Map<String, Value>],
) -> Option<(Map<String, Value>, bool)> {
    let record = value.as_object()?;
    let mut repaired = false;
    let block_type = normalize_text(find_string(record, &["type"]).as_deref())
        .unwrap_or_else(|| "rich_text".to_string());
    if !ARTIFACT_BLOCK_TYPE_VALUES.contains(&block_type.as_str()) {
        return Some((
            build_fallback_rich_text_block(
                &format!("block-{}", index + 1),
                extract_portable_text(value)
                    .or_else(|| serde_json::to_string_pretty(value).ok())
                    .as_deref()
                    .unwrap_or(""),
                Some(block_type.as_str()),
            ),
            true,
        ));
    }

    let mut normalized = record.clone();
    normalized.insert(
        "id".to_string(),
        Value::String(
            normalize_text(find_string(record, &["id"]).as_deref())
                .unwrap_or_else(|| format!("block-{}", index + 1)),
        ),
    );
    normalized.insert("type".to_string(), Value::String(block_type.clone()));

    if let Some(section_id) = find_string(record, &["sectionId", "section_id"]) {
        normalized.insert("sectionId".to_string(), Value::String(section_id));
    } else {
        normalized.remove("sectionId");
    }

    if let Some(source_ids) = normalize_string_array(record, &["sourceIds", "source_ids"]) {
        let filtered = source_ids
            .into_iter()
            .filter(|source_id| source_id_set.contains(source_id))
            .map(Value::String)
            .collect::<Vec<_>>();
        if filtered.is_empty() {
            normalized.remove("sourceIds");
        } else {
            normalized.insert("sourceIds".to_string(), Value::Array(filtered));
        }
    }

    match block_type.as_str() {
        "section_header" => {
            if find_string(record, &["title"]).is_none() {
                return Some((
                    build_fallback_rich_text_block(
                        &format!("block-{}", index + 1),
                        extract_portable_text(value).as_deref().unwrap_or(""),
                        Some("section_header"),
                    ),
                    true,
                ));
            }
        }
        "hero_summary" => {
            if find_string(record, &["summary"]).is_none() {
                let fallback = extract_portable_text(value)?;
                normalized.insert("summary".to_string(), Value::String(fallback));
                repaired = true;
            }
        }
        "key_points" => {
            if !has_non_empty_string_array(record.get("items")) {
                return Some((
                    build_fallback_rich_text_block(
                        &format!("block-{}", index + 1),
                        extract_portable_text(value).as_deref().unwrap_or(""),
                        Some("key_points"),
                    ),
                    true,
                ));
            }
        }
        "rich_text" => {
            if extract_rich_text_body(record).is_none() {
                return Some((
                    build_fallback_rich_text_block(
                        &format!("block-{}", index + 1),
                        extract_portable_text(value).as_deref().unwrap_or(""),
                        Some("rich_text"),
                    ),
                    true,
                ));
            }
        }
        "callout" => {
            let content =
                find_string(record, &["content", "text"]).or_else(|| extract_portable_text(value));
            if find_string(record, &["title"]).is_none() && content.is_none() {
                return Some((
                    build_fallback_rich_text_block(
                        &format!("block-{}", index + 1),
                        extract_portable_text(value).as_deref().unwrap_or(""),
                        Some("callout"),
                    ),
                    true,
                ));
            }
            if find_string(record, &["content", "text"]).is_none() {
                if let Some(text) = content {
                    normalized.insert("content".to_string(), Value::String(text));
                    repaired = true;
                }
            }
        }
        "table" => {
            let has_columns = record
                .get("columns")
                .and_then(Value::as_array)
                .map(|items| !items.is_empty())
                .unwrap_or(false);
            let has_rows = record
                .get("rows")
                .and_then(Value::as_array)
                .map(|items| !items.is_empty())
                .unwrap_or(false);
            if !has_columns && !has_rows {
                return Some((
                    build_fallback_rich_text_block(
                        &format!("block-{}", index + 1),
                        extract_portable_text(value).as_deref().unwrap_or(""),
                        Some("table"),
                    ),
                    true,
                ));
            }
        }
        "checklist" | "metric_grid" => {
            let has_items = record
                .get("items")
                .and_then(Value::as_array)
                .map(|items| !items.is_empty())
                .unwrap_or(false);
            let has_metrics = record
                .get("metrics")
                .and_then(Value::as_array)
                .map(|items| !items.is_empty())
                .unwrap_or(false);
            if !has_items && !has_metrics {
                return Some((
                    build_fallback_rich_text_block(
                        &format!("block-{}", index + 1),
                        extract_portable_text(value).as_deref().unwrap_or(""),
                        Some(block_type.as_str()),
                    ),
                    true,
                ));
            }
        }
        "quote" => {
            if find_string(record, &["quote", "text"]).is_none() {
                let fallback = extract_portable_text(value)?;
                normalized.insert("quote".to_string(), Value::String(fallback));
                repaired = true;
            }
        }
        "citation_list" => {
            let has_items = record
                .get("items")
                .and_then(Value::as_array)
                .map(|items| !items.is_empty())
                .unwrap_or(false);
            if !has_items {
                let items = normalize_citation_items_for_block(&normalized, sources);
                if items.is_empty() {
                    return Some((
                        build_fallback_rich_text_block(
                            &format!("block-{}", index + 1),
                            extract_portable_text(value).as_deref().unwrap_or(""),
                            Some("citation_list"),
                        ),
                        true,
                    ));
                }
                normalized.insert("items".to_string(), Value::Array(items));
                repaired = true;
            }
        }
        "image" => {
            if find_string(record, &["url", "src", "imageUrl"]).is_none() {
                return Some((
                    build_fallback_rich_text_block(
                        &format!("block-{}", index + 1),
                        extract_portable_text(value).as_deref().unwrap_or(""),
                        Some("image"),
                    ),
                    true,
                ));
            }
        }
        "code_block" => {
            if find_string(record, &["code", "content"]).is_none()
                && extract_portable_text(value).is_none()
            {
                return Some((
                    build_fallback_rich_text_block(
                        &format!("block-{}", index + 1),
                        serde_json::to_string_pretty(value)
                            .ok()
                            .as_deref()
                            .unwrap_or(""),
                        Some("code_block"),
                    ),
                    true,
                ));
            }
        }
        "divider" => {}
        _ => {}
    }

    Some((normalized, repaired))
}

fn normalize_citation_items_for_block(
    block: &Map<String, Value>,
    sources: &[Map<String, Value>],
) -> Vec<Value> {
    let source_ids =
        normalize_string_array(block, &["sourceIds", "source_ids"]).unwrap_or_default();
    let preferred_ids = source_ids.into_iter().collect::<HashSet<_>>();
    let selected_sources = if preferred_ids.is_empty() {
        sources.iter().collect::<Vec<_>>()
    } else {
        sources
            .iter()
            .filter(|source| {
                source
                    .get("id")
                    .and_then(Value::as_str)
                    .map(|id| preferred_ids.contains(id))
                    .unwrap_or(false)
            })
            .collect::<Vec<_>>()
    };

    selected_sources
        .into_iter()
        .map(|source| {
            let mut item = Map::new();
            for key in ["title", "url", "note", "quote", "kind", "publishedAt"] {
                if let Some(value) = source.get(key).cloned() {
                    item.insert(key.to_string(), value);
                }
            }
            Value::Object(item)
        })
        .collect()
}

fn build_fallback_rich_text_block(
    id: &str,
    raw_text: &str,
    original_type: Option<&str>,
) -> Map<String, Value> {
    let markdown = if raw_text.trim().is_empty() {
        "当前结构块缺少可渲染内容。".to_string()
    } else {
        raw_text.trim().to_string()
    };
    let mut block = Map::from_iter([
        ("id".to_string(), Value::String(id.to_string())),
        ("type".to_string(), Value::String("rich_text".to_string())),
        ("markdown".to_string(), Value::String(markdown)),
    ]);
    if let Some(value) = original_type
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        block.insert("originalType".to_string(), Value::String(value.to_string()));
    }
    block
}

fn extract_rich_text_body(record: &Map<String, Value>) -> Option<String> {
    find_string(record, &["markdown", "text", "content"])
        .or_else(|| record.get("content").and_then(extract_portable_text))
        .or_else(|| record.get("tiptap").and_then(extract_portable_text))
        .or_else(|| record.get("proseMirror").and_then(extract_portable_text))
}

fn derive_summary_from_blocks(blocks: &[Map<String, Value>]) -> Option<String> {
    for block in blocks {
        let block_type = block
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or_default();
        match block_type {
            "hero_summary" => {
                if let Some(summary) = find_string(block, &["summary"]) {
                    return Some(summary);
                }
            }
            "rich_text" => {
                if let Some(text) = extract_rich_text_body(block) {
                    return Some(truncate_text(&text, 180));
                }
            }
            _ => {}
        }
    }
    None
}

fn build_fallback_markdown(raw_text: &str, reason: &str) -> String {
    let trimmed = raw_text.trim();
    if trimmed.is_empty() {
        format!("> {reason}\n")
    } else {
        trimmed.to_string()
    }
}

fn extract_markdown_heading_and_body(raw_text: &str) -> (Option<String>, String) {
    let lines = raw_text.lines().collect::<Vec<_>>();
    let first_content_index = lines
        .iter()
        .position(|line| !line.trim().is_empty())
        .unwrap_or(0);
    let first_line = lines
        .get(first_content_index)
        .map(|line| line.trim())
        .unwrap_or_default();
    let Some(heading) = first_line.strip_prefix('#') else {
        return (None, raw_text.trim().to_string());
    };
    let title = normalize_text(Some(heading.trim_start_matches('#').trim()));
    if title.is_none() {
        return (None, raw_text.trim().to_string());
    }

    let mut body_start = first_content_index + 1;
    while body_start < lines.len() && lines[body_start].trim().is_empty() {
        body_start += 1;
    }
    let body = lines[body_start..].join("\n").trim().to_string();
    (title, body)
}

fn extract_first_non_empty_line(raw_text: &str) -> Option<String> {
    raw_text
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(ToString::to_string)
}

fn extract_markdown_summary(markdown: &str) -> Option<String> {
    let mut in_code_block = false;
    let mut parts = Vec::new();

    for line in markdown.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("```") {
            in_code_block = !in_code_block;
            continue;
        }
        if in_code_block || trimmed.is_empty() {
            if !parts.is_empty() {
                break;
            }
            continue;
        }
        if trimmed.starts_with('#') {
            continue;
        }

        let normalized = strip_markdown_summary_prefix(trimmed);
        if normalized.is_empty() {
            continue;
        }
        parts.push(normalized);
        if parts.len() >= 2 {
            break;
        }
    }

    if parts.is_empty() {
        None
    } else {
        Some(truncate_text(parts.join(" ").as_str(), 180))
    }
}

fn strip_markdown_summary_prefix(line: &str) -> String {
    let trimmed = line.trim();
    let without_bullet = trimmed
        .strip_prefix("- ")
        .or_else(|| trimmed.strip_prefix("* "))
        .or_else(|| trimmed.strip_prefix("> "))
        .unwrap_or(trimmed)
        .trim();
    let without_ordered = without_bullet
        .find(". ")
        .and_then(|index| {
            if without_bullet[..index]
                .chars()
                .all(|ch| ch.is_ascii_digit())
            {
                without_bullet.get(index + 2..)
            } else {
                None
            }
        })
        .unwrap_or(without_bullet)
        .trim();
    without_ordered.to_string()
}

fn normalize_title(value: Option<String>) -> String {
    value
        .map(|title| truncate_text(&title, 120))
        .filter(|title| !title.trim().is_empty())
        .unwrap_or_else(|| "未命名交付物".to_string())
}

fn truncate_text(value: &str, max_chars: usize) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    let collected = trimmed.chars().take(max_chars).collect::<String>();
    if collected.is_empty() {
        "未命名交付物".to_string()
    } else {
        collected
    }
}

fn find_string(record: &Map<String, Value>, keys: &[&str]) -> Option<String> {
    keys.iter()
        .filter_map(|key| record.get(*key))
        .find_map(Value::as_str)
        .and_then(|value| normalize_text(Some(value)))
}

fn normalize_string_array(record: &Map<String, Value>, keys: &[&str]) -> Option<Vec<String>> {
    let values = keys
        .iter()
        .filter_map(|key| record.get(*key))
        .find_map(Value::as_array)?;
    let items = values
        .iter()
        .filter_map(Value::as_str)
        .filter_map(|value| normalize_text(Some(value)))
        .collect::<Vec<_>>();
    if items.is_empty() {
        None
    } else {
        Some(items)
    }
}

fn has_non_empty_string_array(value: Option<&Value>) -> bool {
    value
        .and_then(Value::as_array)
        .map(|items| {
            items.iter().any(|item| {
                item.as_str()
                    .map(str::trim)
                    .map(|text| !text.is_empty())
                    .unwrap_or(false)
            })
        })
        .unwrap_or(false)
}

fn normalize_text(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(ToString::to_string)
}

fn normalize_enum(value: Option<String>, allowed: &[&str], default: &str) -> String {
    let normalized = value
        .as_deref()
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(|text| text.to_ascii_lowercase())
        .unwrap_or_else(|| default.to_string());
    if allowed.contains(&normalized.as_str()) {
        normalized
    } else {
        default.to_string()
    }
}

fn optional_string_value(value: Option<&str>) -> Value {
    value
        .map(|text| Value::String(text.to_string()))
        .unwrap_or(Value::Null)
}

fn merge_string_field(target: &mut Map<String, Value>, key: &str, value: Option<&str>) {
    if let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) {
        target.insert(key.to_string(), Value::String(value.to_string()));
    }
}

fn upsert_optional_string(target: &mut Map<String, Value>, key: &str, value: Option<&str>) {
    if let Some(value) = value.map(str::trim).filter(|text| !text.is_empty()) {
        target.insert(key.to_string(), Value::String(value.to_string()));
    } else {
        target.remove(key);
    }
}

fn merge_source_run_binding(
    metadata: &mut Map<String, Value>,
    context: &ArtifactDocumentValidationContext,
) {
    let mut binding = metadata
        .get("sourceRunBinding")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    merge_string_field(&mut binding, "threadId", context.thread_id.as_deref());
    merge_string_field(&mut binding, "turnId", context.turn_id.as_deref());
    if !binding.is_empty() {
        metadata.insert("sourceRunBinding".to_string(), Value::Object(binding));
    }
}

fn dedupe_id(base_id: String, seen: &mut HashSet<String>) -> String {
    if seen.insert(base_id.clone()) {
        return base_id;
    }
    let mut index = 2usize;
    loop {
        let candidate = format!("{base_id}-{index}");
        if seen.insert(candidate.clone()) {
            return candidate;
        }
        index += 1;
    }
}

fn extract_portable_text(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => normalize_text(Some(text)),
        Value::Array(items) => {
            let parts = items
                .iter()
                .filter_map(extract_portable_text)
                .collect::<Vec<_>>();
            if parts.is_empty() {
                None
            } else {
                Some(parts.join("\n").trim().to_string())
            }
        }
        Value::Object(record) => {
            if let Some(text) = record.get("text").and_then(Value::as_str) {
                return normalize_text(Some(text));
            }
            if let Some(content) = record.get("content").and_then(extract_portable_text) {
                return Some(content);
            }
            None
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base_context() -> ArtifactDocumentValidationContext {
        ArtifactDocumentValidationContext {
            artifact_id: "artifact-1".to_string(),
            workspace_id: Some("workspace-1".to_string()),
            thread_id: Some("thread-1".to_string()),
            turn_id: Some("turn-1".to_string()),
            title_hint: Some("默认标题".to_string()),
            kind_hint: Some("analysis".to_string()),
            theme: Some("knowledge".to_string()),
            source_policy: Some("required".to_string()),
            request_id: Some("artifact:test".to_string()),
            target_block_id: None,
        }
    }

    #[test]
    fn validate_or_fallback_should_accept_plain_document_json() {
        let raw = serde_json::json!({
            "schemaVersion": ARTIFACT_DOCUMENT_SCHEMA_VERSION,
            "artifactId": "ignored",
            "kind": "report",
            "title": "结构化报告",
            "status": "ready",
            "language": "en-US",
            "blocks": [
                { "id": "hero-1", "type": "hero_summary", "summary": "摘要" }
            ],
            "sources": [
                { "id": "source-1", "title": "OpenAI", "url": "https://openai.com" }
            ],
            "metadata": {}
        })
        .to_string();

        let outcome = validate_or_fallback_artifact_document(&raw, &base_context());
        assert_eq!(outcome.title, "结构化报告");
        assert_eq!(outcome.status, "ready");
        assert!(!outcome.fallback_used);
        assert_eq!(
            outcome.document.get("artifactId").and_then(Value::as_str),
            Some("artifact-1")
        );
        assert_eq!(
            outcome.document.get("language").and_then(Value::as_str),
            Some("zh-CN")
        );
    }

    #[test]
    fn validate_or_fallback_should_accept_draft_envelope_and_repair_blocks() {
        let raw = serde_json::json!({
            "type": "artifact_document_draft",
            "document": {
                "schemaVersion": ARTIFACT_DOCUMENT_SCHEMA_VERSION,
                "kind": "analysis",
                "title": "包裹文档",
                "status": "ready",
                "blocks": [
                    { "type": "unknown_block", "text": "正文" },
                    { "type": "citation_list", "sourceIds": ["source-1"] }
                ],
                "sources": [
                    { "id": "source-1", "title": "OpenAI", "url": "https://openai.com" }
                ],
                "metadata": {}
            }
        })
        .to_string();

        let outcome = validate_or_fallback_artifact_document(&raw, &base_context());
        let blocks = outcome
            .document
            .get("blocks")
            .and_then(Value::as_array)
            .expect("blocks should exist");

        assert!(outcome.repaired);
        assert_eq!(blocks.len(), 2);
        assert_eq!(
            blocks[0].get("type").and_then(Value::as_str),
            Some("rich_text")
        );
        assert_eq!(
            blocks[1]
                .get("items")
                .and_then(Value::as_array)
                .map(|items| !items.is_empty()),
            Some(true)
        );
    }

    #[test]
    fn validate_or_fallback_should_mark_failed_when_sources_required_but_missing() {
        let raw = serde_json::json!({
            "schemaVersion": ARTIFACT_DOCUMENT_SCHEMA_VERSION,
            "kind": "analysis",
            "title": "缺来源文档",
            "blocks": [
                { "type": "hero_summary", "summary": "摘要" }
            ],
            "sources": [],
            "metadata": {}
        })
        .to_string();

        let outcome = validate_or_fallback_artifact_document(&raw, &base_context());
        assert_eq!(outcome.status, "failed");
        assert!(outcome.repaired);
        assert!(!outcome.fallback_used);
    }

    #[test]
    fn validate_or_fallback_should_build_failed_fallback_for_invalid_json() {
        let outcome = validate_or_fallback_artifact_document(
            "这不是 JSON，只是一段普通文本。",
            &base_context(),
        );
        assert_eq!(outcome.status, "failed");
        assert!(outcome.fallback_used);
        assert!(
            outcome
                .document
                .get("blocks")
                .and_then(Value::as_array)
                .expect("blocks should exist")
                .first()
                .and_then(|block| block.get("type"))
                .and_then(Value::as_str)
                == Some("rich_text")
        );
    }

    #[test]
    fn validate_or_fallback_should_repair_truncated_json_before_markdown_recovery() {
        let mut context = base_context();
        context.source_policy = Some("none".to_string());

        let outcome = validate_or_fallback_artifact_document(
            "{\n  \"schemaVersion\": \"artifact_document.v1\",\n  \"kind\": \"analysis\",\n  \"title\": \"结构化报告\",\n  \"status\": \"ready\",\n  \"blocks\": [\n    { \"type\": \"hero_summary\", \"summary\": \"摘要\" }\n  ],\n  \"sources\": [],\n  \"metadata\": {\n    \"theme\": \"knowledge\"\n  }\n",
            &context,
        );

        assert_eq!(outcome.status, "ready");
        assert!(!outcome.fallback_used);
        assert!(outcome.repaired);
        assert!(outcome
            .issues
            .iter()
            .any(|issue| issue.contains("不完整的 ArtifactDocument JSON")));
        assert_eq!(outcome.title, "结构化报告");
    }

    #[test]
    fn validate_or_fallback_should_recover_markdown_when_sources_not_required() {
        let mut context = base_context();
        context.source_policy = Some("none".to_string());
        context.title_hint = None;

        let outcome = validate_or_fallback_artifact_document(
            "# 前端概念方案\n\n我将为你整理一份通用的前端概念方案框架。\n\n## 信息架构\n- 页面结构\n",
            &context,
        );

        assert_eq!(outcome.status, "draft");
        assert!(outcome.fallback_used);
        assert_eq!(outcome.title, "前端概念方案");
        assert!(outcome.repaired);
        assert!(outcome
            .issues
            .iter()
            .any(|issue| issue.contains("Markdown 正文自动恢复")));
        assert_eq!(
            outcome.document.get("status").and_then(Value::as_str),
            Some("draft")
        );
        assert_eq!(
            outcome.document.get("summary").and_then(Value::as_str),
            Some("我将为你整理一份通用的前端概念方案框架。")
        );
    }
}
