//! 上游 memory stage-1 的严格结构化输出契约。
//!
//! 该模块只负责解析和清理 provider 返回值，不负责调用模型。调用方必须先以
//! 当前 provider 的能力构造严格 JSON schema，再把解析成功的快照交给状态 owner。

use regex::Regex;
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::OnceLock;

const V2_SUMMARY_MAX_BYTES: usize = 9_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Version {
    V1,
    V2,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct Output {
    pub(super) raw_memory: Option<String>,
    pub(super) rollout_summary: String,
    pub(super) rollout_slug: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct V1Output {
    raw_memory: String,
    rollout_summary: String,
    #[serde(default)]
    rollout_slug: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct V2Output {
    rollout_summary: String,
    rollout_slug: String,
}

pub(super) fn parse(source: &str, version: Version) -> Result<Output, String> {
    let output = match version {
        Version::V1 => {
            let parsed: V1Output = serde_json::from_str(source)
                .map_err(|error| format!("invalid memory stage-1 v1 output: {error}"))?;
            Output {
                raw_memory: Some(redact_secrets(&parsed.raw_memory)),
                rollout_summary: redact_secrets(&parsed.rollout_summary),
                rollout_slug: parsed.rollout_slug.map(|value| redact_secrets(&value)),
            }
        }
        Version::V2 => {
            let parsed: V2Output = serde_json::from_str(source)
                .map_err(|error| format!("invalid memory stage-1 v2 output: {error}"))?;
            Output {
                raw_memory: None,
                rollout_summary: truncate_utf8_bytes(
                    &redact_secrets(&parsed.rollout_summary),
                    V2_SUMMARY_MAX_BYTES,
                ),
                rollout_slug: Some(redact_secrets(&parsed.rollout_slug)),
            }
        }
    };

    Ok(output)
}

pub(super) fn output_schema(version: Version) -> Value {
    match version {
        Version::V1 => json!({
            "type": "object",
            "properties": {
                "rollout_summary": { "type": "string" },
                "rollout_slug": { "type": ["string", "null"] },
                "raw_memory": { "type": "string" }
            },
            "required": ["rollout_summary", "rollout_slug", "raw_memory"],
            "additionalProperties": false
        }),
        Version::V2 => json!({
            "type": "object",
            "properties": {
                "rollout_summary": { "type": "string" },
                "rollout_slug": { "type": "string" }
            },
            "required": ["rollout_summary", "rollout_slug"],
            "additionalProperties": false
        }),
    }
}

fn truncate_utf8_bytes(value: &str, max_bytes: usize) -> String {
    if value.len() <= max_bytes {
        return value.to_string();
    }
    let mut end = max_bytes;
    while end > 0 && !value.is_char_boundary(end) {
        end -= 1;
    }
    value[..end].to_string()
}

fn redact_secrets(value: &str) -> String {
    static SECRET_PATTERN: OnceLock<Regex> = OnceLock::new();
    let pattern = SECRET_PATTERN.get_or_init(|| {
        Regex::new(
            r"(?ix)
                (?:sk-[a-z0-9_-]{8,})
                |(?:ghp_[a-z0-9]{8,})
                |(?:xox[baprs]-[a-z0-9-]{8,})
                |(?:authorization\s*:\s*bearer\s+[^\s,;]+)
                |(?:api[_-]?key\s*[:=]\s*[^\s,;]+)
            ",
        )
        .expect("memory secret redaction pattern must compile")
    });
    pattern.replace_all(value, "[REDACTED_SECRET]").into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn v1_requires_known_fields_and_redacts_secrets() {
        let output = parse(
            r#"{"raw_memory":"api_key=sk-123456789","rollout_summary":"ok","rollout_slug":null}"#,
            Version::V1,
        )
        .expect("strict v1 output");
        assert_eq!(output.raw_memory.as_deref(), Some("[REDACTED_SECRET]"));
        assert_eq!(output.rollout_slug, None);
        assert!(parse(
            r#"{"raw_memory":"","rollout_summary":"","rollout_slug":null,"extra":1}"#,
            Version::V1,
        )
        .is_err());
    }

    #[test]
    fn v2_omits_raw_memory_and_bounds_multibyte_summary() {
        let summary = "界".repeat(5_000);
        let source = serde_json::json!({
            "rollout_summary": summary,
            "rollout_slug": "work"
        })
        .to_string();
        let output = parse(&source, Version::V2).expect("strict v2 output");
        assert!(output.raw_memory.is_none());
        assert!(output.rollout_summary.len() <= V2_SUMMARY_MAX_BYTES);
        assert!(output.rollout_slug.is_some());
    }

    #[test]
    fn schemas_are_strict_and_version_specific() {
        let v1 = output_schema(Version::V1);
        let v2 = output_schema(Version::V2);
        assert_eq!(v1["additionalProperties"], false);
        assert_eq!(v2["additionalProperties"], false);
        assert!(v1["properties"].get("raw_memory").is_some());
        assert!(v2["properties"].get("raw_memory").is_none());
    }
}
