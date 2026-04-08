use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::str::FromStr;
use utoipa::ToSchema;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum MemoryCategory {
    Profile,
    Preferences,
    Entities,
    Events,
    Cases,
    Patterns,
}

impl std::fmt::Display for MemoryCategory {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            MemoryCategory::Profile => write!(f, "profile"),
            MemoryCategory::Preferences => write!(f, "preferences"),
            MemoryCategory::Entities => write!(f, "entities"),
            MemoryCategory::Events => write!(f, "events"),
            MemoryCategory::Cases => write!(f, "cases"),
            MemoryCategory::Patterns => write!(f, "patterns"),
        }
    }
}

impl FromStr for MemoryCategory {
    type Err = anyhow::Error;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "profile" => Ok(Self::Profile),
            "preferences" => Ok(Self::Preferences),
            "entities" => Ok(Self::Entities),
            "events" => Ok(Self::Events),
            "cases" => Ok(Self::Cases),
            "patterns" => Ok(Self::Patterns),
            _ => Err(anyhow::anyhow!("Unknown memory category: {}", s)),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct MemoryRecord {
    pub id: i64,
    pub session_id: String,
    pub category: MemoryCategory,
    #[serde(rename = "abstract")]
    pub abstract_text: String,
    pub overview: String,
    pub content: String,
    pub content_hash: String,
    pub source_start_ts: i64,
    pub source_end_ts: i64,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct MemorySearchResult {
    pub record: MemoryRecord,
    pub relevance_score: f32,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CommitOptions {
    pub force: bool,
    pub max_messages: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CommitReport {
    pub session_id: String,
    pub messages_scanned: usize,
    pub memories_created: usize,
    pub memories_merged: usize,
    pub source_start_ts: Option<i64>,
    pub source_end_ts: Option<i64>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct MemoryStats {
    pub total_memories: i64,
    pub total_sessions: i64,
    pub total_events: i64,
    pub total_links: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct MemoryHealth {
    pub healthy: bool,
    pub message: String,
}

pub(crate) fn normalize_text(raw: &str) -> String {
    raw.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

pub(crate) fn summarize_abstract(raw: &str) -> String {
    let mut result = raw.trim().replace('\n', " ");
    if result.len() > 140 {
        result.truncate(140);
    }
    result
}

pub(crate) fn summarize_overview(raw: &str) -> String {
    let mut result = raw.trim().to_string();
    if result.len() > 480 {
        result.truncate(480);
    }
    result
}

pub(crate) fn detect_category(role: &str, text: &str) -> MemoryCategory {
    let lower = text.to_lowercase();

    if lower.contains("i prefer")
        || lower.contains("prefer ")
        || lower.contains("please remember")
        || lower.contains("以后")
        || lower.contains("偏好")
        || lower.contains("我希望")
    {
        return MemoryCategory::Preferences;
    }

    if lower.contains("my name is") || lower.contains("我是") || lower.contains("我叫") {
        return MemoryCategory::Profile;
    }

    if lower.contains("incident")
        || lower.contains("milestone")
        || lower.contains("decision")
        || lower.contains("决定")
        || lower.contains("结论")
    {
        return MemoryCategory::Events;
    }

    if role == "assistant" {
        if lower.contains("pattern")
            || lower.contains("通用")
            || lower.contains("复用")
            || lower.contains("best practice")
        {
            return MemoryCategory::Patterns;
        }
        return MemoryCategory::Cases;
    }

    if lower.contains("project")
        || lower.contains("repo")
        || lower.contains("模块")
        || lower.contains("服务")
        || lower.contains("函数")
    {
        return MemoryCategory::Entities;
    }

    MemoryCategory::Events
}
