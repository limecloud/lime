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
const ARTIFACT_SOURCE_TYPE_VALUES: &[&str] = &["web", "file", "tool", "message", "search_result"];
const ARTIFACT_SOURCE_RELIABILITY_VALUES: &[&str] = &["primary", "secondary", "derived"];
const MAX_BLOCK_COUNT: usize = 40;
const MAX_METRIC_COUNT: usize = 8;
const MAX_SOURCE_SNIPPET_CHARS: usize = 280;
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
    ensure_renderer_density(&mut metadata, "comfortable");
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
            Value::Array(vec![Value::Object(build_fallback_rich_text_block(
                "fallback-1",
                fallback_markdown.as_str(),
                Some("failed_fallback"),
            ))]),
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

        let locator = normalize_source_locator(record);
        let raw_label = find_string(record, &["label", "title"]);
        let snippet = find_string(
            record,
            &["snippet", "note", "summary", "description", "quote"],
        )
        .map(|text| truncate_text(text.as_str(), MAX_SOURCE_SNIPPET_CHARS));
        if raw_label.is_none() && locator.is_none() && snippet.is_none() {
            *repaired = true;
            issues.push(format!("sources[{}] 缺少可展示字段，已忽略。", index));
            continue;
        }

        let label = raw_label
            .or_else(|| resolve_source_locator_hint(locator.as_ref()))
            .unwrap_or_else(|| id.clone());
        let source_type = normalize_source_type(
            find_string(record, &["type", "kind"]).as_deref(),
            locator.as_ref(),
            id.as_str(),
        );
        let reliability =
            normalize_source_reliability(find_string(record, &["reliability"]).as_deref());

        let mut normalized = Map::new();
        normalized.insert("id".to_string(), Value::String(id));
        normalized.insert("type".to_string(), Value::String(source_type));
        normalized.insert("label".to_string(), Value::String(label));
        if let Some(locator) = locator {
            normalized.insert("locator".to_string(), Value::Object(locator));
        }
        if let Some(snippet) = snippet {
            normalized.insert("snippet".to_string(), Value::String(snippet));
        }
        if let Some(reliability) = reliability {
            normalized.insert("reliability".to_string(), Value::String(reliability));
        }
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

    let mut normalized = Map::new();
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
    }

    if record.get("hidden").and_then(Value::as_bool) == Some(true) {
        normalized.insert("hidden".to_string(), Value::Bool(true));
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
            let Some(title) = find_string(record, &["title"]) else {
                return Some((
                    build_fallback_rich_text_block(
                        &format!("block-{}", index + 1),
                        extract_portable_text(value).as_deref().unwrap_or(""),
                        Some("section_header"),
                    ),
                    true,
                ));
            };
            normalized.insert("title".to_string(), Value::String(title));
            upsert_optional_string(
                &mut normalized,
                "description",
                find_string(record, &["description"]).as_deref(),
            );
        }
        "hero_summary" => {
            let summary =
                find_string(record, &["summary", "text"]).or_else(|| extract_portable_text(value));
            let Some(summary) = summary else {
                return Some((
                    build_fallback_rich_text_block(
                        &format!("block-{}", index + 1),
                        extract_portable_text(value).as_deref().unwrap_or(""),
                        Some("hero_summary"),
                    ),
                    true,
                ));
            };
            normalized.insert("summary".to_string(), Value::String(summary));
            upsert_optional_string(
                &mut normalized,
                "eyebrow",
                find_string(record, &["eyebrow"]).as_deref(),
            );
            upsert_optional_string(
                &mut normalized,
                "title",
                find_string(record, &["title"]).as_deref(),
            );
            let highlights = normalize_string_array_value(record.get("highlights"));
            if !highlights.is_empty() {
                normalized.insert(
                    "highlights".to_string(),
                    Value::Array(highlights.into_iter().map(Value::String).collect()),
                );
            }
        }
        "key_points" => {
            let items = normalize_string_array_value(record.get("items"));
            if items.is_empty() {
                return Some((
                    build_fallback_rich_text_block(
                        &format!("block-{}", index + 1),
                        extract_portable_text(value).as_deref().unwrap_or(""),
                        Some("key_points"),
                    ),
                    true,
                ));
            }
            normalized.insert(
                "items".to_string(),
                Value::Array(items.into_iter().map(Value::String).collect()),
            );
            upsert_optional_string(
                &mut normalized,
                "title",
                find_string(record, &["title"]).as_deref(),
            );
        }
        "rich_text" => {
            let Some((content_format, content, markdown_compat)) =
                normalize_rich_text_content(record)
            else {
                return Some((
                    build_fallback_rich_text_block(
                        &format!("block-{}", index + 1),
                        extract_portable_text(value).as_deref().unwrap_or(""),
                        Some("rich_text"),
                    ),
                    true,
                ));
            };
            normalized.insert("contentFormat".to_string(), Value::String(content_format));
            normalized.insert("content".to_string(), content);
            if let Some(markdown) = markdown_compat {
                normalized.insert("markdown".to_string(), Value::String(markdown));
            }
            upsert_optional_string(
                &mut normalized,
                "title",
                find_string(record, &["title"]).as_deref(),
            );
        }
        "callout" => {
            let body = find_string(record, &["body", "content", "text"])
                .or_else(|| record.get("content").and_then(extract_portable_text))
                .or_else(|| extract_portable_text(value));
            let Some(body) = body else {
                return Some((
                    build_fallback_rich_text_block(
                        &format!("block-{}", index + 1),
                        extract_portable_text(value).as_deref().unwrap_or(""),
                        Some("callout"),
                    ),
                    true,
                ));
            };
            normalized.insert(
                "tone".to_string(),
                Value::String(normalize_callout_tone(
                    find_string(record, &["tone", "variant"]).as_deref(),
                )),
            );
            normalized.insert("body".to_string(), Value::String(body.clone()));
            normalized.insert("content".to_string(), Value::String(body.clone()));
            normalized.insert("text".to_string(), Value::String(body));
            upsert_optional_string(
                &mut normalized,
                "title",
                find_string(record, &["title"]).as_deref(),
            );
        }
        "table" => {
            let columns = normalize_table_columns(record);
            let rows = normalize_table_rows(record, &columns);
            if columns.is_empty() && rows.is_empty() {
                return Some((
                    build_fallback_rich_text_block(
                        &format!("block-{}", index + 1),
                        extract_portable_text(value).as_deref().unwrap_or(""),
                        Some("table"),
                    ),
                    true,
                ));
            }
            normalized.insert(
                "columns".to_string(),
                Value::Array(columns.into_iter().map(Value::String).collect()),
            );
            normalized.insert("rows".to_string(), Value::Array(rows));
            upsert_optional_string(
                &mut normalized,
                "title",
                find_string(record, &["title"]).as_deref(),
            );
        }
        "checklist" => {
            let items = normalize_checklist_items(record);
            if items.is_empty() {
                return Some((
                    build_fallback_rich_text_block(
                        &format!("block-{}", index + 1),
                        extract_portable_text(value).as_deref().unwrap_or(""),
                        Some("checklist"),
                    ),
                    true,
                ));
            }
            normalized.insert("items".to_string(), Value::Array(items));
            upsert_optional_string(
                &mut normalized,
                "title",
                find_string(record, &["title"]).as_deref(),
            );
        }
        "metric_grid" => {
            let mut metrics = normalize_metric_items(record);
            if metrics.is_empty() {
                return Some((
                    build_fallback_rich_text_block(
                        &format!("block-{}", index + 1),
                        extract_portable_text(value).as_deref().unwrap_or(""),
                        Some("metric_grid"),
                    ),
                    true,
                ));
            }
            if metrics.len() > MAX_METRIC_COUNT {
                metrics.truncate(MAX_METRIC_COUNT);
                repaired = true;
            }
            normalized.insert("metrics".to_string(), Value::Array(metrics));
            upsert_optional_string(
                &mut normalized,
                "title",
                find_string(record, &["title"]).as_deref(),
            );
        }
        "quote" => {
            let text =
                find_string(record, &["text", "quote"]).or_else(|| extract_portable_text(value));
            let Some(text) = text else {
                return Some((
                    build_fallback_rich_text_block(
                        &format!("block-{}", index + 1),
                        extract_portable_text(value).as_deref().unwrap_or(""),
                        Some("quote"),
                    ),
                    true,
                ));
            };
            normalized.insert("text".to_string(), Value::String(text));
            upsert_optional_string(
                &mut normalized,
                "attribution",
                find_string(record, &["attribution", "author", "source"]).as_deref(),
            );
        }
        "citation_list" => {
            let items = normalize_citation_items_for_block(record, source_id_set, sources);
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
            upsert_optional_string(
                &mut normalized,
                "title",
                find_string(record, &["title"]).as_deref(),
            );
        }
        "image" => {
            let Some(url) = find_string(record, &["url", "src", "imageUrl"]) else {
                return Some((
                    build_fallback_rich_text_block(
                        &format!("block-{}", index + 1),
                        extract_portable_text(value).as_deref().unwrap_or(""),
                        Some("image"),
                    ),
                    true,
                ));
            };
            normalized.insert("url".to_string(), Value::String(url));
            upsert_optional_string(
                &mut normalized,
                "alt",
                find_string(record, &["alt"]).as_deref(),
            );
            upsert_optional_string(
                &mut normalized,
                "caption",
                find_string(record, &["caption"]).as_deref(),
            );
        }
        "code_block" => {
            let code = find_string(record, &["code", "content"])
                .or_else(|| record.get("content").and_then(extract_portable_text))
                .or_else(|| extract_portable_text(value));
            let Some(code) = code else {
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
            };
            normalized.insert("code".to_string(), Value::String(code));
            upsert_optional_string(
                &mut normalized,
                "language",
                find_string(record, &["language"]).as_deref(),
            );
            upsert_optional_string(
                &mut normalized,
                "title",
                find_string(record, &["title"]).as_deref(),
            );
        }
        "divider" => {}
        _ => {}
    }

    Some((normalized, repaired))
}

