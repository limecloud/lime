//! 代码本体图谱类型定义
//!

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// 位置信息
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct LocationInfo {
    pub file: String,
    pub start_line: u32,
    pub start_column: u32,
    pub end_line: u32,
    pub end_column: u32,
}

/// 项目信息
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ProjectInfo {
    pub name: String,
    pub root_path: String,
    pub languages: Vec<String>,
    pub file_count: usize,
    pub total_lines: usize,
}

/// 导入信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportInfo {
    /// 导入来源 (模块路径)
    pub source: String,
    /// 导入的符号列表
    pub symbols: Vec<String>,
    /// 是否为默认导入
    pub is_default: bool,
    /// 是否为命名空间导入
    pub is_namespace: bool,
    /// 是否为动态导入
    pub is_dynamic: bool,
    /// 位置
    pub location: LocationInfo,
}

/// 导出信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportInfo {
    /// 导出名称
    pub name: String,
    /// 导出类型
    pub export_type: ExportType,
    /// 重命名前的原名
    #[serde(skip_serializing_if = "Option::is_none")]
    pub original_name: Option<String>,
    /// 重导出的来源
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    /// 位置
    pub location: LocationInfo,
}

/// 导出类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ExportType {
    Default,
    Named,
    Namespace,
    Reexport,
}

/// 参数信息
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ParameterInfo {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub param_type: Option<String>,
    pub is_optional: bool,
    pub is_rest: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_value: Option<String>,
}

/// 变量节点
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VariableNode {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub var_type: Option<String>,
    pub kind: VariableKind,
    pub is_exported: bool,
    pub location: LocationInfo,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub documentation: Option<String>,
}

/// 变量类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum VariableKind {
    Const,
    Let,
    Var,
}

/// 属性节点
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PropertyNode {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prop_type: Option<String>,
    pub visibility: Visibility,
    pub is_static: bool,
    pub is_readonly: bool,
    pub is_optional: bool,
    pub location: LocationInfo,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub documentation: Option<String>,
}

/// 可见性
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Visibility {
    #[default]
    Public,
    Private,
    Protected,
}

/// 调用引用
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CallReference {
    pub target_id: String,
    pub target_name: String,
    pub call_type: CallType,
    pub location: LocationInfo,
}

/// 调用类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CallType {
    Direct,
    Method,
    Constructor,
    Callback,
    Dynamic,
}

/// 函数节点
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FunctionNode {
    pub id: String,
    pub name: String,
    pub signature: String,
    pub parameters: Vec<ParameterInfo>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub return_type: Option<String>,
    pub is_async: bool,
    pub is_generator: bool,
    pub is_exported: bool,
    pub location: LocationInfo,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub documentation: Option<String>,
    pub calls: Vec<CallReference>,
    pub called_by: Vec<CallReference>,
}

/// 方法节点
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MethodNode {
    pub id: String,
    pub name: String,
    pub class_name: String,
    pub signature: String,
    pub parameters: Vec<ParameterInfo>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub return_type: Option<String>,
    pub visibility: Visibility,
    pub is_static: bool,
    pub is_abstract: bool,
    pub is_async: bool,
    pub is_override: bool,
    pub location: LocationInfo,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub documentation: Option<String>,
    pub calls: Vec<CallReference>,
    pub called_by: Vec<CallReference>,
}

/// 类节点
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClassNode {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extends: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub implements: Option<Vec<String>>,
    pub is_abstract: bool,
    pub is_exported: bool,
    pub methods: Vec<MethodNode>,
    pub properties: Vec<PropertyNode>,
    pub location: LocationInfo,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub documentation: Option<String>,
}

/// 接口节点
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InterfaceNode {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extends: Option<Vec<String>>,
    pub is_exported: bool,
    pub properties: Vec<PropertySignature>,
    pub methods: Vec<MethodSignature>,
    pub location: LocationInfo,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub documentation: Option<String>,
}

/// 属性签名
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PropertySignature {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prop_type: Option<String>,
    pub is_optional: bool,
    pub is_readonly: bool,
}

/// 方法签名
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct MethodSignature {
    pub name: String,
    pub signature: String,
    pub parameters: Vec<ParameterInfo>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub return_type: Option<String>,
    pub is_optional: bool,
}

