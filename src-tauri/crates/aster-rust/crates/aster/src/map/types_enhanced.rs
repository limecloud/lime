//! 增强版代码蓝图类型定义
//!
//! 解决原版的三个核心问题：
//! 1. 没有层级 → 新增目录树视图 + 架构分层视图
//! 2. 没有引用关系 → 新增符号级调用 + 类型引用
//! 3. 没有语义 → AI 生成业务描述

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use super::types::LocationInfo;

/// 架构层枚举
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ArchitectureLayer {
    Presentation,
    Business,
    Data,
    Infrastructure,
    CrossCutting,
}

/// 语义信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SemanticInfo {
    pub description: String,
    pub responsibility: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub business_domain: Option<String>,
    pub architecture_layer: ArchitectureLayer,
    pub tags: Vec<String>,
    pub confidence: f64,
    pub generated_at: String,
}

/// 关键概念
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeyConcept {
    pub name: String,
    pub description: String,
    pub related_modules: Vec<String>,
}

/// 项目语义
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectSemantic {
    pub description: String,
    pub purpose: String,
    pub domains: Vec<String>,
    pub key_concepts: Vec<KeyConcept>,
}

/// 目录节点
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DirectoryNode {
    pub name: String,
    pub path: String,
    #[serde(rename = "type")]
    pub node_type: DirectoryNodeType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub purpose: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub module_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<DirectoryNode>>,
}

/// 目录节点类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DirectoryNodeType {
    Directory,
    File,
}

/// 层信息
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct LayerInfo {
    pub description: String,
    pub modules: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sub_layers: Option<HashMap<String, Vec<String>>>,
}

/// 架构分层
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArchitectureLayers {
    pub presentation: LayerInfo,
    pub business: LayerInfo,
    pub data: LayerInfo,
    pub infrastructure: LayerInfo,
    pub cross_cutting: LayerInfo,
}

impl Default for ArchitectureLayers {
    fn default() -> Self {
        Self {
            presentation: LayerInfo {
                description: "表现层：UI、组件、页面".to_string(),
                ..Default::default()
            },
            business: LayerInfo {
                description: "业务层：核心逻辑、服务".to_string(),
                ..Default::default()
            },
            data: LayerInfo {
                description: "数据层：API、数据库".to_string(),
                ..Default::default()
            },
            infrastructure: LayerInfo {
                description: "基础设施层：工具、配置".to_string(),
                ..Default::default()
            },
            cross_cutting: LayerInfo {
                description: "横切关注点：日志、认证".to_string(),
                ..Default::default()
            },
        }
    }
}

/// 视图
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Views {
    pub directory_tree: DirectoryNode,
    pub architecture_layers: ArchitectureLayers,
}

/// 增强版模块
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnhancedModule {
    pub id: String,
    pub name: String,
    pub path: String,
    pub language: String,
    pub lines: usize,
    pub size: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub semantic: Option<SemanticInfo>,
    pub exports: Vec<String>,
    pub imports: Vec<ModuleImport>,
}

/// 模块导入
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModuleImport {
    pub source: String,
    pub symbols: Vec<String>,
    pub is_external: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_type_only: Option<bool>,
}

/// 符号类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SymbolKind {
    Function,
    Class,
    Method,
    Property,
    Variable,
    Constant,
    Interface,
    Type,
    Enum,
}

/// 符号条目
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SymbolEntry {
    pub id: String,
    pub name: String,
    pub kind: SymbolKind,
    pub module_id: String,
    pub location: LocationInfo,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub signature: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub semantic: Option<SemanticInfo>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent: Option<String>,
}

/// 模块依赖
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModuleDependency {
    pub source: String,
    pub target: String,
    #[serde(rename = "type")]
    pub dep_type: String,
    pub symbols: Vec<String>,
    pub is_type_only: bool,
}

/// 符号调用
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SymbolCall {
    pub caller: String,
    pub callee: String,
    pub call_type: String,
    pub locations: Vec<LocationInfo>,
}

/// 类型引用
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TypeReference {
    pub child: String,
    pub parent: String,
    pub kind: TypeRefKind,
}

/// 类型引用类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TypeRefKind {
    Extends,
    Implements,
}

/// 引用关系
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct References {
    pub module_deps: Vec<ModuleDependency>,
    pub symbol_calls: Vec<SymbolCall>,
    pub type_refs: Vec<TypeReference>,
}

/// 语义覆盖率
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SemanticCoverage {
    pub modules_with_description: usize,
    pub symbols_with_description: usize,
    pub coverage_percent: f64,
}

/// 引用统计
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ReferenceStats {
    pub total_module_deps: usize,
    pub total_symbol_calls: usize,
    pub total_type_refs: usize,
}

/// 增强版统计信息
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct EnhancedStatistics {
    pub total_modules: usize,
    pub total_symbols: usize,
    pub total_lines: usize,
    pub semantic_coverage: SemanticCoverage,
    pub reference_stats: ReferenceStats,
    pub layer_distribution: HashMap<String, usize>,
    pub language_breakdown: HashMap<String, usize>,
    pub largest_files: Vec<super::types::FileStat>,
    pub most_called_symbols: Vec<SymbolStat>,
    pub most_imported_modules: Vec<ImportStat>,
}

/// 符号统计
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SymbolStat {
    pub id: String,
    pub name: String,
    pub call_count: usize,
}

/// 导入统计
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportStat {
    pub id: String,
    pub import_count: usize,
}

/// 蓝图元数据
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlueprintMeta {
    pub version: String,
    pub generated_at: String,
    pub generator_version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub semantic_version: Option<String>,
}

/// 增强版项目信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnhancedProjectInfo {
    pub name: String,
    pub root_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub semantic: Option<ProjectSemantic>,
    pub languages: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub technologies: Option<Vec<String>>,
}

/// 增强版代码蓝图（根结构）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnhancedCodeBlueprint {
    pub format: String,
    pub meta: BlueprintMeta,
    pub project: EnhancedProjectInfo,
    pub views: Views,
    pub modules: HashMap<String, EnhancedModule>,
    pub symbols: HashMap<String, SymbolEntry>,
    pub references: References,
    pub statistics: EnhancedStatistics,
}

/// 增强版生成选项
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct EnhancedGenerateOptions {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub include: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exclude: Option<Vec<String>>,
    #[serde(default = "default_true")]
    pub with_semantics: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub concurrency: Option<usize>,
}

fn default_true() -> bool {
    true
}

/// 增强版分析阶段
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EnhancedAnalysisPhase {
    Discover,
    Parse,
    Symbols,
    References,
    Views,
    Semantics,
    Aggregate,
}

/// 增强版分析进度
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnhancedAnalysisProgress {
    pub phase: EnhancedAnalysisPhase,
    pub current: usize,
    pub total: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_file: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

/// 增强版进度回调
pub type EnhancedProgressCallback = Box<dyn Fn(EnhancedAnalysisProgress) + Send + Sync>;
