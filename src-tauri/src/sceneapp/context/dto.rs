use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ContextLayerSourceKind {
    UserInput,
    Slot,
    Project,
    Workspace,
    MemoryProfile,
    ReferenceLibrary,
    ToolReadiness,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceItem {
    pub id: String,
    pub label: String,
    pub source_kind: ContextLayerSourceKind,
    pub content_type: String,
    pub uri: Option<String>,
    pub summary: Option<String>,
    pub selected: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TasteProfile {
    pub profile_id: String,
    pub summary: String,
    pub keywords: Vec<String>,
    pub avoid_keywords: Vec<String>,
    pub derived_from_reference_ids: Vec<String>,
    pub confidence: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ContextCompilerPlan {
    pub active_layers: Vec<String>,
    pub memory_refs: Vec<String>,
    pub tool_refs: Vec<String>,
    pub reference_count: usize,
    pub notes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ContextLayerSnapshot {
    pub workspace_id: Option<String>,
    pub project_id: Option<String>,
    pub skill_refs: Vec<String>,
    pub memory_refs: Vec<String>,
    pub tool_refs: Vec<String>,
    pub reference_items: Vec<ReferenceItem>,
    pub taste_profile: Option<TasteProfile>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SceneAppContextOverlay {
    pub compiler_plan: ContextCompilerPlan,
    pub snapshot: ContextLayerSnapshot,
}