/// 类型节点
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TypeNode {
    pub id: String,
    pub name: String,
    pub definition: String,
    pub is_exported: bool,
    pub location: LocationInfo,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub documentation: Option<String>,
}

/// 枚举节点
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnumNode {
    pub id: String,
    pub name: String,
    pub members: Vec<EnumMember>,
    pub is_exported: bool,
    pub is_const: bool,
    pub location: LocationInfo,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub documentation: Option<String>,
}

/// 枚举成员
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnumMember {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
}

/// 模块节点
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModuleNode {
    pub id: String,
    pub name: String,
    pub path: String,
    pub language: String,
    pub lines: usize,
    pub size: usize,
    pub imports: Vec<ImportInfo>,
    pub exports: Vec<ExportInfo>,
    pub classes: Vec<ClassNode>,
    pub interfaces: Vec<InterfaceNode>,
    pub types: Vec<TypeNode>,
    pub enums: Vec<EnumNode>,
    pub functions: Vec<FunctionNode>,
    pub variables: Vec<VariableNode>,
}

/// 调用图节点
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CallGraphNode {
    pub id: String,
    pub name: String,
    pub node_type: CallGraphNodeType,
    pub module_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub class_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub signature: Option<String>,
}

/// 调用图节点类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CallGraphNodeType {
    Function,
    Method,
    Constructor,
    Arrow,
}

/// 调用图边
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CallGraphEdge {
    pub source: String,
    pub target: String,
    pub edge_type: CallType,
    pub count: usize,
    pub locations: Vec<LocationInfo>,
}

/// 调用图
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct CallGraph {
    pub nodes: Vec<CallGraphNode>,
    pub edges: Vec<CallGraphEdge>,
}

/// 依赖边
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DependencyEdge {
    pub source: String,
    pub target: String,
    pub edge_type: DependencyType,
    pub symbols: Vec<String>,
    pub is_type_only: bool,
}

/// 依赖类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DependencyType {
    Import,
    Require,
    Dynamic,
}

/// 依赖图
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct DependencyGraph {
    pub edges: Vec<DependencyEdge>,
}

/// 统计信息
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct OntologyStatistics {
    pub total_modules: usize,
    pub total_classes: usize,
    pub total_interfaces: usize,
    pub total_functions: usize,
    pub total_methods: usize,
    pub total_variables: usize,
    pub total_call_edges: usize,
    pub total_dependency_edges: usize,
    pub total_lines: usize,
    pub language_breakdown: HashMap<String, usize>,
    pub largest_files: Vec<FileStat>,
    pub most_called_functions: Vec<FunctionStat>,
    pub most_imported_modules: Vec<ModuleStat>,
}

/// 文件统计
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileStat {
    pub path: String,
    pub lines: usize,
    pub size: usize,
}

/// 函数统计
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FunctionStat {
    pub id: String,
    pub name: String,
    pub call_count: usize,
}

/// 模块统计
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModuleStat {
    pub id: String,
    pub import_count: usize,
}

/// 代码本体（根结构）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodeOntology {
    pub version: String,
    pub generated_at: String,
    pub project: ProjectInfo,
    pub modules: Vec<ModuleNode>,
    pub call_graph: CallGraph,
    pub dependency_graph: DependencyGraph,
    pub statistics: OntologyStatistics,
}

/// 生成选项
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct GenerateOptions {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub include: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exclude: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub depth: Option<usize>,
    #[serde(default)]
    pub incremental: bool,
    #[serde(default)]
    pub use_lsp: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub concurrency: Option<usize>,
}

/// 缓存条目
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CacheEntry {
    pub hash: String,
    pub mtime: u64,
    pub module: ModuleNode,
}

/// 缓存数据
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CacheData {
    pub version: String,
    pub root_path: String,
    pub generated_at: String,
    pub entries: HashMap<String, CacheEntry>,
}

/// 分析阶段
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AnalysisPhase {
    Discover,
    Parse,
    Symbols,
    Calls,
    Dependencies,
    Aggregate,
}

/// 分析进度
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnalysisProgress {
    pub phase: AnalysisPhase,
    pub current: usize,
    pub total: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_file: Option<String>,
}

/// 进度回调类型
pub type ProgressCallback = Box<dyn Fn(AnalysisProgress) + Send + Sync>;
