//! 分块代码蓝图类型定义
//!
//! 核心设计：
//! 1. 按目录拆分 chunk，避免单一巨型文件
//! 2. 轻量级 index.json，只有元数据和索引
//! 3. 渐进式加载，按需 fetch chunk

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use super::types_enhanced::*;

/// 分块格式索引文件
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChunkedIndex {
    pub format: String,
    pub meta: ChunkedMeta,
    pub project: EnhancedProjectInfo,
    pub views: LightweightViews,
    pub statistics: EnhancedStatistics,
    pub chunk_index: HashMap<String, String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub global_dependency_graph: Option<HashMap<String, GlobalDependencyNode>>,
}

/// 分块元数据
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChunkedMeta {
    pub version: String,
    pub generated_at: String,
    pub generator_version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
}

/// 全局依赖图节点
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GlobalDependencyNode {
    pub imports: Vec<String>,
    pub imported_by: Vec<String>,
    pub exports_symbols: bool,
}

/// 轻量级视图
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LightweightViews {
    pub directory_tree: DirectoryNodeWithChunk,
    pub architecture_layers: ArchitectureLayersWithChunks,
}

/// 目录树节点（带 chunk 引用）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DirectoryNodeWithChunk {
    pub name: String,
    pub path: String,
    #[serde(rename = "type")]
    pub node_type: DirectoryNodeType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chunk_file: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub module_count: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<DirectoryNodeWithChunk>>,
}

/// 架构层（带 chunk 引用）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArchitectureLayersWithChunks {
    pub presentation: LayerWithChunks,
    pub business: LayerWithChunks,
    pub data: LayerWithChunks,
    pub infrastructure: LayerWithChunks,
    pub cross_cutting: LayerWithChunks,
}

/// 层（带 chunk 引用）
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct LayerWithChunks {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub chunk_files: Vec<String>,
    pub module_count: usize,
}

/// Chunk 数据文件
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChunkData {
    pub path: String,
    pub modules: HashMap<String, EnhancedModule>,
    pub symbols: HashMap<String, SymbolEntry>,
    pub references: ChunkReferences,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<ChunkMetadata>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub planned_modules: Option<Vec<PlannedModule>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub refactoring_tasks: Option<Vec<RefactoringTask>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub module_design_meta: Option<HashMap<String, ModuleDesignMeta>>,
}

/// Chunk 引用关系
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ChunkReferences {
    pub module_deps: Vec<ModuleDependency>,
    pub symbol_calls: Vec<SymbolCall>,
    pub type_refs: Vec<TypeReference>,
}

/// Chunk 元数据
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChunkMetadata {
    pub last_modified: String,
    pub checksum: String,
    pub module_count: usize,
}

/// 分块生成选项
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ChunkedGenerateOptions {
    #[serde(default = "default_true")]
    pub with_global_dependency_graph: bool,
    #[serde(default = "default_true")]
    pub with_checksum: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_dir: Option<String>,
}

fn default_true() -> bool {
    true
}

/// 模块实现状态
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ModuleStatus {
    Implemented,
    Planned,
    InProgress,
    Deprecated,
    NeedsRefactor,
}

/// 优先级
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Priority {
    High,
    Medium,
    Low,
}

/// 计划中的模块
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlannedModule {
    pub id: String,
    pub name: String,
    pub status: PlannedStatus,
    pub design_notes: String,
    pub priority: Priority,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub estimated_lines: Option<usize>,
    pub dependencies: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expected_exports: Option<Vec<String>>,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
}

/// 计划状态
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PlannedStatus {
    Planned,
    InProgress,
}

/// 重构任务类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RefactoringType {
    ExtractFunction,
    ExtractClass,
    Rename,
    Move,
    Split,
    Merge,
    Inline,
    Other,
}

/// 任务状态
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TaskStatus {
    Pending,
    InProgress,
    Completed,
    Cancelled,
}

/// 重构任务
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RefactoringTask {
    pub id: String,
    pub target: String,
    #[serde(rename = "type")]
    pub task_type: RefactoringType,
    pub description: String,
    pub reason: String,
    pub status: TaskStatus,
    pub priority: Priority,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
}

/// 模块设计元数据
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ModuleDesignMeta {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<ModuleStatus>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub design_notes: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub marked_at: Option<String>,
}