fn normalize_citation_items_for_block(
    block: &Map<String, Value>,
    source_id_set: &HashSet<String>,
    sources: &[Map<String, Value>],
) -> Vec<Value> {
    let mut has_explicit_items = false;
    let explicit_items = block
        .get("items")
        .and_then(Value::as_array)
        .map(|items| {
            has_explicit_items = true;
            items
                .iter()
                .filter_map(|item| {
                    let record = item.as_object()?;
                    let source_id = resolve_citation_source_id(record, sources)?;
                    if !source_id_set.contains(source_id.as_str()) {
                        return None;
                    }

                    let mut normalized = Map::new();
                    normalized.insert("sourceId".to_string(), Value::String(source_id));
                    upsert_optional_string(
                        &mut normalized,
                        "note",
                        find_string(record, &["note", "summary", "description"]).as_deref(),
                    );
                    Some(Value::Object(normalized))
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    if has_explicit_items {
        return explicit_items;
    }

    let preferred_ids = normalize_string_array(block, &["sourceIds", "source_ids"])
        .unwrap_or_default()
        .into_iter()
        .filter(|source_id| source_id_set.contains(source_id))
        .collect::<HashSet<_>>();
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
        .filter_map(|source| {
            let source_id = source.get("id").and_then(Value::as_str)?;
            let mut normalized = Map::new();
            normalized.insert("sourceId".to_string(), Value::String(source_id.to_string()));
            upsert_optional_string(
                &mut normalized,
                "note",
                source.get("snippet").and_then(Value::as_str),
            );
            Some(Value::Object(normalized))
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
        (
            "contentFormat".to_string(),
            Value::String("markdown".to_string()),
        ),
        ("content".to_string(), Value::String(markdown.clone())),
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
    if find_string(record, &["contentFormat"]).as_deref() == Some("markdown") {
        if let Some(content) = record
            .get("content")
            .and_then(stringify_value)
            .or_else(|| record.get("content").and_then(extract_portable_text))
        {
            return Some(content);
        }
    }

    find_string(record, &["markdown", "text"])
        .or_else(|| record.get("content").and_then(stringify_value))
        .or_else(|| record.get("content").and_then(extract_portable_text))
        .or_else(|| record.get("tiptap").and_then(extract_portable_text))
        .or_else(|| record.get("proseMirror").and_then(extract_portable_text))
}

fn normalize_source_locator(record: &Map<String, Value>) -> Option<Map<String, Value>> {
    let existing = record
        .get("locator")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let url =
        find_string(&existing, &["url"]).or_else(|| find_string(record, &["url", "href", "link"]));
    let path = find_string(&existing, &["path"]).or_else(|| find_string(record, &["path"]));
    let line_start = existing
        .get("lineStart")
        .and_then(normalize_number_value)
        .or_else(|| record.get("lineStart").and_then(normalize_number_value))
        .or_else(|| record.get("line_start").and_then(normalize_number_value));
    let line_end = existing
        .get("lineEnd")
        .and_then(normalize_number_value)
        .or_else(|| record.get("lineEnd").and_then(normalize_number_value))
        .or_else(|| record.get("line_end").and_then(normalize_number_value));
    let tool_call_id = find_string(&existing, &["toolCallId"])
        .or_else(|| find_string(record, &["toolCallId", "tool_call_id"]));
    let message_id = find_string(&existing, &["messageId"])
        .or_else(|| find_string(record, &["messageId", "message_id"]));

    if url.is_none()
        && path.is_none()
        && line_start.is_none()
        && line_end.is_none()
        && tool_call_id.is_none()
        && message_id.is_none()
    {
        return None;
    }

    let mut locator = existing;
    upsert_optional_string(&mut locator, "url", url.as_deref());
    upsert_optional_string(&mut locator, "path", path.as_deref());
    upsert_optional_number(&mut locator, "lineStart", line_start);
    upsert_optional_number(&mut locator, "lineEnd", line_end);
    upsert_optional_string(&mut locator, "toolCallId", tool_call_id.as_deref());
    upsert_optional_string(&mut locator, "messageId", message_id.as_deref());
    Some(locator)
}

fn resolve_source_locator_hint(locator: Option<&Map<String, Value>>) -> Option<String> {
    locator.and_then(|value| find_string(value, &["url"]).or_else(|| find_string(value, &["path"])))
}

fn normalize_source_type(
    value: Option<&str>,
    locator: Option<&Map<String, Value>>,
    id: &str,
) -> String {
    let normalized =
        normalize_text(value).map(|text| text.to_ascii_lowercase().replace([' ', '-'], "_"));

    match normalized.as_deref() {
        Some("browser") => return "web".to_string(),
        Some("search") | Some("searchresult") => return "search_result".to_string(),
        Some(value) if ARTIFACT_SOURCE_TYPE_VALUES.contains(&value) => return value.to_string(),
        _ => {}
    }

    let normalized_id = id.to_ascii_lowercase();
    if normalized_id.starts_with("file:") {
        return "file".to_string();
    }
    if normalized_id.starts_with("tool:") {
        return "tool".to_string();
    }
    if normalized_id.starts_with("message:") {
        return "message".to_string();
    }
    if normalized_id.starts_with("search:") {
        return "search_result".to_string();
    }
    if locator
        .and_then(|value| find_string(value, &["toolCallId"]))
        .is_some()
    {
        return "tool".to_string();
    }
    if locator
        .and_then(|value| find_string(value, &["messageId"]))
        .is_some()
    {
        return "message".to_string();
    }
    if locator
        .and_then(|value| find_string(value, &["path"]))
        .is_some()
    {
        return "file".to_string();
    }
    if locator
        .and_then(|value| find_string(value, &["url"]))
        .is_some()
    {
        return "web".to_string();
    }
    "message".to_string()
}

fn normalize_source_reliability(value: Option<&str>) -> Option<String> {
    let normalized = normalize_text(value).map(|text| text.to_ascii_lowercase())?;
    if ARTIFACT_SOURCE_RELIABILITY_VALUES.contains(&normalized.as_str()) {
        Some(normalized)
    } else {
        None
    }
}

fn normalize_string_array_value(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .filter_map(|item| normalize_text(Some(item)))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

fn normalize_rich_text_content(
    record: &Map<String, Value>,
) -> Option<(String, Value, Option<String>)> {
    let declared_format =
        find_string(record, &["contentFormat"]).map(|text| text.to_ascii_lowercase());
    if declared_format.as_deref() == Some("prosemirror_json") {
        if let Some(content) = record.get("content").cloned() {
            return Some(("prosemirror_json".to_string(), content, None));
        }
    }

    if let Some(content) = record
        .get("proseMirror")
        .cloned()
        .or_else(|| record.get("tiptap").cloned())
    {
        return Some(("prosemirror_json".to_string(), content, None));
    }

    let markdown = find_string(record, &["markdown", "text"])
        .or_else(|| record.get("content").and_then(stringify_value))
        .or_else(|| record.get("content").and_then(extract_portable_text));
    markdown.map(|text| {
        (
            "markdown".to_string(),
            Value::String(text.clone()),
            Some(text),
        )
    })
}

fn normalize_callout_tone(value: Option<&str>) -> String {
    match normalize_text(value)
        .map(|text| text.to_ascii_lowercase())
        .as_deref()
    {
        Some("success") => "success".to_string(),
        Some("warning") => "warning".to_string(),
        Some("danger") | Some("error") | Some("critical") => "danger".to_string(),
        Some("neutral") => "neutral".to_string(),
        _ => "info".to_string(),
    }
}

fn normalize_table_columns(record: &Map<String, Value>) -> Vec<String> {
    let columns = record
        .get("columns")
        .and_then(Value::as_array)
        .or_else(|| record.get("headers").and_then(Value::as_array));

    columns
        .map(|items| {
            items
                .iter()
                .filter_map(|column| match column {
                    Value::String(text) => normalize_text(Some(text)),
                    Value::Object(entry) => find_string(entry, &["label", "title", "key"]),
                    _ => None,
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

fn normalize_table_rows(record: &Map<String, Value>, columns: &[String]) -> Vec<Value> {
    let target_len = columns.len();
    let Some(rows) = record.get("rows").and_then(Value::as_array) else {
        return Vec::new();
    };

    rows.iter()
        .filter_map(|row| {
            let mut cells = match row {
                Value::Array(items) => items
                    .iter()
                    .map(|cell| stringify_value(cell).unwrap_or_default())
                    .collect::<Vec<_>>(),
                Value::Object(entry) => {
                    if let Some(items) = entry.get("cells").and_then(Value::as_array) {
                        items
                            .iter()
                            .map(|cell| stringify_value(cell).unwrap_or_default())
                            .collect::<Vec<_>>()
                    } else if let Some(items) = entry.get("values").and_then(Value::as_array) {
                        items
                            .iter()
                            .map(|cell| stringify_value(cell).unwrap_or_default())
                            .collect::<Vec<_>>()
                    } else if !columns.is_empty() {
                        columns
                            .iter()
                            .map(|column| {
                                entry
                                    .get(column.as_str())
                                    .and_then(stringify_value)
                                    .unwrap_or_default()
                            })
                            .collect::<Vec<_>>()
                    } else {
                        entry
                            .values()
                            .map(|cell| stringify_value(cell).unwrap_or_default())
                            .collect::<Vec<_>>()
                    }
                }
                _ => return None,
            };

            if cells.iter().all(|cell| cell.trim().is_empty()) {
                return None;
            }

            if target_len > 0 {
                cells.truncate(target_len);
                while cells.len() < target_len {
                    cells.push(String::new());
                }
            }

            Some(Value::Array(cells.into_iter().map(Value::String).collect()))
        })
        .collect()
}

fn normalize_checklist_items(record: &Map<String, Value>) -> Vec<Value> {
    let Some(items) = record.get("items").and_then(Value::as_array) else {
        return Vec::new();
    };

    items
        .iter()
        .enumerate()
        .filter_map(|(index, item)| match item {
            Value::String(text) => normalize_text(Some(text)).map(|text| {
                Value::Object(Map::from_iter([
                    (
                        "id".to_string(),
                        Value::String(format!("check-{}", index + 1)),
                    ),
                    ("text".to_string(), Value::String(text)),
                    ("state".to_string(), Value::String("todo".to_string())),
                ]))
            }),
            Value::Object(entry) => {
                let text = find_string(entry, &["text", "label", "title", "content"])?;
                let explicit_state =
                    find_string(entry, &["state"]).map(|value| value.to_ascii_lowercase());
                let state = match explicit_state.as_deref() {
                    Some("todo") | Some("doing") | Some("done") => {
                        explicit_state.unwrap_or_else(|| "todo".to_string())
                    }
                    _ if entry.get("checked").and_then(Value::as_bool) == Some(true)
                        || entry.get("done").and_then(Value::as_bool) == Some(true)
                        || entry.get("completed").and_then(Value::as_bool) == Some(true) =>
                    {
                        "done".to_string()
                    }
                    _ => "todo".to_string(),
                };
                Some(Value::Object(Map::from_iter([
                    (
                        "id".to_string(),
                        Value::String(
                            find_string(entry, &["id"])
                                .unwrap_or_else(|| format!("check-{}", index + 1)),
                        ),
                    ),
                    ("text".to_string(), Value::String(text)),
                    ("state".to_string(), Value::String(state)),
                ])))
            }
            _ => None,
        })
        .collect()
}

fn normalize_metric_items(record: &Map<String, Value>) -> Vec<Value> {
    let items = record
        .get("metrics")
        .and_then(Value::as_array)
        .or_else(|| record.get("items").and_then(Value::as_array));
    let Some(items) = items else {
        return Vec::new();
    };

    items
        .iter()
        .enumerate()
        .filter_map(|(index, item)| {
            let entry = item.as_object()?;
            let label = find_string(entry, &["label", "title"])
                .unwrap_or_else(|| format!("指标 {}", index + 1));
            let value = entry
                .get("value")
                .and_then(stringify_value)
                .or_else(|| entry.get("metric").and_then(stringify_value))
                .or_else(|| entry.get("score").and_then(stringify_value))?;

            let mut normalized = Map::new();
            normalized.insert(
                "id".to_string(),
                Value::String(
                    find_string(entry, &["id"]).unwrap_or_else(|| format!("metric-{}", index + 1)),
                ),
            );
            normalized.insert("label".to_string(), Value::String(label));
            normalized.insert("value".to_string(), Value::String(value));
            upsert_optional_string(
                &mut normalized,
                "note",
                find_string(entry, &["note", "detail", "description", "trend"]).as_deref(),
            );
            if let Some(tone) = normalize_metric_tone(find_string(entry, &["tone"]).as_deref()) {
                normalized.insert("tone".to_string(), Value::String(tone));
            }
            Some(Value::Object(normalized))
        })
        .collect()
}

fn normalize_metric_tone(value: Option<&str>) -> Option<String> {
    match normalize_text(value)
        .map(|text| text.to_ascii_lowercase())
        .as_deref()
    {
        Some("neutral") => Some("neutral".to_string()),
        Some("success") => Some("success".to_string()),
        Some("warning") => Some("warning".to_string()),
        Some("danger") | Some("error") | Some("critical") => Some("danger".to_string()),
        _ => None,
    }
}

fn resolve_citation_source_id(
    item_record: &Map<String, Value>,
    sources: &[Map<String, Value>],
) -> Option<String> {
    let direct_id = find_string(item_record, &["sourceId", "source_id"]);
    if let Some(source_id) = direct_id {
        if sources
            .iter()
            .any(|source| source.get("id").and_then(Value::as_str) == Some(source_id.as_str()))
        {
            return Some(source_id);
        }
    }

    if let Some(url) = find_string(item_record, &["url", "href", "link"]) {
        if let Some(source) = sources.iter().find(|source| {
            source
                .get("locator")
                .and_then(Value::as_object)
                .and_then(|locator| locator.get("url"))
                .and_then(Value::as_str)
                == Some(url.as_str())
        }) {
            return source
                .get("id")
                .and_then(Value::as_str)
                .map(ToString::to_string);
        }
    }

    if let Some(label) = find_string(item_record, &["label", "title"]) {
        if let Some(source) = sources
            .iter()
            .find(|source| source.get("label").and_then(Value::as_str) == Some(label.as_str()))
        {
            return source
                .get("id")
                .and_then(Value::as_str)
                .map(ToString::to_string);
        }
    }

    None
}

fn normalize_number_value(value: &Value) -> Option<u64> {
    match value {
        Value::Number(number) => number.as_u64().or_else(|| {
            number
                .as_i64()
                .filter(|candidate| *candidate >= 0)
                .map(|candidate| candidate as u64)
        }),
        Value::String(text) => text.trim().parse::<u64>().ok(),
        _ => None,
    }
}

fn stringify_value(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => normalize_text(Some(text)),
        Value::Number(number) => Some(number.to_string()),
        Value::Bool(flag) => Some(flag.to_string()),
        Value::Null => None,
        Value::Array(_) | Value::Object(_) => extract_portable_text(value)
            .or_else(|| serde_json::to_string(value).ok())
            .and_then(|text| normalize_text(Some(text.as_str()))),
    }
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

fn upsert_optional_number(target: &mut Map<String, Value>, key: &str, value: Option<u64>) {
    if let Some(value) = value {
        target.insert(key.to_string(), Value::from(value));
    } else {
        target.remove(key);
    }
}

fn upsert_optional_string(target: &mut Map<String, Value>, key: &str, value: Option<&str>) {
    if let Some(value) = value.map(str::trim).filter(|text| !text.is_empty()) {
        target.insert(key.to_string(), Value::String(value.to_string()));
    } else {
        target.remove(key);
    }
}

fn ensure_renderer_density(metadata: &mut Map<String, Value>, density: &str) {
    let mut hints = metadata
        .get("rendererHints")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    hints.insert("density".to_string(), Value::String(density.to_string()));
    metadata.insert("rendererHints".to_string(), Value::Object(hints));
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
            theme: Some("general".to_string()),
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
            "{\n  \"schemaVersion\": \"artifact_document.v1\",\n  \"kind\": \"analysis\",\n  \"title\": \"结构化报告\",\n  \"status\": \"ready\",\n  \"blocks\": [\n    { \"type\": \"hero_summary\", \"summary\": \"摘要\" }\n  ],\n  \"sources\": [],\n  \"metadata\": {\n    \"theme\": \"general\"\n  }\n",
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
